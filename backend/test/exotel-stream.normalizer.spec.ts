import {
  decodeExotelInboundToPcm16,
  extractExotelCallSid,
  extractExotelStreamSid,
  normalizeExotelStreamEvent,
} from '../src/modules/voice/telephony/stream/exotel-stream.normalizer';

describe('exotel-stream.normalizer', () => {
  it('normalizes exotel start event to canonical start data', () => {
    const result = normalizeExotelStreamEvent({
      event: 'start',
      stream_sid: 'MZ123',
      call_sid: 'CA789',
      start: {
        stream_sid: 'MZ123',
        call_sid: 'CA456',
        from: '+919876543210',
        to: '+918047491899',
        custom_parameters: 'authorizationId=auth-1',
      },
    });

    expect(result.event).toBe('start');
    if (result.event !== 'start') {
      return;
    }

    expect(result.streamSid).toBe('MZ123');
    expect(result.start.callSid).toBe('CA456');
    expect(result.start.customParameters).toEqual({ authorizationId: 'auth-1' });
  });

  it('falls back to top-level call_sid when start.call_sid is missing', () => {
    const result = normalizeExotelStreamEvent({
      event: 'start',
      stream_sid: 'MZ123',
      call_sid: 'CA789',
      start: {
        stream_sid: 'MZ123',
        from: '+919876543210',
      },
    });

    expect(result.event).toBe('start');
    if (result.event !== 'start') {
      return;
    }

    expect(result.start.callSid).toBe('CA789');
  });

  it('normalizes start without streamSid using call_sid fallback extraction', () => {
    const payload = {
      event: 'start',
      call_sid: 'CA-no-stream',
      start: {
        from: '+919876543210',
        to: '+918047491899',
      },
    };

    expect(extractExotelStreamSid(payload, payload.start as Record<string, unknown>)).toBe(
      'CA-no-stream',
    );

    const result = normalizeExotelStreamEvent(payload);
    expect(result.event).toBe('start');
    if (result.event !== 'start') {
      return;
    }

    expect(result.streamSid).toBe('CA-no-stream');
    expect(result.start.callSid).toBe('CA-no-stream');
  });

  it('extracts callSid from custom_parameters', () => {
    const payload = {
      event: 'start',
      stream_sid: 'MZ123',
      start: {
        custom_parameters: 'callSid=CA-custom&authorizationId=auth-2',
      },
    };

    expect(
      extractExotelCallSid(payload, payload.start as Record<string, unknown>),
    ).toBe('CA-custom');
  });

  it('extracts callSid from top-level custom_parameters', () => {
    const payload = {
      event: 'start',
      stream_sid: 'MZ123',
      custom_parameters: 'CallSid=CA-top-level',
      start: {},
    };

    expect(
      extractExotelCallSid(payload, payload.start as Record<string, unknown>),
    ).toBe('CA-top-level');
  });

  it('decodes inbound exotel PCM16 media without routing through smartflo shape', () => {
    const pcm16 = Buffer.alloc(320, 0);
    const payload = pcm16.toString('base64');

    const result = normalizeExotelStreamEvent({
      event: 'media',
      stream_sid: 'MZ123',
      media: { payload },
    });

    expect(result.event).toBe('media');
    if (result.event !== 'media') {
      return;
    }

    expect(result.streamSid).toBe('MZ123');
    expect(result.pcm16Audio.length).toBe(320);
    expect(result.recordingInboundMulawBase64).toBeTruthy();
    expect(decodeExotelInboundToPcm16(Buffer.from(payload, 'base64')).length).toBe(
      320,
    );
  });
});
