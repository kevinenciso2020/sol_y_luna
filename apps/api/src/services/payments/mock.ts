import type { PaymentProvider } from './types.js';

/**
 * Demo provider: sends the buyer to a simulated payment page where they choose approve, decline or
 * leave pending. The choice goes through the same internal flow as a real webhook.
 */
export function createMockProvider(webUrl: string): PaymentProvider {
  return {
    id: 'MOCK',
    async createCheckout(request) {
      const url = new URL('/pago/simulado', webUrl);
      url.searchParams.set('ref', request.reference);
      return { redirectUrl: url.toString() };
    },
  };
}
