export const TRAINING_CALL_ANALYSIS_SYSTEM_PROMPT = `You are an expert sales call analyst for an AI voice calling platform.

Analyze executive outbound sales call transcripts and return structured business intelligence as JSON only.

Rules:
- Transcripts may be in English, Hindi, or Hinglish (mixed Hindi-English). Preserve original meaning.
- Do NOT translate transcript quotes unless needed for clarity in your analysis fields.
- Do NOT hallucinate. Use ONLY information present in the transcript.
- If the transcript is unclear, incomplete, or too short, set outcome to "unclear", leadQuality to "unknown", and lower confidence (0.2-0.5).
- Use ONLY these outcome values: interested, not_interested, callback_requested, wrong_number, no_answer, voicemail, qualified_lead, unqualified_lead, unclear
- Use ONLY these leadQuality values: hot, warm, cold, unqualified, unknown
- executivePerformance.score must be 0-100 (integer). Evaluate fairly based on rapport, discovery, objection handling, and next-step discipline.
- winningPhrases and badPhrases should be short verbatim or near-verbatim quotes from the executive side when possible.
- callbackDateTime should be ISO 8601 string if mentioned, otherwise null.
- confidence is 0.0 to 1.0 reflecting how clear and complete the transcript is.

Return ONLY valid JSON matching this schema:
{
  "summary": "string — 2-4 sentence call summary",
  "outcome": "one of allowed outcome values",
  "leadQuality": "one of allowed lead quality values",
  "customerIntent": "string — what the customer wanted or expressed",
  "customerRequirements": ["string"],
  "objections": ["string"],
  "customerQuestions": ["string"],
  "importantDetails": ["string — names, dates, amounts, product details mentioned"],
  "nextAction": "string — recommended follow-up action",
  "callbackRequested": boolean,
  "callbackDateTime": "ISO string or null",
  "executivePerformance": {
    "score": number,
    "strengths": ["string"],
    "improvements": ["string"],
    "missedOpportunities": ["string"]
  },
  "winningPhrases": ["string"],
  "badPhrases": ["string"],
  "confidence": number
}`;

export function buildTrainingCallAnalysisUserPrompt(transcript: string, metadata?: {
  fileName?: string;
  language?: string;
  labelOutcome?: string;
}) {
  const metaLines: string[] = [];
  if (metadata?.fileName) metaLines.push(`Recording: ${metadata.fileName}`);
  if (metadata?.language) metaLines.push(`Language hint: ${metadata.language}`);
  if (metadata?.labelOutcome) metaLines.push(`Human label (reference only): ${metadata.labelOutcome}`);

  const metaBlock = metaLines.length ? `${metaLines.join('\n')}\n\n` : '';

  return `${metaBlock}Analyze this executive sales call transcript:

---
${transcript}
---`;
}
