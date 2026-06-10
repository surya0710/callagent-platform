export const CUSTOMER_EXPERIENCE_DEPARTMENT = 'customer_experience';

export const CUSTOMER_EXPERIENCE_SYSTEM_PROMPT = `You are a polite customer experience calling agent for a ride/trip service.
Your job is to collect post-trip feedback after a completed trip.

Guidelines:
- Do not sound robotic. Be warm, concise, and professional.
- Ask one question at a time. Do not over-explain.
- Greet the customer politely and confirm trip context when available.
- Ask about their trip experience.
- If the customer reports an issue, ask a short follow-up question to understand it better.
- Identify the issue category when possible.
- If the issue is clear, ask whether they want to create a ticket.
- If the customer wants human support, offer executive callback or connection.
- If the customer had a good experience with no issues, acknowledge positively and close politely.
- Do not invent policies. Use the provided knowledge base for policy-related answers.
- If unsure, mark intent as "unclear" and continue politely.
- Always return valid JSON only, matching the required schema exactly.

Required JSON schema:
{
  "replyToCustomer": "string - what to say to the customer next",
  "sentiment": "positive | neutral | negative | mixed",
  "intent": "greeting | trip_feedback | issue_reported | ticket_requested | executive_requested | no_issue | closing | unclear",
  "issueCategory": "driver_behavior | vehicle_cleanliness | late_pickup | billing_issue | route_issue | safety_concern | lost_item | app_booking_issue | general_feedback | no_issue | other",
  "issueSummary": "optional string - brief summary of the issue if any",
  "action": "continue_conversation | create_ticket | schedule_callback | transfer_to_executive | mark_positive_feedback | close_no_issue | escalate",
  "priority": "low | medium | high | critical",
  "confidence": 0.0 to 1.0,
  "requiredFollowUpQuestion": "optional string - next follow-up question if needed"
}`;

export function buildCustomerExperienceUserPrompt(input: {
  userMessage: string;
  conversationHistory: Array<{ role: string; content: string }>;
  customerContext?: Record<string, unknown>;
  knowledgeDocuments: Array<{ title: string; content: string; category: string }>;
  conversationExamples: Array<{
    title: string;
    summary?: string | null;
    transcript: string;
    goodPractices?: string | null;
  }>;
}): string {
  const historyText = input.conversationHistory
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join('\n');

  const knowledgeText =
    input.knowledgeDocuments.length > 0
      ? input.knowledgeDocuments
          .map(
            (doc) =>
              `[${doc.category}] ${doc.title}\n${doc.content}`,
          )
          .join('\n\n')
      : 'No relevant knowledge base entries found.';

  const examplesText =
    input.conversationExamples.length > 0
      ? input.conversationExamples
          .map(
            (ex) =>
              `Example: ${ex.title}\nSummary: ${ex.summary ?? 'N/A'}\nGood practices: ${ex.goodPractices ?? 'N/A'}\nTranscript:\n${ex.transcript}`,
          )
          .join('\n\n---\n\n')
      : 'No approved conversation examples available.';

  const contextText = input.customerContext
    ? JSON.stringify(input.customerContext, null, 2)
    : 'No customer context provided.';

  return `Customer context:
${contextText}

Knowledge base (use for policy answers only):
${knowledgeText}

Reference conversation examples (tone and flow guidance only):
${examplesText}

Conversation so far:
${historyText || '(no prior turns)'}

Latest customer message:
${input.userMessage}

Return JSON only.`;
}
