import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { TicketsModule } from '../tickets/tickets.module';
import { CxAgentController } from './cx-agent.controller';
import { ConversationExamplesService } from './services/conversation-examples.service';
import { CustomerExperienceActionRouter } from './services/customer-experience-action-router.service';
import { CustomerExperienceAgentService } from './services/customer-experience-agent.service';

@Module({
  imports: [AiModule, KnowledgeBaseModule, TicketsModule, AuditLogsModule],
  controllers: [CxAgentController],
  providers: [
    CustomerExperienceAgentService,
    CustomerExperienceActionRouter,
    ConversationExamplesService,
  ],
  exports: [
    CustomerExperienceAgentService,
    CustomerExperienceActionRouter,
    ConversationExamplesService,
  ],
})
export class AiAgentsModule {}
