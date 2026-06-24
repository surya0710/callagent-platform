import { Injectable, Logger } from '@nestjs/common';

/** Milestone names for outbound greeting latency diagnostics. */
export const CallTimingEvent = {
  TEST_CALL_API_RECEIVED: 'test_call_api_received',
  SMARTFLO_REQUEST_SENT: 'smartflo_click_to_call_request_sent',
  SMARTFLO_RESPONSE_RECEIVED: 'smartflo_click_to_call_response_received',
  OPENAI_PREWARM_STARTED: 'openai_prewarm_started',
  OPENAI_WEBSOCKET_CONNECTED: 'openai_websocket_connected',
  OPENAI_SESSION_CREATED: 'openai_session_created',
  OPENAI_SESSION_UPDATED: 'openai_session_updated',
  SMARTFLO_MEDIA_WS_CONNECTED: 'smartflo_media_websocket_connected',
  SMARTFLO_START_RECEIVED: 'smartflo_start_received',
  CALL_AUTHORIZATION_LOADED: 'call_authorization_loaded',
  OPENAI_SESSION_CREATE_CALLED: 'openai_session_create_called',
  CALL_CONTEXT_LOADED: 'call_context_loaded',
  PREWARM_ADOPTED: 'prewarmed_openai_session_adopted',
  OPENING_READINESS_EVALUATED: 'opening_readiness_evaluated',
  OPENING_RESPONSE_CREATE_SENT: 'opening_response_create_sent',
  FIRST_OPENAI_AUDIO_DELTA: 'first_openai_response_audio_delta',
  FIRST_SMARTFLO_OUTBOUND_CHUNK: 'first_outbound_smartflo_media_chunk',
} as const;

export type CallTimingEventName =
  (typeof CallTimingEvent)[keyof typeof CallTimingEvent];

const KEY_DURATION_PAIRS: Array<{
  label: string;
  from: CallTimingEventName;
  to: CallTimingEventName;
}> = [
  {
    label: 'api_request_to_prewarm_started',
    from: CallTimingEvent.TEST_CALL_API_RECEIVED,
    to: CallTimingEvent.OPENAI_PREWARM_STARTED,
  },
  {
    label: 'prewarm_started_to_session_created',
    from: CallTimingEvent.OPENAI_PREWARM_STARTED,
    to: CallTimingEvent.OPENAI_SESSION_CREATED,
  },
  {
    label: 'smartflo_start_to_authorization_loaded',
    from: CallTimingEvent.SMARTFLO_START_RECEIVED,
    to: CallTimingEvent.CALL_AUTHORIZATION_LOADED,
  },
  {
    label: 'authorization_loaded_to_openai_session_create_called',
    from: CallTimingEvent.CALL_AUTHORIZATION_LOADED,
    to: CallTimingEvent.OPENAI_SESSION_CREATE_CALLED,
  },
  {
    label: 'openai_session_create_called_to_session_created',
    from: CallTimingEvent.OPENAI_SESSION_CREATE_CALLED,
    to: CallTimingEvent.OPENAI_SESSION_CREATED,
  },
  {
    label: 'session_created_to_opening_response_create',
    from: CallTimingEvent.OPENAI_SESSION_CREATED,
    to: CallTimingEvent.OPENING_RESPONSE_CREATE_SENT,
  },
  {
    label: 'smartflo_start_to_prewarm_adopted',
    from: CallTimingEvent.SMARTFLO_START_RECEIVED,
    to: CallTimingEvent.PREWARM_ADOPTED,
  },
  {
    label: 'smartflo_start_to_opening_response_create',
    from: CallTimingEvent.SMARTFLO_START_RECEIVED,
    to: CallTimingEvent.OPENING_RESPONSE_CREATE_SENT,
  },
  {
    label: 'opening_response_create_to_first_audio_delta',
    from: CallTimingEvent.OPENING_RESPONSE_CREATE_SENT,
    to: CallTimingEvent.FIRST_OPENAI_AUDIO_DELTA,
  },
  {
    label: 'first_audio_delta_to_first_smartflo_outbound_chunk',
    from: CallTimingEvent.FIRST_OPENAI_AUDIO_DELTA,
    to: CallTimingEvent.FIRST_SMARTFLO_OUTBOUND_CHUNK,
  },
];

interface CallTimingTrace {
  traceId: string;
  originAt: number;
  events: Map<CallTimingEventName, number>;
  meta: Record<string, unknown>;
}

