import { GoogleGenAI, Type } from "@google/genai";
import { toast } from "sonner";

// ============================================================================
// API KEY POOL — per-key state instead of one shared mutable pointer.
//
// Why this changed from the previous version:
// - The old code kept a single `activeKeyIndex` + `exhaustedKeysSet` at module
//   scope and mutated them from inside concurrent async calls (e.g. the 3-way
//   parallel TTS batch in App.tsx). Two requests hitting 429 at nearly the
//   same time could both call rotateToNextApiKey() and stomp on each other's
//   rotation, or double-skip a healthy key.
// - Keeping state PER KEY (rather than a single "current index") means each
//   call just asks "which keys are usable right now?" and picks one. That
//   question is safe to ask concurrently — nothing needs to be swapped out
//   from under an in-flight request.
// ============================================================================

type KeyState = {
  key: string;
  dailyExhausted: boolean;      // true only when the API explicitly confirms a daily/per-day quota failure
  rpmCooldownUntil: number;     // epoch ms; key is skipped until this passes (short-lived, per-minute limit)
};

let customApiKeyInput = "";
let keyStates: Map<string, KeyState> = new Map();
let roundRobinCursor = 0;

export function setCustomGeminiApiKey(key: string) {
  customApiKeyInput = key;
  keyStates = new Map();
  roundRobinCursor = 0;
}

function getRawKeyList(): string[] {
  const envRaw = (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : '') || "";
  const rawInput = customApiKeyInput || envRaw;
  if (!rawInput.trim()) return [];
  return rawInput
    .split(/[\n,;]+/)
    .map(k => k.trim())
    .filter(k => k.length >= 15);
}

function ensureKeyStates(): KeyState[] {
  const raw = getRawKeyList();
  // Sync keyStates map with the current raw key list (handles keys being added/edited live)
  const currentKeys = new Set(raw);
  for (const existingKey of keyStates.keys()) {
    if (!currentKeys.has(existingKey)) keyStates.delete(existingKey);
  }
  for (const k of raw) {
    if (!keyStates.has(k)) {
      keyStates.set(k, { key: k, dailyExhausted: false, rpmCooldownUntil: 0 });
    }
  }
  return raw.map(k => keyStates.get(k)!);
}

/** Keys that are neither daily-exhausted nor currently in an RPM cooldown window. */
function getAvailableKeyStates(): KeyState[] {
  const now = Date.now();
  const all = ensureKeyStates();
  return all.filter(s => !s.dailyExhausted && s.rpmCooldownUntil <= now);
}

/**
 * Returns the number of milliseconds until the soonest cooldown key becomes
 * available again.  Returns 0 if at least one key is already free.
 * Returns Infinity if every key is daily-exhausted (no recovery possible).
 */
function msUntilNextKeyAvailable(): number {
  const now = Date.now();
  const all = ensureKeyStates();
  const nonExhausted = all.filter(s => !s.dailyExhausted);
  if (nonExhausted.length === 0) return Infinity;

  // If any key is already free, wait time is 0
  if (nonExhausted.some(s => s.rpmCooldownUntil <= now)) return 0;

  // Find the key whose cooldown expires soonest
  const earliest = Math.min(...nonExhausted.map(s => s.rpmCooldownUntil));
  return Math.max(0, earliest - now);
}

export function markKeyAsExhausted(key: string) {
  const state = keyStates.get(key);
  if (state) {
    state.dailyExhausted = true;
    console.warn(`[API Key Manager] Key ${key.substring(0, 6)}... marked EXHAUSTED (daily quota) for this session.`);
  }
}

function putKeyInCooldown(key: string, cooldownMs: number) {
  const state = keyStates.get(key);
  if (state) {
    state.rpmCooldownUntil = Date.now() + cooldownMs;
  }
}

export function parseApiKeys(): string[] {
  return getRawKeyList();
}

export function getKeyPoolStats() {
  const all = ensureKeyStates();
  const available = getAvailableKeyStates();
  const currentKey = available[0]?.key || all[0]?.key || "";
  const maskedKey = currentKey
    ? `${currentKey.substring(0, 6)}...${currentKey.substring(Math.max(0, currentKey.length - 4))}`
    : "None";
  return {
    totalKeys: all.length,
    activeKeyIndex: all.length > 0 ? all.findIndex(s => s.key === currentKey) + 1 : 0,
    availableKeys: available.length,
    maskedKey,
    hasMultipleKeys: all.length > 1
  };
}

