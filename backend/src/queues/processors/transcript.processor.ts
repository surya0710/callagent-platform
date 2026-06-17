import { Injectable, Logger } from '@nestjs/common';
import { VoiceTranscriptService } from '../../modules/voice/transcript/voice-transcript.service';
import { PostCallTranscriptJobPayload } from '../../modules/voice/transcript/voice-transcript.types';

@Injectable()
export class TranscriptProcessor {
  private readonly logger = new Logger(TranscriptProcessor.name);

  constructor(private readonly voiceTranscriptService: VoiceTranscriptService) {}

  async process(payload: PostCallTranscriptJobPayload) {
    await this.voiceTranscriptService.processPostCallJob(payload);
    this.logger.log(`Post-call transcript completed for call ${payload.callId}`);
    return { callId: payload.callId, streamSid: payload.streamSid };
  }
}
