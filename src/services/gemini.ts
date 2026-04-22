
import { GoogleGenAI, Type } from "@google/genai";

let customApiKey = "";

export function setCustomGeminiApiKey(key: string) {
  customApiKey = key;
}

function getGenAI() {
  return new GoogleGenAI({ apiKey: customApiKey || process.env.GEMINI_API_KEY || "" });
}

export async function generatePanelScripts(
  panels: { id: string; imageUrl: string; dialogue?: string; context?: string; scriptLength?: string }[], 
  language: string = 'English',
  globalContext: string = '',
  globalScriptLength: string = 'Normal'
) {
  if (!panels.length) return [];

  // Process panels in smaller chunks (e.g., 3 panels per request) to avoid XHR payload size limits
  // with high-resolution image data.
  const chunkSize = 3;
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
        const response = await getGenAI().models.generateContent({
          model: "gemini-3-flash-preview",
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
        });

        const text = response.text;
        if (text) {
          try {
            const parsed = JSON.parse(text);
            allResults = allResults.concat(parsed);
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


async function withRetry<T>(operation: () => Promise<T>, maxRetries = 5, baseDelay = 3000): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error: any) {
      if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED') || error?.status === 503) {
        attempt++;
        if (attempt >= maxRetries) throw error;
        // Escalating delay: 3s, 6s, 12s, 24s ...
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.warn(`Rate limit hit. Retrying in ${delay}ms... (Attempt ${attempt} of ${maxRetries})`);
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
        model: "gemini-3.1-flash-tts-preview",
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
    img.src = base64;
  });
}

export async function detectPanels(pageImageUrl: string) {
  // Downscale image before sending to AI to significantly speed up upload time
  // Webtoons are vertical strips, so we cap width at 1024, but allow height up to 6000
  // to ensure human faces aren't squished down to unrecognizable blur blocks.
  const optimizedImage = await downscaleForAI(pageImageUrl, 1024, 6000);

  const prompt = `
    Analyze this comic/webtoon page and identify the bounding boxes of ALL distinct illustrated panels, scenes, or character portraits.
    
    CRITICAL RULES:
    1. Identify every individual comic panel. You MUST locate and outline the art/characters being shown.
    2. Try to exclude large blank gutters or borders.
    3. You must output at least one bounding box. Never return an empty array.
    4. Focus on where the main action, faces, or artwork is.
    
    Return the coordinates as normalized values (0 to 1000) for x, y, width, and height.
    Ensure panels are returned in the correct manga reading order (top-to-bottom, then right-to-left).
    Return a JSON array of objects: { x, y, width, height }.
  `;

  return withRetry(async () => {
    try {
      const response = await getGenAI().models.generateContent({
        model: "gemini-3-flash-preview",
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
