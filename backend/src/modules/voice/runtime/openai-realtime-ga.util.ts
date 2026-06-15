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
}): Record<string, unknown> {
  const turnDetection = buildTurnDetection(
    options.turnDetection ?? 'server_vad',
    options.serverVad,
  );

  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      ...(options.model ? { model: options.model } : {}),
      output_modalities: ['audio'],
      instructions: options.instructions,
      audio: {
        input: {
          format: {
            type: 'audio/pcm',
            rate: OPENAI_REALTIME_SAMPLE_RATE,
          },
          turn_detection: turnDetection,
        },
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
