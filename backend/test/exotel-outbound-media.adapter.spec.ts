import { ExotelOutboundMediaAdapter } from '../src/modules/voice/telephony/outbound/exotel-outbound-media.adapter';

describe('ExotelOutboundMediaAdapter', () => {
  const adapter = new ExotelOutboundMediaAdapter();

  it('builds Exotel outbound media frame with stream_sid and PCM16 payload', () => {
    const mulaw = Buffer.alloc(160, 0xff);
    const result = adapter.buildOutboundMedia({
      streamSid: 'MZ123',
      base64MulawPayload: mulaw.toString('base64'),
      chunk: 1,
      sequenceNumber: 1,
      timestamp: 0,
    });

    const parsed = JSON.parse(result.message) as {
      event: string;
      streamSid: string;
      media: { payload: string };
    };

    expect(parsed.event).toBe('media');
    expect(parsed.streamSid).toBe('MZ123');
    expect(typeof parsed.media.payload).toBe('string');
    expect(Buffer.from(parsed.media.payload, 'base64').length).toBeGreaterThan(0);
    expect(result.decodedMulawBytes).toBe(160);
  });
});
