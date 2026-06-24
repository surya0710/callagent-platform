export interface CallContext {
  bookingNumber?: string;
  customerName?: string;
  customerNumber?: string;
  driverName?: string;
  driverMobileNumber?: string;
  totalCharges?: number;
  balanceAmount?: number;
  paymentMode?: string;
}

export interface CallContextDebugInfo {
  hasCallContext: boolean;
  callContextKeys: string[];
  bookingNumber?: string;
  customerName?: string;
}

export const CALL_CONTEXT_FIELD_KEYS = [
  'bookingNumber',
  'customerName',
  'customerNumber',
  'driverName',
  'driverMobileNumber',
  'totalCharges',
  'balanceAmount',
  'paymentMode',
] as const satisfies readonly (keyof CallContext)[];
