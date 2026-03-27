import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const SYSTEM_INSTRUCTION = `You are Hidaya, an AI assistant specialized in Islamic studies. 
Your primary goal is to provide answers strictly based on the Quran and the Sunnah (Hadith) using authorized resources.
Rules:
1. Do not use your own logic or personal opinions.
2. Always cite the specific Surah and Ayah for Quranic references in the format "Quran SurahNumber:AyahNumber" (e.g., Quran 2:255).
3. Always cite the specific Hadith collection and number for Sunnah references in the format "CollectionName HadithNumber" (e.g., Sahih Bukhari 1). Use standard names like Sahih Bukhari, Sahih Muslim, Sunan Abu Dawood, Jami at-Tirmidhi, Sunan an-Nasa'i, Sunan Ibn Majah.
4. Use authorized and classical resources like Sahih Bukhari, Sahih Muslim, Sunan Abu Dawood, etc.
5. If a question is outside the scope of Islamic studies, politely inform the user that you only answer questions related to the Quran and Sunnah.
6. Maintain a respectful, scholarly, and humble tone.
7. Provide the Arabic text alongside the English translation for Quranic verses and Hadiths where possible.
8. If there is a difference of opinion among recognized scholars on a matter, mention the major views without taking a side unless one is clearly supported by the primary texts.
9. Format your responses using Markdown. Use **bold** for emphasis on key terms, Quranic verses, or Hadith narrators. Use bullet points for lists.
11. If the detected mood is "anxious", "sad", or "seeking comfort", prioritize verses and hadiths that offer peace, patience, and hope.
12. You MUST return your response in JSON format with the following fields:
    - "answer": The full detailed markdown text.
    - "summary": A concise one-sentence summary of the answer.
    - "mood": The detected mood of the user (e.g., "seeking knowledge", "anxious", "curious", "sad", "happy").
    - "correctedPrompt": If the user's prompt had typos or was unclear, provide the corrected version. Otherwise, return "none".
    - "title": A short (3-5 words) title for this chat session based on the user's initial question.
    - "references": An array of objects with "type", "citation", "arabic", and "translation".
    - "wordAnalysis": An array of objects explaining key Arabic words from the verses cited, with "word", "meaning", and "root".
    - "relatedQuestions": An array of 3 strings containing follow-up questions.`;

