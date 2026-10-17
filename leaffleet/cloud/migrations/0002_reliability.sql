-- Apply once to a database from the original project; preserve all history.
ALTER TABLE telemetry ADD COLUMN boot_id TEXT;
ALTER TABLE telemetry ADD COLUMN seq INTEGER;
ALTER TABLE telemetry ADD COLUMN uptime_ms INTEGER;
ALTER TABLE telemetry ADD COLUMN can_fresh INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telemetry ADD COLUMN charger_state TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE telemetry ADD COLUMN charge_energy_kwh REAL;
ALTER TABLE telemetry ADD COLUMN historical INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vehicle_state ADD COLUMN last_can_ts TEXT;
ALTER TABLE vehicle_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vehicle_state ADD COLUMN time_quality TEXT NOT NULL DEFAULT 'received';
ALTER TABLE vehicle_state ADD COLUMN boot_id TEXT;
ALTER TABLE vehicle_state ADD COLUMN seq INTEGER;
ALTER TABLE vehicle_state ADD COLUMN can_fresh INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vehicle_state ADD COLUMN charger_state TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE vehicle_state ADD COLUMN charge_energy_kwh REAL;
ALTER TABLE vehicle_state ADD COLUMN can_lost_reported INTEGER NOT NULL DEFAULT 0;
ALTER TABLE charging_sessions ADD COLUMN target_notified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE charging_sessions ADD COLUMN energy_complete INTEGER NOT NULL DEFAULT 1;
ALTER TABLE charging_sessions ADD COLUMN charge_type TEXT;
CREATE INDEX IF NOT EXISTS idx_charges_started ON charging_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_trips_started ON gps_trips(started_at DESC);
CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO schema_meta(id,version) VALUES(1,2);
CREATE TABLE ingest_guard (expected_revision INTEGER PRIMARY KEY);
CREATE TRIGGER check_ingest_revision BEFORE INSERT ON ingest_guard BEGIN
 SELECT CASE WHEN (SELECT revision FROM vehicle_state WHERE id=1)=NEW.expected_revision THEN 1 ELSE RAISE(ABORT,'LF_CONFLICT') END;
END;
CREATE TABLE notification_outbox (
 event_id TEXT PRIMARY KEY,
 message TEXT NOT NULL,
 created_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','expired')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL,
 lease_until INTEGER,
 lease_token TEXT,
 sent_at TEXT,
 telegram_message_id INTEGER,
 last_error TEXT
);
CREATE INDEX idx_outbox_due ON notification_outbox(status,next_attempt_at);
CREATE TABLE device_status (
 id INTEGER PRIMARY KEY CHECK(id=1),
 last_received_at TEXT,
 firmware_version TEXT,
 boot_id TEXT,
 queue_bytes INTEGER,
 dropped_samples INTEGER NOT NULL DEFAULT 0,
 rejected_samples INTEGER NOT NULL DEFAULT 0,
 rssi INTEGER,
 can_rx_missed INTEGER NOT NULL DEFAULT 0,
 offline_reported INTEGER NOT NULL DEFAULT 0
);
INSERT INTO device_status (id) VALUES (1);
