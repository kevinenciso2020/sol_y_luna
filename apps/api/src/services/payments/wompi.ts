import { createHash, timingSafeEqual } from 'node:crypto';
import { copToCents } from '@sol-y-luna/shared';
import type { PaymentStatus } from '../../generated/prisma/client.js';
import { InvalidSignatureError, type PaymentEvent, type PaymentProvider } from './types.js';

export interface WompiConfig {
  publicKey: string;
  integritySecret: string;
  eventsSecret: string;
  env: 'sandbox' | 'production';
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Integrity signature for the checkout: SHA256(reference + amountInCents + currency + secret). */
export function wompiIntegritySignature(
  reference: string,
  amountInCents: number,
  currency: string,
  secret: string,
) {
  return sha256(`${reference}${amountInCents}${currency}${secret}`);
}

const STATUS: Record<string, PaymentStatus> = {
  APPROVED: 'APPROVED',
  DECLINED: 'DECLINED',
  VOIDED: 'VOIDED',
  ERROR: 'ERROR',
  PENDING: 'PENDING',
};

const valueAt = (data: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined,
      data,
    );

/**
 * Verifies a Wompi event: SHA256 of the values named in signature.properties (in order, read from
 * `data`), then the timestamp, then the events secret. Constant-time comparison.
 */
export function verifyWompiEvent(body: unknown, eventsSecret: string): PaymentEvent {
  if (!body || typeof body !== 'object') throw new InvalidSignatureError('Evento vacío');
  const event = body as {
    event?: string;
    data?: { transaction?: Record<string, unknown> };
    signature?: { properties?: unknown; checksum?: unknown };
    timestamp?: unknown;
  };
  const properties = event.signature?.properties;
  const checksum = event.signature?.checksum;
  if (
    !Array.isArray(properties) ||
    properties.some((p) => typeof p !== 'string') ||
    typeof checksum !== 'string'
  ) {
    throw new InvalidSignatureError('Evento sin firma');
  }
  if (typeof event.timestamp !== 'number' && typeof event.timestamp !== 'string')
    throw new InvalidSignatureError('Evento sin timestamp');

  const concatenated = (properties as string[])
    .map((p) => String(valueAt(event.data, p) ?? ''))
    .join('');
  const expected = Buffer.from(sha256(`${concatenated}${event.timestamp}${eventsSecret}`), 'hex');
  const received = Buffer.from(checksum.toLowerCase(), 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new InvalidSignatureError();
  }

  const tx = event.data?.transaction;
  if (
    event.event !== 'transaction.updated' ||
    !tx ||
    typeof tx['reference'] !== 'string' ||
    typeof tx['id'] !== 'string'
  ) {
    throw new InvalidSignatureError('Evento no soportado');
  }
  const status = STATUS[String(tx['status'])] ?? 'PENDING';
  const cents = Number(tx['amount_in_cents']);
  return {
    provider: 'WOMPI',
    externalEventId: `${tx['id']}:${String(tx['status'])}`,
    reference: tx['reference'],
    externalPaymentId: tx['id'],
    status,
    // A non-integer peso amount can never match an order total, so it ends in review.
    amount: Number.isFinite(cents) ? cents / 100 : null,
    feeAmount: null,
    raw: body,
  };
}

export function createWompiProvider(config: WompiConfig): PaymentProvider {
  return {
    id: 'WOMPI',
    async createCheckout(request) {
      const amountInCents = copToCents(request.amount);
      const url = new URL('https://checkout.wompi.co/p/');
      url.searchParams.set('public-key', config.publicKey);
      url.searchParams.set('currency', 'COP');
      url.searchParams.set('amount-in-cents', String(amountInCents));
      url.searchParams.set('reference', request.reference);
      url.searchParams.set(
        'signature:integrity',
        wompiIntegritySignature(request.reference, amountInCents, 'COP', config.integritySecret),
      );
      url.searchParams.set('redirect-url', request.resultUrl);
      url.searchParams.set('customer-data:email', request.customer.email);
      url.searchParams.set('customer-data:full-name', request.customer.name);
      url.searchParams.set(
        'customer-data:phone-number',
        request.customer.phone.replace(/\D/g, '').slice(-10),
      );
      return { redirectUrl: url.toString() };
    },
  };
}
