# Phase 2 · Demo Microservices — Build Log

**Goal**: a shared service template and the monitored services, with real
health/metrics/traces/logs and working fault injection. **Status**: ✅ complete —
`service-kit` + all five data-plane services (`api-gateway`, `user-service`,
`order-service`, `payment-service`, `notification-service`) + a traffic generator,
verified end-to-end.

---

## What was built

### 1. `@sentinelops/service-kit` — the service template
Full API: [service-kit doc](../packages/service-kit.md). Modules:
- [`telemetry.ts`](../../packages/service-kit/src/telemetry.ts) — OTel `NodeSDK`
  bootstrap (best-effort, ordered-before-app).
- [`metrics.ts`](../../packages/service-kit/src/metrics.ts) — Prometheus registry +
  the full instrument catalogue.
- [`faults.ts`](../../packages/service-kit/src/faults.ts) — `FaultController` with
  **real** effects (busy-loop CPU, growing RSS, injected latency/errors).
- [`server.ts`](../../packages/service-kit/src/server.ts) — `createService()` Fastify
  factory wiring metrics + faults + health + logging + simulated DB/Redis calls.

### 2. Services
- [`payment-service`](../services/payment-service.md) — `POST /charge`; the primary
  failure target.
- [`order-service`](../services/order-service.md) — `POST /orders`; real HTTP call to
  payment (distributed trace + failure propagation).

---

## Problem solved this phase — OTel version skew

Installing the OpenTelemetry SDK produced a **type error**:

```
telemetry.ts: Type 'PeriodicExportingMetricReader' is not assignable to type
'MetricReader'. Types have separate declarations of a private property '_shutdown'.
```

**Cause**: `sdk-node@0.54.2` and the OTLP exporters pin `@opentelemetry/sdk-metrics`
to exact `1.27.0`, but the service-kit dependency floated to `1.30.1` — two copies in
the tree, whose `MetricReader` classes are nominally incompatible.

**Fix**: a root `overrides` block forcing `sdk-metrics`, `resources`, and
`sdk-trace-base` to `1.27.0`, plus exact pins in service-kit. After a clean reinstall
there is a single `sdk-metrics@1.27.0` and the typecheck is clean. Full write-up:
[ADR-0003](decisions/adr-0003-otel-version-pinning.md).

---

## Verification — the fault-injection smoke test

Booted `payment-service` on :8083 and ran a real sequence (not mocked):

| Step | Command (abbrev.) | Result |
| --- | --- | --- |
| Healthy charge | `POST /charge` | `{"status":"charged","dbLatencyMs":21}` |
| Baseline pool | `GET /metrics ∣ db_pool_utilization` | `0.15` |
| Inject latency | `POST /admin/faults {db_latency, targetMs:2400}` | enabled |
| Charge under fault | `POST /charge` | `dbLatencyMs:2431`, wall time **2.4s** |
| Pool now | `GET /metrics ∣ db_pool_utilization` | **0.99** |
| Inject errors | `POST /admin/faults {error_injection, probability:1}` | enabled |
| Charge | `POST /charge` | **HTTP 500** |
| Error counter | `GET /metrics ∣ http_request_errors_total` | `1`; health → `DEGRADED` |
| Clear | `DELETE /admin/faults` | cleared |

**Interpretation**: the `db_pool_utilization` 0.15 → 0.99 jump is *derived from the
real injected latency*, not a hardcoded number — this is precisely the
connection-pool-exhaustion signal the flagship incident scenario needs. Errors are real
HTTP 500s that Prometheus counts and that flip the health endpoint.

```bash
npm run typecheck     # clean
npm test              # 4 passed
```

---

## Completing the data plane

Added `api-gateway`, `user-service`, `notification-service`, and the `loadgen` traffic
generator — all on the same `service-kit` pattern. `order-service` now also calls
`notification-service` (best-effort), completing the fan-out
`gateway → order → payment + notification`.

### IPv6 localhost bug

The full local chain first failed: the gateway returned `user-service unreachable`
even though user-service was healthy. **Cause**: Node's `fetch` (undici) resolves
`localhost` to IPv6 `::1`, but the services bind IPv4 `0.0.0.0`, so inter-service
`fetch('http://localhost:PORT')` hit connection-refused. **Fix**: local-dev default
URLs now use `127.0.0.1`; in Docker/K8s the `*_SERVICE_URL` env points at the service
DNS name (IPv4) so the issue can't occur there.

### End-to-end verification (local)

All five services healthy; through the gateway:
```
GET  /users/abc123  → {"id":"abc123","name":"user-abc123",...,"dbLatencyMs":12}
POST /orders        → {"status":"created","orderId":"…","payment":{"status":"charged",...}}
```
i.e. `gateway → user` and `gateway → order → payment (+ notification)` both work, with
one propagated trace context across every hop.

Kafka producers wiring `telemetry.events` / `log.events` is deferred to Phase 4 (with
the broker client + migration runner).

→ Next: [Phase 3 (full docker-compose)](phase-03-docker-stack.md).
