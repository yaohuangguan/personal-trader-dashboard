-- Public research data only; never persist portfolio details or API credentials.
CREATE TABLE IF NOT EXISTS intel_events (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 original_title TEXT NOT NULL,
 source TEXT NOT NULL,
 url TEXT NOT NULL,
 category TEXT NOT NULL,
 published_at TEXT,
 first_seen_at TEXT NOT NULL,
 last_seen_at TEXT NOT NULL,
 sightings INTEGER NOT NULL DEFAULT 1,
 tickers_json TEXT NOT NULL DEFAULT '[]',
 evidence_stage TEXT NOT NULL DEFAULT 'media_lead' CHECK (evidence_stage IN ('media_lead','primary_verified','disputed'))
);
CREATE INDEX IF NOT EXISTS idx_intel_published ON intel_events(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_intel_first_seen ON intel_events(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_intel_category ON intel_events(category,first_seen_at DESC);
CREATE TABLE IF NOT EXISTS intel_sector_links (
 event_id TEXT NOT NULL REFERENCES intel_events(id) ON DELETE CASCADE,
 sector_id TEXT NOT NULL,
 reason TEXT NOT NULL,
 PRIMARY KEY (event_id,sector_id)
);
CREATE INDEX IF NOT EXISTS idx_sector_event ON intel_sector_links(sector_id,event_id);
CREATE TABLE IF NOT EXISTS intel_scan_runs (
 id TEXT PRIMARY KEY,
 started_at TEXT NOT NULL,
 finished_at TEXT NOT NULL,
 new_events INTEGER NOT NULL,
 seen_events INTEGER NOT NULL,
 warning_count INTEGER NOT NULL,
 warnings_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan_finished ON intel_scan_runs(finished_at DESC);
CREATE TABLE IF NOT EXISTS market_snapshots (
 symbol TEXT PRIMARY KEY,
 payload_json TEXT NOT NULL,
 fetched_at TEXT NOT NULL,
 as_of TEXT NOT NULL,
 provider TEXT NOT NULL
);
