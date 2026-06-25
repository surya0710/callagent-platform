/** Source that triggered or authorized a response.create. */
export type ResponseCreateSource =
  | 'opening'
  | 'customer_speech'
  | 'manual_fallback'
  | 'call_end_ack'
  | 'session_end'
  | 'server_vad';

export interface ResponseCreateGateInput {
  awaitingCustomerInput: boolean;
  customerTurnConfirmed: boolean;
  responseRequested: boolean;
  responseInProgress: boolean;
  source: ResponseCreateSource;
  forceOnEnd?: boolean;
  manualFallback?: boolean;
  manualFallbackUsedSinceLastResponse?: boolean;
}

export interface ResponseCreateGateResult {
  allowed: boolean;
  skipReason?: string;
}

export function isValidCustomerTranscript(
  text: string | undefined,
): text is string {
  if (!text) {
    return false;
  }
  const trimmed = text.trim();
  return trimmed.length >= 1 && /\S/.test(trimmed);
}

function normalizeTranscriptForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when customer transcript likely echoes the assistant's recent output. */
export function isLikelyAssistantEcho(
  customerText: string,
  assistantText: string | undefined,
): boolean {
  if (!assistantText?.trim()) {
    return false;
  }

  const customer = normalizeTranscriptForCompare(customerText);
  const assistant = normalizeTranscriptForCompare(assistantText);
  if (!customer || !assistant) {
    return false;
  }

  if (customer === assistant) {
    return true;
  }

  if (customer.length >= 8 && assistant.includes(customer)) {
    return true;
  }

  if (assistant.length >= 8 && customer.includes(assistant)) {
    return true;
  }

  const customerWords = customer.split(' ').filter(Boolean);
  const assistantWords = new Set(assistant.split(' ').filter(Boolean));
  if (customerWords.length === 0) {
    return false;
  }

  const overlap = customerWords.filter((word) => assistantWords.has(word)).length;
  return overlap / customerWords.length >= 0.85;
}

export function shouldAllowResponseCreate(
  input: ResponseCreateGateInput,
): ResponseCreateGateResult {
  if (input.responseRequested || input.responseInProgress) {
    return { allowed: false, skipReason: 'response_already_pending' };
  }

  if (input.source === 'opening') {
    return { allowed: true };
  }

  if (input.source === 'call_end_ack') {
    return { allowed: true };
  }

  if (input.source === 'session_end' && input.forceOnEnd) {
    return { allowed: true };
  }

  if (input.source === 'manual_fallback') {
    if (input.manualFallbackUsedSinceLastResponse) {
      return { allowed: false, skipReason: 'manual_fallback_already_used' };
    }
    if (!input.customerTurnConfirmed) {
      return { allowed: false, skipReason: 'manual_fallback_without_customer_turn' };
    }
    return { allowed: true };
  }

  if (input.awaitingCustomerInput && !input.customerTurnConfirmed) {
    return { allowed: false, skipReason: 'awaiting_customer_input' };
  }

  if (
    input.source === 'customer_speech' ||
    input.source === 'server_vad' ||
    input.source === 'session_end'
  ) {
    if (!input.customerTurnConfirmed) {
      return { allowed: false, skipReason: 'customer_turn_not_confirmed' };
    }
    return { allowed: true };
  }

  return { allowed: false, skipReason: 'unknown_source' };
}

export function shouldForwardInboundWhileAwaiting(input: {
  awaitingCustomerInput: boolean;
  customerTurnConfirmed: boolean;
  aiTurnActive: boolean;
  bargeInConfirmed: boolean;
}): { forward: boolean; reason: string } {
  if (input.aiTurnActive && !input.bargeInConfirmed) {
    return { forward: false, reason: 'ai_turn_active' };
  }

  if (input.awaitingCustomerInput && !input.customerTurnConfirmed) {
    return { forward: false, reason: 'awaiting_customer_input' };
  }

  return { forward: true, reason: 'allowed' };
}
