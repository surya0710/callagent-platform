import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { normalizeVoicePhoneNumber } from './voice-phone.util';
import {
  SharedPendingAuthorization,
  VoiceSharedStateService,
} from './voice-shared-state.service';
import { CallContext } from './voice-call-context.types';
import { VoiceOpeningContext } from './voice-opening.types';

export type VoiceCallSource =
  | 'test-call'
  | 'integration'
  | 'campaign'
  | 'manual';

export interface RegisterAuthorizedVoiceCallInput {
  source: VoiceCallSource;
  customerNumber?: string;
  callSid?: string;
  callId?: string;
  openingContext?: Partial<VoiceOpeningContext>;
  callContext?: CallContext;
}

export interface VoiceCallAuthorizationMatch {
  authorized: true;
  authorizationId: string;
  source: VoiceCallSource;
  callId?: string;
  openingContext?: Partial<VoiceOpeningContext>;
  callContext?: CallContext;
}

export interface VoiceCallAuthorizationReject {
  authorized: false;
  reason: string;
}

export type VoiceCallAuthorizationResult =
  | VoiceCallAuthorizationMatch
  | VoiceCallAuthorizationReject;

interface PendingAuthorization {
  authorizationId: string;
  source: VoiceCallSource;
  customerNumber?: string;
  callSid?: string;
  callId?: string;
  openingContext?: Partial<VoiceOpeningContext>;
  callContext?: CallContext;
  registeredAt: Date;
  expiresAt: Date;
  consumed: boolean;
}

export interface VoiceCallStartAuthorizationInput {
  streamSid: string;
  callSid?: string;
  from?: string;
  to?: string;
  customParameters?: unknown;
  /** From Exotel dynamic stream-url WSS query (?authorizationId=...) */
  authorizationId?: string;
}

const DEFAULT_AUTHORIZATION_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_AUTHORIZATIONS = 500;

