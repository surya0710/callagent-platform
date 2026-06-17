import api from './api';
import {
  VoiceHealthResponse,
  VoiceSessionsResponse,
  VoiceTestCallRequest,
  VoiceTestCallResponse,
  VoiceTranscriptResponse,
} from '../types/voice';

export const voiceApi = {
  getHealth: () =>
    api.get<VoiceHealthResponse>('/voice/health').then((res) => res.data),

  getSessions: () =>
    api.get<VoiceSessionsResponse>('/voice/sessions').then((res) => res.data),

  getSessionTranscript: (streamSid: string) =>
    api
      .get<VoiceTranscriptResponse>(
        `/voice/sessions/${encodeURIComponent(streamSid)}/transcript`,
      )
      .then((res) => res.data),

  initiateTestCall: (body: VoiceTestCallRequest) =>
    api
      .post<VoiceTestCallResponse>('/voice/test-call', body)
      .then((res) => res.data),
};
