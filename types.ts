
export interface TechTerm {
  term: string;
  explanation: string;
}

export interface RecruitmentAnalysis {
  title: string;
  jobSummary: string;
  priorityRequirements: string[];
  essentialCvElements: string[];
  hiringManagerPreferences: string[];
  submissionTips: string[];
  targetCompanies: string[];
  techGlossary: TechTerm[];
  sampleResume: string; // Markdown formatted professional benchmark
  keywords: {
    primary: string[];
    secondary: string[];
    booleanStrings: string[];
  };
  candidateAnalysis?: {
    overallMatchPercentage: number;
    skillMatchPercentage: number;
    matchingStrengths: string[];
    criticalGaps: string[];
    employmentGaps: string[];
    shortTermAssignments: string[];
    authenticityScore: 'High' | 'Medium' | 'Low' | 'Caution';
    authenticityReasoning: string;
    keywordStuffingAnalysis: {
      riskLevel: 'Low' | 'Elevated' | 'High';
      findings: string;
      detectedArtificialClusters: string[];
    };
    recruiterQuestions: string[];
  };
  audioScript: string;
}

export interface JDHistory {
  id: string;
  timestamp: number;
  title: string;
  analysis: RecruitmentAnalysis;
}

export interface AppState {
  history: JDHistory[];
  currentId: string | null;
  isAnalyzing: boolean;
  error: string | null;
}
