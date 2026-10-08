# Tool · loadgen (traffic generator)

Continuously drives realistic requests through the api-gateway so every service has a
steady telemetry baseline. This matters because the anomaly-engine (Phase 6) learns
"normal" from history — without baseline traffic there is nothing to detect a
deviation *from*.

- **Built on**: nothing (plain `fetch`, no dependencies)
- **Code**: [`services/loadgen/src/index.ts`](../../services/loadgen/src/index.ts)
- **Status**: ✅ implemented

---

## What it does

Every tick it sends either a `POST /orders` (probability `ORDER_RATIO`) or a
`GET /users/:id`, at approximately `TARGET_RPS` requests/second, and logs a summary
every 10s:

```
[loadgen] targeting http://api-gateway:8080 at ~8 rps (order ratio 0.6)
[loadgen] sent=80 ok=80 failed=0 (0.0% err)
```

## Configuration (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `GATEWAY_URL` | `http://localhost:8080` | Target gateway (set to `http://api-gateway:8080` in compose) |
| `TARGET_RPS` | `8` | Approximate requests/sec |
| `ORDER_RATIO` | `0.6` | Fraction that are `POST /orders` vs `GET /users` |

## Role in the demo

1. loadgen keeps a **baseline** of healthy traffic.
2. A fault is injected on payment-service.
3. The baseline traffic now flows through a degraded path → real latency/error
   anomalies appear in the telemetry.
4. The control plane detects, correlates, and responds.

Without loadgen you would have to hand-drive requests to produce signal; with it the
system looks and behaves like a live service under continuous load.

## Run

```bash
# locally (gateway on :8080):
GATEWAY_URL=http://localhost:8080 TARGET_RPS=8 npm run start -w @sentinelops/loadgen
# in the stack it runs automatically as the `loadgen` container.
```
