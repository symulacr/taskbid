import { NextRequest, NextResponse } from 'next/server'

// Runs DDL via Supabase Management API.
// Requires SUPABASE_ACCESS_TOKEN (personal token) and SUPABASE_PROJECT_REF.
// Get token: https://app.supabase.com/account/tokens
// Usage: GET /api/migrate?token=YOUR_TOKEN
//    or: set SUPABASE_ACCESS_TOKEN in Vercel env, then GET /api/migrate

const DDL = `
-- add on_chain_task_id to tasks (idempotent)
ALTER TABLE api.tasks ADD COLUMN IF NOT EXISTS on_chain_task_id INT;

-- create in 'api' schema (matches supabase.ts db.schema setting)
CREATE TABLE IF NOT EXISTS api.ux_events (
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

CREATE INDEX IF NOT EXISTS ux_events_ts      ON api.ux_events (ts DESC);
CREATE INDEX IF NOT EXISTS ux_events_session ON api.ux_events (session_id);
CREATE INDEX IF NOT EXISTS ux_events_event   ON api.ux_events (event);
CREATE INDEX IF NOT EXISTS ux_events_wallet  ON api.ux_events (wallet) WHERE wallet IS NOT NULL;

ALTER TABLE api.ux_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ux_events' AND policyname='svc_all') THEN
    CREATE POLICY "svc_all" ON api.ux_events USING (true) WITH CHECK (true);
  END IF;
END $$;
`

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
               ?? process.env.SUPABASE_ACCESS_TOKEN
  const ref   = process.env.SUPABASE_PROJECT_REF

  if (!token) {
    return NextResponse.json({
      error: 'Missing token',
      howto: 'Get your personal access token at https://app.supabase.com/account/tokens then call: /api/migrate?token=YOUR_TOKEN',
    }, { status: 401 })
  }

  if (!ref) {
    return NextResponse.json({ error: 'SUPABASE_PROJECT_REF not set' }, { status: 500 })
  }

  const url  = `https://api.supabase.com/v1/projects/${ref}/database/query`
  const resp = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ query: DDL }),
  })

  const body = await resp.json().catch(() => ({}))

  if (!resp.ok) {
    return NextResponse.json({ error: body?.message ?? resp.statusText, status: resp.status }, { status: resp.status })
  }

  // Probe: confirm table is now accessible via the JS client
  const { getSupabase } = await import('@/lib/supabase')
  const { error: probeErr } = await getSupabase()
    .from('ux_events')
    .select('id')
    .limit(1)

  return NextResponse.json({
    ok:          true,
    ddl_result:  body,
    table_ready: !probeErr,
    probe_error: probeErr?.message ?? null,
    next:        !probeErr
      ? 'ux_events table ready. Delete app/api/migrate/ from the repo.'
      : 'DDL ran but table not reachable via JS client — check schema/RLS',
  })
}
