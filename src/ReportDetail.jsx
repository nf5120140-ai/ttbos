// דוחות מפורטים: לפי מוצר / קטגוריה, ורשימת מכירות עם פירוט כל עסקה.
// עובד גם על מוצרים שנמחקו מהמלאי — הנתונים נלקחים מהמכירה עצמה (שם, מחיר, כמות שנשמרו בזמן המכירה).
import { useMemo, useState } from 'react'
import { get, getAny, round2 } from './db.js'
import { money, fmtDT, downloadFile, toCsv, Modal, Empty } from './ui.jsx'

const PAY = { cash: 'מזומן', wallet: 'ארנק', credit: 'אשראי אונליין', terminal: 'אשראי במסופון' }
const payName = (s) => PAY[s.payment] || s.payment
const itemKey = (i) => (i.general ? 'general' : i.productId)
const itemCat = (i) => (i.general ? 'פריט כללי' : i.category || getAny('product', i.productId)?.category || 'אחר')
const lineTotal = (s, i) => round2(i.qty * i.price * (1 - (s.discountPct || 0) / 100))
const dt = (iso) => {
  const d = new Date(iso)
  return [d.toLocaleDateString('he-IL'), d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })]
}

export function ReportDetail({ sales, users, fileTag }) {
  const [mode, setMode] = useState('product') // product | sales
  return (
    <div className="card">
      <div className="row space wrap gap-s">
        <h3>🔎 דוח מפורט</h3>
        <div className="seg">
          <button className={mode === 'product' ? 'on' : ''} onClick={() => setMode('product')}>
            לפי מוצר / קטגוריה
          </button>
          <button className={mode === 'sales' ? 'on' : ''} onClick={() => setMode('sales')}>
            רשימת מכירות
          </button>
        </div>
      </div>
      {mode === 'product' ? <ByProduct sales={sales} users={users} fileTag={fileTag} /> : <SalesList sales={sales} users={users} fileTag={fileTag} />}
    </div>
  )
}

