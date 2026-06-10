import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

export interface VoiceSession {
  id: string;
  token: string;
  remoteAddress?: string;
  startedAt: Date;
  callSid?: string;
  streamSid?: string;
}

@Injectable()
export class VoiceSessionService {
  private readonly sessions = new Map<string, VoiceSession>();

  create(token: string, remoteAddress?: string): VoiceSession {
    const session: VoiceSession = {
      id: randomUUID(),
      token,
      remoteAddress,
      startedAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): VoiceSession | undefined {
    return this.sessions.get(id);
  }

  update(
    id: string,
    partial: Partial<Pick<VoiceSession, 'callSid' | 'streamSid'>>,
  ): VoiceSession | undefined {
    const session = this.sessions.get(id);
    if (!session) {
      return undefined;
    }
    Object.assign(session, partial);
    return session;
  }

  end(id: string): void {
    this.sessions.delete(id);
  }
}
