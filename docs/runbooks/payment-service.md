# Runbook: Payment Service

Category: service · Owner: payments

## Overview
payment-service charges orders. It is a heavy PostgreSQL and Redis user and is the
most latency-sensitive service in the request path (api-gateway → order-service →
payment-service → postgres).

## Health signals
- `http_request_duration_ms` (p95) on `/charge`.
- `http_request_errors_total` (5xx rate).
- `db_pool_utilization`, `db_query_latency_ms`.

## Failure modes and responses
| Symptom | Likely cause | Response |
| --- | --- | --- |
| Latency ↑, pool → 1.0 | DB connection pool exhaustion | See [database-troubleshooting](database-troubleshooting.md): increase pool, inspect slow queries, restart if needed |
| 500 rate ↑ after a deploy | Regression in the latest deployment | Roll back the deployment |
| Redis errors | Idempotency cache unavailable | See [redis-failures](redis-failures.md); charge path degrades but should not hard-fail |

## Safe remediation actions
- `increase_connection_pool` (low risk)
- `restart_service` (medium risk — requires approval)
- `rollback_deployment` (medium risk — requires approval)

## Recovery verification
After remediation, confirm p95 latency returns to baseline (~180ms) and the 5xx
rate falls below 1% for two consecutive verification windows before resolving.
