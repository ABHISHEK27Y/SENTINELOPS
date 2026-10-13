# SentinelOps status recheck — 12 October 2026, 22:11 IST

This is a historical snapshot. See the [13 October final check](FINAL_CHECK_2026-10-13.md)
for the latest source verification, alert tuning and live-demo status.

## Latest snapshot — 13 October 2026, 14:34 IST

All 21 Compose containers are still running; 12 report passing healthchecks and
nine have no configured healthcheck. `GET /api/ready` returned `{"ready":true}`.
The database now contains **34 DETECTED** and **one MITIGATION_REQUIRED** incident
(**35 active**), plus three POSTMORTEM records. The newest, `INC-1100`, was
detected at 14:31 IST today. The alert-growth finding below therefore remains
open. Source tests, build, audit and monitoring checks in the rest of this report
were last run on 12 October; they were not rerun in this snapshot. The working
tree still has 184 modified, deleted or untracked status entries and no commit.

## Overall status

**The controlled local-demo workflow is implemented and passes acceptance. The
running demo is not yet operationally clean.** Its API, dashboard, stores and
monitoring backends respond, but the dashboard rose from 28 active incidents
at 22:09 to 30 at 22:11 and shows five UNHEALTHY business services. New
incidents opened during this review while the failure console reported no
active injected faults. Alert
sensitivity and incident disposition therefore remain follow-up work before the
default dashboard can be presented as a quiet healthy baseline.

The agreed delivery target is a **local demo only**. Nothing here establishes
production or cloud readiness. The six repair phases and implementation choices
are recorded in [FIX_PLAN.md](FIX_PLAN.md),
[REPAIR_PROGRESS_2026-10-12.md](REPAIR_PROGRESS_2026-10-12.md), and
[IMPLEMENTED_ARCHITECTURE.md](architecture/IMPLEMENTED_ARCHITECTURE.md).

## Fresh checks in this review

| Area | Result | Evidence or qualification |
| --- | --- | --- |
| Containers | 21/21 running; 12 report `healthy`, nine have no Docker healthcheck | [Container summary](review-evidence-2026-10-09/recheck-container-summary-2026-10-12.json) |
| API | `GET /api/ready` returned `{"ready":true}` on local port 4010 | Direct read-only request |
| Browser | Signed-in runbooks, services, payment-service detail, failure console, incident detail and dashboard rendered | [Dashboard capture](review-evidence-2026-10-09/recheck-dashboard-2026-10-12.png); runbooks tab restored afterward |
| Monitoring | Prometheus 13/13 active targets up; Jaeger lists all five business services; Loki ready | [Monitoring summary](review-evidence-2026-10-09/recheck-monitoring-2026-10-12.json) |
| Application logs | Loki query for payment-service returned two streams and nine entries in the prior 24 hours | [Loki query summary](review-evidence-2026-10-09/recheck-loki-summary-2026-10-12.json) |
| Tests and coverage | 49 files, 226 tests passed. Statements 86.38%, branches 77.11%, functions 80.56%, lines 88.23%; unchanged gates 80/70/80/80 passed | Local run log; latest results in [final check](FINAL_CHECK_2026-10-13.md) |
| Lint and types | ESLint and backend, web, test TypeScript checks passed | Local run logs; latest results in [final check](FINAL_CHECK_2026-10-13.md) |
| Production source build | Next 16.4 compiled, typechecked and prerendered all static routes; dynamic detail routes built | Local run log; latest results in [final check](FINAL_CHECK_2026-10-13.md) |
| Formatting and diff hygiene | Full Prettier check and `git diff --check` passed after excluding generated `next-env.d.ts` and formatting `tsconfig.json` | Local run log; latest results in [final check](FINAL_CHECK_2026-10-13.md) |
| Dependencies | Authorized npm advisory request returned zero vulnerabilities | [Fresh npm audit](review-evidence-2026-10-09/recheck-audit-2026-10-12.json) |
| Static dependency analysis | Knip exited successfully with three configuration hints | Local run log; latest results in [final check](FINAL_CHECK_2026-10-13.md) |
| Kubernetes source | Root Kustomize rendered successfully; no cluster deployment was attempted | [Rendered manifest](review-evidence-2026-10-09/recheck-kustomize-2026-10-12.yaml) |

