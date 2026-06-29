export const OPENAI_REALTIME_SAMPLE_RATE = 24000;

export type OpenAiTurnDetectionMode = 'server_vad' | 'manual';

export interface OpenAiServerVadConfig {
  threshold?: number;
  prefix_padding_ms?: number;
  silence_duration_ms?: number;
}

export function buildRealtimeWsHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
  };
}

export function buildTurnDetection(
  mode: OpenAiTurnDetectionMode,
  serverVad?: OpenAiServerVadConfig,
): Record<string, unknown> | null {
  if (mode === 'manual') {
    return null;
  }

  return {
    type: 'server_vad',
    threshold: serverVad?.threshold ?? 0.5,
    prefix_padding_ms: serverVad?.prefix_padding_ms ?? 300,
    silence_duration_ms: serverVad?.silence_duration_ms ?? 700,
  };
}

export function buildGaSessionUpdate(options: {
  voice: string;
  instructions: string;
  model?: string;
  turnDetection?: OpenAiTurnDetectionMode;
  serverVad?: OpenAiServerVadConfig;
  maxResponseOutputTokens?: number;
  inputTranscription?: {
    model: string;
    language?: string;
    prompt?: string;
  };
}): Record<string, unknown> {
  const turnDetection = buildTurnDetection(
    options.turnDetection ?? 'server_vad',
    options.serverVad,
  );

  const inputAudio: Record<string, unknown> = {
    format: {
      type: 'audio/pcm',
      rate: OPENAI_REALTIME_SAMPLE_RATE,
    },
    turn_detection: turnDetection,
  };

  if (options.inputTranscription) {
    inputAudio.transcription = {
      model: options.inputTranscription.model,
      ...(options.inputTranscription.language
        ? { language: options.inputTranscription.language }
        : {}),
      ...(options.inputTranscription.prompt
        ? { prompt: options.inputTranscription.prompt }
        : {}),
    };
  }

  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      ...(options.model ? { model: options.model } : {}),
      output_modalities: ['audio'],
      instructions: options.instructions,
      ...(options.maxResponseOutputTokens
        ? { max_response_output_tokens: options.maxResponseOutputTokens }
        : {}),
      audio: {
        input: inputAudio,
        output: {
          format: {
            type: 'audio/pcm',
            rate: OPENAI_REALTIME_SAMPLE_RATE,
          },
          voice: options.voice,
        },
      },
    },
  };
}

export function isOpenAiOutputAudioDeltaEvent(type: string): boolean {
  return type === 'response.output_audio.delta' || type === 'response.audio.delta';
}

export type OpenAiOutputAudioFormat = 'pcm' | 'g711_ulaw';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Detect OpenAI Realtime output codec from session.created / session.updated payload. */
export function parseOpenAiOutputAudioFormat(
  sessionPayload: unknown,
): OpenAiOutputAudioFormat {
  const session = asRecord(sessionPayload);
  const audio = asRecord(session?.audio);
  const output = asRecord(audio?.output);
  const format = asRecord(output?.format);
  const type = typeof format?.type === 'string' ? format.type.toLowerCase() : '';

  if (
    type.includes('mulaw') ||
    type.includes('pcmu') ||
    type.includes('g711')
  ) {
    return 'g711_ulaw';
  }

  return 'pcm';
}