@Injectable()
export class VoiceCallAuthorizationService {
  private readonly logger = new Logger(VoiceCallAuthorizationService.name);
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly pendingByCallSid = new Map<string, string>();
  private readonly pendingByPhone = new Map<string, string[]>();
  /** Populated when Exotel stream-url resolver matches a pending authorization. */
  private readonly streamUrlAuthorizationByCallSid = new Map<string, string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly voiceSharedStateService: VoiceSharedStateService,
  ) {}

  isAuthorizationRequired(): boolean {
    const raw = this.configService
      .get<string>('VOICE_REQUIRE_APP_AUTHORIZATION')
      ?.trim()
      .toLowerCase();

    if (raw === 'true') {
      return true;
    }
    if (raw === 'false') {
      return false;
    }

    return this.configService.get<string>('NODE_ENV') === 'production';
  }

  register(input: RegisterAuthorizedVoiceCallInput): string {
    this.pruneExpired();

    const authorizationId = randomUUID();
    const registeredAt = new Date();
    const customerNumber = normalizeVoicePhoneNumber(input.customerNumber);
    const callSid = input.callSid?.trim() || undefined;

    const entry: PendingAuthorization = {
      authorizationId,
      source: input.source,
      customerNumber,
      callSid,
      callId: input.callId,
      openingContext: input.openingContext,
      callContext: input.callContext,
      registeredAt,
      expiresAt: new Date(Date.now() + DEFAULT_AUTHORIZATION_TTL_MS),
      consumed: false,
    };

    this.pending.set(authorizationId, entry);

    if (callSid) {
      this.pendingByCallSid.set(callSid, authorizationId);
    }

    if (customerNumber) {
      const phoneList = this.pendingByPhone.get(customerNumber) ?? [];
      phoneList.unshift(authorizationId);
      this.pendingByPhone.set(customerNumber, phoneList);
    }

    void this.voiceSharedStateService.saveAuthorization(entry);

    this.trimPendingEntries();

    this.logger.log({
      authorizationId,
      source: input.source,
      customerNumber,
      callSid,
      callId: input.callId,
      hasCallContext: Boolean(input.callContext),
      callContextKeys: input.callContext
        ? Object.keys(input.callContext)
        : [],
      message: input.callContext
        ? 'voice_call_context_stored'
        : 'Registered app-initiated voice call authorization',
    });

    return authorizationId;
  }

  linkProviderCallDetails(
    authorizationId: string,
    details: { callSid?: string; callId?: string },
  ): void {
    const entry = this.pending.get(authorizationId);
    if (!entry) {
      return;
    }

    if (details.callSid?.trim()) {
      const callSid = details.callSid.trim();
      entry.callSid = callSid;
      this.pendingByCallSid.set(callSid, authorizationId);
    }

    if (details.callId?.trim()) {
      entry.callId = details.callId.trim();
    }

    void this.voiceSharedStateService.saveAuthorization(entry);
  }

  rememberStreamUrlAuthorization(
    callSid: string | undefined,
    authorizationId: string,
  ): void {
    const normalizedCallSid = callSid?.trim();
    if (!normalizedCallSid || !authorizationId.trim()) {
      return;
    }

    this.streamUrlAuthorizationByCallSid.set(
      normalizedCallSid.toLowerCase(),
      authorizationId.trim(),
    );
  }

  async findPendingAuthorizationId(input: {
    callSid?: string;
    from?: string;
    to?: string;
  }): Promise<string | undefined> {
    this.pruneExpired();

    const callSid = input.callSid?.trim();
    if (callSid) {
      const authorizationId = this.pendingByCallSid.get(callSid);
      if (authorizationId) {
        const entry = await this.resolveAuthorization(authorizationId);
        if (entry && !entry.consumed && entry.expiresAt.getTime() > Date.now()) {
          return authorizationId;
        }
      }

      const redisEntry =
        await this.voiceSharedStateService.loadAuthorizationByCallSid(callSid);
      if (
        redisEntry &&
        !redisEntry.consumed &&
        redisEntry.expiresAt.getTime() > Date.now()
      ) {
        return redisEntry.authorizationId;
      }
    }

    const candidatePhones = [
      normalizeVoicePhoneNumber(input.to),
      normalizeVoicePhoneNumber(input.from),
    ].filter((value, index, list): value is string =>
      Boolean(value && list.indexOf(value) === index),
    );

    for (const phone of candidatePhones) {
      const authorizationIds = this.pendingByPhone.get(phone) ?? [];
      for (const authorizationId of authorizationIds) {
        const entry = await this.resolveAuthorization(authorizationId);
        if (entry && !entry.consumed && entry.expiresAt.getTime() > Date.now()) {
          return authorizationId;
        }
      }

      const redisEntry =
        await this.voiceSharedStateService.loadLatestAuthorizationByPhone(phone);
      if (
        redisEntry &&
        !redisEntry.consumed &&
        redisEntry.expiresAt.getTime() > Date.now()
      ) {
        return redisEntry.authorizationId;
      }
    }

    return undefined;
  }

  async authorizeStart(
    input: VoiceCallStartAuthorizationInput,
  ): Promise<VoiceCallAuthorizationResult> {
    if (!this.isAuthorizationRequired()) {
      this.logger.log({
        streamSid: input.streamSid,
        matchMethod: 'dev_bypass',
        message: 'Voice stream authorization bypassed (dev mode)',
      });
      return {
        authorized: true,
        authorizationId: 'dev-bypass',
        source: 'manual',
      };
    }

    this.pruneExpired();

    const customAuthorizationId =
      input.authorizationId?.trim() ||
      this.extractCustomAuthorizationId(input.customParameters);
    if (customAuthorizationId) {
      this.logger.log({
        streamSid: input.streamSid,
        callSid: input.callSid ?? null,
        authorizationId: customAuthorizationId,
        matchMethod: 'authorizationId',
        message: 'Authorization match attempt: authorizationId',
      });
      const byCustom = await this.consumeAuthorization(customAuthorizationId);
      if (byCustom) {
        this.logger.log({
          streamSid: input.streamSid,
          authorizationId: customAuthorizationId,
          matchMethod: 'authorizationId',
          message: 'Authorization success via authorizationId',
        });
        return byCustom;
      }

      this.logger.warn({
        streamSid: input.streamSid,
        authorizationId: customAuthorizationId,
        matchMethod: 'authorizationId',
        rejectionReason: 'authorizationId_not_consumable',
        message:
          'Voice stream authorizationId present but could not be consumed (missing, expired, or already used)',
      });
    }

    const callSid = input.callSid?.trim();
    if (callSid) {
      const reservedAuthorizationId =
        this.streamUrlAuthorizationByCallSid.get(callSid.toLowerCase());
      if (reservedAuthorizationId) {
        this.logger.log({
          streamSid: input.streamSid,
          callSid,
          authorizationId: reservedAuthorizationId,
          matchMethod: 'streamUrlCallSidReservation',
          message: 'Authorization match attempt: stream-url callSid reservation',
        });
        const reservedMatch = await this.consumeAuthorization(
          reservedAuthorizationId,
        );
        if (reservedMatch) {
          this.streamUrlAuthorizationByCallSid.delete(callSid.toLowerCase());
          this.logger.log({
            streamSid: input.streamSid,
            callSid,
            matchMethod: 'streamUrlCallSidReservation',
            message: 'Authorization success via stream-url callSid reservation',
          });
          return reservedMatch;
        }
      }

      this.logger.log({
        streamSid: input.streamSid,
        callSid,
        matchMethod: 'callSidExact',
        message: 'Authorization match attempt: exact callSid',
      });
      const authorizationId = this.findAuthorizationIdForCallSid(callSid);
      if (authorizationId) {
        const match = await this.consumeAuthorization(authorizationId);
        if (match) {
          this.logger.log({
            streamSid: input.streamSid,
            callSid,
            matchMethod: 'callSidExact',
            message: 'Authorization success via exact callSid',
          });
          return match;
        }
      }

      this.logger.log({
        streamSid: input.streamSid,
        callSid,
        matchMethod: 'callSidCaseInsensitive',
        message: 'Authorization match attempt: case-insensitive callSid (redis)',
      });
      const redisEntry =
        await this.voiceSharedStateService.loadAuthorizationByCallSid(callSid);
      if (redisEntry) {
        const match = await this.consumeAuthorization(redisEntry.authorizationId);
        if (match) {
          this.logger.log({
            streamSid: input.streamSid,
            callSid,
            matchMethod: 'callSidCaseInsensitive',
            message: 'Authorization success via redis callSid',
          });
          return match;
        }
      }
    }

    const candidatePhones = this.buildPhoneMatchCandidates(input.from, input.to);

    for (const phone of candidatePhones) {
      this.logger.log({
        streamSid: input.streamSid,
        callSid: input.callSid ?? null,
        phone,
        matchMethod: 'phoneExact',
        message: 'Authorization match attempt: phone exact',
      });
      const match = await this.consumeLatestPhoneAuthorization(phone);
      if (match) {
        this.logger.log({
          streamSid: input.streamSid,
          phone,
          matchMethod: 'phoneExact',
          message: 'Authorization success via phone exact',
        });
        return match;
      }
    }

    for (const phone of candidatePhones) {
      this.logger.log({
        streamSid: input.streamSid,
        callSid: input.callSid ?? null,
        phone,
        matchMethod: 'phoneSuffix',
        message: 'Authorization match attempt: phone suffix (last 10 digits)',
      });
      const fuzzyMatch = await this.consumeAuthorizationByPhoneSuffix(phone);
      if (fuzzyMatch) {
        this.logger.log({
          streamSid: input.streamSid,
          phone,
          matchMethod: 'phoneSuffix',
          message: 'Authorization success via phone suffix',
        });
        return fuzzyMatch;
      }
    }

    this.logger.warn({
      streamSid: input.streamSid,
      callSid: input.callSid,
      from: input.from,
      to: input.to,
      authorizationId: input.authorizationId ?? null,
      candidatePhones,
      rejectionReason: 'not_app_initiated',
      sharedState: this.voiceSharedStateService.usesRedis ? 'redis' : 'memory',
      message:
        'Rejected voice stream — no matching app-initiated call authorization',
    });

    return {
      authorized: false,
      reason: 'not_app_initiated',
    };
  }

  private findAuthorizationIdForCallSid(callSid: string): string | undefined {
    const trimmed = callSid.trim();
    const direct = this.pendingByCallSid.get(trimmed);
    if (direct) {
      return direct;
    }

    const lower = trimmed.toLowerCase();
    for (const [key, authorizationId] of this.pendingByCallSid.entries()) {
      if (key.toLowerCase() === lower) {
        return authorizationId;
      }
    }

    return undefined;
  }

  private buildPhoneMatchCandidates(
    from?: string,
    to?: string,
  ): string[] {
    const candidates = new Set<string>();

    for (const raw of [from, to]) {
      const normalized = normalizeVoicePhoneNumber(raw);
      if (!normalized) {
        continue;
      }

      candidates.add(normalized);
      if (normalized.length === 12 && normalized.startsWith('91')) {
        candidates.add(normalized.slice(2));
      }
    }

    return [...candidates];
  }

  private phoneSuffix(value: string): string {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits;
  }

  private async consumeAuthorizationByPhoneSuffix(
    phone: string,
  ): Promise<VoiceCallAuthorizationMatch | undefined> {
    const suffix = this.phoneSuffix(phone);
    if (suffix.length < 10) {
      return undefined;
    }

    for (const [authorizationId, entry] of this.pending.entries()) {
      if (
        entry.consumed ||
        entry.expiresAt.getTime() <= Date.now() ||
        !entry.customerNumber
      ) {
        continue;
      }

      if (this.phoneSuffix(entry.customerNumber) === suffix) {
        const match = await this.consumeAuthorization(authorizationId);
        if (match) {
          return match;
        }
      }
    }

    return undefined;
  }

  private async consumeLatestPhoneAuthorization(
    phone: string,
  ): Promise<VoiceCallAuthorizationMatch | undefined> {
    const authorizationIds = this.pendingByPhone.get(phone) ?? [];

    for (const authorizationId of authorizationIds) {
      const match = await this.consumeAuthorization(authorizationId);
      if (match) {
        return match;
      }
    }

    const redisEntry =
      await this.voiceSharedStateService.loadLatestAuthorizationByPhone(phone);
    if (redisEntry) {
      return this.consumeAuthorization(redisEntry.authorizationId);
    }

    return undefined;
  }

  private async consumeAuthorization(
    authorizationId: string,
  ): Promise<VoiceCallAuthorizationMatch | undefined> {
    const entry = await this.resolveAuthorization(authorizationId);
    if (!entry || entry.consumed || entry.expiresAt.getTime() <= Date.now()) {
      return undefined;
    }

    entry.consumed = true;
    const local = this.pending.get(authorizationId);
    if (local) {
      local.consumed = true;
    }
    await this.voiceSharedStateService.markAuthorizationConsumed(authorizationId);

    this.logger.log({
      authorizationId: entry.authorizationId,
      source: entry.source,
      callSid: entry.callSid,
      customerNumber: entry.customerNumber,
      message: 'Consumed app-initiated voice call authorization',
    });

    return {
      authorized: true,
      authorizationId: entry.authorizationId,
      source: entry.source,
      callId: entry.callId,
      openingContext: entry.openingContext,
      callContext: entry.callContext,
    };
  }

  private async resolveAuthorization(
    authorizationId: string,
  ): Promise<PendingAuthorization | SharedPendingAuthorization | undefined> {
    const local = this.pending.get(authorizationId);
    if (local) {
      return local;
    }

    return this.voiceSharedStateService.loadAuthorization(authorizationId);
  }

  private extractCustomAuthorizationId(
    customParameters: unknown,
  ): string | undefined {
    const record = this.normalizeCustomParameters(customParameters);
    if (!record) {
      return undefined;
    }

    for (const key of [
      'authorizationId',
      'authorization_id',
      'appCallId',
      'app_call_id',
    ]) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return undefined;
  }

  private normalizeCustomParameters(
    customParameters: unknown,
  ): Record<string, unknown> | undefined {
    if (typeof customParameters === 'string' && customParameters.trim().length > 0) {
      const parsed = Object.fromEntries(
        new URLSearchParams(customParameters.trim()),
      );
      return Object.keys(parsed).length > 0 ? parsed : undefined;
    }

    if (customParameters && typeof customParameters === 'object') {
      return customParameters as Record<string, unknown>;
    }

    return undefined;
  }

  private pruneExpired(): void {
    const now = Date.now();

    for (const [authorizationId, entry] of this.pending.entries()) {
      if (entry.expiresAt.getTime() <= now) {
        this.removeAuthorization(authorizationId);
      }
    }
  }

  private trimPendingEntries(): void {
    if (this.pending.size <= MAX_PENDING_AUTHORIZATIONS) {
      return;
    }

    const sorted = [...this.pending.values()].sort(
      (a, b) => a.registeredAt.getTime() - b.registeredAt.getTime(),
    );

    const overflow = this.pending.size - MAX_PENDING_AUTHORIZATIONS;
    for (let i = 0; i < overflow; i += 1) {
      this.removeAuthorization(sorted[i]!.authorizationId);
    }
  }

  private removeAuthorization(authorizationId: string): void {
    const entry = this.pending.get(authorizationId);
    if (!entry) {
      return;
    }

    this.pending.delete(authorizationId);

    if (entry.callSid) {
      const mapped = this.pendingByCallSid.get(entry.callSid);
      if (mapped === authorizationId) {
        this.pendingByCallSid.delete(entry.callSid);
      }
    }

    if (entry.customerNumber) {
      const phoneList = this.pendingByPhone.get(entry.customerNumber) ?? [];
      this.pendingByPhone.set(
        entry.customerNumber,
        phoneList.filter((id) => id !== authorizationId),
      );
    }
  }
}

export function extractSmartfloProviderCallSid(
  providerResponse: unknown,
): string | undefined {
  if (!providerResponse || typeof providerResponse !== 'object') {
    return undefined;
  }

  const queue: unknown[] = [providerResponse];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) {
      continue;
    }
    seen.add(value);

    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (
        typeof nestedValue === 'string' &&
        nestedValue.trim().length > 0 &&
        (/call[_-]?(sid|id)|uuid|reference/i.test(key) || /^sid$/i.test(key))
      ) {
        return nestedValue.trim();
      }

      if (nestedValue && typeof nestedValue === 'object') {
        queue.push(nestedValue);
      }
    }
  }

  return undefined;
}