// ---------- לפי מוצר / קטגוריה ----------
function ByProduct({ sales, users, fileTag }) {
  const ok = sales.filter((s) => !s.voided)
  // כל המוצרים שנמכרו בתקופה (כולל מוצרים שנמחקו) + קטגוריות
  const { prodOpts, catOpts } = useMemo(() => {
    const p = new Map()
    const c = new Map()
    for (const s of ok)
      for (const i of s.items) {
        const k = itemKey(i)
        const cur = p.get(k) || { key: k, name: i.general ? '✏️ פריט כללי' : i.name, qty: 0, deleted: !i.general && !get('product', i.productId) }
        cur.qty += i.qty
        p.set(k, cur)
        const cat = itemCat(i)
        c.set(cat, (c.get(cat) || 0) + i.qty)
      }
    return {
      prodOpts: [...p.values()].sort((a, b) => a.name.localeCompare(b.name, 'he')),
      catOpts: [...c.entries()].sort((a, b) => a[0].localeCompare(b[0], 'he')),
    }
  }, [sales])
  const [sel, setSel] = useState('') // 'p:<key>' | 'c:<cat>'
  const [q, setQ] = useState('')

  const match = (i) => (sel.startsWith('p:') ? itemKey(i) === sel.slice(2) : sel.startsWith('c:') ? itemCat(i) === sel.slice(2) : false)
  const rows = []
  for (const s of ok) for (const i of s.items) if (match(i)) rows.push({ s, i, total: lineTotal(s, i) })
  rows.sort((a, b) => (a.s.createdAt < b.s.createdAt ? 1 : -1))
  const qty = rows.reduce((a, r) => a + r.i.qty, 0)
  const total = round2(rows.reduce((a, r) => a + r.total, 0))
  const profit = round2(rows.reduce((a, r) => a + r.total - r.i.qty * (r.i.cost || 0), 0))
  const hasCost = rows.some((r) => r.i.cost)
  // סיכום לפי מחיר — מראה באיזה מחיר נמכר כמה
  const byPrice = new Map()
  for (const r of rows) {
    const k = r.i.name + '|' + r.i.price
    const x = byPrice.get(k) || { name: r.i.name, price: r.i.price, qty: 0, total: 0 }
    x.qty += r.i.qty
    x.total = round2(x.total + r.total)
    byPrice.set(k, x)
  }
  const priceRows = [...byPrice.values()].sort((a, b) => a.name.localeCompare(b.name, 'he') || b.qty - a.qty)

  const exportCsv = () => {
    const out = [['תאריך', 'שעה', 'מוצר', 'קטגוריה', 'כמות', 'מחיר ליח׳', 'סה״כ', 'תשלום', 'בחור', 'מוכר', 'מבצע']]
    for (const r of [...rows].reverse())
      out.push([...dt(r.s.createdAt), r.i.name, itemCat(r.i), r.i.qty, r.i.price, r.total, payName(r.s), r.s.customerId ? getAny('customer', r.s.customerId)?.name || '' : '', users.get(r.s.sellerId) || '', r.i.promoName || ''])
    downloadFile(`doch-${sel.slice(2).replace(/[^\w֐-׿]+/g, '-')}-${fileTag}.csv`, toCsv(out))
  }

  const shownProds = prodOpts.filter((p) => !q || p.name.includes(q))
  return (
    <>
      <div className="row gap-s wrap" style={{ margin: '8px 0' }}>
        <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ minWidth: 240 }}>
          <option value="">— בחר מוצר או קטגוריה —</option>
          <optgroup label="קטגוריות">
            {catOpts.map(([c, n]) => (
              <option key={c} value={'c:' + c}>
                📁 {c} ({n} יח׳)
              </option>
            ))}
          </optgroup>
          <optgroup label="מוצרים">
            {shownProds.map((p) => (
              <option key={p.key} value={'p:' + p.key}>
                {p.name}
                {p.deleted ? ' (נמחק מהמלאי)' : ''} — {p.qty} יח׳
              </option>
            ))}
          </optgroup>
        </select>
        {prodOpts.length > 15 && <input placeholder="🔍 סינון מוצרים ברשימה" value={q} onChange={(e) => setQ(e.target.value)} />}
        {rows.length > 0 && (
          <button className="btn" onClick={exportCsv}>
            ⬇ ייצוא לאקסל
          </button>
        )}
      </div>
      {!prodOpts.length && <Empty>אין מכירות בתקופה</Empty>}
      {sel && (
        <>
          <div className="kpis">
            <div className="kpi">
              <span>נמכרו</span>
              <b>{qty} יח׳</b>
            </div>
            <div className="kpi">
              <span>סה״כ</span>
              <b>{money(total)}</b>
            </div>
            <div className="kpi">
              <span>עסקאות</span>
              <b>{new Set(rows.map((r) => r.s.id)).size}</b>
            </div>
            {hasCost && (
              <div className="kpi">
                <span>רווח גולמי</span>
                <b>{money(profit)}</b>
              </div>
            )}
          </div>
          {priceRows.length > 0 && (
            <>
              <h4>לפי מחיר מכירה</h4>
              <table>
                <thead>
                  <tr>
                    <th>מוצר</th>
                    <th>מחיר ליח׳</th>
                    <th>כמות</th>
                    <th>סה״כ</th>
                  </tr>
                </thead>
                <tbody>
                  {priceRows.map((x) => (
                    <tr key={x.name + x.price}>
                      <td>{x.name}</td>
                      <td>{money(x.price)}</td>
                      <td>{x.qty}</td>
                      <td>{money(x.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <h4>כל המכירות ({rows.length})</h4>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>מוצר</th>
                  <th>כמות</th>
                  <th>מחיר</th>
                  <th>סה״כ</th>
                  <th>תשלום</th>
                  <th>מוכר</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r, k) => (
                  <tr key={r.s.id + k}>
                    <td className="small">{fmtDT(r.s.createdAt)}</td>
                    <td>
                      {r.i.name}
                      {r.i.promoName && <span className="muted small"> · 🏷 {r.i.promoName}</span>}
                    </td>
                    <td>{r.i.qty}</td>
                    <td>{money(r.i.price)}</td>
                    <td>{money(r.total)}</td>
                    <td className="small">{payName(r.s)}</td>
                    <td className="small">{users.get(r.s.sellerId) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 500 && <p className="muted small">מוצגות 500 השורות האחרונות — הכול בייצוא לאקסל</p>}
          </div>
        </>
      )}
    </>
  )
}

// ---------- רשימת מכירות ----------
function SalesList({ sales, users, fileTag }) {
  const [pay, setPay] = useState('all')
  const [seller, setSeller] = useState('all')
  const [q, setQ] = useState('')
  const [showVoid, setShowVoid] = useState(true)
  const [open, setOpen] = useState(null)
  const sellers = [...new Set(sales.map((s) => s.sellerId))]
  const custName = (s) => (s.customerId ? getAny('customer', s.customerId)?.name || '' : '')
  const rows = sales
    .filter((s) => showVoid || !s.voided)
    .filter((s) => pay === 'all' || s.payment === pay)
    .filter((s) => seller === 'all' || s.sellerId === seller)
    .filter((s) => {
      if (!q) return true
      const t = q.trim()
      return custName(s).includes(t) || s.items.some((i) => i.name.includes(t)) || String(s.total).startsWith(t) || (s.terminal?.confirmation || '').includes(t) || (s.id || '').startsWith(t)
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const total = round2(rows.filter((s) => !s.voided).reduce((a, s) => a + s.total, 0))

  const exportCsv = () => {
    const out = [['מס׳', 'תאריך', 'שעה', 'מוצר', 'כמות', 'מחיר ליח׳', 'סה״כ שורה', 'סה״כ עסקה', 'הנחה', 'תשלום', 'בחור', 'מוכר', 'מכשיר', 'בוטל']]
    for (const s of [...rows].reverse())
      for (const i of s.items)
        out.push([s.id.slice(0, 8), ...dt(s.createdAt), i.name, i.qty, i.price, lineTotal(s, i), s.total, s.discount || 0, payName(s), custName(s), users.get(s.sellerId) || '', s.deviceName || '', s.voided ? 'כן' : ''])
    downloadFile(`mechirot-mefurat-${fileTag}.csv`, toCsv(out))
  }

  return (
    <>
      <div className="row gap-s wrap" style={{ margin: '8px 0' }}>
        <input placeholder="🔍 בחור / מוצר / סכום / מס׳ אישור" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={pay} onChange={(e) => setPay(e.target.value)}>
          <option value="all">כל אמצעי התשלום</option>
          {Object.entries(PAY).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select value={seller} onChange={(e) => setSeller(e.target.value)}>
          <option value="all">כל המוכרים</option>
          {sellers.map((id) => (
            <option key={id} value={id}>
              {users.get(id) || (id === 'super-admin' ? 'מנהל מערכת' : '—')}
            </option>
          ))}
        </select>
        <label className="chk small">
          <input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} /> כולל ביטולים
        </label>
        <button className="btn" onClick={exportCsv} disabled={!rows.length}>
          ⬇ ייצוא לאקסל
        </button>
      </div>
      <p className="muted small">
        {rows.length} מכירות · סה״כ {money(total)} (בלי ביטולים) · לחיצה על שורה מציגה את פרטי העסקה
      </p>
      <div className="table-scroll">
        <table className="clickable">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>פריטים</th>
              <th>בחור</th>
              <th>תשלום</th>
              <th>סכום</th>
              <th>מוכר</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 500).map((s) => (
              <tr key={s.id} onClick={() => setOpen(s)} className={s.voided ? 'voided' : ''}>
                <td className="small">{fmtDT(s.createdAt)}</td>
                <td className="small">{s.items.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(', ')}</td>
                <td className="small">{custName(s)}</td>
                <td className="small">{payName(s)}</td>
                <td>
                  <b>{money(s.total)}</b>
                  {s.voided && <span className="neg small"> בוטל</span>}
                </td>
                <td className="small">{users.get(s.sellerId) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty>אין מכירות שמתאימות לסינון</Empty>}
        {rows.length > 500 && <p className="muted small">מוצגות 500 המכירות האחרונות — הכול בייצוא לאקסל</p>}
      </div>
      {open && <SaleDetail s={open} users={users} onClose={() => setOpen(null)} />}
    </>
  )
}

function SaleDetail({ s, users, onClose }) {
  const sub = round2(s.items.reduce((a, i) => a + i.qty * i.price, 0))
  return (
    <Modal title={'עסקה ' + s.id.slice(0, 8)} onClose={onClose}>
      <p className="muted small">
        {fmtDT(s.createdAt)} · {s.deviceName || ''} · מוכר: {users.get(s.sellerId) || '—'}
      </p>
      {s.voided && <p className="neg">❌ בוטלה {s.voided.at ? fmtDT(s.voided.at) : ''} על ידי {users.get(s.voided.by) || '—'}</p>}
      <table>
        <thead>
          <tr>
            <th>מוצר</th>
            <th>כמות</th>
            <th>מחיר</th>
            <th>סה״כ</th>
          </tr>
        </thead>
        <tbody>
          {s.items.map((i, k) => (
            <tr key={k}>
              <td>
                {i.name}
                {i.promoName && <div className="muted small">🏷 {i.promoName}</div>}
                {i.regularPrice != null && i.regularPrice !== i.price && <div className="muted small">מחיר רגיל {money(i.regularPrice)}</div>}
              </td>
              <td>{i.qty}</td>
              <td>{money(i.price)}</td>
              <td>{money(i.qty * i.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sale-sum">
        <div className="row space">
          <span>סכום ביניים</span>
          <span>{money(sub)}</span>
        </div>
        {(s.promoDiscounts || []).map((d, k) => (
          <div className="row space small" key={k}>
            <span>🏷 {d.name}</span>
            <span>−{money(d.amount)}</span>
          </div>
        ))}
        {s.discountPct > 0 && (
          <div className="row space small">
            <span>הנחה {s.discountPct}%</span>
            <span>−{money(s.discount)}</span>
          </div>
        )}
        <div className="row space">
          <b>שולם</b>
          <b>{money(s.total)}</b>
        </div>
        <div className="row space small">
          <span>אמצעי תשלום</span>
          <span>{payName(s)}</span>
        </div>
        {s.customerId && (
          <div className="row space small">
            <span>בחור</span>
            <span>{getAny('customer', s.customerId)?.name || '—'}</span>
          </div>
        )}
        {s.received > 0 && s.payment === 'cash' && (
          <div className="row space small">
            <span>התקבל / עודף</span>
            <span>
              {money(s.received)} / {money(s.received - s.total)}
            </span>
          </div>
        )}
        {s.terminal && (
          <div className="row space small">
            <span>מסופון</span>
            <span>
              אישור {s.terminal.confirmation} · {s.terminal.phone}
            </span>
          </div>
        )}
      </div>
    </Modal>
  )
}
