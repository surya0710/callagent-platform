import { analyzePcm16 } from './pcm-stats.util';

function clampInt16(value: number): number {
  if (value > 32767) {
    return 32767;
  }
  if (value < -32768) {
    return -32768;
  }
  return value;
}

const DEFAULT_GAIN = 2;
const TARGET_PEAK = 26000;
const MIN_PEAK_TO_NORMALIZE = 256;

export function parseVoiceAudioGain(raw: string | undefined): number {
  if (!raw?.trim()) {
    return DEFAULT_GAIN;
  }

  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_GAIN;
  }

  return Math.min(parsed, 16);
}

export function parseVoiceAudioAutoNormalize(raw: string | undefined): boolean {
  if (!raw?.trim()) {
    return true;
  }

  const normalized = raw.trim().toLowerCase();
  return normalized !== 'false' && normalized !== '0' && normalized !== 'off';
}

export function applyPcm16Gain(pcm16: Buffer, gain: number): Buffer {
  if (gain === 1 || pcm16.length < 2) {
    return pcm16;
  }

  const output = Buffer.allocUnsafe(pcm16.length);
  const sampleCount = Math.floor(pcm16.length / 2);

  for (let i = 0; i < sampleCount; i += 1) {
    const scaled = Math.round(pcm16.readInt16LE(i * 2) * gain);
    output.writeInt16LE(clampInt16(scaled), i * 2);
  }

  return output;
}

export function normalizePcm16Peak(
  pcm16: Buffer,
  targetPeak = TARGET_PEAK,
): Buffer {
  const stats = analyzePcm16(pcm16);
  if (stats.peak < MIN_PEAK_TO_NORMALIZE) {
    return pcm16;
  }

  const scale = Math.min(targetPeak / stats.peak, 12);
  if (scale <= 1.05) {
    return pcm16;
  }

  return applyPcm16Gain(pcm16, scale);
}

export function prepareOutboundPcm16(
  pcm16: Buffer,
  options: { autoNormalize: boolean; gain: number },
): Buffer {
  let output = pcm16;
  if (options.autoNormalize) {
    output = normalizePcm16Peak(output);
  }
  if (options.gain !== 1) {
    output = applyPcm16Gain(output, options.gain);
  }
  return output;
}
