import type { Logger } from '../lib/logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Demo / development: writes emails to the log instead of sending them. */
export function createLogEmailSender(logger: Logger): EmailSender {
  return {
    async send(message) {
      logger.info(
        { email: { to: message.to, subject: message.subject, text: message.text } },
        'email (modo demo: no se envió, solo se registra)',
      );
    },
  };
}

export function createResendEmailSender(options: {
  apiKey: string;
  from: string;
  logger: Logger;
}): EmailSender {
  return {
    async send(message) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: options.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        options.logger.error(
          { status: response.status, subject: message.subject },
          'Resend rechazó el email',
        );
        throw new Error(`Resend error ${response.status}`);
      }
    },
  };
}

/** Records sent emails in memory (tests). */
export function createMemoryEmailSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
