import { NextRequest, NextResponse } from 'next/server'
import {
  makeContractCall,
  broadcastTransaction,
  AnchorMode,
  standardPrincipalCV,
  uintCV,
  PostConditionMode,
} from '@stacks/transactions'
// @stacks/transactions expects the literal string 'testnet'

const DEPLOYER = 'ST1E79A6EWV7VB0Z777XTGD2KFXSB9VPHF53KPNFJ'
const API_URL  = 'https://api.testnet.hiro.so'

async function mintToken(
  contract: string,
  recipient: string,
  amount: bigint,
  key: string,
  nonce: bigint,
) {
  const tx = await makeContractCall({
    contractAddress:  DEPLOYER,
    contractName:     contract,
    functionName:     'mint',
    functionArgs:     [uintCV(amount), standardPrincipalCV(recipient)],
    senderKey:        key,
    network:          'testnet' as const,
    anchorMode:       AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
    nonce,
    fee: BigInt(2000),
  })
  const result = await broadcastTransaction(tx as any, 'testnet' as any)
  return result
}

export async function POST(req: NextRequest) {
  const key = process.env.DEPLOYER_STACKS_KEY
  if (!key) return NextResponse.json({ error: 'Faucet not configured' }, { status: 503 })

  try {
    const { address } = await req.json()
    if (!address || (!address.startsWith('ST') && !address.startsWith('SP'))) {
      return NextResponse.json({ error: 'Invalid Stacks address' }, { status: 400 })
    }

    // Get current nonce for deployer
    const nonceResp = await fetch(`${API_URL}/v2/accounts/${DEPLOYER}?proof=0`)
    const nonceData = await nonceResp.json()
    const nonce = BigInt(nonceData.nonce ?? 0)

    // Mint sBTC and USDCx in parallel (different nonces)
    const AMOUNT_SBTC  = BigInt(100_000_000)  // 1 sBTC  (8 decimals = 1e8 sats)
    const AMOUNT_USDCX = BigInt(100_000_000)  // 100 USDCx (6 decimals = 1e8 micro)

    const [sbtcResult, usdcxResult] = await Promise.all([
      mintToken('sbtc',  address, AMOUNT_SBTC,  key, nonce),
      mintToken('usdcx', address, AMOUNT_USDCX, key, nonce + BigInt(1)),
    ])

    return NextResponse.json({
      ok:          true,
      sbtc_txid:   (sbtcResult  as any).txid ?? sbtcResult,
      usdcx_txid:  (usdcxResult as any).txid ?? usdcxResult,
      sbtc_amount: '1.00000000',
      usdcx_amount:'100.000000',
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
