# SentinelOps repair report — 12 October 2026

## Completion status

**Local demo repair and acceptance completed.** The final calibrated image is
running. The full fault-to-postmortem workflow, live database and backup/restore
checks, concurrent approvals, worker and broker interruptions, two-replica login
throttling/WebSocket fanout, browser navigation, monitoring ingestion, full test
suite and dependency audit all passed. This statement is limited to the agreed
local demo, not a production or cloud release.

The later [status recheck](STATUS_RECHECK_2026-10-12.md) confirmed these controlled
checks while finding new default-workload incidents with no active injected fault.
The running dashboard still needs alert calibration and incident disposition work.

The agreed target is **local demo only**. Cloud release, production credentials,
real infrastructure remediation and remote AI providers remain optional future
work. No cloud resources, factory reset, volume deletion, retention operation or
publication was performed. Demo schema migrations and demo account seeding ran
against the isolated local stack.

## What we are building

SentinelOps is a working demonstration of service monitoring and incident
response. A traffic generator calls a gateway, then user, order, payment and
notification services. The services publish measurements through Kafka.
PostgreSQL stores normalized measurements and incident history. A statistical
detector compares each service instance with its healthy baseline. The incident
engine groups related anomalies using time and the known dependency graph.

The dashboard lets an engineer inspect an incident, investigate using stored
runbooks, approve a proposed recovery action and inspect a postmortem. Recovery
requires fresh complete measurements across two distinct passing windows.
Clearing a fault alone never establishes recovery.

Request timings, process measurements, Kafka transport and SQL persistence are
real. Business database/cache operations and some dependency failures are
simulations. Demo remediation clears a named injected fault; it does not scale,
restart or roll back production infrastructure. Mock investigation/embeddings
allow the demo to run without paid AI credentials.

## Stack and decisions

| Component | Purpose and tradeoff |
| --- | --- |
| TypeScript/npm workspaces | Shared contracts and libraries across independent processes; backend production retains `tsx` source execution. |
| Fastify 5 and JWT | HTTP APIs, role checks, explicit demo administration, input validation and bounded requests. |
| Next.js 16.4 / React 19 / Tailwind 4 | Built dashboard served with `next start`; build-time API and WebSocket URLs. Standalone output was removed to match this runtime. |
| Kafka | At-least-once event transport. Stable identities and idempotent database effects tolerate redelivery. |
| PostgreSQL / pgvector | Durable incident lifecycle, audit decisions, recovery jobs, baselines, shared login throttle, inbox/outbox and provider-scoped runbook vectors. |
| Redis | Bounded transport deduplication and demo dependency behavior; SQL commits durable effects. |
| OpenTelemetry SDK 2 / exporters 0.223 | Service traces, metrics and logs. Logs now have an explicit redacted Pino sink; instrumentation log sending is disabled to prevent duplicate export. |
| Prometheus / Jaeger / Loki / Grafana | Monitoring backends; traces, all 13 scrape targets and stored application logs observed live. |
| Docker Compose | Local runtime, loopback ports and persistent store volumes. Kubernetes source renders; cloud deployment is deferred. |

Global correlation/outbox locks favor correctness over throughput. The database
inbox records completion in the transaction that writes handler effects. The
outbox records publication only after confirmed delivery. This is not an
exactly-once transaction across Kafka and SQL. Remediation jobs freeze the
required recovery cohort before execution and preserve it across restarts.

See [implemented architecture](architecture/IMPLEMENTED_ARCHITECTURE.md) and
[original review](PROJECT_REVIEW_2026-10-09.md) for the wider architecture.

## Phase status

| Phase | Implemented and observed | Remaining acceptance |
| --- | --- | --- |
| 1 — Runtime | Calibrated workspace image and production dashboard built and deployed; local stack healthy; collector/Loki pinned configurations validated. Docker startup helper avoids the observed socket startup failure. | None for the local demo. |
| 2 — Durable state | Inbox/outbox, guarded lifecycle, migration locking/checksums, persisted detector/correlation state. Live rollback, nested rollback, concurrent inbox deduplication, outbox retry/confirmation and competing lifecycle changes passed in an isolated temporary schema. Kafka was stopped and restored during a live recovery job; SQL/Redis markers survived controlled restarts. | A forced broker process crash and high-partition scale benchmark remain future hardening. |
| 3 — Access and recovery | JWT/RBAC, shared SQL login throttle, origin/session-aware WebSockets, durable approval jobs. Two API replicas received one Kafka event over authenticated sockets; alternating logins shared the SQL throttle. Live rejection, competing approvals, worker restart, fresh recovery and postmortem passed. | Production account and operator access policies are outside this demo. |
| 4 — Signals and investigation | Normalized interval measurements; bounded simulations; durable runbook retrieval. All five business services appeared in Jaeger; 13/13 Prometheus targets were up. Live investigation used 18 indexed runbook chunks. Calibrated workflow and browser sign-in, service, runbook and graph navigation passed. Corrected the Loki push path and queried stored payment-service logs. | Production workload calibration remains outside this demo. |
| 5 — Deployment | Loopback ports, persistent stores, migration gates and monitoring configuration. Database backup restored into a separate temporary database: 11 incidents, eight migrations and 18 chunks verified. Temporary restore removed. SQL and Redis markers survived restarts; all 21 containers are running, 12 with passing healthchecks and nine without configured healthchecks. Root Kubernetes Kustomize rendered. | Kubernetes PVC runtime and cloud release are deferred. |
| 6 — Proof and docs | Calibrated live smoke passed. Full suite: 226 tests across 49 files; 88.23% lines, 86.38% statements, 80.56% functions, 77.11% branches, all above unchanged 80/80/80/70 gates. ESLint and test typecheck passed. Authorized npm audit reports zero vulnerabilities. | Controlled acceptance gates passed; later recheck found default-workload incident noise requiring calibration and disposition. |

