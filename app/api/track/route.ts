import { NextRequest, NextResponse } from 'next/server'
import { recordEvent, recordEvents } from '@/lib/analytics'

export async function POST(req: NextRequest) {
  try {
    const ua   = req.headers.get('user-agent')  ?? undefined
    const path = req.headers.get('referer')      ?? undefined
    const body = await req.json()

    if (Array.isArray(body)) {
      // Batch from the browser flush queue
      await recordEvents(body.map((e: any) => ({ ...e, user_agent: ua, url: path })))
      return NextResponse.json({ ok: true, count: body.length })
    }

    // Single event (legacy / server-side callers)
    await recordEvent({ ...body, user_agent: ua, url: path })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
}
