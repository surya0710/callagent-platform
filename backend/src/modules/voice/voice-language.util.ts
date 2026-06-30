export type CustomerLanguage = 'english' | 'hindi' | 'hinglish' | 'unknown';

/** Conservative per-call language lock (not global). */
export type LanguageLockState = 'unknown' | 'english_hinglish' | 'hindi';

export type UtteranceLanguageClass =
  | 'english'
  | 'hinglish'
  | 'hindi'
  | 'filler_only'
  | 'unknown';

export const LANGUAGE_CONFIDENCE_THRESHOLD = 0.6;
export const LANGUAGE_SWITCH_CONFIDENCE_THRESHOLD = 0.75;
export const LANGUAGE_SWITCH_MIN_WORDS = 3;
export const HINDI_LOCK_CONSECUTIVE_TURNS = 2;
export const ENGLISH_HINGLISH_UNLOCK_CONSECUTIVE_TURNS = 2;

const HINDI_LATIN_WORDS =
  /^(haan|han|ha|nahi|nahin|nhi|achha|accha|theek|thik|kya|kyun|kaise|mujhe|mera|meri|mere|aap|apko|apka|hai|hain|hoon|hu|kar|karo|chahiye|batao|bolo|baat|abhi|kal|paisa|paise|kitna|kahan|kab|ji|jihaan|tha|thi|bahut|bohut|mat|na|gadi|sab|kuch|yeh|ye|woh|vo|par|aaya|aaye|aayi|hui)$/i;

const HINDI_FILLER_WORDS = new Set([
  'haan',
  'han',
  'ha',
  'ji',
  'nahi',
  'nahin',
  'nhi',
  'theek',
  'thik',
  'achha',
  'accha',
  'matlab',
  'bas',
  'sir',
  'madam',
  'ok',
  'okay',
  'yes',
  'no',
  'hmm',
  'hm',
  'yeah',
  'yep',
  'nope',
  'sure',
  'thanks',
  'thank',
  'you',
  'hello',
  'hi',
  'hey',
  'um',
  'uh',
]);

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
  nonFillerWords: number;
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

export interface LanguageLockSessionState {
  lockedLanguage: LanguageLockState;
  consecutivePrimaryHindiTurns: number;
  consecutivePrimaryEnglishHinglishTurns: number;
}

export interface UtteranceLanguageAssessment {
  utteranceClass: UtteranceLanguageClass;
  hindiWordRatio: number;
  isMeaningfulUtterance: boolean;
  devanagariPresent: boolean;
  sample: string;
  detection: LanguageDetectionResult;
}

