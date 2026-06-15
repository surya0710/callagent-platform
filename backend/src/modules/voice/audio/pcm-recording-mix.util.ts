import { decodeMulawBuffer } from './mulaw-codec';

const MULAW_SILENCE_BYTE = 0xff;
const PCM_SILENCE_THRESHOLD = 64;

export interface RecordingTimelineChunk {
  offsetMs: number;
  mulaw: Buffer;
}

export function buildMixedPcmTimeline(
  inboundChunks: RecordingTimelineChunk[],
  outboundChunks: RecordingTimelineChunk[],
  sampleRate: number,
): Buffer {
  const allChunks = [...inboundChunks, ...outboundChunks];
  if (allChunks.length === 0) {
    return Buffer.alloc(0);
  }

  const totalMs = allChunks.reduce((maxEndMs, chunk) => {
    const endMs = chunk.offsetMs + (chunk.mulaw.length / sampleRate) * 1000;
    return Math.max(maxEndMs, endMs);
  }, 0);
  const totalSamples = Math.max(1, Math.ceil((totalMs / 1000) * sampleRate));
  const samples = new Int16Array(totalSamples);

  for (const chunk of inboundChunks) {
    writeMulawChunkToPcmTimeline(samples, chunk, sampleRate, false);
  }

  for (const chunk of outboundChunks) {
    writeMulawChunkToPcmTimeline(samples, chunk, sampleRate, true);
  }

  const output = Buffer.allocUnsafe(totalSamples * 2);
  for (let i = 0; i < totalSamples; i += 1) {
    output.writeInt16LE(samples[i]!, i * 2);
  }

  return output;
}

function writeMulawChunkToPcmTimeline(
  timeline: Int16Array,
  chunk: RecordingTimelineChunk,
  sampleRate: number,
  overwrite: boolean,
): void {
  if (chunk.mulaw.length === 0) {
    return;
  }

  const pcm = decodeMulawBuffer(chunk.mulaw);
  const startSample = Math.floor((chunk.offsetMs / 1000) * sampleRate);
  const sampleCount = Math.floor(pcm.length / 2);

  for (let i = 0; i < sampleCount; i += 1) {
    const position = startSample + i;
    if (position >= timeline.length) {
      break;
    }

    const sample = pcm.readInt16LE(i * 2);
    if (!isMeaningfulPcmSample(sample)) {
      continue;
    }

    if (overwrite) {
      timeline[position] = sample;
      continue;
    }

    if (!isMeaningfulPcmSample(timeline[position]!)) {
      timeline[position] = sample;
    }
  }
}

function isMeaningfulPcmSample(sample: number | undefined): boolean {
  return sample !== undefined && Math.abs(sample) >= PCM_SILENCE_THRESHOLD;
}

export function isMulawSilenceByte(value: number): boolean {
  return value === MULAW_SILENCE_BYTE;
}
