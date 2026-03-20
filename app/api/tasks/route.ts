import { NextRequest, NextResponse } from 'next/server'
import * as db from '@/lib/db'

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status')
  const tasks = await db.getAllTasks(status !== null ? parseInt(status) : undefined)
  return NextResponse.json(tasks)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const block = await db.getBlockHeight()
    const taskId = await db.createTask(body, block)
    await db.createPayment(taskId, body.poster, 'contract:task-registry', body.reward_amount, 'USDCx', 'escrow')
    await db.incrementBlock()
    const task = await db.getTask(taskId)
    return NextResponse.json(task)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
