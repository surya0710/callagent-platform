const MULAW_BIAS = 33;

function clampInt16(value: number): number {
  if (value > 32767) {
    return 32767;
  }
  if (value < -32768) {
    return -32768;
  }
  return value;
}

export function decodeMulawSample(muLawByte: number): number {
  const inverted = ~muLawByte & 0xff;
  const sign = inverted & 0x80 ? -1 : 1;
  const exponent = (inverted >> 4) & 0x07;
  const mantissa = inverted & 0x0f;
  const sample = sign * ((((mantissa << 1) + MULAW_BIAS) << exponent) - MULAW_BIAS);
  return clampInt16(sample);
}

export function decodeMulawBuffer(input: Buffer): Buffer {
  const output = Buffer.allocUnsafe(input.length * 2);
  for (let i = 0; i < input.length; i += 1) {
    output.writeInt16LE(decodeMulawSample(input[i]!), i * 2);
  }
  return output;
}

function linearToMulawSample(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) {
    sample = -sample;
  }
  if (sample > 32635) {
    sample = 32635;
  }
  sample += 132;

  let exponent = 7;
  for (
    let mask = 0x4000;
    exponent > 0 && (sample & mask) === 0;
    exponent -= 1, mask >>= 1
  ) {
    // find segment
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function encodePcm16ToMulaw(input: Buffer): Buffer {
  const sampleCount = Math.floor(input.length / 2);
  const output = Buffer.allocUnsafe(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    output[i] = linearToMulawSample(input.readInt16LE(i * 2));
  }
  return output;
}
