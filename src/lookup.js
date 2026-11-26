// ============================================================
// חיפוש שם מוצר לפי ברקוד ברשת (Open Food Facts — חינמי, בלי מפתח).
// • מטמון במכשיר לפי ברקוד — לא מחפשים פעמיים
// • "לא נמצא" נשמר ל-14 יום; תקלה ברשת / עומס (429/503) → מנסים שוב מאוחר יותר
// • שם מהרשת לא דורס שם שהמשתמש הזין או אישר (nameStatus: 'ok')
// nameStatus של מוצר: 'ok' = אושר / הוזן ידנית · 'web' = מהרשת, לא אושר · 'temp' = שם זמני (חסר שם)
// ============================================================
import { list, get, save } from './db.js'

const KEY = 'tt_bc_cache'
const NOT_FOUND_TTL = 14 * 864e5
const RETRY_AFTER = 10 * 60e3

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}
function writeCache(c) {
  try {
    // שומרים עד 3000 ברקודים אחרונים
    const keys = Object.keys(c)
    if (keys.length > 3000) for (const k of keys.sort((a, b) => (c[a].at || 0) - (c[b].at || 0)).slice(0, keys.length - 3000)) delete c[k]
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {}
}

export const tempName = (code) => `מוצר חדש ${code}`

function format(p) {
  const name = String(p.product_name_he || p.product_name || p.generic_name || '').trim()
  if (!name) return ''
  const brand = String(p.brands || '').split(',')[0].trim()
  const qty = String(p.quantity || '').trim()
  return [brand && !name.includes(brand) ? brand : '', name, qty && !name.includes(qty) ? qty : ''].filter(Boolean).join(' ').slice(0, 80)
}

const inflight = new Map()

/**
 * מחזיר {status: 'found'|'notfound'|'error', name, image}
 * לא זורק שגיאות.
 */
export async function lookupBarcode(code) {
  code = String(code || '').trim()
  if (!/^\d{6,14}$/.test(code)) return { status: 'notfound' }
  const c = readCache()[code]
  if (c?.status === 'found') return c
  if (c?.status === 'notfound' && Date.now() - c.at < NOT_FOUND_TTL) return c
  if (c?.status === 'error' && Date.now() - c.at < RETRY_AFTER) return c
  if (inflight.has(code)) return inflight.get(code)
  const job = (async () => {
    let res
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), 7000)
      const r = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${code}?fields=product_name,product_name_he,generic_name,brands,quantity,image_front_small_url,image_small_url`,
        { signal: ctl.signal }
      )
      clearTimeout(t)
      if (r.status === 404) res = { status: 'notfound' }
      else if (!r.ok) res = { status: 'error', http: r.status }
      else {
        const j = await r.json()
        const name = j?.status === 1 && j.product ? format(j.product) : ''
        res = name ? { status: 'found', name, image: j.product.image_front_small_url || j.product.image_small_url || '' } : { status: 'notfound' }
      }
    } catch {
      res = { status: 'error' }
    }
    res.at = Date.now()
    const all = readCache()
    all[code] = res
    writeCache(all)
    return res
  })()
  inflight.set(code, job)
  try {
    return await job
  } finally {
    inflight.delete(code)
  }
}

/** אחרי שמירה: אם המוצר עדיין עם שם זמני — מעדכנים לשם מהרשת (בלי לדרוס שם של המשתמש) */
export async function applyWebName(productId, code) {
  const r = await lookupBarcode(code)
  const p = get('product', productId)
  if (!p || p.nameStatus !== 'temp') return r
  if (r.status === 'found') save('product', { ...p, name: r.name, nameStatus: 'web', ...(r.image && !p.img ? { img: r.image, imgStatus: 'web' } : {}) })
  return r
}

/** ניסיון חוזר ברקע לכל המוצרים עם שם זמני (נקרא כשנכנסים למלאי / לקליטה) */
let lastRetry = 0
export async function retryTempNames() {
  if (Date.now() - lastRetry < 60e3 || !navigator.onLine) return
  lastRetry = Date.now()
  const temp = list('product').filter((p) => p.nameStatus === 'temp' && p.barcode)
  for (const p of temp.slice(0, 20)) {
    const r = await applyWebName(p.id, p.barcode)
    if (r.status === 'error' && r.http === 429) break // עומס — עוצרים לעכשיו
  }
}

export function approveName(p) {
  save('product', { ...p, nameStatus: 'ok', ...(p.imgStatus === 'web' ? { imgStatus: 'ok' } : {}) })
}
