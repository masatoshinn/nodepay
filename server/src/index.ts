import 'dotenv/config';
import { createApp } from './app.js';
import { env } from './config.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`[api] NodePay API listening on http://localhost:${env.PORT}`);
  console.log(`[api] health: http://localhost:${env.PORT}/api/health`);
});

const shutdown = () => {
  console.log('[api] shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
