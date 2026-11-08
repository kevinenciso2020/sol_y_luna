import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
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

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = mapPrismaError(err);
      if (mapped) {
        res.status(mapped.status).json({ error: { ...mapped.body, requestId } });
        return;
      }
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

const UNIQUE_FIELD_MESSAGES: Record<string, string> = {
  slug: 'Ya existe un registro con ese slug',
  sku: 'Ya existe una presentación con ese SKU',
  code: 'Ya existe un cupón con ese código',
  email: 'Ya existe un usuario con ese correo',
};

/** Translates the Prisma errors a client can cause into clear 4xx answers (never leaks SQL). */
function mapPrismaError(err: Prisma.PrismaClientKnownRequestError) {
  if (err.code === 'P2002') {
    const meta = err.meta as
      | {
          target?: string[] | string;
          driverAdapterError?: { cause?: { constraint?: { fields?: string[]; index?: string } } };
        }
      | undefined;
    const constraint = meta?.driverAdapterError?.cause?.constraint;
    // With driver adapters Prisma reports the index name, e.g. "Brand_slug_key".
    const fromIndex = constraint?.index?.match(/^[A-Za-z]+_(.+)_key$/)?.[1]?.split('_') ?? [];
    const fields = [
      ...(Array.isArray(meta?.target) ? meta.target : meta?.target ? [meta.target] : []),
      ...(constraint?.fields ?? []),
      ...fromIndex,
    ].map((f) => f.replace(/"/g, ''));
    const field = fields.find((f) => f in UNIQUE_FIELD_MESSAGES);
    const message = field ? UNIQUE_FIELD_MESSAGES[field]! : 'Ya existe un registro con esos datos';
    return {
      status: 409,
      body: {
        code: 'CONFLICT',
        message,
        ...(field ? { details: [{ path: [field], message }] } : {}),
      },
    };
  }
  if (err.code === 'P2025') {
    return { status: 404, body: { code: 'NOT_FOUND', message: 'Recurso no encontrado' } };
  }
  if (err.code === 'P2003') {
    return {
      status: 400,
      body: { code: 'INVALID_REFERENCE', message: 'Uno de los datos relacionados no existe' },
    };
  }
  return null;
}
