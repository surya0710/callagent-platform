import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallEventType, CallSource, CallStatus, Prisma } from '@prisma/client';
import {
  buildCallRequestOriginInfo,
  CallRequestOriginInfo,
} from '../../common/server-origin.util';
import { PrismaService } from '../../database/prisma.service';
import { VoiceRuntimeFactory } from './runtime/voice-runtime.factory';
import {
  CallTimingDiagnosticsService,
  CallTimingEvent,
} from './call-timing-diagnostics.service';
import {
  extractSmartfloProviderCallSid,
  VoiceCallAuthorizationService,
  VoiceCallSource,
} from './voice-call-authorization.service';
import {
  isEmptyCallContext,
  sanitizeCallContext,
} from './voice-call-context.util';
import { CallContext } from './voice-call-context.types';
import { VoiceOpeningConfigService } from './voice-opening-config.service';

export interface VoiceTestCallResult {
  success: boolean;
  message: string;
  providerResponse: unknown;
  requestedCustomerNumber: string;
  normalizedCustomerNumber: string;
  callOrigin: CallRequestOriginInfo;
  authorizationId?: string;
  callId?: string;
  providerCallSid?: string | null;
}

export interface InitiateVoiceCallIntegrationMeta {
  apiKeyId: string;
  externalRef: string;
  callbackUrl?: string;
  apiKeyName?: string;
  metadata?: Record<string, unknown>;
}

export interface InitiateVoiceCallInput {
  customerNumber: string;
  callContext?: unknown;
  source: VoiceCallSource;
  callSource: CallSource;
  integration?: InitiateVoiceCallIntegrationMeta;
  requestMeta?: {
    requestedByIp?: string;
    requestedByForwardedFor?: string;
  };
}

@Injectable()
export class SmartfloClickToCallService {
  private readonly logger = new Logger(SmartfloClickToCallService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly voiceCallAuthorizationService: VoiceCallAuthorizationService,
    private readonly prisma: PrismaService,
    private readonly voiceRuntimeFactory: VoiceRuntimeFactory,
    private readonly voiceOpeningConfigService: VoiceOpeningConfigService,
    private readonly callTiming: CallTimingDiagnosticsService,
  ) {}

  async initiateTestCall(
    customerNumber: string,
    requestMeta?: {
      requestedByIp?: string;
      requestedByForwardedFor?: string;
      callContext?: unknown;
    },
  ): Promise<VoiceTestCallResult> {
    return this.initiateCall({
      customerNumber,
      callContext: requestMeta?.callContext,
      source: 'test-call',
      callSource: CallSource.test,
      requestMeta,
    });
  }

