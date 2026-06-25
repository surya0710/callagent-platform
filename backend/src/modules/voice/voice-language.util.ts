export type CustomerLanguage = 'english' | 'hindi' | 'hinglish' | 'unknown';

export const LANGUAGE_CONFIDENCE_THRESHOLD = 0.6;
export const LANGUAGE_SWITCH_CONFIDENCE_THRESHOLD = 0.75;
export const LANGUAGE_SWITCH_MIN_WORDS = 3;

const HINDI_LATIN_WORDS =
  /^(haan|han|ha|nahi|nahin|nhi|achha|accha|theek|thik|kya|kyun|kaise|mujhe|mera|meri|aap|apko|apka|hai|hain|hoon|hu|kar|karo|chahiye|batao|bolo|baat|abhi|kal|paisa|paise|kitna|kahan|kab|ji|jihaan|tha|thi|the|bahut|bohot|mat|na|gadi|sab|kuch|yeh|ye|woh|vo)$/i;

const AMBIGUOUS_SHORT_PHRASES = new Set([
  'yes',
  'no',
  'ok',
  'okay',
  'hello',
  'hi',
  'hey',
  'haan',
  'han',
  'ha',
  'ji',
  'hmm',
  'hm',
  'um',
  'uh',
  'yeah',
  'yep',
  'nope',
  'sure',
  'thanks',
  'thank',
  'you',
]);

export interface LanguageDetectionEvidence {
  devanagariWords: number;
  hindiLatinWords: number;
  englishWords: number;
  totalWords: number;
  isAmbiguousShort: boolean;
}

export interface LanguageDetectionResult {
  language: CustomerLanguage;
  confidence: number;
  evidence: LanguageDetectionEvidence;
}

export interface PreferredLanguageUpdateResult {
  shouldUpdate: boolean;
  newLanguage: CustomerLanguage;
  skipReason?: string;
}

function tokenizeTranscript(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function countDevanagariWords(text: string, words: string[]): number {
  const fromWords = words.filter((word) => /[\u0900-\u097f]/.test(word)).length;
  if (fromWords > 0) {
    return fromWords;
  }
  const segments = text.match(/[\u0900-\u097f]+/g) ?? [];
  return segments.length;
}

function isHindiLatinWord(word: string): boolean {
  return HINDI_LATIN_WORDS.test(word.toLowerCase());
}

export function isAmbiguousShortUtterance(text: string): boolean {
  const words = tokenizeTranscript(text);
  if (words.length === 0) {
    return true;
  }
  if (words.length <= 2 && words.every((word) => AMBIGUOUS_SHORT_PHRASES.has(word))) {
    return true;
  }
  return false;
}

export function detectCustomerLanguage(text: string): LanguageDetectionResult {
  const trimmed = text.trim();
  const words = tokenizeTranscript(trimmed);
  const isAmbiguousShort = isAmbiguousShortUtterance(trimmed);
  const devanagariWords = countDevanagariWords(trimmed, words);
  const hasDevanagari = devanagariWords > 0;

  const latinWords = words.filter((word) => /[a-z]/i.test(word));
  const hindiLatinWords = latinWords.filter((word) => isHindiLatinWord(word)).length;
  const englishWords = latinWords.filter((word) => !isHindiLatinWord(word)).length;

  const evidence: LanguageDetectionEvidence = {
    devanagariWords,
    hindiLatinWords,
    englishWords,
    totalWords: words.length,
    isAmbiguousShort,
  };

  if (isAmbiguousShort) {
    return { language: 'unknown', confidence: 0, evidence };
  }

  let language: CustomerLanguage = 'unknown';
  let confidence = 0;

  if (hasDevanagari && englishWords > 0) {
    language = 'hinglish';
    confidence = Math.min(1, (devanagariWords + englishWords) / Math.max(words.length, 1));
  } else if (hasDevanagari) {
    language = 'hindi';
    confidence = Math.min(1, devanagariWords / Math.max(words.length, 1));
  } else if (hindiLatinWords > 0 && englishWords > 0) {
    if (hindiLatinWords >= 1 && englishWords >= 2 && words.length >= 4) {
      language = 'hinglish';
      confidence = Math.min(
        1,
        (hindiLatinWords + englishWords) / Math.max(words.length, 1),
      );
    } else {
      language = 'english';
      confidence = Math.min(1, englishWords / Math.max(words.length, 1));
    }
  } else if (hindiLatinWords > 0) {
    language = 'hindi';
    confidence = Math.min(1, hindiLatinWords / Math.max(words.length, 1));
  } else if (englishWords > 0) {
    language = 'english';
    confidence =
      englishWords >= LANGUAGE_SWITCH_MIN_WORDS
        ? 0.9
        : englishWords / Math.max(words.length, 1);
  }

  if (hasDevanagari && englishWords === 0 && words.length >= LANGUAGE_SWITCH_MIN_WORDS) {
    confidence = Math.max(confidence, LANGUAGE_SWITCH_CONFIDENCE_THRESHOLD);
  }

  if (words.length >= LANGUAGE_SWITCH_MIN_WORDS && language !== 'unknown') {
    confidence = Math.max(confidence, LANGUAGE_CONFIDENCE_THRESHOLD);
  }

  return { language, confidence, evidence };
}

export function evaluatePreferredLanguageUpdate(
  currentPreferred: CustomerLanguage,
  detection: LanguageDetectionResult,
): PreferredLanguageUpdateResult {
  if (detection.evidence.isAmbiguousShort) {
    return {
      shouldUpdate: false,
      newLanguage: currentPreferred,
      skipReason: 'ambiguous_short_utterance',
    };
  }

  if (detection.language === 'unknown') {
    return {
      shouldUpdate: false,
      newLanguage: currentPreferred,
      skipReason: 'unknown_language',
    };
  }

  if (detection.confidence < LANGUAGE_CONFIDENCE_THRESHOLD) {
    return {
      shouldUpdate: false,
      newLanguage: currentPreferred,
      skipReason: 'confidence_below_threshold',
    };
  }

  if (currentPreferred === 'unknown') {
    return { shouldUpdate: true, newLanguage: detection.language };
  }

  if (currentPreferred === detection.language) {
    return {
      shouldUpdate: false,
      newLanguage: currentPreferred,
      skipReason: 'already_set',
    };
  }

  if (
    detection.confidence >= LANGUAGE_SWITCH_CONFIDENCE_THRESHOLD &&
    detection.evidence.totalWords >= LANGUAGE_SWITCH_MIN_WORDS
  ) {
    return { shouldUpdate: true, newLanguage: detection.language };
  }

  return {
    shouldUpdate: false,
    newLanguage: currentPreferred,
    skipReason: 'insufficient_evidence_for_switch',
  };
}

export function resolveResponseLanguage(
  preferredLanguage?: CustomerLanguage,
  lastCustomerLanguage?: CustomerLanguage,
): CustomerLanguage {
  if (preferredLanguage && preferredLanguage !== 'unknown') {
    return preferredLanguage;
  }
  if (lastCustomerLanguage && lastCustomerLanguage !== 'unknown') {
    return lastCustomerLanguage;
  }
  return 'unknown';
}

export function buildLanguageInstruction(preferredLanguage: CustomerLanguage): string {
  return (
    `Reply in ${preferredLanguage}. Do not switch language based on accent. ` +
    'Switch only if the customer clearly changes language for a complete sentence.'
  );
}
