import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

export type VoiceSessionState = 'pending' | 'active' | 'ended';

export interface VoiceSession {
  socketSessionId: string;
  streamSid?: string;
  remoteAddress?: string;
  connectedAt: Date;
  callSid?: string;
  accountSid?: string;
  from?: string;
  to?: string;
  direction?: string;
  mediaFormat?: unknown;
  customParameters?: unknown;
  state: VoiceSessionState;
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

@Injectable()
export class VoiceSessionService {
  private readonly bySocketSessionId = new Map<string, VoiceSession>();
  private readonly byStreamSid = new Map<string, VoiceSession>();
  private readonly socketToStreamSid = new Map<string, string>();

  createSocketSession(remoteAddress?: string): VoiceSession {
    const socketSessionId = randomUUID();
    const session: VoiceSession = {
      socketSessionId,
      remoteAddress,
      connectedAt: new Date(),
      state: 'pending',
    };
    this.bySocketSessionId.set(socketSessionId, session);
    return session;
  }

  getBySocketSessionId(socketSessionId: string): VoiceSession | undefined {
    return this.bySocketSessionId.get(socketSessionId);
  }

  getByStreamSid(streamSid: string): VoiceSession | undefined {
    return this.byStreamSid.get(streamSid);
  }

  getStreamSidForSocket(socketSessionId: string): string | undefined {
    return this.socketToStreamSid.get(socketSessionId);
  }

  bindStreamSid(
    socketSessionId: string,
    data: VoiceSessionStartData,
  ): VoiceSession | undefined {
    const session = this.bySocketSessionId.get(socketSessionId);
    if (!session) {
      return undefined;
    }

    session.streamSid = data.streamSid;
    session.callSid = data.callSid;
    session.accountSid = data.accountSid;
    session.from = data.from;
    session.to = data.to;
    session.direction = data.direction;
    session.mediaFormat = data.mediaFormat;
    session.customParameters = data.customParameters;
    session.state = 'active';

    this.byStreamSid.set(data.streamSid, session);
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

  endByStreamSid(streamSid: string): void {
    const session = this.byStreamSid.get(streamSid);
    if (!session) {
      return;
    }
    this.cleanup(session);
  }

  endBySocketSessionId(socketSessionId: string): void {
    const session = this.bySocketSessionId.get(socketSessionId);
    if (!session) {
      return;
    }
    this.cleanup(session);
  }

  private cleanup(session: VoiceSession): void {
    session.state = 'ended';
    this.bySocketSessionId.delete(session.socketSessionId);
    if (session.streamSid) {
      this.byStreamSid.delete(session.streamSid);
      this.socketToStreamSid.delete(session.socketSessionId);
    }
  }
}
