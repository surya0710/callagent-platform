import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

export type VoiceSessionStatus = 'PENDING' | 'ACTIVE' | 'ENDED';

export interface VoiceSession {
  socketSessionId: string;
  streamSid?: string;
  callSid?: string;
  accountSid?: string;
  from?: string;
  to?: string;
  direction?: string;
  mediaFormat?: unknown;
  customParameters?: unknown;
  status: VoiceSessionStatus;
  connectedAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  lastEvent?: string;
  lastEventAt?: Date;
  packetsReceived: number;
  lastMediaChunk?: string;
  lastMediaTimestamp?: string;
  lastMediaPayloadLength?: number;
  dtmfDigits: string[];
  marksReceived: string[];
  stopReason?: string | null;
  remoteAddress?: string;
  recordingAvailable?: boolean;
  recordingFileName?: string;
  recordingDurationMsEstimate?: number;
  recordingMulawBytes?: number;
  recordingWavBytes?: number;
}

export interface VoiceSessionStartData {
  streamSid: string;
  callSid?: string;
  accountSid?: string;
  from?: string;
  to?: string;
  direction?: string;
  mediaFormat?: unknown;
  customParameters?: unknown;
}

export interface VoiceSessionResponse {
  socketSessionId: string;
  streamSid?: string;
  callSid?: string;
  accountSid?: string;
  from?: string;
  to?: string;
  direction?: string;
  mediaFormat?: unknown;
  customParameters?: unknown;
  status: VoiceSessionStatus;
  connectedAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  lastEvent?: string;
  lastEventAt?: string;
  packetsReceived: number;
  lastMediaChunk?: string;
  lastMediaTimestamp?: string;
  lastMediaPayloadLength?: number;
  dtmfDigits: string[];
  marksReceived: string[];
  stopReason?: string | null;
  remoteAddress?: string;
  recordingAvailable?: boolean;
  recordingFileName?: string;
  recordingDurationMsEstimate?: number;
  recordingMulawBytes?: number;
  recordingWavBytes?: number;
}

const MAX_RECENT_ENDED_SESSIONS = 100;

function toIso(date: Date | undefined): string | null | undefined {
  if (date === undefined) {
    return undefined;
  }
  return date ? date.toISOString() : null;
}

export function toVoiceSessionResponse(
  session: VoiceSession,
): VoiceSessionResponse {
  return {
    socketSessionId: session.socketSessionId,
    streamSid: session.streamSid,
    callSid: session.callSid,
    accountSid: session.accountSid,
    from: session.from,
    to: session.to,
    direction: session.direction,
    mediaFormat: session.mediaFormat,
    customParameters: session.customParameters,
    status: session.status,
    connectedAt: session.connectedAt.toISOString(),
    startedAt: toIso(session.startedAt) ?? null,
    endedAt: toIso(session.endedAt) ?? null,
    lastEvent: session.lastEvent,
    lastEventAt: session.lastEventAt?.toISOString(),
    packetsReceived: session.packetsReceived,
    lastMediaChunk: session.lastMediaChunk,
    lastMediaTimestamp: session.lastMediaTimestamp,
    lastMediaPayloadLength: session.lastMediaPayloadLength,
    dtmfDigits: [...session.dtmfDigits],
    marksReceived: [...session.marksReceived],
    stopReason: session.stopReason ?? null,
    remoteAddress: session.remoteAddress,
    recordingAvailable: session.recordingAvailable ?? false,
    recordingFileName: session.recordingFileName,
    recordingDurationMsEstimate: session.recordingDurationMsEstimate,
    recordingMulawBytes: session.recordingMulawBytes,
    recordingWavBytes: session.recordingWavBytes,
  };
}

@Injectable()
export class VoiceSessionService {
  private readonly activeBySocketSessionId = new Map<string, VoiceSession>();
  private readonly activeByStreamSid = new Map<string, VoiceSession>();
  private readonly socketToStreamSid = new Map<string, string>();
  private readonly recentEndedSessions: VoiceSession[] = [];
  private readonly recentEndedByStreamSid = new Map<string, VoiceSession>();

