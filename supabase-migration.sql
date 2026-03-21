-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New Query)

CREATE TABLE IF NOT EXISTS ux_events (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id  TEXT,
  wallet      TEXT,
  event       TEXT NOT NULL,
  category    TEXT,
  view        TEXT,
  data        JSONB,
  url         TEXT,
  user_agent  TEXT
);

-- Indexes for the queries you'll run most
CREATE INDEX IF NOT EXISTS ux_events_ts          ON ux_events (ts DESC);
CREATE INDEX IF NOT EXISTS ux_events_session     ON ux_events (session_id);
CREATE INDEX IF NOT EXISTS ux_events_event       ON ux_events (event);
CREATE INDEX IF NOT EXISTS ux_events_wallet      ON ux_events (wallet) WHERE wallet IS NOT NULL;

-- Allow anon inserts (the Next.js server uses the service key, but just in case)
ALTER TABLE ux_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_insert" ON ux_events FOR INSERT WITH CHECK (true);
CREATE POLICY "service_select" ON ux_events FOR SELECT USING (true);
CREATE POLICY "service_delete" ON ux_events FOR DELETE USING (true);

-- Useful analysis queries (run any time in SQL editor):

-- 1. Dead-click rate by session
-- SELECT session_id, COUNT(*) FILTER (WHERE event='dead_click') AS dead,
--        COUNT(*) AS total,
--        ROUND(COUNT(*) FILTER (WHERE event='dead_click')::numeric / COUNT(*) * 100, 1) AS pct
-- FROM ux_events WHERE event IN ('click','dead_click')
-- GROUP BY session_id ORDER BY dead DESC;

-- 2. Rage clicks
-- SELECT data->>'target' AS target, COUNT(*) AS rages
-- FROM ux_events WHERE event = 'rage_click'
-- GROUP BY 1 ORDER BY 2 DESC;

-- 3. Funnel: wallet open → connect attempt → success
-- SELECT
--   COUNT(*) FILTER (WHERE event='wallet_modal_open')    AS modal_opens,
--   COUNT(*) FILTER (WHERE event='wallet_connect_attempt') AS attempts,
--   COUNT(*) FILTER (WHERE event='wallet_connect_success') AS successes
-- FROM ux_events;

-- 4. Scroll depth distribution
-- SELECT data->>'pct' AS depth_pct, COUNT(*) AS sessions
-- FROM ux_events WHERE event='scroll_depth'
-- GROUP BY 1 ORDER BY 1::int;

-- 5. Avg time to first interaction
-- SELECT ROUND(AVG((data->>'first_interact_ms')::numeric)) AS avg_ms
-- FROM ux_events WHERE event='pattern_snapshot';

-- Purge events older than 30 days (also available via /api/purge?days=30)
-- DELETE FROM ux_events WHERE ts < NOW() - INTERVAL '30 days';
