import { VoiceOpeningContext } from './voice-opening.types';
import {
  buildAccentInstructions,
  VoiceAccentProfile,
} from './voice-accent.util';

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
  callPurpose: 'regarding your recent enquiry',
  openingGreeting: 'Namaste',
  askPermissionBeforePitch: true,
};

export const CONVERSATION_MAX_OUTPUT_TOKENS = 180;
export const OPENING_MAX_OUTPUT_TOKENS = 120;

const OPENING_MAX_WORDS = 40;
const INDIA_TIME_ZONE = 'Asia/Kolkata';

const BASE_VOICE_INSTRUCTIONS = [
  'You are a helpful voice assistant on a phone call for customers in India.',
  'Respond in the same language and style the caller uses: English, Hindi, or Hinglish.',
  'Do not default to Hindi. Indian accent is not a Hindi language signal.',
  'If the caller speaks English, respond only in English. If they speak Hindi, respond in Hindi. If they mix Hindi and English, respond in Hinglish.',
  'Never switch language mid-response.',
  'Use phrasing natural to Indian phone conversations (Indian English or Hindi as appropriate).',
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

export function buildExampleOpeningMessage(
  context: VoiceOpeningContext,
): string {
  const greeting =
    context.openingGreeting ?? VOICE_OPENING_DEFAULTS.openingGreeting;
  const permission =
    context.askPermissionBeforePitch !== false
      ? ' Is this a good time to speak for a minute?'
      : '';
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
): string {
  const line = buildExampleOpeningMessage(context);
  return [
    `Say ONLY the opening line below — nothing else. Use agent name "${context.agentName}".`,
    'Use a natural Indian English accent unless the opening line is entirely in Hindi.',
    `Maximum ${OPENING_MAX_WORDS} words total.`,
    `"${line}"`,
    'Do not ask discovery questions, handle objections, pitch benefits, or use playbook content in this opening turn.',
    'Do NOT add pleasantries, explanations, context, or extra questions beyond that line.',
    'After the permission question, stay silent until the customer responds.',
    'Then STOP immediately and end your turn.',
    'Do not mention AI, bots, systems, or models.',
  ].join(' ');
}

export function buildOpeningSessionInstructions(
  context: VoiceOpeningContext,
  baseInstructions?: string,
  accent: VoiceAccentProfile = 'indian',
): string {
  const example = buildExampleOpeningMessage(context);
  const permissionRule =
    context.askPermissionBeforePitch !== false
      ? 'End with one short permission question only.'
      : 'After stating the purpose, stop and wait for the customer.';

  const openingRules = [
    `You are ${context.agentName} from ${context.companyName}.`,
    `Call purpose: ${context.callPurpose}.`,
    'CALL OPENING RULES:',
    `- Deliver ONE short opening only, like: "${example}"`,
    `- ${permissionRule}`,
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
    `You are ${context.agentName} from ${context.companyName}.`,
    `Call purpose (do not repeat unless asked): ${context.callPurpose}.`,
    'The opening greeting is already done.',
    'Wait for the caller to finish before each reply.',
    'If they said it is not a good time, offer to call back in one short sentence.',
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
