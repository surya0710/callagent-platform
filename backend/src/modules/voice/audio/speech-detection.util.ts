const DEFAULT_SPEECH_AVG_ABS_THRESHOLD = 120;

export function averageAbsolutePcm16Amplitude(pcm16: Buffer): number {
  const sampleCount = Math.floor(pcm16.length / 2);
  if (sampleCount === 0) {
    return 0;
  }

  let sumAbs = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    sumAbs += Math.abs(pcm16.readInt16LE(i * 2));
  }

  return sumAbs / sampleCount;
}

export function isSpeechLikePcm16(
  pcm16: Buffer,
  threshold = DEFAULT_SPEECH_AVG_ABS_THRESHOLD,
): boolean {
  return averageAbsolutePcm16Amplitude(pcm16) >= threshold;
}
