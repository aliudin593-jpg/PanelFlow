import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function test() {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ parts: [{ text: "Hello world" }] }],
    config: {
      responseModalities: ["AUDIO"],
    }
  });
  const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  console.log("MimeType:", inlineData?.mimeType);
  console.log("Data length:", inlineData?.data?.length);
}
test().catch(console.error);
