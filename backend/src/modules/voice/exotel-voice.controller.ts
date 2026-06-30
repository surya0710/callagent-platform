import { Controller, Get, Logger, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator';
import { VoiceCallAuthorizationService } from './voice-call-authorization.service';
import { appendVoiceStreamProviderQuery } from './voice-stream-provider.util';
import { TelephonyProvider } from './telephony/telephony-provider.types';

@ApiTags('Voice')
@Public()
@Controller('voice/exotel')
export class ExotelVoiceController {
  private readonly logger = new Logger(ExotelVoiceController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly voiceCallAuthorizationService: VoiceCallAuthorizationService,
  ) {}

  @Get('stream-url')
  @ApiOperation({
    summary: 'Exotel dynamic AgentStream WebSocket URL resolver',
    description:
      'Use as the dynamic HTTPS URL in the Exotel Voicebot applet. Returns a per-call WSS URL with authorizationId.',
  })
  async resolveStreamUrl(
    @Query('CallSid') callSid?: string,
    @Query('call_sid') callSidSnake?: string,
    @Query('From') from?: string,
    @Query('from') fromLower?: string,
    @Query('To') to?: string,
    @Query('to') toLower?: string,
  ) {
    const telephonyProvider = TelephonyProvider.EXOTEL;
    const resolvedCallSid = (callSid ?? callSidSnake)?.trim();
    const resolvedFrom = from ?? fromLower;
    const resolvedTo = to ?? toLower;

    this.logger.log({
      telephonyProvider,
      callSid: resolvedCallSid ?? null,
      from: resolvedFrom ?? null,
      to: resolvedTo ?? null,
      message: 'Exotel stream-url endpoint hit',
    });

    const authorizationId =
      await this.voiceCallAuthorizationService.findPendingAuthorizationId({
        callSid: resolvedCallSid,
        from: resolvedFrom,
        to: resolvedTo,
      });

    const baseWss = appendVoiceStreamProviderQuery(
      this.configService.get<string>('VOICE_WSS_BASE_URL')?.trim() ||
        'wss://tatdai.in/api/voice/stream',
      TelephonyProvider.EXOTEL,
    );

    if (!authorizationId) {
      this.logger.warn({
        telephonyProvider,
        callSid: resolvedCallSid,
        from: from ?? fromLower,
        to: to ?? toLower,
        message: 'exotel stream-url resolver: no pending authorization found',
      });
      return { url: baseWss };
    }

    this.voiceCallAuthorizationService.rememberStreamUrlAuthorization(
      resolvedCallSid,
      authorizationId,
    );

    const separator = baseWss.includes('?') ? '&' : '?';
    const url = `${baseWss}${separator}authorizationId=${encodeURIComponent(authorizationId)}`;

    this.logger.log({
      telephonyProvider,
      callSid: resolvedCallSid,
      authorizationId,
      url,
      message: 'Exotel stream-url response generated',
    });

    return {
      url,
      custom_parameters: `authorizationId=${encodeURIComponent(authorizationId)}`,
    };
  }
}
