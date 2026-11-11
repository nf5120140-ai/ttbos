// ============================================================
// תתבוס — מסד נתונים מקומי (IndexedDB) + זיכרון + פעולות
// כל רשומה נשמרת מקומית קודם, ונכנסת לתור סנכרון (outbox).
// יתרות ומלאי מחושבים מתנועות (ledger) — כך שכמה מכשירים
// שעובדים בלי אינטרנט במקביל לא דורסים זה את זה.
// ============================================================

export const KINDS = ['product', 'customer', 'user', 'supplier', 'sale', 'wallet', 'stock', 'count', 'order', 'payment', 'setting', 'invoice']

// מצב הדגמה: ttbos.vercel.app/?demo — נתוני דוגמה, בלי שרת, במסד נפרד שלא נוגע בנתונים האמיתיים
export const DEMO = (() => {
  try {
    return new URLSearchParams(location.search).has('demo')
  } catch {
    return false
  }
})()
const DB_NAME = DEMO ? 'tatbus-demo' : 'tatbus'
let idb = null
const memFallback = { records: new Map(), outbox: new Map(), meta: new Map() }

const data = {}
KINDS.forEach((k) => (data[k] = new Map()))
const outbox = new Set()
const meta = new Map()

export const derived = { balance: new Map(), stock: new Map() }

const listeners = new Set()
let version = 0
let onChangeHook = null

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function setOnLocalChange(fn) {
  onChangeHook = fn
}

// ---------- utils ----------
export function uid() {
  try {
    return crypto.randomUUID()
  } catch {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  }
}
export const nowIso = () => new Date().toISOString()
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

export function hashPin(pin) {
  let h = 2166136261
  const s = 'tatbus:' + String(pin)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

export function deviceId() {
  let d = null
  try {
    d = localStorage.getItem('tt_device')
  } catch {}
  if (!d) {
    d = uid()
    try {
      localStorage.setItem('tt_device', d)
    } catch {}
  }
  return d
}
export function deviceName() {
  try {
    return localStorage.getItem('tt_device_name') || 'קופה ראשית'
  } catch {
    return 'קופה ראשית'
  }
}
export function setDeviceName(n) {
  try {
    localStorage.setItem('tt_device_name', n)
  } catch {}
  emit()
}

// ---------- IndexedDB ----------
function openIdb() {
  return new Promise((res) => {
    try {
      const r = indexedDB.open(DB_NAME, 1)
      r.onupgradeneeded = () => {
        const d = r.result
        ;['records', 'outbox', 'meta'].forEach((s) => {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s)
        })
      }
      r.onsuccess = () => res(r.result)
      r.onerror = () => res(null)
      r.onblocked = () => res(null)
    } catch {
      res(null)
    }
  })
}

function idbAll(store) {
  if (!idb) return Promise.resolve([...memFallback[store].entries()])
  return new Promise((res) => {
    try {
      const out = []
      const c = idb.transaction(store).objectStore(store).openCursor()
      c.onsuccess = () => {
        const cur = c.result
        if (cur) {
          out.push([cur.key, cur.value])
          cur.continue()
        } else res(out)
      }
      c.onerror = () => res(out)
    } catch {
      res([])
    }
  })
}

// batched write queue
let pendingWrites = { records: new Map(), outbox: new Map(), meta: new Map() }
let writeTimer = null
function queueWrite(store, key, val) {
  pendingWrites[store].set(key, val)
  if (!writeTimer) writeTimer = setTimeout(flushWrites, 30)
}
function flushWrites() {
  writeTimer = null
  const batch = pendingWrites
  pendingWrites = { records: new Map(), outbox: new Map(), meta: new Map() }
  if (!idb) {
    for (const s of Object.keys(batch))
      for (const [k, v] of batch[s]) v === undefined ? memFallback[s].delete(k) : memFallback[s].set(k, v)
    return
  }
  try {
    const tx = idb.transaction(['records', 'outbox', 'meta'], 'readwrite')
    for (const s of Object.keys(batch)) {
      const os = tx.objectStore(s)
      for (const [k, v] of batch[s]) v === undefined ? os.delete(k) : os.put(v, k)
    }
  } catch (e) {
    console.warn('idb write failed', e)
  }
}

