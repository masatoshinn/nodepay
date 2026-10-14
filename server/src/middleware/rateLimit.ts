import { rateLimit } from 'express-rate-limit';
import { isProd } from '../config.js';

export const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: isProd ? 300 : 2000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests' },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many auth attempts, try again later' },
});

export const checkoutLimiter = rateLimit({
  windowMs: 60_000,
  limit: 240, // polling friendly
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests' },
});
