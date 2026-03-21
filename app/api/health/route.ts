import { NextResponse } from 'next/server'

export async function GET() {
  const demoMode = process.env.DEMO_MODE === 'true'
  return NextResponse.json({ status: 'ok', service: 'taskbid-api', version: '2.0.0', demo_mode: demoMode })
}
