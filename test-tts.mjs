import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";

const rawKey = process.env.GEMINI_API_KEY || "";
const firstKey = rawKey.split(/[\n,;]+/)[0]?.trim();
console.log("Using API key:", firstKey ? firstKey.substring(0, 8) + "..." : "NONE");

const ai = new GoogleGenAI({ apiKey: firstKey });
async function test() {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: "Hello world this is a speech test" }] }],
      config: {
        responseModalities: ["AUDIO"],
      }
    });
    const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    console.log("MimeType:", inlineData?.mimeType);
    console.log("Data length:", inlineData?.data?.length);
  } catch (err) {
    console.error("Gemini TTS Error:", err);
  }
}
test();

