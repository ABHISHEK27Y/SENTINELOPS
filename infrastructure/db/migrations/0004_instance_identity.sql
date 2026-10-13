ALTER TABLE anomalies ADD COLUMN instance TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_anomalies_incident_instance ON anomalies(incident_id,service_id,metric,instance);
