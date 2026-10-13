# SentinelOps final check — 13 October 2026

## Scope and result

The agreed target is a **local demonstration**. The six repair phases have been
implemented in source, and the source-level and live checks below pass. The
post-deployment incident trend is recorded in the final section of this report.
This report does not claim cloud or production readiness.

## What was built, in plain language

SentinelOps runs five small demo services and sends their HTTP, process and
application signals through Kafka. An ingestor stores normalized evidence in
PostgreSQL. A detector learns each instance's ordinary measurements and reports
deviations. A correlator groups related deviations by time and service
dependency, creating one incident with a suspected cause. The API and dashboard
show the incident, its evidence and runbook guidance. An engineer can investigate,
propose and approve a narrowly scoped demo action. A durable worker clears the
injected fault and waits for fresh, passing measurements before marking the
incident resolved. It can then create a postmortem.

The repairs made that flow more reliable: database inbox/outbox records and
idempotent Kafka handling protect against duplicate delivery; incident state
changes and remediation jobs are transactional; authentication protects reads,
WebSockets and decisions; and migrations, health gates and local monitoring make
the stack easier to operate. The dashboard uses polling when live events are
unavailable. Details of these choices and their tradeoffs are in
[Implemented architecture](architecture/IMPLEMENTED_ARCHITECTURE.md) and the
[phase checklist](FIX_PLAN.md).

This final scan also found noisy alert creation under ordinary generated traffic.
The detector now ignores a one-item notification queue and small request-rate
movement, and it requires repeated abnormal samples for noisy gauges and latency.
The confirmation count survives a process restart, while a healthy sample or a
gap of more than 20 seconds resets it. The incident engine updates a title when
correlation adds services. The API also corrects the displayed count for older
saved incidents without rewriting their history.

## Source verification

| Check | Result |
| --- | --- |
| Unit, API, browser and pipeline tests | 49 files, 229 tests passed |
| Coverage gates | Statements 86.46%, branches 77.36%, functions 80.62%, lines 88.30%; all configured gates passed |
| TypeScript, ESLint and Prettier | Passed |
| Optimized Next.js build | Passed; static and dynamic routes generated |
| Dependency audit | Zero known npm advisories in the resolved dependency tree at check time |
| Compose configuration and Kubernetes manifest render | Both passed; Kubernetes was not deployed |
| Knip dependency analysis | Passed with three configuration hints, no source finding |

The full 229-test suite passed after updating a pipeline test to express the new
confirmation behavior. The first restricted-shell attempt could not use Windows
temporary files; rerunning with a workspace temp directory succeeded. The npm
audit request was made with the user's earlier explicit authorization.

## How to check the local demo

1. Start Docker Desktop with its Linux engine. From the repository root run
   `npm ci`, then
   `docker compose --env-file .env.demo.example up -d --build --wait`.
2. Open <http://localhost:3000> and sign in with the demo engineer account shown
   in the README. `GET http://localhost:4010/api/ready` should return
   `{"ready":true}`. Prometheus is at <http://localhost:9090>, Grafana at
   <http://localhost:3001>, and Jaeger at <http://localhost:16686>.
3. Use the Failure Console to add a database-latency fault to payment-service.
   A fresh payment incident should appear after abnormal samples are confirmed.
   Open it, investigate, propose and approve the fault-clear action. Watch it
   move through verification to resolved; then request a postmortem.
4. For an automated end-to-end check in PowerShell, set
   `$env:SENTINELOPS_SMOKE_URL='http://127.0.0.1:4010'` and run
   `node scripts/stack-smoke.mjs`. It deliberately injects and clears a demo
   fault and can take several minutes.
5. Run `npm run test:coverage`, `npm run lint`, `npm run typecheck`,
   `npm run format:check`, and `npm run build` for source checks. On this Windows
   host, the tests require a writable temporary directory; use
   `$env:TEMP='D:\miniProject\SENTINELOPS\tmp\vitest-review'` if the default
   sandbox temp path gives an `EPERM` error.

`docker compose --env-file .env.demo.example down` stops the stack while
preserving its named volumes. Old incident records remain in the demo database;
they are not evidence of a new failure after this tuning.

## Limits and follow-up

The local demo uses mock AI/embeddings and simulated business database/cache
operations. Only clearing a named injected fault has a real remediation adapter;
restart, scale, rollback and cache-clear actions are proposals, not executable
operations. Static topology, a single correlation lock, broker/SQL at-least-once
delivery and fixed signal thresholds are deliberate local-demo choices. Cloud
Terraform, Kubernetes runtime behavior, remote model behavior, production
credentials and access policy, and multi-partition load limits were not verified.

Historical incidents opened during earlier noisy runs are preserved for review.
Their status is not automatically changed by detector tuning. Operators should
review and disposition them explicitly. Nine Compose services do not define a
Docker healthcheck, so “running” alone does not prove they are healthy; the API
readiness, service endpoints and workflow smoke test provide stronger evidence.

## Live validation

The final shared image was built once and deployed with
`docker compose --env-file .env.demo.example up -d --no-build --wait`. All 21
long-running containers are up; 12 report `healthy`, while nine have no Docker
healthcheck. The API returned `{"ready":true}` and the web login route returned
HTTP 200. Prometheus reported 13/13 active targets up. Jaeger listed all five
business services. Loki returned HTTP 200 from `/ready` after its startup wait.

The automated `scripts/stack-smoke.mjs` workflow passed: it rejected an invalid
fault request, opened a fresh payment incident from injected DB latency,
investigated, proposed the scoped fault-clear action, accepted one approval,
rejected a duplicate, observed verified recovery, and generated a postmortem.
The failure API then reported zero active injected faults and zero unreachable
business services. A historical incident, `INC-1093`, displayed four affected
services in its title and list, confirming the old-record title fix.

The deliberate smoke-test incident `INC-1140` ended in `POSTMORTEM`. After the
fault was cleared, five minutes of ordinary generated traffic stored **2,400
metric samples, zero anomalies and zero new incidents**. This is evidence that
the previous alert noise was reduced for the tested workload, not proof that
all future traffic patterns are calibrated. The database still contains 41
historical `DETECTED` and one `MITIGATION_REQUIRED` incident from earlier runs;
they were preserved for explicit review, not silently closed.

Docker Desktop briefly failed during a parallel Compose image export. Its logs
showed the WSL data VHD was already attached. A clean WSL/Docker stop and start
recovered the engine without deleting volumes. The subsequent single-image
build, deployment and live acceptance all passed.
