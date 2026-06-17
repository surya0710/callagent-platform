import {
  buildAccentInstructions,
  DEFAULT_REALTIME_VOICE,
  parseVoiceAccent,
} from '../src/modules/voice/voice-accent.util';
import {
  buildDefaultRealtimeInstructions,
  DEFAULT_REALTIME_INSTRUCTIONS,
} from '../src/modules/voice/voice-opening.util';

describe('voice-accent.util', () => {
  it('defaults to indian accent profile', () => {
    expect(parseVoiceAccent(undefined)).toBe('indian');
    expect(parseVoiceAccent('indian')).toBe('indian');
  });

  it('allows disabling accent steering', () => {
    expect(parseVoiceAccent('neutral')).toBe('neutral');
    expect(parseVoiceAccent('off')).toBe('neutral');
  });

  it('includes Indian accent guidance in default realtime instructions', () => {
    expect(DEFAULT_REALTIME_INSTRUCTIONS).toContain('Indian English accent');
    expect(buildDefaultRealtimeInstructions('neutral')).not.toContain(
      'Indian English accent',
    );
  });

  it('builds non-empty accent block for indian profile', () => {
    expect(buildAccentInstructions('indian')).toContain('Do not exaggerate');
    expect(buildAccentInstructions('neutral')).toBe('');
  });

  it('defaults realtime voice to marin', () => {
    expect(DEFAULT_REALTIME_VOICE).toBe('marin');
  });
});
