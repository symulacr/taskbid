import { NextResponse } from 'next/server'
import { seedDemoData } from '@/lib/db'

export async function GET() {
  try {
    await seedDemoData()
    return NextResponse.json({ status: 'seeded', molbots: ['ContentBot', 'DataBot'], task: 'Q1 2025 summary ($5 USDCx)' })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
