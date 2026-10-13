# SentinelOps

**AI-Powered Distributed Observability & Autonomous Incident Response Platform**

**New to the stack?** Start with the [18-chapter Hinglish learning guide](docs/LEARN_SENTINELOPS_FROM_ZERO.md). It explains the project from web basics to distributed-system reliability, with code links, exercises and a clear boundary between the working local demo and production plans.

SentinelOps is a "software-system doctor". It watches a fleet of microservices,
detects abnormal behaviour from **real telemetry**, correlates related anomalies
into a single **incident**, reasons about the **root cause**, explains it with an
LLM grounded in retrieved runbooks, proposes **remediation**, gates risky actions
behind **human approval**, executes approved actions, and **verifies recovery** —
then drafts an incident report and postmortem.

HTTP timing, process resource measurements, Kafka transport and PostgreSQL storage
are real. Business database/cache operations and several dependency faults are
simulated. Approved demo remediation clears one named injected fault; real restart,
scaling and rollback executors are not implemented.

---

## Why it's interesting (engineering depth)

- **Observability**: OpenTelemetry traces/metrics → collector → Prometheus/Jaeger;
  structured application error logs → Kafka → PostgreSQL. Loki accepts external
  OTLP logs; business-service application logs now have a batched OTLP exporter.
  Collector/Loki ingestion was verified in the local stack with stored
  payment-service application logs.
- **Event-driven core**: Kafka event bus with typed envelopes, consumer groups,
  DLQ, and idempotency.
- **Deterministic detection**: rolling statistical baselines. Isolation Forest is
  a future design. LLM selections are validated against collected evidence and
  retrieved guidance; arbitrary model prose is not published as telemetry.
- **Incident correlation**: many anomalies → one incident, using time windows,
  a static service dependency graph and time windows.
- **Human-in-the-loop remediation**: approval-gated actions, fully audited.
- **Self-observability**: SentinelOps emits its own health metrics.

Full design: [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md).

---

## Tech stack

| Area | Choice |
| --- | --- |
| Frontend | Next.js, TypeScript, Tailwind, React Flow, Recharts, Zustand |
| Backend | Node.js + TypeScript (Fastify) |
| Data | PostgreSQL (+ pgvector), Redis |
| Streaming | Apache Kafka (KRaft) |
| Observability | OpenTelemetry, Prometheus, Grafana, Jaeger |
| Detection | Statistical z-score detector; no Python runtime |
| AI/RAG | pgvector retrieval + LLM (mockable, no key required for local dev) |
| Infra | Docker Compose, local Kubernetes bundle, unverified AWS Terraform scaffold |
| CI/CD | GitHub Actions |

---

## Repository layout

```
sentinelops/
├── apps/
│   ├── web/                 # Next.js SRE dashboard (Phase 14)
│   └── api/                 # Platform API: REST/WS, JWT, RBAC (Phase 15)
├── services/                # data-plane + control-plane services (Phase 2+)
├── packages/
│   ├── shared-types/        # ✅ event envelopes, enums, domain models (zod)
│   ├── logger/              # ✅ structured JSON logging (pino)
│   ├── config/              # ✅ validated env + configurable severity model
│   └── service-kit/         # service template: Fastify + OTel + metrics + faults
├── infrastructure/
│   ├── db/migrations/       # ✅ PostgreSQL schema (pgvector)
│   ├── docker/              # ✅ infra compose (pg/redis/kafka/prom/grafana/jaeger)
│   ├── kubernetes/          # manifests (Phase 17)
│   └── terraform/           # AWS infra (Phase 18)
├── monitoring/
│   ├── prometheus/          # ✅ scrape config
│   ├── grafana/             # dashboards / provisioning
│   └── otel/                # ✅ collector config
├── docs/architecture/       # ✅ ARCHITECTURE.md (diagrams, topics, DB, roadmap)
└── docker-compose.yml       # full stack (Phase 3)
```

✅ = implemented so far. See the roadmap table in `ARCHITECTURE.md` for the rest.

---

## Quick start

Requirements: Node 22.13+ and a running Docker Linux engine. This repository's
verified target is the local demo.

```bash
# 1. Install workspace deps
npm ci

# 2. Check the source
npm run typecheck
npm run test:coverage
npm run lint
```

### Run the full stack

```bash
docker compose --env-file .env.demo.example up -d --build --wait
```

This brings up infrastructure + all data-plane services + the control plane + the
platform API + the Next.js dashboard + a traffic generator.

| Surface | URL |
| --- | --- |
| **Dashboard** | http://localhost:3000 (login `engineer@sentinelops.dev` / `engineer123`) |
| Platform API | http://localhost:4010/api/ready |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 |
| Jaeger | http://localhost:16686 |

**Demo:** open the dashboard → **Failure Console** → *Increase DB Latency*. Watch an
incident appear under **Incidents**, open it, click **Run AI investigation**, then
**Propose remediation** → **Approve**, and see recovery verified and the incident
resolved. The whole loop runs on real telemetry through Kafka into Postgres.

Run `SENTINELOPS_SMOKE_URL=http://127.0.0.1:4010 node scripts/stack-smoke.mjs`
to exercise the complete local workflow. In PowerShell, set the variable with
`$env:SENTINELOPS_SMOKE_URL='http://127.0.0.1:4010'` first. The smoke test
injects a demo fault, approves its cleanup and waits for verified recovery.
Tear down with `docker compose --env-file .env.demo.example down`; this keeps
the named database volumes.

---

## Development status

Repairs are tracked in [the six-phase checklist](docs/FIX_PLAN.md), based on the
[architecture review](docs/PROJECT_REVIEW_2026-10-09.md). The last fully passing
coverage run passed 230 tests: 88.30% lines, 86.46% statements, 80.62% functions
and 77.36% branches. The original coverage gate remains unchanged.
See the [12 October repair report](docs/REPAIR_PROGRESS_2026-10-12.md).

- Shared packages: `shared-types`, `logger`, `config`, `service-kit`, `kafka`, `db`,
  `detection`, `correlation`, `root-cause`, `rag`, `remediation`, `ai`.
- Data plane: `api-gateway`, `user/order/payment/notification-service`, `loadgen`.
- Control plane: `anomaly-engine`, `incident-engine`, `ingestor`, `event-tap`.
- Apps: `apps/api` (Fastify + JWT/RBAC + WS), `apps/web` (Next.js SRE dashboard).
- Infra: Docker Compose, Kubernetes (`infrastructure/kubernetes`), Terraform
  (`infrastructure/terraform`), GitHub Actions (`.github/workflows/ci.yml`).

The local stack, fault-to-postmortem workflow, database and backup/restore checks,
replica and interruption scenarios, monitoring and dashboard navigation have
passed. The authorized dependency audit reports zero vulnerabilities. See the
[latest final check](docs/FINAL_CHECK_2026-10-13.md) for current results and
remaining limits. Cloud deployment is deferred.

Demo mode is explicit (`DEMO_MODE=true`); known users are seeded only in this mode.
Fault administration requires the internal token configured in demo Compose.
Production disables demo administration and requires a strong JWT secret and
explicit CORS origins. Production account lifecycle management and real remediation adapters
remain release work.

---

## Security notes

- Secrets come from environment variables and are redacted from logs.
- Remediation is approval-gated with an audit trail (`audit_log`).
- The npm advisory audit found no known vulnerabilities in the resolved
  dependencies on 13 October 2026. Audit results are time-sensitive.

---

## License

MIT © Abhishek Yadav
