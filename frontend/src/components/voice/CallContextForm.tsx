import { ReactNode } from 'react';
import { Input } from '../ui/Modal';
import { VoiceCallContext } from '../../types/voice';

export type CallContextFormValues = Record<keyof VoiceCallContext, string>;

export const emptyCallContextForm = (): CallContextFormValues => ({
  bookingNumber: '',
  customerName: '',
  customerNumber: '',
  driverName: '',
  driverMobileNumber: '',
  totalCharges: '',
  balanceAmount: '',
  paymentMode: '',
});

const CUSTOMER_FIELDS: Array<{
  key: keyof VoiceCallContext;
  label: string;
  placeholder?: string;
}> = [
  { key: 'bookingNumber', label: 'Booking number', placeholder: 'BK1234' },
  { key: 'customerName', label: 'Customer name', placeholder: 'Rahul Sharma' },
  { key: 'customerNumber', label: 'Customer mobile', placeholder: '9876543210' },
];

const DRIVER_FIELDS: Array<{
  key: keyof VoiceCallContext;
  label: string;
  placeholder?: string;
}> = [
  { key: 'driverName', label: 'Driver name', placeholder: 'Rajesh Kumar' },
  { key: 'driverMobileNumber', label: 'Driver mobile', placeholder: '9876543210' },
];

const PAYMENT_FIELDS: Array<{
  key: keyof VoiceCallContext;
  label: string;
  placeholder?: string;
  type?: 'text' | 'number';
}> = [
  { key: 'totalCharges', label: 'Total charges (₹)', placeholder: '450', type: 'number' },
  { key: 'balanceAmount', label: 'Balance amount (₹)', placeholder: '150', type: 'number' },
  { key: 'paymentMode', label: 'Payment mode', placeholder: 'Cash / UPI / Card' },
];

const CUSTOMER_FIRST_NAMES = [
  'Rahul',
  'Priya',
  'Amit',
  'Neha',
  'Vikram',
  'Ananya',
];
const CUSTOMER_LAST_NAMES = ['Sharma', 'Patel', 'Singh', 'Gupta', 'Reddy', 'Iyer'];
const DRIVER_FIRST_NAMES = ['Rajesh', 'Suresh', 'Manoj', 'Deepak', 'Sanjay'];
const DRIVER_LAST_NAMES = ['Kumar', 'Yadav', 'Verma', 'Das', 'Nair'];
const PAYMENT_MODES = ['Cash', 'UPI', 'Card'];

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomMobile(): string {
  const firstDigit = pickRandom(['6', '7', '8', '9']);
  return `${firstDigit}${String(randomInt(100000000, 999999999))}`;
}

/** Temporary dev helper — pre-fills call context with random sample data. */
export function randomCallContextForm(): CallContextFormValues {
  const totalCharges = randomInt(200, 1200);
  const balanceAmount = randomInt(0, Math.min(300, totalCharges));

  return {
    bookingNumber: `OD${randomInt(100000, 999999)}`,
    customerName: `${pickRandom(CUSTOMER_FIRST_NAMES)} ${pickRandom(CUSTOMER_LAST_NAMES)}`,
    customerNumber: randomMobile(),
    driverName: `${pickRandom(DRIVER_FIRST_NAMES)} ${pickRandom(DRIVER_LAST_NAMES)}`,
    driverMobileNumber: randomMobile(),
    totalCharges: String(totalCharges),
    balanceAmount: String(balanceAmount),
    paymentMode: pickRandom(PAYMENT_MODES),
  };
}

export function buildCallContextFromForm(
  values: CallContextFormValues,
): VoiceCallContext | undefined {
  const context: VoiceCallContext = {};

  for (const { key } of [...CUSTOMER_FIELDS, ...DRIVER_FIELDS]) {
    const trimmed = values[key]?.trim();
    if (trimmed) {
      (context as Record<string, string>)[key] = trimmed;
    }
  }

  for (const { key, type } of PAYMENT_FIELDS) {
    const trimmed = values[key]?.trim();
    if (!trimmed) {
      continue;
    }
    if (type === 'number') {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        (context as Record<string, number>)[key] = parsed;
      }
    } else {
      (context as Record<string, string>)[key] = trimmed;
    }
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

interface CallContextFormProps {
  values: CallContextFormValues;
  onChange: (values: CallContextFormValues) => void;
  disabled?: boolean;
}

function FieldGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
      <legend className="px-1 text-sm font-medium text-slate-300">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function CallContextForm({
  values,
  onChange,
  disabled = false,
}: CallContextFormProps) {
  const setField = (key: keyof VoiceCallContext, value: string) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-300">Call context (optional)</p>
        <p className="mt-1 text-xs text-slate-500">
          Customer, driver, and payment details for this on-demand ride call.
        </p>
      </div>

      <FieldGroup title="Customer details">
        {CUSTOMER_FIELDS.map(({ key, label, placeholder }) => (
          <Input
            key={key}
            label={label}
            type="text"
            placeholder={placeholder}
            value={values[key]}
            onChange={(event) => setField(key, event.target.value)}
            disabled={disabled}
          />
        ))}
      </FieldGroup>

      <FieldGroup title="Driver details">
        {DRIVER_FIELDS.map(({ key, label, placeholder }) => (
          <Input
            key={key}
            label={label}
            type="text"
            placeholder={placeholder}
            value={values[key]}
            onChange={(event) => setField(key, event.target.value)}
            disabled={disabled}
          />
        ))}
      </FieldGroup>

      <FieldGroup title="Payment details">
        {PAYMENT_FIELDS.map(({ key, label, placeholder, type = 'text' }) => (
          <Input
            key={key}
            label={label}
            type={type}
            inputMode={type === 'number' ? 'decimal' : undefined}
            min={type === 'number' ? 0 : undefined}
            step={type === 'number' ? 'any' : undefined}
            placeholder={placeholder}
            value={values[key]}
            onChange={(event) => setField(key, event.target.value)}
            disabled={disabled}
          />
        ))}
      </FieldGroup>
    </div>
  );
}