/** Picks the next usable key in round-robin order among currently-available keys. */
function pickNextKey(): string | null {
  const available = getAvailableKeyStates();
  if (available.length === 0) return null;
  roundRobinCursor = (roundRobinCursor + 1) % available.length;
  return available[roundRobinCursor % available.length].key;
}

function getGenAI(forceKey?: string) {
  const key = forceKey ?? pickNextKey() ?? "";
  return { client: new GoogleGenAI({ apiKey: key }), key };
}

// ============================================================================
// ERROR CLASSIFICATION
//
// Gemini uses HTTP 429 / RESOURCE_EXHAUSTED for BOTH per-minute (RPM) and
// per-day (RPD) limits. Relying only on message-string matching is fragile —
// Google can change wording, and the generic "You exceeded your current
// quota, please check your plan and billing details" message (which is very
// common) contains neither "daily" nor "per-day".
//
// Prefer structured error details when available: Gemini/Google API errors
// typically carry `error.details` (an array) with an entry of type
// `type.googleapis.com/google.rpc.QuotaFailure`, whose `violations[].quotaId`
// names the specific limit, e.g. "GenerateRequestsPerDayPerProjectPerModel"
// vs "GenerateRequestsPerMinutePerProjectPerModel". If that's present we
// trust it over any text heuristic.
// ============================================================================

export type QuotaClassification = 'daily' | 'per-minute' | 'unknown-rate-limit' | 'not-rate-limit';

export function classifyError(error: any): { classification: QuotaClassification; retryAfterMs: number | null } {
  const status = error?.status ?? error?.code;
  const httpStatus = error?.response?.status ?? error?.status;
  const errMsg = String(error?.message || '').toLowerCase();

  const isRateLimitStatus =
    status === 429 || httpStatus === 429 ||
    errMsg.includes('429') ||
    errMsg.includes('resource_exhausted') ||
    status === 503 || httpStatus === 503;

  // 1. Try structured details first (most reliable)
  const details: any[] =
    error?.details ||
    error?.error?.details ||
    error?.response?.data?.error?.details ||
    [];

  let retryAfterMs: number | null = null;
  let classification: QuotaClassification = isRateLimitStatus ? 'unknown-rate-limit' : 'not-rate-limit';

  if (Array.isArray(details)) {
    for (const d of details) {
      const type = String(d?.['@type'] || '');
      if (type.includes('QuotaFailure')) {
        const violations = d?.violations || [];
        for (const v of violations) {
          const quotaId = String(v?.quotaId || v?.quota_metric || '').toLowerCase();
          if (quotaId.includes('perday') || quotaId.includes('per_day') || quotaId.includes('daily')) {
            classification = 'daily';
          } else if (quotaId.includes('perminute') || quotaId.includes('per_minute')) {
            classification = classification === 'daily' ? classification : 'per-minute';
          }
        }
      }
      if (type.includes('RetryInfo')) {
        const delayStr = String(d?.retryDelay || ''); // e.g. "23s"
        const match = delayStr.match(/(\d+(\.\d+)?)s/);
        if (match) retryAfterMs = Math.round(parseFloat(match[1]) * 1000);
      }
    }
  }

  // 2. Respect an explicit Retry-After header if the SDK surfaces one
  const retryAfterHeader = error?.response?.headers?.['retry-after'] ?? error?.headers?.['retry-after'];
  if (retryAfterMs === null && retryAfterHeader) {
    const asSeconds = parseInt(String(retryAfterHeader), 10);
    if (!isNaN(asSeconds)) retryAfterMs = asSeconds * 1000;
  }

  // 3. Fall back to string heuristics ONLY if structured details didn't resolve it
  if (classification === 'unknown-rate-limit') {
    const dailyPatterns = ['daily', 'per-day', 'per day', 'quotaexceeded', 'requests per day'];
    const minutePatterns = ['per minute', 'per-minute', 'rpm', 'requests per minute'];
    if (dailyPatterns.some(p => errMsg.includes(p))) {
      classification = 'daily';
    } else if (minutePatterns.some(p => errMsg.includes(p))) {
      classification = 'per-minute';
    }
    // If we truly can't tell, treat as per-minute (safer default: don't
    // permanently kill a key on ambiguous evidence — worst case it just
    // gets retried after a cooldown instead of being nuked for the session).
    else if (isRateLimitStatus) {
      classification = 'per-minute';
    }
  }

  return { classification, retryAfterMs };
}

