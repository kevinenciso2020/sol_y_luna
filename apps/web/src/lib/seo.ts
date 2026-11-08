export const SITE_NAME = 'Sol y Luna Store';
export const DEFAULT_DESCRIPTION =
  'Suplementos, cuidado íntimo, skincare y bienestar importados. Envío gratis a toda Colombia y empaque discreto.';

/** Serializes JSON-LD safely inside a <script> tag. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function absoluteUrl(path: string, site: URL | undefined): string {
  return new URL(path, site ?? 'http://localhost:4321').toString();
}
