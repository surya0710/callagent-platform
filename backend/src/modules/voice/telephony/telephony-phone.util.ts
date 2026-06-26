/**
 * Exotel connect API expects a 10-digit Indian mobile in `From` for most accounts.
 */
export function toExotelCustomerNumber(normalizedCustomerNumber: string): string {
  const trimmed = normalizedCustomerNumber.trim();

  if (trimmed.length === 12 && trimmed.startsWith('91')) {
    return trimmed.slice(2);
  }

  return trimmed;
}