export function fastCompressForAI(
  imageUrl: string,
  maxDim: number = 360
): Promise<{ data: string; mimeType: string }> {
  if (!imageUrl || typeof imageUrl !== 'string') {
    return Promise.resolve({ data: '', mimeType: 'image/jpeg' });
  }

  return new Promise((resolve) => {
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

  return withRetry(async (client) => {
    const response = await (client.models.generateContent as any)({
      model: "gemini-2.5-flash",
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
  const { totalKeys: numKeys } = getKeyPoolStats();
  const parallelChunkWorkers = Math.max(1, Math.min(Math.floor(numKeys / 2), 3));

  for (let i = 0; i < chunks.length; i += parallelChunkWorkers) {
    if (signal?.aborted) break;
    const currentChunkBatch = chunks.slice(i, i + parallelChunkWorkers);

    const batchResults = await Promise.all(
      currentChunkBatch.map(async (chunk) => {
        if (signal?.aborted) return [];

        const compressedChunk = await Promise.all(
          chunk.map(async (p) => {
            const compressed = await fastCompressForAI(p.imageUrl, 360);
            return { ...p, ...compressed };
          })
        );

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

          parts.push({
            text: `Panel ID: ${p.id}\nIndex: ${idx + 1}\nRequired Length: ${lengthInstr}${
              p.context ? `\nContext: ${p.context}` : ''
            }`,
          });
          parts.push({ inlineData: { mimeType: p.mimeType, data: p.data } });
        });

        let chunkScripts: { id: string; script: string }[] = [];

        try {
          await withRetry(
            async (client) => {
              const response = await (client.models.generateContent as any)(
                {
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
                          script: { type: Type.STRING },
                        },
                        required: ["id", "script"],
                      },
                    },
                  },
                },
                { signal }
              );

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
                    let match = parsed.find(
                      (item) => item && (item.id === p.id || item.id === `panel_${idx + 1}` || item.id === `${idx + 1}`)
                    );
                    if (!match && parsed[idx]) match = parsed[idx];
                    const scriptText = typeof match === 'string' ? match : (match?.script || match?.text || '');
                    if (scriptText && scriptText.trim()) {
                      chunkScripts.push({ id: p.id, script: scriptText.trim() });
                    }
                  });
                }
              }
            }
          );
        } catch (err) {
          console.warn(
            "[Turbo Engine] Batch JSON chunk failed, falling back to sequential single-panel workers for this chunk:",
            err
          );
        }

        // Sequential fallback for any panels the batch call missed — throttled to avoid an RPM spike.
        const scoredIds = new Set(chunkScripts.map((s) => s.id));
        const missingPanels = chunk.filter((p) => !scoredIds.has(p.id));

        if (missingPanels.length > 0 && !signal?.aborted) {
          for (const p of missingPanels) {
            if (signal?.aborted) break;
            try {
              const s = await generateSinglePanelScript(
                p,
                language,
                globalContext,
                globalScriptLength,
                signal
              );
              if (s) chunkScripts.push({ id: p.id, script: s });
            } catch (e) {
              console.error("Single panel fallback error:", e);
            }
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }

        return chunkScripts;
      })
    );

    const flatResults = batchResults.flat();
    allResults.push(...flatResults);
    if (onProgress && flatResults.length > 0) {
      onProgress(flatResults);
    }

    if (i + parallelChunkWorkers < chunks.length) {
      const interChunkDelay = numKeys >= 5 ? 800 : numKeys >= 3 ? 1200 : 2000;
      await new Promise((resolve) => setTimeout(resolve, interChunkDelay));
    }
  }

  return allResults;
}

// ============================================================================
// RETRY / ROTATION CORE
//
// Key behavior differences from the previous version:
// - `operation` now receives the GoogleGenAI client to use, and we pass along
//   which key produced it, so a 429 can be attributed to the RIGHT key even
//   under concurrency (no shared "currentKey" variable being read after
//   another call already rotated it).
// - Daily-quota errors mark that specific key exhausted for the session.
// - Per-minute errors put ONLY that key in a short cooldown (default 60s,
//   or whatever the API's RetryInfo/Retry-After told us) and immediately
//   try a different available key — no waiting required unless every key
//   is cooling down.
// - Retries scale with pool size: with N keys, we allow at least N rotation
//   attempts before falling back to a real timed backoff.
// ============================================================================

const DEFAULT_RPM_COOLDOWN_MS = 62_000; // slightly over 60s to avoid edge-case re-hits

