// ============================================================
// צג לקוח קטן (VFD) — 2 שורות × 20 תווים, מחובר ב-USB/COM.
// עובד דרך Web Serial של Chrome. ההגדרות נשמרות במחשב הזה בלבד.
// ============================================================

import { makeSerialDevice, serialSupported } from './serial.js'

const dev = makeSerialDevice('tt_vfd', { enabled: false, baud: 9600, proto: 'escpos', heb: false, cols: 20 })

export const vfdCfg = dev.cfg
export const setVfdCfg = dev.setCfg
export const vfdSupported = serialSupported

/** חיבור ראשון — חייב לחיצה של המשתמש (Chrome מציג רשימת יציאות) */
export const vfdPick = () => dev.pick()

// עברית בקוד 862 (א=0x80 ... ת=0x9A)
function encode(text, heb) {
  const out = []
  for (const ch of String(text)) {
    const code = ch.charCodeAt(0)
    if (code >= 0x05d0 && code <= 0x05ea) out.push(heb ? 0x80 + (code - 0x05d0) : 0x3f)
    else if (code < 0x80) out.push(code)
    else if (code !== 0x20aa) out.push(0x3f) // ₪ לא מוצג
  }
  return out
}

// הצג כותב משמאל לימין — טקסט עברי הופכים (מספרים ואנגלית נשארים בסדר הנכון)
const vis = (s) =>
  /[א-ת]/.test(s)
    ? [...String(s)].reverse().join('').replace(/[0-9A-Za-z.,:]+/g, (m) => [...m].reverse().join(''))
    : String(s)

const fit = (s, n) => {
  s = String(s)
  return s.length > n ? s.slice(0, n) : s + ' '.repeat(n - s.length)
}
/** שורה: כיתוב + מספר. בעברית הכיתוב מימין והמספר משמאל */
const row = (label, value, n, heb) => {
  value = String(value)
  label = String(label).slice(0, Math.max(0, n - value.length - 1))
  const gap = ' '.repeat(Math.max(1, n - label.length - value.length))
  return fit(heb ? value + gap + vis(label) : label + gap + value, n)
}
const center = (s, n, heb) => {
  s = String(s).slice(0, n)
  const l = Math.floor((n - s.length) / 2)
  return fit(' '.repeat(l) + (heb ? vis(s) : s), n)
}

export function vfdWrite(l1, l2) {
  const c = vfdCfg()
  const n = Number(c.cols) || 20
  const a = encode(fit(l1, n), c.heb)
  const b = encode(fit(l2, n), c.heb)
  // CD5220: ESC Q A <שורה עליונה> CR , ESC Q B <שורה תחתונה> CR
  if (c.proto === 'cd5220') return dev.write([0x1b, 0x40, 0x0c, 0x1b, 0x51, 0x41, ...a, 0x0d, 0x1b, 0x51, 0x42, ...b, 0x0d])
  // ESC/POS: איפוס, ניקוי, שורה 1, קפיצה לתחילת שורה 2 (US $ 1 2), שורה 2
  return dev.write([0x1b, 0x40, 0x0c, ...a, 0x1f, 0x24, 0x01, 0x02, ...b])
}

const amt = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2)

/** מקבל את אותו מצב שנשלח למסך הלקוח הגדול ומציג גרסה של 2 שורות */
export function vfdShow(p) {
  const c = vfdCfg()
  if (!c.enabled) return
  const n = Number(c.cols) || 20
  const h = !!c.heb
  const T = h ? { total: 'לתשלום', thanks: 'תודה', change: 'עודף', bal: 'יתרה', hello: p.title || 'ברוכים הבאים', item: '' } : { total: 'TOTAL', thanks: 'THANK YOU', change: 'CHANGE', bal: 'BALANCE', hello: 'WELCOME', item: 'ITEM' }
  if (p.state === 'thanks') {
    const l2 = p.change > 0 ? row(T.change, amt(p.change), n, h) : p.customer ? row(T.bal, amt(p.customer.balance), n, h) : ''
    return vfdWrite(row(T.thanks, amt(p.total), n, h), l2)
  }
  if (p.state === 'cart' && p.lines?.length) {
    const last = p.lines[p.lines.length - 1]
    const label = (h ? last.name : T.item) + (last.qty > 1 ? ' x' + last.qty : '')
    return vfdWrite(row(label, amt(last.sum), n, h), row(T.total, amt(p.total), n, h))
  }
  return vfdWrite(center(T.hello, n, h), '')
}

/** בדיקה מכפתור בהגדרות */
export function vfdTest() {
  const h = vfdCfg().heb
  const n = Number(vfdCfg().cols) || 20
  return vfdWrite(h ? row('בדיקה', '12.50', n, true) : row('TEST', '12.50', n), center('1234567890', n))
}
