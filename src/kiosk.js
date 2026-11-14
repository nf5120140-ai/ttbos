// ============================================================
// תתבוס — מעקב "קופה נעולה" והתראות למנהל
//
// מחשב קופה (נפתח עם ?kiosk=1 מקובץ ההפעלה) מדווח כל דקה שהוא חי,
// ורושם אירוע כשסוגרים אותו. אצל מנהל — באנר + התראת דפדפן כש:
//   • הקופה נסגרה (גם אם נפתחה שוב)
//   • הקופה לא דיווחה כמה דקות (כיבו / יצאו מ-Windows / סגרו את התוכנה)
// ============================================================
import { useEffect, useState } from 'react'
import { list, save, get, deviceId, deviceName, uid, nowIso, getSetting, subscribe } from './db.js'
import { sb, SB_URL, SB_KEY } from './sync.js'

const HEARTBEAT_MS = 60 * 1000
export const STALE_MIN = 3

export const isKioskDevice = (() => {
  try {
    if (new URLSearchParams(location.search).has('kiosk')) localStorage.setItem('tt_kiosk', '1')
    return localStorage.getItem('tt_kiosk') === '1'
  } catch {
    return false
  }
})()
export function setKioskDevice(on) {
  try {
    on ? localStorage.setItem('tt_kiosk', '1') : localStorage.removeItem('tt_kiosk')
  } catch {}
  location.reload()
}

let accessToken = ''
let currentSeller = ''
export function setKioskSeller(name) {
  currentSeller = name || ''
}

function beat() {
  const cur = get('device', deviceId()) || {}
  save('device', { ...cur, id: deviceId(), name: deviceName(), kiosk: true, lastSeen: nowIso(), seller: currentSeller }, { silent: true })
}
function logEvent(type) {
  save('kevent', { id: uid(), deviceId: deviceId(), deviceName: deviceName(), type, seller: currentSeller }, { silent: true })
}

/** שליחה מיידית בסגירת הדף (הדף נעלם — אין זמן לסנכרון הרגיל) */
function sendNow(rows) {
  if (!SB_URL || !accessToken) return
  try {
    fetch(SB_URL.replace(/\/$/, '') + '/rest/v1/rpc/tt_push', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: 'Bearer ' + accessToken },
      body: JSON.stringify({ rows }),
    })
  } catch {}
}

/** יציאה מורשית ע"י מנהל: רושם, מוריד קובץ-סימון לקובץ ההפעלה, וסוגר את החלון */
export async function managerExit(manager) {
  const now = nowIso()
  const cur = get('device', deviceId()) || {}
  save('device', { ...cur, id: deviceId(), name: deviceName(), kiosk: true, lastSeen: now, managerExit: { at: now, by: manager.name } }, { silent: true })
  save('kevent', { id: uid(), deviceId: deviceId(), deviceName: deviceName(), type: 'exit_manager', seller: manager.name })
  try {
    const { flushNow } = await import('./sync.js')
    await flushNow(4000)
  } catch {}
  exiting = true
  // קובץ סימון בתיקיית ההורדות — קובץ ההפעלה רואה אותו ולא פותח את הקופה מחדש
  try {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['exit ' + now], { type: 'text/plain' }))
    a.download = 'tatbus-exit.flag'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch {}
  setTimeout(() => {
    try {
      window.close()
    } catch {}
  }, 1500)
}
let exiting = false

let started = false
export function startKioskMode() {
  if (!isKioskDevice || started) return
  started = true
  if (sb) {
    sb.auth.getSession().then(({ data }) => (accessToken = data.session?.access_token || ''))
    sb.auth.onAuthStateChange((_e, s) => (accessToken = s?.access_token || ''))
  }
  logEvent('start')
  beat()
  setInterval(beat, HEARTBEAT_MS)
  const onClose = () => {
    if (exiting) return
    const now = nowIso()
    const ev = { id: uid(), kind: 'kevent', deviceId: deviceId(), deviceName: deviceName(), type: 'closed', seller: currentSeller, createdAt: now, updatedAt: now, device: deviceId() }
    save('kevent', ev, { silent: true })
    const cur = get('device', deviceId()) || {}
    const dev = { ...cur, id: deviceId(), kind: 'device', name: deviceName(), kiosk: true, lastSeen: now, closedAt: now, updatedAt: now, device: deviceId() }
    sendNow([
      { kind: 'kevent', id: ev.id, data: ev, updated_at: now, deleted: false, device: deviceId() },
      { kind: 'device', id: dev.id, data: dev, updated_at: now, deleted: false, device: deviceId() },
    ])
  }
  window.addEventListener('pagehide', onClose)
}