## Changes since the previous report

1. Upgraded affected JWT, OpenTelemetry, Next/React, Tailwind, Vitest and Knip
   dependencies and adapted their APIs. The audit fell from 69 affected entries
   to zero. Deprecation notices are distinct from vulnerability findings.
2. Removed unsupported Loki exporter `tenant_id` from the pinned collector
   configuration. Both pinned binaries validated their configuration.
3. Added actual rendered UI, hook, startup, runbook and lifecycle tests. The
   final 226-test coverage run passes the unchanged 80/80/80/70 thresholds.
   Coverage includes real source paths and excludes generated Next build artifacts.
4. Included dashboard source in ESLint, fixed import ordering, added accessible
   login labels and corrected bodyless API requests. JSON content type is now
   applied only to nonempty string bodies, preserving FormData boundaries.
5. Corrected smoke cleanup and selection: a fault may join an existing detected
   incident, so the test requires fresh fault-specific anomaly evidence rather
   than assuming a new incident ID.
6. Added configurable host API port and matching frontend build arguments.
   Another application occupied 4000 during verification. `.env.demo.example`
   selects 4010 without stopping the other application.
7. Added explicit application log export after traces/metrics arrived but Loki
   labels remained empty. Pino redaction happens before the export sink; exporter
   failure cannot interrupt logging. Targeted secret-redaction tests passed.
8. Added shared absolute noise floors: CPU 0.10 of the exported fraction,
   HTTP/database latency 5 ms, Redis latency 2 ms. Detection ignores deviations
   within these floors; recovery permits ordinary jitter. Saturation and absent
   request traffic still fail. These are local demo defaults, requiring workload
   tuning before production use.
9. Corrected the mocked smoke fixture after its old response contract caused a
   tight polling loop and worker termination. Added an isolated-schema acceptance
   script regression. The final 226-test suite passed the unchanged coverage gate.
10. Corrected the collector's Loki push path from `/api/v1/push` to
    `/loki/api/v1/push` and recreated the collector. Business-service logs were
    observed in Loki. The exporter had received HTTP 404 before this correction.

## Evidence and limits

Evidence is stored in `docs/review-evidence-2026-10-09/`; the directory retains the
original review date. Relevant files:

- `calibrated-smoke-2026-10-12.log`: full fault-to-postmortem workflow passed on
  port 4010 after calibration.
- `live-database-passed-2026-10-12.log`: isolated live SQL acceptance passed.
- `backup-restore-final-2026-10-12.log`: backup/restore counts verified.
- `dependency-audit-final-2026-10-12.json`: zero vulnerabilities, audit exit zero.
- `calibrated-image-build-2026-10-12.log` and
  `calibrated-deployment-2026-10-12.log`: final image and local stack deployment.
- `acceptance-coverage-final-2026-10-12.log`: 226 tests and passing coverage gate.
- `acceptance-lint-final-2026-10-12.log`: clean ESLint run.
- `acceptance-typecheck-tests-final-2026-10-12.log`: test TypeScript check passed.
- `architecture-browser-2026-10-12.png`: signed-in browser architecture view.
- `final-container-status-2026-10-12.log`: all 21 listed containers up at the
  final status check.
- `failure-acceptance-2026-10-12.log`: live rejection, approval race, worker
  restart, missing telemetry and Kafka interruption/recovery passed.
- `replica-acceptance-2026-10-12.log`: two-replica authenticated socket fanout and
  shared login throttle passed; temporary replica removed afterward.
- `loki-application-logs-2026-10-12.json` and
  `prometheus-targets-2026-10-12.json`: stored application logs and 13/13 targets.
- `store-restart-2026-10-12.log`: SQL acceptance marker persisted across restart
  and was deleted afterward; Redis acceptance marker also persisted and was removed.
- `acceptance-kustomize-2026-10-12.yaml`: rendered Kubernetes source.

The host is Node 22.12. A lint dependency requires Node 22.13+ or another supported
version; use Node 22.13+ for compatible local tooling. Docker builds use Node 22.
Unit tests substitute transport/provider boundaries; live scenarios additionally
verified the central demo paths. Jaeger traces remain ephemeral. Direct
database/cache health is UNKNOWN without actual telemetry. Historical unresolved
incidents remain visible in the dashboard, so aggregate health can display
UNHEALTHY even while the processes answer readiness probes. At the final browser
check, it showed 26 active incidents and five UNHEALTHY business-service labels;
they are preserved for investigation, not silently closed. No production
readiness claim is made.

## Running the local demo

From the repository root in PowerShell:

```powershell
# Only needed when Docker Desktop is stopped or encounters the known launch issue.
./scripts/start-docker-desktop.ps1
docker info
docker compose --env-file .env.demo.example up -d --build --wait --wait-timeout 240
$env:SENTINELOPS_SMOKE_URL = 'http://127.0.0.1:4010'
node scripts/stack-smoke.mjs
node --import tsx scripts/live-database-check.mjs
```

Dashboard: `http://localhost:3000`; API readiness:
`http://localhost:4010/api/ready`. The example contains local demo URLs, not
secrets. Its URLs must be present at build time. Do not run the standalone
infrastructure project alongside the full stack with a different Compose
project name and the same fixed container names. Never use `down -v` to restart
the demo: that removes persistent data.

The local demo is ready for further feature work. Production operation would
need real remediation adapters, deployment secrets, workload-specific calibration,
cloud/PVC runtime proof and an operator policy for historical incident closure.
