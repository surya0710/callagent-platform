import { IncomingMessage } from 'http';
import {
  looksLikeExotelStreamMessage,
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

  it('infers exotel provider when only authorizationId is present in WSS query', () => {
    const request = mockRequest(
      '/api/voice/stream?authorizationId=auth-only',
    );

    expect(parseVoiceStreamQueryFromRequest(request)).toEqual({
      provider: TelephonyProvider.EXOTEL,
      authorizationId: 'auth-only',
      callSid: undefined,
    });
  });

  it('returns empty query params when URL has no search string', () => {
    const request = mockRequest('/api/voice/stream');

    expect(parseVoiceStreamQueryFromRequest(request)).toEqual({});
    expect(parseVoiceStreamAuthorizationIdFromRequest(request)).toBeUndefined();
  });

  it('detects Exotel connected event from first frame', () => {
    expect(looksLikeExotelStreamMessage('{"event":"connected"}')).toBe(true);
  });

  it('detects Exotel start event with stream_sid', () => {
    expect(
      looksLikeExotelStreamMessage(
        '{"event":"start","start":{"stream_sid":"MZ123"}}',
      ),
    ).toBe(true);
  });

  it('does not treat Smartflo start without stream sid as Exotel', () => {
    expect(
      looksLikeExotelStreamMessage('{"event":"start","start":{"callSid":"CA1"}}'),
    ).toBe(false);
  });
});