// ---------------- צד המנהל ----------------
function inAlertHours() {
  const s = getSetting('kiosk')
  if (s.alerts === false) return false
  const from = s.from || '07:00'
  const to = s.to || '23:30'
  const d = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return from <= to ? hm >= from && hm <= to : hm >= from || hm <= to
}

/** מצב כל הקופות הנעולות + אירועים שלא נקראו */
export function kioskStatus() {
  const s = getSetting('kiosk')
  const now = Date.now()
  const devices = list('device')
    .filter((d) => d.kiosk && !d.retired)
    .map((d) => {
      const ageMin = (now - new Date(d.lastSeen || 0).getTime()) / 60000
      // "ראיתי" משתיק רק את ההפסקה הנוכחית — אם הקופה תחזור ותיפול שוב, תהיה התראה חדשה
      const muted = !!d.lastSeen && s.mute?.[d.id] === d.lastSeen
      return { ...d, ageMin, down: ageMin > STALE_MIN, muted }
    })
  const seenAt = s.seenAt || '0000'
  const events = list('kevent')
    .filter((e) => e.type === 'closed' && e.createdAt > seenAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const alerts = []
  if (inAlertHours()) {
    for (const d of devices) if (d.down && !d.muted && !exitedByManager(d)) alerts.push({ key: 'down:' + d.id + ':' + d.lastSeen, level: 'high', text: `🔴 "${d.name}" לא פעילה מאז ${new Date(d.lastSeen).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`, deviceId: d.id })
    for (const e of events.slice(0, 5)) {
      const d = devices.find((x) => x.id === e.deviceId)
      if (d?.muted) continue
      if (d?.managerExit && Math.abs(new Date(d.managerExit.at) - new Date(e.createdAt)) < 120000) continue
      alerts.push({ key: 'ev:' + e.id, level: 'mid', text: `⚠ "${e.deviceName}" נסגרה ב-${new Date(e.createdAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}${e.seller ? ` (מוכר מחובר: ${e.seller})` : ''}${d && !d.down && d.lastSeen > e.createdAt ? ' — ונפתחה שוב' : ''}`, deviceId: e.deviceId })
    }
  }
  return { devices, events, alerts }
}

// הקופה כבויה כי מנהל יצא ממנה (ולא חזרה לפעול מאז)
function exitedByManager(d) {
  return !!d.managerExit && new Date(d.managerExit.at).getTime() >= new Date(d.lastSeen || 0).getTime() - 120000
}

const notified = new Set()
function notify(alerts) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  for (const a of alerts) {
    if (notified.has(a.key)) continue
    notified.add(a.key)
    try {
      new Notification('תתבוס — התראת קופה', { body: a.text.replace(/^[^ ]+ /, ''), tag: a.key, requireInteraction: a.level === 'high' })
    } catch {}
  }
}

/** הוק למנהל: מחזיר התראות פעילות ומקפיץ התראת דפדפן */
export function useKioskAlerts(enabled) {
  const [st, setSt] = useState({ alerts: [], devices: [], events: [] })
  useEffect(() => {
    if (!enabled || isKioskDevice) return
    const run = () => {
      const s = kioskStatus()
      setSt(s)
      notify(s.alerts)
    }
    run()
    const t = setInterval(run, 30000)
    const un = subscribe(run)
    return () => {
      clearInterval(t)
      un()
    }
  }, [enabled])
  return st
}

export async function askNotifyPermission() {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  return Notification.requestPermission()
}
