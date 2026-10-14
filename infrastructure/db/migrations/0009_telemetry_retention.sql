-- Ordered bounded retention scans across all services (BRIN alone cannot supply order).
CREATE INDEX IF NOT EXISTS idx_metrics_retention ON metrics (ts, id);
CREATE INDEX IF NOT EXISTS idx_logs_retention ON logs (ts, id);
