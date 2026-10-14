import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new ApiError(400, msg, 'bad_request', details);
export const unauthorized = (msg = 'Unauthorized') => new ApiError(401, msg, 'unauthorized');
export const forbidden = (msg = 'Forbidden') => new ApiError(403, msg, 'forbidden');
export const notFound = (msg = 'Not found') => new ApiError(404, msg, 'not_found');
export const conflict = (msg: string) => new ApiError(409, msg, 'conflict');
export const tooMany = (msg = 'Too many requests') => new ApiError(429, msg, 'rate_limited');

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** wrap async route handlers so rejections reach the error middleware */
export const h = (fn: AsyncHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'Invalid request',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  console.error('[error]', err);
  return res.status(500).json({ error: 'internal', message: 'Internal server error' });
}
