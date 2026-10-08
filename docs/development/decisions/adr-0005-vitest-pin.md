# ADR-0005 · Pin Vitest to the 2.x line on Windows

**Status**: Accepted · **Date**: 2026-09-21

## Context

`npm audit` flags moderate advisories in the test toolchain (`@vitest/mocker`, `vite`,
`esbuild`). They are **dev-only** — they concern the local test/dev server (e.g. an
esbuild dev-server request issue), not any code that ships in a service image.

`npm audit fix --force` upgrades to **Vitest 5**, which pulls in `rolldown`. On this
Windows machine, rolldown fails to load its native binding:

```
Error: Cannot find native binding … Cannot find module '@rolldown/binding-wasm32-wasi'
```

so `vitest run` cannot start at all. This is a known npm optional-dependencies issue on
Windows, not something in our code.

## Decision

Pin Vitest to **`~2.1.9`** (a stable line that installs and runs correctly on
Windows). Accept the dev-only advisories, and **document** them in the
[README security notes](../../README.md#security-notes) and
[Phase 1 log](../phase-01-foundation.md). Do not ship a broken test runner to gain a
green audit on advisories that don't affect production.

## Consequences

**Positive**
- `npm test` works reliably on Windows (and elsewhere).
- No production exposure from the advisories (test tooling never ships).

**Negative / mitigations**
- `npm audit` shows non-zero dev advisories → explicitly documented as accepted, with
  the reason, so it isn't mistaken for a real risk.

## Revisit if
A Vitest release ≥ 5 ships a working Windows native binding (or falls back cleanly to
wasm), or CI moves to Linux-only for tests — then upgrade and drop the pin.
