-- ═══════════════════════════════════════════════════════════════════
-- SUPABASE MIGRATION: Multi-Sender Pool for SalesHandy
-- Dream Compass v2
-- ═══════════════════════════════════════════════════════════════════
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- TABLE 1: sh_senders — Sender configuration and live state
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sh_senders (
  id                TEXT PRIMARY KEY,
  email             TEXT UNIQUE NOT NULL,
  display_name      TEXT NOT NULL DEFAULT 'Kevin Patrick | Trinity One Consulting',
  domain            TEXT NOT NULL,
  sender_group      TEXT NOT NULL,        -- 'cold-pool', 'warm-pool', 'protected'
  provider          TEXT NOT NULL,         -- 'saleshandy', 'namecheap', 'existing'
  status            TEXT NOT NULL DEFAULT 'warmup',  -- 'warmup', 'active', 'paused', 'disabled'
  pause_reason      TEXT,
  warmup_start_date DATE,
  warmup_day        INTEGER DEFAULT 0,
  daily_limit       INTEGER NOT NULL DEFAULT 5,
  max_daily_limit   INTEGER NOT NULL DEFAULT 50,
  sends_today       INTEGER DEFAULT 0,
  sends_today_date  DATE,
  total_sends       INTEGER DEFAULT 0,
  total_bounces     INTEGER DEFAULT 0,
  total_replies     INTEGER DEFAULT 0,
  bounce_rate       NUMERIC DEFAULT 0,
  last_send_at      TIMESTAMPTZ,
  last_bounce_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sh_senders_group ON sh_senders(sender_group);
CREATE INDEX IF NOT EXISTS idx_sh_senders_status ON sh_senders(status);

ALTER TABLE sh_senders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on sh_senders"
  ON sh_senders FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE sh_senders IS 'Multi-sender pool for SalesHandy outbound. Tracks warmup, daily limits, and health per sender.';

-- ─────────────────────────────────────────────────────────────────
-- TABLE 2: sh_sender_daily_log — Historical daily metrics per sender
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sh_sender_daily_log (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_email  TEXT NOT NULL REFERENCES sh_senders(email),
  log_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  sends         INTEGER DEFAULT 0,
  bounces       INTEGER DEFAULT 0,
  opens         INTEGER DEFAULT 0,
  replies       INTEGER DEFAULT 0,
  unsubscribes  INTEGER DEFAULT 0,
  bounce_rate   NUMERIC DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sender_email, log_date)
);

CREATE INDEX IF NOT EXISTS idx_sh_sender_daily_date ON sh_sender_daily_log(log_date);
CREATE INDEX IF NOT EXISTS idx_sh_sender_daily_email ON sh_sender_daily_log(sender_email);

ALTER TABLE sh_sender_daily_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on sh_sender_daily_log"
  ON sh_sender_daily_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE sh_sender_daily_log IS 'Daily send/bounce/open/reply counts per sender. Used for health trending.';

-- ─────────────────────────────────────────────────────────────────
-- TABLE 3: sh_sender_alerts — Health alerts and notifications
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sh_sender_alerts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_email  TEXT NOT NULL,
  alert_type    TEXT NOT NULL,    -- 'high_bounce_rate', 'auto_paused', 'warmup_complete', 'limit_reached'
  message       TEXT NOT NULL,
  resolved      BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sh_alerts_resolved ON sh_sender_alerts(resolved);
CREATE INDEX IF NOT EXISTS idx_sh_alerts_created ON sh_sender_alerts(created_at);

ALTER TABLE sh_sender_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on sh_sender_alerts"
  ON sh_sender_alerts FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE sh_sender_alerts IS 'Health alerts for sender pool: auto-pause events, warmup completions, bounce warnings.';

-- ─────────────────────────────────────────────────────────────────
-- SEED DATA: All 11 sender accounts
-- ─────────────────────────────────────────────────────────────────

