import { useMemo, useState } from 'react'
import { list, get, balanceOf, stockOf, sell, buildSale, voidSale, unitPrice, deviceId, round2 } from './db.js'
import { CreditModal, TerminalModal, creditStatus, paymentLabel } from './Credit.jsx'
import {
  useVersion,
  money,
  fmtTime,
  can,
  toast,
  confirmDlg,
  Modal,
  ProductThumb,
  useBarcodeScanner,
  cameraScanSupported,
  CameraScanner,
  Empty,
} from './ui.jsx'

const DISCOUNTS = [0, 5, 10, 15, 20]

export default function Pos({ user }) {
  const v = useVersion()
  const [cart, setCart] = useState([]) // [{productId, qty}]
  const [customerId, setCustomerId] = useState(null)
  const [discountPct, setDiscountPct] = useState(0)
  const [staffOverride, setStaffOverride] = useState(null) // null = לפי הלקוח
  const [cat, setCat] = useState('__top')
  const [q, setQ] = useState('')
  const [picker, setPicker] = useState(false)
  const [cashModal, setCashModal] = useState(false)
  const [cam, setCam] = useState(false)
  const [recent, setRecent] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [creditOpen, setCreditOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const credit = creditStatus()

  const products = useMemo(() => list('product').filter((p) => p.active !== false), [v])
  const customer = customerId ? get('customer', customerId) : null
  const staff = staffOverride ?? !!customer?.isStaff

  const categories = useMemo(() => [...new Set(products.map((p) => p.category || 'כללי'))].sort(), [products])

  // מוצרים נפוצים — לפי 30 הימים האחרונים
  const topIds = useMemo(() => {
    const since = new Date(Date.now() - 30 * 864e5).toISOString()
    const cnt = new Map()
    for (const s of list('sale')) {
      if (s.voided || s.createdAt < since) continue
      for (const it of s.items) cnt.set(it.productId, (cnt.get(it.productId) || 0) + it.qty)
    }
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map((e) => e[0])
  }, [v])

  const shown = useMemo(() => {
    let arr = products
    if (q.trim()) {
      const s = q.trim().toLowerCase()
      arr = arr.filter((p) => p.name.toLowerCase().includes(s) || (p.barcode || '').includes(s))
    } else if (cat === '__top') {
      const byId = new Map(products.map((p) => [p.id, p]))
      const tops = topIds.map((id) => byId.get(id)).filter(Boolean)
      arr = tops.length ? tops : products
    } else if (cat !== '__all') arr = arr.filter((p) => (p.category || 'כללי') === cat)
    return cat === '__top' && !q ? arr : [...arr].sort((a, b) => a.name.localeCompare(b.name, 'he'))
  }, [products, cat, q, topIds])

  const lines = cart
    .map((c) => {
      const p = get('product', c.productId)
      if (!p) return null
      return { ...c, p, price: unitPrice(p, staff) }
    })
    .filter(Boolean)
  const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.price, 0))
  const discount = round2((subtotal * discountPct) / 100)
  const total = round2(subtotal - discount)
  const itemsCount = lines.reduce((s, l) => s + l.qty, 0)
  const balance = customer ? balanceOf(customer.id) : 0

  function add(p, n = 1) {
    setCart((c) => {
      const ex = c.find((x) => x.productId === p.id)
      if (ex) return c.map((x) => (x.productId === p.id ? { ...x, qty: x.qty + n } : x)).filter((x) => x.qty > 0)
      return n > 0 ? [...c, { productId: p.id, qty: n }] : c
    })
  }
  function selectCustomer(c) {
    setCustomerId(c?.id || null)
    setStaffOverride(null)
    setDiscountPct(c?.discountPct ? Number(c.discountPct) : 0)
    setPicker(false)
  }
  function clear() {
    setCart([])
    setCustomerId(null)
    setDiscountPct(0)
    setStaffOverride(null)
    setCartOpen(false)
  }

  function handleCode(code) {
    code = String(code).trim()
    const p = products.find((x) => x.barcode && x.barcode === code)
    if (p) {
      add(p)
      toast('➕ ' + p.name)
      return true
    }
    const c = list('customer').find((x) => x.card && String(x.card) === code)
    if (c) {
      selectCustomer(c)
      toast('👤 ' + c.name)
      return true
    }
    toast('לא נמצא ברקוד ' + code, 'err')
    return false
  }
  useBarcodeScanner(handleCode, !picker && !cashModal && !cam && !creditOpen && !terminalOpen)

  function items() {
    return lines.map((l) => ({ productId: l.p.id, name: l.p.name, qty: l.qty, price: l.price, cost: Number(l.p.cost) || 0 }))
  }
  function payWallet() {
    if (!customer) return setPicker(true)
    if (balance < total && !customer.allowNegative) {
      toast(`אין מספיק יתרה (${money(balance)})`, 'err')
      return
    }
    sell({ items: items(), customerId: customer.id, payment: 'wallet', discountPct, sellerId: user.id, staff })
    toast(`✓ ${customer.name} — נשארו ${money(balance - total)}`)
    clear()
  }
  function payCash(received) {
    sell({ items: items(), customerId: customer?.id || null, payment: 'cash', discountPct, sellerId: user.id, staff, received })
    const change = round2((received || total) - total)
    toast(change > 0 ? `✓ שולם. עודף: ${money(change)}` : '✓ שולם במזומן')
    setCashModal(false)
    clear()
  }

  function saleArgs(payment) {
    return { items: items(), customerId: customer?.id || null, payment, discountPct, sellerId: user.id, staff }
  }
  function payTerminal(t) {
    sell({ ...saleArgs('terminal'), extra: { terminal: t } })
    toast('✓ נרשם — שולם באשראי במסופון')
    setTerminalOpen(false)
    clear()
  }

  return (
    <div className="pos">
      <section className="pos-products">
        <div className="pos-search">
          <input
            placeholder="🔍 חיפוש מוצר / ברקוד…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q.trim()) {
                const exact = products.find((p) => p.barcode && p.barcode === q.trim())
                const card = list('customer').find((c) => c.card && String(c.card) === q.trim())
                if (exact || card) {
                  handleCode(q)
                  setQ('')
                } else if (shown.length === 1) {
                  add(shown[0])
                  setQ('')
                }
              }
            }}
          />
          {q && (
            <button className="icon-btn" onClick={() => setQ('')}>
              ✕
            </button>
          )}
          {cameraScanSupported && (
            <button className="btn" onClick={() => setCam(true)} title="סריקה במצלמה">
              📷
            </button>
          )}
        </div>
        <div className="cats">
          <button className={cat === '__top' ? 'on' : ''} onClick={() => setCat('__top')}>
            ⭐ נפוצים
          </button>
          <button className={cat === '__all' ? 'on' : ''} onClick={() => setCat('__all')}>
            הכל
          </button>
          {categories.map((c) => (
            <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        {products.length === 0 ? (
          <Empty>אין מוצרים עדיין. מנהל יכול להוסיף מוצרים במסך "מלאי".</Empty>
        ) : (
          <div className="grid">
            {shown.map((p) => {
              const st = stockOf(p.id)
              const inCart = cart.find((c) => c.productId === p.id)?.qty
              return (
                <button key={p.id} className="tile" onClick={() => add(p)}>
                  {inCart ? <span className="badge">{inCart}</span> : null}
                  <ProductThumb p={p} size={56} />
                  <span className="tile-name">{p.name}</span>
                  <span className="tile-price">{money(unitPrice(p, staff))}</span>
                  {st <= 0 ? <span className="stock-flag out">אזל</span> : st <= (Number(p.minStock) || 0) ? <span className="stock-flag low">{st}</span> : null}
                </button>
              )
            })}
          </div>
        )}
      </section>

      <button className="cart-fab" onClick={() => setCartOpen(true)}>
        🛒 {itemsCount} פריטים · {money(total)}
      </button>

      <section className={'pos-cart' + (cartOpen ? ' open' : '')}>
        <div className="cart-head">
          <button className="customer-box" onClick={() => setPicker(true)}>
            {customer ? (
              <>
                <b>👤 {customer.name}</b>
                <span className={balance < 0 ? 'neg' : balance < total ? 'warn' : 'pos-bal'}>יתרה: {money(balance)}</span>
              </>
            ) : (
              <span className="muted">👤 בחר בחור / סרוק כרטיס</span>
            )}
          </button>
          {customer && (
            <button className="icon-btn" onClick={() => selectCustomer(null)} title="הסר">
              ✕
            </button>
          )}
          <button className="icon-btn mobile-only" onClick={() => setCartOpen(false)}>
            ⌄
          </button>
        </div>

        <div className="cart-lines">
          {lines.length === 0 && <Empty>הקש על מוצר או סרוק ברקוד</Empty>}
          {lines.map((l) => (
            <div className="line" key={l.productId}>
              <ProductThumb p={l.p} size={36} />
              <div className="line-name">
                <b>{l.p.name}</b>
                <small>{money(l.price)} ליח׳</small>
              </div>
              <div className="qty">
                <button onClick={() => add(l.p, 1)}>+</button>
                <span>{l.qty}</span>
                <button onClick={() => add(l.p, -1)}>−</button>
              </div>
              <b className="line-total">{money(l.qty * l.price)}</b>
            </div>
          ))}
        </div>

        <div className="cart-foot">
          <div className="row wrap gap-s">
            <label className="chk">
              <input type="checkbox" checked={staff} onChange={(e) => setStaffOverride(e.target.checked)} />
              מחיר מוכרים
            </label>
            {can(user, 'discount') && (
              <div className="disc">
                הנחה:
                {DISCOUNTS.map((d) => (
                  <button key={d} className={discountPct === d ? 'on' : ''} onClick={() => setDiscountPct(d)}>
                    {d}%
                  </button>
                ))}
                <input
                  className={'disc-in' + (!DISCOUNTS.includes(discountPct) ? ' on' : '')}
                  type="number"
                  inputMode="numeric"
                  placeholder="%"
                  value={DISCOUNTS.includes(discountPct) ? '' : discountPct}
                  onChange={(e) => setDiscountPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                />
              </div>
            )}
          </div>
          {discount > 0 && (
            <div className="sum-row muted">
              <span>
                סכום {money(subtotal)} · הנחה {discountPct}%
              </span>
              <span>−{money(discount)}</span>
            </div>
          )}
          <div className="sum-row total">
            <span>לתשלום</span>
            <span>{money(total)}</span>
          </div>
          <div className="pay-btns">
            <button className="btn primary big" disabled={!lines.length} onClick={payWallet}>
              💳 מהארנק
            </button>
            <button className="btn green big" disabled={!lines.length} onClick={() => setCashModal(true)}>
              💵 מזומן
            </button>
          </div>
          <div className="pay-btns small-pay">
            {can(user, 'terminal') && (
              <button className="btn" disabled={!lines.length} onClick={() => setTerminalOpen(true)}>
                📟 אשראי במסופון
              </button>
            )}
            {credit.ok && (
              <button className="btn" disabled={!lines.length} onClick={() => setCreditOpen(true)}>
                💳 אשראי אונליין
              </button>
            )}
          </div>
          <div className="row gap-s">
            <button className="btn small grow" disabled={!lines.length && !customer} onClick={clear}>
              🗑 נקה
            </button>
            <button className="btn small grow" onClick={() => setRecent(true)}>
              🧾 מכירות אחרונות
            </button>
          </div>
        </div>
      </section>

      {picker && <CustomerPicker onPick={selectCustomer} onClose={() => setPicker(false)} />}
      {cashModal && <CashModal total={total} onPay={payCash} onClose={() => setCashModal(false)} />}
      {cam && (
        <CameraScanner
          onClose={() => setCam(false)}
          onCode={(c) => {
            setCam(false)
            handleCode(c)
          }}
        />
      )}
      {recent && <RecentSales user={user} onClose={() => setRecent(false)} />}
      {creditOpen && (
        <CreditModal
          title="תשלום באשראי"
          amount={total}
          purpose="sale"
          customerId={customer?.id}
          user={user}
          comment={'מזנון: ' + lines.map((l) => l.p.name + (l.qty > 1 ? '×' + l.qty : '')).join(', ')}
          buildOps={() => buildSale({ ...saleArgs('credit') }).ops}
          onPaid={() => {
            toast('✓ שולם באשראי')
            clear()
          }}
          onClose={() => setCreditOpen(false)}
        />
      )}
      {terminalOpen && <TerminalModal amount={total} defaultPhone={customer?.phone || ''} onConfirm={payTerminal} onClose={() => setTerminalOpen(false)} />}
    </div>
  )
}

export function CustomerPicker({ onPick, onClose }) {
  useVersion()
  const [q, setQ] = useState('')
  const all = list('customer').filter((c) => c.active !== false)
  const s = q.trim()
  const shown = (s ? all.filter((c) => c.name.includes(s) || String(c.card || '') === s || (c.group || '').includes(s)) : all).sort((a, b) =>
    a.name.localeCompare(b.name, 'he')
  )
  useBarcodeScanner((code) => {
    const c = all.find((x) => String(x.card) === String(code))
    if (c) onPick(c)
    else toast('כרטיס לא מוכר', 'err')
  })
  return (
    <Modal title="בחירת בחור" onClose={onClose}>
      <input
        autoFocus
        className="big-input"
        placeholder="שם / מספר כרטיס / שיעור — או סרוק כרטיס"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const exact = all.find((c) => String(c.card) === s)
            if (exact) onPick(exact)
            else if (shown.length === 1) onPick(shown[0])
          }
        }}
      />
      <div className="pick-list">
        {shown.map((c) => {
          const b = balanceOf(c.id)
          return (
            <button key={c.id} className="pick" onClick={() => onPick(c)}>
              <span>
                <b>{c.name}</b> {c.isStaff && <span className="tag">מוכר</span>}
                <small className="muted"> {c.group}</small>
              </span>
              <span className={b < 0 ? 'neg' : 'pos-bal'}>{money(b)}</span>
            </button>
          )
        })}
        {!shown.length && <Empty>לא נמצא</Empty>}
      </div>
      <button className="btn grow" onClick={() => onPick(null)}>
        ללא בחור (קונה מזדמן)
      </button>
    </Modal>
  )
}

