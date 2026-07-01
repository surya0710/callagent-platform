import { VoiceOpeningContext, OpeningState } from './voice-opening.types';
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
  const line = buildExampleOpeningMessage(context, callContext);
  const omitPurpose = shouldOmitCallPurposeInOpening(callContext);
  const permissionHint =
    context.askPermissionBeforePitch !== false
      ? 'Ask if this is a good time to speak.'
      : omitPurpose
        ? 'Stop and wait for the customer.'
        : 'State the call purpose, then stop and wait for the customer.';
  const openingTaskLine = omitPurpose
    ? `Greet the customer, introduce yourself as ${context.agentName}, mention ${context.companyName} and the booking reference, and ${permissionHint} Do not state the call purpose separately or ask feedback questions in the opening.`
    : `Greet the customer, introduce yourself as ${context.agentName}, mention ${context.companyName}, state the call purpose, and ${permissionHint}`;

  const minimalContextRules = callContext
    ? [
        'Use only customer name and booking number if available in the opening.',
        'This is an on-demand driver service booking feedback call.',
        VOICE_DOMAIN_LOCK_BLOCK,
        'Do not mention driver, payment, or other ride details in the opening unless specifically configured.',
        ...(omitPurpose
          ? [
              'The booking reference already explains why you are calling; do not repeat the call purpose in the opening.',
            ]
          : []),
      ]
    : [];

  return [
    'Say exactly one short opening message for an outbound phone call.',
    openingTaskLine,
    ...minimalContextRules,
    'Do not continue with discovery questions.',
    'Do not pitch.',
    'Do not ask multiple questions.',
    'Do NOT offer to call back later in the opening.',
    'Do NOT role-play the customer or answer the good-time question yourself.',
    'After this opening message, stop and wait for the customer.',
    'Match configured greeting and India time-aware greeting if enabled.',
    `Example output: "${line}"`,
    `Use agent name "${context.agentName}". Maximum ${OPENING_MAX_WORDS} words total.`,
    'Do not handle objections, explain services, or use playbook content in this opening turn.',
    'Do NOT add pleasantries, explanations, context, or extra questions beyond that line.',
    'Then STOP immediately and end your turn.',
    'Do not mention AI, bots, systems, or models.',
  ].join(' ');
}

export function buildOpeningSessionInstructions(
  context: VoiceOpeningContext,
  baseInstructions?: string,
  accent: VoiceAccentProfile = 'indian',
  callContext?: CallContext,
): string {
  const example = buildExampleOpeningMessage(context, callContext);
  const omitPurpose = shouldOmitCallPurposeInOpening(callContext);
  const permissionRule =
    context.askPermissionBeforePitch !== false
      ? 'End with one short permission question only.'
      : omitPurpose
        ? 'Stop and wait for the customer.'
        : 'After stating the purpose, stop and wait for the customer.';
  const purposeLine = omitPurpose
    ? `Call purpose (for later turns only, not the opening): ${context.callPurpose}.`
    : `Call purpose: ${context.callPurpose}.`;

  const openingRules = [
    `You are ${context.agentName} from ${context.companyName}.`,
    purposeLine,
    'CALL OPENING RULES:',
    `- Deliver ONE short opening only, like: "${example}"`,
    `- ${permissionRule}`,
    ...(omitPurpose
      ? [
          '- Do not state the call purpose in the opening; the booking reference is enough.',
        ]
      : []),
    `- Maximum ${OPENING_MAX_WORDS} words in the opening.`,
    '- Do not pitch, elaborate, or add filler.',
    '- Do not ask discovery questions, handle objections, or use playbook content during the opening.',
    '- Wait for the customer response before saying anything else.',
    '- If the customer is silent after the opening, remain silent.',
    `- If asked who is calling, give a one-sentence reply with ${context.agentName}, ${context.companyName}, and purpose only.`,
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
): string {
  const base = sanitizeBaseInstructionsForOpening(baseInstructions, accent);
  return [
    base,
    BREVITY_RULES,
    CALL_END_INTENT_RULES,
    VOICE_DOMAIN_LOCK_BLOCK,
    VOICE_DOMAIN_FEEDBACK_GUIDANCE,
    `You are ${context.agentName} from ${context.companyName}.`,
    `Call purpose (do not repeat unless asked): ${context.callPurpose}.`,
    'The opening greeting is already done.',
    'If a good-time permission question was just asked, wait silently for the customer answer.',
    'If the customer says yes or agrees to speak, ask about driver service or ride experience — not delivery or order.',
    'Do NOT assume the customer said no, busy, or unavailable.',
    'Do NOT offer to call back unless the customer clearly says they are unavailable or asks to talk later.',
    'Wait for the caller to finish before each reply.',
    `If they ask who is calling, reply in one sentence: ${context.agentName} from ${context.companyName}.`,
    PASSIVE_CALLER_FIRST_SUFFIX,
  ].join(' ');
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

export function buildSpeakFirstDiagnosticLog(
  input: SpeakFirstDiagnosticInput,
): Record<string, unknown> {
  return {
    provider: input.provider,
    streamId: input.streamId,
    authorizationId: input.authorizationId ?? null,
    sessionReady: input.sessionReady,
    timerScheduled: input.timerScheduled,
    timerFired: input.timerFired,
    openingSent: input.openingSent,
    firstAudioDelta: input.firstAudioDelta,
    firstOutboundMedia: input.firstOutboundMedia,
    skipReason: input.skipReason ?? null,
    delayMs: input.delayMs,
    stage: input.stage,
    message: `voice_speak_first_${input.stage}`,
  };
}