-- Cold pool: 5 SalesHandy-generated accounts on separate domains
INSERT INTO sh_senders (id, email, display_name, domain, sender_group, provider, status, warmup_start_date, daily_limit, max_daily_limit) VALUES
  ('cold-1', 'kevin.patrick@trytrinityoneconsulting.com',   'Kevin Patrick | Trinity One Consulting', 'trytrinityoneconsulting.com',   'cold-pool', 'saleshandy', 'warmup', CURRENT_DATE, 5, 50),
  ('cold-2', 'kevin.patrick@gettrinityoneconsulting.com',   'Kevin Patrick | Trinity One Consulting', 'gettrinityoneconsulting.com',   'cold-pool', 'saleshandy', 'warmup', CURRENT_DATE, 5, 50),
  ('cold-3', 'kevin.patrick@gotrinityoneconsulting.com',    'Kevin Patrick | Trinity One Consulting', 'gotrinityoneconsulting.com',    'cold-pool', 'saleshandy', 'warmup', CURRENT_DATE, 5, 50),
  ('cold-4', 'kevin.patrick@jointrinityoneconsulting.com',  'Kevin Patrick | Trinity One Consulting', 'jointrinityoneconsulting.com',  'cold-pool', 'saleshandy', 'warmup', CURRENT_DATE, 5, 50),
  ('cold-5', 'kevin.patrick@reachtrinityoneconsulting.com', 'Kevin Patrick | Trinity One Consulting', 'reachtrinityoneconsulting.com', 'cold-pool', 'saleshandy', 'warmup', CURRENT_DATE, 5, 50)
ON CONFLICT (id) DO NOTHING;

-- Warm pool: 5 Namecheap aliases on trinityoneconsulting.io (shared domain)
INSERT INTO sh_senders (id, email, display_name, domain, sender_group, provider, status, warmup_start_date, daily_limit, max_daily_limit) VALUES
  ('warm-1', 'admin@trinityoneconsulting.io',     'Trinity One Consulting', 'trinityoneconsulting.io', 'warm-pool', 'namecheap', 'warmup', CURRENT_DATE, 3, 30),
  ('warm-2', 'crm@trinityoneconsulting.io',       'Trinity One Consulting', 'trinityoneconsulting.io', 'warm-pool', 'namecheap', 'warmup', CURRENT_DATE, 3, 30),
  ('warm-3', 'info@trinityoneconsulting.io',      'Trinity One Consulting', 'trinityoneconsulting.io', 'warm-pool', 'namecheap', 'warmup', CURRENT_DATE, 3, 30),
  ('warm-4', 'marketing@trinityoneconsulting.io',  'Trinity One Consulting', 'trinityoneconsulting.io', 'warm-pool', 'namecheap', 'warmup', CURRENT_DATE, 3, 30),
  ('warm-5', 'sales@trinityoneconsulting.io',     'Trinity One Consulting', 'trinityoneconsulting.io', 'warm-pool', 'namecheap', 'warmup', CURRENT_DATE, 3, 30)
ON CONFLICT (id) DO NOTHING;

-- Content/podcast nurture: Dream Dividend brand (separate domain, isolated reputation)
INSERT INTO sh_senders (id, email, display_name, domain, sender_group, provider, status, warmup_start_date, daily_limit, max_daily_limit) VALUES
  ('content-1', 'kpatrick@thedreamdividend.com', 'Kevin Patrick | The Dream Dividend', 'thedreamdividend.com', 'content-pool', 'existing', 'active', NULL, 30, 30)
ON CONFLICT (id) DO NOTHING;

-- Protected: Primary brand email (never used for bulk)
INSERT INTO sh_senders (id, email, display_name, domain, sender_group, provider, status, warmup_start_date, daily_limit, max_daily_limit) VALUES
  ('primary', 'kevin@trinityoneconsulting.com', 'Kevin Patrick | Trinity One Consulting', 'trinityoneconsulting.com', 'protected', 'existing', 'active', NULL, 10, 10)
ON CONFLICT (id) DO NOTHING;
