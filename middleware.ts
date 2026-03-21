import { NextRequest, NextResponse } from 'next/server'

const DEMO_MODE = process.env.DEMO_MODE === 'true'

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
      mimeType: 'application/json', payTo: 'ST1E79A6EWV7VB0Z777XTGD2KFXSB9VPHF53KPNFJ',
      asset: { address: 'ST1E79A6EWV7VB0Z777XTGD2KFXSB9VPHF53KPNFJ.usdcx', symbol: 'USDCx', decimals: 6 },
      extra: { facilitatorUrl: '/api/x402/facilitate', name: 'TaskBid x402 Stacks Facilitator' },
    }],
  }
}

function validateSig(sig: string): { valid: boolean; isDemo: boolean } {
  if (!sig) return { valid: false, isDemo: false }

  const parts = sig.split(':')
  if (parts.length >= 4 && parts[0] === 'x402-stacks-v2') return { valid: true, isDemo: false }

  if (sig.startsWith('x402-demo-')) {
    // Demo signatures are intentionally opt-in and should never pass in production-like environments.
    if (!DEMO_MODE) return { valid: false, isDemo: false }
    return { valid: true, isDemo: true }
  }

  return { valid: false, isDemo: false }
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

  const checked = validateSig(sig)
  if (!checked.valid) {
    const usingDemoSig = sig.startsWith('x402-demo-')
    const message = usingDemoSig && !DEMO_MODE
      ? 'Demo x402 signatures are disabled. Set DEMO_MODE=true for local-only demo payments.'
      : 'The x402 payment signature is invalid'
    return NextResponse.json({ error: 'Invalid Payment', message }, { status: 401 })
  }

  const res = NextResponse.next()
  res.headers.set('X-PAYMENT-STATUS', checked.isDemo ? 'settled-demo' : 'settled')
  if (checked.isDemo) {
    res.headers.set('X-PAYMENT-TX', `0xdemo${Date.now().toString(16).padStart(12, '0')}`)
    res.headers.set('X-PAYMENT-DEMO', 'true')
  }
  return res
}

export const config = {
  matcher: ['/api/tasks', '/api/bids', '/api/tasks/:id*/submit-work', '/api/tasks/:id*/confirm'],
}
