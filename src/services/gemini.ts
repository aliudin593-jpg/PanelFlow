
import { GoogleGenAI, Type } from "@google/genai";
import { toast } from "sonner";

let customApiKeyInput = "";
let activeKeyIndex = 0;

export function setCustomGeminiApiKey(key: string) {
  customApiKeyInput = key;
  activeKeyIndex = 0; // Reset active key index when user updates API keys
}

export function parseApiKeys(): string[] {
  const envRaw = process.env.GEMINI_API_KEY || "";
  const rawInput = customApiKeyInput || envRaw;
  if (!rawInput.trim()) return [];

  // Split by comma, newline, or semicolon and remove whitespace / empty lines
  return rawInput
    .split(/[\n,;]+/)
    .map(k => k.trim())
    .filter(k => k.length > 0);
}

export function getKeyPoolStats() {
  const keys = parseApiKeys();
  const currentKey = keys[activeKeyIndex] || "";
  const maskedKey = currentKey ? `${currentKey.substring(0, 6)}...${currentKey.substring(Math.max(0, currentKey.length - 4))}` : "None";
  return {
    totalKeys: keys.length,
    activeKeyIndex: keys.length > 0 ? activeKeyIndex + 1 : 0,
    maskedKey,
    hasMultipleKeys: keys.length > 1
  };
}

function getGenAI() {
  const keys = parseApiKeys();
  if (keys.length === 0) {
    return new GoogleGenAI({ apiKey: "" });
  }

  if (activeKeyIndex >= keys.length) {
    activeKeyIndex = 0;
  }

  return new GoogleGenAI({ apiKey: keys[activeKeyIndex] });
}

function rotateToNextApiKey(): boolean {
  const keys = parseApiKeys();
  if (keys.length <= 1) return false;

  const previousKeyNum = activeKeyIndex + 1;
  activeKeyIndex = (activeKeyIndex + 1) % keys.length;
  const newKeyNum = activeKeyIndex + 1;

  console.warn(`[API Key Manager] Quota/Rate limit hit on API Key #${previousKeyNum}. Switching automatically to API Key #${newKeyNum} of ${keys.length}.`);
  toast.warning(`Quota Limit Hit (Key #${previousKeyNum}). Switched to API Key #${newKeyNum}/${keys.length}`, { id: 'api-key-rotation' });
  return true;
}

export async function generatePanelScripts(
  panels: { id: string; imageUrl: string; dialogue?: string; context?: string; scriptLength?: string }[], 
  language: string = 'English',
  globalContext: string = '',
  globalScriptLength: string = 'Normal',
  signal?: AbortSignal,
  onProgress?: (partialScripts: { id: string; script: string }[]) => void
) {
  if (!panels.length) return [];

  // Increase chunk size to 5 for faster generation with downscaled images
  const chunkSize = 5;
  const chunks = [];
  for (let i = 0; i < panels.length; i += chunkSize) {
    chunks.push(panels.slice(i, i + chunkSize));
  }

  const prompt = `
    You are a professional comic scriptwriter and narrator. 
    Analyze these comic panels in order. For each panel, write a narration script 
    that describes the action and dialogue in a cinematic way, suitable for a video voiceover.
    Do NOT include the original text from the comic, just the narration.
    Write the script in ${language}.
    
    ${globalContext ? `BACKGROUND LORE & GLOBAL CONTEXT TO REMEMBER:\n${globalContext}\nUse this context to accurately name characters, weapons, and skills seen in the panels.` : ''}
    
    CRITICAL INSTRUCTION: You must strictly follow the "Required Script Length" specified for each panel individually.
    
    Return the result as a JSON array of objects with 'id' and 'script' fields.
    CRITICAL: You must use the EXACT 'id' provided for each panel.
  `;

  let allResults: { id: string; script: string }[] = [];

  for (const chunk of chunks) {
    if (signal?.aborted) {
      console.warn("Script generation cancelled by user signal. Returning partial results completed so far.");
      break;
    }

    // Await downscaling concurrently for the chunk
    const optimizedChunk = await Promise.all(chunk.map(async p => {
      const optimizedData = await downscaleForAI(p.imageUrl, 768);
      return { ...p, data: optimizedData.split(',')[1], mimeType: "image/jpeg" };
    }));

    const parts = [
      { text: prompt },
      ...optimizedChunk.flatMap(p => {
        let panelLengthInstruction = "Normal (1-3 sentences)";
        const lengthSetting = p.scriptLength || globalScriptLength;
        if (lengthSetting === 'Short') panelLengthInstruction = "Very brief, punchy (1 sentence max)";
        else if (lengthSetting === 'Detailed') panelLengthInstruction = "Detailed, descriptive (4+ sentences)";

        return [
          { text: `Panel ID: ${p.id}\nRequired Script Length: ${panelLengthInstruction}${p.context ? `\nPanel Context/Lore: ${p.context}` : ''}` },
          { inlineData: { mimeType: p.mimeType, data: p.data } }
        ];
      })
    ];

    await withRetry(async () => {
      try {
        const response = await (getGenAI().models.generateContent as any)({
          model: "gemini-2.5-flash",
          contents: [{ role: 'user', parts }],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  script: { type: Type.STRING }
                },
                required: ["id", "script"]
              }
            }
          }
        }, { signal });

        const text = response.text;
        if (text) {
          try {
            const parsed: { id: string; script: string }[] = JSON.parse(text);
            allResults = allResults.concat(parsed);
            if (onProgress && parsed.length > 0) {
              onProgress(parsed);
            }
          } catch (e) {
            console.error("Failed to parse Gemini script response chunk:", text);
          }
        }
      } catch (error: any) {
        console.error("Error generating scripts for chunk:", error);
        throw error;
      }
    });
  }

  return allResults;
}


