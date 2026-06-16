import { VoiceOpeningContext } from './voice-opening.types';

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
  openingGreeting: 'Hi',
  askPermissionBeforePitch: true,
};

const BASE_VOICE_INSTRUCTIONS = [
  'You are a helpful voice assistant on a phone call for customers in India.',
  'Respond in the same language the caller uses: Hindi (Devanagari speech) or English.',
  'If the caller mixes languages, prefer Hindi unless they are clearly speaking English only.',
  'Never switch language mid-response. Keep each reply concise and conversational.',
].join(' ');

const PASSIVE_CALLER_FIRST_SUFFIX =
  'Wait until the caller has finished speaking before responding. Do not greet or speak first.';

export const DEFAULT_REALTIME_INSTRUCTIONS = `${BASE_VOICE_INSTRUCTIONS} ${PASSIVE_CALLER_FIRST_SUFFIX}`;

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

export function buildExampleOpeningMessage(
  context: VoiceOpeningContext,
): string {
  const greeting = context.openingGreeting ?? VOICE_OPENING_DEFAULTS.openingGreeting;
  const permission =
    context.askPermissionBeforePitch !== false
      ? ' Is this a good time to speak for a minute?'
      : '';
  return `${greeting}. This is ${context.agentName} calling on behalf of ${context.companyName}. I'm reaching out ${context.callPurpose}.${permission}`;
}

/** Strip caller-first rules from env instructions when opening is active. */
export function sanitizeBaseInstructionsForOpening(
  baseInstructions?: string,
): string {
  const trimmed = baseInstructions?.trim();
  if (!trimmed) {
    return BASE_VOICE_INSTRUCTIONS;
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
    `Say ONLY this single opening line in a natural phone voice. Use the agent name "${context.agentName}".`,
    `"${line}"`,
    'Then STOP immediately and end your turn. Do not continue talking.',
    'Do not pitch, explain further, or ask extra questions in this turn.',
    'Do not mention AI, bots, systems, or models.',
  ].join(' ');
}

export function buildOpeningSessionInstructions(
  context: VoiceOpeningContext,
  baseInstructions?: string,
): string {
  const example = buildExampleOpeningMessage(context);
  const permissionRule =
    context.askPermissionBeforePitch !== false
      ? 'Ask permission before continuing with the main conversation (for example: "Is this a good time to speak for a minute?").'
      : 'After stating the purpose, pause briefly and wait for the customer response before continuing.';

  const openingRules = [
    `You are ${context.agentName} calling on behalf of ${context.companyName}.`,
    `The purpose of this call is ${context.callPurpose}.`,
    'CALL OPENING RULES:',
    `- Begin the call immediately with your opening greeting: start with "${context.openingGreeting ?? VOICE_OPENING_DEFAULTS.openingGreeting}", introduce yourself as ${context.agentName}, state you are calling on behalf of ${context.companyName}, and explain the purpose (${context.callPurpose}).`,
    `- ${permissionRule}`,
    `- Keep the first message short and natural, similar to: "${example}"`,
    '- Do not start with a sales pitch.',
    '- Do not mention internal system details, APIs, or AI models.',
    '- Wait for the customer response before continuing beyond the opening.',
    '- If the customer says it is not a good time, politely offer to call back later.',
    `- If the customer asks who is calling, repeat your name (${context.agentName}), company (${context.companyName}), and purpose clearly.`,
    '- Speak first when the call begins — deliver your opening greeting immediately.',
  ].join(' ');

  const base = sanitizeBaseInstructionsForOpening(baseInstructions);
  return `${base} ${openingRules}`;
}

/** Session instructions after the opening turn — caller speaks next. */
export function buildPostOpeningSessionInstructions(
  context: VoiceOpeningContext,
  baseInstructions?: string,
): string {
  const base = sanitizeBaseInstructionsForOpening(baseInstructions);
  return [
    base,
    `You are ${context.agentName} representing ${context.companyName}.`,
    `Call purpose: ${context.callPurpose}.`,
    'The scripted opening greeting is already complete.',
    'Wait for the caller to finish speaking before each reply.',
    'Keep every reply concise — one or two short sentences. Never monologue.',
    'Do not repeat the opening greeting unless the caller asks who is calling.',
    'If they said it is not a good time, politely offer to call back later.',
    `If they ask who is calling, say you are ${context.agentName} from ${context.companyName} regarding ${context.callPurpose}.`,
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
