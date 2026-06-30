import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface UpdateAgentPlaybookDto {
  title?: string;
  description?: string | null;
  playbookText?: string;
  agentInstructions?: string;
  commonObjectionsJson?: Prisma.InputJsonValue | null;
  objectionResponsesJson?: Prisma.InputJsonValue | null;
  winningPhrasesJson?: Prisma.InputJsonValue | null;
  badPhrasesJson?: Prisma.InputJsonValue | null;
  qualificationSignalsJson?: Prisma.InputJsonValue | null;
  followUpRulesJson?: Prisma.InputJsonValue | null;
  safetyRulesJson?: Prisma.InputJsonValue | null;
}

export interface RuntimeAgentPlaybook {
  id: string;
  title: string;
  version: number;
  playbookText: string;
  agentInstructions: string;
  commonObjectionsJson: unknown;
  objectionResponsesJson: unknown;
  winningPhrasesJson: unknown;
  badPhrasesJson: unknown;
  qualificationSignalsJson: unknown;
  followUpRulesJson: unknown;
  safetyRulesJson: unknown;
}

interface RuntimeCache {
  expiresAt: number;
  playbook: RuntimeAgentPlaybook | null;
}

@Injectable()
export class AgentPlaybookService {
  private readonly logger = new Logger(AgentPlaybookService.name);
  private runtimeCache?: RuntimeCache;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async listPlaybooks() {
    const playbooks = await this.prisma.agentPlaybook.findMany({
      orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
    });

    // Pin the active playbook to the top, keep the rest in latest-version-first
    // order (Array.prototype.sort is stable, so version desc is preserved).
    return playbooks.sort((a, b) => {
      const aActive = a.status === 'active' ? 1 : 0;
      const bActive = b.status === 'active' ? 1 : 0;
      return bActive - aActive;
    });
  }

  async getActivePlaybook() {
    return this.prisma.agentPlaybook.findFirst({
      where: { status: 'active' },
      orderBy: { activatedAt: 'desc' },
    });
  }

  async createFromInsightReport(insightReportId: string) {
    const report = await this.prisma.trainingInsightReport.findUnique({
      where: { id: insightReportId },
    });

    if (!report) {
      throw new NotFoundException('Training insight report not found');
    }

    if (!['completed', 'approved'].includes(report.status)) {
      throw new BadRequestException(
        'Only completed or approved insight reports can create playbooks',
      );
    }

    const playbookText = report.recommendedPlaybook?.trim();
    const agentInstructions = report.aiAgentInstructions?.trim();

    if (!playbookText || !agentInstructions) {
      throw new BadRequestException(
        'Insight report does not include a generated playbook and AI instructions',
      );
    }

    const version = await this.nextVersionForSource(insightReportId);
    const playbook = await this.prisma.agentPlaybook.create({
      data: {
        title: `${report.title} Playbook v${version}`,
        description:
          'Generated from approved Training Call Intelligence aggregate insights.',
        sourceInsightReportId: report.id,
        status: 'draft',
        version,
        playbookText,
        agentInstructions,
        commonObjectionsJson: this.toJsonInput(report.commonObjectionsJson),
        objectionResponsesJson: this.toJsonInput(report.commonObjectionsJson),
        winningPhrasesJson: this.toJsonInput(report.winningPhrasesJson),
        badPhrasesJson: this.toJsonInput(report.badPhrasesJson),
        qualificationSignalsJson: this.toJsonInput(
          report.qualificationSignalsJson,
        ),
        followUpRulesJson: this.toJsonInput(report.followUpPatternsJson),
      },
    });

    this.invalidateRuntimeCache();
    return playbook;
  }

  async approvePlaybook(id: string, userId: string) {
    const playbook = await this.findOrThrow(id);
    if (playbook.status === 'archived') {
      throw new BadRequestException('Archived playbooks cannot be approved');
    }

    const approved = await this.prisma.agentPlaybook.update({
      where: { id },
      data: {
        status: playbook.status === 'active' ? 'active' : 'approved',
        approvedBy: userId,
        approvedAt: new Date(),
      },
    });

    this.invalidateRuntimeCache();
    return approved;
  }

