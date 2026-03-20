import { getSupabase } from './supabase'

export async function getBlockHeight(): Promise<number> {
  const sb = getSupabase()
  const { data } = await sb.from('settings').select('value').eq('key', 'block_height').maybeSingle()
  return parseInt(data?.value ?? '100', 10)
}

export async function incrementBlock(): Promise<number> {
  const sb = getSupabase()
  const current = await getBlockHeight()
  const next = current + 1
  await sb.from('settings').upsert({ key: 'block_height', value: String(next) })
  return next
}
