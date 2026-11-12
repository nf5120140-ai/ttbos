// ============================================================
// תתבוס — חיבור לקורא טביעות אצבע (דרך "גשר" מקומי במחשב הקופה)
//
// הדפדפן לא יכול לדבר ישירות עם קורא USB, לכן תוכנה קטנה רצה ברקע
// במחשב (Windows) ומאזינה ב-http://127.0.0.1:17575 . אם הגשר לא רץ —
// כל אפשרויות האצבע פשוט לא מוצגות, והכל עובד עם קודים כרגיל.
//
// פרוטוקול הגשר (JSON):
//   GET  /status                       → { ready: true, device: "ZK9500" }
//   POST /load     { users:[{id, templates:[base64]}] }  → { ok: true, count }
//   POST /identify { timeoutMs }       → { userId, score }  |  { error }
//   POST /enroll   { presses: 3 }      → { template: base64 } |  { error }
//   הגשר חייב לענות ל-OPTIONS עם CORS + Access-Control-Allow-Private-Network: true
// ============================================================
import { useEffect, useState } from 'react'
import { list, subscribe } from './db.js'

const BASE = 'http://127.0.0.1:17575'
let state = { ready: false, device: '', checked: false }
const listeners = new Set()
let loadedSig = ''

function set(p) {
  state = { ...state, ...p }
  listeners.forEach((f) => f(state))
}

async function call(path, body, timeoutMs = 2000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      targetAddressSpace: 'local',
    })
    const j = await r.json()
    if (j.error) throw new Error(j.error)
    return j
  } finally {
    clearTimeout(t)
  }
}

async function loadTemplates(force = false) {
  const users = list('user')
    .filter((u) => u.active !== false && Array.isArray(u.fpTemplates) && u.fpTemplates.length)
    .map((u) => ({ id: u.id, templates: u.fpTemplates }))
  const sig = JSON.stringify(users.map((u) => [u.id, u.templates.length, u.templates[0]?.slice(0, 16)]))
  if (!force && sig === loadedSig) return
  await call('/load', { users }, 5000)
  loadedSig = sig
}

export async function fpCheck() {
  try {
    const s = await call('/status', null, 800)
    set({ ready: !!s.ready, device: s.device || '', checked: true })
    if (s.ready) await loadTemplates(true)
  } catch {
    set({ ready: false, checked: true })
  }
  return state.ready
}

let started = false
function start() {
  if (started || typeof window === 'undefined' || location.protocol === 'file:') return
  started = true
  fpCheck()
  setInterval(() => !state.ready && fpCheck(), 30000)
  // כשמוכרים / טביעות משתנים — טוענים מחדש לגשר
  subscribe(() => state.ready && loadTemplates().catch(() => {}))
}

export function useFingerprint() {
  const [s, setS] = useState(state)
  useEffect(() => {
    start()
    listeners.add(setS)
    setS(state)
    return () => listeners.delete(setS)
  }, [])
  return s
}

/** מחכה לאצבע ומחזיר {userId} של המזוהה */
export async function fpIdentify(timeoutMs = 15000) {
  await loadTemplates()
  const r = await call('/identify', { timeoutMs }, timeoutMs + 3000)
  if (!r.userId) throw new Error('האצבע לא מזוהה — נסה שוב')
  return r
}

/** רישום אצבע (3 הנחות) — מחזיר תבנית base64 לשמירה אצל המשתמש */
export async function fpEnroll() {
  const r = await call('/enroll', { presses: 3 }, 60000)
  if (!r.template) throw new Error('הרישום נכשל — נסה שוב')
  return r.template
}
