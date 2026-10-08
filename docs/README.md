# SentinelOps Documentation

This is the complete documentation set for **SentinelOps** — the AI-Powered
Distributed Observability & Autonomous Incident Response Platform. It documents
**what** is being built, **how** it is built, **why** each decision was made, and
**how every component connects** to the rest of the system.

> Documentation is written alongside the code and kept accurate to it. When a doc
> references an API, endpoint, table, or file, that thing exists in the codebase at
> the path shown. Anything not yet implemented is explicitly marked *(planned)*.

---

## How to read these docs

If you are **new to the project**, read in this order:

1. [Architecture › System Overview](architecture/01-system-overview.md) — the big picture in 5 minutes.
2. [Architecture › Service Responsibilities](architecture/02-service-responsibilities.md) — who does what.
3. [Architecture › Data Flow](architecture/03-data-flow.md) — how a request and an incident travel through the system.
4. [Guides › Local Setup](guides/01-local-setup.md) — get it running on your machine.
5. [Development › Roadmap](development/00-roadmap.md) — where the build is and where it's going.

If you are **building/extending a component**, jump to its page under
[Packages](#packages) or [Services](#services), then read the relevant
[Architecture Decision Record](#architecture-decision-records-adrs).

---

## Table of contents

### Architecture
The design reference — the "what" and "how it connects".

| Doc | Covers |
| --- | --- |
| [01 · System Overview](architecture/01-system-overview.md) | Goals, principles, the two planes, component map |
| [02 · Service Responsibilities](architecture/02-service-responsibilities.md) | Every service's job, inputs, outputs, dependencies |
| [03 · Data Flow](architecture/03-data-flow.md) | Request path, telemetry path, incident path (sequence diagrams) |
| [04 · Database Design](architecture/04-database-design.md) | Every table, relationship, index, and why |
| [05 · Kafka Event Design](architecture/05-kafka-event-design.md) | Topics, envelope, keys, delivery guarantees, DLQ |
| [06 · Observability](architecture/06-observability.md) | Metrics, logs, traces; OTel → Collector → Prometheus/Jaeger |
| [07 · Incident Lifecycle](architecture/07-incident-lifecycle.md) | The state machine, transitions, timeline |
| [08 · Severity Model](architecture/08-severity-model.md) | The measurable-signal scoring formula |
| [09 · Security & RBAC](architecture/09-security-and-rbac.md) | JWT, roles, approval gating, audit |
| [· Consolidated ARCHITECTURE.md](architecture/ARCHITECTURE.md) | The single-page design reference (diagrams + roadmap) |

### Packages
Shared libraries every service depends on.

| Doc | Package |
| --- | --- |
| [shared-types](packages/shared-types.md) | `@sentinelops/shared-types` — event envelope, enums, domain models |
| [logger](packages/logger.md) | `@sentinelops/logger` — structured JSON logging |
| [config](packages/config.md) | `@sentinelops/config` — validated env + severity engine |
| [service-kit](packages/service-kit.md) | `@sentinelops/service-kit` — the service template (Fastify + OTel + metrics + faults) |

### Services
The running processes.

| Doc | Service |
| --- | --- |
| [api-gateway](services/api-gateway.md) | Edge entry point; routes to user + order |
| [user-service](services/user-service.md) | User records; Postgres reader |
| [order-service](services/order-service.md) | Orchestrates orders; calls payment + notification |
| [payment-service](services/payment-service.md) | Charges orders; the primary failure target |
| [notification-service](services/notification-service.md) | Redis-backed notification queue |
| [loadgen](services/loadgen.md) | Traffic generator (telemetry baseline) |
| *(control-plane services as phases land)* | |

### Development
The "how it's built" — process, tooling, and a log of each phase.

| Doc | Covers |
| --- | --- |
| [00 · Roadmap](development/00-roadmap.md) | The 22 phases with live status |
| [01 · Monorepo & Tooling](development/01-monorepo-and-tooling.md) | Workspaces, TypeScript, `tsx`, typecheck, dependency `overrides` |
| [Phase 1 · Foundation](development/phase-01-foundation.md) | Build log: what was created, verified, and why |
| [Phase 2 · Demo Microservices](development/phase-02-microservices.md) | Build log: service-kit + all data-plane services + smoke test |
| [Phase 3 · Docker Stack](development/phase-03-docker-stack.md) | Build log: shared image + full-stack compose |

### Architecture Decision Records (ADRs)
The "why" behind each significant technical choice.

| ADR | Decision |
| --- | --- |
| [0001](development/decisions/adr-0001-monorepo-npm-workspaces.md) | Use an npm-workspaces monorepo |
| [0002](development/decisions/adr-0002-tsx-runtime-no-build.md) | Run TypeScript with `tsx` (no dev build step) |
| [0003](development/decisions/adr-0003-otel-version-pinning.md) | Pin OpenTelemetry stable packages to 1.27.0 |
| [0004](development/decisions/adr-0004-detection-vs-reasoning.md) | Deterministic detection, LLM only for reasoning |
| [0005](development/decisions/adr-0005-vitest-pin.md) | Pin Vitest to 2.x on Windows |

### Guides
Task-oriented how-tos.

| Doc | Covers |
| --- | --- |
| [01 · Local Setup](guides/01-local-setup.md) | From clone to running services |
| [02 · Observability Stack](guides/02-observability-stack.md) | Prometheus, Grafana, Jaeger — what to look at |
| [03 · Failure Injection](guides/03-failure-injection.md) | Every fault, how to trigger it, what it does |

---

## Documentation conventions

- **Status tags**: *(planned)* = designed but not yet coded; everything else is
  implemented and, where noted, verified.
- **Code links** point at real files, e.g. [`server.ts`](../packages/service-kit/src/server.ts).
- **Diagrams** use Mermaid so they render on GitHub and stay in version control.
- Each phase log ends with the exact commands used to verify it.
