import { Injectable } from '@nestjs/common';
import {
  InitiateVoiceCallInput,
  TelephonyOutboundCallService,
  VoiceTestCallResult,
} from './telephony/telephony-outbound-call.service';

export type {
  InitiateVoiceCallInput,
  InitiateVoiceCallIntegrationMeta,
  VoiceTestCallResult,
} from './telephony/telephony-outbound-call.service';

/** @deprecated Use TelephonyOutboundCallService */
@Injectable()
export class SmartfloClickToCallService {
  constructor(
    private readonly telephonyOutboundCallService: TelephonyOutboundCallService,
  ) {}

  initiateTestCall(
    customerNumber: string,
    requestMeta?: {
      requestedByIp?: string;
      requestedByForwardedFor?: string;
      callContext?: unknown;
    },
  ): Promise<VoiceTestCallResult> {
    return this.telephonyOutboundCallService.initiateTestCall(
      customerNumber,
      requestMeta,
    );
  }

  initiateCall(input: InitiateVoiceCallInput): Promise<VoiceTestCallResult> {
    return this.telephonyOutboundCallService.initiateCall(input);
  }
}
