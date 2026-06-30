import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallEventType, CallSource, CallStatus, Prisma } from '@prisma/client';
import {
  buildCallRequestOriginInfo,
  CallRequestOriginInfo,
} from '../../../common/server-origin.util';
import { PrismaService } from '../../../database/prisma.service';
import { VoiceRuntimeFactory } from '../runtime/voice-runtime.factory';
import {
  CallTimingDiagnosticsService,
  CallTimingEvent,
} from '../call-timing-diagnostics.service';
import {
  VoiceCallAuthorizationService,
  VoiceCallSource,
} from '../voice-call-authorization.service';
import {
  isEmptyCallContext,
  sanitizeCallContext,
} from '../voice-call-context.util';
import { CallContext } from '../voice-call-context.types';
import { VoiceOpeningConfigService } from '../voice-opening-config.service';
import { TelephonyProviderConfigService } from './telephony-provider.config';
import { TelephonyProvider } from './telephony-provider.types';
import { toExotelCustomerNumber } from './telephony-phone.util';
import { extractExotelProviderCallSid } from './exotel-provider-call-sid.util';
import {
  InitiateVoiceCallInput,
  InitiateVoiceCallIntegrationMeta,
  VoiceTestCallResult,
} from './telephony-outbound-call.service';

@Injectable()
export class ExotelOutboundCallService {
  private readonly logger = new Logger(ExotelOutboundCallService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly telephonyConfig: TelephonyProviderConfigService,
    private readonly voiceCallAuthorizationService: VoiceCallAuthorizationService,
    private readonly prisma: PrismaService,
    private readonly voiceRuntimeFactory: VoiceRuntimeFactory,
    private readonly voiceOpeningConfigService: VoiceOpeningConfigService,
    private readonly callTiming: CallTimingDiagnosticsService,
  ) {}

