/**
 * Traffic generator. Continuously drives realistic requests through the
 * api-gateway so every service has a steady telemetry baseline (which the
 * anomaly-engine learns "normal" from). No dependencies — plain fetch.
 *
 * Env:
 *   GATEWAY_URL   target gateway (default http://localhost:8080)
 *   TARGET_RPS    approximate requests/sec (default 8)
 *   ORDER_RATIO   fraction of requests that are POST /orders (default 0.6)
 */
const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8080';
const TARGET_RPS = Number(process.env['TARGET_RPS'] ?? 8);
const ORDER_RATIO = Number(process.env['ORDER_RATIO'] ?? 0.6);

const intervalMs = Math.max(10, Math.floor(1000 / TARGET_RPS));

let sent = 0;
let ok = 0;
let failed = 0;

const uid = () => Math.random().toString(36).slice(2, 10);

async function hit(): Promise<void> {
  sent += 1;
  const isOrder = Math.random() < ORDER_RATIO;
  try {
    const res = isOrder
      ? await fetch(`${GATEWAY_URL}/orders`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: uid(), items: [{ sku: 'A1', qty: 1 }] }),
        })
      : await fetch(`${GATEWAY_URL}/users/${uid()}`);
    if (res.ok) ok += 1;
    else failed += 1;
    // Drain the body so sockets are released.
    await res.text().catch(() => undefined);
  } catch {
    failed += 1;
  }
}

console.log(
  `[loadgen] targeting ${GATEWAY_URL} at ~${TARGET_RPS} rps ` + `(order ratio ${ORDER_RATIO})`
);

const ticker = setInterval(() => void hit(), intervalMs);

// Periodic summary so the logs show liveness.
setInterval(() => {
  console.log(
    `[loadgen] sent=${sent} ok=${ok} failed=${failed} ` +
      `(${((failed / Math.max(1, sent)) * 100).toFixed(1)}% err)`
  );
}, 10_000);

function shutdown(signal: string) {
  console.log(`[loadgen] ${signal} — stopping. total sent=${sent}`);
  clearInterval(ticker);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
