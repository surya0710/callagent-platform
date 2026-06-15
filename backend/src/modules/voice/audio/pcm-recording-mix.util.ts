import { decodeMulawBuffer } from './mulaw-codec';

const MULAW_SILENCE_BYTE = 0xff;

export interface RecordingTimelineChunk {
  offsetMs: number;
  mulaw: Buffer;
}

export interface RecordingTimelineSummary {
  startMs: number | null;
  endMs: number | null;
  chunkCount: number;
}

export function summarizeRecordingTimeline(
  chunks: RecordingTimelineChunk[],
  sampleRate: number,
): RecordingTimelineSummary {
  if (chunks.length === 0) {
    return { startMs: null, endMs: null, chunkCount: 0 };
  }

  let startMs = Number.POSITIVE_INFINITY;
  let endMs = 0;

  for (const chunk of chunks) {
    startMs = Math.min(startMs, chunk.offsetMs);
    endMs = Math.max(
      endMs,
      chunk.offsetMs + (chunk.mulaw.length / sampleRate) * 1000,
    );
  }

  return {
    startMs: Number.isFinite(startMs) ? startMs : null,
    endMs,
    chunkCount: chunks.length,
  };
}

function clampInt16(value: number): number {
  if (value > 32767) {
    return 32767;
  }
  if (value < -32768) {
    return -32768;
  }
  return value;
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
    writeMulawChunkToPcmTimeline(samples, chunk, sampleRate, 'inbound');
  }

  for (const chunk of outboundChunks) {
    writeMulawChunkToPcmTimeline(samples, chunk, sampleRate, 'outbound');
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
  direction: 'inbound' | 'outbound',
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

    const mulawByte = chunk.mulaw[i]!;
    if (isMulawSilenceByte(mulawByte)) {
      continue;
    }

    const sample = pcm.readInt16LE(i * 2);
    if (direction === 'inbound') {
      timeline[position] = sample;
      continue;
    }

    timeline[position] = clampInt16(timeline[position]! + sample);
  }
}

export function isMulawSilenceByte(value: number): boolean {
  return value === MULAW_SILENCE_BYTE;
}
