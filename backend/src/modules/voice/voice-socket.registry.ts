import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { TelephonyProvider } from './telephony/telephony-provider.types';

@Injectable()
export class VoiceSocketRegistry {
  private readonly bySocketSessionId = new Map<string, WebSocket>();
  private readonly byStreamSid = new Map<string, WebSocket>();
  private readonly socketToStreamSid = new Map<string, string>();
  private readonly streamProviderBySocketSessionId = new Map<
    string,
    TelephonyProvider
  >();
  private readonly streamProviderByStreamSid = new Map<
    string,
    TelephonyProvider
  >();
  private readonly outboundChunkByStreamSid = new Map<string, number>();
  private readonly outboundSequenceByStreamSid = new Map<string, number>();
  private readonly outboundTimestampByStreamSid = new Map<string, number>();

  registerSocket(socketSessionId: string, client: WebSocket): void {
    this.bySocketSessionId.set(socketSessionId, client);
  }

  setStreamProvider(
    socketSessionId: string,
    provider: TelephonyProvider,
  ): void {
    this.streamProviderBySocketSessionId.set(socketSessionId, provider);
  }

  bindStreamProvider(streamSid: string, provider: TelephonyProvider): void {
    this.streamProviderByStreamSid.set(streamSid, provider);
  }

  getStreamProviderForSocket(
    socketSessionId: string,
  ): TelephonyProvider | undefined {
    return this.streamProviderBySocketSessionId.get(socketSessionId);
  }

  getStreamProviderForStreamSid(
    streamSid: string,
  ): TelephonyProvider | undefined {
    return this.streamProviderByStreamSid.get(streamSid);
  }

  resolveStreamProvider(
    streamSid: string,
    socketSessionId?: string,
  ): TelephonyProvider {
    return (
      this.streamProviderByStreamSid.get(streamSid) ??
      (socketSessionId
        ? this.streamProviderBySocketSessionId.get(socketSessionId)
        : undefined) ??
      TelephonyProvider.SMARTFLO
    );
  }

  bindStreamSid(socketSessionId: string, streamSid: string): void {
    const client = this.bySocketSessionId.get(socketSessionId);
    if (!client) {
      return;
    }

    this.byStreamSid.set(streamSid, client);
    this.socketToStreamSid.set(socketSessionId, streamSid);
    const provider = this.streamProviderBySocketSessionId.get(socketSessionId);
    if (provider) {
      this.streamProviderByStreamSid.set(streamSid, provider);
    }
    if (!this.outboundChunkByStreamSid.has(streamSid)) {
      this.outboundChunkByStreamSid.set(streamSid, 1);
      this.outboundSequenceByStreamSid.set(streamSid, 1);
      this.outboundTimestampByStreamSid.set(streamSid, 0);
    }
  }

  getByStreamSid(streamSid: string): WebSocket | undefined {
    return this.byStreamSid.get(streamSid);
  }

  getStreamSidForSocket(socketSessionId: string): string | undefined {
    return this.socketToStreamSid.get(socketSessionId);
  }

  nextOutboundChunk(streamSid: string): number {
    const chunk = this.outboundChunkByStreamSid.get(streamSid) ?? 1;
    this.outboundChunkByStreamSid.set(streamSid, chunk + 1);
    return chunk;
  }

  nextOutboundSequenceNumber(streamSid: string): number {
    const sequence = this.outboundSequenceByStreamSid.get(streamSid) ?? 1;
    this.outboundSequenceByStreamSid.set(streamSid, sequence + 1);
    return sequence;
  }

  nextOutboundTimestamp(streamSid: string, chunkDurationMs: number): number {
    const timestamp = this.outboundTimestampByStreamSid.get(streamSid) ?? 0;
    this.outboundTimestampByStreamSid.set(
      streamSid,
      timestamp + chunkDurationMs,
    );
    return timestamp;
  }

  removeBySocketSessionId(socketSessionId: string): void {
    const streamSid = this.socketToStreamSid.get(socketSessionId);
    this.bySocketSessionId.delete(socketSessionId);

    if (streamSid) {
      this.byStreamSid.delete(streamSid);
      this.socketToStreamSid.delete(socketSessionId);
      this.streamProviderByStreamSid.delete(streamSid);
      this.outboundChunkByStreamSid.delete(streamSid);
      this.outboundSequenceByStreamSid.delete(streamSid);
      this.outboundTimestampByStreamSid.delete(streamSid);
    }

    this.streamProviderBySocketSessionId.delete(socketSessionId);
  }

  removeByStreamSid(streamSid: string): void {
    this.byStreamSid.delete(streamSid);
    this.streamProviderByStreamSid.delete(streamSid);
    this.outboundChunkByStreamSid.delete(streamSid);
    this.outboundSequenceByStreamSid.delete(streamSid);
    this.outboundTimestampByStreamSid.delete(streamSid);

    for (const [socketSessionId, mappedStreamSid] of this.socketToStreamSid) {
      if (mappedStreamSid === streamSid) {
        this.socketToStreamSid.delete(socketSessionId);
        this.bySocketSessionId.delete(socketSessionId);
        break;
      }
    }
  }
}
