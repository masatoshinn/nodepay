import { CopyButton } from '../components/CopyButton';

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100 dark:bg-black/40">
        <code>{children}</code>
      </pre>
      <div className="absolute right-2 top-2">
        <CopyButton value={children} />
      </div>
    </div>
  );
}

export default function Docs() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">API documentation</h1>
        <p className="mt-1 text-sm text-slate-500">
          Base URL <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{location.origin.replace('5173', '4000')}/api/v1</code> — create
          invoices server-side, poll status, and receive signed webhooks.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold">Authentication</h2>
        <p className="text-sm text-slate-500">Create a key in <strong>API Keys</strong>. Send both headers on every request:</p>
        <Code>{`X-API-Key: npk_...
X-API-Secret: nps_...`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Create an invoice</h2>
        <Code>{`curl -X POST ${location.origin.replace('5173', '4000')}/api/v1/invoices \\
  -H "X-API-Key: npk_..." \\
  -H "X-API-Secret: nps_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 49.90,
    "currency": "USD",
    "coin": "USDT",
    "network": "TRON",
    "order_id": "ORDER-1001",
    "description": "Pro plan",
    "ttl_minutes": 30
  }'`}</Code>
        <Code>{`{
  "id": "inv_Xy7...",
  "status": "waiting",
  "amount_fiat": "49.90",
  "amount_crypto": "49.913742",
  "address": "TQ5n9...",
  "checkout_url": "http://localhost:5173/pay/inv_Xy7...",
  "expires_at": "2026-10-09T12:34:56.000Z"
}`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">List / get invoices</h2>
        <Code>{`GET /api/v1/invoices?status=paid&limit=50&offset=0
GET /api/v1/invoices/:id        # id or order lookup by ?order_id=
POST /api/v1/invoices/:id/cancel`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Webhooks</h2>
        <p className="text-sm text-slate-500">
          Events: <code>invoice.detected</code>, <code>invoice.confirmed</code>, <code>invoice.expired</code>,{' '}
          <code>invoice.underpaid</code>. Retried up to 6 times with exponential backoff.
        </p>
        <p className="text-sm text-slate-500">
          Header <code>X-BazilPay-Signature: t=&lt;unix&gt;,v1=&lt;hmac_hex&gt;</code> — HMAC-SHA256 over{' '}
          <code>{"`${t}.${rawBody}`"}</code> using your endpoint secret. Reject timestamps older than 5 minutes (replay
          protection).
        </p>
        <Code>{`import crypto from "node:crypto";

function verifySignature(rawBody, header, secret) {
  const [t, v1] = header.split(",").map((s) => s.split("=")[1]);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${t}.\${rawBody}\`)
    .digest("hex");
  const ok =
    crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected)) &&
    Math.abs(Date.now() / 1000 - Number(t)) < 300;
  return ok;
}`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Embed button (JS)</h2>
        <Code>{`<script>
  async function pay() {
    const res = await fetch("https://your-api.example.com/api/v1/invoices", {
      method: "POST",
      headers: { "X-API-Key": "npk_...", "X-API-Secret": "nps_...", "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 19.9, currency: "USD", coin: "BTC", network: "BTC", order_id: "A-1" }),
    });
    const inv = await res.json();
    window.location.href = inv.checkout_url; // hosted checkout at /pay/:id
  }
</script>
<button onclick="pay()">Pay with crypto</button>`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Payment lifecycle</h2>
        <div className="card p-4 text-sm">
          <ol className="list-decimal space-y-1.5 pl-5 text-slate-600 dark:text-slate-300">
            <li>
              <strong>waiting</strong> — invoice created, rate locked, unique address/amount assigned
            </li>
            <li>
              <strong>detected</strong> — incoming transaction seen on-chain → <code>invoice.detected</code>
            </li>
            <li>
              <strong>confirming</strong> — in a block, waiting for network confirmations (BTC 2 · ETH 12 · BSC 15 · TRON 19 · LTC 6)
            </li>
            <li>
              <strong>paid</strong> — enough confirmations → <code>invoice.confirmed</code>, funds are already in <em>your</em> wallet
            </li>
            <li>
              <strong>underpaid / overpaid / expired</strong> — edge states, also webhookbed
            </li>
          </ol>
        </div>
      </section>
    </div>
  );
}
