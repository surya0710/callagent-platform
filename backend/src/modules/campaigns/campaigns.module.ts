import { Module } from '@nestjs/common';
import { ProcessorsModule } from '../../queues/processors/processors.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [AuditLogsModule, ProcessorsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