@Injectable()
export class CallTimingDiagnosticsService {
  private readonly logger = new Logger(CallTimingDiagnosticsService.name);
  private readonly traces = new Map<string, CallTimingTrace>();
  /** alias (callSid:…, streamSid:…, phone:…) → traceId */
  private readonly aliases = new Map<string, string>();

  beginTrace(
    primaryAlias: string,
    meta?: Record<string, unknown>,
  ): string {
    const traceId = primaryAlias;
    if (!this.traces.has(traceId)) {
      this.traces.set(traceId, {
        traceId,
        originAt: Date.now(),
        events: new Map(),
        meta: meta ?? {},
      });
    } else if (meta) {
      Object.assign(this.traces.get(traceId)!.meta, meta);
    }
    this.linkAlias(primaryAlias, traceId);
    return traceId;
  }

  linkAlias(alias: string, traceId: string): void {
    this.aliases.set(alias, traceId);
  }

  linkCallSid(callSid: string | undefined, traceId: string): void {
    const trimmed = callSid?.trim();
    if (trimmed) {
      this.linkAlias(`callSid:${trimmed}`, traceId);
    }
  }

  linkStreamSid(streamSid: string | undefined, traceId: string): void {
    const trimmed = streamSid?.trim();
    if (trimmed) {
      this.linkAlias(`streamSid:${trimmed}`, traceId);
    }
  }

  linkPhone(phone: string | undefined, traceId: string): void {
    const trimmed = phone?.trim();
    if (trimmed) {
      this.linkAlias(`phone:${trimmed}`, traceId);
    }
  }

  resolveTraceId(key: string): string | undefined {
    if (this.traces.has(key)) {
      return key;
    }
    return this.aliases.get(key);
  }

  mark(
    key: string,
    event: CallTimingEventName,
    meta?: Record<string, unknown>,
    options?: { once?: boolean },
  ): void {
    const traceId = this.resolveTraceId(key);
    if (!traceId) {
      this.logger.debug({
        event,
        key,
        message: 'call_timing_no_trace',
        ...meta,
      });
      return;
    }

    const trace = this.traces.get(traceId);
    if (!trace) {
      return;
    }

    if (options?.once && trace.events.has(event)) {
      return;
    }

    const now = Date.now();
    const elapsedMs = now - trace.originAt;
    const previousEntry = [...trace.events.entries()].pop();
    const sincePreviousMs = previousEntry ? now - previousEntry[1] : undefined;

    trace.events.set(event, now);

    this.logger.log({
      traceId,
      event,
      elapsedMs,
      sincePreviousMs,
      message: `call_timing_${event}`,
      ...trace.meta,
      ...meta,
    });

    this.logCompletedDurations(traceId, event);
  }

  markByCallSid(
    callSid: string | undefined,
    event: CallTimingEventName,
    meta?: Record<string, unknown>,
    options?: { once?: boolean },
  ): void {
    const trimmed = callSid?.trim();
    if (!trimmed) {
      return;
    }
    this.mark(`callSid:${trimmed}`, event, meta, options);
  }

  markByStreamSid(
    streamSid: string | undefined,
    event: CallTimingEventName,
    meta?: Record<string, unknown>,
    options?: { once?: boolean },
  ): void {
    const trimmed = streamSid?.trim();
    if (!trimmed) {
      return;
    }
    this.mark(`streamSid:${trimmed}`, event, meta, options);
  }

  markByPhone(
    phone: string | undefined,
    event: CallTimingEventName,
    meta?: Record<string, unknown>,
    options?: { once?: boolean },
  ): void {
    const trimmed = phone?.trim();
    if (!trimmed) {
      return;
    }
    this.mark(`phone:${trimmed}`, event, meta, options);
  }

  private logCompletedDurations(
    traceId: string,
    latestEvent: CallTimingEventName,
  ): void {
    const trace = this.traces.get(traceId);
    if (!trace) {
      return;
    }

    for (const pair of KEY_DURATION_PAIRS) {
      if (pair.to !== latestEvent) {
        continue;
      }
      const fromAt = trace.events.get(pair.from);
      const toAt = trace.events.get(pair.to);
      if (fromAt === undefined || toAt === undefined) {
        continue;
      }
      this.logger.log({
        traceId,
        durationMs: toAt - fromAt,
        from: pair.from,
        to: pair.to,
        message: `call_timing_duration_${pair.label}`,
        ...trace.meta,
      });
    }
  }
}
