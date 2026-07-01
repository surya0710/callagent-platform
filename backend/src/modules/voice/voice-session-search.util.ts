import { VoiceSession } from './voice-session.service';

function sessionSearchHaystack(session: VoiceSession): string {
  return [
    session.socketSessionId,
    session.streamSid,
    session.callSid,
    session.accountSid,
    session.from,
    session.to,
    session.direction,
    session.status,
    session.telephonyProvider,
    session.runtimeProvider,
    session.rejectionReason,
    session.stopReason,
    session.callId,
    session.authorizationId,
    session.authorizationSource,
    session.lastEvent,
    session.remoteAddress,
  ]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map((value) => String(value).toLowerCase())
    .join(' ');
}

export function filterVoiceSessionsBySearch(
  sessions: VoiceSession[],
  search?: string,
): VoiceSession[] {
  const term = search?.trim().toLowerCase();
  if (!term) {
    return sessions;
  }

  return sessions.filter((session) => sessionSearchHaystack(session).includes(term));
}
