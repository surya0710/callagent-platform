import { Injectable, Logger } from '@nestjs/common';
import { AiProviderFactory } from '../../ai/ai-provider.factory';
import { KnowledgeRetrievalService } from '../../knowledge-base/knowledge-retrieval.service';
import {
  AgentRespondInput,
  AgentRespondOutput,
  DepartmentAgent,
} from '../interfaces/department-agent.interface';
import { CustomerExperienceAiResult } from '../interfaces/customer-experience-ai-result.interface';
import {
  buildCustomerExperienceUserPrompt,
  CUSTOMER_EXPERIENCE_DEPARTMENT,
  CUSTOMER_EXPERIENCE_SYSTEM_PROMPT,
} from '../prompts/customer-experience.prompt';
import { parseCustomerExperienceAiResult } from '../schemas/customer-experience-ai-result.schema';
import { ConversationExamplesService } from './conversation-examples.service';

@Injectable()
export class CustomerExperienceAgentService implements DepartmentAgent<CustomerExperienceAiResult> {
  readonly department = CUSTOMER_EXPERIENCE_DEPARTMENT;
  private readonly logger = new Logger(CustomerExperienceAgentService.name);

  constructor(
    private readonly aiProviderFactory: AiProviderFactory,
    private readonly knowledgeRetrievalService: KnowledgeRetrievalService,
    private readonly conversationExamplesService: ConversationExamplesService,
  ) {}

  async respond(
    input: AgentRespondInput,
  ): Promise<AgentRespondOutput<CustomerExperienceAiResult>> {
    const conversationText = [
      ...input.conversationHistory.map((t) => t.content),
      input.userMessage,
    ].join(' ');

    const [retrieval, examples] = await Promise.all([
      this.knowledgeRetrievalService.retrieve({
        department: this.department,
        conversationText,
        customerContext: input.customerContext,
      }),
      this.conversationExamplesService.findApproved(this.department),
    ]);

    const userPrompt = buildCustomerExperienceUserPrompt({
      userMessage: input.userMessage,
      conversationHistory: input.conversationHistory,
      customerContext: input.customerContext,
      knowledgeDocuments: retrieval.documents,
      conversationExamples: examples,
    });

    const provider = this.aiProviderFactory.getProvider();
    let analysis: CustomerExperienceAiResult;

    try {
      const result = await provider.generateText({
        prompt: userPrompt,
        systemPrompt: CUSTOMER_EXPERIENCE_SYSTEM_PROMPT,
        context: input.customerContext,
      });

      try {
        analysis = parseCustomerExperienceAiResult(result.text);
      } catch {
        this.logger.warn(
          `Failed to parse structured output from ${provider.name}; using rule-based fallback`,
        );
        analysis = this.generateFallbackResponse(input, provider.name);
      }
    } catch (error) {
      this.logger.error('AI provider failed; using rule-based fallback', error);
      analysis = this.generateFallbackResponse(input, 'fallback');
    }

    return {
      replyToCustomer: analysis.replyToCustomer,
      analysis,
    };
  }

  private generateFallbackResponse(
    input: AgentRespondInput,
    providerName: string,
  ): CustomerExperienceAiResult {
    const message = input.userMessage.toLowerCase();
    const historyLength = input.conversationHistory.length;
    const customerName =
      typeof input.customerContext?.firstName === 'string'
        ? input.customerContext.firstName
        : 'there';

    if (historyLength === 0) {
      return {
        replyToCustomer: `Hello ${customerName}, this is your customer experience team calling about your recent trip. Do you have a moment to share how it went?`,
        sentiment: 'neutral',
        intent: 'greeting',
        issueCategory: 'no_issue',
        action: 'continue_conversation',
        priority: 'low',
        confidence: 0.75,
      };
    }

    if (/(great|good|fine|excellent|smooth|happy|no issue|no problem)/.test(message)) {
      return {
        replyToCustomer:
          'That is wonderful to hear. Thank you for sharing your feedback. Is there anything else you would like us to note before we wrap up?',
        sentiment: 'positive',
        intent: 'no_issue',
        issueCategory: 'no_issue',
        action: historyLength > 2 ? 'mark_positive_feedback' : 'continue_conversation',
        priority: 'low',
        confidence: 0.8,
      };
    }

    if (/(ticket|complaint|register|file)/.test(message)) {
      return {
        replyToCustomer:
          'I understand. I can create a ticket for our team to follow up. Would you like me to go ahead and do that?',
        sentiment: 'negative',
        intent: 'ticket_requested',
        issueCategory: this.detectIssueCategory(message),
        issueSummary: input.userMessage,
        action: 'create_ticket',
        priority: 'medium',
        confidence: 0.85,
      };
    }

    if (/(executive|manager|supervisor|human|speak to someone|callback)/.test(message)) {
      return {
        replyToCustomer:
          'Of course. I can arrange for an executive to call you back. Would you prefer a callback within the next few hours?',
        sentiment: 'negative',
        intent: 'executive_requested',
        issueCategory: this.detectIssueCategory(message),
        issueSummary: input.userMessage,
        action: 'transfer_to_executive',
        priority: 'high',
        confidence: 0.85,
      };
    }

    if (/(bad|late|dirty|rude|overcharged|lost|unsafe|problem|issue|upset|angry)/.test(message)) {
      const category = this.detectIssueCategory(message);
      return {
        replyToCustomer:
          'I am sorry to hear that. Could you tell me a bit more about what happened so I can help?',
        sentiment: 'negative',
        intent: 'issue_reported',
        issueCategory: category,
        issueSummary: input.userMessage,
        action: 'continue_conversation',
        priority: category === 'safety_concern' ? 'critical' : 'medium',
        confidence: 0.8,
        requiredFollowUpQuestion: 'Can you briefly describe what went wrong during your trip?',
      };
    }

    if (/(bye|goodbye|nothing else|that is all|done|no thanks)/.test(message)) {
      return {
        replyToCustomer:
          'Thank you for your time today. We appreciate your feedback. Have a great day!',
        sentiment: 'neutral',
        intent: 'closing',
        issueCategory: 'no_issue',
        action: 'close_no_issue',
        priority: 'low',
        confidence: 0.9,
      };
    }

    return {
      replyToCustomer: `[${providerName}] Could you tell me a little more about your trip experience?`,
      sentiment: 'neutral',
      intent: 'trip_feedback',
      issueCategory: 'general_feedback',
      action: 'continue_conversation',
      priority: 'low',
      confidence: 0.6,
    };
  }

  private detectIssueCategory(message: string): CustomerExperienceAiResult['issueCategory'] {
    if (/(driver|rude|behavior|attitude)/.test(message)) return 'driver_behavior';
    if (/(dirty|clean|smell|vehicle)/.test(message)) return 'vehicle_cleanliness';
    if (/(late|delay|wait|pickup)/.test(message)) return 'late_pickup';
    if (/(bill|charge|overcharge|payment|fare)/.test(message)) return 'billing_issue';
    if (/(route|wrong way|detour)/.test(message)) return 'route_issue';
    if (/(unsafe|safety|accident)/.test(message)) return 'safety_concern';
    if (/(lost|left|forgot|item)/.test(message)) return 'lost_item';
    if (/(app|booking|cancel)/.test(message)) return 'app_booking_issue';
    return 'other';
  }
}
