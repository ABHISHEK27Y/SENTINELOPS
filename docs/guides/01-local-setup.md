# Guide · Local Setup

From a fresh clone to running services. Reflects the **current** state (Phases 1–2);
the full-stack `docker compose up` arrives in Phase 3.

## Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | ≥ 20 (tested on 22) | `node -v` |
| npm | ≥ 10 (tested on 11) | `npm -v` |
| Docker + Compose | recent (tested on 29) | `docker -v` |
| Python | ≥ 3.11 (for ML/AI services, later phases) | `python --version` |

## 1. Install

```bash
npm install
```
One install links the whole workspace (all packages + services).

## 2. Configure

```bash
cp .env.example .env
```
Defaults point at the local docker-compose infra, so you can leave `.env` as-is. The
LLM provider defaults to `mock` — **no API key needed**.

## 3. Verify the code

```bash
npm run typecheck     # should be clean
npm test              # severity tests — 4 passed
```

## 4. Start infrastructure

```bash
npm run infra:up
```
Brings up Postgres (pgvector), Redis, Kafka (KRaft), Prometheus, Grafana, Jaeger, and
the OTel Collector. Give it ~30s on first run (image pulls). Endpoints:

| Service | URL / address |
| --- | --- |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 (anonymous viewer on) |
| Jaeger | http://localhost:16686 |
| Postgres | `localhost:5432` · `sentinel` / `sentinel_dev_pw` · db `sentinelops` |
| Redis | `localhost:6379` |
| Kafka | `localhost:9092` |

Tear down with `npm run infra:down`.

## 5. Run services

Each service runs in watch mode in its own shell:

```bash
npm run dev:payment    # payment-service on :8083
npm run dev:order      # order-service on :8082 (calls payment)
```

Smoke-check:
```bash
curl localhost:8083/health
curl -XPOST localhost:8082/orders -H 'content-type: application/json' -d '{"userId":"u1"}'
curl -s localhost:8083/metrics | head
```

## 6. Try a failure

```bash
curl -XPOST localhost:8083/admin/faults -H 'content-type: application/json' \
     -d '{"type":"db_latency","params":{"targetMs":2400}}'
curl -s localhost:8083/metrics | grep db_pool_utilization   # → ~0.99
curl -XDELETE localhost:8083/admin/faults                   # clear
```
Full catalogue: [Failure Injection guide](03-failure-injection.md).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `[otel] telemetry disabled …` warning | Harmless — the Collector isn't up yet. Run `infra:up`. The service still works. |
| Port already in use | Another instance is running; stop it or change the `*_PORT` env var. |
| Kafka healthcheck slow to pass | KRaft first boot takes ~15–30s; wait and re-check `docker ps`. |
| `npm audit` shows advisories | Dev-only test toolchain — expected, see [ADR-0005](../development/decisions/adr-0005-vitest-pin.md). |

## Applying the database schema

The migration runner lands in Phase 4 (`npm run db:migrate`). Until then you can apply
the schema manually:
```bash
docker exec -i sentinel-postgres psql -U sentinel -d sentinelops \
  < infrastructure/db/migrations/0001_init.sql
```
