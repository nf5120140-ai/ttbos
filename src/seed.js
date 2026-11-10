// נתוני דוגמה — לניסיון בלבד
import { save, hashPin, uid, list, round2 } from './db.js'

export function seedDemo() {
  const sup1 = save('supplier', { name: 'שטראוס - סוכן', phone: '0501234567', notes: 'מגיע בימי ראשון' }, { silent: true })
  const sup2 = save('supplier', { name: 'מאפיית השכונה', phone: '0527654321', notes: 'הזמנה עד 20:00' }, { silent: true })
  const P = [
    ['קולה פחית', 'שתייה', '🥤', 6, 5, 3.2, sup1.id, '7290000000011'],
    ['מים מינרליים', 'שתייה', '💧', 4, 3, 1.5, sup1.id, '7290000000028'],
    ['שוקו', 'שתייה', '🥛', 5, 4, 2.8, sup1.id, '7290000000035'],
    ['פטל', 'שתייה', '🧃', 3, 2.5, 1.2, sup1.id, '7290000000042'],
    ['במבה', 'חטיפים', '🥜', 5, 4, 2.5, sup1.id, '7290000000059'],
    ['ביסלי', 'חטיפים', '🥨', 5, 4, 2.5, sup1.id, '7290000000066'],
    ['תפוצ׳יפס', 'חטיפים', '🥔', 6, 5, 3, sup1.id, '7290000000073'],
    ['קרמבו', 'ממתקים', '🍫', 3, 2.5, 1.4, sup1.id, '7290000000080'],
    ['שוקולד מריר', 'ממתקים', '🍫', 7, 6, 4, sup1.id, '7290000000097'],
    ['מסטיק', 'ממתקים', '🍬', 2, 1.5, 0.8, sup1.id, '7290000000103'],
    ['טוסט', 'מאפים', '🥪', 12, 10, 5, sup2.id, ''],
    ['בורקס', 'מאפים', '🥐', 8, 7, 3.5, sup2.id, ''],
    ['פיתה עם חומוס', 'מאפים', '🫓', 10, 8, 4, sup2.id, ''],
    ['רוגלך (שקית)', 'מאפים', '🥮', 9, 8, 4.5, sup2.id, ''],
    ['קפה', 'שתייה חמה', '☕', 5, 3, 1, null, ''],
    ['תה', 'שתייה חמה', '🍵', 3, 2, 0.5, null, ''],
    ['ארטיק', 'גלידות', '🍦', 6, 5, 2.8, sup1.id, ''],
  ]
  const products = P.map(([name, category, emoji, price, staffPrice, cost, supplierId, barcode]) =>
    save('product', { name, category, emoji, price, staffPrice, cost, supplierId, barcode, minStock: 10, parStock: 40, active: true }, { silent: true })
  )

  const manager = list('user')[0]
  const seller = save('user', { name: 'יוסי', pinHash: hashPin('1111'), role: 'seller', active: true, perms: { void: true, topup: true, discount: true, reports: false } }, { silent: true })
  const sellers = [manager?.id, seller.id].filter(Boolean)

  const C = [
    ['משה כהן', 'שיעור א', '1001', false],
    ['אברהם לוי', 'שיעור א', '1002', false],
    ['יעקב פרידמן', 'שיעור ב', '1003', false],
    ['שמואל גולדברג', 'שיעור ב', '1004', false],
    ['דוד רוזנברג', 'שיעור ג', '1005', false],
    ['יוסי (מוכר)', 'צוות מזנון', '2001', true],
  ]
  const customers = C.map(([name, group, card, isStaff]) => save('customer', { name, group, card, isStaff, discountPct: 0, parentPhone: '', active: true }, { silent: true }))

  // היסטוריה של 30 יום לדוחות
  const now = Date.now()
  for (let d = 30; d >= 0; d--) {
    const n = 4 + Math.floor(Math.random() * 10)
    for (let k = 0; k < n; k++) {
      const t = new Date(now - d * 864e5)
      t.setHours(10 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60))
      if (t.getTime() > now) continue
      const iso = t.toISOString()
      const cust = Math.random() < 0.7 ? customers[Math.floor(Math.random() * customers.length)] : null
      const lines = []
      const cnt = 1 + Math.floor(Math.random() * 3)
      for (let j = 0; j < cnt; j++) {
        const weighted = products[Math.floor(Math.pow(Math.random(), 1.8) * products.length)]
        const ex = lines.find((l) => l.productId === weighted.id)
        const staff = !!cust?.isStaff
        const price = staff ? weighted.staffPrice : weighted.price
        if (ex) ex.qty++
        else lines.push({ productId: weighted.id, name: weighted.name, qty: 1, price, cost: weighted.cost })
      }
      const total = round2(lines.reduce((s, l) => s + l.qty * l.price, 0))
      const id = uid()
      const sellerId = sellers[Math.floor(Math.random() * sellers.length)]
      const payment = cust ? 'wallet' : 'cash'
      save('sale', { id, items: lines, subtotal: total, discountPct: 0, discount: 0, total, payment, customerId: cust?.id || null, sellerId, staff: !!cust?.isStaff, createdAt: iso, deviceName: 'קופה ראשית' }, { silent: true })
      for (const l of lines) save('stock', { productId: l.productId, qty: -l.qty, reason: 'sale', ref: id, createdAt: iso }, { silent: true })
      if (cust) save('wallet', { customerId: cust.id, amount: -total, type: 'purchase', ref: id, createdAt: iso }, { silent: true })
    }
  }
  // טעינת ארנקים: מה שהוציאו + יתרה שנשארת
  const spent = new Map()
  for (const w of list('wallet')) spent.set(w.customerId, (spent.get(w.customerId) || 0) - w.amount)
  customers.forEach((c, idx) => {
    const amount = Math.ceil(((spent.get(c.id) || 0) + (idx === 4 ? 8 : 60 + idx * 25)) / 10) * 10
    save('wallet', { customerId: c.id, amount, type: 'topup', method: idx % 2 ? 'transfer' : 'cash', userId: sellers[0], createdAt: new Date(now - 31 * 864e5).toISOString() }, { silent: true })
  })
  // מלאי התחלתי = מה שנמכר + שארית, כדי שהמלאי ייראה אמיתי
  const sold = new Map()
  for (const s of list('sale')) for (const i of s.items) sold.set(i.productId, (sold.get(i.productId) || 0) + i.qty)
  products.forEach((p, idx) => {
    const left = idx % 6 === 0 ? 4 : 15 + Math.floor(Math.random() * 30)
    save('stock', { productId: p.id, qty: (sold.get(p.id) || 0) + left, reason: 'receive', createdAt: new Date(now - 32 * 864e5).toISOString() }, { silent: true })
  })
  // ספירת קופה מתחילת היום — כדי שהמגירה תתחיל נקי
  const sod = new Date()
  sod.setHours(0, 0, 0, 0)
  save('count', { counted: 0, expected: 0, diff: 0, leftInDrawer: 200, userId: sellers[0], denoms: {}, createdAt: sod.toISOString() }, { silent: true })
  // final save to emit
  save('supplier', { ...sup1 })
}