export interface LanguageLockUpdateResult {
  state: LanguageLockSessionState;
  changed: boolean;
  previousLock: LanguageLockState;
  lockedLanguage: LanguageLockState;
  reason: string;
  detectedLanguage: UtteranceLanguageClass;
  hindiWordRatio: number;
  utteranceSample: string;
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

function isFillerWord(word: string): boolean {
  const lower = word.toLowerCase();
  return HINDI_FILLER_WORDS.has(lower) || AMBIGUOUS_SHORT_PHRASES.has(lower);
}

function nonFillerWords(words: string[]): string[] {
  return words.filter((word) => !isFillerWord(word));
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

export function createInitialLanguageLockState(): LanguageLockSessionState {
  return {
    lockedLanguage: 'english_hinglish',
    consecutivePrimaryHindiTurns: 0,
    consecutivePrimaryEnglishHinglishTurns: 0,
  };
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
  const meaningfulWords = nonFillerWords(words);

  const evidence: LanguageDetectionEvidence = {
    devanagariWords,
    hindiLatinWords,
    englishWords,
    totalWords: words.length,
    nonFillerWords: meaningfulWords.length,
    isAmbiguousShort,
  };

  if (isAmbiguousShort || meaningfulWords.length === 0) {
    return { language: 'unknown', confidence: 0, evidence };
  }

  let language: CustomerLanguage = 'unknown';
  let confidence = 0;

  const meaningfulHindiLatin = meaningfulWords.filter((word) =>
    isHindiLatinWord(word),
  ).length;
  const meaningfulEnglish = meaningfulWords.filter(
    (word) => /[a-z]/i.test(word) && !isHindiLatinWord(word),
  ).length;
  const meaningfulDevanagari = meaningfulWords.filter((word) =>
    /[\u0900-\u097f]/.test(word),
  ).length;

  if (hasDevanagari && meaningfulEnglish > 0) {
    language = 'hinglish';
    confidence = Math.min(
      1,
      (meaningfulDevanagari + meaningfulEnglish) / Math.max(meaningfulWords.length, 1),
    );
  } else if (hasDevanagari) {
    language = 'hindi';
    confidence = Math.min(
      1,
      meaningfulDevanagari / Math.max(meaningfulWords.length, 1),
    );
  } else if (meaningfulHindiLatin > 0 && meaningfulEnglish > 0) {
    const hindiRatio =
      meaningfulHindiLatin / Math.max(meaningfulWords.length, 1);
    if (hindiRatio >= 0.55 && meaningfulWords.length >= 4) {
      language = 'hinglish';
      confidence = hindiRatio;
    } else if (meaningfulHindiLatin <= 2 && meaningfulEnglish >= 2) {
      language = 'english';
      confidence = Math.min(
        1,
        meaningfulEnglish / Math.max(meaningfulWords.length, 1),
      );
    } else {
      language = 'hinglish';
      confidence = Math.min(1, (meaningfulHindiLatin + meaningfulEnglish) / meaningfulWords.length);
    }
  } else if (meaningfulHindiLatin > 0) {
    if (meaningfulHindiLatin >= 3 && meaningfulWords.length >= 4) {
      language = 'hindi';
      confidence = Math.min(
        1,
        meaningfulHindiLatin / Math.max(meaningfulWords.length, 1),
      );
    } else {
      language = 'unknown';
      confidence = 0;
    }
  } else if (meaningfulEnglish > 0) {
    language = 'english';
    confidence =
      meaningfulEnglish >= LANGUAGE_SWITCH_MIN_WORDS
        ? 0.9
        : meaningfulEnglish / Math.max(meaningfulWords.length, 1);
  }

  if (
    hasDevanagari &&
    meaningfulEnglish === 0 &&
    meaningfulWords.length >= LANGUAGE_SWITCH_MIN_WORDS
  ) {
    confidence = Math.max(confidence, LANGUAGE_SWITCH_CONFIDENCE_THRESHOLD);
  }

  if (meaningfulWords.length >= LANGUAGE_SWITCH_MIN_WORDS && language !== 'unknown') {
    confidence = Math.max(confidence, LANGUAGE_CONFIDENCE_THRESHOLD);
  }

  return { language, confidence, evidence };
}

export function assessCustomerUtteranceLanguage(
  text: string,
): UtteranceLanguageAssessment {
  const trimmed = text.trim();
  const sample = trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
  const detection = detectCustomerLanguage(trimmed);
  const words = tokenizeTranscript(trimmed);
  const meaningful = nonFillerWords(words);
  const devanagariPresent = detection.evidence.devanagariWords > 0;

  if (detection.evidence.isAmbiguousShort || meaningful.length === 0) {
    return {
      utteranceClass: 'filler_only',
      hindiWordRatio: 0,
      isMeaningfulUtterance: false,
      devanagariPresent,
      sample,
      detection,
    };
  }

  const hindiTokens = meaningful.filter(
    (word) => isHindiLatinWord(word) || /[\u0900-\u097f]/.test(word),
  ).length;
  const hindiWordRatio = hindiTokens / Math.max(meaningful.length, 1);

  let utteranceClass: UtteranceLanguageClass = 'unknown';

  if (devanagariPresent && hindiWordRatio >= 0.6 && meaningful.length >= 3) {
    utteranceClass = 'hindi';
  } else if (hindiWordRatio >= 0.55 && meaningful.length >= 5) {
    const hindiTokenCount = meaningful.filter(
      (word) => isHindiLatinWord(word) || /[\u0900-\u097f]/.test(word),
    ).length;
    const englishLikeWords = meaningful.filter(
      (word) =>
        /[a-z]/i.test(word) &&
        !isHindiLatinWord(word) &&
        !/[\u0900-\u097f]/.test(word),
    ).length;
    if (hindiTokenCount >= 6) {
      utteranceClass = 'hindi';
    } else if (englishLikeWords >= 2) {
      utteranceClass = 'hinglish';
    } else {
      utteranceClass = 'hindi';
    }
  } else if (hindiWordRatio >= 0.2 && detection.evidence.englishWords > 0) {
    utteranceClass = 'hinglish';
  } else if (detection.language === 'english' || hindiWordRatio < 0.2) {
    utteranceClass = 'english';
  } else if (detection.language === 'hinglish') {
    utteranceClass = 'hinglish';
  } else if (detection.language === 'hindi') {
    utteranceClass = 'hindi';
  }

  return {
    utteranceClass,
    hindiWordRatio,
    isMeaningfulUtterance: true,
    devanagariPresent,
    sample,
    detection,
  };
}

export function updateLanguageLock(
  state: LanguageLockSessionState,
  assessment: UtteranceLanguageAssessment,
): LanguageLockUpdateResult {
  const previousLock = state.lockedLanguage;

  if (!assessment.isMeaningfulUtterance || assessment.utteranceClass === 'filler_only') {
    return {
      state,
      changed: false,
      previousLock,
      lockedLanguage: state.lockedLanguage,
      reason: 'filler_or_ambiguous_utterance',
      detectedLanguage: assessment.utteranceClass,
      hindiWordRatio: assessment.hindiWordRatio,
      utteranceSample: assessment.sample,
    };
  }

  if (assessment.utteranceClass === 'hindi') {
    state.consecutivePrimaryHindiTurns += 1;
    state.consecutivePrimaryEnglishHinglishTurns = 0;

    const strongSingleUtterance =
      (assessment.devanagariPresent &&
        assessment.hindiWordRatio >= 0.65 &&
        assessment.detection.evidence.nonFillerWords >= 4) ||
      (!assessment.devanagariPresent &&
        assessment.hindiWordRatio >= 0.55 &&
        assessment.detection.evidence.nonFillerWords >= 6);

    const shouldLockHindi =
      state.lockedLanguage !== 'hindi' &&
      (strongSingleUtterance ||
        state.consecutivePrimaryHindiTurns >= HINDI_LOCK_CONSECUTIVE_TURNS);

    if (shouldLockHindi) {
      state.lockedLanguage = 'hindi';
      return {
        state,
        changed: true,
        previousLock,
        lockedLanguage: state.lockedLanguage,
        reason: strongSingleUtterance
          ? 'strong_hindi_utterance'
          : 'consecutive_hindi_turns',
        detectedLanguage: assessment.utteranceClass,
        hindiWordRatio: assessment.hindiWordRatio,
        utteranceSample: assessment.sample,
      };
    }

    return {
      state,
      changed: false,
      previousLock,
      lockedLanguage: state.lockedLanguage,
      reason: 'hindi_turn_accumulating',
      detectedLanguage: assessment.utteranceClass,
      hindiWordRatio: assessment.hindiWordRatio,
      utteranceSample: assessment.sample,
    };
  }

  if (
    assessment.utteranceClass === 'english' ||
    assessment.utteranceClass === 'hinglish'
  ) {
    state.consecutivePrimaryEnglishHinglishTurns += 1;
    state.consecutivePrimaryHindiTurns = 0;

    if (state.lockedLanguage === 'unknown') {
      state.lockedLanguage = 'english_hinglish';
      return {
        state,
        changed: true,
        previousLock,
        lockedLanguage: state.lockedLanguage,
        reason: 'initial_english_hinglish_lock',
        detectedLanguage: assessment.utteranceClass,
        hindiWordRatio: assessment.hindiWordRatio,
        utteranceSample: assessment.sample,
      };
    }

    if (
      state.lockedLanguage === 'hindi' &&
      state.consecutivePrimaryEnglishHinglishTurns >=
        ENGLISH_HINGLISH_UNLOCK_CONSECUTIVE_TURNS
    ) {
      state.lockedLanguage = 'english_hinglish';
      return {
        state,
        changed: true,
        previousLock,
        lockedLanguage: state.lockedLanguage,
        reason: 'consecutive_english_hinglish_turns',
        detectedLanguage: assessment.utteranceClass,
        hindiWordRatio: assessment.hindiWordRatio,
        utteranceSample: assessment.sample,
      };
    }

    return {
      state,
      changed: false,
      previousLock,
      lockedLanguage: state.lockedLanguage,
      reason: 'maintain_locked_language',
      detectedLanguage: assessment.utteranceClass,
      hindiWordRatio: assessment.hindiWordRatio,
      utteranceSample: assessment.sample,
    };
  }

  return {
    state,
    changed: false,
    previousLock,
    lockedLanguage: state.lockedLanguage,
    reason: 'unknown_utterance_class',
    detectedLanguage: assessment.utteranceClass,
    hindiWordRatio: assessment.hindiWordRatio,
    utteranceSample: assessment.sample,
  };
}

export function lockStateToCustomerLanguage(
  lock: LanguageLockState,
): CustomerLanguage {
  switch (lock) {
    case 'hindi':
      return 'hindi';
    case 'english_hinglish':
      return 'hinglish';
    default:
      return 'hinglish';
  }
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
    detection.evidence.nonFillerWords >= LANGUAGE_SWITCH_MIN_WORDS &&
    detection.language === 'hindi'
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
  return 'hinglish';
}

export function resolveResponseLanguageFromLock(
  lock: LanguageLockState,
): CustomerLanguage {
  return lockStateToCustomerLanguage(lock);
}

export function buildLanguageInstruction(preferredLanguage: CustomerLanguage): string {
  if (preferredLanguage === 'hindi') {
    return (
      'Reply in Hindi. Do not switch language because of accent or isolated Hindi filler words. ' +
      'Continue in Hindi unless the customer clearly and consistently switches to English across multiple turns.'
    );
  }

  if (preferredLanguage === 'hinglish') {
    return (
      'Reply in English or Hinglish (Roman script). Do not switch to Hindi because of accent or isolated Hindi words such as haan, ji, nahi, theek, achha, matlab, bas, sir, or madam. ' +
      'Continue in English/Hinglish unless the customer clearly and consistently speaks mostly Hindi across multiple meaningful utterances.'
    );
  }

  return (
    'Reply in English. Do not switch language based on accent or 1–2 Hindi filler words. ' +
    'Switch only if the customer clearly and consistently speaks mostly Hindi across multiple turns.'
  );
}

export function buildLockedLanguageInstruction(lock: LanguageLockState): string {
  return buildLanguageInstruction(lockStateToCustomerLanguage(lock));
}
