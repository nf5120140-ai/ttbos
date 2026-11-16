// ============================================================
// מסך לקוח — הקופה משדרת את מצב הסל, מסך הלקוח מציג.
// שני ערוצים במקביל:
//  1. BroadcastChannel — כשהמסך נפתח באותו דפדפן (חלון נוסף)
//  2. Supabase Realtime — כשהמסך רץ בדפדפן נפרד (במחשב הקופה עם שני מסכים)
// הזיהוי בין קופה למסך שלה: קוד עמדה (reg) — שם המחשב, מגיע מקובץ ההפעלה.
// ============================================================
import { sb } from './sync.js'
import { vfdShow } from './vfd.js'

const params = (() => {
  try {
    return new URLSearchParams(location.search)
  } catch {
    return new URLSearchParams()
  }
})()

export const IS_DISPLAY = params.has('display')

export function regId() {
  let r = params.get('reg')
  try {
    if (r) localStorage.setItem('tt_reg', r)
    else r = localStorage.getItem('tt_reg')
    if (!r) {
      r = 'R' + Math.random().toString(36).slice(2, 8)
      localStorage.setItem('tt_reg', r)
    }
  } catch {
    r = r || 'R0'
  }
  return String(r).replace(/[^\w-]/g, '').slice(0, 40) || 'R0'
}

const chName = (reg) => 'tt-display-' + reg

let bc = null
let rt = null
let rtReady = false
let lastPayload = null

function ensure(reg) {
  if (!bc && typeof BroadcastChannel !== 'undefined') bc = new BroadcastChannel(chName(reg))
  if (!rt && sb) {
    rt = sb.channel(chName(reg), { config: { broadcast: { self: false } } })
    rt.on('broadcast', { event: 'hello' }, () => lastPayload && send(lastPayload))
    rt.subscribe((s) => {
      rtReady = s === 'SUBSCRIBED'
      if (rtReady && lastPayload) send(lastPayload)
    })
  }
}

function send(payload) {
  try {
    bc?.postMessage(payload)
  } catch {}
  if (rt && rtReady) rt.send({ type: 'broadcast', event: 'state', payload }).catch(() => {})
}

/** נקרא מהקופה בכל שינוי בסל / אחרי תשלום */
export function publishDisplay(payload) {
  const reg = regId()
  ensure(reg)
  lastPayload = { ...payload, at: Date.now() }
  send(lastPayload)
  try {
    vfdShow(lastPayload)
  } catch {}
}

/** נקרא ממסך הלקוח */
export function subscribeDisplay(cb) {
  const reg = regId()
  let b = null
  let ch = null
  if (typeof BroadcastChannel !== 'undefined') {
    b = new BroadcastChannel(chName(reg))
    b.onmessage = (e) => cb(e.data)
    // מבקשים מהקופה את המצב הנוכחי
    b.postMessage({ hello: true })
  }
  if (sb) {
    ch = sb.channel(chName(reg), { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: 'state' }, (m) => cb(m.payload))
    ch.subscribe((s) => {
      if (s === 'SUBSCRIBED') ch.send({ type: 'broadcast', event: 'hello', payload: {} }).catch(() => {})
    })
  }
  return () => {
    b?.close()
    if (ch) sb.removeChannel(ch)
  }
}

// הקופה עונה ל"שלום" של מסך שנפתח באותו דפדפן
export function listenHello() {
  const reg = regId()
  ensure(reg)
  if (bc)
    bc.onmessage = (e) => {
      if (e.data?.hello && lastPayload) send(lastPayload)
    }
}
