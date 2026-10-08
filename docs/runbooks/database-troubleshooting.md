# Runbook: Database Troubleshooting (PostgreSQL)

Category: database · Applies to: payment-service, user-service, order-service

## Symptoms
- Rising `db_query_latency_ms` and request latency on services that use Postgres.
- `db_pool_utilization` approaching 1.0 (connection pool exhaustion).
- HTTP 500 rate increasing; timeouts on the payment path.

## Common causes
1. **Connection pool exhaustion** — long-running or slow queries hold connections,
   so new requests wait for a free connection and time out.
2. **Slow queries** — missing index, a table scan, or lock contention.
3. **Traffic spike** — request volume exceeds the pool size.
4. **A recent deployment** introduced a query regression or a connection leak.

## Diagnosis
- Check `db_pool_utilization`: sustained > 0.9 indicates saturation.
- Correlate the start time with the deployment timeline — did a deploy precede it?
- Inspect the longest-running queries and lock waits.

## Remediation
1. Inspect and kill long-running queries; add the missing index.
2. Temporarily **increase the connection pool** size to relieve pressure.
3. If a recent deployment correlates, **roll it back**.
4. As a last resort, **restart** the affected service instances to reset held
   connections.

## Escalation
If latency does not recover within two verification windows after remediation,
escalate to the database on-call and consider read-replica failover.
