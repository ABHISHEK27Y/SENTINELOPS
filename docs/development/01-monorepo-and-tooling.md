# Monorepo & Tooling

How the repository is organized and how the toolchain works. This is the "how it's
built" at the mechanical level.

---

## Monorepo layout (npm workspaces)

The repo is a single npm workspace (`package.json` → `workspaces: [packages/*,
services/*, apps/*]`). One `npm install` at the root links everything; a service
imports `@sentinelops/service-kit` and npm resolves it to the local package via a
symlink in `node_modules`. See [ADR-0001](decisions/adr-0001-monorepo-npm-workspaces.md).

```
sentinelops/
├── package.json            # workspace root: scripts, devDeps, dependency overrides
├── tsconfig.base.json      # compiler options shared by all
├── tsconfig.json           # the typecheck project: path aliases + include globs
├── .env.example            # documents every env var
├── packages/               # shared libraries (shared-types, logger, config, service-kit)
├── services/               # runnable services (payment-service, order-service, …)
├── apps/                   # web (Next.js) + api (planned)
├── infrastructure/         # db migrations, docker, kubernetes, terraform
├── monitoring/             # prometheus, grafana, otel configs
└── docs/                   # this documentation set
```

---

## TypeScript setup

Two tsconfigs, by design:

| File | Role |
| --- | --- |
| [`tsconfig.base.json`](../../tsconfig.base.json) | Strict compiler options (`strict`, `noUncheckedIndexedAccess`, `NodeNext` modules, etc.). Shared by all. |
| [`tsconfig.json`](../../tsconfig.json) | The **typecheck project**: `noEmit`, path aliases mapping `@sentinelops/*` → each package's `src`, and `include` globs for every package/service. |

**Flat typecheck, not project references.** Rather than a composite build graph, one
root `tsc -p tsconfig.json --noEmit` typechecks the whole repo using path aliases. It's
simpler, fast enough at this size, and avoids build-ordering headaches. Run it with:

```bash
npm run typecheck
```

---

## Runtime: `tsx`, no build step in dev

Services run TypeScript **directly** via `tsx` (`tsx watch src/index.ts`). There is no
`tsc` build in the dev loop — edit a `.ts` file and the watcher restarts. Packages
export their `src/*.ts` directly (`"exports": "./src/index.ts"`), and `tsx` resolves
across workspace packages. Rationale and the OTel-ordering nuance:
[ADR-0002](decisions/adr-0002-tsx-runtime-no-build.md).

Production Docker images (Phase 3) will compile with `tsc` for a lean runtime; dev
optimizes for iteration speed.

---

## Dependency management

### Workspace protocol
Internal deps use `"*"` (e.g. `"@sentinelops/logger": "*"`), resolved to the local
package.

### `overrides` — pinning transitive versions
The root `package.json` has an `overrides` block forcing all OpenTelemetry stable
packages to **1.27.0**. Without it, `sdk-node` and the OTLP exporters resolve two
different copies of `@opentelemetry/sdk-metrics`, and their `MetricReader` types stop
being assignable to each other (a real TypeScript error we hit). Full story:
[ADR-0003](decisions/adr-0003-otel-version-pinning.md).

---

## Testing

- **Runner**: Vitest, pinned to `~2.1.9`. Vitest 5's `rolldown` native binding fails to
  install on Windows; the stable 2.x line works. See
  [ADR-0005](decisions/adr-0005-vitest-pin.md).
- **Command**: `npm test` (runs `vitest run` across the workspace).
- **Convention**: tests live next to the code as `*.test.ts` (e.g.
  `severity.test.ts`).

---

## Scripts (root `package.json`)

| Script | Does |
| --- | --- |
| `npm run typecheck` | Typecheck the whole repo. |
| `npm test` | Run all unit tests. |
| `npm run infra:up` / `infra:down` | Start/stop the infrastructure compose. |
| `npm run dev:payment` / `dev:order` / `dev:gateway` | Run a service in watch mode. |
| `npm run stack:up` / `stack:down` | Full app stack (Phase 3). |
| `npm run db:migrate` | Apply DB migrations (runner lands Phase 4). |

---

## Conventions

- **ESM everywhere** (`"type": "module"`); imports use explicit `.js` specifiers
  (NodeNext resolution) even though the source is `.ts`.
- **Strict TypeScript**; no implicit `any`, checked index access.
- **Env only through [`config`](../packages/config.md)** — never read `process.env`
  directly in business logic.
- **Topic/enum constants from [`shared-types`](../packages/shared-types.md)** — never
  hard-code strings.