async function withRetry<T>(operation: () => Promise<T>, maxRetries = 10, baseDelay = 3000): Promise<T> {
  let attempt = 0;
  let keysTriedInRound = 0;

  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error: any) {
      const isRateLimit =
        error?.status === 429 ||
        error?.message?.includes('429') ||
        error?.message?.includes('RESOURCE_EXHAUSTED') ||
        error?.message?.includes('quota') ||
        error?.status === 503;

      if (isRateLimit) {
        const rotated = rotateToNextApiKey();
        if (rotated) {
          keysTriedInRound++;
          const keys = parseApiKeys();
          // If we haven't tried all keys in the pool yet, retry immediately with the next key!
          if (keysTriedInRound < keys.length) {
            console.info(`[API Key Manager] Retrying operation immediately with API Key #${activeKeyIndex + 1}...`);
            continue;
          }
        }

        attempt++;
        keysTriedInRound = 0;
        if (attempt >= maxRetries) throw error;

        const delay = baseDelay * Math.pow(2, Math.min(attempt - 1, 4));
        console.warn(`[API Key Rate Limit] Retrying in ${delay}ms... (Attempt ${attempt} of ${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error("Max retries exceeded");
}

function addWavHeader(pcmData: Uint8Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const chunkSize = 36 + dataSize;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, chunkSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(buffer);
  out.set(pcmData, 44);

  return out;
}

export async function generateSocialMetadata(
  scripts: string[],
  language: string = 'English'
) {
  const prompt = `
    You are an expert social media manager for short-form comic/manga videos (TikTok, Instagram Reels, YouTube Shorts).
    Read the following narrations scripts from a comic chapter:
    
    ${scripts.map((s, i) => `Panel ${i + 1}: ${s}`).join('\n')}
    
    Based on the events in these scripts, generate:
    1. A catchy 'titleHook' (under 60 characters, capitalized, high click-through rate, e.g. "He Unleashed His Hidden Power!").
    2. A 'description' suitable for a video caption. Keep it engaging, asking a question or teasing the plot.
    3. 'hashtags': a string of 5-8 relevant hashtags separated by spaces (e.g. "#manga #anime #opmc").

    Write these in ${language}.
  `;

  return withRetry(async () => {
    const response = await getGenAI().models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            titleHook: { type: Type.STRING },
            description: { type: Type.STRING },
            hashtags: { type: Type.STRING }
          },
          required: ["titleHook", "description", "hashtags"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI for metadata.");
    
    try {
      return JSON.parse(text) as { titleHook: string; description: string; hashtags: string; };
    } catch (e) {
      const jsonMatch = text.match(/```(?:json)?\n([\s\S]*?)```/);
      if (jsonMatch) return JSON.parse(jsonMatch[1]);
      throw e;
    }
  });
}

export async function generateSpeech(text: string, voice: string = 'Kore'): Promise<string> {
  return withRetry(async () => {
    try {
      const response = await getGenAI().models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say naturally: ${text}` }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice },
            },
          },
        },
      });

      const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inlineData?.data) {
        throw new Error("No audio data received from Gemini TTS");
      }
      
      const pcmBytes = Uint8Array.from(atob(inlineData.data), c => c.charCodeAt(0));
      
      let sampleRate = 24000;
      if (inlineData.mimeType?.includes('rate=')) {
         const match = inlineData.mimeType.match(/rate=(\d+)/);
         if (match && match[1]) sampleRate = parseInt(match[1]);
      }

      if (pcmBytes.length > 4 && String.fromCharCode(pcmBytes[0], pcmBytes[1], pcmBytes[2], pcmBytes[3]) === 'RIFF') {
        return inlineData.data;
      }
      
      const wavBytes = addWavHeader(pcmBytes, sampleRate);
      
      let wavBinaryString = '';
      const chunkSize = 8192;
      for (let i = 0; i < wavBytes.length; i += chunkSize) {
        wavBinaryString += String.fromCharCode.apply(null, Array.from(wavBytes.slice(i, i + chunkSize)));
      }
      return btoa(wavBinaryString);
      
    } catch (error: any) {
      console.error("Error generating speech:", error);
      throw error;
    }
  });
}


