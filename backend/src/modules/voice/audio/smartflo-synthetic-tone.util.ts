import { encodePcm16ToMulaw } from './mulaw-codec';

const MULAW_SILENCE_BYTE = 0xff;

/** Generate a μ-law tone buffer for Smartflo outbound playback diagnostics. */
export function generateMulawToneBuffer(options: {
  frequencyHz: number;
  durationMs: number;
  sampleRate: number;
  amplitude?: number;
}): Buffer {
  const sampleCount = Math.max(
    1,
    Math.floor((options.durationMs / 1000) * options.sampleRate),
  );
  const pcm = Buffer.allocUnsafe(sampleCount * 2);
  const amplitude = options.amplitude ?? 8000;

  for (let i = 0; i < sampleCount; i += 1) {
    const sample = Math.round(
      amplitude *
        Math.sin((2 * Math.PI * options.frequencyHz * i) / options.sampleRate),
    );
    pcm.writeInt16LE(sample, i * 2);
  }

  return encodePcm16ToMulaw(pcm);
}

export function splitMulawIntoFixedChunks(
  mulaw: Buffer,
  chunkBytes: number,
): Buffer[] {
  if (chunkBytes <= 0 || mulaw.length === 0) {
    return [];
  }

  const chunks: Buffer[] = [];
  for (let offset = 0; offset < mulaw.length; offset += chunkBytes) {
    const slice = mulaw.subarray(offset, offset + chunkBytes);
    if (slice.length === chunkBytes) {
      chunks.push(slice);
      continue;
    }

    chunks.push(
      Buffer.concat([
        slice,
        Buffer.alloc(chunkBytes - slice.length, MULAW_SILENCE_BYTE),
      ]),
    );
  }

  return chunks;
}

export function isSyntheticToneDebugEnabled(): boolean {
  return (
    process.env.VOICE_DEBUG_SYNTHETIC_TONE?.trim().toLowerCase() === 'true'
  );
}
