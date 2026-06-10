export interface ConversationTurn {
  role: 'assistant' | 'customer';
  content: string;
}

export interface AgentRespondInput {
  userMessage: string;
  conversationHistory: ConversationTurn[];
  customerContext?: Record<string, unknown>;
  callId?: string;
  customerId?: string;
}

export interface AgentRespondOutput<TAnalysis = unknown> {
  replyToCustomer: string;
  analysis: TAnalysis;
}

export interface DepartmentAgent<TAnalysis = unknown> {
  readonly department: string;
  respond(input: AgentRespondInput): Promise<AgentRespondOutput<TAnalysis>>;
}
