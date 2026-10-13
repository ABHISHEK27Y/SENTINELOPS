# SentinelOps phased repair plan

Started 9 October 2026; updated 13 October 2026. Source: PROJECT_REVIEW_2026-10-09.md.
Checked items mean implemented and supported by source, test, build or live
evidence. All six phases meet the agreed local-demo acceptance scope; remaining
cloud and production scale work is explicitly deferred.
The later [running-state recheck](STATUS_RECHECK_2026-10-12.md) found ongoing
default-workload incident noise. Alert calibration and a longer fault-free
observation now pass; see the [final check](FINAL_CHECK_2026-10-13.md).
Historical incidents remain for explicit operator disposition.
Delivery target: local demo only, as confirmed by the user. Cloud release tasks
are deferred and do not block this scope. Live local acceptance has passed.
See REPAIR_PROGRESS_2026-10-12.md for current evidence and architectural tradeoffs.

## Phase 1 — Reproducible runtime and verification

- [x] F21: fixed dashboard imports; completed production Next build.
- [x] F01: retain production tsx, include all workspaces, use next start.
- [x] F04: detector consumes normalized telemetry once.
- [x] F12: ingress preserves API and WebSocket paths.
- [x] F17: Grafana provisioning, API metrics, detector duration units, remove unsupported exporter jobs.
- [x] F10: CI uses npm ci and web checks; original coverage targets are met without exclusions or threshold reductions.
- [x] F11: collector/Loki configuration repaired and validated with pinned binaries; collector started.
- [x] Clean offline npm ci in an isolated manifest copy, including lifecycle scripts; working dependencies preserved.
- [x] Calibrated Docker image built and deployed in the local stack; hidden process-service startup helper added.

## Phase 2 — Durable events and incident state

- [x] F02/F03: completion-after-processing dedupe; confirmed DLQ delivery; transactional inbox/outbox; stable ordered publication.
- [x] Transactional lifecycle writes with legal/expected-state guards.
- [x] F18: migration lock/checksum/rollback safety; schema constraints; bounded operator retention CLI.
- [x] Regression coverage for duplicate completion, DLQ failure, rollback, outbox confirmation and migration failure.
- [x] F14: persisted global watermark, bounded lateness, old-event archival and future-event rejection; restart/closure regressions.
- [x] Existing duplicate approval preflight before schema constraint migration; no automatic deletion of history.
- [x] Live PostgreSQL partial-write rollback, deduplication, outbox delivery retry, state-race, Kafka interruption/recovery and persisted SQL marker acceptance.
- Deferred production hardening: forced broker crash/redelivery under multi-partition load.

## Phase 3 — Access control and remediation safety

- [x] F05/F06: explicit demo mode, authenticated fault administration, startup guards, login schema and shared PostgreSQL throttle with fail-closed behavior; safe operator user-creation CLI.
- [x] F07: authenticated/origin-checked WebSocket upgrades, session expiry, per-replica fanout grouping and slow-client bounds.
- [x] F08: guarded approval/rejection, durable queued execution and audit decisions.
- [x] F09: exact action identity; fresh complete distinct verification windows; missing-data timeout and failed-execution recovery.
- [x] F16: explicitly scoped demo actions; unsupported real actions fail; enum validation and HTTP timeout.
- [x] Unauthorized/viewer access, competing approval, rejection, missing recovery and restart-state orchestration tests.
- [x] Freeze recovery signals before execution and persist them across restarts; request traffic must return within both baseline bounds; executor lookup failures recorded.
- [x] Investigation/postmortem require ENGINEER/ADMIN and lock current lifecycle state before mutation.
- [x] Real database concurrency/worker restart, shared-throttle and multi-replica WS acceptance; live metric tolerance calibration.

## Phase 4 — Signals, simulations and investigation

- [x] F13: interval latency/error/request rates, operational-route filtering, instance identity and UNKNOWN for absent telemetry.
- [x] Healthy detector baseline retained during sustained anomalies and restored after restart.
- [x] F15: durable provider-scoped retrieval, explicit embedding provider, retrieved prompt context, validated evidence selection and deployment window.
- [x] F20: bounded fault expiry, resource cleanup and simulated gauge reset.
- [x] Frontend expired-auth logout, request cancellation and dashboard freshness/error indication.
- [x] HTTP timeout budgets and documentation of simulated dependency operations.
- [x] Persistent retrieval validates vectors before replacement, bounds query limits and counts reindexed sources correctly; embedding and persistence boundary regressions.
- [x] Browser WebSocket reconnection, in-memory auth fallback, native headers and accurate login failure messages; meaningful rendered page/auth tests.
- [x] Business-service OTLP log export wired; telemetry publication and notification shutdown await in-flight work.
- [x] Live signal/recovery calibration, persisted pgvector corpus, collector/Loki ingestion, Prometheus and Jaeger acceptance. Remote embedding providers are optional for this local demo.

## Phase 5 — Deployment hardening

- [x] F18: local PVC source, migration startup gates, consumer/database readiness and monitoring bundle; root Kustomize renders.
- [x] F19: remove default DB password and expired version defaults; TLS Redis/MSK, private EKS defaults and backup settings; Kafka TLS client support.
- [x] Recorded local build-time browser URLs and remote-state/secret/release inputs.
- Deferred outside local-demo scope: Terraform provider/region validation, production overlay, registry images, external secrets, monitoring auth/network policy and provider lockfile.
- [x] Live persistent-store restart, isolated backup/restore and local API replica acceptance.
- Deferred outside Compose scope: Kubernetes PVC permission and production scale benchmarks.

## Phase 6 — End-to-end proof and documentation

- [x] Added transport, persistence, auth, administration, approval, recovery, evidence-grounding and provisioning regressions.
- [x] Added full fault-to-postmortem smoke script and CI stack diagnostics/cleanup.
- [x] Updated README, runtime ADR, roadmap caveats and implemented architecture document.
- [x] Final coverage gate: 230 tests; 88.30% lines, 86.46% statements, 80.62% functions, 77.36% branches. Thresholds unchanged.
- [x] Execute smoke script on a live stack, including authenticated fault injection, investigation, approval, duplicate rejection, fresh recovery and postmortem.
- [x] Live outage, worker restart, multi-replica, missing-data and rejection scenarios passed.
- [x] User explicitly authorized npm advisory submission; affected dependencies upgraded and final audit reports zero vulnerabilities.
- [x] Live fault-to-postmortem workflow, duplicate approval rejection, isolated SQL rollback/dedupe/outbox/lifecycle race, and isolated backup/restore passed.
- [x] Full-suite pass, calibrated deployment, Loki application-log query and browser sign-in/navigation acceptance.
- [x] Post-calibration live smoke test and 8-minute-31-second fault-free observation: 4,080 metric samples, zero anomalies and zero new incidents.
- Deferred outside local-demo scope: production release acceptance.

## Decisions

- Demo business operations remain simulated; real infrastructure remediation is an extension, not claimed as implemented.
- Backend production uses tsx source execution; web uses a production Next build.
- Database inbox/outbox provide durable at-least-once publication with idempotent effects, not exactly-once across Kafka and SQL.
- Global correlation/outbox locks prioritize correctness over throughput; validate scale before optimizing.
- No cloud resources provisioned, operator accounts created, retention executed or changes committed during these source repairs.
