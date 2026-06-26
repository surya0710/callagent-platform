import api from './api';
import {
  VoiceHealthResponse,
  VoiceSessionsResponse,
  VoiceSignedRecordingUrlResponse,
  VoiceTestCallRequest,
  VoiceTestCallResponse,
  VoiceTranscriptResponse,
  TranscriptEmailStatusResponse,
} from '../types/voice';

export const voiceApi = {
  getHealth: () =>
    api.get<VoiceHealthResponse>('/voice/health').then((res) => res.data),

  getSessions: () =>
    api.get<VoiceSessionsResponse>('/voice/sessions').then((res) => res.data),

  getSignedRecordingUrl: (streamSid: string) =>
    api
      .get<VoiceSignedRecordingUrlResponse>(
        `/voice/recordings/${encodeURIComponent(streamSid)}/signed-url`,
      )
      .then((res) => res.data),

  getSessionTranscript: (streamSid: string) =>
    api
      .get<VoiceTranscriptResponse>(
        `/voice/sessions/${encodeURIComponent(streamSid)}/transcript`,
      )
      .then((res) => res.data),

  getTranscriptEmailStatus: (streamSid: string) =>
    api
      .get<TranscriptEmailStatusResponse>(
        `/voice/sessions/${encodeURIComponent(streamSid)}/transcript-email-status`,
      )
      .then((res) => res.data),

  sendTranscriptEmail: (streamSid: string, resend = false) =>
    api
      .post<TranscriptEmailStatusResponse>(
        `/voice/sessions/${encodeURIComponent(streamSid)}/send-transcript-email`,
        { resend },
      )
      .then((res) => res.data),

  initiateTestCall: (body: VoiceTestCallRequest) =>
    api
      .post<VoiceTestCallResponse>('/voice/test-call', body)
      .then((res) => res.data),
};
