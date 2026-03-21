import { NextRequest, NextResponse } from 'next/server'
import * as db from '@/lib/db'

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get('task_id')
  const bids = await db.getAllBids(taskId !== null ? parseInt(taskId) : undefined)
  return NextResponse.json(bids)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const task = await db.getTask(body.task_id)
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (task.status !== 0) return NextResponse.json({ error: 'Task is not open for bids' }, { status: 400 })
    if (body.bidder === task.poster) return NextResponse.json({ error: 'Cannot bid on your own task' }, { status: 400 })
    if (await db.checkExistingBid(body.task_id, body.bidder)) return NextResponse.json({ error: 'Already bid on this task' }, { status: 400 })
    const stakeAmount = body.stake_amount ?? task.required_stake
    const block = await db.getBlockHeight()
    const bidId = await db.createBid({ ...body, stake_amount: stakeAmount }, block)
    await db.incrementBidCount(body.task_id)
    await db.updateMolbotStaked(body.bidder, stakeAmount)
    await db.incrementBlock()
    await db.createPayment(body.task_id, body.bidder, 'contract:registry', stakeAmount, 'sBTC', 'escrow')
    const bid = await db.getBid(bidId)
    return NextResponse.json(bid)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
