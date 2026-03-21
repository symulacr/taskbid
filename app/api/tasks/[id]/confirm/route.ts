import { NextRequest, NextResponse } from 'next/server'
import * as db from '@/lib/db'

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const taskId = parseInt(id)
    const task = await db.getTask(taskId)
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (task.status !== 2) return NextResponse.json({ error: 'Task work not submitted yet' }, { status: 400 })
    const worker = task.assigned_to
    const reward = task.reward_amount
    const fee = Math.floor(reward * 5 / 100)
    const netReward = reward - fee
    const bids = await db.getAllBids(taskId)
    const acceptedBid = bids.find((b: any) => b.status === 1)
    const stakeAmount = acceptedBid?.stake_amount ?? task.required_stake
    await db.updateTaskStatus(taskId, 3)
    await db.updateMolbotCompletion(worker, netReward)
    await db.incrementBlock()
    await db.createPayment(taskId, 'contract:registry', worker, stakeAmount, 'sBTC', 'release')
    await db.createPayment(taskId, 'contract:registry', worker, netReward, 'USDCx', 'reward')
    return NextResponse.json({ status: 'completed', worker, reward_paid: netReward, stake_released: stakeAmount, platform_fee: fee })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