// ---------- load ----------
export async function initDb() {
  idb = await openIdb()
  const recs = await idbAll('records')
  for (const [, r] of recs) if (r && data[r.kind]) data[r.kind].set(r.id, r)
  for (const [k] of await idbAll('outbox')) outbox.add(k)
  for (const [k, v] of await idbAll('meta')) meta.set(k, v)
  emit(false)
}

export function getMeta(k) {
  return meta.get(k)
}
export function setMeta(k, v) {
  meta.set(k, v)
  queueWrite('meta', k, v)
}

// ---------- derived ----------
function recompute() {
  const bal = new Map()
  for (const w of data.wallet.values()) {
    if (w.deleted) continue
    bal.set(w.customerId, round2((bal.get(w.customerId) || 0) + Number(w.amount || 0)))
  }
  const st = new Map()
  for (const m of data.stock.values()) {
    if (m.deleted) continue
    st.set(m.productId, round2((st.get(m.productId) || 0) + Number(m.qty || 0)))
  }
  derived.balance = bal
  derived.stock = st
}

function emit(local = false) {
  version++
  recompute()
  listeners.forEach((f) => f(version))
  if (local && onChangeHook) onChangeHook()
}

// ---------- read ----------
export function list(kind, includeDeleted = false) {
  const arr = [...data[kind].values()]
  return includeDeleted ? arr : arr.filter((r) => !r.deleted)
}
export function get(kind, id) {
  const r = data[kind].get(id)
  return r && !r.deleted ? r : null
}
export const balanceOf = (cid) => derived.balance.get(cid) || 0
export const stockOf = (pid) => derived.stock.get(pid) || 0
export const outboxSize = () => outbox.size

// ---------- write (local) ----------
function putLocal(kind, rec) {
  data[kind].set(rec.id, rec)
  const key = kind + ':' + rec.id
  queueWrite('records', key, rec)
  outbox.add(key)
  queueWrite('outbox', key, 1)
}

export function save(kind, obj, { silent = false } = {}) {
  const rec = { ...obj, kind, id: obj.id || uid(), updatedAt: nowIso(), device: deviceId() }
  if (!rec.createdAt) rec.createdAt = rec.updatedAt
  putLocal(kind, rec)
  if (!silent) emit(true)
  return rec
}
export function saveMany(items) {
  const out = items.map(([kind, obj]) => save(kind, obj, { silent: true }))
  emit(true)
  return out
}
export function remove(kind, id) {
  const r = data[kind].get(id)
  if (!r) return
  save(kind, { ...r, deleted: true })
}

// ---------- sync hooks ----------
export function outboxRows(limit = 400) {
  const rows = []
  for (const key of outbox) {
    const i = key.indexOf(':')
    const kind = key.slice(0, i)
    const id = key.slice(i + 1)
    const r = data[kind]?.get(id)
    if (!r) {
      outbox.delete(key)
      queueWrite('outbox', key, undefined)
      continue
    }
    rows.push({ key, row: { kind, id, data: r, updated_at: r.updatedAt, deleted: !!r.deleted, device: r.device } })
    if (rows.length >= limit) break
  }
  return rows
}
export function markPushed(entries) {
  for (const { key, row } of entries) {
    const i = key.indexOf(':')
    const cur = data[key.slice(0, i)]?.get(key.slice(i + 1))
    // only clear if not modified again since snapshot
    if (!cur || cur.updatedAt === row.updated_at) {
      outbox.delete(key)
      queueWrite('outbox', key, undefined)
    }
  }
  emit(false)
}
export function applyRemote(rows) {
  let changed = false
  for (const row of rows) {
    const kind = row.kind
    if (!data[kind]) continue
    const remote = { ...row.data, kind, id: row.id, deleted: !!row.deleted }
    const local = data[kind].get(row.id)
    if (local && local.updatedAt > remote.updatedAt) continue
    if (local && local.updatedAt === remote.updatedAt && !!local.deleted === remote.deleted) continue
    data[kind].set(row.id, remote)
    queueWrite('records', kind + ':' + row.id, remote)
    changed = true
  }
  if (changed) emit(false)
  return changed
}
export function wipeLocal() {
  KINDS.forEach((k) => data[k].clear())
  outbox.clear()
  meta.clear()
  if (idb) {
    try {
      const tx = idb.transaction(['records', 'outbox', 'meta'], 'readwrite')
      ;['records', 'outbox', 'meta'].forEach((s) => tx.objectStore(s).clear())
    } catch {}
  } else Object.values(memFallback).forEach((m) => m.clear())
  emit(false)
}

