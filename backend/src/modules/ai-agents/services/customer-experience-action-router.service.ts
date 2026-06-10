import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  ActionRouter,
  ActionRouterContext,
  ActionRouterResult,
} from '../interfaces/action-router.interface';
import { CustomerExperienceAiResult } from '../interfaces/customer-experience-ai-result.interface';
import { CUSTOMER_EXPERIENCE_DEPARTMENT } from '../prompts/customer-experience.prompt';
import { TicketsService } from '../../tickets/tickets.service';

@Injectable()
export class CustomerExperienceActionRouter implements ActionRouter<CustomerExperienceAiResult> {
  readonly department = CUSTOMER_EXPERIENCE_DEPARTMENT;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsService: TicketsService,
  ) {}

  async route(
    analysis: CustomerExperienceAiResult,
    context: ActionRouterContext,
  ): Promise<ActionRouterResult> {
    switch (analysis.action) {
      case 'create_ticket':
        return this.handleCreateTicket(analysis, context);
      case 'schedule_callback':
        return this.handleScheduleCallback(analysis, context);
      case 'transfer_to_executive':
        return this.handleTransferToExecutive(analysis, context);
      case 'mark_positive_feedback':
        return this.handleMarkPositiveFeedback(analysis, context);
      case 'close_no_issue':
        return this.handleCloseNoIssue(analysis, context);
      case 'escalate':
        return this.handleEscalate(analysis, context);
      case 'continue_conversation':
      default:
        return this.handleContinueConversation(analysis, context);
    }
  }

  private serializeAnalysis(
    analysis: CustomerExperienceAiResult,
  ): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(analysis)) as Prisma.InputJsonValue;
  }

  private async recordEvent(
    action: string,
    context: ActionRouterContext,
    metadata?: Prisma.InputJsonValue,
    ticketId?: string,
  ): Promise<string> {
    const event = await this.prisma.agentActionEvent.create({
      data: {
        department: this.department,
        action,
        callId: context.callId,
        customerId: context.customerId,
        ticketId,
        metadata,
      },
    });

    return event.id;
  }

  private async handleCreateTicket(
    analysis: CustomerExperienceAiResult,
    context: ActionRouterContext,
  ): Promise<ActionRouterResult> {
    if (!context.customerId) {
      const eventId = await this.recordEvent('create_ticket', context, {
        error: 'customerId required',
        analysis: this.serializeAnalysis(analysis),
      });

      return {
        action: 'create_ticket',
        success: false,
        eventId,
        message: 'Cannot create ticket without customerId',
      };
    }

    const ticket = await this.ticketsService.create({
      customerId: context.customerId,
      callId: context.callId,
      issueCategory: analysis.issueCategory,
      issueSummary: analysis.issueSummary,
      priority: analysis.priority,
      source: 'cx_call',
    });

    const eventId = await this.recordEvent(
      'create_ticket',
      context,
      { analysis: this.serializeAnalysis(analysis), mockHandler: true },
      ticket.id,
    );

    return {
      action: 'create_ticket',
      success: true,
      ticketId: ticket.id,
      eventId,
      message: 'Ticket created (mock handler)',
    };
  }

  private async handleScheduleCallback(
    analysis: CustomerExperienceAiResult,
    context: ActionRouterContext,
  ): Promise<ActionRouterResult> {
    const eventId = await this.recordEvent('schedule_callback', context, {
      analysis: this.serializeAnalysis(analysis),
      mockHandler: true,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    return {
      action: 'schedule_callback',
      success: true,
      eventId,
      message: 'Callback scheduled (mock handler)',
    };
  }

  private async handleTransferToExecutive(
    analysis: CustomerExperienceAiResult,
    context: ActionRouterContext,
  ): Promise<ActionRouterResult> {
    const eventId = await this.recordEvent('transfer_to_executive', context, {
      analysis: this.serializeAnalysis(analysis),
      mockHandler: true,
      executiveQueue: 'cx_escalation',
    });

    return {
      action: 'transfer_to_executive',
      success: true,
      eventId,
      message: 'Executive transfer queued (mock handler)',
    };
  }

  private async handleMarkPositiveFeedback(
    analysis: CustomerExperienceAiResult,
    context: ActionRouterContext,
  ): Promise<ActionRouterResult> {
    const eventId = await this.recordEvent('mark_positive_feedback', context, {
      analysis: this.serializeAnalysis(analysis),
      mockHandler: true,
    });

    return {
      action: 'mark_positive_feedback',
      success: true,
      eventId,
      message: 'Positive feedback recorded (mock handler)',
    };
  }

  private async handleCloseNoIssue(
    analysis: CustomerExperienceAiResult,
    context: ActionRouterContext,
  ): Promise<ActionRouterResult> {
    const eventId = await this.recordEvent('close_no_issue', context, {
      analysis: this.serializeAnalysis(analysis),
      mockHandler: true,
    });

    return {
      action: 'close_no_issue',
      success: true,
      eventId,
      message: 'Call closed with no issue (mock handler)',
    };
  }

  private async handleEscalate(
    analysis: CustomerExperienceAiResult,
    context: ActionRouterContext,
  ): Promise<ActionRouterResult> {
    const eventId = await this.recordEvent('escalate', context, {
      analysis: this.serializeAnalysis(analysis),
      mockHandler: true,
      escalationLevel: 'supervisor',
    });

    return {
      action: 'escalate',
      success: true,
      eventId,
      message: 'Issue escalated (mock handler)',
    };
  }

  private async handleContinueConversation(
    analysis: CustomerExperienceAiResult,
    context: ActionRouterContext,
  ): Promise<ActionRouterResult> {
    const eventId = await this.recordEvent('continue_conversation', context, {
      analysis: this.serializeAnalysis(analysis),
      mockHandler: true,
    });

    return {
      action: 'continue_conversation',
      success: true,
      eventId,
      message: 'Conversation continuing',
    };
  }
}
