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