function CashModal({ total, onPay, onClose }) {
  const [rec, setRec] = useState('')
  const r = Number(rec) || 0
  const change = round2(r - total)
  const quick = [...new Set([total, Math.ceil(total / 5) * 5, Math.ceil(total / 10) * 10, 20, 50, 100, 200])].filter((x) => x >= total).slice(0, 6)
  return (
    <Modal title={'תשלום במזומן — ' + money(total)} onClose={onClose} small>
      <div className="quick">
        {quick.map((x) => (
          <button key={x} className={'btn' + (r === x ? ' primary' : '')} onClick={() => setRec(String(x))}>
            {money(x)}
          </button>
        ))}
      </div>
      <input className="big-input" type="number" inputMode="decimal" placeholder="סכום שהתקבל" value={rec} onChange={(e) => setRec(e.target.value)} autoFocus />
      {r > 0 && (
        <div className={'change ' + (change < 0 ? 'neg' : '')}>{change < 0 ? `חסר ${money(-change)}` : `עודף: ${money(change)}`}</div>
      )}
      <button className="btn green big grow" disabled={r > 0 && change < 0} onClick={() => onPay(r || total)}>
        ✓ אישור תשלום
      </button>
    </Modal>
  )
}

function RecentSales({ user, onClose }) {
  useVersion()
  const [all, setAll] = useState(false)
  const dev = deviceId()
  const users = new Map(list('user').map((u) => [u.id, u.name]))
  const sales = list('sale')
    .filter((s) => all || s.device === dev)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 40)
  async function doVoid(s) {
    const extra =
      s.payment === 'credit'
        ? ' ⚠ שולם באשראי — את הזיכוי בכרטיס צריך לעשות בנדרים פלוס.'
        : s.payment === 'terminal'
          ? ' ⚠ שולם באשראי במסופון — את הזיכוי צריך לעשות במסופון / בנדרים.'
          : ''
    if (!(await confirmDlg(`לבטל מכירה של ${money(s.total)}? המלאי יעודכן${s.payment === 'wallet' ? ' והכסף יחזור לארנק' : ''}.${extra}`, 'בטל מכירה'))) return
    voidSale(s, user.id)
    toast('המכירה בוטלה')
  }
  return (
    <Modal title="מכירות אחרונות" onClose={onClose} wide>
      <label className="chk">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> הצג מכל המכשירים
      </label>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>שעה</th>
              <th>פריטים</th>
              <th>בחור</th>
              <th>תשלום</th>
              <th>סכום</th>
              <th>מוכר</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id} className={s.voided ? 'voided' : ''}>
                <td>
                  {fmtTime(s.createdAt)}
                  <br />
                  <small className="muted">{new Date(s.createdAt).toLocaleDateString('he-IL')}</small>
                </td>
                <td>{s.items.map((i) => `${i.name}${i.qty > 1 ? ' ×' + i.qty : ''}`).join(', ')}</td>
                <td>{s.customerId ? get('customer', s.customerId)?.name || '—' : '—'}</td>
                <td>
                  {paymentLabel(s.payment)}
                  {s.payment === 'credit' && !s.verified && <small className="warn"> (ממתין לאישור)</small>}
                  {s.terminal && (
                    <small className="muted">
                      {' '}
                      אישור {s.terminal.confirmation} · {s.terminal.phone}
                    </small>
                  )}
                </td>
                <td>
                  <b>{money(s.total)}</b>
                  {s.discount > 0 && <small className="muted"> ({s.discountPct}%−)</small>}
                </td>
                <td>{users.get(s.sellerId) || '—'}</td>
                <td>
                  {s.voided ? (
                    <small className="neg">בוטל ע״י {users.get(s.voided.by) || ''}</small>
                  ) : can(user, 'void') ? (
                    <button className="btn small danger" onClick={() => doVoid(s)}>
                      ביטול
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!sales.length && <Empty>אין מכירות</Empty>}
      </div>
    </Modal>
  )
}
