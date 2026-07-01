import type { CustomerLanguage, LanguageLockState } from './voice-language.util';
import { buildLanguageInstruction, buildLockedLanguageInstruction } from './voice-language.util';

export const DEFAULT_ECHO_TAIL_MS = 400;

export interface InterruptGateInput {
  aiSpeaking: boolean;
  speechDurationMs: number;
  speechMinDurationMs: number;
  rms: number;
  rmsThreshold: number;
  aiSpeakingStartedAt?: Date;
  echoTailMs?: number;
  now?: Date;
}

export interface InterruptGateResult {
  ignore: boolean;
  reason?: string;
}

export function shouldIgnoreCustomerInterrupt(
  input: InterruptGateInput,
): InterruptGateResult {
  if (!input.aiSpeaking) {
    return { ignore: true, reason: 'ai_not_speaking' };
  }

  if (input.speechDurationMs < input.speechMinDurationMs) {
    return { ignore: true, reason: 'speech_too_short' };
  }

  if (input.rms < input.rmsThreshold) {
    return { ignore: true, reason: 'low_energy' };
  }

  const echoTailMs = input.echoTailMs ?? DEFAULT_ECHO_TAIL_MS;
  if (input.aiSpeakingStartedAt) {
    const now = input.now ?? new Date();
    const sinceStart = now.getTime() - input.aiSpeakingStartedAt.getTime();
    if (sinceStart < echoTailMs) {
      return { ignore: true, reason: 'echo_tail_window' };
    }
  }

  return { ignore: false };
}

export function shouldCancelResponseOnInterrupt(input: {
  currentResponseId?: string;
  cancelSentForResponseId?: string;
  responseInProgress: boolean;
}): { shouldCancel: boolean; skipReason?: string } {
  if (!input.responseInProgress) {
    return { shouldCancel: false, skipReason: 'response_not_in_progress' };
  }
  if (!input.currentResponseId) {
    return { shouldCancel: true };
  }
  if (input.cancelSentForResponseId === input.currentResponseId) {
    return { shouldCancel: false, skipReason: 'cancel_already_sent' };
  }
  return { shouldCancel: true };
}

export const VOICE_INTERRUPTION_HARD_RULE =
  'If interrupted, do not repeat yourself. Acknowledge briefly and respond to the customer\'s latest point. Do not restart a cancelled sentence.';

export const TELEPHONY_MULAW_SAMPLE_RATE_HZ = 8000;

export function mulawBytesToPlaybackMs(mulawBytes: number): number {
  return Math.max(
    0,
    Math.floor((mulawBytes / TELEPHONY_MULAW_SAMPLE_RATE_HZ) * 1000),
  );
}

export function shouldSkipAssistantTranscriptDone(input: {
  interruptedAssistantItemId?: string;
  doneItemId?: string;
}): boolean {
  if (!input.interruptedAssistantItemId) {
    return false;
  }

  // If the transcript-done event carries no item id, fall back to skipping
  // whenever we know an interrupt happened for the in-flight assistant item.
  if (!input.doneItemId) {
    return true;
  }

  return input.interruptedAssistantItemId === input.doneItemId;
}

export function resolveInterruptedAssistantText(input: {
  assistantTranscriptBuffer: string;
  lastAssistantText?: string;
}): string | undefined {
  const partial = input.assistantTranscriptBuffer.trim();
  if (partial) {
    return partial;
  }

  return input.lastAssistantText?.trim() || undefined;
}

export function buildTurnResponseInstructions(input: {
  preferredLanguage?: string;
  lockedLanguage?: LanguageLockState;
  wasInterrupted?: boolean;
  lastAssistantText?: string;
}): string | undefined {
  const parts: string[] = [];

  const languageInstruction =
    input.lockedLanguage && input.lockedLanguage !== 'unknown'
      ? buildLockedLanguageInstruction(input.lockedLanguage)
      : input.preferredLanguage && input.preferredLanguage !== 'unknown'
        ? buildLanguageInstruction(input.preferredLanguage as CustomerLanguage)
        : buildLockedLanguageInstruction('english_hinglish');

  parts.push(languageInstruction);

  if (input.wasInterrupted) {
    parts.push(VOICE_INTERRUPTION_HARD_RULE);
    const heardText = input.lastAssistantText?.trim();
    if (heardText) {
      parts.push(
        `The customer only heard part of your previous reply (approximately: "${heardText}"). Do not repeat that content or continue that sentence. Respond only to what the customer just said.`,
      );
    } else {
      parts.push('Do not repeat your previous response.');
    }
  }

  return parts.length > 0 ? parts.join(' ') : undefined;
}
