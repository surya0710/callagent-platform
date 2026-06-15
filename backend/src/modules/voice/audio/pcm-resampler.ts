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

  if (inputRate > outputRate && inputRate % outputRate === 0) {
    return downsamplePcm16IntegerRatio(input, inputRate / outputRate);
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

function downsamplePcm16IntegerRatio(input: Buffer, ratio: number): Buffer {
  const inputSamples = Math.floor(input.length / 2);
  const outputSamples = Math.floor(inputSamples / ratio);
  if (outputSamples <= 0) {
    return Buffer.alloc(0);
  }

  const output = Buffer.allocUnsafe(outputSamples * 2);
  for (let out = 0; out < outputSamples; out += 1) {
    let sum = 0;
    for (let j = 0; j < ratio; j += 1) {
      sum += input.readInt16LE((out * ratio + j) * 2);
    }
    output.writeInt16LE(clampInt16(Math.round(sum / ratio)), out * 2);
  }

  return output;
}

export class Pcm16StreamDownsampler {
  private remainder = Buffer.alloc(0);

  constructor(
    private readonly inputRate: number,
    private readonly outputRate: number,
  ) {
    if (inputRate <= outputRate || inputRate % outputRate !== 0) {
      throw new Error(
        `Unsupported stream downsampling ratio: ${inputRate} -> ${outputRate}`,
      );
    }
    this.ratio = inputRate / outputRate;
  }

  private readonly ratio: number;

  push(input: Buffer): Buffer {
    if (input.length === 0) {
      return Buffer.alloc(0);
    }

    const combined = Buffer.concat([this.remainder, input]);
    const totalSamples = Math.floor(combined.length / 2);
    const completeGroups = Math.floor(totalSamples / this.ratio);
    const consumedSamples = completeGroups * this.ratio;
    const output = Buffer.allocUnsafe(completeGroups * 2);

    for (let group = 0; group < completeGroups; group += 1) {
      let sum = 0;
      for (let j = 0; j < this.ratio; j += 1) {
        sum += combined.readInt16LE((group * this.ratio + j) * 2);
      }
      output.writeInt16LE(clampInt16(Math.round(sum / this.ratio)), group * 2);
    }

    this.remainder = combined.subarray(consumedSamples * 2);
    return output;
  }

  flush(padWithZeros = true): Buffer {
    if (this.remainder.length === 0) {
      return Buffer.alloc(0);
    }

    const samples = Math.floor(this.remainder.length / 2);
    const missing = this.ratio - (samples % this.ratio);
    const padded =
      padWithZeros && missing > 0 && missing < this.ratio
        ? Buffer.concat([
            this.remainder,
            Buffer.alloc(missing * 2),
          ])
        : this.remainder;

    const output = this.push(padded);
    this.remainder = Buffer.alloc(0);
    return output;
  }

  reset(): void {
    this.remainder = Buffer.alloc(0);
  }
}
