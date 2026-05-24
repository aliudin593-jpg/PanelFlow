const getLangCode = (lang: string): string => {
  const l = lang.toLowerCase();
  if (l.includes('indonesia')) return 'id';
  if (l.includes('japan')) return 'ja';
  if (l.includes('korean') || l.includes('korea')) return 'ko';
  if (l.includes('spanish')) return 'es';
  if (l.includes('chinese')) return 'zh';
  return 'en';
};

export async function generateFreeSpeech(text: string, language: string = 'English'): Promise<string> {
  const langCode = getLangCode(language);
  const cleanText = text.trim();
  if (!cleanText) return '';

  const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${langCode}&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
  
  // We try multiple free public CORS proxies in order to ensure absolute, bulletproof availability.
  const proxies = [
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url: string) => `https://thingproxy.freeboard.io/fetch/${url}`
  ];

  let lastError: any = null;
  for (const proxyFn of proxies) {
    try {
      const proxyUrl = proxyFn(googleTtsUrl);
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        
        // Convert ArrayBuffer to Base64
        let binary = '';
        const bytes = new Uint8Array(arrayBuffer);
        const len = bytes.byteLength;
        const chunkSize = 8192;
        for (let i = 0; i < len; i += chunkSize) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.slice(i, i + chunkSize)));
        }
        return btoa(binary);
      }
    } catch (e: any) {
      console.warn("TTS proxy fetch failed, trying next...", e);
      lastError = e;
    }
  }
  
  throw new Error("Semua server proxy TTS gratis gagal memproses suara: " + (lastError?.message || "Koneksi terputus"));
}
