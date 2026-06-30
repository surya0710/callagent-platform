import { VoiceCallAuthorizationService } from '../src/modules/voice/voice-call-authorization.service';

describe('VoiceCallAuthorizationService exotel matching', () => {
  function createService(requireAuthorization = true) {
    const configService = {
      get: (key: string) => {
        if (key === 'VOICE_REQUIRE_APP_AUTHORIZATION') {
          return requireAuthorization ? 'true' : 'false';
        }
        if (key === 'NODE_ENV') {
          return 'production';
        }
        return undefined;
      },
    };

    const voiceSharedStateService = {
      usesRedis: false,
      saveAuthorization: jest.fn(),
      loadAuthorization: jest.fn(),
      loadAuthorizationByCallSid: jest.fn(),
      loadLatestAuthorizationByPhone: jest.fn(),
      markAuthorizationConsumed: jest.fn(),
    };

    return new VoiceCallAuthorizationService(
      configService as never,
      voiceSharedStateService as never,
    );
  }

  it('authorizes exotel stream via WSS query authorizationId', async () => {
    const service = createService();
    const authorizationId = service.register({
      source: 'test-call',
      customerNumber: '919876543210',
    });

    const result = await service.authorizeStart({
      streamSid: 'MZ-auth-id',
      authorizationId,
      callSid: 'different-call-sid',
    });

    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.authorizationId).toBe(authorizationId);
    }
  });

  it('authorizes exotel stream via reserved stream-url callSid mapping', async () => {
    const service = createService();
    const authorizationId = service.register({
      source: 'test-call',
      customerNumber: '919876543210',
      callSid: 'CA-reserved',
    });

    service.rememberStreamUrlAuthorization('CA-reserved', authorizationId);

    const result = await service.authorizeStart({
      streamSid: 'MZ1',
      callSid: 'CA-reserved',
      from: '01141186965',
      to: '08047491899',
    });

    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.authorizationId).toBe(authorizationId);
    }
  });

  it('authorizes exotel stream via case-insensitive callSid', async () => {
    const service = createService();
    const authorizationId = service.register({
      source: 'test-call',
      customerNumber: '919876543210',
      callSid: 'CA-CaseSensitive',
    });

    const result = await service.authorizeStart({
      streamSid: 'MZ-case',
      callSid: 'ca-casesensitive',
    });

    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.authorizationId).toBe(authorizationId);
    }
  });

  it('authorizes exotel stream via phone suffix when callSid differs', async () => {
    const service = createService();
    service.register({
      source: 'test-call',
      customerNumber: '919876543210',
    });

    const result = await service.authorizeStart({
      streamSid: 'MZ2',
      callSid: 'different-call-sid',
      from: '01141186965',
      to: '9876543210',
    });

    expect(result.authorized).toBe(true);
  });

  it('returns not_app_initiated when no authorization matches', async () => {
    const service = createService();

    const result = await service.authorizeStart({
      streamSid: 'MZ-fail',
      callSid: 'CA-unknown',
      from: '01141186965',
      to: '08047491899',
    });

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.reason).toBe('not_app_initiated');
    }
  });
});
