import {
  CALL_CONTEXT_FIELD_KEYS,
  CallContext,
  CallContextDebugInfo,
} from './voice-call-context.types';
import { normalizeVoicePhoneNumber } from './voice-phone.util';
import {
  VOICE_DOMAIN_FEEDBACK_GUIDANCE,
  VOICE_DOMAIN_LOCK_BLOCK,
} from './voice-domain.util';

const MAX_STRING_LENGTH = 200;

const FORBIDDEN_KEY_PATTERN =
  /^(api[_-]?key|password|secret|token|authorization|auth|credential|private)/i;

const NUMERIC_FIELDS = new Set(['totalCharges', 'balanceAmount']);

function trimString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function sanitizeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function sanitizePhone(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return normalizeVoicePhoneNumber(value.trim());
}

function hasOwnKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => !FORBIDDEN_KEY_PATTERN.test(key));
}

export function isEmptyCallContext(context?: CallContext | null): boolean {
  if (!context) {
    return true;
  }
  return CALL_CONTEXT_FIELD_KEYS.every(
    (key) => context[key] === undefined || context[key] === null,
  );
}

export function sanitizeCallContext(input: unknown): CallContext | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  if (!hasOwnKeys(record)) {
    return undefined;
  }

  const sanitized: CallContext = {};

  for (const key of CALL_CONTEXT_FIELD_KEYS) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      continue;
    }
    if (!(key in record)) {
      continue;
    }

    const raw = record[key];
    if (raw === null || raw === undefined) {
      continue;
    }

    if (NUMERIC_FIELDS.has(key)) {
      const numeric = sanitizeNumber(raw);
      if (numeric !== undefined) {
        sanitized[key as keyof CallContext] = numeric as never;
      }
      continue;
    }

    if (key === 'customerNumber' || key === 'driverMobileNumber') {
      const phone = sanitizePhone(raw);
      if (phone) {
        sanitized[key] = phone;
      }
      continue;
    }

    const text = trimString(raw, MAX_STRING_LENGTH);
    if (text) {
      sanitized[key as keyof CallContext] = text as never;
    }
  }

  return isEmptyCallContext(sanitized) ? undefined : sanitized;
}

export function extractCallContextDebugInfo(
  callContext?: CallContext | null,
): CallContextDebugInfo {
  if (!callContext || isEmptyCallContext(callContext)) {
    return {
      hasCallContext: false,
      callContextKeys: [],
    };
  }

  return {
    hasCallContext: true,
    callContextKeys: CALL_CONTEXT_FIELD_KEYS.filter(
      (key) => callContext[key] !== undefined && callContext[key] !== null,
    ),
    bookingNumber: callContext.bookingNumber,
    customerName: callContext.customerName,
  };
}

function formatCurrency(amount: number): string {
  return `₹${amount}`;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatCustomerNameForGreeting(customerName: string): string {
  const trimmed = customerName.trim();
  if (!trimmed) {
    return '';
  }

  const firstName = trimmed.split(/\s+/)[0] ?? trimmed;
  if (/ji$/i.test(firstName)) {
    return firstName;
  }
  return `${firstName} ji`;
}

export function buildCallContextInstructions(callContext: CallContext): string {
  const lines: string[] = ['Call-specific context (on-demand driver service):'];

  if (callContext.bookingNumber) {
    lines.push(`- Booking Number: ${callContext.bookingNumber}`);
  }
  if (callContext.customerName) {
    lines.push(`- Customer Name: ${callContext.customerName}`);
  }
  if (callContext.customerNumber) {
    lines.push(`- Customer Mobile: ${callContext.customerNumber}`);
  }
  if (callContext.driverName) {
    lines.push(`- Driver Name: ${callContext.driverName}`);
  }
  if (callContext.driverMobileNumber) {
    lines.push(`- Driver Mobile: ${callContext.driverMobileNumber}`);
  }
  if (callContext.totalCharges !== undefined) {
    lines.push(`- Total Charges: ${formatCurrency(callContext.totalCharges)}`);
  }
  if (callContext.balanceAmount !== undefined) {
    lines.push(`- Balance Amount: ${formatCurrency(callContext.balanceAmount)}`);
  }
  if (callContext.paymentMode) {
    lines.push(`- Payment Mode: ${titleCase(callContext.paymentMode)}`);
  }

  lines.push(
    '',
    VOICE_DOMAIN_LOCK_BLOCK,
    '',
    'Rules:',
    '- This is an on-demand driver service feedback call about a driver service booking or ride.',
    VOICE_DOMAIN_FEEDBACK_GUIDANCE,
    '- Use this information only when relevant.',
    '- Do not mention all details at once.',
    '- Do not invent missing values.',
    '- If the customer asks for unavailable details, say the team can confirm.',
    '- Keep replies short and conversational.',
  );

  return lines.join('\n');
}
