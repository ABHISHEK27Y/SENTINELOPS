# ADR-0004 · Deterministic detection, LLM only for reasoning

**Status**: Accepted · **Date**: 2026-09-21

## Context

SentinelOps must decide **whether** something is anomalous and **how severe** it is,
then **explain** it. It is tempting to hand raw metrics to an LLM and ask "is this an
incident?". That would be a mistake:
- LLMs are non-deterministic and can hallucinate numbers — unacceptable for a signal
  that pages a human.
- Numeric anomaly detection is a **solved statistical problem** (z-score, EWMA,
  Isolation Forest) that is cheap, fast, explainable, and reproducible.
- Severity must be auditable and tunable, not a vibe.

But LLMs are genuinely good at the parts detection is bad at: reading unstructured
logs, summarizing, retrieving relevant runbooks, and writing a human explanation.

## Decision

Draw a hard line:

**Deterministic (stats/ML) — the "is it broken, how bad" layer**
- Anomaly detection: z-score / EWMA / Isolation Forest over collected metrics.
- Severity: the weighted formula in [`config`](../../packages/config/src/severity.ts).
- Correlation: time-window + dependency-graph + trace-id rules.
- Root-cause ranking: evidence-weighted scoring (LLM may narrate, not decide the rank).

**LLM — the "explain and recommend" layer**
- Incident narrative / log summarization.
- RAG retrieval of runbooks.
- Recommended remediation (a **suggestion**; execution is human-gated —
  [Security](../architecture/09-security-and-rbac.md)).
- Postmortem drafting.

**Grounding rule**: every important LLM claim must reference collected evidence
(a metric value, a log line, a trace). The investigator is given evidence and told to
cite it; it must not invent telemetry.

**No-key rule**: the LLM/embeddings layer defaults to a `mock` provider so the whole
system runs deterministically with no API key.

## Consequences

**Positive**
- Detection is reproducible, testable ([severity tests](../phase-01-foundation.md)),
  and defensible in a postmortem.
- LLM cost/latency sit off the hot detection path.
- The system degrades to fully-deterministic behaviour with no LLM key.

**Negative / mitigations**
- Two subsystems to build instead of one prompt → but each is simpler and correct.
- Grounding must be enforced in the investigator's prompt + output validation → tracked
  as a Phase 11 requirement.
