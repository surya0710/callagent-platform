export interface CallContext {
  bookingNumber?: string;
  customerName?: string;
  customerNumber?: string;
  driverName?: string;
  driverMobileNumber?: string;
  productType?: string;
  city?: string;
  zone?: string;
  package?: string;
  endTime?: string;
  totalCharges?: number;
  balanceAmount?: number;
  paymentMode?: string;
  runningKms?: number;
  overtimeMinutes?: number;
  overtimeCharges?: number;
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
  'productType',
  'city',
  'zone',
  'package',
  'endTime',
  'totalCharges',
  'balanceAmount',
  'paymentMode',
  'runningKms',
  'overtimeMinutes',
  'overtimeCharges',
] as const satisfies readonly (keyof CallContext)[];
