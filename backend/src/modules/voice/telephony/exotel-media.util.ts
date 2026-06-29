import { decodeMulawBuffer, encodePcm16ToMulaw } from '../audio/mulaw-codec';

/** Exotel AgentStream PCM16 frame size at 8 kHz (20 ms = 160 samples). */
export const EXOTEL_PCM16_FRAME_BYTES = 320;

export function isLikelyExotelPcm16Payload(decoded: Buffer): boolean {
  if (decoded.length === 0) {
    return false;
  }

  if (decoded.length % 2 !== 0) {
    return false;
  }

  if (decoded.length % EXOTEL_PCM16_FRAME_BYTES === 0) {
    return true;
  }

  // 160-byte frames are μ-law on PSTN paths; even non-320 multiples lean PCM.
  if (decoded.length % 160 === 0) {
    return false;
  }

  return true;
}

/** Convert Exotel inbound PCM16 base64 to μ-law base64 for the Smartflo media path. */
export function exotelInboundBase64ToSmartfloMulawBase64(payloadBase64: string): string {
  const decoded = Buffer.from(payloadBase64, 'base64');
  if (decoded.length === 0) {
    return payloadBase64;
  }

  if (!isLikelyExotelPcm16Payload(decoded)) {
    return payloadBase64;
  }

  return encodePcm16ToMulaw(decoded).toString('base64');
}

/** Convert Smartflo/OpenAI outbound μ-law base64 to Exotel PCM16 base64. */
export function smartfloMulawBase64ToExotelPcm16Base64(mulawBase64: string): string {
  const mulaw = Buffer.from(mulawBase64, 'base64');
  if (mulaw.length === 0) {
    return mulawBase64;
  }

  const pcm16 = decodeMulawBuffer(mulaw);
  return padExotelPcm16Buffer(pcm16).toString('base64');
}

export function padExotelPcm16Buffer(
  pcm16: Buffer,
  frameBytes = EXOTEL_PCM16_FRAME_BYTES,
): Buffer {
  if (pcm16.length === 0) {
    return pcm16;
  }

  const remainder = pcm16.length % frameBytes;
  if (remainder === 0) {
    return pcm16;
  }

  return Buffer.concat([pcm16, Buffer.alloc(frameBytes - remainder, 0x00)]);
}
