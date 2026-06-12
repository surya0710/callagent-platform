import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebSocket } from 'ws';
import { encodePcm16ToMulaw } from '../audio/mulaw-codec';
import { resamplePcm16 } from '../audio/pcm-resampler';
import { AudioGateway } from '../audio.gateway';
import { VoiceSessionService } from '../voice-session.service';
import {
  VoiceRuntimeProvider,
  VoiceRuntimeSessionContext,
  VoiceRuntimeStatus,
} from './voice-runtime.provider';

const SMARTFLO_SAMPLE_RATE = 8000;
const OPENAI_SAMPLE_RATE = 24000;
const MULAW_FRAME_BYTES = 160;
const MULAW_SILENCE_BYTE = 0xff;
const INPUT_COMMIT_DELAY_MS = 800;
const RESPONSE_WAIT_MS = 15000;

const DEFAULT_INSTRUCTIONS =
  'You are a helpful voice assistant on a phone call. Keep responses concise and conversational.';

const LOGGED_OPENAI_EVENTS = new Set([
  'session.created',
  'session.updated',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_started',
  'input_audio_buffer.speech_stopped',
  'response.created',
  'response.output_item.added',
  'response.audio.delta',
  'response.output_audio.delta',
  'response.audio.done',
  'response.output_audio.done',
  'response.done',
  'error',
]);

