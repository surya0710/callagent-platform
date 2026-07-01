import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceOpeningContext } from './voice-opening.types';
import {
  mergeOpeningContext,
  parseAskPermissionBeforePitch,
  resolveTimeAwareOpeningGreeting,
} from './voice-opening.util';

@Injectable()
export class VoiceOpeningConfigService {
  private readonly logger = new Logger(VoiceOpeningConfigService.name);

  constructor(private readonly configService: ConfigService) { }

  isSpeakFirstEnabled(): boolean {
    return this.readBoolean('VOICE_AI_SPEAK_FIRST_ENABLED', true);
  }

  getOpeningTimeoutMs(): number {
    return this.readInt('VOICE_AI_SPEAK_FIRST_OPENING_TIMEOUT_MS', 8000, 1000);
  }

  getOpeningDelayMs(): number {
    const raw = this.readInt('VOICE_AI_SPEAK_FIRST_OPENING_DELAY_MS', 2500, 2000);
    return Math.min(raw, 3000);
  }

  shouldFallbackToWaitForCustomer(): boolean {
    return this.readBoolean(
      'VOICE_AI_SPEAK_FIRST_FALLBACK_TO_WAIT_FOR_CUSTOMER',
      true,
    );
  }

  getOpeningIgnoreMs(): number {
    return this.readInt('VOICE_OPENING_IGNORE_MS', 200);
  }

  getPostOpeningIgnoreMs(): number {
    const postOpening = this.configService.get<string>('VOICE_POST_OPENING_IGNORE_MS');
    if (postOpening !== undefined) {
      return this.readInt('VOICE_POST_OPENING_IGNORE_MS', 300);
    }
    return this.readInt('VOICE_OPENING_IGNORE_MS', 300);
  }

  resolveFromEnv(): VoiceOpeningContext {
    return this.resolve();
  }

  resolve(override?: Partial<VoiceOpeningContext>): VoiceOpeningContext {
    const autoTimeGreeting = this.readBoolean(
      'VOICE_OPENING_GREETING_AUTO_TIME',
      true,
    );
    const fromEnv: Partial<VoiceOpeningContext> = {
      agentName: this.configService.get<string>('VOICE_AGENT_NAME')?.trim(),
      companyName: this.configService.get<string>('VOICE_COMPANY_NAME')?.trim(),
      callPurpose: this.configService.get<string>('VOICE_CALL_PURPOSE')?.trim(),
      openingGreeting: this.configService
        .get<string>('VOICE_OPENING_GREETING')
        ?.trim(),
      askPermissionBeforePitch: parseAskPermissionBeforePitch(
        this.configService.get<string>('VOICE_ASK_PERMISSION_BEFORE_PITCH'),
      ),
    };

    const resolved = mergeOpeningContext({
      ...fromEnv,
      ...override,
    });

    if (autoTimeGreeting) {
      resolved.openingGreeting = resolveTimeAwareOpeningGreeting(
        resolved.openingGreeting,
      );
    }

    this.logger.log({
      agentName: resolved.agentName,
      companyName: resolved.companyName,
      callPurpose: resolved.callPurpose,
      openingGreeting: resolved.openingGreeting,
      askPermissionBeforePitch: resolved.askPermissionBeforePitch,
      message: 'voice_opening_config_loaded',
    });

    return resolved;
  }

  private readBoolean(name: string, fallback: boolean): boolean {
    const raw = this.configService.get<string>(name);
    if (raw === undefined) {
      return fallback;
    }
    return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
  }

  private readInt(name: string, fallback: number, min = 0): number {
    const raw = this.configService.get<string>(name);
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) ? Math.max(parsed, min) : fallback;
  }
}
