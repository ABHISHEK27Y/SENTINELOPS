# SentinelOps: current repair report — 11 October 2026

> Historical checkpoint, superseded by [12 October report](REPAIR_PROGRESS_2026-10-12.md).
> Docker subsequently started, live workflow and database checks passed, and the
> explicitly authorized npm audit reports zero vulnerabilities. The blockers and
> verification counts below describe this earlier checkpoint.

## Completion status

**Not fully complete.** The implemented repairs pass the final source checks,
clean dependency installation, dashboard build and original coverage gate. Live
local-demo acceptance is blocked by Docker Desktop crashing before its Linux
engine starts. A current vulnerability audit also awaits the user's authorization
to submit dependency metadata to the public npm advisory service.

The user selected **local demo only**. Cloud deployment, Terraform provider
selection, production secrets/registry wiring and real infrastructure remediation
are deferred extensions, not prerequisites for this delivery target. No cloud
resources were provisioned, no existing accounts overwritten, no data retention
performed, and no changes committed or published.

## What we are building, in plain language

SentinelOps demonstrates how a team can detect and respond to problems across
several small services. Generated traffic calls a gateway, which calls user,
order, payment and notification services. Each service reports request timing,
errors and process measurements. Those measurements travel through Kafka, are
stored in PostgreSQL, and are compared with the service's healthy baseline.

An unusual measurement becomes an anomaly. The incident engine combines related
anomalies using time and the known service dependency graph. The dashboard lets
an engineer examine the evidence and run an investigation grounded in stored
runbooks. An engineer approves a proposed demo recovery action, a worker executes
it, and recovery must be demonstrated by fresh measurements before resolution.
A postmortem records the evidence and outcome.

The default demo can use deterministic investigation and mock embeddings without
paying for an external AI provider. Request timing, process measurements, event
transport and database storage are real. Business database/cache operations and
several dependency faults are simulations. Approved demo recovery clears one
named injected fault; it does not restart cloud servers or scale production apps.

## Stack and architectural decisions

| Component | Purpose and decision |
| --- | --- |
| TypeScript/npm workspaces | Shared types and libraries keep event, incident and remediation contracts consistent across services. |
| Fastify | Business-service and platform HTTP APIs; JWT reads and engineer/admin mutation permissions. |
| Next.js/React | Dashboard pages, incident evidence, failure console and approvals. Production builds generate 11 routes/pages. |
| Kafka | Event transport between independent processes. Publication can repeat after a crash, so stable identities and idempotent effects are required. |
| PostgreSQL | Durable telemetry, incidents, actions, audit history, baselines, correlation state, shared login throttles and transactional inbox/outbox. |
| Redis | Bounded completion/deduplication state and demo dependency behavior; SQL provides durable effects. |
| pgvector | Provider-scoped runbook retrieval with validated 384-dimensional embeddings. |
| OpenTelemetry/Prometheus/Jaeger/Loki/Grafana | Export, collect and inspect metrics, traces and logs. Business-service OTLP log wiring is implemented; live ingestion is unverified. |
| Docker Compose | Agreed local-demo runtime, with loopback-bound published ports and persistent stores. |
| Kubernetes/Terraform | Deployment source is retained. Kubernetes renders locally; cloud release configuration remains deferred. |

Backend production executes TypeScript source using the retained `tsx` runtime;
the dashboard runs an optimized Next build. Global correlation/outbox locks
prioritize correctness over throughput. Browser API/WebSocket URLs are build-time
inputs. The implemented architecture and tradeoffs are described in
[IMPLEMENTED_ARCHITECTURE.md](architecture/IMPLEMENTED_ARCHITECTURE.md).

## Six-phase results

| Phase | Implemented and checked | Remaining local acceptance |
| --- | --- | --- |
| 1 — Runtime and verification | Imports/runtime dependencies/workspaces, separate typechecks, clean offline installation, production build, CI verification, monitoring and ingress source | Build/start shared image; validate pinned collector/Loki containers |
| 2 — Durable events and state | Completion-after-processing, confirmed DLQ, SQL inbox/outbox, ordered publication, legal transactional lifecycle, checksummed/locked migrations, duplicate-approval preflight, persisted lateness policy | Actual PostgreSQL/Kafka crash-redelivery, rollback, partition/restart and race scenarios |
| 3 — Access and remediation | Explicit demo mode, internal-token administration, role checks, shared fail-closed login throttle, authenticated expiring sockets, guarded approvals, durable execution, frozen recovery cohort and fresh complete windows | Live concurrent approvals, worker restart, shared throttle and replica fanout; recovery tolerance calibration |
| 4 — Signals, AI and UI | Interval metrics, healthy-baseline protection, UNKNOWN missing data, persistent validated retrieval, grounded investigation, TTL fault cleanup, reconnect, auth fallback and accurate error/freshness display, OTLP log export | Live workload/pgvector/collector validation and browser interactions |
| 5 — Local deployment | Loopback ports, store/monitoring persistence source, readiness/migration gates and successful root Kubernetes render | Volume permissions, persistent restart and backup/restore behavior |
| 6 — Proof and documentation | 190 regressions, original coverage gate passed, smoke-script transport scenarios, current architecture and per-task checklist | Real fault-to-postmortem smoke and outage/restart acceptance; authorized dependency audit |

