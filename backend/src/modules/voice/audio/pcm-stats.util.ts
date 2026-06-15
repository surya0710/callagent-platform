export interface Pcm16Stats {
  sampleCount: number;
  min: number;
  max: number;
  peak: number;
  avgAbs: number;
  rms: number;
}

export function analyzePcm16(pcm16: Buffer): Pcm16Stats {
  const sampleCount = Math.floor(pcm16.length / 2);
  if (sampleCount === 0) {
    return {
      sampleCount: 0,
      min: 0,
      max: 0,
      peak: 0,
      avgAbs: 0,
      rms: 0,
    };
  }

  let min = 32767;
  let max = -32768;
  let peak = 0;
  let sumAbs = 0;
  let sumSquares = 0;

  for (let i = 0; i < sampleCount; i += 1) {
    const sample = pcm16.readInt16LE(i * 2);
    if (sample < min) {
      min = sample;
    }
    if (sample > max) {
      max = sample;
    }
    const abs = Math.abs(sample);
    if (abs > peak) {
      peak = abs;
    }
    sumAbs += abs;
    sumSquares += sample * sample;
  }

  return {
    sampleCount,
    min,
    max,
    peak,
    avgAbs: sumAbs / sampleCount,
    rms: Math.sqrt(sumSquares / sampleCount),
  };
}

export function mergePcm16Stats(
  existing: Pcm16Stats | undefined,
  chunk: Pcm16Stats,
): Pcm16Stats {
  if (!existing || existing.sampleCount === 0) {
    return { ...chunk };
  }
  if (chunk.sampleCount === 0) {
    return { ...existing };
  }

  const totalSamples = existing.sampleCount + chunk.sampleCount;
  const existingEnergy = existing.rms * existing.rms * existing.sampleCount;
  const chunkEnergy = chunk.rms * chunk.rms * chunk.sampleCount;

  return {
    sampleCount: totalSamples,
    min: Math.min(existing.min, chunk.min),
    max: Math.max(existing.max, chunk.max),
    peak: Math.max(existing.peak, chunk.peak),
    avgAbs:
      (existing.avgAbs * existing.sampleCount +
        chunk.avgAbs * chunk.sampleCount) /
      totalSamples,
    rms: Math.sqrt((existingEnergy + chunkEnergy) / totalSamples),
  };
}

export function formatPcm16Stats(stats: Pcm16Stats): Record<string, number> {
  return {
    sampleCount: stats.sampleCount,
    min: stats.min,
    max: stats.max,
    peak: stats.peak,
    avgAbs: Number(stats.avgAbs.toFixed(2)),
    rms: Number(stats.rms.toFixed(2)),
  };
}
