import {
  TrainingCallAnalysisResult,
  TrainingCallOutcome,
  TrainingLeadQuality,
} from '../interfaces/training-call-analysis.interface';
import { TrainingAggregateInsightsResult } from '../interfaces/training-call-analysis.interface';

const OUTCOMES: TrainingCallOutcome[] = [
  'interested',
  'not_interested',
  'callback_requested',
  'wrong_number',
  'no_answer',
  'voicemail',
  'qualified_lead',
  'unqualified_lead',
  'unclear',
];

const LEAD_QUALITIES: TrainingLeadQuality[] = [
  'hot',
  'warm',
  'cold',
  'unqualified',
  'unknown',
];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isTrainingCallAnalysisResult(
  value: unknown,
): value is TrainingCallAnalysisResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value as Record<string, unknown>;
  const perf = obj.executivePerformance;

  if (!perf || typeof perf !== 'object') {
    return false;
  }

  const perfObj = perf as Record<string, unknown>;

  return (
    typeof obj.summary === 'string' &&
    OUTCOMES.includes(obj.outcome as TrainingCallOutcome) &&
    LEAD_QUALITIES.includes(obj.leadQuality as TrainingLeadQuality) &&
    typeof obj.customerIntent === 'string' &&
    isStringArray(obj.customerRequirements) &&
    isStringArray(obj.objections) &&
    isStringArray(obj.customerQuestions) &&
    isStringArray(obj.importantDetails) &&
    typeof obj.nextAction === 'string' &&
    typeof obj.callbackRequested === 'boolean' &&
    (obj.callbackDateTime === undefined ||
      obj.callbackDateTime === null ||
      typeof obj.callbackDateTime === 'string') &&
    typeof perfObj.score === 'number' &&
    perfObj.score >= 0 &&
    perfObj.score <= 100 &&
    isStringArray(perfObj.strengths) &&
    isStringArray(perfObj.improvements) &&
    isStringArray(perfObj.missedOpportunities) &&
    isStringArray(obj.winningPhrases) &&
    isStringArray(obj.badPhrases) &&
    typeof obj.confidence === 'number' &&
    obj.confidence >= 0 &&
    obj.confidence <= 1
  );
}

export function parseTrainingCallAnalysisResult(raw: string): TrainingCallAnalysisResult {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error('No JSON object found in training call analysis response');
  }

  const parsed: unknown = JSON.parse(jsonMatch[0]);

  if (!isTrainingCallAnalysisResult(parsed)) {
    throw new Error('AI response does not match TrainingCallAnalysisResult schema');
  }

  return parsed;
}

export function isTrainingAggregateInsightsResult(
  value: unknown,
): value is TrainingAggregateInsightsResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    Array.isArray(obj.commonObjections) &&
    Array.isArray(obj.commonQuestions) &&
    Array.isArray(obj.commonRequirements) &&
    Array.isArray(obj.winningPhrases) &&
    Array.isArray(obj.badPhrases) &&
    Array.isArray(obj.bestOpenings) &&
    Array.isArray(obj.followUpPatterns) &&
    isStringArray(obj.hotLeadSignals) &&
    isStringArray(obj.coldLeadSignals) &&
    typeof obj.recommendedPlaybook === 'string' &&
    typeof obj.aiAgentInstructions === 'string'
  );
}

export function parseTrainingAggregateInsightsResult(
  raw: string,
): TrainingAggregateInsightsResult {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error('No JSON object found in training aggregate insights response');
  }

  const parsed: unknown = JSON.parse(jsonMatch[0]);

  if (!isTrainingAggregateInsightsResult(parsed)) {
    throw new Error('AI response does not match TrainingAggregateInsightsResult schema');
  }

  return parsed;
}
