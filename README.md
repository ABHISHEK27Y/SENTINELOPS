# SentinelOps

**AI-Powered Distributed Observability & Autonomous Incident Response Platform**

SentinelOps is a "software-system doctor". It watches a fleet of microservices,
detects abnormal behaviour from **real telemetry**, correlates related anomalies
into a single **incident**, reasons about the **root cause**, explains it with an
LLM grounded in retrieved runbooks, proposes **remediation**, gates risky actions
behind **human approval**, executes approved actions, and **verifies recovery** —
then drafts an incident report and postmortem.

> This is a serious distributed-systems project, not a dashboard or an AI wrapper.
> Telemetry actually flows, Kafka actually transports events, Postgres actually
> stores state, and anomaly detection runs on collected data — not static JSON.

---

## Why it's interesting (engineering depth)

- **Real observability**: OpenTelemetry traces/metrics/logs → OTel Collector →
  Prometheus + Jaeger.
- **Event-driven core**: Kafka event bus with typed envelopes, consumer groups,
  DLQ, and idempotency.
- **Deterministic detection, LLM reasoning**: statistics + Isolation Forest detect
  anomalies; LLMs only explain, retrieve, and summarize — every claim cites
  evidence.
- **Incident correlation**: many anomalies → one incident, using time windows,
  the service dependency graph, and shared trace ids.
- **Human-in-the-loop remediation**: approval-gated actions, fully audited.
- **Self-observability**: SentinelOps emits its own health metrics.

Full design: [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md).

---

## Tech stack

| Area | Choice |
| --- | --- |
| Frontend | Next.js, TypeScript, Tailwind, React Flow, Recharts, Zustand |
| Backend | Node.js + TypeScript (Fastify), Python (FastAPI) for ML/AI |
| Data | PostgreSQL (+ pgvector), Redis |
| Streaming | Apache Kafka (KRaft) |
| Observability | OpenTelemetry, Prometheus, Grafana, Jaeger |
| ML | scikit-learn (Isolation Forest), statistical detectors |
| AI/RAG | pgvector retrieval + LLM (mockable, no key required for local dev) |
| Infra | Docker, Docker Compose, Kubernetes, Terraform (AWS-ready) |
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

## Quick start (current state — Phase 1)

Requirements: Node ≥ 20, Docker, (Python 3.11+ for ML services later).

```bash
# 1. Install workspace deps
npm install

# 2. Configure env
cp .env.example .env

# 3. Typecheck + run unit tests
npm run typecheck
npm test

# 4. Bring up infrastructure (Postgres, Redis, Kafka, Prometheus, Grafana, Jaeger)
npm run infra:up
```

### Run the full stack

```bash
docker compose up -d --build
```

This brings up infrastructure + all data-plane services + the control plane + the
platform API + the Next.js dashboard + a traffic generator.

| Surface | URL |
| --- | --- |
| **Dashboard** | http://localhost:3000 (login `engineer@sentinelops.dev` / `engineer123`) |
| Platform API | http://localhost:4000/api/health |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 |
| Jaeger | http://localhost:16686 |

**Demo:** open the dashboard → **Failure Console** → *Increase DB Latency*. Watch an
incident appear under **Incidents**, open it, click **Run AI investigation**, then
**Propose remediation** → **Approve**, and see recovery verified and the incident
resolved. The whole loop runs on real telemetry through Kafka into Postgres.

Tear down with `docker compose down` (infra only: `npm run infra:up` / `infra:down`).

---

## Development status

**All 22 phases are implemented.** The code compiles (typecheck clean across the
backend workspace *and* the Next.js app) and the pure logic is covered by **41 passing
unit tests**. See the [roadmap](docs/development/00-roadmap.md) for per-phase status.

- Shared packages: `shared-types`, `logger`, `config`, `service-kit`, `kafka`, `db`,
  `detection`, `correlation`, `root-cause`, `rag`, `remediation`, `ai`.
- Data plane: `api-gateway`, `user/order/payment/notification-service`, `loadgen`.
- Control plane: `anomaly-engine`, `incident-engine`, `ingestor`, `event-tap`.
- Apps: `apps/api` (Fastify + JWT/RBAC + WS), `apps/web` (Next.js SRE dashboard).
- Infra: Docker Compose, Kubernetes (`infrastructure/kubernetes`), Terraform
  (`infrastructure/terraform`), GitHub Actions (`.github/workflows/ci.yml`).

The only thing not yet demonstrated **live** is the containers running end-to-end,
which is blocked on the local Docker environment (a stuck Docker Desktop / WSL socket
subsystem needing a reboot — see the [Phase 3 log](docs/development/phase-03-docker-stack.md)),
not on the code.

---

## Security notes

- Secrets come from environment variables and are redacted from logs.
- Remediation is approval-gated with an audit trail (`audit_log`).
- Known dev-only advisories: the Vitest/Vite/esbuild test toolchain has moderate
  advisories affecting only the local dev server (not shipped code). The current
  patched line (Vitest 5) fails to install its native binding on Windows, so the
  stable 2.x line is pinned; this affects tests only, never production images.

---

## License

MIT © Abhishek Yadav
