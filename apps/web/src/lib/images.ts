import { PUBLIC_CLOUDINARY_CLOUD_NAME } from 'astro:env/client';

export const FALLBACK_IMAGE = '/placeholders/frasco.svg';

/**
 * Resolves a stored image id to a URL. Local placeholders are served as-is; Cloudinary images get
 * f_auto,q_auto and a width so the browser downloads only what it needs.
 */
export function imageUrl(publicId: string | null | undefined, width = 600): string {
  if (!publicId) return FALLBACK_IMAGE;
  if (publicId.startsWith('/')) return publicId;
  if (!PUBLIC_CLOUDINARY_CLOUD_NAME) return FALLBACK_IMAGE;
  const safeId = publicId.split('/').map(encodeURIComponent).join('/');
  return `https://res.cloudinary.com/${PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload/f_auto,q_auto,c_limit,w_${width}/${safeId}`;
}

/** srcset for responsive images (Cloudinary only; placeholders are SVG and scale freely). */
export function imageSrcSet(
  publicId: string | null | undefined,
  widths = [320, 480, 640, 960],
): string | undefined {
  if (!publicId || publicId.startsWith('/') || !PUBLIC_CLOUDINARY_CLOUD_NAME) return undefined;
  return widths.map((w) => `${imageUrl(publicId, w)} ${w}w`).join(', ');
}
