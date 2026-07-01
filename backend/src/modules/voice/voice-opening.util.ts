import { VoiceOpeningContext, OpeningState } from './voice-opening.types';
import { VoiceSessionStage } from './voice-session-stage.types';
import {
  buildAccentInstructions,
  VoiceAccentProfile,
} from './voice-accent.util';
import { CallContext } from './voice-call-context.types';
import { formatCustomerNameForGreeting } from './voice-call-context.util';
import {
  VOICE_DOMAIN_FEEDBACK_GUIDANCE,
  VOICE_DOMAIN_LOCK_BLOCK,
} from './voice-domain.util';

export const VOICE_OPENING_DEFAULTS: Required<
  Pick<
    VoiceOpeningContext,
    | 'agentName'
    | 'companyName'
    | 'callPurpose'
    | 'openingGreeting'
    | 'askPermissionBeforePitch'
  >
> = {
  agentName: 'your AI assistant',
  companyName: 'our team',
  callPurpose: 'about your recent driver service booking',
  openingGreeting: 'Namaste',
  askPermissionBeforePitch: true,
};

export const CONVERSATION_MAX_OUTPUT_TOKENS = 180;
export const OPENING_MAX_OUTPUT_TOKENS = 120;
export const OPENING_SHORT_MAX_OUTPUT_TOKENS = 32;

const OPENING_MAX_WORDS = 40;
const INDIA_TIME_ZONE = 'Asia/Kolkata';

const BASE_VOICE_INSTRUCTIONS = [
  'You are a helpful voice assistant on a phone call for customers in India.',
  'This call is about TATD on-demand driver service bookings and ride feedback only.',
  'Respond in the same language and style the caller uses: English, Hindi, or Hinglish.',
  'Do not default to Hindi. Indian accent is not a Hindi language signal.',
  'If the caller speaks English, respond only in English. If they speak Hindi, respond in Hindi. If they mix Hindi and English, respond in Hinglish.',
  'Never switch language mid-response.',
  'Use phrasing natural to Indian phone conversations (Indian English or Hindi as appropriate).',
  'Never refer to the service as delivery, order, parcel, courier, shipment, vacation, holiday, travel package, or itinerary.',
].join(' ');

const BREVITY_RULES = [
  'Maximum 20 words per reply unless the caller explicitly asks for more detail.',
  'Use one short sentence when possible. Two sentences only if necessary.',
  'Never repeat your name, company, or call purpose unless the caller asks.',
  'Do not use filler openers like "Great", "Absolutely", "Of course", or "Wonderful".',
  'Do not volunteer extra information, upsells, or unprompted follow-up questions.',
  'Answer ONLY what the caller just asked, then stop.',
  'Do not summarize, recap, or restate the conversation.',
].join(' ');

const CALL_END_INTENT_RULES = [
  'If the caller intent is to end or pause the call, do not continue the conversation.',
  'End-or-pause intent includes: not a good time, busy, in a meeting, driving, call later, talk later, not interested, no requirement, wrong number, do not call, stop calling, or goodbye.',
  'For end-or-pause intent, give one short acknowledgement in the caller language/style, then stop.',
  'Do not ask another question after end-or-pause intent.',
].join(' ');

const PASSIVE_CALLER_FIRST_SUFFIX =
  'Wait until the caller has finished speaking before responding. Do not greet or speak first.';

export function buildBaseVoiceInstructions(
  accent: VoiceAccentProfile = 'indian',
): string {
  const accentBlock = buildAccentInstructions(accent);
  return [BASE_VOICE_INSTRUCTIONS, accentBlock].filter(Boolean).join(' ');
}

export function buildDefaultRealtimeInstructions(
  accent: VoiceAccentProfile = 'indian',
): string {
  return [
    buildBaseVoiceInstructions(accent),
    BREVITY_RULES,
    CALL_END_INTENT_RULES,
    PASSIVE_CALLER_FIRST_SUFFIX,
  ].join(' ');
}

export const DEFAULT_REALTIME_INSTRUCTIONS =
  buildDefaultRealtimeInstructions('indian');

