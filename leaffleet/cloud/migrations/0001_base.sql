CREATE TABLE IF NOT EXISTS telemetry (
 id TEXT PRIMARY KEY,
 ts TEXT NOT NULL,
 received_at TEXT NOT NULL,
 time_quality TEXT NOT NULL,
 mode TEXT NOT NULL,
 soc REAL,
 voltage_v REAL,
 current_a REAL,
 full INTEGER NOT NULL DEFAULT 0,
 energy_in_kwh REAL,
 energy_out_kwh REAL,
 lat REAL,
 lon REAL,
 speed_kmh REAL,
 odometer_km REAL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry(ts DESC);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 event_id TEXT NOT NULL UNIQUE,
 event_type TEXT NOT NULL,
 ts TEXT NOT NULL,
 soc REAL,
 details TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
CREATE TABLE IF NOT EXISTS charging_sessions (
 id TEXT PRIMARY KEY,
 started_at TEXT NOT NULL,
 ended_at TEXT,
 start_soc REAL,
 end_soc REAL,
 start_energy_in_kwh REAL,
 charged_kwh REAL,
 end_reason TEXT
);
CREATE TABLE IF NOT EXISTS gps_trips (
 id TEXT PRIMARY KEY,
 started_at TEXT NOT NULL,
 ended_at TEXT,
 distance_km REAL NOT NULL DEFAULT 0,
 max_speed_kmh REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS vehicle_state (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 last_event_id TEXT,
 last_ts TEXT,
 last_received_at TEXT,
 mode TEXT NOT NULL DEFAULT 'unknown',
 soc REAL,
 voltage_v REAL,
 current_a REAL,
 full INTEGER NOT NULL DEFAULT 0,
 energy_in_kwh REAL,
 energy_out_kwh REAL,
 lat REAL,
 lon REAL,
 speed_kmh REAL,
 odometer_km REAL,
 last_gps_ts TEXT,
 active_charge_id TEXT,
 active_trip_id TEXT,
 stopped_since TEXT
);
INSERT OR IGNORE INTO vehicle_state (id) VALUES (1);
CREATE TABLE IF NOT EXISTS settings (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 vehicle_name TEXT NOT NULL DEFAULT 'Nissan Leaf 2014',
 target_soc INTEGER NOT NULL DEFAULT 90,
 electricity_price REAL,
 retention_days INTEGER NOT NULL DEFAULT 90
);
INSERT OR IGNORE INTO settings (id) VALUES (1);
