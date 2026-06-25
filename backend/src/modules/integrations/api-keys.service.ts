import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';

const KEY_PREFIX = 'avp_';

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
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { calls: true } },
      },
    });

    return keys;
  }

  async create(name: string, webhookUrl?: string) {
    const rawKey = `${KEY_PREFIX}${randomBytes(24).toString('hex')}`;
    const keyPrefix = rawKey.slice(0, 12);
    const keyHash = await bcrypt.hash(rawKey, this.saltRounds);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        name,
        keyPrefix,
        keyHash,
        webhookUrl: webhookUrl?.trim() || null,
      },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      webhookUrl: apiKey.webhookUrl,
      apiKey: rawKey,
      message: 'Store this API key securely. It will not be shown again.',
    };
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

  /** Deterministic lookup helper for logging without storing raw keys */
  hashForAudit(rawKey: string) {
    return createHash('sha256').update(rawKey).digest('hex').slice(0, 12);
  }
}
