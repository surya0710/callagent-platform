import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildCallRequestOriginInfo,
  CallRequestOriginInfo,
} from '../../common/server-origin.util';

export interface VoiceTestCallResult {
  success: boolean;
  message: string;
  providerResponse: unknown;
  requestedCustomerNumber: string;
  normalizedCustomerNumber: string;
  callOrigin: CallRequestOriginInfo;
}

@Injectable()
export class SmartfloClickToCallService {
  private readonly logger = new Logger(SmartfloClickToCallService.name);

  constructor(private readonly configService: ConfigService) {}

  async initiateTestCall(
    customerNumber: string,
    requestMeta?: {
      requestedByIp?: string;
      requestedByForwardedFor?: string;
    },
  ): Promise<VoiceTestCallResult> {
    const requestedCustomerNumber = customerNumber.trim();
    const callOrigin = this.buildCallOrigin(requestMeta);

    this.logger.log({
      requestedCustomerNumber,
      callOrigin,
      message: 'Smartflo click-to-call requested',
    });

    const normalizedCustomerNumber =
      this.normalizeCustomerNumber(requestedCustomerNumber);
    this.logger.log(`Normalized customer number: ${normalizedCustomerNumber}`);

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
      message: 'Smartflo click-to-call accepted',
    });

    return {
      success: true,
      message: 'Test call initiated successfully',
      providerResponse,
      requestedCustomerNumber,
      normalizedCustomerNumber,
      callOrigin,
    };
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
