import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService, KnowledgeRetrievalService],
  exports: [KnowledgeBaseService, KnowledgeRetrievalService],
})
export class KnowledgeBaseModule {}
