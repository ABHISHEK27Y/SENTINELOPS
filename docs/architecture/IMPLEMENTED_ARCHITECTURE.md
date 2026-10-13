# Implemented architecture — 12 October 2026

This describes source behavior, with verification limits recorded in
[FIX_PLAN.md](../FIX_PLAN.md) and [the repair report](../REPAIR_PROGRESS_2026-10-12.md).

## Runtime and boundaries

The npm workspace contains TypeScript shared libraries, five Fastify demo services,
Kafka control-plane processes, a Fastify platform API and a Next dashboard. The
shared Docker image retains `tsx` as a production runtime and ships source package
exports. Backend and dashboard typechecks run separately; Next produces an optimized
build and runs with `next start`. Browser API/WS addresses are build-time inputs.
Python and Isolation Forest are target features, not running components.

Demo HTTP workloads and process CPU/RSS measurements are real. Business database
and Redis calls simulate latency and utilization. Kafka delay faults simulate
request delay/queue depth, not a real broker backlog. The topology is static; there
is no trace-derived discovery feed. PostgreSQL/Redis service nodes have no direct
telemetry feed and therefore report UNKNOWN when telemetry is absent.

## Event ownership and durability

Data-plane telemetry is best effort. The ingestor validates payloads and writes
metrics/logs with a database inbox entry and normalized output in one transaction.
The detector consumes only normalized metrics, preventing double sampling.
Control-plane publication uses a transactional outbox and a strict producer.

Database transactions use AsyncLocalStorage to share one pg client across nested
library calls. An inbox conflict skips already committed work. Handler failure
rolls back its effects and inbox completion. Redis completion is recorded after
processing or confirmed DLQ delivery, never before. Failed DLQ delivery throws so
the original offset is not completed; the full original payload is retained.

One advisory lock serializes outbox dispatch across processes. Pending rows use an
insertion sequence for ordering. Broker confirmation precedes marking publication.
Crash after send can cause redelivery; stable envelope IDs and inbox records make
database effects idempotent. This is at-least-once delivery, not an atomic Kafka/SQL
transaction. Outbox dispatch holds a database transaction during broker delivery.

## Detection, correlation and incident lifecycle

Per-instance rolling baselines are persisted under a locked pipeline-state row per
service. Invalid numeric/timestamp input is rejected. Anomalous values do not train
the healthy baseline, preventing a prolonged fault from becoming normal. CPU,
memory, queue depth and request rate need three consecutive abnormal samples;
latency and pool utilization need two. Confirmation state is persisted with the
baseline, and a healthy sample or a gap over 20 seconds resets the count. Warmup
still requires healthy workload; flat signals and changing legitimate workloads
need operational tuning. Per-instance timestamps persist with the baseline; older samples cannot alter it after restart.

Correlation persists groups under a global locked state row. It uses topology and
time proximity, caps retained group evidence at 500 anomalies, rejects samples too
old to join a newer group, and closes resolved/postmortem groups before ingestion.
This serializes correlation and limits scaling throughput. A persisted global
watermark survives even when all groups close. Events beyond the one-minute
lateness window, or older than five minutes on receipt, are archived without
creating incidents. Events more than 30 seconds in the future are rejected.
These clock/lateness budgets need validation under a live distributed workload.

The shared lifecycle helper locks the incident, checks legal/expected transitions,
and writes status, timeline and event outbox together. Investigation and postmortem
persistence now use the same outer transaction for associated status changes.

## Access and remediation

JWT guards REST reads; engineer/admin roles guard investigation, postmortem, fault
mutations and remediation decisions. Demo users are seeded only in explicit demo mode. Direct service fault
administration is disabled outside demo mode and uses a constant-time internal
token check. Production API startup rejects weak/default JWT secrets and wildcard
CORS. Login has runtime schemas and a PostgreSQL throttle shared across API
replicas: ten attempts per hashed IP per minute. Storage failure fails closed with
503; exhausted limits return 429 and Retry-After. Expired buckets are pruned in
bounded batches. Production provisioning policy remains separate release work;
the operator creation CLI is implemented.