  createSocketSession(remoteAddress?: string): VoiceSession {
    const socketSessionId = randomUUID();
    const session: VoiceSession = {
      socketSessionId,
      remoteAddress,
      connectedAt: new Date(),
      status: 'PENDING',
      packetsReceived: 0,
      dtmfDigits: [],
      marksReceived: [],
    };
    this.activeBySocketSessionId.set(socketSessionId, session);
    return session;
  }

  getBySocketSessionId(socketSessionId: string): VoiceSession | undefined {
    return (
      this.activeBySocketSessionId.get(socketSessionId) ??
      this.recentEndedSessions.find(
        (session) => session.socketSessionId === socketSessionId,
      )
    );
  }

  getByStreamSid(streamSid: string): VoiceSession | undefined {
    return (
      this.activeByStreamSid.get(streamSid) ??
      this.recentEndedByStreamSid.get(streamSid)
    );
  }

  getStreamSidForSocket(socketSessionId: string): string | undefined {
    return this.socketToStreamSid.get(socketSessionId);
  }

  getActiveSessions(): VoiceSession[] {
    return Array.from(this.activeBySocketSessionId.values());
  }

  getRecentEndedSessions(): VoiceSession[] {
    return [...this.recentEndedSessions];
  }

  getSessionCounts(): { active: number; recentEnded: number } {
    return {
      active: this.activeBySocketSessionId.size,
      recentEnded: this.recentEndedSessions.length,
    };
  }

  recordConnected(socketSessionId: string): void {
    const session = this.activeBySocketSessionId.get(socketSessionId);
    if (!session) {
      return;
    }

    session.lastEvent = 'connected';
    session.lastEventAt = new Date();
  }

  bindStreamSid(
    socketSessionId: string,
    data: VoiceSessionStartData,
  ): VoiceSession | undefined {
    const session = this.activeBySocketSessionId.get(socketSessionId);
    if (!session) {
      return undefined;
    }

    const now = new Date();
    session.streamSid = data.streamSid;
    session.callSid = data.callSid;
    session.accountSid = data.accountSid;
    session.from = data.from;
    session.to = data.to;
    session.direction = data.direction;
    session.mediaFormat = data.mediaFormat;
    session.customParameters = data.customParameters;
    session.status = 'ACTIVE';
    session.startedAt = now;
    session.lastEvent = 'start';
    session.lastEventAt = now;

    this.activeByStreamSid.set(data.streamSid, session);
    this.socketToStreamSid.set(socketSessionId, data.streamSid);
    return session;
  }

  resolveStreamSid(
    payloadStreamSid: unknown,
    socketSessionId: string,
  ): string | undefined {
    if (typeof payloadStreamSid === 'string' && payloadStreamSid.length > 0) {
      return payloadStreamSid;
    }
    return this.socketToStreamSid.get(socketSessionId);
  }

  private resolveActiveSession(
    socketSessionId: string,
    payloadStreamSid: unknown,
  ): VoiceSession | undefined {
    const streamSid = this.resolveStreamSid(payloadStreamSid, socketSessionId);
    if (streamSid) {
      const byStream = this.activeByStreamSid.get(streamSid);
      if (byStream) {
        return byStream;
      }
    }
    return this.activeBySocketSessionId.get(socketSessionId);
  }

  recordMedia(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const session = this.resolveActiveSession(
      socketSessionId,
      payload.streamSid,
    );
    if (!session || session.status === 'ENDED') {
      return;
    }

    const now = new Date();
    session.packetsReceived += 1;
    session.lastEvent = 'media';
    session.lastEventAt = now;

    const media =
      payload.media && typeof payload.media === 'object'
        ? (payload.media as Record<string, unknown>)
        : undefined;

    if (media) {
      if (media.chunk !== undefined && media.chunk !== null) {
        session.lastMediaChunk = String(media.chunk);
      }
      if (media.timestamp !== undefined && media.timestamp !== null) {
        session.lastMediaTimestamp = String(media.timestamp);
      }
      if (typeof media.payload === 'string') {
        session.lastMediaPayloadLength = media.payload.length;
      }
    }
  }

