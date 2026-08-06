
import { GoogleGenAI, Type } from "@google/genai";
import { toast } from "sonner";

let customApiKeyInput = "";
let activeKeyIndex = 0;
const exhaustedKeysSet = new Set<string>();

export function setCustomGeminiApiKey(key: string) {
  customApiKeyInput = key;
  activeKeyIndex = 0;
  exhaustedKeysSet.clear();
}

export function markKeyAsExhausted(key: string) {
  if (key) {
    exhaustedKeysSet.add(key);
    console.warn(`[API Key Manager] API Key ${key.substring(0, 6)}... marked as EXHAUSTED for the session.`);
  }
}

export function parseApiKeys(): string[] {
  const envRaw = process.env.GEMINI_API_KEY || "";
  const rawInput = customApiKeyInput || envRaw;
  if (!rawInput.trim()) return [];

  // Split by comma, newline, or semicolon and filter out invalid tokens
  const validKeys = rawInput
    .split(/[\n,;]+/)
    .map(k => k.trim())
    .filter(k => k.length >= 15);

  const activeKeys = validKeys.filter(k => !exhaustedKeysSet.has(k));
  return activeKeys.length > 0 ? activeKeys : validKeys;
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

export function fastCompressForAI(
  imageUrl: string,
  maxDim: number = 360
): Promise<{ data: string; mimeType: string }> {
  if (!imageUrl || typeof imageUrl !== 'string') {
    return Promise.resolve({ data: '', mimeType: 'image/jpeg' });
  }

  return new Promise((resolve) => {
    // 500ms fail-safe timer for instant execution
    const timer = setTimeout(() => {
      let rawData = imageUrl;
      if (rawData.includes(',')) rawData = rawData.split(',')[1];
      resolve({ data: rawData, mimeType: 'image/jpeg' });
    }, 500);

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        clearTimeout(timer);
        try {
          let width = img.width || 360;
          let height = img.height || 360;

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height / width) * maxDim);
              width = maxDim;
            } else {
              width = Math.round((width / height) * maxDim);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, width);
          canvas.height = Math.max(1, height);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            // 55% JPEG compression = ultra-lightweight ~15KB per image payload!
            const dataUrl = canvas.toDataURL('image/jpeg', 0.55);
            const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
            resolve({ data: base64, mimeType: 'image/jpeg' });
            return;
          }
        } catch (e) {
          console.warn("fastCompressForAI canvas error, using raw:", e);
        }
        let rawData = imageUrl;
        if (rawData.includes(',')) rawData = rawData.split(',')[1];
        resolve({ data: rawData, mimeType: 'image/jpeg' });
      };

      img.onerror = () => {
        clearTimeout(timer);
        let rawData = imageUrl;
        if (rawData.includes(',')) rawData = rawData.split(',')[1];
        resolve({ data: rawData, mimeType: 'image/jpeg' });
      };

      img.src = imageUrl;
    } catch (e) {
      clearTimeout(timer);
      let rawData = imageUrl;
      if (rawData.includes(',')) rawData = rawData.split(',')[1];
      resolve({ data: rawData, mimeType: 'image/jpeg' });
    }
  });
}

