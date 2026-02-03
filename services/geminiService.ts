
import { GoogleGenAI, Type, Modality, LiveServerMessage } from "@google/genai";
import { RecruitmentAnalysis } from "../types";

const API_KEY = process.env.API_KEY;

export interface GeminiPartBlob {
  data: string;
  mimeType: string;
}

const getLameJS = () => (window as any).lamejs;

export const analyzeRecruitment = async (
  jd: string,
  resume?: string
): Promise<RecruitmentAnalysis> => {
  const ai = new GoogleGenAI({ apiKey: API_KEY! });
  
  const prompt = `
    Role Strategy Analysis for Job Description:
    ${jd}
    
    ${resume ? `Candidate Resume for Analysis:\n${resume}` : "Analyze the requirement for a target candidate benchmark profile."}
    
    MANDATORY OUTPUT STRUCTURE (JSON):
    1. Title: The official Job Title.
    2. Summary: A 2-3 sentence strategic overview of the role.
    3. Priority Requirements: The must-have technical/soft skills.
    4. Essential CV Elements: Specific phrases or experiences that MUST appear on a top-tier CV.
    5. Tech Glossary: Definitions for 5-8 technical terms found in the JD.
    6. Sample Resume: A professional Markdown resume representing the "Gold Standard" for this JD.
    7. Keywords: Primary skills, secondary skills, and a complex Boolean Sourcing String.
    
    ${resume ? `
    8. Candidate Analysis (NESTED OBJECT):
       - overallMatchPercentage: (0-100)
       - matchingStrengths: (Array of strings)
       - criticalGaps: (Array of strings)
       - employmentGaps: (Specific dates/durations of gaps found)
       - shortTermAssignments: (List of stints under 12 months)
       - authenticityScore: (High/Medium/Low/Caution)
       - keywordStuffingAnalysis:
         - riskLevel: (Low/Elevated/High)
         - findings: (Explain if the candidate has unnaturally repetitive keywords or skill lists that aren't supported by their experience summary)
         - detectedArtificialClusters: (List the specific terms that seem stuffed or artificial)
       - recruiterQuestions: (3-5 targeted questions to vet the candidate)
    ` : "If no resume is provided, omit the candidateAnalysis object entirely."}
    
    9. Audio Script: A natural recruitment briefing for the team.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 4000 },
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          jobSummary: { type: Type.STRING },
          priorityRequirements: { type: Type.ARRAY, items: { type: Type.STRING } },
          essentialCvElements: { type: Type.ARRAY, items: { type: Type.STRING } },
          hiringManagerPreferences: { type: Type.ARRAY, items: { type: Type.STRING } },
          submissionTips: { type: Type.ARRAY, items: { type: Type.STRING } },
          targetCompanies: { type: Type.ARRAY, items: { type: Type.STRING } },
          keywords: {
            type: Type.OBJECT,
            properties: {
              primary: { type: Type.ARRAY, items: { type: Type.STRING } },
              secondary: { type: Type.ARRAY, items: { type: Type.STRING } },
              booleanStrings: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["primary", "secondary", "booleanStrings"]
          },
          techGlossary: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                term: { type: Type.STRING },
                explanation: { type: Type.STRING }
              }
            }
          },
          sampleResume: { type: Type.STRING },
          candidateAnalysis: {
            type: Type.OBJECT,
            properties: {
              overallMatchPercentage: { type: Type.NUMBER },
              skillMatchPercentage: { type: Type.NUMBER },
              matchingStrengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              criticalGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
              employmentGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
              shortTermAssignments: { type: Type.ARRAY, items: { type: Type.STRING } },
              authenticityScore: { type: Type.STRING },
              authenticityReasoning: { type: Type.STRING },
              keywordStuffingAnalysis: {
                type: Type.OBJECT,
                properties: {
                  riskLevel: { type: Type.STRING },
                  findings: { type: Type.STRING },
                  detectedArtificialClusters: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["riskLevel", "findings", "detectedArtificialClusters"]
              },
              recruiterQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
            }
          },
          audioScript: { type: Type.STRING },
        },
        required: ["title", "jobSummary", "priorityRequirements", "essentialCvElements", "techGlossary", "sampleResume", "audioScript", "keywords"],
      },
    },
  });

  return JSON.parse(response.text);
};

export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export function createPcmBlob(data: Float32Array): GeminiPartBlob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

export const generateAudio = async (text: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: API_KEY! });
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("Failed to generate audio content.");

  const pcmData = decode(base64Audio);
  const mp3Blob = encodeMp3(pcmData, 1, 24000, 128);
  return URL.createObjectURL(mp3Blob);
};

function encodeMp3(pcmData: Uint8Array, channels: number, sampleRate: number, kbps: number): Blob {
  const lame = getLameJS();
  if (!lame) throw new Error("lamejs library not loaded.");
  const mp3encoder = new lame.Mp3Encoder(channels, sampleRate, kbps);
  const samples = new Int16Array(pcmData.buffer);
  const mp3Data: Uint8Array[] = [];
  const sampleBlockSize = 1152;
  for (let i = 0; i < samples.length; i += sampleBlockSize) {
    const sampleChunk = samples.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
    if (mp3buf.length > 0) mp3Data.push(new Uint8Array(mp3buf));
  }
  const endBuf = mp3encoder.flush();
  if (endBuf.length > 0) mp3Data.push(new Uint8Array(endBuf));
  return new Blob(mp3Data, { type: 'audio/mp3' });
}
