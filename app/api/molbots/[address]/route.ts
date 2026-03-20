import { NextRequest, NextResponse } from 'next/server'
import * as db from '@/lib/db'

export async function GET(_: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  const molbot = await db.getMolbot(address)
  if (!molbot) return NextResponse.json({ error: 'Molbot not found' }, { status: 404 })
  return NextResponse.json(molbot)
}
