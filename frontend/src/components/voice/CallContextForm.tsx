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
  productType: '',
  city: '',
  zone: '',
  package: '',
  endTime: '',
  totalCharges: '',
  balanceAmount: '',
  paymentMode: '',
  runningKms: '',
  overtimeMinutes: '',
  overtimeCharges: '',
});

const CUSTOMER_FIRST_NAMES = [
  'Rahul',
  'Priya',
  'Amit',
  'Neha',
  'Vikram',
  'Ananya',
  'Arjun',
  'Kavya',
];
const CUSTOMER_LAST_NAMES = [
  'Sharma',
  'Patel',
  'Singh',
  'Gupta',
  'Reddy',
  'Iyer',
  'Mehta',
  'Khan',
];
const DRIVER_FIRST_NAMES = ['Rajesh', 'Suresh', 'Manoj', 'Deepak', 'Sanjay'];
const DRIVER_LAST_NAMES = ['Kumar', 'Yadav', 'Verma', 'Das', 'Nair'];
const CITIES = ['Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Pune', 'Chennai'];
const ZONES: Record<string, string[]> = {
  Mumbai: ['South Mumbai', 'Bandra', 'Andheri', 'Powai'],
  Delhi: ['Connaught Place', 'Dwarka', 'Gurgaon', 'Noida'],
  Bengaluru: ['Indiranagar', 'Whitefield', 'Koramangala', 'Electronic City'],
  Hyderabad: ['Hitech City', 'Banjara Hills', 'Gachibowli', 'Secunderabad'],
  Pune: ['Koregaon Park', 'Hinjewadi', 'Kothrud', 'Viman Nagar'],
  Chennai: ['T Nagar', 'Adyar', 'OMR', 'Anna Nagar'],
};
const PRODUCT_TYPES = [
  'Airport transfer',
  'Local rental',
  'Outstation trip',
  'Corporate pickup',
];
const PACKAGES = [
  '4 hours / 40 km',
  '8 hours / 80 km',
  '12 hours / 120 km',
  'Airport drop — fixed',
];
const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Corporate billing'];

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

function randomEndTime(): string {
  const date = new Date();
  date.setHours(randomInt(9, 22), pickRandom([0, 15, 30, 45]), 0, 0);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/** Temporary dev helper — pre-fills call context with random sample data. */
export function randomCallContextForm(): CallContextFormValues {
  const city = pickRandom(CITIES);
  const totalCharges = randomInt(1500, 6000);
  const balanceAmount = randomInt(0, Math.min(1500, totalCharges));
  const overtimeMinutes = randomInt(0, 90);
  const overtimeCharges =
    overtimeMinutes > 0 ? randomInt(100, Math.max(100, overtimeMinutes * 12)) : 0;

  return {
    bookingNumber: `BK${randomInt(1000, 9999)}`,
    customerName: `${pickRandom(CUSTOMER_FIRST_NAMES)} ${pickRandom(CUSTOMER_LAST_NAMES)}`,
    customerNumber: randomMobile(),
    driverName: `${pickRandom(DRIVER_FIRST_NAMES)} ${pickRandom(DRIVER_LAST_NAMES)}`,
    driverMobileNumber: randomMobile(),
    productType: pickRandom(PRODUCT_TYPES),
    city,
    zone: pickRandom(ZONES[city] ?? ['Central']),
    package: pickRandom(PACKAGES),
    endTime: randomEndTime(),
    totalCharges: String(totalCharges),
    balanceAmount: String(balanceAmount),
    paymentMode: pickRandom(PAYMENT_MODES),
    runningKms: String(randomInt(15, 120)),
    overtimeMinutes: String(overtimeMinutes),
    overtimeCharges: String(overtimeCharges),
  };
}

const TEXT_FIELDS: Array<{
  key: keyof VoiceCallContext;
  label: string;
  placeholder?: string;
}> = [
  { key: 'bookingNumber', label: 'Booking number', placeholder: 'BK1234' },
  { key: 'customerName', label: 'Customer name', placeholder: 'Rahul Sharma' },
  { key: 'customerNumber', label: 'Customer number', placeholder: '9876543210' },
  { key: 'driverName', label: 'Driver name', placeholder: 'Rajesh Kumar' },
  { key: 'driverMobileNumber', label: 'Driver mobile', placeholder: '9876543210' },
  { key: 'productType', label: 'Product type', placeholder: 'Airport transfer' },
  { key: 'city', label: 'City', placeholder: 'Mumbai' },
  { key: 'zone', label: 'Zone', placeholder: 'South Mumbai' },
  { key: 'package', label: 'Package', placeholder: '4 hours / 40 km' },
  { key: 'endTime', label: 'End time', placeholder: '2026-06-24 18:30' },
  { key: 'paymentMode', label: 'Payment mode', placeholder: 'Cash / UPI / Card' },
];

const NUMBER_FIELDS: Array<{
  key: keyof VoiceCallContext;
  label: string;
  placeholder?: string;
}> = [
  { key: 'totalCharges', label: 'Total charges (₹)', placeholder: '2500' },
  { key: 'balanceAmount', label: 'Balance amount (₹)', placeholder: '850' },
  { key: 'runningKms', label: 'Running kms', placeholder: '42' },
  { key: 'overtimeMinutes', label: 'Overtime (minutes)', placeholder: '30' },
  { key: 'overtimeCharges', label: 'Overtime charges (₹)', placeholder: '300' },
];

export function buildCallContextFromForm(
  values: CallContextFormValues,
): VoiceCallContext | undefined {
  const context: VoiceCallContext = {};

  for (const { key } of TEXT_FIELDS) {
    const trimmed = values[key]?.trim();
    if (trimmed) {
      (context as Record<string, string>)[key] = trimmed;
    }
  }

  for (const { key } of NUMBER_FIELDS) {
    const trimmed = values[key]?.trim();
    if (!trimmed) {
      continue;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      (context as Record<string, number>)[key] = parsed;
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
          Booking and customer details injected into the AI for this call only. Leave
          blank fields empty if not needed.
        </p>
      </div>

      <FieldGroup title="Customer & booking">
        {TEXT_FIELDS.slice(0, 3).map(({ key, label, placeholder }) => (
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

      <FieldGroup title="Driver">
        {TEXT_FIELDS.slice(3, 5).map(({ key, label, placeholder }) => (
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

      <FieldGroup title="Trip details">
        {TEXT_FIELDS.slice(5, 10).map(({ key, label, placeholder }) => (
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

      <FieldGroup title="Payment & charges">
        {TEXT_FIELDS.slice(10).map(({ key, label, placeholder }) => (
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
        {NUMBER_FIELDS.map(({ key, label, placeholder }) => (
          <Input
            key={key}
            label={label}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
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