export function mergeOpeningContext(
  partial?: Partial<VoiceOpeningContext>,
): VoiceOpeningContext {
  return {
    agentName: partial?.agentName?.trim() || VOICE_OPENING_DEFAULTS.agentName,
    companyName:
      partial?.companyName?.trim() || VOICE_OPENING_DEFAULTS.companyName,
    callPurpose:
      partial?.callPurpose?.trim() || VOICE_OPENING_DEFAULTS.callPurpose,
    openingGreeting:
      partial?.openingGreeting?.trim() ||
      VOICE_OPENING_DEFAULTS.openingGreeting,
    askPermissionBeforePitch:
      partial?.askPermissionBeforePitch ??
      VOICE_OPENING_DEFAULTS.askPermissionBeforePitch,
  };
}

export function getIndiaHour(date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIME_ZONE,
    hour: '2-digit',
    hour12: false,
  }).format(date);
  return Number.parseInt(hour, 10);
}

export function getTimeAwareGreeting(date = new Date()): string {
  const hour = getIndiaHour(date);
  if (hour >= 5 && hour < 12) {
    return 'Good morning';
  }
  if (hour >= 12 && hour < 17) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

export function resolveTimeAwareOpeningGreeting(
  configuredGreeting?: string,
  date = new Date(),
): string {
  const currentGreeting = getTimeAwareGreeting(date);
  const trimmed = configuredGreeting?.trim();
  if (!trimmed) {
    return currentGreeting;
  }

  if (/good\s+(morning|afternoon|evening)/i.test(trimmed)) {
    return trimmed.replace(
      /good\s+(morning|afternoon|evening)/i,
      currentGreeting,
    );
  }

  return trimmed;
}

/** Format call purpose into a short spoken line for the opening script. */
export function formatCallPurposeLine(callPurpose: string): string {
  const purpose = callPurpose.trim().replace(/\.$/, '');
  if (!purpose) {
    return 'I have a quick update for you';
  }
  if (/^I'm calling/i.test(purpose)) {
    return purpose;
  }
  if (/^(to |about |regarding )/i.test(purpose)) {
    return `I'm calling ${purpose}`;
  }
  return `I'm calling about ${purpose}`;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function appendOpeningCallPurposeSentence(callPurpose: string): string {
  const purpose = callPurpose.trim().replace(/\.$/, '');
  if (!purpose) {
    return '';
  }
  if (/^I('m| am) calling/i.test(purpose)) {
    return ` ${purpose}.`;
  }
  if (/^(to |about |regarding )/i.test(purpose)) {
    return ` I'm calling ${purpose}.`;
  }
  if (/^I /i.test(purpose)) {
    return ` ${purpose}.`;
  }
  return ` I'm calling about ${purpose}.`;
}

function shouldOmitCallPurposeInOpening(callContext?: CallContext): boolean {
  return Boolean(callContext?.bookingNumber?.trim());
}

/** Automatic speak-first line only — no company/booking intro on the first turn. */
export function buildShortSpeakFirstOpeningLine(
  callContext?: CallContext,
): string {
  const customerName = callContext?.customerName?.trim();
  if (customerName) {
    return `Hello ${formatCustomerNameForGreeting(customerName)}.`;
  }
  return 'Hello ji.';
}

export function buildExampleOpeningMessage(
  context: VoiceOpeningContext,
  callContext?: CallContext,
): string {
  const greeting =
    context.openingGreeting ?? VOICE_OPENING_DEFAULTS.openingGreeting;
  const permission =
    context.askPermissionBeforePitch !== false
      ? ' Is this a good time to speak?'
      : '';
  const omitPurpose = shouldOmitCallPurposeInOpening(callContext);

  if (callContext?.customerName && callContext.bookingNumber) {
    const name = formatCustomerNameForGreeting(callContext.customerName);
    const purposeSentence = omitPurpose
      ? ''
      : appendOpeningCallPurposeSentence(context.callPurpose);
    return `${greeting} ${name}, this is ${context.agentName} calling from ${context.companyName} regarding your booking ${callContext.bookingNumber}.${purposeSentence}${permission}`;
  }

  if (callContext?.customerName) {
    const name = formatCustomerNameForGreeting(callContext.customerName);
    const purposeLine = formatCallPurposeLine(context.callPurpose);
    return `${greeting} ${name}, this is ${context.agentName} from ${context.companyName}. ${purposeLine}.${permission}`;
  }

  if (callContext?.bookingNumber) {
    return `${greeting}. This is ${context.agentName} from ${context.companyName} regarding your booking ${callContext.bookingNumber}.${permission}`;
  }

  const purposeLine = formatCallPurposeLine(context.callPurpose);
  return `${greeting}. This is ${context.agentName} from ${context.companyName}. ${purposeLine}.${permission}`;
}

/** Strip caller-first rules from env instructions when opening is active. */
export function sanitizeBaseInstructionsForOpening(
  baseInstructions?: string,
  accent: VoiceAccentProfile = 'indian',
): string {
  const trimmed = baseInstructions?.trim();
  if (!trimmed) {
    return buildBaseVoiceInstructions(accent);
  }

  return trimmed
    .replace(/Do not greet or speak first\.?/gi, '')
    .replace(
      /Wait until the caller has finished speaking before responding\.?/gi,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Strict one-turn script for the initial response.create opening. */
export function buildOpeningResponseInstructions(
  context: VoiceOpeningContext,
  callContext?: CallContext,
): string {
  const line = buildShortSpeakFirstOpeningLine(callContext);

  return [
    'Say exactly one very short automatic opening line for an outbound phone call.',
    `Say only: "${line}"`,
    'Do NOT introduce yourself, company name, booking number, call purpose, or ask any question.',
    'Do NOT add pleasantries, explanations, or extra words.',
    'Maximum 5 words.',
    'Then STOP immediately and end your turn.',
    'Do not mention AI, bots, systems, or models.',
    'The full introduction happens only after the customer responds.',
  ].join(' ');
}

export function buildOpeningSessionInstructions(
  context: VoiceOpeningContext,
  baseInstructions?: string,
  accent: VoiceAccentProfile = 'indian',
  callContext?: CallContext,
): string {
  const example = buildShortSpeakFirstOpeningLine(callContext);
  const omitPurpose = shouldOmitCallPurposeInOpening(callContext);
  const purposeLine = omitPurpose
    ? `Call purpose (for later turns only, not the automatic opening): ${context.callPurpose}.`
    : `Call purpose: ${context.callPurpose}.`;

  const openingRules = [
    `You are ${context.agentName} from ${context.companyName}.`,
    purposeLine,
    'CALL OPENING RULES:',
    `- Deliver ONE very short automatic opening only, like: "${example}"`,
    '- Do NOT introduce yourself, company, booking, purpose, or ask questions in the automatic opening.',
    '- After the customer responds, introduce yourself, mention booking context if available, and ask if it is a good time to speak.',
    '- Never repeat the automatic hello opening after the customer speaks.',
    '- Do not pitch, elaborate, or add filler during the automatic opening.',
    '- Do not ask discovery questions, handle objections, or use playbook content during the automatic opening.',
    '- Wait for the customer response before the full introduction.',
    '- If the customer is silent after the automatic opening, remain silent.',
    '- Speak first when the call begins.',
  ].join(' ');

  const base = sanitizeBaseInstructionsForOpening(baseInstructions, accent);
  return `${base} ${openingRules}`;
}

/** Session instructions after the opening turn — caller speaks next. */
export function buildPostOpeningSessionInstructions(
  context: VoiceOpeningContext,
  baseInstructions?: string,
  accent: VoiceAccentProfile = 'indian',
  callContext?: CallContext,
): string {
  const shortOpening = buildShortSpeakFirstOpeningLine(callContext);
  const bookingHint = callContext?.bookingNumber?.trim()
    ? `Booking reference: ${callContext.bookingNumber.trim()}.`
    : '';
  const base = sanitizeBaseInstructionsForOpening(baseInstructions, accent);
  return [
    base,
    BREVITY_RULES,
    CALL_END_INTENT_RULES,
    VOICE_DOMAIN_LOCK_BLOCK,
    VOICE_DOMAIN_FEEDBACK_GUIDANCE,
    `You are ${context.agentName} from ${context.companyName}.`,
    `Call purpose (do not repeat unless asked): ${context.callPurpose}.`,
    bookingHint,
    `The automatic short opening "${shortOpening}" is already done. Never repeat it.`,
    'When the customer speaks (for example hello), your next reply should:',
    `- Introduce yourself as ${context.agentName} from ${context.companyName}.`,
    ...(bookingHint
      ? ['- Mention the booking reference naturally.']
      : []),
    ...(context.askPermissionBeforePitch !== false
      ? ['- Ask if this is a good time to speak.']
      : ['- Continue with the call purpose briefly, then wait.']),
    'Do NOT repeat the automatic hello opening line.',
    'If the customer says yes or agrees to speak, ask about driver service or ride experience — not delivery or order.',
    'Do NOT assume the customer said no, busy, or unavailable.',
    'Do NOT offer to call back unless the customer clearly says they are unavailable or asks to talk later.',
    'Wait for the caller to finish before each reply.',
    `If they ask who is calling, reply in one sentence: ${context.agentName} from ${context.companyName}.`,
    PASSIVE_CALLER_FIRST_SUFFIX,
  ]
    .filter(Boolean)
    .join(' ');
}

export function parseAskPermissionBeforePitch(
  raw: string | undefined,
): boolean | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  return undefined;
}

export interface OpeningReadinessInput {
  aiSpeakFirstEnabled: boolean;
  openingState: OpeningState;
  authorized: boolean;
  smartfloStartReceived: boolean;
  streamSidKnown: boolean;
  smartfloWebSocketOpen: boolean;
  openAiWebSocketOpen: boolean;
  openAiSessionCreated: boolean;
  openAiSessionUpdated: boolean;
  responsePending: boolean;
  openingAlreadyRequested: boolean;
}

export function getOpeningSkipReason(
  input: OpeningReadinessInput,
): string | null {
  if (!input.aiSpeakFirstEnabled) {
    return 'speak_first_disabled';
  }
  if (!input.authorized) {
    return 'not_authorized';
  }
  if (!input.smartfloStartReceived) {
    return 'smartflo_start_not_received';
  }
  if (!input.streamSidKnown) {
    return 'stream_sid_unknown';
  }
  if (!input.smartfloWebSocketOpen) {
    return 'smartflo_websocket_not_open';
  }
  if (!input.openAiWebSocketOpen) {
    return 'openai_websocket_not_open';
  }
  if (!input.openAiSessionCreated) {
    return 'openai_session_not_created';
  }
  if (!input.openAiSessionUpdated) {
    return 'openai_session_not_updated';
  }
  if (input.responsePending) {
    return 'response_pending';
  }
  if (input.openingAlreadyRequested) {
    return 'opening_already_requested';
  }
  if (
    input.openingState !== 'waiting_for_openai_ready' &&
    input.openingState !== 'ready_to_speak'
  ) {
    return `opening_state_${input.openingState}`;
  }
  return null;
}

export function canTriggerOpening(input: OpeningReadinessInput): boolean {
  return getOpeningSkipReason(input) === null;
}

export function isOpeningInboundSuppressedState(state: OpeningState): boolean {
  return (
    state === 'opening_response_requested' || state === 'opening_audio_playing'
  );
}

export function isOpeningFlowComplete(state: OpeningState): boolean {
  return state === 'opening_done' || state === 'failed' || state === 'disabled';
}

export const OPENING_PRE_TIMER_SPEECH_MIN_PACKETS = 6;
export const OPENING_PRE_TIMER_SPEECH_MIN_DURATION_MS = 400;

export function hasOpeningPreTimerCustomerSpeech(
  packetCount: number,
  durationMs: number,
): boolean {
  return (
    packetCount >= OPENING_PRE_TIMER_SPEECH_MIN_PACKETS &&
    durationMs >= OPENING_PRE_TIMER_SPEECH_MIN_DURATION_MS
  );
}

export type SpeakFirstDiagnosticStage =
  | 'sessionReady'
  | 'timerScheduled'
  | 'timerFired'
  | 'openingSent'
  | 'firstAudioDelta'
  | 'firstOutboundMedia'
  | 'skipped';

/** @deprecated use GreetingDiagnosticInput */
export interface SpeakFirstDiagnosticInput {
  stage: SpeakFirstDiagnosticStage;
  provider?: string;
  streamId?: string;
  authorizationId?: string;
  sessionReady?: boolean;
  timerScheduled?: boolean;
  timerFired?: boolean;
  openingSent?: boolean;
  firstAudioDelta?: boolean;
  firstOutboundMedia?: boolean;
  skipReason?: string | null;
  delayMs?: number;
}

/** @deprecated use buildGreetingDiagnosticLog */
export function buildSpeakFirstDiagnosticLog(
  input: SpeakFirstDiagnosticInput,
): Record<string, unknown> {
  return buildGreetingDiagnosticLog({
    provider: input.provider,
    sessionId: input.streamId,
    openAiReady: input.sessionReady,
    greetingScheduled: input.timerScheduled,
    greetingSent: input.openingSent,
    firstAudioDelta: input.firstAudioDelta,
    firstOutboundMedia: input.firstOutboundMedia,
    skipReason: input.skipReason,
    delayMs: input.delayMs,
  });
}

export interface GreetingDiagnosticInput {
  provider?: string;
  sessionId?: string;
  authorizationId?: string;
  stage?: VoiceSessionStage;
  openingState?: OpeningState;
  openAiReady?: boolean;
  greetingScheduled?: boolean;
  greetingSent?: boolean;
  greetingActuallySent?: boolean;
  firstAudioDelta?: boolean;
  firstOutboundMedia?: boolean;
  skipReason?: string | null;
  delayMs?: number;
  configuredOpeningDelayMs?: number;
  msSinceTelephonyStart?: number;
  msSinceSessionReady?: number;
  msSinceOpenAiConnected?: number;
  responseRequested?: boolean;
  responseInProgress?: boolean;
  customerSpokeBeforeOpeningDelay?: boolean;
  openingResponseStarted?: boolean;
  openingFirstAudioDelta?: boolean;
  openingResponseDone?: boolean;
  openingMarkedComplete?: boolean;
  repeatedOpeningPrevented?: boolean;
}

/** Fields supplied by runtime session context when logging greeting diagnostics. */
export type GreetingDiagnosticLogInput = Omit<
  GreetingDiagnosticInput,
  | 'provider'
  | 'sessionId'
  | 'authorizationId'
  | 'stage'
  | 'openingState'
  | 'openAiReady'
  | 'responseRequested'
  | 'responseInProgress'
  | 'customerSpokeBeforeOpeningDelay'
  | 'greetingActuallySent'
>;

export function buildGreetingDiagnosticLog(
  input: GreetingDiagnosticInput,
): Record<string, unknown> {
  return {
    provider: input.provider,
    sessionId: input.sessionId,
    authorizationId: input.authorizationId,
    stage: input.stage,
    openingState: input.openingState,
    openAiReady: input.openAiReady,
    greetingScheduled: input.greetingScheduled,
    greetingSent: input.greetingSent,
    greetingActuallySent: input.greetingActuallySent,
    firstAudioDelta: input.firstAudioDelta,
    firstOutboundMedia: input.firstOutboundMedia,
    skipReason: input.skipReason ?? null,
    delayMs: input.delayMs,
    configuredOpeningDelayMs: input.configuredOpeningDelayMs,
    msSinceTelephonyStart: input.msSinceTelephonyStart,
    msSinceSessionReady: input.msSinceSessionReady,
    msSinceOpenAiConnected: input.msSinceOpenAiConnected,
    responseRequested: input.responseRequested,
    responseInProgress: input.responseInProgress,
    customerSpokeBeforeOpeningDelay: input.customerSpokeBeforeOpeningDelay,
    openingResponseStarted: input.openingResponseStarted,
    openingFirstAudioDelta: input.openingFirstAudioDelta,
    openingResponseDone: input.openingResponseDone,
    openingMarkedComplete: input.openingMarkedComplete,
    repeatedOpeningPrevented: input.repeatedOpeningPrevented,
    message: 'voice_greeting_diag',
  };
}
