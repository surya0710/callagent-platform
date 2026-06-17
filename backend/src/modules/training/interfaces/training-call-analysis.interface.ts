export type TrainingCallOutcome =
  | 'interested'
  | 'not_interested'
  | 'callback_requested'
  | 'wrong_number'
  | 'no_answer'
  | 'voicemail'
  | 'qualified_lead'
  | 'unqualified_lead'
  | 'unclear';

export type TrainingLeadQuality = 'hot' | 'warm' | 'cold' | 'unqualified' | 'unknown';

export interface TrainingCallAnalysisResult {
  summary: string;
  outcome: TrainingCallOutcome;
  leadQuality: TrainingLeadQuality;
  customerIntent: string;
  customerRequirements: string[];
  objections: string[];
  customerQuestions: string[];
  importantDetails: string[];
  nextAction: string;
  callbackRequested: boolean;
  callbackDateTime?: string | null;
  executivePerformance: {
    score: number;
    strengths: string[];
    improvements: string[];
    missedOpportunities: string[];
  };
  winningPhrases: string[];
  badPhrases: string[];
  confidence: number;
}

export interface TrainingAggregateInsightsResult {
  commonObjections: Array<{ objection: string; count: number; bestResponses: string[] }>;
  commonQuestions: Array<{ question: string; count: number }>;
  commonRequirements: Array<{ requirement: string; count: number }>;
  winningPhrases: Array<{ phrase: string; count: number; context?: string }>;
  badPhrases: Array<{ phrase: string; count: number; reason?: string }>;
  bestOpenings: Array<{ style: string; example: string; count: number }>;
  followUpPatterns: Array<{ pattern: string; description: string }>;
  hotLeadSignals: string[];
  coldLeadSignals: string[];
  recommendedPlaybook: string;
  aiAgentInstructions: string;
}
