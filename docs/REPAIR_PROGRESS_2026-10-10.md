# SentinelOps repair progress — 10 October 2026

Historical checkpoint. Continued repairs and current results are recorded in
[the 11 October report](REPAIR_PROGRESS_2026-10-11.md). The coverage failure and
remaining source tasks below describe the previous checkpoint, not current status.

The architectural review identified 21 findings. Repairs now span all six phases,
with source changes and regression coverage. The project is **not yet release-ready**:
coverage remains below the original gate, and live container/database/broker/cloud
acceptance is unavailable on this host. No cloud resources were provisioned, no
operator account created, no retention run performed, and no commit made.

## Phase outcomes

| Phase | Implemented in this repair | Remaining acceptance |
| --- | --- | --- |
| 1: Runtime and tooling | Correct web imports; Next production build; retained tsx runtime; all Docker workspaces; separate backend/web/test typechecks; npm ci; CI image and integration checks; monitoring provisioning and ingress paths | Clean install/image startup, pinned collector/Loki validation; original coverage targets |
| 2: Durable state | Completion-after-processing; strict delivery/DLQ; SQL inbox/outbox; ordered stable envelopes; durable baselines with timestamps; bounded persisted correlation; terminal-state lock check; atomic lifecycle; migration locking/checksums; explicit bounded retention CLI | Real PostgreSQL/Kafka rollback, outage and replica/restart proof; old historical correlation policy; preflight existing approval duplicates |
| 3: Auth and actions | Explicit demo mode; authenticated admin API; production JWT/CORS guards; input validation; login throttle; authenticated expiring WS; guarded approval/rejection; durable execution/verification; frozen recovery signals and traffic bounds; scoped fault clearing; operator user creation | Distributed rate limit, live multi-replica fanout/approval races, account lifecycle, tolerance calibration, real infrastructure adapters |
| 4: Signals and AI | Interval metrics and instance identity; healthy baselines protected; UNKNOWN missing-data health; persistent provider-scoped retrieval; validated embeddings; selected evidence IDs only; provider fallback; bounded fault expiry; cancelled polling and freshness display | Live calibration and embedding/pgvector checks; direct data-store telemetry; application OTLP log exporter; WebSocket reconnection |
| 5: Deployment | Loopback Compose ports; data/monitoring PVC source; migration gates and dependency readiness; root Kustomize monitoring bundle; TLS Kafka support; stronger cloud defaults, DB backups and remote-state example | Terraform provider/region/version validation, production overlay/registry/secret wiring, PVC permissions and backup/restore/scale proof |
| 6: Proof and docs | Expanded regression suites; full fault-to-postmortem smoke script and CI logs/cleanup; corrected README/ADR/roadmap; current architecture reference | Original coverage targets, live smoke and outage/restart scenarios, current dependency/security audit |

The complete per-task checklist is [FIX_PLAN.md](FIX_PLAN.md). Runtime decisions and
tradeoffs are explained in [IMPLEMENTED_ARCHITECTURE.md](architecture/IMPLEMENTED_ARCHITECTURE.md).
The initial findings remain in [PROJECT_REVIEW_2026-10-09.md](PROJECT_REVIEW_2026-10-09.md).

## Finding disposition

| Finding | Repair and evidence | Open risk/check |
| --- | --- | --- |
| F01 | Intentional production source execution with retained tsx; Docker includes control-plane and optimized web | Docker Linux engine unavailable; image not started |
| F02 | Dedupe completion after handler; SQL inbox commits with effects; consumer/transaction regression tests | True DB crash-redelivery still requires live stack |
| F03 | Strict producer and confirmed DLQ; outbox only marked after send; full poison payload retained | Broker failure/restart acceptance |
| F04 | Only metrics.events is subscribed by detector | Live duplicate-count trace |
| F05 | Token-protected direct demo administration; role checks and audited platform mutations | Direct internal admin actions are not independently written to platform audit; treat internal token as privileged |
| F06 | Known accounts only in demo; strong production JWT guard; create-only operator CLI; login schema/limit | Distributed throttle and account rotation/revocation |
| F07 | JWT/origin checked upgrades; header protocols; expiry/backpressure; replica-specific groups | Live replica fanout, reconnect and old group cleanup |
| F08 | Incident lock, conditional PROPOSED claim, unique decision, durable job and audit | Mock orchestration race passed; actual Postgres concurrency/legacy constraint acceptance open |
| F09 | Exact action IDs, frozen pre-execution signals, complete fresh instance windows, traffic lower/upper bounds, two passes, timeout and failed-action loop | Live tolerance calibration; worker infrastructure-error retry policy |
| F10 | Correct plural coverage.thresholds flags; CI includes web build and all typechecks | Gate intentionally fails; no weakening/exclusion workaround |
| F11 | Pinned collector exporter fields repaired; Loki legacy schema disables incompatible structured metadata | Validate exact pinned container configuration/startup |
| F12 | Removed ingress rewrite to root; build-time browser URL documented | Browser through real ingress |
| F13 | Interval mean/delta rates, route filtering, instance keys, timestamp persistence; missing telemetry UNKNOWN | Idle latency intentionally emits no sample; direct DB/Redis instrumentation absent |
| F14 | Pipeline-state locking, persistent correlation, 500-evidence cap, terminal lock recheck, restart tests | Global lock throughput; very late events may form historical groups |
| F15 | Database retrieval, embedding selection, runbook prompt content, valid evidence/runbook IDs; deploy window | Live provider/store integration; 384-dimensional schema |
| F16 | clear_injected_fault action with enum and scoped DELETE; all unsupported real operations fail | Real operations require separately designed adapters and idempotency |
| F17 | Provisioned data sources/dashboard; API metrics; timing units; remove disconnected exporter jobs/receivers | Null demo alert delivery; external notification integration absent |
| F18 | Locked checked migrations, retained data PVCs, startup/readiness guards, bounded prune | Existing approval duplicate migration preflight, PVC/restart/backup verification |
| F19 | Private EKS defaults, mandatory strong DB password, TLS Redis/MSK, backups, required supported version inputs | Terraform absent; production delivery integration remains incomplete |
| F20 | Every demo fault bounded by TTL; automatic resource cleanup; network/load/delay behavior | DB/cache/backlog portions remain simulations; calibrate real workload effects |
| F21 | Fixed extensionless dashboard helper import; production build rendered all 11 pages | Live browser navigation still open |

