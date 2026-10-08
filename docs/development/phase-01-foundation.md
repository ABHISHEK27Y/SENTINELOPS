# Phase 1 · Foundation — Build Log

**Goal**: a monorepo skeleton with the shared packages, the database schema, and the
infrastructure everything else stands on. **Status**: ✅ complete + verified.

---

## What was built

### 1. Monorepo skeleton
- [`package.json`](../../package.json) — npm-workspaces root, scripts, devDeps,
  dependency `overrides`.
- [`tsconfig.base.json`](../../tsconfig.base.json) + [`tsconfig.json`](../../tsconfig.json)
  — strict compiler options + flat typecheck with path aliases.
- [`.gitignore`](../../.gitignore), [`.env.example`](../../.env.example) — hygiene +
  documented configuration surface.
- Dedicated git repo (`main`) initialized inside `D:\miniProject\SENTINELOPS` so the
  project is standalone.

### 2. Shared packages
| Package | What | Doc |
| --- | --- | --- |
| `@sentinelops/shared-types` | Event envelope, enums, domain models (zod) | [shared-types](../packages/shared-types.md) |
| `@sentinelops/logger` | Structured JSON logging + secret redaction | [logger](../packages/logger.md) |
| `@sentinelops/config` | Validated env + configurable severity engine | [config](../packages/config.md) |

### 3. Database schema
[`infrastructure/db/migrations/0001_init.sql`](../../infrastructure/db/migrations/0001_init.sql)
— 20 tables across identity, service catalogue, telemetry, incidents, remediation,
RAG (pgvector), postmortem, and audit; with BRIN/btree/GIN/ivfflat indexes chosen for
the actual query patterns. Design: [Database Design](../architecture/04-database-design.md).

### 4. Infrastructure & monitoring configs
- [`docker-compose.infra.yml`](../../infrastructure/docker/docker-compose.infra.yml) —
  Postgres+pgvector, Redis, Kafka (KRaft), Jaeger, OTel Collector, Prometheus, Grafana.
- [`prometheus.yml`](../../monitoring/prometheus/prometheus.yml),
  [`otel-collector-config.yaml`](../../monitoring/otel/otel-collector-config.yaml).

### 5. Architecture documentation
[`ARCHITECTURE.md`](../architecture/ARCHITECTURE.md) with Mermaid diagrams, Kafka topic
design, DB ERD, and the 22-phase roadmap.

---

## Key decisions made this phase

- **Flat typecheck over project references** — simpler at this scale
  ([tooling](01-monorepo-and-tooling.md)).
- **`tsx` runtime, no dev build** — [ADR-0002](decisions/adr-0002-tsx-runtime-no-build.md).
- **`const`-object enums + zod schemas** in shared-types — runtime + type safety from
  one definition.
- **Severity as configurable policy in `config`**, not hard-coded in an engine —
  [Severity Model](../architecture/08-severity-model.md).

---

## Verification

```bash
npm install            # 140 packages
npm run typecheck      # clean (no errors)
npm test               # severity.test.ts — 4 passed
```

Result: typecheck clean; **4/4** severity unit tests passing (healthy⇒INFO,
demo-incident⇒HIGH/CRITICAL, monotonic in error rate, bounded).

### Note on advisories
`npm audit` reports moderate advisories in the Vitest/Vite/esbuild **dev** toolchain
only (local dev server; not shipped code). The patched line (Vitest 5) fails to install
its native binding on Windows, so Vitest is pinned to the working 2.x line — tests
only, never production. See [ADR-0005](decisions/adr-0005-vitest-pin.md).

---

## Outcome

A compiling, tested foundation with real domain contracts, a real schema, and a
one-command infrastructure. Ready for services to be built on top.

→ Next: [Phase 2 · Demo Microservices](phase-02-microservices.md).
