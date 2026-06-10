import {
  CxAction,
  CxIntent,
  CxIssueCategory,
  CxPriority,
  CxSentiment,
  CustomerExperienceAiResult,
} from '../interfaces/customer-experience-ai-result.interface';

const SENTIMENTS: CxSentiment[] = ['positive', 'neutral', 'negative', 'mixed'];

const INTENTS: CxIntent[] = [
  'greeting',
  'trip_feedback',
  'issue_reported',
  'ticket_requested',
  'executive_requested',
  'no_issue',
  'closing',
  'unclear',
];

const ISSUE_CATEGORIES: CxIssueCategory[] = [
  'driver_behavior',
  'vehicle_cleanliness',
  'late_pickup',
  'billing_issue',
  'route_issue',
  'safety_concern',
  'lost_item',
  'app_booking_issue',
  'general_feedback',
  'no_issue',
  'other',
];

const ACTIONS: CxAction[] = [
  'continue_conversation',
  'create_ticket',
  'schedule_callback',
  'transfer_to_executive',
  'mark_positive_feedback',
  'close_no_issue',
  'escalate',
];

const PRIORITIES: CxPriority[] = ['low', 'medium', 'high', 'critical'];

export function isCustomerExperienceAiResult(
  value: unknown,
): value is CustomerExperienceAiResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.replyToCustomer === 'string' &&
    obj.replyToCustomer.trim().length > 0 &&
    SENTIMENTS.includes(obj.sentiment as CxSentiment) &&
    INTENTS.includes(obj.intent as CxIntent) &&
    ISSUE_CATEGORIES.includes(obj.issueCategory as CxIssueCategory) &&
    ACTIONS.includes(obj.action as CxAction) &&
    PRIORITIES.includes(obj.priority as CxPriority) &&
    typeof obj.confidence === 'number' &&
    obj.confidence >= 0 &&
    obj.confidence <= 1 &&
    (obj.issueSummary === undefined || typeof obj.issueSummary === 'string') &&
    (obj.requiredFollowUpQuestion === undefined ||
      typeof obj.requiredFollowUpQuestion === 'string')
  );
}

export function parseCustomerExperienceAiResult(
  raw: string,
): CustomerExperienceAiResult {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error('No JSON object found in AI response');
  }

  const parsed: unknown = JSON.parse(jsonMatch[0]);

  if (!isCustomerExperienceAiResult(parsed)) {
    throw new Error('AI response does not match CustomerExperienceAiResult schema');
  }

  return parsed;
}
