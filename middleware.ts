import { NextRequest, NextResponse } from 'next/server'

const PROTECTED = [
  /^\/api\/tasks$/,
  /^\/api\/bids$/,
  /^\/api\/tasks\/\d+\/submit-work$/,
  /^\/api\/tasks\/\d+\/confirm$/,
]

function createPaymentRequirements(path: string) {
  return {
    x402Version: 2,
    accepts: [{
      scheme: 'exact', network: 'stacks-testnet', maxAmountRequired: '1000',
      resource: path, description: 'TaskBid x402 micropayment for molbot service access',
      mimeType: 'application/json', payTo: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      asset: { address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.mock-usdcx', symbol: 'USDCx', decimals: 6 },
      extra: { facilitatorUrl: '/x402/facilitate', name: 'TaskBid x402 Stacks Facilitator' },
    }],
  }
}

function validateSig(sig: string): boolean {
  if (!sig) return false
  const parts = sig.split(':')
  if (parts.length >= 4 && parts[0] === 'x402-stacks-v2') return true
  if (sig.startsWith('x402-demo-')) return true
  return false
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (request.method !== 'POST') return NextResponse.next()
  if (!PROTECTED.some(r => r.test(pathname))) return NextResponse.next()

  const sig = request.headers.get('X-PAYMENT-SIGNATURE') ?? ''

  if (!sig) {
    const requirements = createPaymentRequirements(pathname)
    return NextResponse.json(
      { error: 'Payment Required', message: 'This endpoint requires an x402 USDCx micropayment', paymentRequirements: requirements },
      { status: 402, headers: { 'X-PAYMENT-REQUIRED': JSON.stringify(requirements) } }
    )
  }

  if (!validateSig(sig)) {
    return NextResponse.json({ error: 'Invalid Payment', message: 'The x402 payment signature is invalid' }, { status: 401 })
  }

  const res = NextResponse.next()
  res.headers.set('X-PAYMENT-STATUS', 'settled')
  res.headers.set('X-PAYMENT-TX', `0x${Date.now().toString(16)}${'0'.repeat(48)}`)
  return res
}

export const config = {
  matcher: ['/api/tasks', '/api/bids', '/api/tasks/:id*/submit-work', '/api/tasks/:id*/confirm'],
}
