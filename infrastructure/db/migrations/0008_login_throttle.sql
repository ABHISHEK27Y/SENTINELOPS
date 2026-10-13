CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_login_attempts_expiry ON login_attempts(reset_at);
