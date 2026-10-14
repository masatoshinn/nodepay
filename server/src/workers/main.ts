import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import { env } from '../config.js';
import { redis } from '../lib/redis.js';
import { scanQueue, maintenanceQueue, webhookQueue } from '../lib/queues.js';
import { processDelivery } from '../lib/webhooks.js';
import { expireDueInvoices } from '../services/invoiceService.js';
import { scanNetwork } from '../watchers/scanner.js';
import type { NetworkName } from '../lib/chains.js';

const connection = () => redis();

async function setupRepeatable() {
  const jobs = await scanQueue.getRepeatableJobs();
  const schedule: { network: NetworkName; every: number }[] = [
    { network: 'ETH', every: env.SCAN_INTERVAL_MS },
    { network: 'BSC', every: env.SCAN_INTERVAL_MS },
    { network: 'TRON', every: env.SCAN_INTERVAL_MS },
    { network: 'BTC', every: env.BTC_SCAN_INTERVAL_MS },
    { network: 'LTC', every: Math.max(env.BTC_SCAN_INTERVAL_MS, 60_000) },
  ];
  for (const s of schedule) {
    const jobId = `scan-${s.network}`;
    const existing = jobs.find((j) => j.name === jobId);
    if (existing) await scanQueue.removeRepeatableByKey(existing.key);
    await scanQueue.add(
      jobId,
      { network: s.network },
      { repeat: { every: s.every }, jobId, removeOnComplete: true, removeOnFail: true }
    );
  }

  const maint = await maintenanceQueue.getRepeatableJobs();
  for (const j of maint) await maintenanceQueue.removeRepeatableByKey(j.key);
  await maintenanceQueue.add(
    'expire',
    {},
    { repeat: { every: 60_000 }, jobId: 'expire-invoices', removeOnComplete: true, removeOnFail: true }
  );
  console.log('[workers] repeatable jobs scheduled');
}

async function main() {
  await setupRepeatable();

  const webhookWorker = new Worker<{ deliveryId: string }>(
    'webhook-deliveries',
    (job) => processDelivery(job as Job<{ deliveryId: string }>),
    { connection: connection(), concurrency: 5 }
  );

  const scanWorker = new Worker<{ network: NetworkName }>(
    'chain-scan',
    async (job) => {
      await scanNetwork(job.data.network);
    },
    { connection: connection(), concurrency: 1 }
  );

  const maintWorker = new Worker(
    'maintenance',
    async (job) => {
      if (job.name === 'expire') {
        const n = await expireDueInvoices();
        if (n) console.log(`[maintenance] expired ${n} invoice(s)`);
      }
    },
    { connection: connection(), concurrency: 1 }
  );

  for (const w of [webhookWorker, scanWorker, maintWorker]) {
    w.on('failed', (job, err) => console.error(`[worker ${w.name}] job ${job?.name} failed:`, err.message));
  }

  console.log('[workers] webhook, chain-scan and maintenance workers running');

  const shutdown = async () => {
    await Promise.all([webhookWorker.close(), scanWorker.close(), maintWorker.close()]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[workers] fatal', e);
  process.exit(1);
});
