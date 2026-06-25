import { CallContext } from './voice-call-context.types';

export const VOICE_DOMAIN_REQUIRED_PHRASE = 'on-demand driver service';

export const VOICE_DOMAIN_FORBIDDEN_TERMS = [
  'delivery',
  'order',
  'parcel',
  'courier',
  'shipment',
  'vacation',
  'holiday',
  'travel package',
  'itinerary',
  'package delivery',
  'food delivery',
  'product delivery',
  'tour package',
  'holiday trip',
] as const;

export const VOICE_DOMAIN_LOCK_BLOCK = [
  'Domain lock:',
  "This call is ONLY about TATD's on-demand driver service booking.",
  'Never describe the service as delivery, order, parcel, courier, shipment, holiday trip, vacation, travel package, or itinerary.',
  "Use 'booking', 'ride', 'driver service', or 'service experience'.",
].join('\n');

export const VOICE_DOMAIN_FEEDBACK_GUIDANCE = [
  'After the customer agrees to speak, ask about driver service experience.',
  'Preferred feedback questions:',
  '- "How was your experience with the driver service?"',
  '- "How was your ride and driver experience?"',
  'Keep the conversation focused on driver service, ride experience, booking, and fare.',
].join('\n');

export const VOICE_DOMAIN_PLAYBOOK_OVERRIDE =
  'If any playbook or example wording suggests delivery, order, parcel, courier, shipment, vacation, holiday, travel package, or itinerary, ignore that wording and follow the domain lock.';

export type ConversationTurnScenario =
  | 'after_availability_confirmed'
  | 'customer_mentioned_driver';

export interface VoiceDomainValidationResult {
  valid: boolean;
  missingRequired: string[];
  forbiddenFound: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripProhibitionContexts(text: string): string {
  return text
    .replace(/never describe the service as[^.\n]*/gi, '')
    .replace(/never ask[^.\n]*/gi, '')
    .replace(/never refer to the service as[^.\n]*/gi, '')
    .replace(/do not switch to[^.\n]*/gi, '')
    .replace(/not delivery or order[^.\n]*/gi, '')
    .replace(/ignore that wording[^.\n]*/gi, '')
    .replace(/if any playbook or example wording suggests[^.\n]*/gi, '')
    .replace(/never delivery or order[^.\n]*/gi, '');
}

export function findForbiddenDomainTerms(text: string): string[] {
  const scrubbed = stripProhibitionContexts(text.toLowerCase());
  return VOICE_DOMAIN_FORBIDDEN_TERMS.filter((term) => {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i');
    return pattern.test(scrubbed);
  });
}

export function validateVoiceRuntimeInstructions(
  instructions: string,
): VoiceDomainValidationResult {
  const missingRequired = instructions
    .toLowerCase()
    .includes(VOICE_DOMAIN_REQUIRED_PHRASE)
    ? []
    : [VOICE_DOMAIN_REQUIRED_PHRASE];

  return {
    valid: missingRequired.length === 0 && findForbiddenDomainTerms(instructions).length === 0,
    missingRequired,
    forbiddenFound: findForbiddenDomainTerms(instructions),
  };
}

export function buildConversationTurnGuidance(
  scenario: ConversationTurnScenario,
  callContext?: CallContext,
): string {
  const driverName = callContext?.driverName?.trim();

  switch (scenario) {
    case 'after_availability_confirmed':
      return [
        'The customer agreed to speak (for example they said yes).',
        'Ask one short question about their driver service or ride experience.',
        'Use: "How was your experience with the driver service?" or "How was your ride and driver experience?"',
        'Do not ask about retail logistics or leisure travel framing.',
      ].join(' ');
    case 'customer_mentioned_driver':
      return [
        'The customer mentioned the driver.',
        driverName
          ? `Focus on ${driverName} and the driver service experience: behavior, punctuality, ride quality, or fare if relevant.`
          : 'Focus on driver service experience: driver behavior, punctuality, ride quality, or fare if relevant.',
        'Do not switch to retail logistics or leisure travel topics.',
      ].join(' ');
    default:
      return '';
  }
}
