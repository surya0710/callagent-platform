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

  constructor(private readonly configService: ConfigService) {}

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
}
