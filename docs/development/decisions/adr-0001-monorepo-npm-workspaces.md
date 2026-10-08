# ADR-0001 · Use an npm-workspaces monorepo

**Status**: Accepted · **Date**: 2026-09-21

## Context

SentinelOps has ~15 deployable units (data-plane services, control-plane engines, two
apps) that share types, logging, config, and a service template. They must stay in
lock-step: an event-schema change should ripple to producers and consumers at once.

Options considered:
1. **Polyrepo** — one repo per service. Strong isolation, but sharing types means
   publishing internal packages and version churn; a schema change is a
   multi-repo, multi-PR dance.
2. **Monorepo with a heavy tool** (Nx/Turborepo). Powerful caching/orchestration, but
   extra config and concepts for a project this size.
3. **Monorepo with plain npm workspaces**. Native to npm, zero extra tooling.

## Decision

Use a **single npm-workspaces monorepo** (`workspaces: [packages/*, services/*,
apps/*]`). Internal dependencies use the `"*"` protocol and resolve to local packages
via workspace symlinks.

## Consequences

**Positive**
- One `npm install` links the whole graph; shared packages are imported like normal
  deps (`@sentinelops/service-kit`).
- Atomic changes: a `shared-types` edit and all its consumers land in one commit.
- No internal package publishing, no version-bump busywork.
- Simple to reason about for a solo/small team and for reviewers.

**Negative / mitigations**
- No built-in task caching → acceptable at this scale; can add Turborepo later without
  restructuring.
- Everything shares one `node_modules` root → we use `overrides`
  ([ADR-0003](adr-0003-otel-version-pinning.md)) to control transitive versions.

## Revisit if
The service count or CI time grows enough that per-package build caching becomes
worthwhile — then layer Turborepo on top (workspaces stay).
