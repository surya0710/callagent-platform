import { CustomerExperienceAiResult } from './customer-experience-ai-result.interface';

export interface ActionRouterContext {
  customerId?: string;
  callId?: string;
  userId?: string;
}

export interface ActionRouterResult {
  action: string;
  success: boolean;
  ticketId?: string;
  eventId: string;
  message: string;
}

export interface ActionRouter<TAnalysis = CustomerExperienceAiResult> {
  readonly department: string;
  route(
    analysis: TAnalysis,
    context: ActionRouterContext,
  ): Promise<ActionRouterResult>;
}
