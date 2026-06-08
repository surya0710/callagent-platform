import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateAgentPromptDto } from './dto/create-agent-prompt.dto';
import { UpdateAgentPromptDto } from './dto/update-agent-prompt.dto';

@Injectable()
export class AgentPromptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  findAll() {
    return this.prisma.agentPrompt.findMany({
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async findOne(id: string) {
    const prompt = await this.prisma.agentPrompt.findUnique({ where: { id } });

    if (!prompt) {
      throw new NotFoundException('Agent prompt not found');
    }

    return prompt;
  }

  async create(dto: CreateAgentPromptDto, userId: string) {
    const prompt = await this.prisma.agentPrompt.create({
      data: {
        name: dto.name,
        description: dto.description,
        systemPrompt: dto.systemPrompt,
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'create',
      entityType: 'agent_prompt',
      entityId: prompt.id,
    });

    return prompt;
  }

  async update(id: string, dto: UpdateAgentPromptDto, userId: string) {
    await this.findOne(id);

    const prompt = await this.prisma.agentPrompt.update({
      where: { id },
      data: dto,
    });

    await this.auditLogsService.log({
      userId,
      action: 'update',
      entityType: 'agent_prompt',
      entityId: id,
    });

    return prompt;
  }

  async activate(id: string, userId: string) {
    await this.findOne(id);

    await this.prisma.$transaction([
      this.prisma.agentPrompt.updateMany({
        data: { isActive: false },
        where: { isActive: true },
      }),
      this.prisma.agentPrompt.update({
        where: { id },
        data: { isActive: true },
      }),
    ]);

    await this.auditLogsService.log({
      userId,
      action: 'activate',
      entityType: 'agent_prompt',
      entityId: id,
    });

    return this.findOne(id);
  }
}
