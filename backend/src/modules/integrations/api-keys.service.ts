import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ApiKeyWebhookAuthType, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { ApiKeyWebhookAuthTypeDto } from './dto/api-key-webhook-config.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';

const KEY_PREFIX = 'avp_';

export interface ApiKeyWebhookInput {
  webhookUrl?: string;
  webhookAuthType?: ApiKeyWebhookAuthTypeDto;
  webhookAuthHeaderName?: string;
  webhookAuthToken?: string;
}

@Injectable()
export class ApiKeysService {
  private readonly saltRounds = 10;

  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const keys = await this.prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        webhookUrl: true,
        webhookAuthType: true,
        webhookAuthHeaderName: true,
        webhookAuthToken: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { calls: true } },
      },
    });

    return keys.map((key) => this.formatListItem(key));
  }

  async create(dto: CreateApiKeyDto) {
    const rawKey = `${KEY_PREFIX}${randomBytes(24).toString('hex')}`;
    const keyPrefix = rawKey.slice(0, 12);
    const keyHash = await bcrypt.hash(rawKey, this.saltRounds);
    const webhookData = this.normalizeWebhookInput(dto, { requireToken: false });

    const apiKey = await this.prisma.apiKey.create({
      data: {
        name: dto.name.trim(),
        keyPrefix,
        keyHash,
        ...webhookData,
      },
    });

    return {
      ...this.formatListItem(apiKey),
      apiKey: rawKey,
      message: 'Store this API key securely. It will not be shown again.',
    };
  }

  async update(id: string, dto: UpdateApiKeyDto) {
    await this.findById(id);

    const data: Prisma.ApiKeyUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }

    if (dto.webhookUrl !== undefined) {
      data.webhookUrl = dto.webhookUrl.trim() || null;
    }

    if (dto.webhookAuthType !== undefined) {
      data.webhookAuthType = dto.webhookAuthType as ApiKeyWebhookAuthType;
    }

    if (dto.webhookAuthHeaderName !== undefined) {
      data.webhookAuthHeaderName = dto.webhookAuthHeaderName.trim() || null;
    }

    if (dto.clearWebhookAuthToken) {
      data.webhookAuthToken = null;
    } else if (dto.webhookAuthToken !== undefined) {
      data.webhookAuthToken = dto.webhookAuthToken.trim() || null;
    }

    if (
      dto.webhookAuthType === ApiKeyWebhookAuthTypeDto.none &&
      dto.webhookAuthToken === undefined &&
      !dto.clearWebhookAuthToken
    ) {
      data.webhookAuthToken = null;
      data.webhookAuthHeaderName = null;
    }

    const apiKey = await this.prisma.apiKey.update({
      where: { id },
      data,
    });

    return this.formatListItem(apiKey);
  }

  async revoke(id: string) {
    await this.findById(id);
    return this.prisma.apiKey.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async validateKey(rawKey: string) {
    if (!rawKey.startsWith(KEY_PREFIX)) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const keyPrefix = rawKey.slice(0, 12);
    const candidates = await this.prisma.apiKey.findMany({
      where: { keyPrefix, isActive: true },
    });

    for (const candidate of candidates) {
      const valid = await bcrypt.compare(rawKey, candidate.keyHash);
      if (valid) {
        return candidate;
      }
    }

    throw new UnauthorizedException('Invalid or inactive API key');
  }

  async findById(id: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) {
      throw new NotFoundException('API key not found');
    }
    return key;
  }

  hashForAudit(rawKey: string) {
    return createHash('sha256').update(rawKey).digest('hex').slice(0, 12);
  }

  private normalizeWebhookInput(
    input: ApiKeyWebhookInput,
    options: { requireToken: boolean },
  ): Pick<
    Prisma.ApiKeyCreateInput,
    'webhookUrl' | 'webhookAuthType' | 'webhookAuthHeaderName' | 'webhookAuthToken'
  > {
    const webhookAuthType =
      (input.webhookAuthType as ApiKeyWebhookAuthType | undefined) ??
      ApiKeyWebhookAuthType.none;
    const webhookUrl = input.webhookUrl?.trim() || null;
    const webhookAuthToken = input.webhookAuthToken?.trim() || null;
    const webhookAuthHeaderName =
      webhookAuthType === ApiKeyWebhookAuthType.header
        ? input.webhookAuthHeaderName?.trim() || 'X-API-Key'
        : null;

    return {
      webhookUrl,
      webhookAuthType,
      webhookAuthHeaderName,
      webhookAuthToken:
        webhookAuthType === ApiKeyWebhookAuthType.none ? null : webhookAuthToken,
    };
  }

  private formatListItem(key: {
    id: string;
    name: string;
    keyPrefix: string;
    webhookUrl: string | null;
    webhookAuthType: ApiKeyWebhookAuthType;
    webhookAuthHeaderName: string | null;
    webhookAuthToken: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count?: { calls: number };
  }) {
    return {
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      webhookUrl: key.webhookUrl,
      webhookAuthType: key.webhookAuthType,
      webhookAuthHeaderName: key.webhookAuthHeaderName,
      hasWebhookAuthToken: Boolean(key.webhookAuthToken),
      isActive: key.isActive,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
      _count: key._count,
    };
  }
}
