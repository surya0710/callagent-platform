import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import { encodePcm16ToMulaw } from '../audio/mulaw-codec';
import { resamplePcm16 } from '../audio/pcm-resampler';
import { VoiceSessionService } from '../voice-session.service';
import { VoiceSocketRegistry } from '../voice-socket.registry';
import {
  VoiceRuntimeProvider,
  VoiceRuntimeSessionContext,
  VoiceRuntimeStatus,
} from './voice-runtime.provider';

const SMARTFLO_SAMPLE_RATE = 8000;
const OPENAI_SAMPLE_RATE = 24000;
const MULAW_FRAME_BYTES = 160;

const DEFAULT_INSTRUCTIONS =
  'You are a helpful voice assistant on a phone call. Keep responses concise and conversational.';

interface OpenAiRealtimeSession {
  streamSid: string;
  ws: WebSocket;
  status: VoiceRuntimeStatus;
  connectedAt?: Date;
  outboundMulawBuffer: Buffer;
  closing: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

@Injectable()
export class OpenAIRealtimeProvider implements VoiceRuntimeProvider {
  readonly name = 'openai-realtime';
  private readonly logger = new Logger(OpenAIRealtimeProvider.name);
  private readonly sessions = new Map<string, OpenAiRealtimeSession>();

  constructor(
    private readonly configService: ConfigService,
    private readonly voiceSocketRegistry: VoiceSocketRegistry,
    private readonly voiceSessionService: VoiceSessionService,
  ) {}

  async createSession(context: VoiceRuntimeSessionContext): Promise<void> {
    const { streamSid } = context;
    if (!streamSid) {
      return;
    }

    if (this.sessions.has(streamSid)) {
      await this.endSession(streamSid);
    }

    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    const model =
      this.configService.get<string>('OPENAI_REALTIME_MODEL')?.trim() ??
      'gpt-realtime';

    if (!apiKey) {
      const message = 'OPENAI_API_KEY is not configured';
      this.logger.error({ streamSid, message });
      this.updateRuntimeState(streamSid, {
        runtimeStatus: 'error',
        runtimeError: message,
      });
      return;
    }

    this.updateRuntimeState(streamSid, {
      runtimeProvider: this.name,
      runtimeStatus: 'connecting',
      runtimeError: undefined,
    });

    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    const session: OpenAiRealtimeSession = {
      streamSid,
      ws,
      status: 'connecting',
      outboundMulawBuffer: Buffer.alloc(0),
      closing: false,
    };
    this.sessions.set(streamSid, session);

    ws.on('open', () => {
      session.status = 'connected';
      session.connectedAt = new Date();
      this.updateRuntimeState(streamSid, {
        runtimeStatus: 'connected',
        runtimeConnectedAt: session.connectedAt,
        runtimeLastEventAt: new Date(),
        runtimeError: undefined,
      });

      this.sendSessionUpdate(ws, model);
      this.logger.log({ streamSid, model, message: 'OpenAI Realtime session connected' });
    });

    ws.on('message', (data) => {
      this.handleServerMessage(streamSid, data);
    });

    ws.on('error', (error) => {
      this.logger.error({ streamSid, err: error }, 'OpenAI Realtime WebSocket error');
      session.status = 'error';
      this.updateRuntimeState(streamSid, {
        runtimeStatus: 'error',
        runtimeLastEventAt: new Date(),
        runtimeError: error.message,
      });
    });

    ws.on('close', (code, reason) => {
      session.status = 'closed';
      this.sessions.delete(streamSid);
      this.updateRuntimeState(streamSid, {
        runtimeStatus: 'closed',
        runtimeLastEventAt: new Date(),
      });
      this.logger.log({
        streamSid,
        code,
        reason: reason.toString(),
        message: 'OpenAI Realtime session closed',
      });
    });
  }

  handleAudio(streamSid: string, pcm16Audio: Buffer): void {
    const session = this.sessions.get(streamSid);
    if (!session || session.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (pcm16Audio.length === 0) {
      return;
    }

    const pcm24 = resamplePcm16(
      pcm16Audio,
      SMARTFLO_SAMPLE_RATE,
      OPENAI_SAMPLE_RATE,
    );

    session.ws.send(
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: pcm24.toString('base64'),
      }),
    );

    this.updateRuntimeState(streamSid, {
      runtimeLastEventAt: new Date(),
    });
  }

  async endSession(streamSid: string): Promise<void> {
    const session = this.sessions.get(streamSid);
    if (!session) {
      return;
    }

    session.closing = true;
    const { ws } = session;

    await new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) {
        this.sessions.delete(streamSid);
        resolve();
        return;
      }

