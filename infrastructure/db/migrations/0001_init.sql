-- SentinelOps initial schema
-- Idempotent-ish: uses IF NOT EXISTS where practical. Applied by db-migrate CLI.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS vector;         -- pgvector for RAG embeddings

-- ─────────────────────────── Identity / RBAC ───────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'VIEWER'
               CHECK (role IN ('VIEWER','ENGINEER','ADMIN')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────── Service catalog ───────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id           TEXT PRIMARY KEY,               -- e.g. 'payment-service'
  name         TEXT NOT NULL,
  display_name TEXT NOT NULL,
  tier         TEXT NOT NULL DEFAULT 'application'
               CHECK (tier IN ('edge','application','data','control')),
  health       TEXT NOT NULL DEFAULT 'UNKNOWN'
               CHECK (health IN ('HEALTHY','DEGRADED','UNHEALTHY','UNKNOWN')),
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_dependencies (
  from_service   TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  to_service     TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  call_rate      DOUBLE PRECISION NOT NULL DEFAULT 0,
  error_rate     DOUBLE PRECISION NOT NULL DEFAULT 0,
  p95_latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_service, to_service)
);

CREATE TABLE IF NOT EXISTS deployments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id  TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  version     TEXT NOT NULL,
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata    JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_deployments_service_time
  ON deployments (service_id, deployed_at DESC);

-- ─────────────────────────── Telemetry ───────────────────────────
CREATE TABLE IF NOT EXISTS metrics (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_id TEXT NOT NULL,
  metric     TEXT NOT NULL,
  value      DOUBLE PRECISION NOT NULL,
  labels     JSONB NOT NULL DEFAULT '{}',
  ts         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- BRIN is ideal for append-only time-series ordered by ts.
CREATE INDEX IF NOT EXISTS idx_metrics_ts_brin ON metrics USING brin (ts);
CREATE INDEX IF NOT EXISTS idx_metrics_service_metric_ts
  ON metrics (service_id, metric, ts DESC);

CREATE TABLE IF NOT EXISTS logs (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_id TEXT NOT NULL,
  level      TEXT NOT NULL CHECK (level IN ('DEBUG','INFO','WARN','ERROR')),
  message    TEXT NOT NULL,
  request_id TEXT,
  trace_id   TEXT,
  error      TEXT,
  fields     JSONB NOT NULL DEFAULT '{}',
  ts         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_logs_service_ts ON logs (service_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_trace ON logs (trace_id);

CREATE TABLE IF NOT EXISTS traces (
  trace_id   TEXT NOT NULL,
  span_id    TEXT NOT NULL,
  parent_id  TEXT,
  service_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  start_ts   TIMESTAMPTZ NOT NULL,
  duration_ms DOUBLE PRECISION NOT NULL,
  status     TEXT NOT NULL DEFAULT 'OK',
  attributes JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (trace_id, span_id)
);
CREATE INDEX IF NOT EXISTS idx_traces_service ON traces (service_id, start_ts DESC);

CREATE TABLE IF NOT EXISTS anomalies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    TEXT NOT NULL,
  metric        TEXT NOT NULL,
  value         DOUBLE PRECISION NOT NULL,
  baseline      DOUBLE PRECISION NOT NULL,
  deviation     DOUBLE PRECISION NOT NULL,
  anomaly_score DOUBLE PRECISION NOT NULL,
  method        TEXT NOT NULL,
  severity      TEXT NOT NULL,
  incident_id   TEXT,   -- references incidents(id) e.g. 'INC-1042' (set post-correlation)
  window_start  TIMESTAMPTZ NOT NULL,
  window_end    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_anomalies_service_time
  ON anomalies (service_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomalies_incident ON anomalies (incident_id);

-- ─────────────────────────── Incidents ───────────────────────────
CREATE TABLE IF NOT EXISTS incidents (
  id                TEXT PRIMARY KEY,           -- 'INC-1042'
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'DETECTED',
  severity          TEXT NOT NULL DEFAULT 'INFO',
  affected_services TEXT[] NOT NULL DEFAULT '{}',
  correlation_id    TEXT NOT NULL,
  root_cause        JSONB,
  confidence        DOUBLE PRECISION,
  started_at        TIMESTAMPTZ NOT NULL,
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_incidents_correlation
  ON incidents (correlation_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status_sev
  ON incidents (status, severity);

CREATE TABLE IF NOT EXISTS incident_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind        TEXT NOT NULL,
  message     TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_incident_events_incident
  ON incident_events (incident_id, at);

CREATE TABLE IF NOT EXISTS incident_evidence (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  weight      DOUBLE PRECISION NOT NULL DEFAULT 0.5
);
CREATE INDEX IF NOT EXISTS idx_incident_evidence_incident
  ON incident_evidence (incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_evidence_data
  ON incident_evidence USING gin (data);

-- ─────────────────────────── Remediation ───────────────────────────
CREATE TABLE IF NOT EXISTS remediation_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id     TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  target_service  TEXT NOT NULL,
  params          JSONB NOT NULL DEFAULT '{}',
  risk            TEXT NOT NULL CHECK (risk IN ('LOW','MEDIUM','HIGH')),
  status          TEXT NOT NULL DEFAULT 'PROPOSED',
  rationale       TEXT NOT NULL,
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  proposed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at     TIMESTAMPTZ,
  result          JSONB
);
CREATE INDEX IF NOT EXISTS idx_remediation_incident
  ON remediation_actions (incident_id);

CREATE TABLE IF NOT EXISTS remediation_approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id   UUID NOT NULL REFERENCES remediation_actions(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  decision    TEXT NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  reason      TEXT,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recovery_checks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id   UUID NOT NULL REFERENCES remediation_actions(id) ON DELETE CASCADE,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  metric      TEXT NOT NULL,
  observed    DOUBLE PRECISION NOT NULL,
  baseline    DOUBLE PRECISION NOT NULL,
  passed      BOOLEAN NOT NULL,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────── Postmortems ───────────────────────────
CREATE TABLE IF NOT EXISTS postmortems (
  incident_id TEXT PRIMARY KEY REFERENCES incidents(id) ON DELETE CASCADE,
  content_md  TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────── RAG / knowledge base ───────────────────────────
CREATE TABLE IF NOT EXISTS runbooks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT UNIQUE NOT NULL,
  title      TEXT NOT NULL,
  category   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runbook_id  UUID REFERENCES runbooks(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  title       TEXT NOT NULL,
  content_md  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content     TEXT NOT NULL,
  embedding   vector(384),                    -- matches EMBEDDINGS_DIM default
  metadata    JSONB NOT NULL DEFAULT '{}'
);
-- Approximate nearest-neighbour index for retrieval.
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─────────────────────────── Audit ───────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  result     TEXT,
  data       JSONB NOT NULL DEFAULT '{}',
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at DESC);
