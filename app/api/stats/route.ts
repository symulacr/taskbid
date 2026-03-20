import { NextResponse } from 'next/server'
import * as db from '@/lib/db'

export async function GET() {
  try {
    return NextResponse.json(await db.getStats())
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
