
export function speak(text: string, voiceId?: string, rate: number = 1.0): Promise<void> {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    
    if (voiceId) {
      const voice = voices.find(v => v.voiceURI === voiceId);
      if (voice) utterance.voice = voice;
    }
    
    utterance.rate = rate;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve(); // Resolve anyway to not block
    
    window.speechSynthesis.speak(utterance);
  });
}

export function getAvailableVoices() {
  return window.speechSynthesis.getVoices();
}
