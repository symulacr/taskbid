import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({ status: 'settled', network: 'stacks-testnet', txId: '0xdemo_settlement_tx' })
}