The detailed checklist is [FIX_PLAN.md](FIX_PLAN.md). The original 21 findings
remain in [PROJECT_REVIEW_2026-10-09.md](PROJECT_REVIEW_2026-10-09.md). The
[10 October report](REPAIR_PROGRESS_2026-10-10.md) is a historical checkpoint.

## Additional fixes since the previous checkpoint

1. Replaced the per-process login limiter with an atomic PostgreSQL throttle,
   shared by replicas, using hashed IP keys, expiry, bounded cleanup and Retry-After.
   Database failure returns 503 instead of admitting unlimited attempts.
2. Persisted a global correlation watermark even after all groups close.
   Events beyond the one-minute lateness budget or five-minute receipt age are
   archived without creating historical incidents. Excessively future events are
   rejected. Restarts preserve the policy and legacy snapshots remain readable.
3. Guarded investigation/postmortem mutations by engineer/admin role and locked
   current lifecycle state before writes, preventing stale-read transitions.
4. Added bounded WebSocket reconnect, in-memory token fallback when browser
   storage fails, native header merging, accurate login errors and Next route
   parameter handling compatible with the installed React version.
5. Wired batched OTLP application log export for business services. Shutdown now
   drains telemetry publication and notification work before disconnecting.
   Health listeners reject bind errors; failed metrics collection returns 503.
6. Added startup, actual Fastify workflow, pipeline, rendered-page, transport,
   script, telemetry and lifecycle regressions. Migration preflight reports
   historical duplicate approvals without deleting decision history.

## Final verification and evidence

| Check | Observed result |
| --- | --- |
| Original CI coverage command | Passed: 190 tests across 41 files; 86.18% statements/lines, 81.31% functions, 83.53% branches |
| Coverage requirements | Unchanged: 80% statements/lines/functions and 70% branches; no coverage exclusion workaround |
| Backend, web and test typechecks | Passed as part of `npm run build` |
| Dashboard production build | Passed; all 11 routes/pages generated |
| ESLint | Passed with no remaining errors or warnings |
| Prettier | Passed |
| Knip | Passed |
| Clean dependency install | Passed: offline `npm ci`, lifecycle scripts enabled, 859 packages in an isolated manifest copy |
| Compose source | `docker compose config --quiet` passed |
| Kubernetes source | `kubectl kustomize .` passed |
| Docker engine/live stack | Blocked: Desktop startup crash and missing Linux engine pipe |
| Public vulnerability audit | Not performed; authorization pending after automatic review rejection |

The original install remained intact; the temporary clean-install copy was
removed after verification. The first sandbox-cache attempt failed because a
tarball was missing; the host cache completed the installation offline. No npm
audit was submitted as part of that install.

An initial final test run had one five-second startup timeout while installation
and build competed for resources. A reduced-worker run passed all 190 tests,
followed by the actual CI coverage command passing with the unchanged thresholds.
Its measured branches are 83.53%; the preceding run measured 83.44%.

Evidence is in `docs/review-evidence-2026-10-09/`, whose directory name is inherited
from the initial review: `final-coverage-2026-10-11.log`,
`final-build-2026-10-11.log`, `final-lint-2026-10-11.log`,
`final-format-2026-10-11.log`, `final-knip-2026-10-11.log`,
`final-clean-install-2026-10-11.log` and `final-kustomize-2026-10-11.yaml`.

The host uses Node 22.12 and npm 11.6. One installed lint dependency declares a
Node requirement of 22.13+ (or supported newer versions); use Node 22.13+ for a
compatible toolchain. Installation also emits dependency deprecation notices.
These notices do not constitute a completed vulnerability audit. Next reports
its ESLint plugin is absent; independent ESLint and typechecking passed.

## What the tests do and do not prove

HTTP workflow tests use actual Fastify handlers with substituted downstream
transport. Pipeline/API startup tests substitute database/broker boundaries.
Dashboard tests render components with controlled state; they do not prove
interactive browser navigation. Smoke-script tests verify its transport sequence
and cleanup; they do not execute the actual container stack. Aggregate coverage
also leaves some startup/CLI/polling paths untested. Live migrations, Kafka
delivery behavior, pgvector indexing, monitoring ingestion and restart persistence
must still be observed on running dependencies.

## Docker blocker and remaining work

Docker Desktop's backend log and the user's screenshot agree on this failure:
startup cannot rename `C:/Users/ASUS/AppData/Local/Docker/run/sailor-ingest.sock`
to `sailor-ingest.sock.stale` because Windows cannot access the file. Starting
Desktop in the background did not bring up the engine. No factory reset, volume
deletion, WSL reset or operating-system reboot was performed.

Once Docker is operational, the remaining local sequence is:

1. Run `docker compose up -d --build --wait` and inspect service/monitoring health.
2. Run `node scripts/stack-smoke.mjs`. It warms up traffic, injects a bounded
   fault, investigates, proposes/approves, rejects a duplicate approval, verifies
   observed recovery, writes a postmortem and clears the scoped fault.
3. Exercise broker outage/redelivery, consumer and worker restart, real concurrent
   approvals, stale/partial telemetry, multiple API replicas and persistent store
   restart. Record actual evidence and failures before marking acceptance complete.
4. Verify collector/Loki/Prometheus/Grafana ingestion and interactive dashboard
   flows, then perform the dependency audit if its metadata submission is authorized.

Automatic approval review rejected `npm audit` because it could transmit private
workspace package names and versions to the public advisory service. The explicit
authorization question remains unanswered, so the audit was not retried.