WebSocket upgrades require authentication and an allowed browser origin. Native
browser clients carry their token in the protocol header, not the URL. The socket
closes at token expiry and bounds queued output. Each API replica uses its own
Kafka consumer group for event fanout; per-replica group retention needs operations
policy. Polling supplies refresh fallback. Browser sockets reconnect with bounded
exponential delay, refresh on reconnect, and stop retrying after an auth rejection.

Proposal/approval updates lock the incident. Only a PROPOSED action can be claimed;
one approval row per action is enforced by SQL. Approval queues a durable job and
audit record; it does not run a fire-and-forget recovery task. Job locks prevent
competing workers. EXECUTE can run only in REMEDIATING, VERIFY only in VERIFYING.

The demo executor supports only `clear_injected_fault` with a known fault enum and
a bounded authenticated HTTP request. Restart, scaling, cache-clear and rollback
proposals cannot claim success because no real adapter exists. Clearing an already
cleared fault is idempotent, so replay after a crash is safe for this adapter only.
Future infrastructure adapters need their own execution idempotency contracts.

Recovery records the exact action ID. It requires fresh samples for every anomalous
service/metric/instance, newer than execution or that series' previous window. Two
complete passing windows resolve the incident; absent/stale evidence or timeout
returns to MITIGATION_REQUIRED. Execution time uses `clock_timestamp()` after the
HTTP operation. The anomalous service/metric/instance cohort and baselines are frozen
before execution and saved in the job state; legacy jobs adopt their cohort on the
first verification poll. Request rate must lie between baseline / 1.5 and baseline
* 1.5. Latency/error/resource gauges may improve below baseline, with the same upper
tolerance. Invalid or negative observations fail. Detection and recovery share
absolute noise floors for the local demo: CPU 0.10 of its exported fraction,
queue depth 1, request rate 2 requests/second, HTTP/database latency 5 ms and
Redis latency 2 ms. They prevent low-baseline
jitter from generating incidents or blocking recovery while preserving saturation
and absent-traffic checks. Production workloads require their own calibration.

## Investigation, operations and deployment

Runbooks and vectors persist in pgvector, scoped by embedding provider. Explicit
remote embedding selection requires credentials and validates index/dimension/
finite-value output; mock hashing remains available for local operation. The schema
uses 384 dimensions and HNSW after migration 0007. Model output selects validated
evidence/runbook IDs; trusted data builds the published summary. Provider failure
falls back to deterministic evidence. Runbook content is untrusted reference text.

Migrations use session locking, one transaction per file and SHA-256 checksums.
The approval uniqueness migration checks for existing duplicate decisions and
fails with an actionable error before applying the constraint; it never deletes history.
Legacy migration rows with null checksums are adopted once. The operator CLI offers
bounded `prune [days]` batches for old telemetry and completed transport records;
pending outbox, incident, action and audit evidence are preserved. Retention must
exceed broker retention (default CLI minimum eight days); no prune was run here.

Local Compose binds published ports to loopback. Kubernetes uses persistent claims
for demo databases/broker and Prometheus/Loki/Grafana/Alertmanager, with a default
StorageClass required. Root Kustomize supplies monitoring ConfigMaps. Jaeger traces
remain ephemeral. This is a local demo bundle, not a production overlay.

Terraform removes the default DB password, enables Redis/MSK transport encryption,
adds DB backups, and makes the EKS API private unless administrator CIDRs are supplied.
Kafka clients support TLS; Redis must use `rediss://`. Remote state, cloud release
images, operator credentials and production secret wiring need environment inputs.
Neither Terraform provider validation nor a cloud plan has been run on this host.
The agreed delivery scope is a local demo; cloud deployment is deferred.

## Observability and shutdown

Business-service startup configures OTLP trace, metric and batched log exporters.
An explicit Pino sink sends already-redacted records to the SDK log API and the
collector's `/v1/logs` endpoint. Auto-instrumentation log sending is disabled to
avoid duplicate export; collector routing supplies Loki. Kafka/PostgreSQL error-event storage
remains a separate path. Control-plane/API processes do not bootstrap this SDK.
All five business services were observed in Jaeger, and all 13 Prometheus scrape
targets were up. Payment-service application logs were queried from Loki after
deployment of the sink and correction of the collector push path.

Metric publication and notification draining prevent overlapping ticks. Shutdown
awaits active work before disconnecting transports. Health listeners reject bind
failure, and failed metric collection returns 503 instead of an unhandled rejection.
