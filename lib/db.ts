/**
 * All database operations — thin wrappers around Supabase JS client.
 * Mirrors the Python database.py API exactly so route handlers stay clean.
 */
import { getSupabase } from './supabase'
import { getBlockHeight, incrementBlock } from './block'

const sb = () => getSupabase()

// ── Tasks ─────────────────────────────────────────────────────────────────

export async function createTask(req: {
  poster: string; title: string; description: string; skill_required: string
  reward_amount: number; required_stake: number; deadline_blocks: number
  on_chain_task_id?: number
}, currentBlock: number) {
  const { data, error } = await sb().from('tasks').insert({
    poster: req.poster, title: req.title, description: req.description,
    skill_required: req.skill_required, reward_amount: req.reward_amount,
    required_stake: req.required_stake,
    deadline: currentBlock + req.deadline_blocks,
    status: 0, created_at: currentBlock, bid_count: 0,
    on_chain_task_id: req.on_chain_task_id ?? null,
  }).select('id').single()
  if (error) throw error
  return data.id as number
}

export async function getTask(id: number) {
  const { data, error } = await sb().from('tasks').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function getAllTasks(status?: number) {
  let q = sb().from('tasks').select('*').order('id', { ascending: false })
  if (status !== undefined) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function getOpenTasks(skillType?: string) {
  let q = sb().from('tasks').select('*').eq('status', 0).order('reward_amount', { ascending: false })
  if (skillType) q = q.eq('skill_required', skillType)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function updateTaskStatus(id: number, status: number, assignedTo?: string) {
  const update: Record<string, unknown> = { status }
  if (assignedTo) update.assigned_to = assignedTo
  const { error } = await sb().from('tasks').update(update).eq('id', id)
  if (error) throw error
}

export async function incrementBidCount(taskId: number) {
  const { data } = await sb().from('tasks').select('bid_count').eq('id', taskId).single()
  await sb().from('tasks').update({ bid_count: (data?.bid_count ?? 0) + 1 }).eq('id', taskId)
}

// ── Bids ──────────────────────────────────────────────────────────────────

export async function createBid(req: {
  task_id: number; bidder: string; bid_price: number; stake_amount: number
}, currentBlock: number) {
  const { data, error } = await sb().from('bids').insert({
    task_id: req.task_id, bidder: req.bidder,
    stake_amount: req.stake_amount, bid_price: req.bid_price,
    status: 0, created_at: currentBlock,
  }).select('id').single()
  if (error) throw error
  return data.id as number
}

export async function getBid(id: number) {
  const { data, error } = await sb().from('bids').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function getAllBids(taskId?: number) {
  let q = sb().from('bids').select('*').order('id', { ascending: false })
  if (taskId !== undefined) q = q.eq('task_id', taskId)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function updateBidStatus(id: number, status: number) {
  const { error } = await sb().from('bids').update({ status }).eq('id', id)
  if (error) throw error
}

export async function checkExistingBid(taskId: number, bidder: string) {
  const { data } = await sb().from('bids').select('id').eq('task_id', taskId).eq('bidder', bidder).maybeSingle()
  return !!data
}

// ── Molbots ───────────────────────────────────────────────────────────────

export async function registerMolbot(address: string, skillType: string, currentBlock: number, name?: string) {
  await sb().from('molbot_profiles').upsert({
    address, skill_type: skillType, registered_at: currentBlock, name: name ?? null,
    total_tasks_completed: 0, total_tasks_failed: 0, total_earned: 0,
    total_staked: 0, total_slashed: 0, reputation_score: 500,
  }, { onConflict: 'address', ignoreDuplicates: true })
}

export async function getMolbot(address: string) {
  const { data, error } = await sb().from('molbot_profiles').select('*').eq('address', address).maybeSingle()
  if (error) throw error
  return data
}

export async function getAllMolbots() {
  const { data, error } = await sb().from('molbot_profiles').select('*').order('reputation_score', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function updateMolbotCompletion(address: string, earned: number) {
  const { data } = await sb().from('molbot_profiles').select('total_tasks_completed,total_earned,reputation_score').eq('address', address).single()
  if (!data) return
  await sb().from('molbot_profiles').update({
    total_tasks_completed: data.total_tasks_completed + 1,
    total_earned: data.total_earned + earned,
    reputation_score: Math.min(1000, data.reputation_score + 50),
  }).eq('address', address)
}

export async function updateMolbotFailure(address: string, slashed: number) {
  const { data } = await sb().from('molbot_profiles').select('total_tasks_failed,total_slashed,reputation_score').eq('address', address).single()
  if (!data) return
  await sb().from('molbot_profiles').update({
    total_tasks_failed: data.total_tasks_failed + 1,
    total_slashed: data.total_slashed + slashed,
    reputation_score: Math.max(0, data.reputation_score - 100),
  }).eq('address', address)
}

export async function updateMolbotStaked(address: string, amount: number) {
  const { data } = await sb().from('molbot_profiles').select('total_staked').eq('address', address).single()
  if (!data) return
  await sb().from('molbot_profiles').update({ total_staked: data.total_staked + amount }).eq('address', address)
}

// ── Payments ──────────────────────────────────────────────────────────────

export async function createPayment(taskId: number, fromAddr: string, toAddr: string, amount: number, token: string, txType: string) {
  const { data, error } = await sb().from('payment_records').insert({
    task_id: taskId, from_address: fromAddr, to_address: toAddr,
    amount, token, tx_type: txType,
    timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
  }).select('id').single()
  if (error) throw error
  return data.id as number
}

export async function getAllPayments() {
  const { data, error } = await sb().from('payment_records').select('*').order('id', { ascending: false })
  if (error) throw error
  return data ?? []
}

// ── Stats ─────────────────────────────────────────────────────────────────

export async function getStats() {
  const [tasks, active, volume, staked, molbots, block] = await Promise.all([
    sb().from('tasks').select('*', { count: 'exact', head: true }),
    sb().from('tasks').select('*', { count: 'exact', head: true }).in('status', [0, 1, 2]),
    sb().from('tasks').select('reward_amount'),
    sb().from('bids').select('stake_amount').eq('status', 1),
    sb().from('molbot_profiles').select('*', { count: 'exact', head: true }),
    getBlockHeight(),
  ])
  return {
    total_tasks: tasks.count ?? 0,
    active_tasks: active.count ?? 0,
    total_volume: (volume.data ?? []).reduce((s: number, r: any) => s + (r.reward_amount ?? 0), 0),
    total_staked: (staked.data ?? []).reduce((s: number, r: any) => s + (r.stake_amount ?? 0), 0),
    total_molbots: molbots.count ?? 0,
    current_block: block,
  }
}

// ── Seed ──────────────────────────────────────────────────────────────────

// USDCx uses 6 decimal places (1 USDCx = 1_000_000 micro-USDCx)
// sBTC uses 8 decimal places (1 sBTC = 100_000_000 sats)

export async function seedDemoData() {
  const client = sb()

  // Wipe in FK-safe order (children first)
  await client.from('payment_records').delete().neq('id', 0)
  await client.from('bids').delete().neq('id', 0)
  await client.from('tasks').delete().neq('id', 0)
  await client.from('molbot_profiles').delete().neq('address', '')

  const molbot1 = process.env.MOLBOT1_ADDRESS ?? 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5'
  const molbot2 = process.env.MOLBOT2_ADDRESS ?? 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG'
  const poster  = 'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC'

  // Register molbots
  await registerMolbot(molbot1, 'content-generation', 1, 'ContentBot')
  await registerMolbot(molbot2, 'data-fetching',       1, 'DataBot')

  // Seed an open task so the board isn't empty
  // $5.00 USDCx reward, 0.001 sBTC required stake
  const REWARD = 5_000_000       // $5.00 USDCx
  const STAKE  = 100_000         // 0.001 sBTC
  const block  = await getBlockHeight()

  const { data: task, error } = await client.from('tasks').insert({
    poster, title: 'Summarise Stacks Q1 2025 ecosystem activity',
    description: 'Write a 300-word neutral summary of notable Stacks chain events in Q1 2025.',
    skill_required: 'content-generation',
    reward_amount: REWARD, required_stake: STAKE,
    deadline: block + 144, status: 0, created_at: block, bid_count: 0,
  }).select('id').single()
  if (error) throw error

  await createPayment(task.id, poster, 'contract:registry', REWARD, 'USDCx', 'escrow')
}

export { getBlockHeight, incrementBlock }
