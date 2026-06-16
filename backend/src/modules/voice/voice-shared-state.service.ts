import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { VoiceSessionResponse } from './voice-session.service';

const AUTH_TTL_SECONDS = 30 * 60;
const RECENT_SESSIONS_MAX = 100;
const SESSION_REDIS_TTL_SECONDS = 7 * 24 * 60 * 60;

export type SharedVoiceCallSource =
  | 'test-call'
  | 'integration'
  | 'campaign'
  | 'manual';

export interface SharedPendingAuthorization {
  authorizationId: string;
  source: SharedVoiceCallSource;
  customerNumber?: string;
  callSid?: string;
  callId?: string;
  openingContext?: Record<string, unknown>;
  registeredAt: Date;
  expiresAt: Date;
  consumed: boolean;
}

export interface SharedAuthorizationMatch {
  authorized: true;
  authorizationId: string;
  source: SharedVoiceCallSource;
  callId?: string;
}

@Injectable()
export class VoiceSharedStateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceSharedStateService.name);
  private redis: Redis | null = null;
  private redisReady = false;

  constructor(private readonly configService: ConfigService) {}

  isRedisEnabled(): boolean {
    return this.configService.get<string>('REDIS_ENABLED') !== 'false';
  }

  async onModuleInit(): Promise<void> {
    if (!this.isRedisEnabled()) {
      this.logger.warn(
        'REDIS_ENABLED=false — voice auth and session history are in-memory only (not safe behind load balancers)',
      );
      return;
    }

    this.redis = new Redis({
      host: this.configService.getOrThrow<string>('REDIS_HOST'),
      port: this.configService.getOrThrow<number>('REDIS_PORT'),
      maxRetriesPerRequest: 2,
      connectTimeout: 3000,
      lazyConnect: true,
    });

    try {
      await this.redis.connect();
      await this.redis.ping();
      this.redisReady = true;
      this.logger.log('Voice shared state using Redis');
    } catch (error) {
      this.logger.error(
        { err: error },
        'Redis unavailable — falling back to in-memory voice state',
      );
      await this.redis.quit().catch(() => undefined);
      this.redis = null;
      this.redisReady = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
    }
  }

  get usesRedis(): boolean {
    return this.redisReady && this.redis !== null;
  }

  async saveAuthorization(entry: SharedPendingAuthorization): Promise<void> {
    if (!this.redisReady || !this.redis) {
      return;
    }

    const ttlMs = entry.expiresAt.getTime() - Date.now();
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    const payload = JSON.stringify({
      ...entry,
      registeredAt: entry.registeredAt.toISOString(),
      expiresAt: entry.expiresAt.toISOString(),
    });

    const pipeline = this.redis.pipeline();
    pipeline.set(`voice:auth:${entry.authorizationId}`, payload, 'EX', ttlSeconds);

    if (entry.callSid) {
      pipeline.set(`voice:auth:callSid:${entry.callSid}`, entry.authorizationId, 'EX', ttlSeconds);
    }

    if (entry.customerNumber) {
      pipeline.lpush(`voice:auth:phone:${entry.customerNumber}`, entry.authorizationId);
      pipeline.expire(`voice:auth:phone:${entry.customerNumber}`, AUTH_TTL_SECONDS);
    }

    await pipeline.exec();
  }

  async loadAuthorization(
    authorizationId: string,
  ): Promise<SharedPendingAuthorization | undefined> {
    if (!this.redisReady || !this.redis) {
      return undefined;
    }

    const raw = await this.redis.get(`voice:auth:${authorizationId}`);
    return raw ? this.parseAuthorization(raw) : undefined;
  }

  async loadAuthorizationByCallSid(
    callSid: string,
  ): Promise<SharedPendingAuthorization | undefined> {
    if (!this.redisReady || !this.redis) {
      return undefined;
    }

    const authorizationId = await this.redis.get(`voice:auth:callSid:${callSid}`);
    if (!authorizationId) {
      return undefined;
    }

    return this.loadAuthorization(authorizationId);
  }

  async loadLatestAuthorizationByPhone(
    phone: string,
  ): Promise<SharedPendingAuthorization | undefined> {
    if (!this.redisReady || !this.redis) {
      return undefined;
    }

    const ids = await this.redis.lrange(`voice:auth:phone:${phone}`, 0, 10);
    for (const authorizationId of ids) {
      const entry = await this.loadAuthorization(authorizationId);
      if (entry && !entry.consumed && entry.expiresAt.getTime() > Date.now()) {
        return entry;
      }
    }

    return undefined;
  }

  async markAuthorizationConsumed(authorizationId: string): Promise<void> {
    if (!this.redisReady || !this.redis) {
      return;
    }

    const entry = await this.loadAuthorization(authorizationId);
    if (!entry) {
      return;
    }

    entry.consumed = true;
    await this.saveAuthorization(entry);
  }

  async removeAuthorization(entry: SharedPendingAuthorization): Promise<void> {
    if (!this.redisReady || !this.redis) {
      return;
    }

    const pipeline = this.redis.pipeline();
    pipeline.del(`voice:auth:${entry.authorizationId}`);
    if (entry.callSid) {
      pipeline.del(`voice:auth:callSid:${entry.callSid}`);
    }
    if (entry.customerNumber) {
      pipeline.lrem(
        `voice:auth:phone:${entry.customerNumber}`,
        0,
        entry.authorizationId,
      );
    }
    await pipeline.exec();
  }

  async saveEndedSession(session: VoiceSessionResponse): Promise<void> {
    if (!this.redisReady || !this.redis || !session.streamSid || session.isAppInitiated !== true) {
      return;
    }

    const endedAtMs = session.endedAt
      ? new Date(session.endedAt).getTime()
      : Date.now();
    const payload = JSON.stringify(session);

    const pipeline = this.redis.pipeline();
    pipeline.set(
      `voice:session:${session.streamSid}`,
      payload,
      'EX',
      SESSION_REDIS_TTL_SECONDS,
    );
    pipeline.zadd('voice:sessions:recent', endedAtMs, session.streamSid);
    pipeline.zremrangebyrank('voice:sessions:recent', 0, -(RECENT_SESSIONS_MAX + 1));
    await pipeline.exec();
  }

  async listRecentEndedSessions(): Promise<VoiceSessionResponse[]> {
    if (!this.redisReady || !this.redis) {
      return [];
    }

    const streamSids = await this.redis.zrevrange('voice:sessions:recent', 0, RECENT_SESSIONS_MAX - 1);
    if (streamSids.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();
    for (const streamSid of streamSids) {
      pipeline.get(`voice:session:${streamSid}`);
    }

    const results = await pipeline.exec();
    const sessions: VoiceSessionResponse[] = [];

    for (const result of results ?? []) {
      const [, raw] = result ?? [];
      if (typeof raw === 'string' && raw.length > 0) {
        try {
          sessions.push(JSON.parse(raw) as VoiceSessionResponse);
        } catch {
          // skip corrupt entry
        }
      }
    }

    return sessions.filter((session) => session.isAppInitiated === true);
  }

  async getEndedSessionByStreamSid(
    streamSid: string,
  ): Promise<VoiceSessionResponse | undefined> {
    if (!this.redisReady || !this.redis) {
      return undefined;
    }

    const raw = await this.redis.get(`voice:session:${streamSid}`);
    if (!raw) {
      return undefined;
    }

    try {
      return JSON.parse(raw) as VoiceSessionResponse;
    } catch {
      return undefined;
    }
  }

  private parseAuthorization(raw: string): SharedPendingAuthorization | undefined {
    try {
      const parsed = JSON.parse(raw) as SharedPendingAuthorization & {
        registeredAt: string;
        expiresAt: string;
      };
      return {
        ...parsed,
        registeredAt: new Date(parsed.registeredAt),
        expiresAt: new Date(parsed.expiresAt),
      };
    } catch {
      return undefined;
    }
  }

  toAuthorizationMatch(
    entry: SharedPendingAuthorization,
  ): SharedAuthorizationMatch {
    return {
      authorized: true,
      authorizationId: entry.authorizationId,
      source: entry.source,
      callId: entry.callId,
    };
  }
}