  async activatePlaybook(id: string, userId: string) {
    const playbook = await this.findOrThrow(id);
    if (playbook.status !== 'approved' && playbook.status !== 'active') {
      throw new BadRequestException('Only approved playbooks can be activated');
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.agentPlaybook.updateMany({
        where: { status: 'active', id: { not: id } },
        data: { status: 'archived' },
      }),
      this.prisma.agentPlaybook.update({
        where: { id },
        data: {
          status: 'active',
          approvedBy: playbook.approvedBy ?? userId,
          approvedAt: playbook.approvedAt ?? now,
          activatedAt: now,
        },
      }),
    ]);

    this.invalidateRuntimeCache();
    this.logger.log({
      playbookId: id,
      version: playbook.version,
      message: 'agent_playbook_activated',
    });
    return this.findOrThrow(id);
  }

  async archivePlaybook(id: string) {
    const playbook = await this.findOrThrow(id);
    if (playbook.status === 'archived') {
      return playbook;
    }

    const archived = await this.prisma.agentPlaybook.update({
      where: { id },
      data: { status: 'archived' },
    });

    this.invalidateRuntimeCache();
    this.logger.log({
      playbookId: id,
      version: playbook.version,
      message: 'agent_playbook_archived',
    });
    return archived;
  }

  async updateDraftPlaybook(id: string, dto: UpdateAgentPlaybookDto) {
    const playbook = await this.findOrThrow(id);
    if (playbook.status !== 'draft') {
      throw new BadRequestException('Only draft playbooks can be edited');
    }

    const data = this.buildUpdateData(dto);
    if (Object.keys(data).length === 0) {
      return playbook;
    }

    const updated = await this.prisma.agentPlaybook.update({
      where: { id },
      data,
    });

    this.invalidateRuntimeCache();
    return updated;
  }

  async duplicatePlaybook(id: string) {
    const playbook = await this.findOrThrow(id);
    const version = await this.nextVersionForSource(
      playbook.sourceInsightReportId,
      playbook.version,
    );

    const duplicate = await this.prisma.agentPlaybook.create({
      data: {
        title: `${playbook.title.replace(/\s+v\d+$/i, '')} v${version}`,
        description: playbook.description,
        sourceInsightReportId: playbook.sourceInsightReportId,
        status: 'draft',
        version,
        playbookText: playbook.playbookText,
        agentInstructions: playbook.agentInstructions,
        commonObjectionsJson: this.toJsonInput(playbook.commonObjectionsJson),
        objectionResponsesJson: this.toJsonInput(
          playbook.objectionResponsesJson,
        ),
        winningPhrasesJson: this.toJsonInput(playbook.winningPhrasesJson),
        badPhrasesJson: this.toJsonInput(playbook.badPhrasesJson),
        qualificationSignalsJson: this.toJsonInput(
          playbook.qualificationSignalsJson,
        ),
        followUpRulesJson: this.toJsonInput(playbook.followUpRulesJson),
        safetyRulesJson: this.toJsonInput(playbook.safetyRulesJson),
      },
    });

    this.invalidateRuntimeCache();
    return duplicate;
  }

  async getActivePlaybookForRuntime(): Promise<RuntimeAgentPlaybook | null> {
    if (!this.isPlaybookRuntimeEnabled()) {
      return null;
    }

    const now = Date.now();
    if (this.runtimeCache && this.runtimeCache.expiresAt > now) {
      return this.runtimeCache.playbook;
    }

    try {
      const playbook = await this.prisma.agentPlaybook.findFirst({
        where: { status: 'active' },
        orderBy: { activatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          version: true,
          playbookText: true,
          agentInstructions: true,
          commonObjectionsJson: true,
          objectionResponsesJson: true,
          winningPhrasesJson: true,
          badPhrasesJson: true,
          qualificationSignalsJson: true,
          followUpRulesJson: true,
          safetyRulesJson: true,
        },
      });

      if (!playbook) {
        this.logger.log({ message: 'voice_playbook_missing' });
      } else {
        this.logger.log({
          playbookId: playbook.id,
          version: playbook.version,
          message: 'voice_playbook_loaded',
        });
      }

      this.runtimeCache = {
        expiresAt: now + this.getRuntimeCacheTtlMs(),
        playbook,
      };
      return playbook;
    } catch (error) {
      this.runtimeCache = undefined;
      this.logger.error({
        err: error,
        message: 'voice_playbook_load_error',
      });
      throw error;
    }
  }

  isPlaybookRuntimeEnabled(): boolean {
    return this.readBoolean('VOICE_AGENT_PLAYBOOK_ENABLED', true);
  }

  shouldFailOpenRuntime(): boolean {
    return this.readBoolean('VOICE_AGENT_PLAYBOOK_FAIL_OPEN', true);
  }

  private async findOrThrow(id: string) {
    const playbook = await this.prisma.agentPlaybook.findUnique({ where: { id } });
    if (!playbook) {
      throw new NotFoundException('Agent playbook not found');
    }
    return playbook;
  }

  private async nextVersionForSource(
    sourceInsightReportId: string | null,
    fallbackVersion = 0,
  ): Promise<number> {
    const where = sourceInsightReportId
      ? { sourceInsightReportId }
      : undefined;
    const latest = await this.prisma.agentPlaybook.findFirst({
      where,
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return Math.max(latest?.version ?? 0, fallbackVersion) + 1;
  }

  private buildUpdateData(
    dto: UpdateAgentPlaybookDto,
  ): Prisma.AgentPlaybookUpdateInput {
    const data: Prisma.AgentPlaybookUpdateInput = {};

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) {
        throw new BadRequestException('Title is required');
      }
      data.title = title;
    }
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() || null;
    }
    if (dto.playbookText !== undefined) {
      const playbookText = dto.playbookText.trim();
      if (!playbookText) {
        throw new BadRequestException('Playbook text is required');
      }
      data.playbookText = playbookText;
    }
    if (dto.agentInstructions !== undefined) {
      const agentInstructions = dto.agentInstructions.trim();
      if (!agentInstructions) {
        throw new BadRequestException('Agent instructions are required');
      }
      data.agentInstructions = agentInstructions;
    }

    this.assignJson(data, 'commonObjectionsJson', dto.commonObjectionsJson);
    this.assignJson(data, 'objectionResponsesJson', dto.objectionResponsesJson);
    this.assignJson(data, 'winningPhrasesJson', dto.winningPhrasesJson);
    this.assignJson(data, 'badPhrasesJson', dto.badPhrasesJson);
    this.assignJson(
      data,
      'qualificationSignalsJson',
      dto.qualificationSignalsJson,
    );
    this.assignJson(data, 'followUpRulesJson', dto.followUpRulesJson);
    this.assignJson(data, 'safetyRulesJson', dto.safetyRulesJson);

    return data;
  }

  private assignJson(
    data: Prisma.AgentPlaybookUpdateInput,
    key:
      | 'commonObjectionsJson'
      | 'objectionResponsesJson'
      | 'winningPhrasesJson'
      | 'badPhrasesJson'
      | 'qualificationSignalsJson'
      | 'followUpRulesJson'
      | 'safetyRulesJson',
    value: Prisma.InputJsonValue | null | undefined,
  ) {
    if (value !== undefined) {
      data[key] = value === null ? Prisma.JsonNull : value;
    }
  }

  private toJsonInput(value: unknown): Prisma.InputJsonValue | undefined {
    return value === null || value === undefined
      ? undefined
      : (value as Prisma.InputJsonValue);
  }

  private invalidateRuntimeCache() {
    this.runtimeCache = undefined;
  }

  private getRuntimeCacheTtlMs(): number {
    const raw = this.configService.get<string>(
      'VOICE_AGENT_PLAYBOOK_CACHE_TTL_SECONDS',
    );
    const seconds = Number.parseInt(raw ?? '60', 10);
    return Math.max(Number.isFinite(seconds) ? seconds : 60, 0) * 1000;
  }

  private readBoolean(name: string, fallback: boolean): boolean {
    const raw = this.configService.get<string>(name);
    if (raw === undefined) {
      return fallback;
    }
    return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
  }
}