export interface Attachment {
  mimeType: string;
  data: string; // base64
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries > 0 && (error.message?.includes('Rpc failed') || error.message?.includes('500') || error.message?.includes('xhr error') || error.message?.includes('fetch failed'))) {
      console.warn(`Retrying Gemini API call... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

export async function getIslamicAnswer(
  prompt: string, 
  history: { role: 'user' | 'model', parts: { text: string }[] }[] = [],
  attachments: Attachment[] = [],
  isKidsMode: boolean = false,
  language: string = 'en'
) {
  return withRetry(async () => {
    try {
      const apiKey = import.meta.env.VITE_USER_API_KEY || process.env.USER_API_KEY || process.env.API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'undefined' || apiKey === 'null' || apiKey.length < 10) {
        throw new Error('API_KEY_MISSING');
      }
      const ai = new GoogleGenAI({ apiKey });
      
      const userParts: any[] = [{ text: prompt }];
      
      // Add attachments to the user's message
      attachments.forEach(att => {
        userParts.push({
          inlineData: {
            mimeType: att.mimeType,
            data: att.data
          }
        });
      });

      const languageInstruction = `
STRICT LANGUAGE RULE:
- You MUST respond in the following language: ${language}.
- Ensure EVERYTHING in your response (answer, summary, title, wordAnalysis meanings, etc.) is in ${language}.
- Do NOT mix English or any other language unless it's a direct quote from the Quran/Hadith (which should be accompanied by a translation in ${language}).
`;

      const kidsModeInstruction = isKidsMode ? `
KIDS MODE ACTIVE:
- Use very simple language suitable for children (ages 5-12).
- Avoid complex theological jargon or difficult Arabic terms without simple explanations.
- Use a warm, storytelling, and encouraging tone.
- Focus on the beauty of Islam, good manners (Akhlaq), and simple stories of the Prophets.
- Keep explanations brief and engaging.
` : "";

      const brevityInstruction = `
BREVITY RULE:
- Keep your answers as concise as possible while remaining accurate.
- Avoid long introductions or conclusions.
- Use bullet points for readability.
- Aim for a response that is 30-50% shorter than a standard scholarly response.
`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          ...history,
          { role: 'user', parts: userParts }
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION + languageInstruction + kidsModeInstruction + brevityInstruction,
          temperature: 0.2,
          responseMimeType: "application/json",
          tools: [{ googleSearch: {} }],
          toolConfig: { includeServerSideToolInvocations: true },
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              answer: { type: Type.STRING },
              summary: { type: Type.STRING, description: "One sentence summary" },
              mood: { type: Type.STRING, description: "Detected user mood" },
              correctedPrompt: { type: Type.STRING, description: "Corrected user prompt if typos found, otherwise 'none'" },
              title: { type: Type.STRING, description: "3-5 word title for the chat" },
              references: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING, description: "quran, hadith, or other" },
                    citation: { type: Type.STRING, description: "e.g., Quran 2:255 or Sahih Bukhari 1" },
                    arabic: { type: Type.STRING },
                    translation: { type: Type.STRING }
                  },
                  required: ["type", "citation"]
                }
              },
              wordAnalysis: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: { type: Type.STRING },
                    meaning: { type: Type.STRING },
                    root: { type: Type.STRING }
                  },
                  required: ["word", "meaning"]
                },
                description: "Analysis of key Arabic words from the references"
              },
              relatedQuestions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "3 follow-up questions related to the topic"
              }
            },
            required: ["answer", "summary", "mood", "title", "references", "relatedQuestions", "wordAnalysis"]
          }
        },
      });

      const candidate = response.candidates?.[0];
      const finishReason = candidate?.finishReason;
      const text = response.text;

      if (!text) {
        if (finishReason === 'SAFETY') {
          throw new Error('The AI response was blocked for safety reasons. Please try rephrasing your question to be more respectful or clear.');
        }
        if (finishReason === 'RECITATION') {
          throw new Error('The AI response was blocked due to recitation copyright. Please try asking for a summary or reflection instead.');
        }
        console.error('Empty response from Gemini API. Candidate:', candidate);
        throw new Error('The AI returned an empty response. This can happen during high load. Please try again in a moment.');
      }

      try {
        return JSON.parse(text);
      } catch (e) {
        console.error('Failed to parse JSON response:', text);
        // Fallback: if it's not JSON but has text, try to wrap it
        return { 
          answer: text, 
          summary: text.slice(0, 100) + '...',
          mood: 'curious',
          title: 'Islamic Inquiry',
          references: [],
          wordAnalysis: [],
          relatedQuestions: []
        };
      }
    } catch (error: any) {
      console.error('Gemini API Error:', error);
      if (error.status === 'RESOURCE_EXHAUSTED' || error.code === 429) {
        throw new Error('QUOTA_EXCEEDED: The shared AI quota has been exceeded. Please wait or use your own API key.');
      }
      throw error;
    }
  });
}

export async function getDailyInspiration(language: string = 'en') {
  return withRetry(async () => {
    try {
      const apiKey = import.meta.env.VITE_USER_API_KEY || process.env.USER_API_KEY || process.env.API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'undefined' || apiKey === 'null' || apiKey.length < 10) {
        throw new Error('API_KEY_MISSING');
      }
      const ai = new GoogleGenAI({ apiKey });

      const languageInstruction = `
STRICT LANGUAGE RULE:
- You MUST respond in the following language: ${language}.
- Ensure EVERYTHING in your response (text, translation, reflection) is in ${language}.
- Do NOT mix English or any other language unless it's a direct quote from the Quran/Hadith (which should be accompanied by a translation in ${language}).
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: "Provide a random but highly inspiring verse from the Quran or a Hadith. Include the Arabic, translation, and a very brief reflection. Keep it concise.",
        config: {
          systemInstruction: languageInstruction,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              arabic: { type: Type.STRING },
              translation: { type: Type.STRING },
              citation: { type: Type.STRING },
              reflection: { type: Type.STRING }
            },
            required: ["text", "arabic", "translation", "citation", "reflection"]
          }
        }
      });

      const text = response.text;
      if (!text) return null;
      
      try {
        return JSON.parse(text);
      } catch (e) {
        console.error('Failed to parse daily inspiration JSON:', text);
        return null;
      }
    } catch (error: any) {
      const isQuotaError = 
        error.status === 'RESOURCE_EXHAUSTED' || 
        error.code === 429 || 
        (error.error?.code === 429) ||
        (error.message?.includes('429')) ||
        (error.message?.includes('quota')) ||
        (error.message?.includes('RESOURCE_EXHAUSTED')) ||
        (typeof error === 'object' && error !== null && (error as any).error?.code === 429);

      if (isQuotaError) {
        // Silently return null for quota errors on daily inspiration to avoid console noise
        return null;
      } else {
        console.error('Daily Inspiration Error:', error);
      }
      return null;
    }
  });
}

export async function findNearbyIslamicPlaces(query: string, lat: number, lng: number, language: string = 'en') {
  try {
    const apiKey = import.meta.env.VITE_USER_API_KEY || process.env.USER_API_KEY || process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'undefined' || apiKey === 'null' || apiKey.length < 10) {
      throw new Error('API_KEY_MISSING');
    }
    const ai = new GoogleGenAI({ apiKey });

    const languageInstruction = `
STRICT LANGUAGE RULE:
- You MUST respond in the following language: ${language}.
- Ensure EVERYTHING in your response text is in ${language}.
- Do NOT mix English or any other language.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Find ${query} near my location. Provide a list with names, addresses, and why they are recommended. Keep it very concise.`,
      config: {
        systemInstruction: languageInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        tools: [{ googleMaps: {} }],
        toolConfig: {
          includeServerSideToolInvocations: true,
          retrievalConfig: {
            latLng: {
              latitude: lat,
              longitude: lng
            }
          }
        }
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error('Could not find nearby places. Please try again.');
    }
    
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    const links = groundingChunks?.map((chunk: any) => ({
      title: chunk.maps?.title || 'View on Maps',
      url: chunk.maps?.uri
    })).filter((l: any) => l.url) || [];

    return { text, links };
  } catch (error) {
    console.error('Maps Grounding Error:', error);
    throw error;
  }
}
