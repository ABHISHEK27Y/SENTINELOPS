# ADR-0003 · Pin OpenTelemetry stable packages to 1.27.0

**Status**: Accepted · **Date**: 2026-09-21

## Context

Adding OpenTelemetry to `service-kit` produced a compile error:

```
telemetry.ts: Type 'PeriodicExportingMetricReader' is not assignable to type
'MetricReader'. Types have separate declarations of a private property '_shutdown'.
```

Investigation (`npm ls @opentelemetry/sdk-metrics`) showed **two copies** in the tree:
- `1.30.1` — resolved for service-kit's floating `^1.27.0` dependency.
- `1.27.0` — pinned **exactly** by `@opentelemetry/sdk-node@0.54.2` and the OTLP
  exporters.

`NodeSDK` expected a `MetricReader` from its `1.27.0` copy, while our code imported
`PeriodicExportingMetricReader` from the `1.30.1` copy. The classes have a private
field, so TypeScript treats them as **nominally distinct** — hence "separate
declarations of a private property".

OpenTelemetry's experimental (`0.5x`) and stable (`1.x`) packages are released in
lockstep; mixing minor versions of the stable packages across the tree is unsupported
in practice.

## Decision

Force a **single version** of the stable OTel packages via a root `overrides` block,
matching what `sdk-node@0.54.2` and the exporters pin:

```jsonc
"overrides": {
  "@opentelemetry/sdk-metrics": "1.27.0",
  "@opentelemetry/resources": "1.27.0",
  "@opentelemetry/sdk-trace-base": "1.27.0",
  "@opentelemetry/api": "1.9.0"
}
```

and pin service-kit's direct deps to exact `1.27.0`. A clean reinstall (`rm
package-lock.json node_modules && npm install`) collapses the tree to one
`sdk-metrics@1.27.0`. Typecheck is then clean.

## Consequences

**Positive**
- One copy of each stable OTel package; `MetricReader` types match; no casts.
- Deterministic, reproducible installs.

**Negative / mitigations**
- Overrides must be advanced deliberately when upgrading OTel: bump `sdk-node` +
  exporters + the override versions **together**, then reinstall clean and re-typecheck.
- New OTel deps added later must respect the pinned line.

## Verification
```bash
find node_modules -path '*/@opentelemetry/sdk-metrics/package.json' -exec grep version {} \;
# → single "1.27.0"
npm run typecheck   # clean
```
