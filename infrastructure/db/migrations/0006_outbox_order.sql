-- now() is identical across a transaction; use an insertion ordinal to preserve
-- lifecycle event order when several transitions commit together.
ALTER TABLE event_outbox ADD COLUMN sequence BIGINT GENERATED ALWAYS AS IDENTITY;
CREATE INDEX idx_pending_outbox_sequence ON event_outbox(sequence) WHERE published_at IS NULL;
