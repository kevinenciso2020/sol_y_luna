/** Browser cart client. Signed-in users go through apiFetch (Bearer); guests use the cart cookie. */
import { ApiError, apiFetch } from './auth-client';

export interface CartLine {
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  variantName: string;
  sku: string;
  image: { publicId: string; alt: string } | null;
  isAdult: boolean;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  priceTier: 'RETAIL' | 'WHOLESALE';
  available: number;
  issue: 'UNAVAILABLE' | 'NOT_ENOUGH_STOCK' | null;
}

export interface Cart {
  lines: CartLine[];
  itemCount: number;
  totals: {
    subtotal: number;
    discount: number;
    shipping: number;
    total: number;
    priceTier: string;
  };
  coupon: { code: string; ok: boolean; message: string | null } | null;
  canCheckout: boolean;
}

export const isSignedIn = () =>
  typeof document !== 'undefined' && /(?:^|;\s*)syl_auth=1/.test(document.cookie);

async function guestFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: {
        message?: string;
        code?: string;
        details?: { path: (string | number)[]; message: string }[];
      };
    };
    throw new ApiError(
      res.status,
      data.error?.message ?? 'Algo salió mal. Intenta de nuevo.',
      data.error?.code ?? 'ERROR',
      data.error?.details ?? [],
    );
  }
  return (await res.json()) as T;
}

export const shopFetch = <T>(path: string, init: RequestInit = {}) =>
  isSignedIn() ? apiFetch<T>(path, init) : guestFetch<T>(path, init);

export const cartApi = {
  get: (coupon?: string) =>
    shopFetch<{ data: Cart }>(
      `/api/cart${coupon ? `?coupon=${encodeURIComponent(coupon)}` : ''}`,
    ).then((r) => r.data),
  add: (variantId: string, quantity: number) =>
    shopFetch<{ data: Cart }>('/api/cart/items', {
      method: 'POST',
      body: JSON.stringify({ variantId, quantity }),
    }).then((r) => r.data),
  setQuantity: (variantId: string, quantity: number) =>
    shopFetch<{ data: Cart }>(`/api/cart/items/${variantId}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity }),
    }).then((r) => r.data),
  remove: (variantId: string) =>
    shopFetch<{ data: Cart }>(`/api/cart/items/${variantId}`, { method: 'DELETE' }).then(
      (r) => r.data,
    ),
};

/** Updates every cart badge on the page (header). */
export function setCartCount(count: number) {
  document.querySelectorAll<HTMLElement>('[data-cart-count]').forEach((el) => {
    el.textContent = String(count);
    el.hidden = count === 0;
  });
  document.querySelectorAll<HTMLElement>('[data-cart-label]').forEach((el) => {
    el.textContent = count === 1 ? 'Carrito, 1 producto' : `Carrito, ${count} productos`;
  });
}
