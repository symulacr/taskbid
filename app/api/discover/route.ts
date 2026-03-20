import { NextRequest, NextResponse } from 'next/server'
import * as db from '@/lib/db'

export async function GET(req: NextRequest) {
  const skillType = req.nextUrl.searchParams.get('skill_type') ?? undefined
  return NextResponse.json(await db.getOpenTasks(skillType))
}
