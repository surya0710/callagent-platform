export function normalizeVoicePhoneNumber(
  input: string | undefined,
): string | undefined {
  if (!input) {
    return undefined;
  }

  const digits = input.replace(/\D/g, '');
  if (digits.length === 0) {
    return undefined;
  }

  if (digits.length === 10) {
    return `91${digits}`;
  }

  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }

  return digits;
}
