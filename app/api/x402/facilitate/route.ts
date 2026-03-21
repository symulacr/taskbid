import { NextResponse } from 'next/server'

const DEMO_MODE = process.env.DEMO_MODE === 'true'

export async function POST() {
  if (!DEMO_MODE) {
    return NextResponse.json(
      { error: 'Unavailable', message: 'Demo x402 facilitator is disabled. Set DEMO_MODE=true for local-only testing.' },
      { status: 501 }
    )
  }

  const txId = `0xdemo${Date.now().toString(16).padStart(12, '0')}`
  return NextResponse.json({ status: 'settled', network: 'stacks-testnet', txId, demo: true })
}