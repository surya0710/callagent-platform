import { VoiceSessionService } from '../src/modules/voice/voice-session.service';

describe('VoiceSessionService exotel session lifecycle', () => {
  function createService() {
    const voiceSharedStateService = {
      saveEndedSession: jest.fn(),
      listRecentEndedSessions: jest.fn().mockResolvedValue([]),
      getEndedSessionByStreamSid: jest.fn(),
    };

    return new VoiceSessionService(voiceSharedStateService as never);
  }

  it('creates exotel session immediately on websocket connect with fallback streamSid', () => {
    const service = createService();
    const session = service.createSocketSession('127.0.0.1');
    const streamSid = service.initializeExotelSessionOnConnect(session.socketSessionId, {
      authorizationId: 'auth-1',
      callSid: 'CA-1',
    });

    expect(streamSid).toBe('exotel_CA-1');
    const active = service.getActiveSessions();
    expect(active).toHaveLength(1);
    expect(active[0]?.telephonyProvider).toBe('exotel');
    expect(active[0]?.streamSidIsFallback).toBe(true);
    expect(active[0]?.authorizationId).toBe('auth-1');
  });

  it('preserves failed authorization exotel session in recent ended', async () => {
    const service = createService();
    const session = service.createSocketSession('127.0.0.1');
    const streamSid = service.initializeExotelSessionOnConnect(session.socketSessionId, {
      authorizationId: 'auth-2',
    });

    service.bindStreamSid(session.socketSessionId, {
      streamSid,
      callSid: 'CA-2',
      from: '+919876543210',
      to: '+918047491899',
    });
    service.markAppInitiated(streamSid, false, {
      rejectionReason: 'not_app_initiated',
    });
    service.endByStreamSid(streamSid, 'stop');

    const recent = await service.getRecentEndedSessions();
    expect(recent).toHaveLength(1);
    expect(recent[0]?.streamSid).toBe(streamSid);
    expect(recent[0]?.rejectionReason).toBe('not_app_initiated');
    expect(recent[0]?.telephonyProvider).toBe('exotel');
  });

  it('keeps auth-failed exotel sessions visible in active list', () => {
    const service = createService();
    const session = service.createSocketSession('127.0.0.1');
    const streamSid = service.initializeExotelSessionOnConnect(session.socketSessionId, {
      authorizationId: 'auth-3',
    });

    service.bindStreamSid(session.socketSessionId, {
      streamSid,
      callSid: 'CA-3',
    });
    service.markAppInitiated(streamSid, false, {
      rejectionReason: 'not_app_initiated',
    });

    const active = service.getActiveSessions();
    expect(active.some((entry) => entry.streamSid === streamSid)).toBe(true);
  });
});
