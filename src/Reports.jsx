import { useMemo, useState } from 'react'
import { list, get, save, drawerStatus, deviceName, round2 } from './db.js'
import { useVersion, money, fmtDT, toast, Empty, downloadFile, toCsv, ProductThumb } from './ui.jsx'

// ---------- טווחי תאריכים ----------
function startOf(type, d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  if (type === 'week') x.setDate(x.getDate() - x.getDay()) // שבוע מתחיל ביום ראשון
  if (type === 'month') x.setDate(1)
  if (type === 'year') {
    x.setMonth(0, 1)
  }
  return x
}
function shift(type, d, n) {
  const x = new Date(d)
  if (type === 'day') x.setDate(x.getDate() + n)
  if (type === 'week') x.setDate(x.getDate() + 7 * n)
  if (type === 'month') x.setMonth(x.getMonth() + n)
  if (type === 'year') x.setFullYear(x.getFullYear() + n)
  return x
}
const HEB_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
const HEB_MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳']

function label(type, start) {
  const end = shift(type, start, 1)
  end.setDate(end.getDate() - 1)
  const d = (x) => x.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })
  if (type === 'day') return start.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  if (type === 'week') return `שבוע ${d(start)} – ${d(end)}`
  if (type === 'month') return start.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
  return 'שנת ' + start.getFullYear()
}

