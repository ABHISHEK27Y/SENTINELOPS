# Runbook: Redis Failures

Category: cache · Applies to: notification-service, payment-service

## Symptoms
- `redis_latency_ms` spikes or connection-refused errors in logs.
- `queue_depth` climbing on notification-service (workers can't drain the queue).
- Degraded (not failed) responses where Redis is best-effort.

## Common causes
1. Redis unavailable or restarting (connection refused).
2. Memory pressure triggering evictions.
3. Network partition between the service and Redis.

## Diagnosis
- Check Redis connectivity and `redis_latency_ms`.
- On notification-service, a rising `queue_depth` with failing dequeues indicates
  Redis is down and the queue is backing up.

## Remediation
1. **Restart** or fail over Redis if it is unhealthy.
2. **Clear the cache** if corrupted keys are implicated.
3. Verify the eviction policy and memory limits.
4. Confirm the service degrades gracefully (does not hard-fail user requests).

## Escalation
If the queue keeps growing after Redis recovers, scale notification-service
workers and drain the backlog.
