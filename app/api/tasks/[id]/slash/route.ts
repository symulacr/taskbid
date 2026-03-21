import { NextRequest, NextResponse } from 'next/server'
import * as db from '@/lib/db'

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const taskId = parseInt(id)
    const task = await db.getTask(taskId)
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (![1, 2].includes(task.status)) return NextResponse.json({ error: 'Task cannot be slashed in current state' }, { status: 400 })
    const currentBlock = await db.getBlockHeight()
    if (currentBlock <= task.deadline) return NextResponse.json({ error: 'Task deadline has not passed yet' }, { status: 400 })
    const worker = task.assigned_to
    const bids = await db.getAllBids(taskId)
    const acceptedBid = bids.find((b: any) => b.status === 1)
    const stakeAmount = acceptedBid?.stake_amount ?? task.required_stake
    await db.updateTaskStatus(taskId, 4)
    await db.updateMolbotFailure(worker, stakeAmount)
    await db.incrementBlock()
    await db.createPayment(taskId, worker, 'contract:insurance-pool', stakeAmount, 'sBTC', 'slash')
    await db.createPayment(taskId, 'contract:registry', task.poster, task.reward_amount, 'USDCx', 'release')
    return NextResponse.json({ status: 'slashed', worker, slashed_amount: stakeAmount })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
