const INFORMAL_LANGUAGE_MAP: Record<string, string | undefined> = {
  hinglish: undefined,
  'hi-en': undefined,
  hindi: 'hi',
  english: 'en',
  tamil: 'ta',
  telugu: 'te',
  kannada: 'kn',
  malayalam: 'ml',
  marathi: 'mr',
  bengali: 'bn',
  gujarati: 'gu',
  punjabi: 'pa',
};

export function normalizeTranscriptionLanguage(
  language?: string | null,
): string | undefined {
  if (!language) {
    return undefined;
  }

  const normalized = language.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (normalized in INFORMAL_LANGUAGE_MAP) {
    return INFORMAL_LANGUAGE_MAP[normalized];
  }

  const isoMatch = normalized.match(/^([a-z]{2})(?:-[a-z]{2})?$/);
  if (isoMatch) {
    return isoMatch[1];
  }

  return undefined;
}

export function formatTranscriptionLanguageHint(language?: string | null): string {
  const normalized = normalizeTranscriptionLanguage(language);

  if (!language?.trim()) {
    return 'auto-detect';
  }

  if (normalized) {
    return normalized;
  }

  return `auto-detect (unsupported value "${language.trim()}" ignored; use ISO-639-1 like en, hi)`;
}
