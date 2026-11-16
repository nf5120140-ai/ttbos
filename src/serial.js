// ============================================================
// חיבור להתקנים בכבל (COM / USB-Serial) דרך Chrome — צג לקוח, מגירת כסף.
// כל התקן זוכר איזו יציאה נבחרה לו (לפי זיהוי USB), ההגדרות נשמרות במחשב הזה בלבד.
// ============================================================

export const serialSupported = typeof navigator !== 'undefined' && 'serial' in navigator

const sameInfo = (a = {}, b = {}) => a.usbVendorId === b.usbVendorId && a.usbProductId === b.usbProductId

export function makeSerialDevice(key, defaults) {
  let port = null
  let writer = null
  let opening = null
  let queue = Promise.resolve()

  const cfg = () => {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }
    } catch {
      return { ...defaults }
    }
  }
  const save = (c) => {
    try {
      localStorage.setItem(key, JSON.stringify({ ...cfg(), ...c }))
    } catch {}
  }

  async function close() {
    try {
      writer?.releaseLock()
    } catch {}
    try {
      await port?.close()
    } catch {}
    port = null
    writer = null
    opening = null
  }

  async function open(p) {
    await p.open({ baudRate: Number(cfg().baud) || 9600 })
    port = p
    writer = p.writable.getWriter()
  }

  async function ensure() {
    if (writer) return true
    if (!serialSupported || !cfg().enabled) return false
    if (!opening)
      opening = (async () => {
        const c = cfg()
        const ports = await navigator.serial.getPorts()
        const same = ports.filter((p) => sameInfo(p.getInfo?.() || {}, c.info || {}))
        const p = same[c.index || 0] || same[0] || (ports.length === 1 ? ports[0] : null)
        if (!p) return false
        try {
          await open(p)
          return true
        } catch {
          return false
        }
      })()
    const ok = await opening
    if (!ok) opening = null
    return ok
  }

  return {
    cfg,
    setCfg(c) {
      save(c)
      close()
    },
    /** בחירת יציאה — חייב לחיצה של המשתמש */
    async pick() {
      if (!serialSupported) throw new Error('הדפדפן לא תומך — צריך Google Chrome')
      await close()
      const p = await navigator.serial.requestPort()
      const info = p.getInfo?.() || {}
      const all = await navigator.serial.getPorts()
      const index = Math.max(0, all.filter((x) => sameInfo(x.getInfo?.() || {}, info)).indexOf(p))
      save({ enabled: true, info: { usbVendorId: info.usbVendorId, usbProductId: info.usbProductId }, index })
      await open(p)
      return true
    },
    write(bytes) {
      queue = queue.then(async () => {
        if (!(await ensure())) return false
        try {
          await writer.write(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
          return true
        } catch {
          await close()
          return false
        }
      })
      return queue
    },
  }
}
