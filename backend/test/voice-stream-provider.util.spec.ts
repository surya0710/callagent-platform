import { IncomingMessage } from 'http';
import {
  parseVoiceStreamAuthorizationIdFromRequest,
  parseVoiceStreamQueryFromRequest,
} from '../src/modules/voice/voice-stream-provider.util';
import { TelephonyProvider } from '../src/modules/voice/telephony/telephony-provider.types';

function mockRequest(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

describe('voice-stream-provider.util', () => {
  it('parses exotel provider and authorizationId from WSS query', () => {
    const request = mockRequest(
      '/api/voice/stream?provider=exotel&authorizationId=auth-123',
    );

    expect(parseVoiceStreamQueryFromRequest(request)).toEqual({
      provider: TelephonyProvider.EXOTEL,
      authorizationId: 'auth-123',
      callSid: undefined,
    });
    expect(parseVoiceStreamAuthorizationIdFromRequest(request)).toBe('auth-123');
  });

  it('parses CallSid from WSS query for Exotel handoff', () => {
    const request = mockRequest(
      '/api/voice/stream?provider=exotel&authorizationId=auth-123&CallSid=CA-wss',
    );

    expect(parseVoiceStreamQueryFromRequest(request)).toEqual({
      provider: TelephonyProvider.EXOTEL,
      authorizationId: 'auth-123',
      callSid: 'CA-wss',
    });
  });

  it('accepts authorization_id snake_case alias', () => {
    const request = mockRequest(
      '/api/voice/stream?provider=exotel&authorization_id=auth-456',
    );

    expect(parseVoiceStreamAuthorizationIdFromRequest(request)).toBe('auth-456');
  });

  it('accepts call_sid snake_case alias', () => {
    const request = mockRequest(
      '/api/voice/stream?provider=exotel&call_sid=CA-snake',
    );

    expect(parseVoiceStreamQueryFromRequest(request).callSid).toBe('CA-snake');
  });

  it('returns empty query params when URL has no search string', () => {
    const request = mockRequest('/api/voice/stream');

    expect(parseVoiceStreamQueryFromRequest(request)).toEqual({});
    expect(parseVoiceStreamAuthorizationIdFromRequest(request)).toBeUndefined();
  });
});
