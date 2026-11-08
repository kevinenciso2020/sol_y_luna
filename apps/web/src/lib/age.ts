/** +18 verification: a cookie set after the visitor states a birth date that makes them an adult. */
export const AGE_COOKIE = 'syl_edad';
export const AGE_COOKIE_MAX_AGE = 30 * 86_400; // 30 days

export function isAgeVerified(cookieValue: string | undefined): boolean {
  return cookieValue === '18';
}

/** Age in whole years on `today` (Colombia), or null when the date is invalid or in the future. */
export function ageFromBirthDate(value: string, today = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const birth = new Date(Date.UTC(y, m - 1, d));
  if (birth.getUTCFullYear() !== y || birth.getUTCMonth() !== m - 1 || birth.getUTCDate() !== d)
    return null;
  if (birth > today || y < 1900) return null;
  let age = today.getUTCFullYear() - y;
  const beforeBirthday =
    today.getUTCMonth() < m - 1 || (today.getUTCMonth() === m - 1 && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}
