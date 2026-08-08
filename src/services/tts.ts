const getLangCode = (lang: string): string => {
  const l = lang.toLowerCase();
  if (l.includes('indonesia')) return 'id';
  if (l.includes('japan')) return 'ja';
  if (l.includes('korean') || l.includes('korea')) return 'ko';
  if (l.includes('spanish')) return 'es';
  if (l.includes('chinese')) return 'zh';
  return 'en';
};

function getSoundOfTextVoice(langCode: string): string {
  switch (langCode) {
    case 'id': return 'id-ID';
    case 'ja': return 'ja-JP';
    case 'ko': return 'ko-KR';
    case 'es': return 'es-ES';
    case 'zh': return 'zh-CN';
    default: return 'en-US';
  }
}

function splitTextIntoChunks(text: string, maxLength: number = 170): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const word of words) {
    if ((currentChunk + ' ' + word).trim().length <= maxLength) {
      currentChunk = (currentChunk + ' ' + word).trim();
    } else {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = word;
    }
  }
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  return chunks;
}

/** Validates that binary response bytes represent actual audio and not an HTML/JSON error page. */
function isValidAudioBuffer(bytes: Uint8Array, contentTypeHeader?: string | null): boolean {
  if (!bytes || bytes.length < 300) return false;
  if (contentTypeHeader) {
    const ct = contentTypeHeader.toLowerCase();
    if (ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/plain')) {
      return false;
    }
  }
  const headerStr = String.fromCharCode(...bytes.slice(0, 50)).toLowerCase();
  if (
    headerStr.includes('<!doc') ||
    headerStr.includes('<html') ||
    headerStr.startsWith('{') ||
    headerStr.includes('error') ||
    headerStr.includes('access denied') ||
    headerStr.includes('cloudflare')
  ) {
    return false;
  }
  return true;
}

async function fetchSoundOfText(text: string, langCode: string): Promise<Uint8Array | null> {
  try {
    const voice = getSoundOfTextVoice(langCode);
    const res = await fetch("https://api.soundoftext.com/sounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine: "Google", data: { text, voice } })
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.success && json.id) {
      const soundUrl = `https://files.soundoftext.com/${json.id}.mp3`;
      const audioRes = await fetch(soundUrl);
      if (audioRes.ok) {
        const buffer = await audioRes.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        if (isValidAudioBuffer(bytes, audioRes.headers.get('content-type'))) {
          return bytes;
        }
      }
    }
  } catch (e) {
    console.warn("[TTS] SoundOfText fetch failed, trying proxy failovers...", e);
  }
  return null;
}

export async function generateFreeSpeech(text: string, language: string = 'English'): Promise<string> {
  const langCode = getLangCode(language);
  const cleanText = text.trim();
  if (!cleanText) return '';

  const chunks = splitTextIntoChunks(cleanText, 170);
  const audioChunks: Uint8Array[] = [];

  for (const chunk of chunks) {
    let chunkBytes: Uint8Array | null = null;

    // 1. Try SoundOfText official free Google TTS endpoint first (most reliable, 100% CORS enabled)
    chunkBytes = await fetchSoundOfText(chunk, langCode);

    if (!chunkBytes) {
      // 2. Try proxy failovers
      const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${langCode}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
      const googleTtsGtxUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${langCode}&client=gtx&q=${encodeURIComponent(chunk)}`;
      
      const proxies = [
        { name: 'allorigins', fn: (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
        { name: 'corsproxy.io', fn: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}` },
        { name: 'codetabs', fn: (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}` },
        { name: 'corsproxy.org', fn: (url: string) => `https://corsproxy.org/?${encodeURIComponent(url)}` }
      ];

      for (const proxy of proxies) {
        try {
          const proxyUrl = proxy.fn(googleTtsUrl);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 9000);

          const res = await fetch(proxyUrl, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (res.ok) {
            const contentType = res.headers.get('content-type');
            const arrayBuffer = await res.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);

            if (isValidAudioBuffer(bytes, contentType)) {
              chunkBytes = bytes;
              break;
            }
          }
        } catch (e: any) {
          console.warn(`TTS proxy ${proxy.name} fetch failed:`, e);
        }
      }
    }

    if (!chunkBytes) {
      throw new Error("Semua server proxy & TTS gratis gagal memproses suara. Coba lagi dalam beberapa saat.");
    }

    audioChunks.push(chunkBytes);

    if (chunks.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  // Concatenate all binary MP3 chunks together
  const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const mergedBytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of audioChunks) {
    mergedBytes.set(chunk, offset);
    offset += chunk.length;
  }

  // Convert ArrayBuffer to Base64
  let binary = '';
  const len = mergedBytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(mergedBytes.slice(i, i + chunkSize)));
  }
  return btoa(binary);
}
