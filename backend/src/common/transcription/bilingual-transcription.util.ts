const BASE_TRANSCRIPTION_PROMPT =
  'Transcribe the call accurately. The speaker may switch between Hindi and English in the same sentence. ' +
  'Preserve both languages as spoken. Do not translate unless explicitly requested. ' +
  'Keep Hindi words in Devanagari or natural romanized Hinglish depending on what is more accurate from the audio. ' +
  'Preserve Indian names, company names, phone numbers, dates, and amounts carefully.';

const BASE_POSTPROCESS_PROMPT =
  'You are cleaning a transcript from an Indian phone call. The call may contain Hindi, English, and Hinglish. ' +
  'Correct obvious transcription errors, punctuation, spacing, and speaker formatting. Preserve the original language. ' +
  'Do not add information that is not present. Do not translate unless necessary for readability. ' +
  'Preserve names, numbers, company names, dates, amounts, and intent exactly.';

export function parseGlossaryTerms(raw?: string | null): string[] {
  if (!raw?.trim()) {
    return [];
  }

  return raw
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean);
}

export function buildGlossarySuffix(terms: string[]): string {
  if (terms.length === 0) {
    return '';
  }

  return ` Important vocabulary: ${terms.join(', ')}.`;
}

export function buildBilingualTranscriptionPrompt(glossaryTerms: string[]): string {
  return `${BASE_TRANSCRIPTION_PROMPT}${buildGlossarySuffix(glossaryTerms)}`;
}

export function buildBilingualPostProcessPrompt(
  rawTranscript: string,
  glossaryTerms: string[],
  preserveHinglish: boolean,
): string {
  const preserveLine = preserveHinglish
    ? 'Keep Hindi and Hinglish as spoken; do not translate Hindi to English.'
    : 'You may lightly normalize mixed-language phrasing for readability without changing meaning.';

  return `${BASE_POSTPROCESS_PROMPT} ${preserveLine}${buildGlossarySuffix(glossaryTerms)}

Transcript to clean:
${rawTranscript}`;
}

export function resolveTranscriptionLanguageHint(
  languageHint?: string | null,
): string | undefined {
  if (!languageHint?.trim()) {
    return undefined;
  }

  const normalized = languageHint.trim().toLowerCase();
  if (
    normalized.includes(',') ||
    normalized === 'hi,en' ||
    normalized === 'en,hi' ||
    normalized === 'hinglish' ||
    normalized === 'mixed'
  ) {
    return undefined;
  }

  const isoMatch = normalized.match(/^([a-z]{2})(?:-[a-z]{2})?$/);
  return isoMatch?.[1];
}

export function detectTranscriptLanguage(text: string): 'hi' | 'en' | 'mixed' | 'unknown' {
  const trimmed = text.trim();
  if (!trimmed) {
    return 'unknown';
  }

  const hasDevanagari = /[\u0900-\u097F]/.test(trimmed);
  const hasLatin = /[A-Za-z]/.test(trimmed);

  if (hasDevanagari && hasLatin) {
    return 'mixed';
  }
  if (hasDevanagari) {
    return 'hi';
  }
  if (hasLatin) {
    return 'en';
  }

  return 'unknown';
}