export function Reports() {
  const v = useVersion()
  const [type, setType] = useState('day')
  const [anchor, setAnchor] = useState(() => startOf('day', new Date()))
  const [device, setDevice] = useState('all')
  const start = startOf(type, anchor)
  const end = shift(type, start, 1)
  const sIso = start.toISOString()
  const eIso = end.toISOString()

  const r = useMemo(() => {
    const users = new Map(list('user').map((u) => [u.id, u.name]))
    const sales = list('sale').filter((s) => s.createdAt >= sIso && s.createdAt < eIso && (device === 'all' || s.device === device))
    const ok = sales.filter((s) => !s.voided)
    const voided = sales.filter((s) => s.voided)
    const sum = (arr, f) => round2(arr.reduce((a, x) => a + f(x), 0))
    const revenue = sum(ok, (s) => s.total)
    const cash = sum(
      ok.filter((s) => s.payment === 'cash'),
      (s) => s.total
    )
    const wallet = sum(
      ok.filter((s) => s.payment === 'wallet'),
      (s) => s.total
    )
    const discounts = sum(ok, (s) => s.discount || 0)
    const cost = sum(ok, (s) => s.items.reduce((a, i) => a + i.qty * (i.cost || 0), 0))
    const profit = round2(revenue - cost)
    const tops = list('wallet').filter((w) => w.createdAt >= sIso && w.createdAt < eIso && (w.type === 'topup' || w.type === 'topup_void') && (device === 'all' || w.device === device))
    const topCash = sum(
      tops.filter((t) => t.method === 'cash'),
      (t) => t.amount
    )
    const topOther = sum(
      tops.filter((t) => t.method !== 'cash'),
      (t) => t.amount
    )

    // buckets
    let buckets = []
    if (type === 'day') {
      for (let h = 6; h < 24; h++) buckets.push({ k: h, label: String(h), v: 0 })
      for (const s of ok) {
        const h = new Date(s.createdAt).getHours()
        const b = buckets.find((x) => x.k === h)
        if (b) b.v += s.total
      }
    } else if (type === 'week' || type === 'month') {
      const n = Math.round((end - start) / 864e5)
      for (let i = 0; i < n; i++) {
        const d = new Date(start)
        d.setDate(d.getDate() + i)
        buckets.push({ k: d.toDateString(), label: type === 'week' ? HEB_DAYS[d.getDay()] : String(d.getDate()), v: 0 })
      }
      for (const s of ok) {
        const b = buckets.find((x) => x.k === new Date(s.createdAt).toDateString())
        if (b) b.v += s.total
      }
    } else {
      buckets = HEB_MONTHS.map((m, i) => ({ k: i, label: m, v: 0 }))
      for (const s of ok) buckets[new Date(s.createdAt).getMonth()].v += s.total
    }

    // by seller
    const bySeller = new Map()
    for (const s of ok) {
      const x = bySeller.get(s.sellerId) || { name: users.get(s.sellerId) || '—', n: 0, total: 0 }
      x.n++
      x.total += s.total
      bySeller.set(s.sellerId, x)
    }
    for (const s of voided) {
      const x = bySeller.get(s.voided.by) || { name: users.get(s.voided.by) || '—', n: 0, total: 0 }
      x.voids = (x.voids || 0) + 1
      bySeller.set(s.voided.by, x)
    }

    // by product
    const byProd = new Map()
    for (const p of list('product').filter((p) => p.active !== false)) byProd.set(p.id, { id: p.id, name: p.name, qty: 0, total: 0, profit: 0 })
    for (const s of ok)
      for (const i of s.items) {
        const x = byProd.get(i.productId) || { id: i.productId, name: i.name, qty: 0, total: 0, profit: 0 }
        const f = 1 - (s.discountPct || 0) / 100
        x.qty += i.qty
        x.total += i.qty * i.price * f
        x.profit += i.qty * (i.price * f - (i.cost || 0))
        byProd.set(i.productId, x)
      }
    const prods = [...byProd.values()].sort((a, b) => b.qty - a.qty)

    // by category
    const byCat = new Map()
    for (const p of prods) {
      const c = get('product', p.id)?.category || 'אחר'
      byCat.set(c, (byCat.get(c) || 0) + p.total)
    }

    return {
      sales,
      ok,
      voided,
      revenue,
      cash,
      wallet,
      discounts,
      profit,
      hasCost: ok.some((s) => s.items.some((i) => i.cost)),
      topCash,
      topOther,
      buckets,
      bySeller: [...bySeller.values()].sort((a, b) => b.total - a.total),
      prods,
      byCat: [...byCat.entries()].sort((a, b) => b[1] - a[1]),
      users,
    }
  }, [v, sIso, eIso, type, device])

  const max = Math.max(1, ...r.buckets.map((b) => b.v))
  const devices = [...new Map(list('sale').map((s) => [s.device, s.deviceName || s.device?.slice(0, 6)])).entries()]
  const sold = r.prods.filter((p) => p.qty > 0)
  const slow = [...r.prods].sort((a, b) => a.qty - b.qty).slice(0, 8)

  function exportCsv() {
    const rows = [['תאריך', 'שעה', 'פריטים', 'בחור', 'תשלום', 'סכום', 'הנחה', 'מוכר', 'מכשיר', 'בוטל']]
    for (const s of r.sales.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) {
      const d = new Date(s.createdAt)
      rows.push([
        d.toLocaleDateString('he-IL'),
        d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
        s.items.map((i) => `${i.name} x${i.qty}`).join(' | '),
        s.customerId ? get('customer', s.customerId)?.name : '',
        s.payment === 'cash' ? 'מזומן' : 'ארנק',
        s.total,
        s.discount || 0,
        r.users.get(s.sellerId),
        s.deviceName || '',
        s.voided ? 'כן' : '',
      ])
    }
    downloadFile(`mechirot-${type}-${start.toLocaleDateString('he-IL').replace(/\./g, '-')}.csv`, toCsv(rows))
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>דוחות</h2>
        <div className="seg">
          {[
            ['day', 'יומי'],
            ['week', 'שבועי'],
            ['month', 'חודשי'],
            ['year', 'שנתי'],
          ].map(([k, l]) => (
            <button
              key={k}
              className={type === k ? 'on' : ''}
              onClick={() => {
                setType(k)
                setAnchor(startOf(k, new Date()))
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="period">
        <button className="btn" onClick={() => setAnchor(shift(type, start, -1))}>
          ‹ קודם
        </button>
        <b>{label(type, start)}</b>
        <button className="btn" onClick={() => setAnchor(shift(type, start, 1))} disabled={end > new Date()}>
          הבא ›
        </button>
      </div>
      <div className="toolbar">
        <select value={device} onChange={(e) => setDevice(e.target.value)}>
          <option value="all">כל המכשירים</option>
          {devices.map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
        </select>
        <button className="btn" onClick={exportCsv}>
          ⬇ ייצוא לאקסל
        </button>
        <button className="btn" onClick={() => window.print()}>
          🖨 הדפסה
        </button>
      </div>

      <div className="kpis">
        <Kpi label="סה״כ מכירות" value={money(r.revenue)} sub={`${r.ok.length} עסקאות`} big />
        <Kpi label="מזומן" value={money(r.cash)} />
        <Kpi label="מהארנק" value={money(r.wallet)} />
        <Kpi label="ממוצע לעסקה" value={money(r.ok.length ? r.revenue / r.ok.length : 0)} />
        {r.hasCost && <Kpi label="רווח גולמי" value={money(r.profit)} sub={r.revenue ? Math.round((r.profit / r.revenue) * 100) + '%' : ''} />}
        <Kpi label="טעינות ארנק" value={money(r.topCash + r.topOther)} sub={`מזומן ${money(r.topCash)} · אחר ${money(r.topOther)}`} />
        <Kpi label="הנחות" value={money(r.discounts)} />
        <Kpi label="ביטולים" value={r.voided.length} sub={money(r.voided.reduce((a, s) => a + s.total, 0))} warn={r.voided.length > 0} />
      </div>

      <div className="card">
        <h3>מכירות לפי {type === 'day' ? 'שעה' : type === 'year' ? 'חודש' : 'יום'}</h3>
        <div className="bars">
          {r.buckets.map((b) => (
            <div className="bar-col" key={b.k} title={money(b.v)}>
              <div className="bar-val">{b.v > 0 ? Math.round(b.v) : ''}</div>
              <div className="bar" style={{ height: (b.v / max) * 100 + '%' }} />
              <div className="bar-lbl">{b.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <h3>🔥 הכי נמכרים</h3>
          {sold.slice(0, 10).map((p, i) => (
            <div className="rank" key={p.id}>
              <span className="rank-n">{i + 1}</span>
              <ProductThumb p={get('product', p.id)} size={28} />
              <span className="grow">{p.name}</span>
              <span className="muted">{p.qty} יח׳</span>
              <b>{money(p.total)}</b>
              <div className="rank-bar" style={{ width: (p.qty / (sold[0]?.qty || 1)) * 100 + '%' }} />
            </div>
          ))}
          {!sold.length && <Empty>אין מכירות בתקופה</Empty>}
        </div>
        <div className="card">
          <h3>🐢 הולכים פחות</h3>
          {slow.map((p) => (
            <div className="rank" key={p.id}>
              <ProductThumb p={get('product', p.id)} size={28} />
              <span className="grow">{p.name}</span>
              <span className={p.qty === 0 ? 'neg' : 'muted'}>{p.qty === 0 ? 'לא נמכר' : p.qty + ' יח׳'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <h3>לפי מוכר</h3>
          <table>
            <thead>
              <tr>
                <th>מוכר</th>
                <th>עסקאות</th>
                <th>סכום</th>
                <th>ביטולים</th>
              </tr>
            </thead>
            <tbody>
              {r.bySeller.map((s, i) => (
                <tr key={i}>
                  <td>{s.name}</td>
                  <td>{s.n}</td>
                  <td>{money(s.total)}</td>
                  <td className={s.voids ? 'warn' : ''}>{s.voids || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>לפי קטגוריה</h3>
          {r.byCat
            .filter((c) => c[1] > 0)
            .map(([c, t]) => (
              <div className="rank" key={c}>
                <span className="grow">{c}</span>
                <b>{money(t)}</b>
                <div className="rank-bar" style={{ width: (t / (r.byCat[0]?.[1] || 1)) * 100 + '%' }} />
              </div>
            ))}
        </div>
      </div>

      {r.voided.length > 0 && (
        <div className="card">
          <h3>ביטולים בתקופה</h3>
          <table>
            <tbody>
              {r.voided.map((s) => (
                <tr key={s.id}>
                  <td>{fmtDT(s.createdAt)}</td>
                  <td className="small">{s.items.map((i) => i.name + ' ×' + i.qty).join(', ')}</td>
                  <td>{money(s.total)}</td>
                  <td>מכר: {r.users.get(s.sellerId)}</td>
                  <td>ביטל: {r.users.get(s.voided.by)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, sub, big, warn }) {
  return (
    <div className={'kpi' + (big ? ' big' : '') + (warn ? ' warn' : '')}>
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  )
}

// ============================================================
// ספירת קופה
// ============================================================
const DENOMS = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.1]

export function CashCount({ user }) {
  const v = useVersion()
  const [qty, setQty] = useState({})
  const [direct, setDirect] = useState('')
  const [left, setLeft] = useState('')
  const [note, setNote] = useState('')
  const st = useMemo(() => drawerStatus(), [v])
  const byDenoms = round2(DENOMS.reduce((s, d) => s + d * (Number(qty[d]) || 0), 0))
  const counted = direct !== '' ? Number(direct) : byDenoms
  const diff = round2(counted - st.expected)
  const users = new Map(list('user').map((u) => [u.id, u.name]))
  const history = list('count')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 30)

  function saveCount() {
    const leftIn = left === '' ? counted : Number(left)
    save('count', {
      counted,
      expected: st.expected,
      diff,
      opening: st.opening,
      cashSales: st.cashSales,
      walletSales: st.walletSales,
      cashTopups: st.cashTopups,
      salesCount: st.salesCount,
      denoms: qty,
      leftInDrawer: leftIn,
      removed: round2(counted - leftIn),
      userId: user.id,
      note,
      deviceName: deviceName(),
    })
    setQty({})
    setDirect('')
    setLeft('')
    setNote('')
    toast(diff === 0 ? '✓ הקופה מאוזנת' : `נשמר. ${diff > 0 ? 'עודף' : 'חוסר'} של ${money(Math.abs(diff))}`, diff === 0 ? 'ok' : 'err')
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>ספירת קופה — {deviceName()}</h2>
      </div>
      <div className="two-col">
        <div className="card">
          <h3>מה אמור להיות במגירה</h3>
          <div className="muted small">מאז {st.last ? 'הספירה האחרונה ' + fmtDT(st.last.createdAt) : 'תחילת השימוש'}</div>
          <div className="sum-row">
            <span>יתרת פתיחה</span>
            <b>{money(st.opening)}</b>
          </div>
          <div className="sum-row">
            <span>מכירות במזומן</span>
            <b>+{money(st.cashSales)}</b>
          </div>
          <div className="sum-row">
            <span>טעינות ארנק במזומן</span>
            <b>+{money(st.cashTopups)}</b>
          </div>
          <div className="sum-row total">
            <span>צפוי במגירה</span>
            <span>{money(st.expected)}</span>
          </div>
          <div className="sum-row muted">
            <span>מכירות מהארנק (לא במזומן)</span>
            <span>{money(st.walletSales)}</span>
          </div>
          <div className="muted small">{st.salesCount} עסקאות במשמרת{st.voids > 0 ? ` · ${st.voids} ביטולים` : ''}</div>
        </div>

        <div className="card">
          <h3>ספירה</h3>
          <div className="denoms">
            {DENOMS.map((d) => (
              <label key={d} className="denom">
                <span>{d >= 1 ? '₪' + d : d * 100 + ' אג׳'}</span>
                <input type="number" inputMode="numeric" min="0" value={qty[d] ?? ''} onChange={(e) => setQty({ ...qty, [d]: e.target.value })} placeholder="0" />
                <small>{qty[d] ? money(d * qty[d]) : ''}</small>
              </label>
            ))}
          </div>
          <div className="row gap-s">
            <span className="muted">או סכום כולל:</span>
            <input type="number" inputMode="decimal" value={direct} onChange={(e) => setDirect(e.target.value)} placeholder={String(byDenoms)} />
          </div>
          <div className="sum-row total">
            <span>נספר</span>
            <span>{money(counted)}</span>
          </div>
          <div className={'diff ' + (diff === 0 ? 'ok' : diff > 0 ? 'over' : 'under')}>
            {diff === 0 ? '✓ מאוזן' : diff > 0 ? `עודף ${money(diff)}` : `חוסר ${money(-diff)}`}
          </div>
          <label className="field">
            <span>כמה משאירים במגירה (עודף לפתיחה)</span>
            <input type="number" inputMode="decimal" value={left} onChange={(e) => setLeft(e.target.value)} placeholder={`${counted} (הכל)`} />
            {left !== '' && <small>יוצא מהקופה: {money(counted - Number(left))}</small>}
          </label>
          <input placeholder="הערה" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn primary big grow" onClick={saveCount}>
            ✓ שמור ספירה
          </button>
        </div>
      </div>

      <h3 className="section-title">היסטוריית ספירות</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>מתי</th>
              <th>מכשיר</th>
              <th>צפוי</th>
              <th>נספר</th>
              <th>הפרש</th>
              <th>הוצא</th>
              <th>נשאר</th>
              <th>ע״י</th>
            </tr>
          </thead>
          <tbody>
            {history.map((c) => (
              <tr key={c.id}>
                <td>{fmtDT(c.createdAt)}</td>
                <td>{c.deviceName || ''}</td>
                <td>{money(c.expected)}</td>
                <td>{money(c.counted)}</td>
                <td className={c.diff === 0 ? 'pos-bal' : 'neg'}>{c.diff > 0 ? '+' : ''}{money(c.diff)}</td>
                <td>{money(c.removed || 0)}</td>
                <td>{money(c.leftInDrawer)}</td>
                <td>
                  {users.get(c.userId)}
                  {c.note && <div className="muted small">{c.note}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!history.length && <Empty>אין ספירות עדיין</Empty>}
      </div>
    </div>
  )
}