The first test and build attempts in the restricted Windows shell hit sandbox
filesystem/loopback permission errors before product assertions could complete.
The same coverage suite and build passed when rerun with the needed local file
and loopback access. The first npm audit attempt could not resolve the registry;
the authorized network retry succeeded. These failed attempts are retained as
evidence, not counted as application failures.

## Architecture and phase assessment

| Phase | Current assessment |
| --- | --- |
| Runtime | Local Compose image and Next dashboard run. Backend keeps TypeScript source plus `tsx` in the image; frontend uses a production Next build with API/WS URLs baked in. This is a conscious image-size/startup tradeoff. |
| Durable event/state path | Kafka at-least-once delivery, SQL inbox/outbox, guarded incident transitions, persisted detector/correlation state and recovery jobs are implemented. Prior live tests passed rollback, concurrent inbox delivery, outbox retry and confirmation, broker interruption and SQL/Redis restarts. These destructive scenarios were reviewed from evidence rather than rerun against today's retained incident history. |
| Access and remediation | JWT roles, demo-only fault administration, SQL-backed login throttling and authenticated WebSockets are implemented. Prior live tests passed two-replica fanout, shared throttling, approval race, rejection and worker restart. The sole real demo action clears a named injected fault; restart/scale/rollback executors are not implemented. |
| Signals and investigation | Real HTTP/process signals reach Kafka and PostgreSQL; detector and correlation are deterministic; runbooks are indexed through pgvector. Business DB/cache operations and several faults are simulated. Mock AI/embeddings make the local demo self-contained; remote model behavior was not exercised. Current monitoring feeds respond, but normal-load alert calibration needs work. |
| Deployment | Persistent local stores, migration gates and loopback-published ports run. Prior isolated backup/restore verified 11 incidents, eight migrations and 18 runbook chunks. Kubernetes manifests render; PVC operation and AWS/Terraform deployment remain untested. |
| Proof and documentation | Source checks, full coverage, build, audit, browser and live monitoring rechecked. The earlier fault-to-postmortem, fresh two-window recovery, duplicate-approval rejection and outage tests passed. The new running-state finding below narrows any claim that the default demo is fully polished. |

## Open findings, in priority order

1. **P1 — Active incident noise under the default workload.** At 22:09 SQL
   counted 27 `DETECTED`, one `MITIGATION_REQUIRED`, and three completed
   `POSTMORTEM` incidents. The dashboard then rose from 28 to 30 active incidents
   by 22:11. It showed zero of seven services HEALTHY, five business services
   UNHEALTHY, and PostgreSQL/Redis UNKNOWN because they have no direct telemetry
   feed. Incidents
   `INC-1092` and `INC-1093` were detected at 21:48 and 21:53 IST, respectively;
   `INC-1094` and `INC-1095` appeared by 22:11, while the failure console showed
   no active injected faults. In the preceding
   hour, anomalies included 106 `queue_depth`, 54 `cpu_usage`, 15 HTTP duration
   and nine request-rate points. Recent notification queue anomalies recorded a
   depth of **1 against baseline 0**; recent CPU points were roughly 0.23–0.36
   against 0.09–0.13 baselines. This suggests normal workload/sampling variation
   is still opening incidents, but each anomaly has not been independently
   classified as false. Add a fault-free calibration run, duration/hysteresis for
   transient queue depth, workload-aware CPU/request thresholds, and an explicit
   audited disposition process. Preserve incident history until reviewed.
2. **P2 — Incident title can lag correlation.** The detail page for `INC-1093`
   still said “1 service affected” while its affected list contained
   order-service, notification-service and api-gateway. Display the current
   affected-service count or update the title as correlation expands.
3. **P2 — Tooling cleanup.** Knip reports three configuration hints. The host
   has Node 22.12.0 and npm 11.6.0, while a lint dependency asks for Node
   22.13+ and the root declares npm 10.8.2. Current commands passed, but aligning
   local tooling would remove avoidable warnings and reproducibility drift.
4. **Deferred production work.** Real infrastructure executors, production
   credentials and access policy, remote-provider tests, workload-specific
   thresholds, cloud/Terraform validation, Kubernetes PVC runtime, multi-partition
   scale benchmarks, and monitoring access policy were outside the local-demo
   authorization. The npm audit only covers known advisories for resolved npm
   dependencies; it is not a full security assessment.

The working tree contains extensive modified and new source files from the repair
phases. No checkpoint commit or pull request has been created. The local stack
was not reset, volumes were not deleted, and no fault was injected during this
read-only recheck.
