type CallContextKey =
  | 'bookingNumber'
  | 'customerName'
  | 'customerNumber'
  | 'driverName'
  | 'driverMobileNumber'
  | 'totalCharges'
  | 'balanceAmount'
  | 'paymentMode';

const CALL_CONTEXT_FIELD_ALIASES: Record<string, CallContextKey> = {
  bookingNumber: 'bookingNumber',
  booking_number: 'bookingNumber',
  customerName: 'customerName',
  customer_name: 'customerName',
  customerNumber: 'customerNumber',
  customer_number: 'customerNumber',
  customer_mobile_number: 'customerNumber',
  customerMobileNumber: 'customerNumber',
  mobile: 'customerNumber',
  driverName: 'driverName',
  driver_name: 'driverName',
  driverMobileNumber: 'driverMobileNumber',
  driver_mobile_number: 'driverMobileNumber',
  totalCharges: 'totalCharges',
  total_charges: 'totalCharges',
  balanceAmount: 'balanceAmount',
  balance_amount: 'balanceAmount',
  paymentMode: 'paymentMode',
  payment_mode: 'paymentMode',
};

const NUMERIC_CALL_CONTEXT_KEYS = new Set<CallContextKey>([
  'totalCharges',
  'balanceAmount',
]);

function readString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const text = String(value).trim();
  return text || undefined;
}

function readNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Normalize partner payloads to the integration call DTO shape only. */
export function normalizeIntegrationCallRequest(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const externalRef =
    readString(body.externalRef) ??
    readString(body.external_ref) ??
    readString(body.bookingNumber) ??
    readString(body.booking_number) ??
    readString(body.bookingId) ??
    readString(body.booking_id);

  const customerNumber =
    readString(body.customerNumber) ??
    readString(body.customer_number) ??
    readString(body.customer_mobile_number) ??
    readString(body.customerMobileNumber) ??
    readString(body.mobile) ??
    readString(body.phone);

  const webhookUrl =
    readString(body.webhookUrl) ??
    readString(body.webhook_url) ??
    readString(body.callbackUrl) ??
    readString(body.callback_url);

  const callContext: Record<string, unknown> = {
    ...(asRecord(body.callContext) ?? {}),
  };

  for (const [alias, targetKey] of Object.entries(CALL_CONTEXT_FIELD_ALIASES)) {
    if (!(alias in body) || callContext[targetKey] !== undefined) {
      continue;
    }

    const raw = body[alias];
    if (NUMERIC_CALL_CONTEXT_KEYS.has(targetKey)) {
      const numeric = readNumber(raw);
      if (numeric !== undefined) {
        callContext[targetKey] = numeric;
      }
      continue;
    }

    const text = readString(raw);
    if (text) {
      callContext[targetKey] = text;
    }
  }

  const normalized: Record<string, unknown> = {};

  if (externalRef) {
    normalized.externalRef = externalRef;
  }
  if (customerNumber) {
    normalized.customerNumber = customerNumber;
  }
  if (Object.keys(callContext).length > 0) {
    normalized.callContext = callContext;
  }
  if (webhookUrl) {
    normalized.webhookUrl = webhookUrl;
    normalized.callbackUrl = webhookUrl;
  }
  if (body.metadata !== undefined && body.metadata !== null) {
    normalized.metadata = body.metadata;
  }

  return normalized;
}