  async initiateCall(input: InitiateVoiceCallInput): Promise<VoiceTestCallResult> {
    const requestedCustomerNumber = input.customerNumber.trim();
    const callOrigin = this.buildCallOrigin(input.requestMeta);
    const callContext = this.resolveCallContext(input.callContext);

    this.logger.log({
      requestedCustomerNumber,
      callOrigin,
      source: input.source,
      externalRef: input.integration?.externalRef,
      hasCallContext: Boolean(callContext),
      callContextKeys: callContext ? Object.keys(callContext) : [],
      message: callContext
        ? 'voice_call_context_received'
        : 'Smartflo click-to-call requested',
    });

    const normalizedCustomerNumber =
      this.normalizeCustomerNumber(requestedCustomerNumber);
    this.logger.log(`Normalized customer number: ${normalizedCustomerNumber}`);

    const traceLabel =
      input.integration?.externalRef ??
      `phone:${normalizedCustomerNumber}`;
    const traceId = this.callTiming.beginTrace(traceLabel, {
      normalizedCustomerNumber,
      source: input.source,
      externalRef: input.integration?.externalRef,
    });
    this.callTiming.mark(traceId, CallTimingEvent.TEST_CALL_API_RECEIVED, {
      hasCallContext: Boolean(callContext),
      source: input.source,
    });

    const apiKey = this.configService
      .get<string>('SMARTFLO_CLICK_TO_CALL_API_KEY')
      ?.trim();
    const baseUrl = callOrigin.smartfloApiBaseUrl.replace(/\/+$/, '');
    const callerId = this.configService.get<string>('SMARTFLO_CALLER_ID')?.trim();

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Smartflo click-to-call is not configured (SMARTFLO_CLICK_TO_CALL_API_KEY missing)',
      );
    }

    if (!callerId) {
      throw new ServiceUnavailableException(
        'Smartflo click-to-call is not configured (SMARTFLO_CALLER_ID missing)',
      );
    }

    const payload = {
      api_key: apiKey,
      customer_number: normalizedCustomerNumber,
      caller_id: callerId,
      async: 1,
    };

    let response: Response;
    try {
      this.callTiming.mark(traceId, CallTimingEvent.SMARTFLO_REQUEST_SENT);
      response = await fetch(`${baseUrl}/v1/click_to_call_support`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Smartflo request failed';
      this.logger.error(`Smartflo click-to-call request failed: ${message}`);
      throw new ServiceUnavailableException(
        'Unable to reach Smartflo click-to-call API',
      );
    }

    this.logger.log(`Smartflo API response status: ${response.status}`);

    const providerResponse = this.stripSensitiveFields(
      await this.parseProviderResponse(response),
    );
    this.callTiming.mark(traceId, CallTimingEvent.SMARTFLO_RESPONSE_RECEIVED, {
      smartfloStatus: response.status,
    });

    if (!response.ok) {
      this.logger.error(
        `Smartflo click-to-call failed: status=${response.status} body=${JSON.stringify(providerResponse)}`,
      );

      return {
        success: false,
        message: `Smartflo click-to-call failed with status ${response.status}`,
        providerResponse,
        requestedCustomerNumber,
        normalizedCustomerNumber,
        callOrigin,
      };
    }

    this.logger.log({
      normalizedCustomerNumber,
      callOrigin,
      smartfloStatus: response.status,
      source: input.source,
      externalRef: input.integration?.externalRef,
      message: 'Smartflo click-to-call accepted',
    });

    const providerCallSid = extractSmartfloProviderCallSid(providerResponse);
    this.callTiming.linkCallSid(providerCallSid, traceId);

    const openingContext = this.voiceOpeningConfigService.isSpeakFirstEnabled()
      ? this.voiceOpeningConfigService.resolve()
      : undefined;

    if (this.voiceOpeningConfigService.isSpeakFirstEnabled()) {
      this.voiceRuntimeFactory.getProvider().prewarmAuthorizedCall?.({
        callSid: providerCallSid,
        customerNumber: normalizedCustomerNumber,
        callContext,
        openingContext,
        aiSpeakFirstEnabled: true,
      });
    }

    const call = await this.createLiveAnalysisCallRecord({
      normalizedCustomerNumber,
      requestedCustomerNumber,
      providerCallSid,
      providerResponse,
      callOrigin,
      callContext,
      callSource: input.callSource,
      integration: input.integration,
    });
    const authorizationId = this.voiceCallAuthorizationService.register({
      source: input.source,
      customerNumber: normalizedCustomerNumber,
      callSid: providerCallSid,
      callId: call.id,
      callContext,
    });

    const successMessage =
      input.source === 'integration'
        ? 'Integration call initiated successfully'
        : 'Test call initiated successfully';

    return {
      success: true,
      message: successMessage,
      providerResponse,
      requestedCustomerNumber,
      normalizedCustomerNumber,
      callOrigin,
      authorizationId,
      callId: call.id,
      providerCallSid: providerCallSid ?? null,
    };
  }

  private resolveCallContext(input: unknown): CallContext | undefined {
    const sanitized = sanitizeCallContext(input);
    if (input && !sanitized && !isEmptyCallContext(input as CallContext)) {
      this.logger.warn({
        message: 'voice_call_context_validation_failed',
      });
    }
    return sanitized;
  }

  private async createLiveAnalysisCallRecord(input: {
    normalizedCustomerNumber: string;
    requestedCustomerNumber: string;
    providerCallSid?: string;
    providerResponse: unknown;
    callOrigin: CallRequestOriginInfo;
    callContext?: CallContext;
    callSource: CallSource;
    integration?: InitiateVoiceCallIntegrationMeta;
  }) {
    const customerName = input.callContext?.customerName?.trim();
    const [firstName, ...lastNameParts] = customerName
      ? customerName.split(/\s+/).filter(Boolean)
      : ['Voice'];

    const customer =
      (await this.prisma.customer.findFirst({
        where: { phone: input.normalizedCustomerNumber },
      })) ??
      (await this.prisma.customer.create({
        data: {
          firstName: firstName || 'Voice',
          lastName: lastNameParts.join(' ') || 'Caller',
          phone: input.normalizedCustomerNumber,
          metadata: {
            createdBy:
              input.callSource === CallSource.integration
                ? 'integration_call'
                : 'voice_test_call',
            requestedCustomerNumber: input.requestedCustomerNumber,
          },
        },
      }));

    const call = await this.prisma.call.create({
      data: {
        customerId: customer.id,
        source: input.callSource,
        apiKeyId: input.integration?.apiKeyId,
        externalRef: input.integration?.externalRef,
        callbackUrl: input.integration?.callbackUrl,
        status: CallStatus.initiated,
        phone: input.normalizedCustomerNumber,
        providerRef: input.providerCallSid,
        startedAt: new Date(),
        metadata: this.toJsonValue({
          origin: input.callOrigin,
          providerResponse: input.providerResponse,
          ...(input.callContext ? { callContext: input.callContext } : {}),
          ...(input.integration?.metadata
            ? { custom: input.integration.metadata }
            : {}),
          ...(input.integration?.apiKeyName
            ? { integration: { apiKeyName: input.integration.apiKeyName } }
            : {}),
        }),
      },
    });

    await this.prisma.callEvent.create({
      data: {
        callId: call.id,
        type: CallEventType.system,
        payload: {
          action:
            input.callSource === CallSource.integration
              ? 'integration_call_initiated'
              : 'voice_test_call_initiated',
          providerCallSid: input.providerCallSid ?? null,
          externalRef: input.integration?.externalRef ?? null,
        },
      },
    });

    return call;
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }

  private buildCallOrigin(requestMeta?: {
    requestedByIp?: string;
    requestedByForwardedFor?: string;
  }): CallRequestOriginInfo {
    return buildCallRequestOriginInfo({
      nodeEnv: this.configService.get<string>('NODE_ENV'),
      appVersion: this.configService.get<string>('APP_VERSION'),
      serverId: this.configService.get<string>('APP_SERVER_ID'),
      smartfloBaseUrl: this.configService.get<string>('SMARTFLO_BASE_URL'),
      voiceWssBaseUrl: this.configService.get<string>('VOICE_WSS_BASE_URL'),
      requestedByIp: requestMeta?.requestedByIp,
      requestedByForwardedFor: requestMeta?.requestedByForwardedFor,
    });
  }

  private normalizeCustomerNumber(input: string): string {
    const trimmed = input.trim();

    if (!trimmed) {
      throw new BadRequestException('Customer number is required');
    }

    if (!/^\d+$/.test(trimmed)) {
      throw new BadRequestException(
        'Customer number must be numeric (digits only)',
      );
    }

    if (trimmed.length === 10) {
      if (!/^[6-9]\d{9}$/.test(trimmed)) {
        throw new BadRequestException(
          'Invalid 10-digit Indian mobile number. Must start with 6, 7, 8, or 9.',
        );
      }

      return `91${trimmed}`;
    }

    if (trimmed.length === 12 && trimmed.startsWith('91')) {
      const mobilePart = trimmed.slice(2);
      if (!/^[6-9]\d{9}$/.test(mobilePart)) {
        throw new BadRequestException(
          'Invalid Indian mobile number after country code 91',
        );
      }

      return trimmed;
    }

    throw new BadRequestException(
      'Enter a 10-digit Indian mobile number or 91XXXXXXXXXX',
    );
  }

  private async parseProviderResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text.trim()) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw: text };
    }
  }

  private stripSensitiveFields(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.stripSensitiveFields(item));
    }

    if (typeof value === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, nestedValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (key.toLowerCase() === 'api_key') {
          continue;
        }
        sanitized[key] = this.stripSensitiveFields(nestedValue);
      }
      return sanitized;
    }

    return value;
  }
}
