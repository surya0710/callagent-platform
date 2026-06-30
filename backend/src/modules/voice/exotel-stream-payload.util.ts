/**
 * @deprecated Use ./telephony/stream/exotel-stream.normalizer instead.
 * Kept for backward compatibility with older imports.
 */
export {
  decodeExotelInboundToPcm16,
  normalizeExotelStreamEvent as normalizeExotelStreamPayload,
  readExotelMediaPayloadBytes,
} from './telephony/stream/exotel-stream.normalizer';
