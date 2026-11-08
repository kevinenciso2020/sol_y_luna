import type { Logger } from '../lib/logger.js';

export interface TurnstileVerifier {
  /** True when the token is valid, or when Turnstile is disabled (no secret outside production). */
  verify(token: string | undefined, ip: string): Promise<boolean>;
}

export function createTurnstileVerifier(options: {
  secret?: string | undefined;
  logger: Logger;
}): TurnstileVerifier {
  const { secret, logger } = options;
  if (!secret) {
    return { verify: async () => true };
  }
  return {
    async verify(token, ip) {
      if (!token) return false;
      try {
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          body: new URLSearchParams({ secret, response: token, remoteip: ip }),
          signal: AbortSignal.timeout(8_000),
        });
        const data = (await response.json()) as { success?: boolean; 'error-codes'?: string[] };
        if (!data.success) logger.warn({ codes: data['error-codes'] }, 'turnstile rechazado');
        return data.success === true;
      } catch (error) {
        logger.error({ err: error }, 'turnstile no respondió');
        return false;
      }
    },
  };
}
