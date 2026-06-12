import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface VoiceTestCallResult {
  success: boolean;
  message: string;
  providerResponse: unknown;
  requestedCustomerNumber: string;
  normalizedCustomerNumber: string;
}

@Injectable()
export class SmartfloClickToCallService {
  private readonly logger = new Logger(SmartfloClickToCallService.name);

  constructor(private readonly configService: ConfigService) {}

  async initiateTestCall(customerNumber: string): Promise<VoiceTestCallResult> {
    const requestedCustomerNumber = customerNumber.trim();
    this.logger.log(`Test call requested for customer number: ${requestedCustomerNumber}`);

    const normalizedCustomerNumber =
      this.normalizeCustomerNumber(requestedCustomerNumber);
    this.logger.log(`Normalized customer number: ${normalizedCustomerNumber}`);

    const apiKey = this.configService
      .get<string>('SMARTFLO_CLICK_TO_CALL_API_KEY')
      ?.trim();
    const baseUrl = (
      this.configService.get<string>('SMARTFLO_BASE_URL') ??
      'https://api-smartflo.tatateleservices.com'
    ).replace(/\/+$/, '');
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
      };
    }

    this.logger.log(
      `Smartflo click-to-call accepted for ${normalizedCustomerNumber}`,
    );

    return {
      success: true,
      message: 'Test call initiated successfully',
      providerResponse,
      requestedCustomerNumber,
      normalizedCustomerNumber,
    };
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
