const getLangCode = (lang: string): string => {
  const l = lang.toLowerCase();
  if (l.includes('indonesia')) return 'id';
  if (l.includes('japan')) return 'ja';
  if (l.includes('korean') || l.includes('korea')) return 'ko';
  if (l.includes('spanish')) return 'es';
  if (l.includes('chinese')) return 'zh';
  return 'en';
};

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

export async function generateFreeSpeech(text: string, language: string = 'English'): Promise<string> {
  const langCode = getLangCode(language);
  const cleanText = text.trim();
  if (!cleanText) return '';

  // Google Translate TTS is strictly limited to 200 characters.
  // We split text into safe chunks under 170 chars, preserving word boundaries.
  const chunks = splitTextIntoChunks(cleanText, 170);
  const audioChunks: Uint8Array[] = [];

  for (const chunk of chunks) {
    const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${langCode}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
    
    const proxies = [
      { name: 'corsproxy.org', fn: (url: string) => `https://corsproxy.org/?${encodeURIComponent(url)}` },
      { name: 'corsproxy.io', fn: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}` },
      { name: 'allorigins', fn: (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
      { name: 'codetabs', fn: (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}` }
    ];

    let success = false;
    let lastError: any = null;

    for (const proxy of proxies) {
      try {
        const proxyUrl = proxy.fn(googleTtsUrl);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const arrayBuffer = await res.arrayBuffer();
          audioChunks.push(new Uint8Array(arrayBuffer));
          success = true;
          break;
        } else {
          lastError = new Error(`HTTP status ${res.status}`);
        }
      } catch (e: any) {
        console.warn(`TTS proxy ${proxy.name} fetch failed, trying next...`, e);
        lastError = e;
      }
    }

    if (!success) {
      throw new Error("Semua server proxy TTS gratis gagal memproses suara: " + (lastError?.message || "Koneksi terputus"));
    }

    // Add a small delay between chunk fetches to be safe
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
