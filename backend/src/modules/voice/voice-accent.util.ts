export type VoiceAccentProfile = 'indian' | 'neutral';

export function parseVoiceAccent(raw?: string | null): VoiceAccentProfile {
  const normalized = raw?.trim().toLowerCase();
  if (
    normalized === 'neutral' ||
    normalized === 'none' ||
    normalized === 'off' ||
    normalized === 'default'
  ) {
    return 'neutral';
  }

  return 'indian';
}

export function buildAccentInstructions(accent: VoiceAccentProfile): string {
  if (accent === 'neutral') {
    return '';
  }

  return [
    'Accent: Use a clear, natural Indian English accent for the full call.',
    'Keep Indian vowel shaping, rhythm, stress, and intonation stable from the first word to the last.',
    'When speaking Hindi, use natural urban Indian Hindi pronunciation and cadence.',
    'Do not drift into American or British pronunciation.',
    'Do not exaggerate the accent.',
    'Accent rules are separate from language rules — do not switch language because of accent.',
  ].join(' ');
}

export const DEFAULT_REALTIME_VOICE = 'marin';
