import { NextRequest, NextResponse } from 'next/server'
import * as db from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const taskId = parseInt(id)
    const { worker, proof } = await req.json()
    const task = await db.getTask(taskId)
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (task.status !== 1) return NextResponse.json({ error: 'Task is not assigned' }, { status: 400 })
    if (task.assigned_to !== worker) return NextResponse.json({ error: 'Not assigned to this task' }, { status: 403 })
    await db.updateTaskStatus(taskId, 2)
    await db.incrementBlock()
    return NextResponse.json({ status: 'submitted', task_id: taskId })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
