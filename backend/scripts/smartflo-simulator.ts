#!/usr/bin/env ts-node
/**
 * Smartflo WebSocket simulator — streams real speech from a WAV file to the voice API.
 *
 * Usage:
 *   npm run smartflo:simulate -- path/to/speech.wav
 *   npm run smartflo:simulate -- path/to/speech.wav --url ws://localhost:3000/api/voice/stream
 *   npm run smartflo:simulate -- path/to/speech.wav --tail-ms 8000
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import { encodePcm16ToMulaw } from '../src/modules/voice/audio/mulaw-codec';
import { resamplePcm16 } from '../src/modules/voice/audio/pcm-resampler';

type WsMessageData = Buffer | ArrayBuffer | Buffer[];

const DEFAULT_WSS_URL = 'wss://tatdai.in/api/voice/stream';
const DEFAULT_STREAM_SID = 'TEST_OPENAI_AUDIO_001';
const TARGET_SAMPLE_RATE = 8000;
const CHUNK_MS = 100;
const MULAW_BYTES_PER_CHUNK = (TARGET_SAMPLE_RATE * CHUNK_MS) / 1000; // 800 @ 8 kHz

interface WavPcm16 {
  pcm: Buffer;
  sampleRate: number;
  channels: number;
}

interface CliOptions {
  wavPath: string;
  url: string;
  streamSid: string;
  chunkMs: number;
  tailMs: number;
}

function parseArgs(argv: string[]): CliOptions {
  const positional: string[] = [];
  let url = DEFAULT_WSS_URL;
  let streamSid = DEFAULT_STREAM_SID;
  let chunkMs = CHUNK_MS;
  let tailMs = 10000;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url' && argv[i + 1]) {
      url = argv[++i]!;
      continue;
    }
    if (arg === '--stream-sid' && argv[i + 1]) {
      streamSid = argv[++i]!;
      continue;
    }
    if (arg === '--chunk-ms' && argv[i + 1]) {
      chunkMs = Number(argv[++i]);
      continue;
    }
    if (arg === '--tail-ms' && argv[i + 1]) {
      tailMs = Number(argv[++i]);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length === 0) {
    printHelp();
    process.exit(1);
  }

  const wavPath = path.resolve(positional[0]!);
  if (!Number.isFinite(chunkMs) || chunkMs <= 0) {
    throw new Error('--chunk-ms must be a positive number');
  }
  if (!Number.isFinite(tailMs) || tailMs < 0) {
    throw new Error('--tail-ms must be zero or a positive number');
  }

  return { wavPath, url, streamSid, chunkMs, tailMs };
}

function printHelp(): void {
  console.log(`Smartflo simulator

Usage:
  npm run smartflo:simulate -- <wav-file> [options]

Options:
  --url <wss-url>         WebSocket URL (default: ${DEFAULT_WSS_URL})
  --stream-sid <id>       streamSid for start event (default: ${DEFAULT_STREAM_SID})
  --chunk-ms <ms>         Media packet interval in ms (default: ${CHUNK_MS})
  --tail-ms <ms>          Wait after last chunk before stop, to capture AI audio (default: 10000)
  -h, --help              Show this help
`);
}

function readWavPcm16(filePath: string): WavPcm16 {
  const fileBuffer = fs.readFileSync(filePath);
  if (fileBuffer.length < 44 || fileBuffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Not a valid WAV file (missing RIFF header)');
  }

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= fileBuffer.length) {
    const chunkId = fileBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = fileBuffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;

    if (chunkId === 'fmt ') {
      audioFormat = fileBuffer.readUInt16LE(chunkDataStart);
      channels = fileBuffer.readUInt16LE(chunkDataStart + 2);
      sampleRate = fileBuffer.readUInt32LE(chunkDataStart + 4);
      bitsPerSample = fileBuffer.readUInt16LE(chunkDataStart + 14);
    } else if (chunkId === 'data') {
      dataOffset = chunkDataStart;
      dataSize = chunkSize;
    }

    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || dataSize <= 0) {
    throw new Error('WAV file is missing a data chunk');
  }
  if (audioFormat !== 1) {
    throw new Error(
      `Unsupported WAV format ${audioFormat}; only PCM (format 1) is supported`,
    );
  }
  if (bitsPerSample !== 16) {
    throw new Error(
      `Unsupported bit depth ${bitsPerSample}; only 16-bit PCM is supported`,
    );
  }

  const pcmRaw = fileBuffer.subarray(dataOffset, dataOffset + dataSize);
  const pcm = channels === 1 ? pcmRaw : mixToMono(pcmRaw, channels);

  return { pcm, sampleRate, channels: 1 };
}

function mixToMono(interleaved: Buffer, channels: number): Buffer {
  const frameCount = Math.floor(interleaved.length / (2 * channels));
  const mono = Buffer.allocUnsafe(frameCount * 2);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch += 1) {
      sum += interleaved.readInt16LE((frame * channels + ch) * 2);
    }
    mono.writeInt16LE(Math.round(sum / channels), frame * 2);
  }

  return mono;
}

function prepareSmartfloMulaw(wav: WavPcm16): Buffer {
  let pcm = wav.pcm;
  if (wav.sampleRate !== TARGET_SAMPLE_RATE) {
    console.log(
      `Resampling ${wav.sampleRate} Hz → ${TARGET_SAMPLE_RATE} Hz mono PCM16`,
    );
    pcm = resamplePcm16(pcm, wav.sampleRate, TARGET_SAMPLE_RATE);
  }

  const mulaw = encodePcm16ToMulaw(pcm);
  console.log(
    `Prepared ${mulaw.length} μ-law bytes (~${(mulaw.length / TARGET_SAMPLE_RATE).toFixed(2)}s)`,
  );
  return mulaw;
}

function splitMulawChunks(mulaw: Buffer, chunkBytes: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < mulaw.length; offset += chunkBytes) {
    chunks.push(mulaw.subarray(offset, Math.min(offset + chunkBytes, mulaw.length)));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rawDataToString(raw: WsMessageData): string {
  if (Buffer.isBuffer(raw)) {
    return raw.toString('utf8');
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8');
  }
  return Buffer.from(raw).toString('utf8');
}

function logOutbound(raw: WsMessageData): void {
  const text = rawDataToString(raw);
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const event = payload.event;

    if (event === 'media') {
      const media =
        payload.media && typeof payload.media === 'object'
          ? (payload.media as Record<string, unknown>)
          : undefined;
      const b64 =
        media && typeof media.payload === 'string' ? media.payload : '';
      const decodedBytes = b64 ? Buffer.from(b64, 'base64').length : 0;
      console.log('[server ←] media', {
        streamSid: payload.streamSid,
        chunk: media?.chunk,
        timestamp: media?.timestamp,
        payloadBase64Length: b64.length,
        mulawBytes: decodedBytes,
      });
      return;
    }

    console.log('[server ←]', event ?? 'message', JSON.stringify(payload));
  } catch {
    console.log('[server ←] raw', text);
  }
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.wavPath)) {
    throw new Error(`WAV file not found: ${options.wavPath}`);
  }

  const chunkBytes = Math.round((TARGET_SAMPLE_RATE * options.chunkMs) / 1000);
  const wav = readWavPcm16(options.wavPath);
  const mulaw = prepareSmartfloMulaw(wav);
  const chunks = splitMulawChunks(mulaw, chunkBytes);

  console.log('Connecting to', options.url);
  const ws = new WebSocket(options.url);

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  console.log('WebSocket connected');

  ws.on('message', logOutbound);

  ws.send(
    JSON.stringify({
      event: 'connected',
      protocol: 'Call',
      version: '1.0.0',
    }),
  );
  console.log('[client →] connected');

  const callSid = `CA_SIM_${Date.now()}`;
  ws.send(
    JSON.stringify({
      event: 'start',
      sequenceNumber: 1,
      start: {
        streamSid: options.streamSid,
        callSid,
        accountSid: 'AC_SIMULATOR',
        from: '+919000000001',
        to: '+919000000002',
        direction: 'inbound',
        mediaFormat: {
          encoding: 'audio/x-mulaw',
          sampleRate: TARGET_SAMPLE_RATE,
          channels: 1,
        },
      },
    }),
  );
  console.log('[client →] start', { streamSid: options.streamSid, callSid });

  await sleep(300);

  let chunkNumber = 1;
  for (const chunk of chunks) {
    ws.send(
      JSON.stringify({
        event: 'media',
        streamSid: options.streamSid,
        sequenceNumber: chunkNumber + 1,
        media: {
          payload: chunk.toString('base64'),
          chunk: String(chunkNumber),
          timestamp: String((chunkNumber - 1) * options.chunkMs),
        },
      }),
    );
    console.log(
      `[client →] media chunk ${chunkNumber}/${chunks.length} (${chunk.length} μ-law bytes)`,
    );
    chunkNumber += 1;
    if (chunkNumber <= chunks.length) {
      await sleep(options.chunkMs);
    }
  }

  if (options.tailMs > 0) {
    console.log(`Waiting ${options.tailMs}ms for server/AI outbound audio...`);
    await sleep(options.tailMs);
  }

  ws.send(
    JSON.stringify({
      event: 'stop',
      streamSid: options.streamSid,
      sequenceNumber: chunkNumber + 1,
      stop: {
        callSid,
        reason: 'simulator_completed',
      },
    }),
  );
  console.log('[client →] stop');

  await sleep(500);
  ws.close(1000, 'simulator done');
  console.log('WebSocket closed');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
