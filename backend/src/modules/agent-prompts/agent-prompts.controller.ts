import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/constants/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AgentPromptsService } from './agent-prompts.service';
import { CreateAgentPromptDto } from './dto/create-agent-prompt.dto';
import { UpdateAgentPromptDto } from './dto/update-agent-prompt.dto';

@ApiTags('Agent Prompts')
@ApiBearerAuth()
@Controller('agent-prompts')
export class AgentPromptsController {
  constructor(private readonly agentPromptsService: AgentPromptsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: 'List agent prompts' })
  findAll() {
    return this.agentPromptsService.findAll();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: 'Create agent prompt' })
  create(
    @Body() dto: CreateAgentPromptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agentPromptsService.create(dto, user.id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: 'Get agent prompt by ID' })
  findOne(@Param('id') id: string) {
    return this.agentPromptsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: 'Update agent prompt' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAgentPromptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agentPromptsService.update(id, dto, user.id);
  }

  @Post(':id/activate')
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: 'Set agent prompt as active' })
  activate(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agentPromptsService.activate(id, user.id);
  }
}
