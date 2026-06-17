export const TRAINING_INSIGHTS_AGGREGATE_SYSTEM_PROMPT = `You are a sales intelligence analyst synthesizing patterns across many executive outbound sales calls.

Given individual call analyses, produce aggregate business insights as JSON only.

Rules:
- Base insights ONLY on the provided analyses. Do not invent calls or data.
- Preserve multilingual context (English, Hindi, Hinglish) in examples where relevant.
- Rank items by frequency/importance.
- recommendedPlaybook should be a practical, actionable sales playbook (markdown-friendly plain text).
- aiAgentInstructions should be concise instructions for an AI voice agent derived from top patterns.

Return ONLY valid JSON matching this schema:
{
  "commonObjections": [{ "objection": "string", "count": number, "bestResponses": ["string"] }],
  "commonQuestions": [{ "question": "string", "count": number }],
  "commonRequirements": [{ "requirement": "string", "count": number }],
  "winningPhrases": [{ "phrase": "string", "count": number, "context": "string" }],
  "badPhrases": [{ "phrase": "string", "count": number, "reason": "string" }],
  "bestOpenings": [{ "style": "string", "example": "string", "count": number }],
  "followUpPatterns": [{ "pattern": "string", "description": "string" }],
  "hotLeadSignals": ["string"],
  "coldLeadSignals": ["string"],
  "recommendedPlaybook": "string — full playbook text",
  "aiAgentInstructions": "string — instructions for AI agent"
}`;

export function buildTrainingInsightsAggregateUserPrompt(
  analyses: Array<{
    summary?: string | null;
    outcome?: string | null;
    leadQuality?: string | null;
    customerIntent?: string | null;
    customerRequirements?: unknown;
    objections?: unknown;
    customerQuestions?: unknown;
    importantDetails?: unknown;
    nextAction?: string | null;
    executiveScore?: number | null;
    winningPhrases?: unknown;
    badPhrases?: unknown;
    confidence?: number | null;
  }>,
) {
  const payload = analyses.map((a, index) => ({
    callIndex: index + 1,
    summary: a.summary,
    outcome: a.outcome,
    leadQuality: a.leadQuality,
    customerIntent: a.customerIntent,
    customerRequirements: a.customerRequirements,
    objections: a.objections,
    customerQuestions: a.customerQuestions,
    importantDetails: a.importantDetails,
    nextAction: a.nextAction,
    executiveScore: a.executiveScore,
    winningPhrases: a.winningPhrases,
    badPhrases: a.badPhrases,
    confidence: a.confidence,
  }));

  return `Synthesize aggregate sales intelligence from ${analyses.length} call analyses:

${JSON.stringify(payload, null, 2)}`;
}
