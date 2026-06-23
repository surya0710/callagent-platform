import { Injectable } from '@nestjs/common';
import { TranscriptEmailService } from '../../modules/voice/transcript-email.service';
import { SendTranscriptEmailJobPayload } from '../../modules/voice/transcript/voice-transcript.types';

@Injectable()
export class TranscriptEmailProcessor {
  constructor(private readonly transcriptEmailService: TranscriptEmailService) {}

  async process(payload: SendTranscriptEmailJobPayload) {
    await this.transcriptEmailService.sendTranscriptEmail(payload);
    return {
      callId: payload.callId,
      streamSid: payload.streamSid,
      logId: payload.logId,
    };
  }
}
