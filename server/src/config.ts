import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),

  // AES-256-GCM key for encrypting webhook secrets / TOTP seeds (32 bytes hex)
  ENCRYPTION_KEY: z.string().min(32),
  APP_URL: z.string().default('http://localhost:5173'),
  API_URL: z.string().default('http://localhost:4000'),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // Explorer provider keys (swap providers via base-url envs)
  ETHERSCAN_API_KEY: z.string().optional().default(''),
  BSCSCAN_API_KEY: z.string().optional().default(''),
  TRONGRID_API_KEY: z.string().optional().default(''),
  MEMPOOL_SPACE_URL: z.string().default('https://mempool.space/api'),
  ETHERSCAN_API_BASE: z.string().default('https://api.etherscan.io/v2/api'),
  ETHERSCAN_CHAIN_ID: z.coerce.number().default(1),
  BSCSCAN_API_BASE: z.string().default('https://api.bscscan.com/api'),
  TRONGRID_API_BASE: z.string().default('https://api.trongrid.io'),
  COINGECKO_API_BASE: z.string().default('https://api.coingecko.com/api/v3'),

  // Invoice defaults
  INVOICE_TTL_MINUTES: z.coerce.number().default(30),
  SCAN_INTERVAL_MS: z.coerce.number().default(15000),
  BTC_SCAN_INTERVAL_MS: z.coerce.number().default(60000),

  // Fee plans (Option B: accrue % per confirmed invoice)
  FREE_PLAN_FEE_BPS: z.coerce.number().default(100),
  PRO_PLAN_FEE_BPS: z.coerce.number().default(0),

  // When true, seed a demo admin on boot (see prisma/seed.ts)
  ADMIN_EMAIL: z.string().default('admin@nodepay.local'),
  ADMIN_PASSWORD: z.string().default(''),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';

export const networks: { network: string; confirmations: number }[] = [
  { network: 'BTC', confirmations: 2 },
  { network: 'LTC', confirmations: 6 },
  { network: 'ETH', confirmations: 12 },
  { network: 'BSC', confirmations: 15 },
  { network: 'TRON', confirmations: 19 },
];

export const confirmationsFor = (network: string): number =>
  networks.find((n) => n.network === network)?.confirmations ?? 2;
