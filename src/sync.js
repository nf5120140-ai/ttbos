// ============================================================
// תתבוס — סנכרון לשרת (Supabase)
// דוחף את תור השינויים המקומי ומושך שינויים ממכשירים אחרים.
// עובד גם כשאין אינטרנט: הכל נשמר מקומית ונשלח כשהרשת חוזרת.
// ============================================================
import { createClient } from '@supabase/supabase-js'
import { DEMO, outboxRows, markPushed, applyRemote, getMeta, setMeta, outboxSize, setOnLocalChange, ensureDefaultManager } from './db.js'

function readCfg() {
  let url = import.meta.env.VITE_SUPABASE_URL || ''
  let key = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  try {
    url = localStorage.getItem('tt_sb_url') || url
    key = localStorage.getItem('tt_sb_key') || key
  } catch {}
  return { url, key }
}

const cfg = readCfg()
export const sb = !DEMO && cfg.url && cfg.key ? createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true } }) : null
export const cloudConfigured = !!sb

export function setCloudConfig(url, key) {
  try {
    if (url) localStorage.setItem('tt_sb_url', url)
    else localStorage.removeItem('tt_sb_url')
    if (key) localStorage.setItem('tt_sb_key', key)
    else localStorage.removeItem('tt_sb_key')
  } catch {}
  location.reload()
}

const statusListeners = new Set()
export const status = {
  mode: sb ? 'cloud' : 'local',
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  authed: false,
  syncing: false,
  lastSync: null,
  error: null,
  pending: 0,
  pulledOnce: false,
}
function setStatus(p) {
  Object.assign(status, p, { pending: outboxSize() })
  statusListeners.forEach((f) => f({ ...status }))
}
export function onStatus(fn) {
  statusListeners.add(fn)
  fn({ ...status })
  return () => statusListeners.delete(fn)
}

let running = false
let again = false
export async function syncNow() {
  if (!sb || !status.authed || !navigator.onLine) {
    setStatus({})
    return
  }
  if (running) {
    again = true
    return
  }
  running = true
  setStatus({ syncing: true })
  try {
    // ---- push ----
    for (let guard = 0; guard < 50; guard++) {
      const batch = outboxRows(400)
      if (!batch.length) break
      const { error } = await sb.rpc('tt_push', { rows: batch.map((b) => b.row) })
      if (error) throw error
      markPushed(batch)
    }
    // ---- pull ----
    let cursor = getMeta('cursor') || '1970-01-01T00:00:00Z'
    for (let guard = 0; guard < 200; guard++) {
      const from = new Date(new Date(cursor).getTime() - 10000).toISOString() // חפיפה קטנה לביטחון
      const { data, error } = await sb
        .from('tt_records')
        .select('kind,id,data,updated_at,deleted,server_ts')
        .gt('server_ts', from)
        .order('server_ts', { ascending: true })
        .limit(1000)
      if (error) throw error
      if (!data.length) break
      applyRemote(data)
      const maxTs = data[data.length - 1].server_ts
      if (maxTs === cursor) break
      cursor = maxTs
      setMeta('cursor', cursor)
      if (data.length < 1000) break
    }
    if (!status.pulledOnce) {
      setMeta('pulledOnce', true)
      ensureDefaultManager()
    }
    setStatus({ syncing: false, lastSync: new Date(), error: null, pulledOnce: true })
  } catch (e) {
    console.warn('sync error', e)
    setStatus({ syncing: false, error: e.message || String(e) })
  } finally {
    running = false
    if (again) {
      again = false
      setTimeout(syncNow, 300)
    }
  }
}

let localTimer = null
let channel = null
export async function startSync() {
  setStatus({ pulledOnce: !!getMeta('pulledOnce') })
  setOnLocalChange(() => {
    setStatus({})
    clearTimeout(localTimer)
    localTimer = setTimeout(syncNow, 800)
  })
  window.addEventListener('online', () => {
    setStatus({ online: true })
    syncNow()
  })
  window.addEventListener('offline', () => setStatus({ online: false }))
  if (!sb) return
  const { data } = await sb.auth.getSession()
  setStatus({ authed: !!data.session })
  sb.auth.onAuthStateChange((_e, session) => {
    setStatus({ authed: !!session })
    if (session) syncNow()
  })
  setInterval(syncNow, 20000)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow())
  try {
    channel = sb
      .channel('tt_records')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tt_records' }, () => {
        clearTimeout(localTimer)
        localTimer = setTimeout(syncNow, 500)
      })
      .subscribe()
  } catch {}
  if (data.session) syncNow()
}

export async function cloudLogin(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw error
}
export async function cloudLogout() {
  await sb.auth.signOut()
}
