ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;

CREATE TABLE event_inbox (
  consumer TEXT NOT NULL,
  event_id UUID NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
CREATE TABLE event_outbox (
  id UUID PRIMARY KEY,
  topic TEXT NOT NULL,
  event_key TEXT NOT NULL,
  envelope JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
CREATE INDEX idx_pending_outbox ON event_outbox(created_at) WHERE published_at IS NULL;
CREATE TABLE pipeline_state (
  name TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE remediation_approvals ADD CONSTRAINT uq_action_decision UNIQUE (action_id);
ALTER TABLE incidents ADD CONSTRAINT valid_incident_status CHECK
  (status IN ('DETECTED','INVESTIGATING','IDENTIFIED','MITIGATION_REQUIRED','REMEDIATING','VERIFYING','RESOLVED','POSTMORTEM'));
ALTER TABLE remediation_actions ADD CONSTRAINT valid_action_status CHECK
  (status IN ('PROPOSED','APPROVED','REJECTED','EXECUTING','EXECUTED','FAILED'));

CREATE TABLE remediation_jobs (
  action_id UUID PRIMARY KEY REFERENCES remediation_actions(id) ON DELETE CASCADE,
  phase TEXT NOT NULL DEFAULT 'EXECUTE' CHECK (phase IN ('EXECUTE','VERIFY','DONE')),
  due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  state JSONB NOT NULL DEFAULT '{}',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT
);

INSERT INTO services(id, name, display_name, tier) VALUES
  ('api-gateway','api-gateway','API Gateway','edge'),
  ('user-service','user-service','User Service','application'),
  ('order-service','order-service','Order Service','application'),
  ('payment-service','payment-service','Payment Service','application'),
  ('notification-service','notification-service','Notification Service','application'),
  ('postgres','postgres','PostgreSQL','data'),
  ('redis','redis','Redis','data') ON CONFLICT (id) DO NOTHING;
