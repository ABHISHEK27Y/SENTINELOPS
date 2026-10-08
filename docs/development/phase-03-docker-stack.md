# Phase 3 · Full Docker Stack — Build Log

**Goal**: one command (`docker compose up`) brings up the entire system — infra +
observability + all data-plane services + continuous traffic. **Status**: 🟡 code
complete and config-validated; full runtime `up` verification pending a running Docker
engine on the dev machine (see note below).

---

## What was built

### 1. Shared service image — [`Dockerfile`](../../Dockerfile)
One image for every Node service. It copies the workspace manifests + `packages/` +
`services/`, runs `npm install` (respecting the root `overrides`), and installs `curl`
for healthchecks. docker-compose overrides `command` per service to run
`npm run start -w @sentinelops/<name>`. Dev-oriented (tsx runtime); a multi-stage
`tsc` production build is a Phase 19 hardening step ([ADR-0002](decisions/adr-0002-tsx-runtime-no-build.md)).

### 2. [`.dockerignore`](../../.dockerignore)
Excludes `node_modules`, `dist`, `.git`, `docs`, terraform/kubernetes, and logs from
the build context.

### 3. Full stack — [`docker-compose.yml`](../../docker-compose.yml)
- **`include:`s** the infra compose so infra/observability have a single source of
  truth ([infra compose](../../infrastructure/docker/docker-compose.infra.yml)).
- Defines the five services + `loadgen` using a YAML anchor (`x-app`) so they share
  build/image/env and are declared concisely.
- **Healthchecks** (`curl /health/live`) on every service.
- **Startup ordering** via `depends_on: condition: service_healthy`:
  infra (postgres/redis/kafka healthy) → payment + notification + user →
  order → gateway → loadgen.
- Wires container DNS: `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`,
  `KAFKA_BROKERS=kafka:29092`, `DATABASE_URL=…@postgres:5432/…`,
  `*_SERVICE_URL=http://<service>:<port>`.

---

## Verification

```bash
docker compose config --quiet     # ✅ OK — compose file parses & merges the include
```

The full `docker compose up -d --build` + endpoint checks are the remaining verification
step. On the current dev machine the Docker Desktop **engine was not running**
(`failed to connect to the docker API at npipe:…dockerDesktopLinuxEngine`), so the CLI
could validate the config but not build/run containers. This is an environment state,
not a code issue — everything the compose file references (the image build, the
service commands, the health endpoints, the port mappings) was exercised in the Phase 2
**local** end-to-end run.

### To complete verification (once Docker Desktop is running)
```bash
docker compose up -d --build
docker compose ps                       # all services healthy
curl localhost:8080/users/abc123        # gateway → user
curl -XPOST localhost:8080/orders -H 'content-type: application/json' -d '{"userId":"u1"}'
# then open Prometheus :9090 (targets UP), Jaeger :16686 (traces), Grafana :3001
docker compose logs -f loadgen          # continuous traffic summary
```

Expected: all containers `healthy`, Prometheus targets `UP`, one distributed trace per
order spanning gateway → order → payment/notification, and loadgen reporting a low
error rate.

---

## Notes / decisions

- **`include` over duplication**: the infra definitions live once; the app compose
  extends them. Both files stay usable (`infra:up` for infra-only work).
- **Build once, run many**: all services share `image: sentinelops/app:local`; layer
  caching makes the repeated per-service build effectively a no-op after the first.
- **Ports** map 1:1 to the host (8080–8084) so the local `curl`/dashboard workflow is
  identical to the non-Docker run.

→ Next: [Phase 4 — Kafka event pipeline + migration runner](00-roadmap.md).
