import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../../common/constants/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import {
  AgentPlaybookService,
  UpdateAgentPlaybookDto,
} from './agent-playbook.service';

@ApiTags('Training Playbooks')
@ApiBearerAuth()
@Controller('training/playbooks')
export class AgentPlaybookController {
  constructor(private readonly agentPlaybookService: AgentPlaybookService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRAINING_READ)
  @ApiOperation({ summary: 'List AI agent playbooks' })
  listPlaybooks() {
    return this.agentPlaybookService.listPlaybooks();
  }

  @Get('active')
  @RequirePermissions(PERMISSIONS.TRAINING_READ)
  @ApiOperation({ summary: 'Get active AI agent playbook' })
  getActivePlaybook() {
    return this.agentPlaybookService.getActivePlaybook();
  }

  @Post('from-insight/:insightReportId')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Create playbook from training insight report' })
  createFromInsight(@Param('insightReportId') insightReportId: string) {
    return this.agentPlaybookService.createFromInsightReport(insightReportId);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Approve AI agent playbook' })
  approve(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agentPlaybookService.approvePlaybook(id, user.id);
  }

  @Post(':id/activate')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Set AI agent playbook active' })
  activate(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agentPlaybookService.activatePlaybook(id, user.id);
  }

  @Post(':id/archive')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Archive AI agent playbook' })
  archive(@Param('id') id: string) {
    return this.agentPlaybookService.archivePlaybook(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Update draft AI agent playbook' })
  updateDraft(
    @Param('id') id: string,
    @Body() dto: UpdateAgentPlaybookDto,
  ) {
    return this.agentPlaybookService.updateDraftPlaybook(id, dto);
  }

  @Post(':id/duplicate')
  @RequirePermissions(PERMISSIONS.TRAINING_WRITE)
  @ApiOperation({ summary: 'Copy AI agent playbook to a new draft version' })
  duplicate(@Param('id') id: string) {
    return this.agentPlaybookService.duplicatePlaybook(id);
  }
}
