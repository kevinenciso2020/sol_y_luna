/** Server-side order lookups for the payment pages, forwarding the visitor's order cookie to the API. */
import { API_INTERNAL_URL } from 'astro:env/server';

export interface OrderDto {
  number: string;
  status: string;
  createdAt: string;
  email: string;
  customerName: string;
  shipping: {
    recipientName: string;
    department: string;
    municipality: string;
    addressLine: string;
  };
  discreetPackaging: boolean;
  subtotal: number;
  discount: number;
  total: number;
  couponCode: string | null;
  paymentProvider: string | null;
  reservationExpiresAt: string | null;
  needsReview: boolean;
  items: {
    productName: string;
    variantName: string;
    quantity: number;
    lineTotal: number;
    unitPrice: number;
  }[];
}

export interface PaymentLookup {
  reference: string;
  paymentStatus: string;
  provider: string;
  order: OrderDto;
}

export const REFERENCE_PATTERN = /^SYL-\d{6,}-[A-Z0-9]{1,10}$/;

export async function lookupPayment(
  reference: string | null,
  cookie: string | null,
): Promise<PaymentLookup | null> {
  if (!reference || !REFERENCE_PATTERN.test(reference)) return null;
  const res = await fetch(
    new URL(`/api/payments/${encodeURIComponent(reference)}`, API_INTERNAL_URL),
    {
      headers: cookie ? { cookie } : {},
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) return null;
  return ((await res.json()) as { data: PaymentLookup }).data;
}

export function resultPathFor(lookup: PaymentLookup): string {
  const ref = encodeURIComponent(lookup.reference);
  if (lookup.order.status === 'PAYMENT_FAILED' || lookup.order.status === 'CANCELLED')
    return `/pago/rechazado?ref=${ref}`;
  if (lookup.order.status === 'PENDING_PAYMENT') return `/pago/pendiente?ref=${ref}`;
  return `/pago/aprobado?ref=${ref}`;
}
