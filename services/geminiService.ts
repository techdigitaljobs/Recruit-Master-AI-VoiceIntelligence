
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
    
    ${resume ? `Candidate Resume for Analysis:\n${resume}` : "No candidate provided. Analyze the requirement for a target candidate benchmark profile."}
    
    TASK: Provide a deep recruitment strategy and (if resume provided) a forensic audit of the candidate.
    
    CRITICAL INSTRUCTION FOR KEYWORD STUFFING:
    Scan the resume specifically for "Job Description Injection". This is when a candidate copies phrases or unique keywords directly from the Job Description into their skills or summary section to trick ATS filters. 
    Compare the unique terminology in the JD: "${jd.substring(0, 1000)}" against the resume.
    
    MANDATORY OUTPUT STRUCTURE (JSON):
    1. title: Official Job Title.
    2. jobSummary: 2-3 sentence strategic overview.
    3. priorityRequirements: Array of must-have skills.
    4. essentialCvElements: Array of markers that must be on a CV.
    5. hiringManagerPreferences: Array of cultural/soft preferences.
    6. submissionTips: Array of tactical sell-in tips.
    7. targetCompanies: Array of companies to headhunt from.
    8. keywords: { primary: [], secondary: [], booleanStrings: [] }
    9. techGlossary: [{ term: string, explanation: string }] (5-8 terms)
    10. sampleResume: Professional Markdown benchmark profile.
    11. candidateAnalysis: (ONLY if resume provided)
        - overallMatchPercentage: (Number)
        - skillMatchPercentage: (Number)
        - matchingStrengths: []
        - criticalGaps: []
        - employmentGaps: []
        - shortTermAssignments: []
        - authenticityScore: 'High' | 'Medium' | 'Low' | 'Caution'
        - authenticityReasoning: String explanation.
        - keywordStuffingAnalysis: 
            - riskLevel: 'Low' | 'Elevated' | 'High'
            - findings: Detail if they used JD-specific phrases unnaturally.
            - detectedArtificialClusters: List phrases copied directly from JD.
        - recruiterQuestions: []
    12. audioScript: Recruiter briefing script.
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

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("JSON Parsing failed. Raw response:", response.text);
    throw new Error("The AI returned an invalid format. Please try refining the job description.");
  }
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
  if (!lame) throw new Error("Audio engine (lamejs) not initialized.");
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
