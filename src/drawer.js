// ============================================================
// מגירת כסף — נפתחת אחרי תשלום במזומן.
// המגירה מחוברת בדרך כלל למדפסת הקבלות (כבל טלפון) או ישירות למחשב,
// ונפתחת בפקודת ESC/POS שנשלחת ליציאת ה-COM.
// ============================================================
import { makeSerialDevice, serialSupported } from './serial.js'

const dev = makeSerialDevice('tt_drawer', { enabled: false, baud: 9600, pin: 0 })

export const drawerCfg = dev.cfg
export const setDrawerCfg = dev.setCfg
export const drawerSupported = serialSupported
export const drawerPick = () => dev.pick()

/** ESC p m t1 t2 — פולס לפין 2 (m=0) או פין 5 (m=1) */
export function openDrawer() {
  const c = dev.cfg()
  if (!c.enabled) return Promise.resolve(false)
  return dev.write([0x1b, 0x70, Number(c.pin) ? 1 : 0, 0x19, 0xfa])
}
