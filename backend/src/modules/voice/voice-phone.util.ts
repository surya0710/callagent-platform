export function normalizeVoicePhoneNumber(
  input: string | undefined,
): string | undefined {
  if (!input) {
    return undefined;
  }

  let digits = input.replace(/\D/g, '');
  if (digits.length === 0) {
    return undefined;
  }

  // Exotel often sends Indian mobiles as 0XXXXXXXXXX (11 digits).
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (digits.length === 10) {
    return `91${digits}`;
  }

  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }

  return digits;
}
