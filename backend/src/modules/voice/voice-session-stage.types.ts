/** High-level per-call voice session stage for speak-first greeting flow. */
export type VoiceSessionStage =
  | 'CONNECTING'
  | 'GREETING'
  | 'WAITING_FOR_CUSTOMER'
  | 'CONVERSATION'
  | 'DISABLED';