// ============================================================
// פעולות עסקיות
// ============================================================

export function unitPrice(product, staff) {
  if (staff && product.staffPrice !== '' && product.staffPrice != null) return Number(product.staffPrice)
  return Number(product.price || 0)
}

/** בונה את כל הרשומות של מכירה (בלי לשמור). items: [{productId, name, qty, price, cost}] */
export function buildSale({ items, customerId, payment, discountPct, sellerId, staff, received, extra = {} }) {
  const subtotal = round2(items.reduce((s, i) => s + i.qty * i.price, 0))
  const discount = round2((subtotal * (Number(discountPct) || 0)) / 100)
  const total = round2(subtotal - discount)
  const saleId = uid()
  const now = nowIso()
  const ops = [
    [
      'sale',
      {
        id: saleId,
        items,
        subtotal,
        discountPct: Number(discountPct) || 0,
        discount,
        total,
        payment,
        customerId: customerId || null,
        sellerId,
        staff: !!staff,
        received: payment === 'cash' ? Number(received) || total : null,
        deviceName: deviceName(),
        device: deviceId(),
        createdAt: now,
        ...extra,
      },
    ],
  ]
  for (const it of items) ops.push(['stock', { id: uid(), productId: it.productId, qty: -it.qty, reason: 'sale', ref: saleId, userId: sellerId, createdAt: now }])
  if (payment === 'wallet' && customerId)
    ops.push(['wallet', { id: uid(), customerId, amount: -total, type: 'purchase', ref: saleId, userId: sellerId, createdAt: now }])
  return { id: saleId, total, ops }
}

/** מכירה ושמירה מיידית */
export function sell(args) {
  const r = buildSale(args)
  saveMany(r.ops)
  return { id: r.id, total: r.total }
}

export function voidSale(sale, userId, reason = '') {
  if (sale.voided) return
  const ops = [['sale', { ...sale, voided: { by: userId, at: nowIso(), reason } }]]
  for (const it of sale.items) ops.push(['stock', { productId: it.productId, qty: it.qty, reason: 'void', ref: sale.id, userId }])
  if (sale.payment === 'wallet' && sale.customerId)
    ops.push(['wallet', { customerId: sale.customerId, amount: sale.total, type: 'refund', ref: sale.id, userId }])
  saveMany(ops)
}

export function buildTopup(customerId, amount, method, userId, note = '', extra = {}) {
  return [
    'wallet',
    {
      id: uid(),
      customerId,
      amount: round2(amount),
      type: 'topup',
      method,
      userId,
      note,
      deviceName: deviceName(),
      device: deviceId(),
      createdAt: nowIso(),
      ...extra,
    },
  ]
}
export function topup(customerId, amount, method, userId, note = '', extra = {}) {
  const [k, o] = buildTopup(customerId, amount, method, userId, note, extra)
  return save(k, o)
}
export function voidTopup(tx, userId) {
  if (tx.voided) return
  saveMany([
    ['wallet', { ...tx, voided: { by: userId, at: nowIso() } }],
    ['wallet', { customerId: tx.customerId, amount: -tx.amount, type: 'topup_void', method: tx.method, ref: tx.id, userId, deviceName: deviceName() }],
  ])
}

export function receiveStock(productId, qty, userId, reason = 'receive', ref = null) {
  return save('stock', { productId, qty: Number(qty), reason, ref, userId })
}
export function setStockTo(productId, actual, userId) {
  const diff = round2(Number(actual) - stockOf(productId))
  if (diff !== 0) save('stock', { productId, qty: diff, reason: 'adjust', userId })
}

