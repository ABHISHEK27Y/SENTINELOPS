# Guide · Failure Injection

Failure injection is how the demo proves the whole loop. Faults produce **real**
effects (real latency, real 500s, real CPU/RSS), so the telemetry that follows is
genuine — see [service-kit fault controller](../packages/service-kit.md#fault-controller).

Currently faults are triggered per-service via `/admin/faults`. Phase 13 adds a
platform failure API (`POST /api/failures/*`) and a dashboard console that fan out to
these same endpoints.

---

## The fault API (per service)

| Method | Path | Body | Effect |
| --- | --- | --- | --- |
| `GET` | `/admin/faults` | — | list active faults |
| `POST` | `/admin/faults` | `{ type, params }` | inject a fault |
| `DELETE` | `/admin/faults/:type` | — | clear one fault |
| `DELETE` | `/admin/faults` | — | clear all |

Common param: `ttlMs` — auto-clear the fault after N ms.

---

## Catalogue

| `type` | params | What actually happens | Metrics that move |
| --- | --- | --- | --- |
| `db_latency` | `targetMs` (default 2400) | `simulateDbQuery` adds latency | `db_query_latency_ms`↑, `db_pool_utilization`→~0.99, request latency↑ |
| `error_injection` | `probability` 0..1 (default 0.5) | that fraction of requests return real 500 | `http_request_errors_total`↑, health→DEGRADED |
| `kill` | — | service reports UNHEALTHY, all requests fail | `/health`→503, errors↑ |
| `cpu_stress` | — | background busy-loop (~50% of a core) | `cpu_usage`↑ |
| `memory_leak` | — | allocates ~2MB/s | `memory_usage` (RSS)↑ |
| `break_redis` | — | `simulateRedisOp` throws + spikes latency | `redis_latency_ms`↑, Redis-dependent paths degrade |
| `traffic_spike` | `factor` (default 4) | extra internal load factor | request rate/latency↑ |
| `kafka_lag` | `targetMs` (default 1500) | delays producer flush | `queue_depth`↑ |
| `network_failure` | — | (reserved for dependency-call failures) | downstream errors↑ |

---

## Worked example — the flagship scenario

Reproduce the DB-degradation incident against payment-service:

```bash
# 1. Baseline
curl -s localhost:8083/metrics | grep -E 'db_pool_utilization|http_requests_total' 

# 2. Degrade the database
curl -XPOST localhost:8083/admin/faults -H 'content-type: application/json' \
     -d '{"type":"db_latency","params":{"targetMs":2500}}'

# 3. Drive traffic through order-service (which calls payment)
for i in $(seq 1 20); do
  curl -s -o /dev/null -XPOST localhost:8082/orders \
       -H 'content-type: application/json' -d '{"userId":"u'$i'"}'
done

# 4. Observe: payment latency high, pool ~0.99; order-service returns 502s
curl -s localhost:8083/metrics | grep db_pool_utilization
curl -s localhost:8082/metrics | grep -E 'http_requests_total\{.*status="502"'

# 5. "Remediate" by clearing the fault, then watch recovery
curl -XDELETE localhost:8083/admin/faults
curl -s localhost:8083/metrics | grep db_pool_utilization   # falls back toward 0.15
```

This is the physical basis for the automated flow: the anomaly-engine will detect the
latency/error/saturation anomalies, the incident-engine will correlate them into one
incident, root-cause will point at the DB, the AI will explain it, and — after
approval — remediation + recovery verification will close it. See
[Data Flow C](../architecture/03-data-flow.md#flow-c--the-incident-path-control-plane).

---

## Safety

- Faults only affect the **demo data-plane services** (self-inflicted, in-process).
- Real remediation actions (restart/rollback) that act on infrastructure are
  approval-gated and audited — [Security & RBAC](../architecture/09-security-and-rbac.md).
- Injecting faults (once the platform API exists) requires the ENGINEER or ADMIN role.
