import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Express 5 forwards rejected promises to the error handler; this keeps handler typing tidy. */
export const handler =
  (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
  ): RequestHandler =>
  async (req, res, next) => {
    await fn(req, res, next);
  };
