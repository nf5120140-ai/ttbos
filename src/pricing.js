// ============================================================
// תתבוס — מנוע מחירים: מבצעים + הנחת עובד
//
// מבצע (kind 'promo'):
//   { name, productIds:[...], type:'pct'|'price'|'bundle', pct, price, qty, bundlePrice,
//     start:'YYYY-MM-DD'|'', end:'YYYY-MM-DD'|'', active }
//   pct    — אחוז הנחה על המוצרים
//   price  — מחיר מבצע ליחידה
//   bundle — X יחידות (אפשר מעורב מכל מוצרי המבצע) ב-Y ₪
//
// עובד שמאומת מקבל: מחיר מוכרים קבוע של המוצר (אם הוגדר) או אחוז ההנחה שלו.
// עובד לא מקבל גם הנחת עובד וגם מבצע — מקבל את הזול מביניהם.
// ============================================================
import { list, round2 } from './db.js'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function promoIsLive(p, day = today()) {
  if (!p || p.deleted || p.active === false) return false
  if (p.start && day < p.start) return false
  if (p.end && day > p.end) return false
  return true
}

export function livePromos() {
  const day = today()
  return list('promo').filter((p) => promoIsLive(p, day))
}

/** מבצע ליחידה (אחוז / מחיר) הכי טוב למוצר */
export function unitPromoFor(product, promos = livePromos()) {
  let best = null
  for (const pr of promos) {
    if (pr.type === 'bundle' || !(pr.productIds || []).includes(product.id)) continue
    const base = Number(product.price) || 0
    const unit = pr.type === 'pct' ? round2(base * (1 - (Number(pr.pct) || 0) / 100)) : Number(pr.price)
    if (!(unit >= 0) || unit >= base) continue
    if (!best || unit < best.unit) best = { promo: pr, unit }
  }
  return best
}

/** מבצעי כמות שהמוצר משתתף בהם (לתצוגה) */
export function bundlesFor(product, promos = livePromos()) {
  return promos.filter((pr) => pr.type === 'bundle' && (pr.productIds || []).includes(product.id))
}

export function staffUnit(product, staffPct) {
  if (product.staffPrice !== '' && product.staffPrice != null) return Number(product.staffPrice)
  return round2((Number(product.price) || 0) * (1 - (Number(staffPct) || 0) / 100))
}

/**
 * מחשב סל.
 * lines: [{ p: product, qty }]
 * opts: { staff: bool, staffPct: number, customerPct: number }
 * מחזיר { lines:[{...line, unit, regular, promoId, promoName, staffApplied}], promoDiscounts:[{promoId,name,amount}],
 *          subtotal, customerDiscount, total, regularTotal }
 */
export function priceCart(lines, opts = {}) {
  // עובד: מחשבים גם עם הנחת עובד וגם כמו לקוח רגיל (עם כל המבצעים) — ונותנים את הזול
  if (opts.staff) {
    const a = priceCartInner(lines, opts)
    const b = priceCartInner(lines, { ...opts, staff: false, customerPct: 0 })
    return b.total < a.total ? { ...b, staffFallback: true } : a
  }
  return priceCartInner(lines, opts)
}

function priceCartInner(lines, { staff = false, staffPct = 0, customerPct = 0 } = {}) {
  const promos = livePromos()
  const out = lines.map((l) => {
    const regular = Number(l.p.price) || 0
    const up = unitPromoFor(l.p, promos)
    let unit = regular
    let promoId = null
    let promoName = ''
    let staffApplied = false
    if (up) {
      unit = up.unit
      promoId = up.promo.id
      promoName = up.promo.name
    }
    if (staff) {
      const su = staffUnit(l.p, staffPct)
      if (su < unit) {
        unit = su
        promoId = null
        promoName = ''
        staffApplied = true
      }
    }
    return { ...l, regular, unit, promoId, promoName, staffApplied }
  })

  // מבצעי כמות — על יחידות שלא קיבלו כבר הנחה אחרת
  const promoDiscounts = []
  for (const pr of promos) {
    if (pr.type !== 'bundle') continue
    const q = Math.floor(Number(pr.qty) || 0)
    const bp = Number(pr.bundlePrice)
    if (q < 2 || !(bp >= 0)) continue
    const units = []
    for (const l of out) {
      if (!(pr.productIds || []).includes(l.p.id)) continue
      if (l.promoId || l.staffApplied) continue
      for (let i = 0; i < l.qty; i++) units.push(l.unit)
    }
    const groups = Math.floor(units.length / q)
    if (!groups) continue
    units.sort((a, b) => b - a) // היקרים קודם — הכי משתלם לקונה
    const inGroups = units.slice(0, groups * q).reduce((a, b) => a + b, 0)
    const amount = round2(inGroups - groups * bp)
    if (amount > 0) promoDiscounts.push({ promoId: pr.id, name: pr.name || `${q} ב-${bp}₪`, amount, groups })
  }

  const subtotal = round2(out.reduce((s, l) => s + l.qty * l.unit, 0))
  const promoTotal = round2(promoDiscounts.reduce((s, d) => s + d.amount, 0))
  const afterPromo = round2(subtotal - promoTotal)
  // הנחה קבועה של בחור (מההגדרות) — לא לעובד שכבר קיבל הנחת עובד
  const cp = staff ? 0 : Number(customerPct) || 0
  const customerDiscount = round2((afterPromo * cp) / 100)
  const total = round2(afterPromo - customerDiscount)
  const regularTotal = round2(out.reduce((s, l) => s + l.qty * l.regular, 0))
  return { lines: out, promoDiscounts, promoTotal, subtotal, customerPct: cp, customerDiscount, total, regularTotal }
}

export const promoLabel = (pr) =>
  pr.type === 'pct' ? `${pr.pct}% הנחה` : pr.type === 'price' ? `מחיר מבצע ₪${pr.price}` : `${pr.qty} ב-₪${pr.bundlePrice}`
