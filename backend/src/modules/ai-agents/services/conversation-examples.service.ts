import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateConversationExampleDto } from '../dto/create-conversation-example.dto';

@Injectable()
export class ConversationExamplesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  findAll(department?: string) {
    return this.prisma.conversationExample.findMany({
      where: department ? { department } : undefined,
      orderBy: [{ isApproved: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  findApproved(department: string, limit = 3) {
    return this.prisma.conversationExample.findMany({
      where: { department, isApproved: true },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }

  async findOne(id: string) {
    const example = await this.prisma.conversationExample.findUnique({
      where: { id },
    });

    if (!example) {
      throw new NotFoundException('Conversation example not found');
    }

    return example;
  }

  async create(dto: CreateConversationExampleDto, userId: string) {
    const example = await this.prisma.conversationExample.create({
      data: {
        title: dto.title,
        department: dto.department,
        transcript: dto.transcript,
        summary: dto.summary,
        goodPractices: dto.goodPractices,
        badPractices: dto.badPractices,
        tags: dto.tags ?? [],
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'create',
      entityType: 'conversation_example',
      entityId: example.id,
    });

    return example;
  }

  async approve(id: string, userId: string) {
    await this.findOne(id);

    const example = await this.prisma.conversationExample.update({
      where: { id },
      data: { isApproved: true },
    });

    await this.auditLogsService.log({
      userId,
      action: 'activate',
      entityType: 'conversation_example',
      entityId: id,
    });

    return example;
  }
}