      ws.once('close', () => resolve());
      ws.close();
      setTimeout(() => resolve(), 2000);
    });

    this.sessions.delete(streamSid);
    this.updateRuntimeState(streamSid, {
      runtimeStatus: 'closed',
      runtimeLastEventAt: new Date(),
    });
  }

  private sendSessionUpdate(ws: WebSocket, model: string): void {
    const voice =
      this.configService.get<string>('OPENAI_REALTIME_VOICE')?.trim() ?? 'alloy';
    const instructions =
      this.configService.get<string>('OPENAI_REALTIME_INSTRUCTIONS')?.trim() ??
      DEFAULT_INSTRUCTIONS;

    ws.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          model,
          output_modalities: ['audio'],
          audio: {
            input: {
              format: {
                type: 'audio/pcm',
                rate: OPENAI_SAMPLE_RATE,
              },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
              },
            },
            output: {
              format: {
                type: 'audio/pcm',
              },
              voice,
            },
          },
          instructions,
        },
      }),
    );
  }

  private handleServerMessage(streamSid: string, data: WebSocket.RawData): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      this.logger.warn({ streamSid, message: 'Invalid JSON from OpenAI Realtime' });
      return;
    }

    const type = event.type;
    if (typeof type !== 'string') {
      return;
    }

    this.updateRuntimeState(streamSid, {
      runtimeLastEventAt: new Date(),
    });

    if (type === 'error') {
      const error = asRecord(event.error);
      const message =
        typeof error?.message === 'string'
          ? error.message
          : 'OpenAI Realtime error';
      this.logger.error({ streamSid, error: event.error }, message);
      this.updateRuntimeState(streamSid, {
        runtimeStatus: 'error',
        runtimeError: message,
      });
      return;
    }

    if (
      type === 'response.output_audio.delta' ||
      type === 'response.audio.delta'
    ) {
      const delta = event.delta;
      if (typeof delta !== 'string' || delta.length === 0) {
        return;
      }
      this.handleOutputAudioDelta(streamSid, delta);
      return;
    }

    if (type === 'session.created' || type === 'session.updated') {
      this.logger.debug({ streamSid, type });
    }
  }

  private handleOutputAudioDelta(streamSid: string, base64Pcm24: string): void {
    const session = this.sessions.get(streamSid);
    if (!session) {
      return;
    }

    let pcm24: Buffer;
    try {
      pcm24 = Buffer.from(base64Pcm24, 'base64');
    } catch (error) {
      this.logger.warn({ streamSid, err: error }, 'Invalid OpenAI audio delta');
      return;
    }

    if (pcm24.length === 0) {
      return;
    }

    const pcm8 = resamplePcm16(
      pcm24,
      OPENAI_SAMPLE_RATE,
      SMARTFLO_SAMPLE_RATE,
    );
    const mulaw = encodePcm16ToMulaw(pcm8);
    session.outboundMulawBuffer = Buffer.concat([
      session.outboundMulawBuffer,
      mulaw,
    ]);
    this.flushOutboundMulaw(session);
  }

  private flushOutboundMulaw(session: OpenAiRealtimeSession): void {
    while (session.outboundMulawBuffer.length >= MULAW_FRAME_BYTES) {
      const frame = session.outboundMulawBuffer.subarray(0, MULAW_FRAME_BYTES);
      session.outboundMulawBuffer = session.outboundMulawBuffer.subarray(
        MULAW_FRAME_BYTES,
      );
      this.sendOutboundMedia(
        session.streamSid,
        frame.toString('base64'),
      );
    }
  }

  private sendOutboundMedia(streamSid: string, base64MulawPayload: string): void {
    const client = this.voiceSocketRegistry.getByStreamSid(streamSid);
    if (!client || client.readyState !== WebSocket.OPEN) {
      this.logger.warn({
        streamSid,
        message: 'Cannot send media: no active WebSocket for streamSid',
      });
      return;
    }

    const chunk = this.voiceSocketRegistry.nextOutboundChunk(streamSid);
    client.send(
      JSON.stringify({
        event: 'media',
        streamSid,
        media: {
          payload: base64MulawPayload,
          chunk,
        },
      }),
    );
  }

  private updateRuntimeState(
    streamSid: string,
    update: {
      runtimeProvider?: string;
      runtimeStatus?: VoiceRuntimeStatus;
      runtimeConnectedAt?: Date;
      runtimeLastEventAt?: Date;
      runtimeError?: string;
    },
  ): void {
    this.voiceSessionService.updateRuntimeState(streamSid, update);
  }
}
