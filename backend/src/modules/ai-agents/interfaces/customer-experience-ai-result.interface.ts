export type CxSentiment = 'positive' | 'neutral' | 'negative' | 'mixed';

export type CxIntent =
  | 'greeting'
  | 'trip_feedback'
  | 'issue_reported'
  | 'ticket_requested'
  | 'executive_requested'
  | 'no_issue'
  | 'closing'
  | 'unclear';

export type CxIssueCategory =
  | 'driver_behavior'
  | 'vehicle_cleanliness'
  | 'late_pickup'
  | 'billing_issue'
  | 'route_issue'
  | 'safety_concern'
  | 'lost_item'
  | 'app_booking_issue'
  | 'general_feedback'
  | 'no_issue'
  | 'other';

export type CxAction =
  | 'continue_conversation'
  | 'create_ticket'
  | 'schedule_callback'
  | 'transfer_to_executive'
  | 'mark_positive_feedback'
  | 'close_no_issue'
  | 'escalate';

export type CxPriority = 'low' | 'medium' | 'high' | 'critical';

export interface CustomerExperienceAiResult {
  replyToCustomer: string;
  sentiment: CxSentiment;
  intent: CxIntent;
  issueCategory: CxIssueCategory;
  issueSummary?: string;
  action: CxAction;
  priority: CxPriority;
  confidence: number;
  requiredFollowUpQuestion?: string;
}
