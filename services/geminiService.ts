import { GoogleGenAI } from "@google/genai";
import { GeneratedImageResponse } from '../types';

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is not configured");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Generates an image using Gemini 2.5 Flash Image model.
 * Ideal for creating sample portraits or textures to liquify.
 */
export const generateSampleImage = async (prompt: string): Promise<GeneratedImageResponse> => {
  const ai = getAiClient();
  
  // Using gemini-2.5-flash-image as recommended for general image generation
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          text: prompt,
        },
      ],
    },
    config: {
      imageConfig: {
        aspectRatio: "1:1",
        // 'imageSize' is not strictly required for flash-image but good practice to check docs if specific size needed.
        // Default is usually 1024x1024.
      }
    },
  });

  // Extract image from response
  let imageUrl = '';
  
  // The SDK might return candidates. We iterate to find the inline data.
  const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  
  if (part && part.inlineData && part.inlineData.data) {
    imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
  } else {
    throw new Error("No image data returned from Gemini.");
  }

  return { imageUrl };
};
