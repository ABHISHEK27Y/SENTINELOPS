# Development Roadmap

The project is built in verifiable phases. Each phase ends with: it compiles
(`npm run typecheck`), its tests pass (`npm test`), it actually runs, and a short
build log is written under `docs/development/`.

**Legend**: ✅ done · 🟡 in progress · ⚪ planned

| Phase | Deliverable | Status | Build log |
| --- | --- | --- | --- |
| 1 | Repo, shared packages (types/logger/config), DB schema, infra compose | ✅ | [phase-01](phase-01-foundation.md) |
| 2 | Demo microservices via `service-kit` (health/metrics/traces/logs/faults) | ✅ | [phase-02](phase-02-microservices.md) |
| 3 | Full `docker-compose.yml` (infra + all services + Prom/Grafana/Jaeger) | 🟡 | [phase-03](phase-03-docker-stack.md) |
| 4 | Kafka event pipeline (producers/consumers, DLQ, idempotency) + migration runner | ✅ | code + unit tests |
| 5 | Telemetry ingestion + Prometheus/Jaeger wiring + SentinelOps self-metrics | ✅ | `ingestor` service (telemetry/logs → Postgres, republish metrics.events) |
| 6 | Anomaly engine (z-score/EWMA over rolling baselines) | ✅ | `detection` pkg + `anomaly-engine`, unit-tested |
| 7 | Incident engine (correlation + lifecycle state machine) | ✅ | `correlation` pkg + `incident-engine`, unit-tested |
| 8 | Service dependency graph (build + expose) | ✅ | `GET /api/dependencies` + React Flow view |
| 9 | Root-cause engine (hypothesis ranking + confidence) | ✅ | `root-cause` pkg, unit-tested, wired into incident-engine |
| 10 | RAG service (chunk/embed/retrieve over runbooks, pgvector) | ✅ | `rag` pkg unit-tested; API indexes `docs/runbooks/` for investigate |
| 11 | AI investigator (grounded narrative + recommended actions) | ✅ | `ai` pkg (provider/investigator) unit-tested; `POST /api/incidents/:id/investigate` |
| 12 | Remediation engine + approvals + recovery verifier | ✅ | `remediation` pkg unit-tested; approve/reject/execute + recovery in API |
| 13 | Failure injection API (fan-out to service `/admin/faults`) | ✅ | `POST /api/failures/:type` + failure console |
| 14 | Next.js dashboard (overview/services/incidents/graph/failures/runbooks) | ✅ | `apps/web` (App Router, Tailwind, React Flow) |
| 15 | Platform API + Auth + RBAC | ✅ | `apps/api` (Fastify, JWT, roles, WS stream) |
| 16 | Testing (unit/integration/e2e of the full loop) | 🟡 | 41 unit tests passing; integration/e2e pending live stack |
| 17 | Kubernetes manifests (kind/minikube) | ✅ | `infrastructure/kubernetes/` (ns/config/data/kafka/apps/ingress) |
| 18 | Terraform AWS (VPC/EKS/RDS/ElastiCache/MSK) | ✅ | `infrastructure/terraform/` (plan-ready) |
| 19 | CI/CD (GitHub Actions: typecheck/test → build/scan) | ✅ | `.github/workflows/ci.yml` |
| 20 | Postmortem generation | ✅ | `ai` pkg + `POST /api/incidents/:id/postmortem` |
| 21 | Final integration | 🟡 | code complete + wired in compose; live run pending Docker |
| 22 | Demo polish + documentation | ✅ | 30+ doc set incl. this roadmap |

> **Verification status:** every phase's code compiles (typecheck clean) and all pure
> logic is unit-tested (41 tests). The **live** end-to-end run (containers up, real
> Kafka/Postgres, fault → incident → remediation in the browser) is blocked only on the
> local Docker environment (see [phase-03](phase-03-docker-stack.md) and the Docker
> reboot note); it is not a code gap.

## Sequencing rationale

The order is dependency-driven, not feature-driven:

- **Foundations first** (1–3): you can't emit telemetry without services, and you
  can't build services cleanly without shared types/logging/config.
- **Transport before intelligence** (4–5): the Kafka pipeline and ingestion must exist
  before anything can consume events.
- **Detect → correlate → reason → act** (6–12): this is the natural causal order of
  the incident pipeline; each stage consumes the previous stage's output.
- **Surfaces last** (14–15): the dashboard and API expose what the pipeline produces,
  so they come after the pipeline is real.
- **Ship it** (17–19): containers, cluster, cloud, CI.

## Definition of done (per phase)

1. `npm run typecheck` is clean.
2. `npm test` passes (unit tests for any new logic).
3. The new component runs and is smoke-tested (commands recorded in its build log).
4. A build log is added here documenting what changed and why.
5. Docs referencing the component are updated to match the code.
