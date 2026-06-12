function clampInt16(value: number): number {
  if (value > 32767) {
    return 32767;
  }
  if (value < -32768) {
    return -32768;
  }
  return value;
}

export function resamplePcm16(
  input: Buffer,
  inputRate: number,
  outputRate: number,
): Buffer {
  if (inputRate === outputRate) {
    return input;
  }

  const inputSamples = Math.floor(input.length / 2);
  if (inputSamples === 0) {
    return Buffer.alloc(0);
  }

  const ratio = outputRate / inputRate;
  const outputSamples = Math.max(1, Math.floor(inputSamples * ratio));
  const output = Buffer.allocUnsafe(outputSamples * 2);

  for (let i = 0; i < outputSamples; i += 1) {
    const srcPos = i / ratio;
    const srcIndex = Math.min(Math.floor(srcPos), inputSamples - 1);
    const frac = srcPos - srcIndex;
    const nextIndex = Math.min(srcIndex + 1, inputSamples - 1);

    const sample0 = input.readInt16LE(srcIndex * 2);
    const sample1 = input.readInt16LE(nextIndex * 2);
    const interpolated = Math.round(sample0 + frac * (sample1 - sample0));

    output.writeInt16LE(clampInt16(interpolated), i * 2);
  }

  return output;
}
