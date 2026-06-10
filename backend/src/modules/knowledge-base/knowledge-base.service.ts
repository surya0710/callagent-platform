import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateKnowledgeBaseEntryDto } from './dto/create-knowledge-base-entry.dto';
import { KnowledgeBaseQueryDto } from './dto/knowledge-base-query.dto';
import { UpdateKnowledgeBaseEntryDto } from './dto/update-knowledge-base-entry.dto';

@Injectable()
export class KnowledgeBaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async findAll(query: KnowledgeBaseQueryDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.KnowledgeBaseEntryWhereInput = {};

    if (query.department) {
      where.department = query.department;
    }

    if (query.category) {
      where.category = query.category;
    }

    if (query.search) {
      where.OR = [
        { title: { contains: query.search } },
        { content: { contains: query.search } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.knowledgeBaseEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.knowledgeBaseEntry.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findOne(id: string) {
    const entry = await this.prisma.knowledgeBaseEntry.findUnique({
      where: { id },
    });

    if (!entry) {
      throw new NotFoundException('Knowledge base entry not found');
    }

    return entry;
  }

  async create(dto: CreateKnowledgeBaseEntryDto, userId: string) {
    const entry = await this.prisma.knowledgeBaseEntry.create({
      data: {
        title: dto.title,
        content: dto.content,
        department: dto.department,
        category: dto.category,
        tags: dto.tags ?? [],
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'create',
      entityType: 'knowledge_base_entry',
      entityId: entry.id,
    });

    return entry;
  }

  async update(id: string, dto: UpdateKnowledgeBaseEntryDto, userId: string) {
    await this.findOne(id);

    const entry = await this.prisma.knowledgeBaseEntry.update({
      where: { id },
      data: dto,
    });

    await this.auditLogsService.log({
      userId,
      action: 'update',
      entityType: 'knowledge_base_entry',
      entityId: id,
    });

    return entry;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);

    await this.prisma.knowledgeBaseEntry.delete({ where: { id } });

    await this.auditLogsService.log({
      userId,
      action: 'delete',
      entityType: 'knowledge_base_entry',
      entityId: id,
    });

    return { deleted: true };
  }
}