interface OpenAiRealtimeSession {
  streamSid: string;
  ws: WebSocket;
  status: VoiceRuntimeStatus;
  connectedAt?: Date;
  sessionReady: boolean;
  outboundMulawBuffer: Buffer;
  pendingPcm8: Buffer[];
  closing: boolean;
  commitTimer?: NodeJS.Timeout;
  responseRequested: boolean;
  responseInProgress: boolean;
  responseComplete: boolean;
  responseWaiters: Array<() => void>;
  totalInputPcm24Sent: number;
  totalOutputMulawSent: number;
  inputAppendCount: number;
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
    @Inject(forwardRef(() => AudioGateway))
    private readonly audioGateway: AudioGateway,
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
    this.logger.log({ streamSid, model, url, message: 'Opening OpenAI Realtime WebSocket' });

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
      sessionReady: false,
      outboundMulawBuffer: Buffer.alloc(0),
      pendingPcm8: [],
      closing: false,
      responseRequested: false,
      responseInProgress: false,
      responseComplete: false,
      responseWaiters: [],
      totalInputPcm24Sent: 0,
      totalOutputMulawSent: 0,
      inputAppendCount: 0,
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
      this.logger.log({ streamSid, model, message: 'OpenAI Realtime WebSocket open' });
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
      this.resolveResponseWaiters(session);
    });

    ws.on('close', (code, reason) => {
      session.status = 'closed';
      this.clearCommitTimer(session);
      this.sessions.delete(streamSid);
      this.updateRuntimeState(streamSid, {
        runtimeStatus: 'closed',
        runtimeLastEventAt: new Date(),
      });
      this.resolveResponseWaiters(session);
      this.logger.log({
        streamSid,
        code,
        reason: reason.toString(),
        inputAppendCount: session.inputAppendCount,
        totalInputPcm24Sent: session.totalInputPcm24Sent,
        totalOutputMulawSent: session.totalOutputMulawSent,
        message: 'OpenAI Realtime session closed',
      });
    });
  }

  handleAudio(streamSid: string, pcm16Audio: Buffer): void {
    const session = this.sessions.get(streamSid);
    if (!session) {
      this.logger.warn({ streamSid, pcmBytes: pcm16Audio.length, message: 'No OpenAI session for streamSid' });
      return;
    }

    if (pcm16Audio.length === 0) {
      return;
    }

    if (!session.sessionReady || session.ws.readyState !== WebSocket.OPEN) {
      session.pendingPcm8.push(pcm16Audio);
      this.logger.debug({
        streamSid,
        pcmBytes: pcm16Audio.length,
        pendingChunks: session.pendingPcm8.length,
        message: 'Queued inbound audio until OpenAI session is ready',
      });
      return;
    }

    this.appendInputAudio(session, pcm16Audio);
  }

  async endSession(streamSid: string): Promise<void> {
    const session = this.sessions.get(streamSid);
    if (!session) {
      return;
    }

    session.closing = true;
    this.clearCommitTimer(session);

    if (session.ws.readyState === WebSocket.OPEN) {
      this.flushPendingInput(session);
      await this.commitInputAndCreateResponse(session);
      await this.waitForResponseComplete(session, RESPONSE_WAIT_MS);
      this.flushRemainingOutbound(session);
    }

    const { ws } = session;

    await new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) {
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

    const payload = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions,
        voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
          create_response: true,
        },
      },
    };

    this.logger.log({ model, voice, message: 'Sending OpenAI session.update' });
    ws.send(JSON.stringify(payload));
  }

  private appendInputAudio(session: OpenAiRealtimeSession, pcm8: Buffer): void {
    const pcm24 = resamplePcm16(
      pcm8,
      SMARTFLO_SAMPLE_RATE,
      OPENAI_SAMPLE_RATE,
    );

    session.ws.send(
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: pcm24.toString('base64'),
      }),
    );

    session.inputAppendCount += 1;
    session.totalInputPcm24Sent += pcm24.length;

    this.logger.debug({
      streamSid: session.streamSid,
      pcm8Bytes: pcm8.length,
      pcm24Bytes: pcm24.length,
      appendCount: session.inputAppendCount,
      message: 'Appended audio to OpenAI input buffer',
    });

    this.updateRuntimeState(session.streamSid, {
      runtimeLastEventAt: new Date(),
    });

    if (!session.closing) {
      this.scheduleInputCommit(session);
    }
  }

  private flushPendingInput(session: OpenAiRealtimeSession): void {
    if (session.pendingPcm8.length === 0) {
      return;
    }

    const pending = session.pendingPcm8.splice(0);
    this.logger.log({
      streamSid: session.streamSid,
      pendingChunks: pending.length,
      message: 'Flushing queued inbound audio to OpenAI',
    });

    for (const pcm8 of pending) {
      this.appendInputAudio(session, pcm8);
    }
  }

  private scheduleInputCommit(session: OpenAiRealtimeSession): void {
    this.clearCommitTimer(session);
    session.commitTimer = setTimeout(() => {
      void this.commitInputAndCreateResponse(session);
    }, INPUT_COMMIT_DELAY_MS);
  }

  private clearCommitTimer(session: OpenAiRealtimeSession): void {
    if (session.commitTimer) {
      clearTimeout(session.commitTimer);
      session.commitTimer = undefined;
    }
  }

  private async commitInputAndCreateResponse(
    session: OpenAiRealtimeSession,
  ): Promise<void> {
    if (
      session.responseRequested ||
      session.responseInProgress ||
      session.ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    if (session.totalInputPcm24Sent === 0) {
      this.logger.warn({
        streamSid: session.streamSid,
        message: 'Skipping commit/response.create — no audio sent to OpenAI',
      });
      return;
    }

    session.responseRequested = true;

    session.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    session.ws.send(JSON.stringify({ type: 'response.create' }));

    this.logger.log({
      streamSid: session.streamSid,
      inputAppendCount: session.inputAppendCount,
      totalInputPcm24Sent: session.totalInputPcm24Sent,
      message: 'Sent input_audio_buffer.commit and response.create',
    });

    this.updateRuntimeState(session.streamSid, {
      runtimeLastEventAt: new Date(),
    });
  }

  private waitForResponseComplete(
    session: OpenAiRealtimeSession,
    timeoutMs: number,
  ): Promise<void> {
    if (session.responseComplete || !session.responseRequested) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.logger.warn({
          streamSid: session.streamSid,
          timeoutMs,
          message: 'Timed out waiting for OpenAI response.done',
        });
        resolve();
      }, timeoutMs);

      session.responseWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private resolveResponseWaiters(session: OpenAiRealtimeSession): void {
    const waiters = session.responseWaiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  }

  private handleServerMessage(
    streamSid: string,
    data: Buffer | ArrayBuffer | Buffer[],
  ): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(
        Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Array.isArray(data)
            ? Buffer.concat(data).toString('utf8')
            : Buffer.from(data).toString('utf8'),
      ) as Record<string, unknown>;
    } catch {
      this.logger.warn({ streamSid, message: 'Invalid JSON from OpenAI Realtime' });
      return;
    }

    const type = event.type;
    if (typeof type !== 'string') {
      return;
    }

    const session = this.sessions.get(streamSid);
    if (!session) {
      return;
    }

    this.updateRuntimeState(streamSid, {
      runtimeLastEventAt: new Date(),
    });

    if (LOGGED_OPENAI_EVENTS.has(type)) {
      this.logger.log({ streamSid, openaiEvent: type, eventId: event.event_id });
    } else {
      this.logger.debug({ streamSid, openaiEvent: type });
    }

    if (type === 'session.updated') {
      session.sessionReady = true;
      this.flushPendingInput(session);
    }

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

    if (type === 'input_audio_buffer.speech_stopped') {
      session.responseRequested = true;
      return;
    }

    if (type === 'response.created') {
      session.responseInProgress = true;
      session.responseComplete = false;
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
      this.handleOutputAudioDelta(session, delta);
      return;
    }

    if (type === 'response.output_audio.done' || type === 'response.audio.done') {
      this.logger.log({
        streamSid,
        totalOutputMulawSent: session.totalOutputMulawSent,
        message: 'OpenAI audio response complete',
      });
      return;
    }

    if (type === 'response.done') {
      session.responseInProgress = false;
      session.responseComplete = true;
      this.flushRemainingOutbound(session);
      this.resolveResponseWaiters(session);
      this.logger.log({
        streamSid,
        totalOutputMulawSent: session.totalOutputMulawSent,
        message: 'OpenAI response.done received',
      });
    }
  }

  private handleOutputAudioDelta(
    session: OpenAiRealtimeSession,
    base64Pcm24: string,
  ): void {
    let pcm24: Buffer;
    try {
      pcm24 = Buffer.from(base64Pcm24, 'base64');
    } catch (error) {
      this.logger.warn(
        { streamSid: session.streamSid, err: error },
        'Invalid OpenAI audio delta',
      );
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

    this.logger.debug({
      streamSid: session.streamSid,
      pcm24Bytes: pcm24.length,
      mulawBytes: mulaw.length,
      bufferedMulawBytes: session.outboundMulawBuffer.length,
      message: 'Received OpenAI audio delta',
    });

    this.flushOutboundMulaw(session);
  }

  private flushOutboundMulaw(session: OpenAiRealtimeSession): void {
    while (session.outboundMulawBuffer.length >= MULAW_FRAME_BYTES) {
      const frame = session.outboundMulawBuffer.subarray(0, MULAW_FRAME_BYTES);
      session.outboundMulawBuffer = session.outboundMulawBuffer.subarray(
        MULAW_FRAME_BYTES,
      );
      const payload = frame.toString('base64');
      session.totalOutputMulawSent += frame.length;
      this.sendOutboundMedia(session.streamSid, payload, frame.length);
    }
  }

  private flushRemainingOutbound(session: OpenAiRealtimeSession): void {
    if (session.outboundMulawBuffer.length === 0) {
      return;
    }

    const remainder = session.outboundMulawBuffer.length;
    const paddingLength = MULAW_FRAME_BYTES - remainder;
    session.outboundMulawBuffer = Buffer.concat([
      session.outboundMulawBuffer,
      Buffer.alloc(paddingLength, MULAW_SILENCE_BYTE),
    ]);
    this.logger.debug({
      streamSid: session.streamSid,
      remainderBytes: remainder,
      paddingBytes: paddingLength,
      message: 'Padding final outbound μ-law frame',
    });
    this.flushOutboundMulaw(session);
  }

  private sendOutboundMedia(
    streamSid: string,
    base64MulawPayload: string,
    mulawBytes: number,
  ): void {
    this.logger.log({
      streamSid,
      mulawBytes,
      base64Length: base64MulawPayload.length,
      message: 'Sending outbound media to Smartflo',
    });

    this.audioGateway.sendMedia(streamSid, base64MulawPayload);
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
