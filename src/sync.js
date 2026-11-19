// ============================================================
// תתבוס — סנכרון לשרת (Supabase)
// דוחף את תור השינויים המקומי ומושך שינויים ממכשירים אחרים.
// עובד גם כשאין אינטרנט: הכל נשמר מקומית ונשלח כשהרשת חוזרת.
// ============================================================
import { createClient } from '@supabase/supabase-js'
import { DEMO, outboxRows, markPushed, applyRemote, getMeta, setMeta, outboxSize, setOnLocalChange, ensureDefaultManager, resetLocalData } from './db.js'

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
  email: '',
  member: null, // null = לא נבדק, true / false
  store: null, // {store_id, name, status, is_super, acting, features} — כמה חנויות
  recovery: false,
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
  if (!sb || !status.authed || status.member === false || !navigator.onLine) {
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
  setStatus({ authed: !!data.session, email: data.session?.user?.email || '' })
  if (data.session) checkMember()
  sb.auth.onAuthStateChange((event, session) => {
    setStatus({ authed: !!session, email: session?.user?.email || '', ...(event === 'PASSWORD_RECOVERY' ? { recovery: true } : {}) })
    if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') checkMember()
    if (event === 'SIGNED_OUT') setStatus({ member: null })
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

/** האם המשתמש המחובר שייך למזנון (המייל הראשון שנרשם, או מי שהמנהל אישר) */
const savedStore = () => {
  try {
    return JSON.parse(localStorage.getItem('tt_store_info') || 'null')
  } catch {
    return null
  }
}
export async function checkMember() {
  if (!sb) return true
  if (!navigator.onLine && localStorage.getItem('tt_member') !== '0') {
    setStatus({ member: true, store: savedStore() })
    return true
  }
  let member
  let store = null
  const st = await sb.rpc('tt_my_status')
  if (!st.error && st.data) {
    // ---- כמה חנויות ----
    store = st.data
    member = store.status === 'active'
    let prev = null
    try {
      prev = localStorage.getItem('tt_store_id')
      if (store.store_id) localStorage.setItem('tt_store_id', store.store_id)
      localStorage.setItem('tt_store_info', JSON.stringify(store))
    } catch {}
    // המכשיר עבר לחנות אחרת → מוחקים את הנתונים המקומיים של החנות הקודמת וטוענים מחדש
    if (store.store_id && prev && prev !== store.store_id) {
      await resetLocalData()
      location.reload()
      return false
    }
  } else {
    // מבנה ישן (חנות אחת)
    const { data, error } = await sb.rpc('tt_is_member')
    if (error) member = /tt_is_member|function|PGRST202/i.test(error.message || '') ? true : localStorage.getItem('tt_member') === '1'
    else member = !!data
  }
  try {
    localStorage.setItem('tt_member', member ? '1' : '0')
  } catch {}
  setStatus({ member, store })
  if (member) syncNow()
  return member
}

/** מנהל-על: כניסה לנתונים של חנות (null = יציאה). שומר קודם את מה שלא נשלח */
export async function adminEnterStore(storeId) {
  await syncNow()
  if (outboxSize() > 0) throw new Error('יש שינויים שעוד לא נשלחו לשרת — בדוק חיבור לאינטרנט ונסה שוב')
  const { error } = await sb.rpc('tt_admin_enter', { p_store: storeId })
  if (error) throw new Error(error.message)
  await resetLocalData()
  try {
    localStorage.removeItem('tt_store_id')
  } catch {}
  location.reload()
}
export async function sendPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin })
  if (error) throw new Error(heAuthError(error))
}

const heAuthError = (e) => {
  const m = String(e?.message || e)
  if (/invalid login credentials/i.test(m)) return 'מייל או סיסמה לא נכונים'
  if (/email not confirmed/i.test(m)) return 'המייל עוד לא אושר — פתח את המייל ולחץ על קישור האישור'
  if (/already registered|already exists/i.test(m)) return 'already'
  if (/signups? not allowed|signup is disabled/i.test(m)) return 'הרשמה חדשה כבויה בשרת — היכנס עם המייל הקיים'
  if (/password should be at least|weak password/i.test(m)) return 'הסיסמה קצרה מדי (לפחות 6 תווים)'
  if (/rate limit/i.test(m)) return 'יותר מדי ניסיונות — נסה שוב בעוד כמה דקות'
  if (/failed to fetch|network/i.test(m)) return 'אין חיבור לשרת — בדוק אינטרנט / נטפרי'
  return m
}

export async function cloudLogin(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw new Error(heAuthError(error))
  return checkMember()
}
/** רישום ראשון. מחזיר 'ok' | 'confirm' (צריך לאשר במייל) | 'exists' */
export async function cloudSignup(email, password, meta = {}) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: meta } })
  if (error) {
    const m = heAuthError(error)
    if (m === 'already') return 'exists'
    throw new Error(m)
  }
  // Supabase מחזיר משתמש בלי identities כשהמייל כבר קיים
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return 'exists'
  if (!data.session) return 'confirm'
  await checkMember()
  return 'ok'
}
export async function cloudResetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin })
  if (error) throw new Error(heAuthError(error))
}
export async function cloudSetPassword(password) {
  const { error } = await sb.auth.updateUser({ password })
  if (error) throw new Error(heAuthError(error))
  setStatus({ recovery: false })
}
export async function cloudLogout() {
  await syncNow().catch(() => {})
  try {
    localStorage.removeItem('tt_member')
    localStorage.removeItem('tt_store_info')
  } catch {}
  await sb.auth.signOut()
}

// ---------- פונקציות שרת (Edge Functions) ----------
export const SB_URL = cfg.url
export const SB_KEY = cfg.key
export const nedarimFnUrl = cfg.url ? cfg.url.replace(/\/$/, '') + '/functions/v1/nedarim' : ''

/** קריאה לפונקציה ציבורית (בלי התחברות) — לדף הטעינה של ההורים */
export async function callPublicFn(name, body) {
  const r = await fetch(cfg.url.replace(/\/$/, '') + '/functions/v1/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: cfg.key },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) throw new Error(j.error || 'שגיאת שרת ' + r.status)
  return j
}

/** קריאה לפונקציה עם המשתמש המחובר (קופה) */
export async function callAuthFn(name, body) {
  if (!sb) throw new Error('השרת לא מוגדר')
  const { data, error } = await sb.functions.invoke(name, { body })
  if (error) {
    let msg = error.message
    try {
      const j = await error.context?.json()
      if (j?.error) msg = j.error
    } catch {}
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

/** מחכה שכל השינויים המקומיים יגיעו לשרת */
export async function flushNow(timeoutMs = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    await syncNow()
    if (outboxSize() === 0) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return outboxSize() === 0
}
