import { NextRequest, NextResponse } from 'next/server'
import * as db from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const taskId = parseInt(id)
    const { bid_id } = await req.json()
    const task = await db.getTask(taskId)
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (task.status !== 0) return NextResponse.json({ error: 'Task is not open' }, { status: 400 })
    const bid = await db.getBid(bid_id)
    if (!bid) return NextResponse.json({ error: 'Bid not found' }, { status: 404 })
    if (bid.task_id !== taskId) return NextResponse.json({ error: 'Bid does not belong to this task' }, { status: 400 })
    if (bid.status !== 0) return NextResponse.json({ error: 'Bid is not pending' }, { status: 400 })
    await db.updateTaskStatus(taskId, 1, bid.bidder)
    await db.updateBidStatus(bid_id, 1)
    await db.incrementBlock()
    return NextResponse.json({ status: 'accepted', assigned_to: bid.bidder })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
