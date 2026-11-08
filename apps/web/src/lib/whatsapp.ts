/** Builds a wa.me link, or null when no number is configured (button hidden). */
export function whatsappLink(rawNumber: string | undefined, message?: string): string | null {
  const digits = (rawNumber ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const query = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${digits}${query}`;
}
