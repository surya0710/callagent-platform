export const OPENAI_REALTIME_SAMPLE_RATE = 24000;

export function buildRealtimeWsHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
  };
}

export function buildGaSessionUpdate(options: {
  voice: string;
  instructions: string;
  model?: string;
}): Record<string, unknown> {
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
          turn_detection: null,
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
