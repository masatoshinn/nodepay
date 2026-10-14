import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { walletsRouter } from './routes/wallets.js';
import { apiKeysRouter } from './routes/apiKeys.js';
import { webhooksRouter } from './routes/webhooks.js';
import { invoicesRouter, paymentsRouter } from './routes/invoices.js';
import { statsRouter } from './routes/stats.js';
import { adminRouter } from './routes/admin.js';
import { v1Router } from './routes/v1.js';
import { publicRouter } from './routes/public.js';
import { prisma } from './lib/prisma.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(globalLimiter);

  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, env: env.NODE_ENV, time: new Date().toISOString() });
    } catch (e) {
      res.status(503).json({ ok: false, error: (e as Error).message });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/wallets', walletsRouter);
  app.use('/api/api-keys', apiKeysRouter);
  app.use('/api/webhooks', webhooksRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/v1', v1Router);
  app.use('/api/public', publicRouter);

  app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Route not found' }));
  app.use(errorHandler);

  return app;
}
