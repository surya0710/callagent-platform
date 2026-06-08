import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CampaignStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CampaignCallProcessor } from '../../queues/processors/campaign-call.processor';
import { CallRetryProcessor } from '../../queues/processors/call-retry.processor';
import { QueueService } from '../../queues/queue.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AddCustomersDto } from './dto/add-customers.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ScheduleCampaignDto } from './dto/schedule-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly queueService: QueueService,
    private readonly campaignCallProcessor: CampaignCallProcessor,
    private readonly callRetryProcessor: CallRetryProcessor,
  ) {}

  async findAll(query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.CampaignWhereInput = query.search
      ? { name: { contains: query.search } }
      : {};

    const [data, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { customers: true, calls: true } },
          agentPrompt: { select: { id: true, name: true } },
        },
      }),
      this.prisma.campaign.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async findOne(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        customers: {
          include: { customer: true },
        },
        agentPrompt: true,
        _count: { select: { calls: true } },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    return campaign;
  }

  async create(dto: CreateCampaignDto, userId: string) {
    const campaign = await this.prisma.campaign.create({
      data: {
        name: dto.name,
        description: dto.description,
        agentPromptId: dto.agentPromptId,
        createdById: userId,
        status: CampaignStatus.draft,
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'create',
      entityType: 'campaign',
      entityId: campaign.id,
    });

    return campaign;
  }

  async update(id: string, dto: UpdateCampaignDto, userId: string) {
    const campaign = await this.findOne(id);

    if (
      campaign.status !== CampaignStatus.draft &&
      campaign.status !== CampaignStatus.paused
    ) {
      throw new BadRequestException(
        'Only draft or paused campaigns can be updated',
      );
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: dto,
    });

    await this.auditLogsService.log({
      userId,
      action: 'update',
      entityType: 'campaign',
      entityId: id,
    });

    return updated;
  }

  async addCustomers(id: string, dto: AddCustomersDto, userId: string) {
    await this.findOne(id);

    const customers = await this.prisma.customer.findMany({
      where: { id: { in: dto.customerIds }, deletedAt: null },
    });

    if (customers.length !== dto.customerIds.length) {
      throw new BadRequestException('One or more customers not found');
    }

    await this.prisma.campaignCustomer.createMany({
      data: dto.customerIds.map((customerId) => ({
        campaignId: id,
        customerId,
      })),
      skipDuplicates: true,
    });

    await this.auditLogsService.log({
      userId,
      action: 'update',
      entityType: 'campaign',
      entityId: id,
      metadata: { addedCustomers: dto.customerIds.length },
    });

    return this.findOne(id);
  }

  async schedule(id: string, dto: ScheduleCampaignDto, userId: string) {
    const campaign = await this.findOne(id);

    if (
      campaign.status !== CampaignStatus.draft &&
      campaign.status !== CampaignStatus.paused
    ) {
      throw new BadRequestException('Campaign cannot be scheduled in current status');
    }

    if (campaign.customers.length === 0) {
      throw new BadRequestException('Add customers before scheduling');
    }

    const scheduledAt = dto.scheduledAt ?? new Date();

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        status: CampaignStatus.scheduled,
        scheduledAt,
      },
    });

    for (const cc of campaign.customers) {
      const payload = {
        campaignId: id,
        customerId: cc.customerId,
        phone: cc.customer.phone,
        scheduledAt: scheduledAt.toISOString(),
      };
      const result = await this.queueService.enqueueCampaignCall(payload);
      if (!result.queued) {
        await this.campaignCallProcessor.process(payload);
      }
    }

    await this.auditLogsService.log({
      userId,
      action: 'schedule',
      entityType: 'campaign',
      entityId: id,
      metadata: { scheduledAt: scheduledAt.toISOString() },
    });

    return updated;
  }

  async pause(id: string, userId: string) {
    const campaign = await this.findOne(id);

    if (
      campaign.status !== CampaignStatus.running &&
      campaign.status !== CampaignStatus.scheduled
    ) {
      throw new BadRequestException('Only running or scheduled campaigns can be paused');
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.paused },
    });

    await this.auditLogsService.log({
      userId,
      action: 'pause',
      entityType: 'campaign',
      entityId: id,
    });

    return updated;
  }

  async resume(id: string, userId: string) {
    const campaign = await this.findOne(id);

    if (campaign.status !== CampaignStatus.paused) {
      throw new BadRequestException('Only paused campaigns can be resumed');
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.running, startedAt: new Date() },
    });

    await this.auditLogsService.log({
      userId,
      action: 'resume',
      entityType: 'campaign',
      entityId: id,
    });

    return updated;
  }

  async retryFailed(id: string, userId: string) {
    const campaign = await this.findOne(id);

    const failedCalls = await this.prisma.call.findMany({
      where: {
        campaignId: id,
        status: { in: ['failed', 'no_answer', 'busy'] },
      },
    });

    for (const call of failedCalls) {
      const payload = {
        callId: call.id,
        campaignId: id,
        customerId: call.customerId,
        phone: call.phone,
      };
      const result = await this.queueService.enqueueCallRetry(payload);
      if (!result.queued) {
        await this.callRetryProcessor.process(payload);
      }
    }

    await this.auditLogsService.log({
      userId,
      action: 'retry',
      entityType: 'campaign',
      entityId: id,
      metadata: { retriedCalls: failedCalls.length },
    });

    return { campaignId: id, retriedCalls: failedCalls.length };
  }
}
