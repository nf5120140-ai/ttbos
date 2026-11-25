// ============================================================
// מגירת כסף — נפתחת אחרי תשלום במזומן.
// המגירה מחוברת בדרך כלל למדפסת הקבלות (כבל טלפון) או ישירות למחשב,
// ונפתחת בפקודת ESC/POS שנשלחת ליציאת ה-COM.
// ============================================================
import { makeSerialDevice, serialSupported } from './serial.js'
import { save, uid, deviceId, deviceName } from './db.js'

const dev = makeSerialDevice('tt_drawer', { enabled: false, baud: 9600, pin: 0, method: 'escpos' })

export const drawerCfg = dev.cfg
export const setDrawerCfg = dev.setCfg
export const drawerSupported = serialSupported
export const drawerPick = () => dev.pick()

/**
 * שיטות פתיחה (כל מחשב קופה עובד אחרת):
 *  escpos — ESC p m t1 t2 (מגירה דרך מדפסת, או יציאת CD שמדמה מדפסת)
 *  byte   — שליחת תו כלשהו ליציאה (ביציאות CD רבות כל תו פותח)
 *  dtr / rts — פולס חשמלי על קו DTR / RTS של יציאת ה-COM
 */
export function openDrawer() {
  const c = dev.cfg()
  if (!c.enabled) return Promise.resolve(false)
  if (c.method === 'byte') return dev.write([0x07, 0x00])
  if (c.method === 'dtr') return dev.pulse('dataTerminalReady')
  if (c.method === 'rts') return dev.pulse('requestToSend')
  return dev.write([0x1b, 0x70, Number(c.pin) ? 1 : 0, 0x19, 0xfa])
}

/** פתיחה ידנית מהקופה (בלי מכירה) — נרשמת לדוחות */
export async function openDrawerManual(user, reason = '') {
  save('kevent', { id: uid(), deviceId: deviceId(), deviceName: deviceName(), type: 'drawer', seller: user?.name || '', userId: user?.id || null, reason })
  return openDrawer()
}

// ---- חיפוש אוטומטי ----
// הדפדפן לא יכול לדעת לבד אם המגירה נפתחה, לכן מנסים כל שילוב של יציאה+שיטה
// ושואלים את המשתמש "נפתחה?". השילוב שעבד נשמר.
const TRIES = [
  { method: 'escpos', pin: 0, label: 'פקודת מדפסת, פין 2' },
  { method: 'escpos', pin: 1, label: 'פקודת מדפסת, פין 5' },
  { method: 'byte', pin: 0, label: 'שליחת תו' },
  { method: 'dtr', pin: 0, label: 'פולס DTR' },
  { method: 'rts', pin: 0, label: 'פולס RTS' },
]
const sameInfo = (a = {}, b = {}) => a.usbVendorId === b.usbVendorId && a.usbProductId === b.usbProductId
const portName = (p, i) => {
  const inf = p.getInfo?.() || {}
  return inf.usbVendorId ? `יציאה ${i + 1} (USB ${inf.usbVendorId.toString(16)}:${(inf.usbProductId || 0).toString(16)})` : `יציאה ${i + 1} (COM)`
}

async function tryOnce(p, t, baud) {
  await p.open({ baudRate: baud })
  try {
    if (t.method === 'dtr' || t.method === 'rts') {
      const sig = t.method === 'dtr' ? 'dataTerminalReady' : 'requestToSend'
      await p.setSignals({ [sig]: true })
      await new Promise((r) => setTimeout(r, 200))
      await p.setSignals({ [sig]: false })
    } else {
      const w = p.writable.getWriter()
      await w.write(new Uint8Array(t.method === 'byte' ? [0x07, 0x00] : [0x1b, 0x70, t.pin, 0x19, 0xfa]))
      w.releaseLock()
    }
    await new Promise((r) => setTimeout(r, 300))
  } finally {
    await p.close().catch(() => {})
  }
}

/**
 * ask(text) => Promise<boolean>  — שואל את המשתמש אם המגירה נפתחה
 * מחזיר את השילוב שעבד, או null
 */
export async function scanDrawer(ask, onProgress) {
  if (!serialSupported) throw new Error('הדפדפן לא תומך — צריך Google Chrome')
  setDrawerCfg({ enabled: false }) // משחרר את היציאה אם הייתה פתוחה
  let ports = await navigator.serial.getPorts()
  if (!ports.length) {
    // בלי הרשאה מראש Chrome מציג רשימה — בוחרים יציאה אחת בכל פעם
    await navigator.serial.requestPort()
    ports = await navigator.serial.getPorts()
  }
  const total = ports.length * TRIES.length
  let n = 0
  for (let i = 0; i < ports.length; i++) {
    const p = ports[i]
    for (const t of TRIES) {
      n++
      onProgress?.(`${n}/${total}`)
      try {
        await tryOnce(p, t, Number(dev.cfg().baud) || 9600)
      } catch {
        n += TRIES.length - TRIES.indexOf(t) - 1 // יציאה תפוסה/לא זמינה — מדלגים עליה
        break
      }
      const yes = await ask(`ניסיון ${n} מתוך ${total}: ${portName(p, i)} · ${t.label}\n\nהמגירה נפתחה?`)
      if (yes) {
        const info = p.getInfo?.() || {}
        const index = Math.max(0, ports.filter((x) => sameInfo(x.getInfo?.() || {}, info)).indexOf(p))
        setDrawerCfg({ enabled: true, method: t.method, pin: t.pin, info: { usbVendorId: info.usbVendorId, usbProductId: info.usbProductId }, index })
        return { port: portName(p, i), ...t }
      }
    }
  }
  return null
}
