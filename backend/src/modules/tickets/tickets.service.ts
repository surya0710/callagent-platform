import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async findAll(query: TicketQueryDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.TicketWhereInput = {};

    if (query.customerId) {
      where.customerId = query.customerId;
    }

    if (query.status) {
      where.status = query.status;
    }

    const [data, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
      }),
      this.prisma.ticket.count({ where }),
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
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
        call: {
          select: {
            id: true,
            status: true,
            callPurpose: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return ticket;
  }

  async create(dto: CreateTicketDto, userId?: string) {
    const ticket = await this.prisma.ticket.create({
      data: {
        customerId: dto.customerId,
        callId: dto.callId,
        issueCategory: dto.issueCategory,
        issueSummary: dto.issueSummary,
        priority: dto.priority ?? 'medium',
        source: dto.source,
      },
    });

    if (userId) {
      await this.auditLogsService.log({
        userId,
        action: 'create',
        entityType: 'ticket',
        entityId: ticket.id,
      });
    }

    return ticket;
  }

  async updateStatus(id: string, status: TicketStatus, userId: string) {
    await this.findOne(id);

    const ticket = await this.prisma.ticket.update({
      where: { id },
      data: { status },
    });

    await this.auditLogsService.log({
      userId,
      action: 'update',
      entityType: 'ticket',
      entityId: id,
      metadata: { status },
    });

    return ticket;
  }
}