  recordDtmf(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const session = this.resolveActiveSession(
      socketSessionId,
      payload.streamSid,
    );
    if (!session || session.status === 'ENDED') {
      return;
    }

    const dtmf =
      payload.dtmf && typeof payload.dtmf === 'object'
        ? (payload.dtmf as Record<string, unknown>)
        : undefined;
    const digit = dtmf?.digit;

    if (typeof digit === 'string' && digit.length > 0) {
      session.dtmfDigits.push(digit);
    }

    session.lastEvent = 'dtmf';
    session.lastEventAt = new Date();
  }

  recordMark(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const session = this.resolveActiveSession(
      socketSessionId,
      payload.streamSid,
    );
    if (!session || session.status === 'ENDED') {
      return;
    }

    const mark =
      payload.mark && typeof payload.mark === 'object'
        ? (payload.mark as Record<string, unknown>)
        : undefined;
    const name = mark?.name;

    if (typeof name === 'string' && name.length > 0) {
      session.marksReceived.push(name);
    }

    session.lastEvent = 'mark';
    session.lastEventAt = new Date();
  }

  recordClear(
    socketSessionId: string,
    payload: Record<string, unknown>,
  ): void {
    const session = this.resolveActiveSession(
      socketSessionId,
      payload.streamSid,
    );
    if (!session || session.status === 'ENDED') {
      return;
    }

    session.lastEvent = 'clear';
    session.lastEventAt = new Date();
  }

  attachRecordingMetadata(
    streamSid: string,
    metadata: {
      fileName: string;
      durationMsEstimate: number;
      mulawBytes: number;
      wavBytes: number;
    },
  ): void {
    const session = this.getByStreamSid(streamSid);
    if (!session) {
      return;
    }

    session.recordingAvailable = true;
    session.recordingFileName = metadata.fileName;
    session.recordingDurationMsEstimate = metadata.durationMsEstimate;
    session.recordingMulawBytes = metadata.mulawBytes;
    session.recordingWavBytes = metadata.wavBytes;
  }

  endByStreamSid(streamSid: string, stopReason?: string | null): void {
    const session = this.activeByStreamSid.get(streamSid);
    if (!session || session.status === 'ENDED') {
      return;
    }

    this.endSession(session, stopReason ?? null, 'stop');
  }

  endBySocketSessionId(socketSessionId: string): void {
    const session = this.activeBySocketSessionId.get(socketSessionId);
    if (!session || session.status === 'ENDED') {
      return;
    }

    this.endSession(session, 'websocket_disconnected', 'disconnect');
  }

  private endSession(
    session: VoiceSession,
    stopReason: string | null,
    lastEvent: string,
  ): void {
    session.status = 'ENDED';
    session.endedAt = new Date();
    session.stopReason = stopReason;
    session.lastEvent = lastEvent;
    session.lastEventAt = new Date();

    this.activeBySocketSessionId.delete(session.socketSessionId);
    if (session.streamSid) {
      this.activeByStreamSid.delete(session.streamSid);
      this.socketToStreamSid.delete(session.socketSessionId);
    }

    this.recentEndedSessions.push(session);
    if (session.streamSid) {
      this.recentEndedByStreamSid.set(session.streamSid, session);
    }

    while (this.recentEndedSessions.length > MAX_RECENT_ENDED_SESSIONS) {
      const oldest = this.recentEndedSessions.shift();
      if (oldest?.streamSid) {
        this.recentEndedByStreamSid.delete(oldest.streamSid);
      }
    }
  }
}
