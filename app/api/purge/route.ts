import { NextRequest, NextResponse } from 'next/server'
import { purgeBySize } from '@/lib/analytics'

// Size-based purge: deletes oldest ux_events rows until DB usage < threshold%.
// Default threshold = 75% of database storage limit.
//
// Usage:
//   GET  /api/purge              → purge until DB < 75%
//   GET  /api/purge?threshold=60 → purge until DB < 60%
//   POST /api/purge              → same, body: { "threshold": 75 }

async function handle(threshold: number) {
  const result = await purgeBySize(threshold)
  return NextResponse.json({
    ok:               true,
    threshold_pct:    threshold,
    deleted:          result.deleted,
    db_bytes:         result.db_bytes,
    db_limit_bytes:   result.db_limit_bytes,
    table_bytes:      result.table_bytes,
    usage_pct_before: result.usage_pct_before,
    usage_pct_after:  result.usage_pct_after,
    summary:          result.deleted === 0
      ? `DB already below ${threshold}% — nothing purged`
      : `Deleted ${result.deleted} rows. DB: ${result.usage_pct_before}% → ${result.usage_pct_after}%`,
  })
}

export async function GET(req: NextRequest) {
  try {
    const threshold = Number(req.nextUrl.searchParams.get('threshold') ?? 75)
    return handle(threshold)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { threshold = 75 } = await req.json().catch(() => ({}))
    return handle(Number(threshold))
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