## Verification

- Optimized Next production build: passed; all 11 routes/pages generated, with
  expected Next ESLint-plugin warning. Backend/source and test typechecks are run
  separately; final logs are stored below.
- Final full Vitest run: 117 tests passed across 26 files, including timestamp,
  correlation restart/closure, transport, auth, approval, frozen recovery, executor,
  vector persistence, embedding validation and migration cases.
- Original full-project coverage gate remains 80% lines/statements/functions and
  70% branches. The final measured aggregate was 40.35% lines/statements, 64.55%
  functions and 76.82% branches; it correctly exits nonzero. Much bootstrap,
  application/UI and integration behavior still lacks instrumented tests.
- Lint: no errors; import-order warnings subsequently fixed. Formatting:
  passed. Knip: passed after workspace configuration and unused dependencies/exports
  were corrected. Compose configuration and root Kustomize rendering: passed.
- Offline lockfile refresh: passed. A clean npm ci was not attempted because it
  replaces the installed dependency tree and network access is unreliable.
- Docker server: unavailable (`dockerDesktopLinuxEngine` pipe missing). This is
  an environment blocker; Docker Desktop's start command returned success but
  the Linux engine remained unavailable. Container smoke acceptance is not claimed.
- Terraform/psql executables: absent. Kubernetes render does not validate server-side
  resources or runtime behavior. Node 22.12 emits a dependency engine warning;
  use Node 22.13+ for the toolchain.

Evidence is retained under `docs/review-evidence-2026-10-09/`: `repair-coverage.log`,
`repair-typecheck.log`, `repair-test-typecheck.log`, `repair-lint.log`,
`repair-format.log`, `repair-knip.log`, and `kubernetes-rendered.yaml`. The directory
name is inherited from the original audit; repair logs are from 10 October.

The Loki compatibility choice preserves legacy BoltDB history and disables structured
metadata, consistent with [Grafana's Loki upgrade requirements](https://grafana.com/docs/loki/latest/setup/upgrade/).

## Continue from here

1. Raise meaningful coverage with application/ingestion/worker integration and UI
   behavior tests; keep the existing gate enforced. The gate will currently stop
   downstream CI image acceptance, correctly exposing incomplete validation.
2. Start the Docker Linux engine. Run `docker compose up -d --build --wait` and
   `node scripts/stack-smoke.mjs` against the isolated demo; inspect all monitoring
   targets. The script warms up healthy traffic, injects bounded DB latency, creates
   an incident, investigates, proposes/approves, rejects a second approval, waits
   for observed recovery and generates a postmortem, then clears the scoped fault.
3. Exercise broker outage, consumer/worker restart, real concurrent approvals,
   stale/partial telemetry, persistent store restart and multiple API replicas.
   Record actual results before checking off these acceptance tasks.
4. With Terraform installed, initialize without a backend and validate; select
   supported regional service versions, configure remote state/production secrets
   and release images, and review a cloud plan before any chargeable apply.

Operator provisioning uses `npm run auth:create-user -- EMAIL NAME ROLE`, with a
strong password supplied through `SENTINELOPS_OPERATOR_PASSWORD`; it hashes and
creates the user plus audit entry in a transaction and never overwrites an existing
account. Maintenance uses `node --import tsx packages/db/src/cli.ts prune 30` in
bounded batches; retention must exceed configured Kafka retention and at least
8 days. These commands were added, not executed against user data.
