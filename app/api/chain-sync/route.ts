/**
 * POST /api/chain-sync
 * After a task-posting tx confirms, extracts the on-chain task ID from the
 * tx result and stamps it onto the existing DB record (optimistic write).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

const RPC = 'https://api.testnet.hiro.so'

export async function POST(req: NextRequest) {
  try {
    const { tx_id, action, db_task_id } = await req.json()
    if (!tx_id) return NextResponse.json({ error: 'tx_id required' }, { status: 400 })

    // Fetch confirmed tx
    const r = await fetch(`${RPC}/extended/v1/tx/${tx_id}`)
    if (!r.ok) return NextResponse.json({ error: 'tx not found' }, { status: 404 })
    const tx = await r.json()

    if (tx.tx_status !== 'success') {
      return NextResponse.json({ ok: false, status: tx.tx_status })
    }

    // Parse on-chain ID from tx_result repr e.g. "(ok u7)"
    const repr: string = tx.tx_result?.repr ?? ''
    const match = repr.match(/\(ok\s+u(\d+)\)/)
    const onChainId = match ? parseInt(match[1]) : null

    if (action === 'post_task' && onChainId !== null && db_task_id) {
      const sb = getSupabase()
      await sb.from('tasks')
        .update({ on_chain_task_id: onChainId })
        .eq('id', db_task_id)
    }

    return NextResponse.json({ ok: true, on_chain_id: onChainId, tx_status: tx.tx_status })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
