import { getSupabase } from './supabase'

export interface UxEvent {
  event:      string
  category?:  string
  session_id?: string
  wallet?:    string
  view?:      string
  data?:      Record<string, unknown>
  url?:       string
  user_agent?: string
  ts?:        string
}

// Insert a single event — used by server-side routes if needed
export async function recordEvent(e: UxEvent) {
  try {
    await getSupabase().from('ux_events').insert(toRow(e))
  } catch { /* analytics must never break the app */ }
}

// Insert a batch of events — called by /api/track (array body)
export async function recordEvents(events: UxEvent[]) {
  if (!events.length) return
  try {
    await getSupabase().from('ux_events').insert(events.map(toRow))
  } catch { /* silent */ }
}

// ── Size-based purge ──────────────────────────────────────────────
// Queries actual DB and table sizes via the Supabase Management API,
// then deletes oldest ux_events rows until DB usage is below `thresholdPct`.
// Falls back to deleting the oldest half of rows if size query fails.

export interface PurgeResult {
  deleted:        number
  db_bytes:       number | null
  db_limit_bytes: number | null
  table_bytes:    number | null
  usage_pct_before: number | null
  usage_pct_after:  number | null
}

async function runSQL(sql: string): Promise<any[]> {
  const ref   = process.env.SUPABASE_PROJECT_REF
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!ref || !token) throw new Error('SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN not set')
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ query: sql }),
  })
  if (!r.ok) throw new Error(`Management API ${r.status}: ${await r.text()}`)
  return r.json()
}

export async function purgeBySize(thresholdPct = 75): Promise<PurgeResult> {
  const sb = getSupabase()
  let db_bytes:       number | null = null
  let db_limit_bytes: number | null = null
  let table_bytes:    number | null = null
  let usage_pct_before: number | null = null

  // 1. Get current sizes
  try {
    const rows = await runSQL(`
      SELECT
        pg_database_size(current_database())              AS db_bytes,
        pg_total_relation_size('api.ux_events')           AS table_bytes,
        (SELECT option_value::bigint
         FROM   pg_options_to_table(
                  (SELECT reloptions FROM pg_class WHERE relname='pg_database')
                )
         WHERE  option_name = 'pg_database_size_max'
        )                                                 AS db_limit_bytes
    `)
    const row = rows[0] ?? {}
    db_bytes       = Number(row.db_bytes   ?? 0)
    table_bytes    = Number(row.table_bytes ?? 0)
    // Supabase free tier = 500 MB; limit not stored in pg, use 500 MB as default
    db_limit_bytes = Number(row.db_limit_bytes ?? 0) || 500 * 1024 * 1024
    usage_pct_before = db_limit_bytes > 0
      ? Math.round((db_bytes / db_limit_bytes) * 100)
      : null
  } catch {
    // Size query failed — proceed with fallback
  }

  // 2. Decide how many rows to delete
  let deleted = 0

  if (usage_pct_before !== null && usage_pct_before < thresholdPct) {
    // Already below threshold — nothing to do
    return { deleted: 0, db_bytes, db_limit_bytes, table_bytes, usage_pct_before, usage_pct_after: usage_pct_before }
  }

  if (table_bytes !== null && db_limit_bytes !== null && db_bytes !== null) {
    // Calculate how many bytes need to be freed to reach threshold
    const target_db_bytes = db_limit_bytes * (thresholdPct / 100)
    const bytes_to_free   = Math.max(0, db_bytes - target_db_bytes)

    if (bytes_to_free > 0 && table_bytes > 0) {
      // Estimate rows to delete: bytes_to_free / avg_row_bytes
      const { count: total } = await sb.from('ux_events').select('*', { count: 'exact', head: true })
      const totalRows = total ?? 0
      if (totalRows > 0) {
        const avg_row_bytes = table_bytes / totalRows
        const rows_to_delete = Math.ceil(bytes_to_free / avg_row_bytes)
        // Delete that many oldest rows
        const { data: oldest } = await sb
          .from('ux_events').select('id').order('ts', { ascending: true }).limit(rows_to_delete)
        if (oldest?.length) {
          const ids = oldest.map((r: any) => r.id)
          const { count } = await sb.from('ux_events').delete({ count: 'exact' }).in('id', ids)
          deleted = count ?? 0
        }
      }
    }
  } else {
    // Fallback: delete oldest 50% of rows
    const { count: total } = await sb.from('ux_events').select('*', { count: 'exact', head: true })
    const half = Math.floor((total ?? 0) / 2)
    if (half > 0) {
      const { data: oldest } = await sb
        .from('ux_events').select('id').order('ts', { ascending: true }).limit(half)
      if (oldest?.length) {
        const ids = oldest.map((r: any) => r.id)
        const { count } = await sb.from('ux_events').delete({ count: 'exact' }).in('id', ids)
        deleted = count ?? 0
      }
    }
  }

  // 3. Re-measure after purge
  let usage_pct_after: number | null = null
  try {
    const rows2 = await runSQL(`SELECT pg_database_size(current_database()) AS db_bytes`)
    const new_db_bytes = Number(rows2[0]?.db_bytes ?? 0)
    usage_pct_after = db_limit_bytes
      ? Math.round((new_db_bytes / db_limit_bytes) * 100)
      : null
  } catch {}

  return { deleted, db_bytes, db_limit_bytes, table_bytes, usage_pct_before, usage_pct_after }
}

// Legacy: day-based purge kept for backwards compat
export async function purgeOldEvents(days = 7): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const { count, error } = await getSupabase()
    .from('ux_events')
    .delete({ count: 'exact' })
    .lt('ts', cutoff)
  if (error) throw error
  return count ?? 0
}

function toRow(e: UxEvent) {
  return {
    ts:         e.ts         ?? new Date().toISOString(),
    session_id: e.session_id ?? null,
    wallet:     e.wallet     ?? null,
    event:      e.event,
    category:   e.category   ?? null,
    view:       e.view        ?? null,
    data:       e.data        ?? null,
    url:        e.url         ?? null,
    user_agent: e.user_agent  ?? null,
  }
}
