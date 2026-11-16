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