// ---------- cash drawer ----------
/** כמה מזומן אמור להיות במגירה של המכשיר הזה מאז הספירה האחרונה */
export function drawerStatus(dev = deviceId()) {
  const counts = list('count')
    .filter((c) => c.device === dev)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const last = counts[0] || null
  const since = last ? last.createdAt : '0000'
  const opening = last ? Number(last.leftInDrawer || 0) : 0
  let cashSales = 0,
    walletSales = 0,
    creditSales = 0,
    terminalSales = 0,
    cashTopups = 0,
    terminalTopups = 0,
    salesCount = 0,
    voids = 0
  for (const s of data.sale.values()) {
    if (s.deleted || s.device !== dev) continue
    if (s.createdAt <= since) {
      // מכירה ישנה שבוטלה אחרי הספירה — הכסף יצא מהמגירה עכשיו
      if (s.voided && s.voided.at > since && s.payment === 'cash') cashSales -= s.total
      if (s.voided && s.voided.at > since && s.payment === 'terminal') terminalSales -= s.total
      continue
    }
    if (s.voided) {
      voids++
      continue
    }
    salesCount++
    if (s.payment === 'cash') cashSales += s.total
    else if (s.payment === 'credit') creditSales += s.total
    else if (s.payment === 'terminal') terminalSales += s.total
    else walletSales += s.total
  }
  for (const w of data.wallet.values()) {
    if (w.deleted || w.createdAt <= since || w.device !== dev) continue
    if (w.type !== 'topup' && w.type !== 'topup_void') continue
    if (w.method === 'cash') cashTopups += w.amount
    if (w.method === 'terminal') terminalTopups += w.amount
  }
  return {
    last,
    opening,
    cashSales: round2(cashSales),
    walletSales: round2(walletSales),
    cashTopups: round2(cashTopups),
    creditSales: round2(creditSales),
    terminalSales: round2(terminalSales),
    terminalTopups: round2(terminalTopups),
    terminalExpected: round2(terminalSales + terminalTopups),
    salesCount,
    voids,
    expected: round2(opening + cashSales + cashTopups),
  }
}

// ---------- first-run ----------
export function ensureDefaultManager() {
  if (list('user').length === 0) {
    save('user', {
      name: 'מנהל',
      pinHash: hashPin('1234'),
      role: 'manager',
      active: true,
      perms: { void: true, topup: true, discount: true, reports: true },
    })
  }
}

// ---------- הגדרות משותפות (מסונכרנות) ----------
export function getSetting(id) {
  return get('setting', id) || {}
}
export function setSetting(id, values) {
  const cur = data.setting.get(id) || { id }
  return save('setting', { ...cur, ...values, id })
}

// ---------- תשלום אשראי (נדרים פלוס) ----------
/** יוצר רשומת תשלום ממתין. ops = הרשומות שייכתבו כשהתשלום יאושר */
export function createPendingPayment({ purpose, amount, ops, customerId, userId }) {
  return save('payment', {
    purpose,
    amount: round2(amount),
    ops,
    customerId: customerId || null,
    userId: userId || null,
    status: 'pending',
    deviceName: deviceName(),
  })
}
/** הדפדפן קיבל אישור מהאייפרם — רושמים את הפעולות מיד (אותם מזהים כמו בשרת, כך שאין כפילות) */
export function commitPaymentClientSide(paymentId, resp) {
  const p = data.payment.get(paymentId)
  if (!p) return
  const ops = (p.ops || []).map(([k, o]) => [k, { ...o }])
  ops.push([
    'payment',
    {
      ...p,
      status: p.status === 'paid' ? 'paid' : 'client_ok',
      clientResponse: { Confirmation: resp?.Confirmation || '', LastNum: resp?.LastNum || '', ID: resp?.ID || resp?.TransactionId || '' },
    },
  ])
  saveMany(ops)
}
export function markPaymentFailed(paymentId, message) {
  const p = data.payment.get(paymentId)
  if (p && p.status === 'pending') save('payment', { ...p, status: 'failed', error: message || '' })
}
/** מנהל בדק בנדרים פלוס שהתשלום התקבל — רושם ידנית */
export function approvePaymentManually(paymentId, userId) {
  const p = data.payment.get(paymentId)
  if (!p) return
  const ops = (p.ops || []).map(([k, o]) => [k, { ...o, verified: true, manualBy: userId }])
  ops.push(['payment', { ...p, status: 'paid', manualBy: userId, manualAt: nowIso() }])
  saveMany(ops)
}
export function dismissPayment(paymentId, userId) {
  const p = data.payment.get(paymentId)
  if (p) save('payment', { ...p, status: 'dismissed', dismissedBy: userId })
}
