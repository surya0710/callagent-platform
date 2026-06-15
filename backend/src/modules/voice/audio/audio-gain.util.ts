function clampInt16(value: number): number {
  if (value > 32767) {
    return 32767;
  }
  if (value < -32768) {
    return -32768;
  }
  return value;
}

export function parseVoiceAudioGain(raw: string | undefined): number {
  if (!raw?.trim()) {
    return 1;
  }

  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }

  return Math.min(parsed, 16);
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