  async initiateCall(input: InitiateVoiceCallInput): Promise<VoiceTestCallResult> {
    const telephonyProvider = TelephonyProvider.EXOTEL;
    const requestedCustomerNumber = input.customerNumber.trim();
    const callOrigin = this.buildCallOrigin(input.requestMeta);
    const callContext = this.resolveCallContext(input.callContext);

    this.logger.log({
      telephonyProvider,
      requestedCustomerNumber,
      callOrigin,
      source: input.source,
      externalRef: input.integration?.externalRef,
      hasCallContext: Boolean(callContext),
      message: 'exotel outbound call requested',
    });

    const normalizedCustomerNumber =
      this.normalizeCustomerNumber(requestedCustomerNumber);

    const traceLabel =
      input.integration?.externalRef ?? `phone:${normalizedCustomerNumber}`;
    const traceId = this.callTiming.beginTrace(traceLabel, {
      normalizedCustomerNumber,
      source: input.source,
      externalRef: input.integration?.externalRef,
      telephonyProvider,
    });
    this.callTiming.mark(traceId, CallTimingEvent.TEST_CALL_API_RECEIVED, {
      hasCallContext: Boolean(callContext),
      source: input.source,
      telephonyProvider,
    });

    const authorizationId = this.voiceCallAuthorizationService.register({
      source: input.source,
      customerNumber: normalizedCustomerNumber,
      callContext,
    });

    const openingContext = this.voiceOpeningConfigService.isSpeakFirstEnabled()
      ? this.voiceOpeningConfigService.resolve()
      : undefined;

    if (this.voiceOpeningConfigService.isSpeakFirstEnabled()) {
      this.voiceRuntimeFactory.getProvider().prewarmAuthorizedCall?.({
        customerNumber: normalizedCustomerNumber,
        callContext,
        openingContext,
        aiSpeakFirstEnabled: true,
      });
    }

    let response: Response;
    try {
      this.callTiming.mark(traceId, CallTimingEvent.SMARTFLO_REQUEST_SENT, {
        telephonyProvider,
      });
      response = await this.dialExotel(normalizedCustomerNumber);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : 'exotel request failed';
      this.logger.error({
        telephonyProvider,
        err: message,
        message: 'exotel outbound call network request failed',
      });
      throw new ServiceUnavailableException(
        `Unable to reach exotel outbound call API: ${message}`,
      );
    }

    const providerResponse = this.stripSensitiveFields(
      await this.parseProviderResponse(response),
    );
    this.callTiming.mark(traceId, CallTimingEvent.SMARTFLO_RESPONSE_RECEIVED, {
      providerStatus: response.status,
      telephonyProvider,
    });

    if (!response.ok) {
      this.logger.error({
        telephonyProvider,
        providerStatus: response.status,
        providerResponse,
        message: 'exotel outbound call failed',
      });

      return {
        success: false,
        message: `exotel outbound call failed with status ${response.status}`,
        providerResponse,
        requestedCustomerNumber,
        normalizedCustomerNumber,
        callOrigin,
        telephonyProvider,
      };
    }

    const providerCallSid = extractExotelProviderCallSid(providerResponse);
    this.callTiming.linkCallSid(providerCallSid, traceId);

    if (providerCallSid) {
      this.voiceCallAuthorizationService.linkProviderCallDetails(
        authorizationId,
        { callSid: providerCallSid },
      );
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

    this.voiceCallAuthorizationService.linkProviderCallDetails(
      authorizationId,
      { callId: call.id },
    );

    this.logger.log({
      telephonyProvider,
      normalizedCustomerNumber,
      providerCallSid,
      authorizationId,
      callId: call.id,
      message: 'exotel outbound call accepted',
    });

    return {
      success: true,
      message:
        input.source === 'integration'
          ? 'Integration call initiated successfully'
          : 'Test call initiated successfully',
      providerResponse,
      requestedCustomerNumber,
      normalizedCustomerNumber,
      callOrigin,
      authorizationId,
      callId: call.id,
      providerCallSid: providerCallSid ?? null,
      telephonyProvider,
    };
  }

  private async dialExotel(normalizedCustomerNumber: string): Promise<Response> {
    const accountSid = this.telephonyConfig.getExotelAccountSid();
    const apiKey = this.telephonyConfig.getExotelApiKey();
    const apiToken = this.telephonyConfig.getExotelApiToken();
    const callerId = this.telephonyConfig.getExotelCallerId();
    const connectUrl = this.telephonyConfig.getExotelConnectUrl();

    if (!accountSid || !apiKey || !apiToken) {
      throw new ServiceUnavailableException(
        'Exotel is not configured (EXOTEL_ACCOUNT_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN required)',
      );
    }

    if (!callerId) {
      throw new ServiceUnavailableException(
        'Exotel is not configured (EXOTEL_CALLER_ID missing)',
      );
    }

    const from = toExotelCustomerNumber(normalizedCustomerNumber);
    const url = `${this.telephonyConfig.getExotelApiBaseUrl()}/v1/Accounts/${accountSid}/Calls/connect.json`;
    const formBody = new URLSearchParams({
      From: from,
      CallerId: callerId,
      Url: connectUrl,
    }).toString();

    const basicAuth = Buffer.from(`${apiKey}:${apiToken}`, 'utf8').toString(
      'base64',
    );

    this.logger.log({
      telephonyProvider: TelephonyProvider.EXOTEL,
      url,
      from,
      callerId,
      connectUrl,
      message: 'Sending exotel flow-only connect request',
    });

    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody,
    });
  }

  private resolveCallContext(input: unknown): CallContext | undefined {
    const sanitized = sanitizeCallContext(input);
    if (input && !sanitized && !isEmptyCallContext(input as CallContext)) {
      this.logger.warn({ message: 'voice_call_context_validation_failed' });
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
        metadata: JSON.parse(
          JSON.stringify({
            origin: input.callOrigin,
            telephonyProvider: TelephonyProvider.EXOTEL,
            providerResponse: input.providerResponse,
            ...(input.callContext ? { callContext: input.callContext } : {}),
            ...(input.integration?.metadata
              ? { custom: input.integration.metadata }
              : {}),
            ...(input.integration?.apiKeyName
              ? { integration: { apiKeyName: input.integration.apiKeyName } }
              : {}),
          }),
        ) as Prisma.InputJsonValue,
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
          telephonyProvider: TelephonyProvider.EXOTEL,
          providerCallSid: input.providerCallSid ?? null,
          externalRef: input.integration?.externalRef ?? null,
        },
      },
    });

    return call;
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
      telephonyProvider: TelephonyProvider.EXOTEL,
      exotelBaseUrl: this.telephonyConfig.getExotelApiBaseUrl(),
      exotelAccountSid: this.telephonyConfig.getExotelAccountSid(),
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