// Maximum total time we'll wait across all attempts for all-keys-cooldown situations (10 min).
const MAX_TOTAL_WAIT_MS = 10 * 60 * 1000;

async function withRetry<T>(
  operation: (client: GoogleGenAI, key: string) => Promise<T>,
  maxTimedRetries = 8,
  baseDelay = 1000
): Promise<T> {
  let timedAttempt = 0;
  let totalWaitedMs = 0;

  while (true) {
    // ── Key selection ────────────────────────────────────────────────────────
    // If no key is immediately free, wait until the earliest cooldown expires
    // BEFORE picking a key — this prevents hammering keys that are still cooling.
    let waitNeeded = msUntilNextKeyAvailable();
    if (waitNeeded === Infinity) {
      throw new Error("Semua API Key telah mencapai kuota harian. Coba lagi besok atau tambahkan key baru di Settings.");
    }
    if (waitNeeded > 0) {
      if (totalWaitedMs + waitNeeded > MAX_TOTAL_WAIT_MS) {
        throw new Error(`Timeout menunggu API Key tersedia setelah ${Math.round(totalWaitedMs / 1000)}s. Tambahkan lebih banyak API Key di Settings.`);
      }
      const waitSec = Math.ceil(waitNeeded / 1000);
      console.warn(`[API Key Manager] All keys in RPM cooldown. Waiting ${waitSec}s for earliest key to recover...`);
      toast.info(`Semua API Key sedang cooldown. Menunggu ${waitSec}s...`, { id: 'all-keys-cooldown', duration: waitNeeded + 2000 });
      await new Promise(resolve => setTimeout(resolve, waitNeeded + 200)); // +200ms buffer
      totalWaitedMs += waitNeeded + 200;
    }

    const available = getAvailableKeyStates();
    if (available.length === 0) {
      // Edge case: re-check after the wait (should not normally happen)
      continue;
    }

    const { client, key } = getGenAI();
    if (!key) {
      throw new Error("Tidak ada Gemini API Key yang tersedia. Silakan periksa Settings.");
    }

    // ── Execute ──────────────────────────────────────────────────────────────
    try {
      return await operation(client, key);
    } catch (error: any) {
      const { classification, retryAfterMs } = classifyError(error);

      if (classification === 'not-rate-limit') {
        throw error;
      }

      if (classification === 'daily') {
        markKeyAsExhausted(key);
        const remaining = getAvailableKeyStates().length;
        toast.warning(
          `Kuota harian habis untuk key ${key.substring(0, 6)}....${remaining > 0 ? ` Masih ada ${remaining} key aktif.` : ' Semua key habis!'}`,
          { id: 'daily-quota-hit' }
        );
      } else {
        // per-minute or unknown-rate-limit: put THIS key in cooldown
        const cooldown = retryAfterMs ?? DEFAULT_RPM_COOLDOWN_MS;
        putKeyInCooldown(key, cooldown);
        console.info(`[API Key Manager] per-minute limit on key ${key.substring(0, 6)}..., switching to another key.`);
      }

      // Check if another key is immediately free — if so, rotate without delay
      const anyFreeNow = getAvailableKeyStates().length > 0;
      if (anyFreeNow) {
        continue; // pick a different key on next loop iteration
      }

      // All keys are now cooling down — the top of the loop will handle waiting
      timedAttempt++;
      if (timedAttempt > maxTimedRetries) {
        throw new Error(`API rate limit: ${maxTimedRetries} key-rotation cycles exhausted. Kurangi jumlah panel yang diproses bersamaan atau tambah API Key.`);
      }
      // Don't sleep here — let the top-of-loop wait logic handle timing precisely
    }
  }
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

  return withRetry(async (client) => {
    const response = await client.models.generateContent({
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

  return withRetry(async (client) => {
    const response = await client.models.generateContent({
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
  return withRetry(async (client) => {
    const response = await client.models.generateContent({
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
  });
}

export function downscaleForAI(base64: string, maxWidth: number = 1024, maxHeight: number = 3072): Promise<string> {
  if (!base64 || typeof base64 !== 'string') return Promise.resolve('');
  if (base64.length < 50000) return Promise.resolve(base64);

  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = (val: string) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };

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

          if (width > maxWidth) {
            height = (height / width) * maxWidth;
            width = maxWidth;
          }

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

  return withRetry(async (client) => {
    const response = await client.models.generateContent({
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
  });
}
