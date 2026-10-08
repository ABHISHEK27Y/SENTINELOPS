# 08 · Severity Model

Severity is **computed from measurable signals**, never guessed and never assigned by
an LLM. This makes it explainable, reproducible, and tunable.

**Implementation**: [`config/src/severity.ts`](../../packages/config/src/severity.ts).
**Tests**: [`config/src/severity.test.ts`](../../packages/config/src/severity.test.ts)
(4 cases, passing).

---

## The five buckets

```
INFO  <  LOW  <  MEDIUM  <  HIGH  <  CRITICAL
```

## The formula

A weighted, normalized sum of five signals produces a score in `[0, 1]`, which maps to
a bucket via thresholds:

```
score = w_error · norm(errorRate)
      + w_lat   · norm(latencyRatio)
      + w_svc   · norm(affectedServices)
      + w_vol   · norm(requestVolume)
      + w_dur   · norm(durationSeconds)

where norm(x for signal s) = clamp01(x / cap_s)
```

Each signal is normalized against a **cap** (the value at which it contributes its
full weight) and clamped to `[0, 1]`, so no single runaway signal can push the score
above 1.

### Signals

| Signal | Meaning | Example (payment pool exhaustion) |
| --- | --- | --- |
| `errorRate` | Fractional 5xx rate 0..1 | `0.17` (17%) |
| `latencyRatio` | p95 latency ÷ healthy baseline | `2800 / 180 ≈ 15.6` |
| `affectedServices` | distinct services impacted | `3` |
| `requestVolume` | requests/sec through the path | `220` |
| `durationSeconds` | how long it's been going | `240` |

### Default weights, caps, thresholds

From `DEFAULT_SEVERITY_RULES`:

| Parameter | errorRate | latencyRatio | affectedServices | requestVolume | duration |
| --- | --- | --- | --- | --- | --- |
| **weight** | 0.35 | 0.25 | 0.20 | 0.10 | 0.10 |
| **cap** | 0.50 | 10× | 5 | 500 rps | 900 s |

| Threshold | critical | high | medium | low |
| --- | --- | --- | --- | --- |
| **score ≥** | 0.75 | 0.55 | 0.35 | 0.15 |

Error rate carries the most weight because user-facing failures matter most; latency
and blast radius (affected services) come next.

---

## Worked example (the demo incident)

```ts
computeSeverity({
  errorRate: 0.17,
  latencyRatio: 2800 / 180, // ≈ 15.56 → clamped to cap 10 ⇒ norm 1.0
  affectedServices: 3,      // 3/5 ⇒ 0.6
  requestVolume: 220,       // 220/500 ⇒ 0.44
  durationSeconds: 240,     // 240/900 ⇒ 0.267
});
```

Contribution:
- error: `0.35 · (0.17/0.5=0.34)` = `0.119`
- latency: `0.25 · 1.0` = `0.250`
- services: `0.20 · 0.6` = `0.120`
- volume: `0.10 · 0.44` = `0.044`
- duration: `0.10 · 0.267` = `0.027`

**score ≈ 0.56 → HIGH** (≥ 0.55). This matches the unit test asserting `HIGH` or
`CRITICAL` for this scenario.

---

## Why it's configurable

`SeverityRules` (weights, caps, thresholds) is passed into `computeSeverity()` and
defaults to `DEFAULT_SEVERITY_RULES`. Teams tune it without touching engine code — for
example, a payments org might raise `w_error` and lower the `critical` threshold. The
rules object is the single knob surface; later phases load it from
[`config`](../packages/config.md) / the settings page.

## Properties guaranteed by tests

- Healthy input ⇒ `INFO` (score below `low` threshold).
- The demo incident ⇒ `HIGH`/`CRITICAL`.
- **Monotonic** in error rate (more errors ⇒ higher score, all else equal).
- **Bounded**: extreme inputs still yield `score ≤ 1` (clamping works).

These are exactly the four cases in
[`severity.test.ts`](../../packages/config/src/severity.test.ts).
