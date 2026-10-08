# ADR-0002 · Run TypeScript with `tsx` (no dev build step)

**Status**: Accepted · **Date**: 2026-09-21

## Context

Services are TypeScript. In development we want fast iteration and cross-package edits
(change `service-kit`, see it in `payment-service` immediately) without a compile
graph. Options:
1. **`tsc` build** each package to `dist`, run compiled JS. Correct, but every edit
   needs a rebuild and packages must be built in dependency order.
2. **`ts-node`** — runs TS directly but is slower and has ESM friction.
3. **`tsx`** (esbuild-based) — fast TS execution, good ESM support, watch mode.

There is one subtlety: OpenTelemetry auto-instrumentation must monkey-patch `http`/
`fastify`/`pg` **before** they are imported. So the telemetry bootstrap has to run
first, regardless of runtime.

## Decision

- **Dev**: run services with **`tsx`** (`tsx watch src/index.ts`); packages export
  their `src/*.ts` directly. No build step in the dev loop. Typecheck separately with a
  single flat `tsc --noEmit` ([tooling](../01-monorepo-and-tooling.md)).
- **OTel ordering**: each service's `index.ts` does
  `await startTelemetry(name)` and then a **dynamic** `import('./app.js')`, so the app
  (and the libraries it imports) load *after* instrumentation is installed.
- **Prod (Phase 3+)**: Docker images compile with `tsc` for a lean, dependency-free
  runtime.

## Consequences

**Positive**
- Instant reloads; edit any package and the watcher restarts.
- No build-order management in dev.
- The dynamic-import pattern makes OTel work reliably without a preloader flag.

**Negative / mitigations**
- Dev and prod use different runtimes → mitigated by the shared strict `tsconfig` and
  CI running the same typecheck + tests that prod builds from.
- `tsx` doesn't type-check → that's `npm run typecheck`'s job, run in CI.

## Revisit if
We need a preloaded instrumentation module (`node --import`) for a service that can't
use the dynamic-import pattern — then add an `instrument.ts` preloader.
