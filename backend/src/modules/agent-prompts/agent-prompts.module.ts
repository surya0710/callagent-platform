import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AgentPromptsController } from './agent-prompts.controller';
import { AgentPromptsService } from './agent-prompts.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [AgentPromptsController],
  providers: [AgentPromptsService],
  exports: [AgentPromptsService],
})
export class AgentPromptsModule {}