export async function generateSinglePanelScript(
  panel: { id: string; imageUrl: string; dialogue?: string; context?: string; scriptLength?: string },
  language: string = 'English',
  globalContext: string = '',
  globalScriptLength: string = 'Normal',
  signal?: AbortSignal
): Promise<string> {
  if (parseApiKeys().length === 0) {
    toast.error("Gemini API Key belum diisi! Silakan masukkan API Key di menu Settings.", { id: 'missing-api-key', duration: 6000 });
    throw new Error("Gemini API Key belum diisi. Silakan masukkan Gemini API Key di menu Settings!");
  }

  const { data, mimeType } = await fastCompressForAI(panel.imageUrl, 360);

  if (!data) {
    console.warn("Empty image data for panel:", panel.id);
    return "";
  }

  let panelLengthInstruction = "Normal (1-3 sentences)";
  const lengthSetting = panel.scriptLength || globalScriptLength;
  if (lengthSetting === 'Short') panelLengthInstruction = "Very brief, punchy (1 sentence max)";
  else if (lengthSetting === 'Detailed') panelLengthInstruction = "Detailed, descriptive (4+ sentences)";

  const prompt = `
    You are a professional comic scriptwriter and narrator. 
    Analyze this comic panel illustration. Write a narration script 
    that describes the action and dialogue in a cinematic way, suitable for a video voiceover.
    Do NOT include the original text from the comic, just the narration.
    Write the script in ${language}.
    Required Script Length: ${panelLengthInstruction}.
    ${panel.context ? `Panel Context/Lore: ${panel.context}\n` : ''}
    ${globalContext ? `BACKGROUND LORE & GLOBAL CONTEXT TO REMEMBER:\n${globalContext}\n` : ''}
  `;

  const modelsToTry = ["gemini-2.5-flash"];

  for (const modelName of modelsToTry) {
    try {
      return await withRetry(async () => {
        const response = await (getGenAI().models.generateContent as any)({
          model: modelName,
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data } }
            ]
          }]
        }, { signal });

        return response.text?.trim() || "";
      });
    } catch (err: any) {
      console.warn(`[Script Generator] Model ${modelName} failed for panel ${panel.id}:`, err);
      if (modelName === modelsToTry[modelsToTry.length - 1]) {
        throw err;
      }
    }
  }

  return "";
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

  if (parseApiKeys().length === 0) {
    toast.error("Gemini API Key belum diisi! Silakan masukkan API Key di menu Settings.", { id: 'missing-api-key', duration: 6000 });
    throw new Error("Gemini API Key belum diisi. Silakan masukkan Gemini API Key di menu Settings!");
  }

  const chunkSize = 10;
  const chunks: (typeof panels)[] = [];
  for (let i = 0; i < panels.length; i += chunkSize) {
    chunks.push(panels.slice(i, i + chunkSize));
  }

  const allResults: { id: string; script: string }[] = [];
  const parallelChunkWorkers = 1; // Process 1 chunk (10 panels) per batch to prevent burst 15 RPM limit

  for (let i = 0; i < chunks.length; i += parallelChunkWorkers) {
    if (signal?.aborted) break;

    const currentChunkBatch = chunks.slice(i, i + parallelChunkWorkers);
    const chunkBatchResults = await Promise.all(currentChunkBatch.map(async (chunk) => {
      if (signal?.aborted) return [];

      // 1. Compress panel thumbnails concurrently (~15KB each)
      const compressedChunk = await Promise.all(chunk.map(async p => {
        const compressed = await fastCompressForAI(p.imageUrl, 360);
        return { ...p, ...compressed };
      }));

      // 2. Build multi-part prompt
      const promptText = `
        You are a professional comic narrator.
        Analyze these ${chunk.length} comic panels in sequential order.
        For each panel, write a cinematic video narration script in ${language}.
        ${globalContext ? `Global Context: ${globalContext}\n` : ''}
        Return a JSON array of objects with fields "id" and "script".
        CRITICAL: Use exact panel ID for each object.
      `;

      const parts: any[] = [{ text: promptText }];
      compressedChunk.forEach((p, idx) => {
        let lengthInstr = "Normal (1-3 sentences)";
        const lSetting = p.scriptLength || globalScriptLength;
        if (lSetting === 'Short') lengthInstr = "Short (1 sentence)";
        else if (lSetting === 'Detailed') lengthInstr = "Detailed (4+ sentences)";

        parts.push({ text: `Panel ID: ${p.id}\nIndex: ${idx + 1}\nRequired Length: ${lengthInstr}${p.context ? `\nContext: ${p.context}` : ''}` });
        parts.push({ inlineData: { mimeType: p.mimeType, data: p.data } });
      });

      let chunkScripts: { id: string; script: string }[] = [];

      try {
        await withRetry(async () => {
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
            let clean = text.trim();
            if (clean.includes("```")) {
              const m = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
              if (m) clean = m[1].trim();
            }
            const parsed = JSON.parse(clean);
            if (Array.isArray(parsed)) {
              chunk.forEach((p, idx) => {
                let match = parsed.find(item => item && (item.id === p.id || item.id === `panel_${idx + 1}` || item.id === `${idx + 1}`));
                if (!match && parsed[idx]) match = parsed[idx];
                const scriptText = typeof match === 'string' ? match : (match?.script || match?.text || '');
                if (scriptText && scriptText.trim()) {
                  chunkScripts.push({ id: p.id, script: scriptText.trim() });
                }
              });
            }
          }
        });
      } catch (err) {
        console.warn("[Turbo Engine] Batch JSON chunk failed, falling back to sequential single-panel workers for this chunk:", err);
      }

      // Sequential Fallback for missing panels with throttling (prevents 15 RPM spike)
      const scoredIds = new Set(chunkScripts.map(s => s.id));
      const missingPanels = chunk.filter(p => !scoredIds.has(p.id));

      if (missingPanels.length > 0 && !signal?.aborted) {
        for (const p of missingPanels) {
          if (signal?.aborted) break;
          try {
            const s = await generateSinglePanelScript(p, language, globalContext, globalScriptLength, signal);
            if (s) chunkScripts.push({ id: p.id, script: s });
          } catch (e) {
            console.error("Single panel fallback error:", e);
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      return chunkScripts;
    }));

    const flatBatchResults = chunkBatchResults.flat();
    allResults.push(...flatBatchResults);

    if (onProgress && flatBatchResults.length > 0) {
      onProgress(flatBatchResults);
    }

    // 400ms throttle between chunk batches to stay smoothly under 15 RPM
    if (i + parallelChunkWorkers < chunks.length) {
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }

  return allResults;
}


async function withRetry<T>(operation: () => Promise<T>, maxRetries = 6, baseDelay = 1000): Promise<T> {
  let attempt = 0;
  let keysTriedInRound = 0;

  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error: any) {
      const errMsg = (error?.message || '').toLowerCase();
      const isRateLimit =
        error?.status === 429 ||
        errMsg.includes('429') ||
        errMsg.includes('resource_exhausted') ||
        errMsg.includes('quota') ||
        error?.status === 503;

      if (isRateLimit) {
        const currentKeys = parseApiKeys();
        const currentKey = currentKeys[activeKeyIndex];

        // ONLY mark key as PERMANENTLY exhausted if the error explicitly states daily quota limit
        const isDailyQuotaExhausted =
          errMsg.includes('daily') ||
          errMsg.includes('per-day') ||
          errMsg.includes('quotaexceeded');

        if (isDailyQuotaExhausted && currentKey) {
          markKeyAsExhausted(currentKey);
        }

        const rotated = rotateToNextApiKey();
        if (rotated) {
          keysTriedInRound++;
          const keys = parseApiKeys();
          if (keysTriedInRound < keys.length) {
            console.info(`[API Key Manager] RPM Rate Limit hit on Key. Rotated to Key #${activeKeyIndex + 1}...`);
            await new Promise(resolve => setTimeout(resolve, 300));
            continue;
          }
        }

        attempt++;
        keysTriedInRound = 0;
        if (attempt >= maxRetries) throw error;

        const delay = baseDelay * Math.pow(2, Math.min(attempt - 1, 3));
        console.warn(`[API Key Rate Limit] Waiting ${delay}ms before retrying (Attempt ${attempt} of ${maxRetries})...`);
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

export async function updateTitleMemoryCumulative(
  chapterName: string,
  scripts: string[],
  existingLore: string = '',
  existingSummary: string = '',
  language: string = 'English'
): Promise<{ characterLore: string; storySummary: string; chapterSummary: string }> {
  if (!scripts.length) {
    return { characterLore: existingLore, storySummary: existingSummary, chapterSummary: '' };
  }

  const prompt = `
    You are an AI Comic Continuity Manager and Lore Master.
    Analyze the narration scripts from the newly processed comic chapter "${chapterName}":

    ${scripts.map((s, i) => `Panel ${i + 1}: ${s}`).join('\n')}

    EXISTING TITLE CHARACTER ENCYCLOPEDIA / LORE:
    ${existingLore ? existingLore : 'None yet.'}

    EXISTING CUMULATIVE STORY SUMMARY (Chapters prior to ${chapterName}):
    ${existingSummary ? existingSummary : 'None yet.'}

    YOUR TASKS:
    1. Write a concise 2-4 sentence 'chapterSummary' summarizing key plot events in "${chapterName}".
    2. Update 'characterLore': Maintain a clean bulleted character encyclopedia. Add any newly introduced characters (names, physical appearance, roles, abilities, clothing/hair) or update existing character profiles with new developments from "${chapterName}". Keep existing character details intact.
    3. Update 'storySummary': Synthesize a clean cumulative story timeline summarizing major story arcs and events up to "${chapterName}".

    Write all output in ${language}.
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
            chapterSummary: { type: Type.STRING },
            characterLore: { type: Type.STRING },
            storySummary: { type: Type.STRING }
          },
          required: ["chapterSummary", "characterLore", "storySummary"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI for memory update.");

    try {
      return JSON.parse(text) as { chapterSummary: string; characterLore: string; storySummary: string };
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
  if (!base64 || typeof base64 !== 'string') return Promise.resolve('');
  // Fast path for small images
  if (base64.length < 50000) return Promise.resolve(base64);

  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = (val: string) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };

    // 2.5 second timeout safeguard: If image loading or canvas hangs, resolve with original image source instantly!
    const timer = setTimeout(() => {
      console.warn("downscaleForAI timed out after 2500ms, proceeding with original image.");
      safeResolve(base64);
    }, 2500);

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        clearTimeout(timer);
        try {
          let { width, height } = img;
          
          // Preserve aspect ratio but cap width to not exceed maxWidth
          if (width > maxWidth) {
            height = (height / width) * maxWidth;
            width = maxWidth;
          }
          
          // Cap height to not exceed maxHeight
          if (height > maxHeight) {
            width = (width / height) * maxHeight;
            height = maxHeight;
          }
          
          width = Math.max(1, Math.floor(width));
          height = Math.max(1, Math.floor(height));

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(img, 0, 0, width, height);
          safeResolve(canvas.toDataURL('image/jpeg', 0.8));
        } catch (e) {
          safeResolve(base64);
        }
      };
      img.onerror = (err) => {
        clearTimeout(timer);
        console.warn("Failed to load image in downscaleForAI, returning original source:", err);
        safeResolve(base64);
      };
      img.src = base64;
    } catch (e) {
      clearTimeout(timer);
      safeResolve(base64);
    }
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
