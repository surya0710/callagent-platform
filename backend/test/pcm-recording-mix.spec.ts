import { decodeMulawBuffer, encodePcm16ToMulaw } from '../src/modules/voice/audio/mulaw-codec';
import { buildMixedPcmTimeline } from '../src/modules/voice/audio/pcm-recording-mix.util';

const SAMPLE_RATE = 8000;

function toneMulawChunk(durationMs: number, amplitude = 8000): Buffer {
  const sampleCount = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const pcm = Buffer.allocUnsafe(sampleCount * 2);
  for (let i = 0; i < sampleCount; i += 1) {
    pcm.writeInt16LE(amplitude, i * 2);
  }
  return encodePcm16ToMulaw(pcm);
}

function decodedSample(mulaw: Buffer, index = 0): number {
  return decodeMulawBuffer(mulaw).readInt16LE(index * 2);
}

function sampleAtMs(mixed: Buffer, ms: number): number {
  return mixed.readInt16LE(Math.floor((ms / 1000) * SAMPLE_RATE) * 2);
}

describe('buildMixedPcmTimeline', () => {
  it('places inbound before outbound when offsets reflect call order', () => {
    const inboundMulaw = toneMulawChunk(100, 5000);
    const outboundMulaw = toneMulawChunk(100, 9000);
    const inbound = [{ offsetMs: 0, mulaw: inboundMulaw }];
    const outbound = [{ offsetMs: 200, mulaw: outboundMulaw }];

    const mixed = buildMixedPcmTimeline(inbound, outbound, SAMPLE_RATE);

    expect(sampleAtMs(mixed, 0)).toBe(decodedSample(inboundMulaw));
    expect(sampleAtMs(mixed, 150)).toBe(0);
    expect(sampleAtMs(mixed, 250)).toBe(decodedSample(outboundMulaw));
  });

  it('does not drop quiet inbound speech', () => {
    const inboundMulaw = toneMulawChunk(100, 200);
    const inbound = [{ offsetMs: 1000, mulaw: inboundMulaw }];
    const outbound: { offsetMs: number; mulaw: Buffer }[] = [];

    const mixed = buildMixedPcmTimeline(inbound, outbound, SAMPLE_RATE);

    expect(sampleAtMs(mixed, 1000)).toBe(decodedSample(inboundMulaw));
  });

  it('additively mixes overlapping inbound and outbound', () => {
    const inboundMulaw = toneMulawChunk(100, 3000);
    const outboundMulaw = toneMulawChunk(100, 2000);
    const inbound = [{ offsetMs: 0, mulaw: inboundMulaw }];
    const outbound = [{ offsetMs: 0, mulaw: outboundMulaw }];

    const mixed = buildMixedPcmTimeline(inbound, outbound, SAMPLE_RATE);

    expect(mixed.readInt16LE(0)).toBe(
      decodedSample(inboundMulaw) + decodedSample(outboundMulaw),
    );
  });
});
