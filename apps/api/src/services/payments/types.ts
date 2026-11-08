import type {
  PaymentProvider as ProviderId,
  PaymentStatus,
} from '../../generated/prisma/client.js';

export interface CheckoutRequest {
  reference: string;
  orderNumber: string;
  amount: number; // integer COP
  commission: number; // integer COP (Mercado Pago marketplace_fee)
  customer: { email: string; name: string; phone: string };
  resultUrl: string; // where the gateway sends the buyer back
}

/** A verified, normalized payment notification. Amount is integer COP as the gateway reported it. */
export interface PaymentEvent {
  provider: ProviderId;
  externalEventId: string;
  reference: string;
  externalPaymentId: string | null;
  status: PaymentStatus;
  amount: number | null;
  feeAmount: number | null;
  raw: unknown;
}

export interface PaymentProvider {
  id: ProviderId;
  createCheckout(request: CheckoutRequest): Promise<{ redirectUrl: string }>;
}

export class InvalidSignatureError extends Error {
  constructor(message = 'Firma inválida') {
    super(message);
    this.name = 'InvalidSignatureError';
  }
}
