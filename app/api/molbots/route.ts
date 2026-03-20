import { NextRequest, NextResponse } from 'next/server'
import * as db from '@/lib/db'

export async function GET() {
  return NextResponse.json(await db.getAllMolbots())
}

export async function POST(req: NextRequest) {
  try {
    const { address, skill_type, name } = await req.json()
    const block = await db.getBlockHeight()
    await db.registerMolbot(address, skill_type, block, name)
    await db.incrementBlock()
    return NextResponse.json({ status: 'registered', address })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
