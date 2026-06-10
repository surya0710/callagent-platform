import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/constants/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateConversationExampleDto } from './dto/create-conversation-example.dto';
import { CxAgentRespondDto } from './dto/cx-agent-respond.dto';
import { SimulateCallDto } from './dto/simulate-call.dto';
import { ConversationExamplesService } from './services/conversation-examples.service';
import { CustomerExperienceActionRouter } from './services/customer-experience-action-router.service';
import { CustomerExperienceAgentService } from './services/customer-experience-agent.service';

@ApiTags('CX Agent')
@ApiBearerAuth()
@Controller('cx-agent')
export class CxAgentController {
  constructor(
    private readonly cxAgentService: CustomerExperienceAgentService,
    private readonly actionRouter: CustomerExperienceActionRouter,
    private readonly conversationExamplesService: ConversationExamplesService,
  ) {}

  @Post('respond')
  @RequirePermissions(PERMISSIONS.CX_AGENT_WRITE)
  @ApiOperation({ summary: 'Generate CX agent response with structured analysis' })
  async respond(@Body() dto: CxAgentRespondDto) {
    const customerContext = {
      ...dto.customerContext,
      customerId: dto.customerId,
      tripId: dto.tripId,
    };

    return this.cxAgentService.respond({
      userMessage: dto.userMessage,
      conversationHistory: dto.conversationHistory,
      customerContext,
      callId: dto.callId,
      customerId: dto.customerId,
    });
  }

  @Post('simulate-call')
  @RequirePermissions(PERMISSIONS.CX_AGENT_WRITE)
  @ApiOperation({ summary: 'Simulate a CX feedback call turn with action routing' })
  async simulateCall(
    @Body() dto: SimulateCallDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const response = await this.cxAgentService.respond({
      userMessage: dto.userMessage,
      conversationHistory: dto.conversationHistory,
      customerContext: {
        customerId: dto.customerId,
        tripId: dto.tripId,
      },
      customerId: dto.customerId,
    });

    const actionResult = await this.actionRouter.route(response.analysis, {
      customerId: dto.customerId,
      userId: user.id,
    });

    return {
      replyToCustomer: response.replyToCustomer,
      analysis: response.analysis,
      actionTriggered: actionResult.action,
      ticketId: actionResult.ticketId,
    };
  }

  @Get('examples')
  @RequirePermissions(PERMISSIONS.CX_AGENT_READ)
  @ApiOperation({ summary: 'List conversation examples' })
  findExamples() {
    return this.conversationExamplesService.findAll('customer_experience');
  }

  @Post('examples')
  @RequirePermissions(PERMISSIONS.CX_AGENT_WRITE)
  @ApiOperation({ summary: 'Create conversation example' })
  createExample(
    @Body() dto: CreateConversationExampleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conversationExamplesService.create(dto, user.id);
  }

  @Patch('examples/:id/approve')
  @RequirePermissions(PERMISSIONS.CX_AGENT_WRITE)
  @ApiOperation({ summary: 'Approve conversation example for prompt reference' })
  approveExample(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conversationExamplesService.approve(id, user.id);
  }
}
