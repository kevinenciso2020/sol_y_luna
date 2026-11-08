/**
 * Server-side client for the public catalog. Pages call the API directly (API_INTERNAL_URL),
 * server to server; the browser never needs these requests.
 */
import { API_INTERNAL_URL } from 'astro:env/server';

export interface ProductCard {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  brand: { name: string; slug: string } | null;
  category: { name: string; slug: string } | null;
  audience: 'HIM' | 'HER' | 'UNISEX';
  isAdult: boolean;
  invimaStatus: string;
  invimaCode: string | null;
  featured: boolean;
  price: number;
  compareAtPrice: number | null;
  variantCount: number;
  inStock: boolean;
  image: { publicId: string; alt: string } | null;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ProductDetail extends Omit<
  ProductCard,
  'price' | 'compareAtPrice' | 'variantCount' | 'inStock' | 'image' | 'featured'
> {
  description: string | null;
  benefits: string[];
  usage: string | null;
  ingredients: string | null;
  warnings: string | null;
  disclaimer: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  images: { id: string; publicId: string; alt: string; variantId: string | null }[];
  variants: {
    id: string;
    name: string;
    sku: string;
    retailPrice: number;
    compareAtPrice: number | null;
    wholesalePrice: number | null;
    wholesaleMinQty: number | null;
    available: number;
  }[];
  related: ProductCard[];
  rating: { average: number; count: number } | null;
}

export interface PublicReview {
  id: string;
  rating: number;
  title: string | null;
  comment: string | null;
  authorName: string;
  verified: boolean;
  createdAt: string;
}

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  isAdult: boolean;
  productCount: number;
  children: CategoryNode[];
}

export interface Brand {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  description: string | null;
  theme: {
    mode?: string;
    style?: string;
    background?: string;
    accent?: string;
    accent2?: string;
  } | null;
  productCount?: number;
}

export interface PublicSettings {
  storeName: string;
  whatsappNumber: string | null;
  contactEmail: string | null;
  instagramUrl: string | null;
}

export class NotFoundError extends Error {}

async function get<T>(path: string, search?: URLSearchParams): Promise<T> {
  const url = new URL(`/api/catalog${path}`, API_INTERNAL_URL);
  if (search) url.search = search.toString();
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json' },
  });
  if (res.status === 404) throw new NotFoundError(path);
  if (!res.ok) throw new Error(`API ${res.status} en ${path}`);
  return (await res.json()) as T;
}

export const catalog = {
  products: (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params))
      if (v !== undefined && v !== '') search.set(k, String(v));
    return get<{ data: ProductCard[]; meta: PageMeta }>('/products', search);
  },
  product: async (slug: string) =>
    (await get<{ data: ProductDetail }>(`/products/${encodeURIComponent(slug)}`)).data,
  reviews: (slug: string, page = 1) =>
    get<{
      data: PublicReview[];
      meta: { page: number; count: number; totalPages: number; average: number | null };
    }>(
      `/products/${encodeURIComponent(slug)}/reviews`,
      new URLSearchParams({ page: String(page) }),
    ),
  categories: async () => (await get<{ data: CategoryNode[] }>('/categories')).data,
  brands: async () => (await get<{ data: Brand[] }>('/brands')).data,
  brand: async (slug: string) =>
    (await get<{ data: Brand }>(`/brands/${encodeURIComponent(slug)}`)).data,
  settings: async () => (await get<{ data: PublicSettings }>('/settings')).data,
  legal: async (key: string) =>
    (await get<{ data: { key: string; content: string } }>(`/legal/${key}`)).data,
};

/** Flattens the category tree, keeping the parent for breadcrumbs. */
export function flattenCategories(
  tree: CategoryNode[],
  parent: CategoryNode | null = null,
): (CategoryNode & { parent: CategoryNode | null })[] {
  return tree.flatMap((node) => [{ ...node, parent }, ...flattenCategories(node.children, node)]);
}

export const AUDIENCE_CHIP: Record<string, string> = { HIM: 'PARA ÉL', HER: 'PARA ELLA' };

/** Chip shown on cards: audience first ("PARA ÉL"), else the category name in caps. */
export function chipFor(p: Pick<ProductCard, 'audience' | 'category'>): string | null {
  return (
    AUDIENCE_CHIP[p.audience] ?? p.category?.name.replace(/\s*\(\+18\)/, '').toUpperCase() ?? null
  );
}
