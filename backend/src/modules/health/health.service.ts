import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { isSentryTestAllowed } from '../../common/sentry/sentry.util';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'ai-voice-platform-api',
      environment: this.configService.get<string>('NODE_ENV'),
    };
  }

  sentryTest() {
    if (!isSentryTestAllowed()) {
      return {
        status: 'disabled',
        message: 'Sentry test endpoint is disabled in production',
      };
    }

    throw new Error('Sentry test error from /api/health/sentry-test');
  }

  async checkDatabase() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'connected' };
    } catch (error) {
      return {
        status: 'error',
        database: 'disconnected',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async checkRedis() {
    const redis = new Redis({
      host: this.configService.getOrThrow<string>('REDIS_HOST'),
      port: this.configService.getOrThrow<number>('REDIS_PORT'),
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });

    try {
      await redis.connect();
      const pong = await redis.ping();
      await redis.quit();
      return { status: pong === 'PONG' ? 'ok' : 'error', redis: pong };
    } catch (error) {
      await redis.quit().catch(() => undefined);
      return {
        status: 'error',
        redis: 'disconnected',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
