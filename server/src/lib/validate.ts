import type { Request, Response, NextFunction } from 'express';
import type { AnyZodObject, ZodTypeAny } from 'zod';

/** validate req.body against a zod schema */
export const validateBody =
  (schema: ZodTypeAny) =>
  (req: Request, _res: Response, next: NextFunction) => {
    req.body = schema.parse(req.body ?? {});
    next();
  };

export const validateQuery = (schema: AnyZodObject) => (req: Request, _res: Response, next: NextFunction) => {
  const parsed = schema.parse(req.query);
  (req as Request & { validQuery: unknown }).validQuery = parsed;
  next();
};

export function getQuery<T>(req: Request): T {
  return (req as Request & { validQuery: T }).validQuery;
}
