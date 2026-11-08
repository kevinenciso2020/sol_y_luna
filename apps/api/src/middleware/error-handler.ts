import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/http-error.js';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND'));
};

/** Centralized error handler: never leaks stack traces in production, always returns the request id. */
export function createErrorHandler(options: { exposeStack: boolean }): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    const requestId = String(req.id ?? '');

    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Datos inválidos',
          details: err.issues.map((issue) => ({ path: issue.path, message: issue.message })),
          requestId,
        },
      });
      return;
    }

    // body-parser errors (payload too large, invalid JSON) carry a status
    const status =
      err instanceof HttpError
        ? err.status
        : typeof err === 'object' &&
            err !== null &&
            'status' in err &&
            typeof err.status === 'number'
          ? err.status
          : 500;

    if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
    }

    const message =
      err instanceof HttpError
        ? err.message
        : status === 413
          ? 'La petición es demasiado grande'
          : status === 400
            ? 'Petición inválida'
            : 'Error interno del servidor';

    res.status(status).json({
      error: {
        code:
          err instanceof HttpError ? err.code : status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
        message,
        ...(err instanceof HttpError && err.details !== undefined ? { details: err.details } : {}),
        requestId,
        ...(options.exposeStack && status >= 500 && err instanceof Error
          ? { stack: err.stack }
          : {}),
      },
    });
  };
}
