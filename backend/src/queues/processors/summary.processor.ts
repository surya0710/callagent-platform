import { Injectable, Logger } from '@nestjs/common';
import { CallsService } from '../../modules/calls/calls.service';

export interface SummaryJobPayload {
  callId: string;
}

@Injectable()
export class SummaryProcessor {
  private readonly logger = new Logger(SummaryProcessor.name);

  constructor(private readonly callsService: CallsService) {}

  async process(payload: SummaryJobPayload) {
    const call = await this.callsService.findOne(payload.callId);
    const transcript = call.transcript?.content;

    if (!transcript) {
      this.logger.warn(`No transcript for call ${payload.callId}; skipping summary`);
      return { skipped: true, reason: 'no_transcript' };
    }

    const summary = await this.callsService.generateAndStoreSummary(
      payload.callId,
      transcript,
    );

    this.logger.log(`Summary generated for call ${payload.callId}`);
    return { callId: payload.callId, summaryId: summary.id };
  }
}
