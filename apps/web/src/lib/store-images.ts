import { imageSrcSet, imageUrl } from './images';

/**
 * Inside the store's circle composition, local placeholders use the transparent silhouette version
 * (the full placeholder already draws its own circle).
 */
export function productImage(publicId: string | null | undefined, width: number) {
  const id = publicId ?? '/placeholders/frasco.svg';
  const placeholder = id.match(/^\/placeholders\/([a-z0-9-]+)\.svg$/);
  if (placeholder) return { src: `/placeholders/solo/${placeholder[1]}.svg`, srcset: undefined };
  return { src: imageUrl(id, width), srcset: imageSrcSet(id) };
}
