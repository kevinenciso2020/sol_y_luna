import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentStatus } from '../../generated/prisma/client.js';
import type { Encryptor } from '../../lib/encryption.js';
import { HttpError } from '../../lib/http-error.js';
import type { Logger } from '../../lib/logger.js';
import type { Db } from '../../lib/prisma.js';
import { InvalidSignatureError, type PaymentEvent, type PaymentProvider } from './types.js';

const API = 'https://api.mercadopago.com';

export interface MercadoPagoConfig {
  mode: 'marketplace' | 'direct';
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  accessToken?: string | undefined; // direct mode
  webhookSecret: string;
  redirectUri?: string | undefined;
  apiUrl: string; // our API, for notification_url
}

/**
 * Verifies the `x-signature` header (ts=...,v1=...): HMAC-SHA256 over
 * "id:{data.id};request-id:{x-request-id};ts:{ts};" with the webhook secret. Constant time.
 */
export function verifyMercadoPagoSignature(input: {
  signatureHeader: string | undefined;
  requestId: string | undefined;
  dataId: string | undefined;
  secret: string;
}) {
  const parts = Object.fromEntries(
    (input.signatureHeader ?? '').split(',').map((part) => {
      const [k, ...v] = part.trim().split('=');
      return [k ?? '', v.join('=')];
    }),
  );
  const ts = parts['ts'];
  const v1 = parts['v1'];
  if (!ts || !v1 || !input.dataId || !input.requestId)
    throw new InvalidSignatureError('Notificación sin firma');
  // Alphanumeric ids must be lower-cased, per Mercado Pago's docs.
  const id = /^[a-z0-9]+$/i.test(input.dataId) ? input.dataId.toLowerCase() : input.dataId;
  const manifest = `id:${id};request-id:${input.requestId};ts:${ts};`;
  const expected = Buffer.from(
    createHmac('sha256', input.secret).update(manifest).digest('hex'),
    'hex',
  );
  const received = Buffer.from(v1, 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new InvalidSignatureError();
}

const STATUS: Record<string, PaymentStatus> = {
  approved: 'APPROVED',
  rejected: 'DECLINED',
  cancelled: 'VOIDED',
  refunded: 'REFUNDED',
  charged_back: 'REFUNDED',
  pending: 'PENDING',
  in_process: 'PENDING',
  authorized: 'PENDING',
  in_mediation: 'PENDING',
};

export function createMercadoPago(deps: {
  config: MercadoPagoConfig;
  db: Db;
  encryptor: Encryptor;
  logger: Logger;
  fetchImpl?: typeof fetch;
}) {
  const { config, db, encryptor, logger } = deps;
  const http = deps.fetchImpl ?? fetch;

  async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
    const res = await http(`${API}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logger.error({ status: res.status, path }, 'Mercado Pago respondió con error');
      throw new HttpError(
        502,
        'Mercado Pago no respondió. Intenta de nuevo o elige otro medio de pago.',
        'UPSTREAM_ERROR',
      );
    }
    return (await res.json()) as T;
  }

  /** Merchant token: direct mode uses MP_ACCESS_TOKEN; marketplace uses the OAuth token, refreshed when close to expiring. */
  async function merchantToken(): Promise<string> {
    if (config.mode === 'direct') {
      if (!config.accessToken)
        throw new HttpError(503, 'Mercado Pago no está configurado', 'PROVIDER_DISABLED');
      return config.accessToken;
    }
    const account = await db.paymentAccount.findUnique({ where: { provider: 'MERCADOPAGO' } });
    if (!account)
      throw new HttpError(
        503,
        'El comercio todavía no conectó su cuenta de Mercado Pago',
        'PROVIDER_DISABLED',
      );
    const expiresSoon =
      account.expiresAt !== null && account.expiresAt.getTime() - Date.now() < 86_400_000;
    if (expiresSoon && account.refreshTokenEncrypted) {
      const refreshed = await call<OAuthTokenResponse>('/oauth/token', {
        method: 'POST',
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: encryptor.decrypt(account.refreshTokenEncrypted),
        }),
      });
      await saveAccount(refreshed);
      logger.info('token de Mercado Pago renovado');
      return refreshed.access_token;
    }
    return encryptor.decrypt(account.accessTokenEncrypted);
  }

  interface OAuthTokenResponse {
    access_token: string;
    refresh_token?: string;
    public_key?: string;
    user_id?: number | string;
    expires_in?: number;
    scope?: string;
  }

  async function saveAccount(token: OAuthTokenResponse) {
    const data = {
      accessTokenEncrypted: encryptor.encrypt(token.access_token),
      refreshTokenEncrypted: token.refresh_token ? encryptor.encrypt(token.refresh_token) : null,
      publicKey: token.public_key ?? null,
      externalUserId: token.user_id !== undefined ? String(token.user_id) : null,
      scope: token.scope ?? null,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
    };
    await db.paymentAccount.upsert({
      where: { provider: 'MERCADOPAGO' },
      update: data,
      create: { provider: 'MERCADOPAGO', ...data },
    });
  }

  const provider: PaymentProvider = {
    id: 'MERCADOPAGO',
    async createCheckout(request) {
      const token = await merchantToken();
      const preference = await call<{ init_point: string }>('/checkout/preferences', {
        method: 'POST',
        token,
        body: JSON.stringify({
          items: [
            {
              id: request.orderNumber,
              title: `Pedido ${request.orderNumber} · Sol y Luna Store`,
              quantity: 1,
              unit_price: request.amount,
              currency_id: 'COP',
            },
          ],
          external_reference: request.reference,
          payer: { email: request.customer.email, name: request.customer.name },
          back_urls: {
            success: request.resultUrl,
            pending: request.resultUrl,
            failure: request.resultUrl,
          },
          auto_return: 'approved',
          notification_url: `${config.apiUrl.replace(/\/$/, '')}/api/webhooks/mercadopago`,
          statement_descriptor: 'SOLYLUNA',
          ...(config.mode === 'marketplace' ? { marketplace_fee: request.commission } : {}),
        }),
      });
      return { redirectUrl: preference.init_point };
    },
  };

  return {
    provider,

    /** Verifies the notification signature, then asks Mercado Pago for the real payment state. */
    async handleNotification(input: {
      signatureHeader: string | undefined;
      requestId: string | undefined;
      dataId: string | undefined;
      type: string | undefined;
    }): Promise<PaymentEvent | null> {
      verifyMercadoPagoSignature({ ...input, secret: config.webhookSecret });
      if (input.type !== 'payment') return null; // merchant_order and others are ignored
      const token = await merchantToken();
      const payment = await call<{
        id: number | string;
        status: string;
        transaction_amount: number;
        external_reference: string | null;
        fee_details?: { type: string; amount: number }[];
      }>(`/v1/payments/${encodeURIComponent(input.dataId!)}`, { token });
      if (!payment.external_reference) return null;
      const fee = (payment.fee_details ?? [])
        .filter((f) => f.type === 'mercadopago_fee')
        .reduce((s, f) => s + f.amount, 0);
      return {
        provider: 'MERCADOPAGO',
        externalEventId: `payment:${payment.id}:${payment.status}`,
        reference: payment.external_reference,
        externalPaymentId: String(payment.id),
        status: STATUS[payment.status] ?? 'PENDING',
        amount: payment.transaction_amount,
        feeAmount: fee ? Math.round(fee) : null,
        raw: payment,
      };
    },

    authorizationUrl(state: string) {
      const url = new URL('https://auth.mercadopago.com/authorization');
      url.searchParams.set('client_id', config.clientId ?? '');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('platform_id', 'mp');
      url.searchParams.set('state', state);
      url.searchParams.set('redirect_uri', config.redirectUri ?? '');
      return url.toString();
    },

    async exchangeCode(code: string) {
      const token = await call<OAuthTokenResponse>('/oauth/token', {
        method: 'POST',
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.redirectUri,
        }),
      });
      await saveAccount(token);
    },
  };
}

export type MercadoPago = ReturnType<typeof createMercadoPago>;