export function downscaleForAI(base64: string, maxWidth: number = 1024, maxHeight: number = 3072): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      
      // Preserve aspect ratio but cap width to not exceed maxWidth
      if (width > maxWidth) {
        height = (height / width) * maxWidth;
        width = maxWidth;
      }
      
      // Cap height to not exceed maxHeight (Gemini max allowed typically 3072)
      if (height > maxHeight) {
        width = (width / height) * maxHeight;
        height = maxHeight;
      }
      
      width = Math.floor(width);
      height = Math.floor(height);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8)); // Using JPEG 80% for speed
    };
    img.onerror = (err) => {
      console.warn("Failed to load image in downscaleForAI, returning original source:", err);
      resolve(base64); // Safe fallback to bypass hanging
    };
    img.src = base64;
  });
}

export async function detectPanels(pageImageUrl: string) {
  // Downscale image before sending to AI to significantly speed up upload time
  // Webtoons are vertical strips, so we cap width at 1024, but allow height up to 6000
  // to ensure human faces aren't squished down to unrecognizable blur blocks.
  const optimizedImage = await downscaleForAI(pageImageUrl, 1024, 6000);

  const prompt = `
    Analyze this comic/webtoon page and identify the bounding boxes of the entire illustrated panels (illustrations/frames).
    
    CRITICAL FOCUS GUIDELINES (COMPLETE ILLUSTRATED PANEL FRAMES):
    1. Your primary goal is to detect the outer boundaries of each unique, individual illustrated panel frame/box in its entirety as drawn by the artist.
    2. NEVER create multiple sub-crops inside a single panel frame (e.g. do NOT draw a box around just a character's face, face close-up, body, or object if it is already part of a larger drawn panel). Each drawn panel/scene on the page must be captured as a single, complete bounding box.
    3. Do NOT slice characters' bodies, heads, or limbs in half. The entire character, their figure, pose, background, and all illustrated visual content of that panel frame must be fully contained within its bounding box. If a single character's body is split across multiple adjacent panels (a common webtoon technique), MERGE them and create ONE single large bounding box that encompasses the entire character across those panels, ignoring the gaps between them.
    4. The bounding box coordinates must align precisely with the outer edges/borders of the illustrated panel box.
    5. Exclude empty page margins, blank gutters, and solid divider lines between panels.
    6. For vertical webtoons or scrolling strips, identify each distinct, sequential illustration block/scene as a single complete panel.
    
    SPEECH BUBBLE & DIALOGUE EXCLUSION PROTOCOL (ABSENT/CROPPED OUT):
    1. You must NEVER include a speech bubble, dialogue balloon, conversation text box, narrative caption, or sound effect text in any bounding box.
    2. HINDARI balon percakapan / balon dialog secara total! Jangan pernah mengambil balon teks atau percakapan. Balon dialog harus dipotong keluar (cropped out) atau dilewati sepenuhnya.
    3. Bounding box harus memotong keluar (crop out) balon teks tersebut atau hanya fokus pada karakter / wajah / item di sebelahnya. Jika ada balon percakapan yang tumpang tindih dengan karakter, sesuaikan koordinat kotak agar balon teks terpotong keluar, menyisakan hanya wajah, karakter, atau item yang bersih dari teks percakapan. FOKUS UTAMA ADALAH CHARACTER-NYA!
    
    BLANK PANEL EXCLUSION PROTOCOL (CRITICAL):
    1. HINDARI panel kosong (blank panel). Jangan pernah membuat bounding box pada area kosong yang seluruhnya berwarna putih atau hitam (blank spaces / solid gutters / empty panels).
    
    WATERMARK & LOGO EXCLUSION PROTOCOL (CRITICAL):
    1. Learn to accurately differentiate between actual illustrated comic panels/scenes and watermarks/logos/site stamps.
    2. Watermarks, translator/scanlation brand names (e.g., circular badges, scanning logos), site domains (e.g., text URLs like "asuracans.com", "mangadex.org"), and credit/notice texts are NOT comic panels. You MUST exclude them entirely.
    3. NEVER include a bounding box that is just a watermark, brand watermark, logo, or credit stamp.
    4. If a watermark or website logo/text falls near the edges or boundaries of a real illustrated comic group, shrink or adjust that panel's bounding box coordinates to completely crop it out. The final panel crop must contain only the pure comic artwork, with all watermarks and site logos completely removed.
    
    Return the coordinates as normalized values (0 to 1000) for x, y, width, and height.
    Ensure panels are returned in the correct manga reading order (top-to-bottom, then right-to-left).
    Return a JSON array of objects: { x, y, width, height }.
  `;

  return withRetry(async () => {
    try {
      const response = await getGenAI().models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: optimizedImage.split(',')[1] } }
          ]
        }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
                width: { type: Type.NUMBER },
                height: { type: Type.NUMBER }
              },
              required: ["x", "y", "width", "height"]
            }
          }
        }
      });

      const text = response.text;
      console.log("Gemini Panel Detection Response:", text);

      if (!text) {
        console.warn("Gemini returned empty text for panel detection");
        return [];
      }

      try {
        return JSON.parse(text);
      } catch (parseError) {
        console.error("Failed to parse Gemini panel detection response:", text);
        return [];
      }
    } catch (error: any) {
      console.error("Error detecting panels:", error);
      throw error;
    }
  });
}
