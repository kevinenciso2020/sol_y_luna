import { pino, type LoggerOptions } from 'pino';

/** Fields that must never reach the logs. */
const REDACT_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'refreshToken',
  '*.refreshToken',
  'accessToken',
  '*.accessToken',
  'document',
  '*.document',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export function createLogger(options: { level: string; pretty: boolean }) {
  const config: LoggerOptions = {
    level: options.level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };
  if (options.pretty) {
    config.transport = { target: 'pino-pretty', options: { colorize: true } };
  }
  return pino(config);
}

export type Logger = ReturnType<typeof createLogger>;
