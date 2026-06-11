import api from './api';
import { VoiceHealthResponse, VoiceSessionsResponse } from '../types/voice';

export const voiceApi = {
  getHealth: () =>
    api.get<VoiceHealthResponse>('/voice/health').then((res) => res.data),

  getSessions: () =>
    api.get<VoiceSessionsResponse>('/voice/sessions').then((res) => res.data),
};
