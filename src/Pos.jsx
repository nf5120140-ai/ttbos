import { useEffect, useMemo, useState } from 'react'
import { publishDisplay, listenHello } from './display.js'
import { openDrawer, openDrawerManual, drawerCfg } from './drawer.js'
import { list, get, getSetting, uid, sameCode, productHasCode, productCodes, balanceOf, stockOf, sell, buildSale, voidSale, deviceId, round2 } from './db.js'
import { CreditModal, TerminalModal, creditStatus, paymentLabel } from './Credit.jsx'
import { VerifyStaffModal, staffMethodLabel } from './Staff.jsx'
import { priceCart, unitPromoFor, bundlesFor, staffUnit, livePromos, promoLabel } from './pricing.js'
import {
  useVersion,
  money,
  fmtTime,
  can,
  toast,
  confirmDlg,
  Modal,
  Field,
  ProductThumb,
  useBarcodeScanner,
  useScanField,
  cameraScanSupported,
  CameraScanner,
  Empty,
} from './ui.jsx'


// פריט כללי — בלי מלאי, בלי מבצעים ובלי הנחת עובד; המחיר שהוקלד הוא המחיר
function genProduct(c) {
  return { id: c.productId, name: c.gen.name, price: c.gen.price, staffPrice: c.gen.price, emoji: '✏️', general: true, cost: 0 }
}

function GeneralItemModal({ onClose, onAdd }) {
  const [amt, setAmt] = useState('')
  const [name, setName] = useState('')
  const [qty, setQty] = useState(1)
  const price = round2(Number(amt) || 0)
  const press = (k) =>
    setAmt((a) => {
      if (k === 'C') return ''
      if (k === '⌫') return a.slice(0, -1)
      if (k === '.' && a.includes('.')) return a
      if (/\.\d\d$/.test(a)) return a
      const n = (a === '0' && k !== '.' ? '' : a) + k
      return n.length > 7 ? a : n
    })
  const ok = () => price > 0 && onAdd(name.trim() || 'פריט כללי', price, Math.max(1, qty))
  return (
    <Modal title="✏️ פריט כללי" onClose={onClose} small>
      <div className="gen-amt" dir="ltr">₪{amt || '0'}</div>
      <div className="gen-pad">
        {['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'].map((k) => (
          <button key={k} className="btn" onClick={() => press(k)}>
            {k}
          </button>
        ))}
      </div>
      <div className="row gap-s" style={{ marginTop: 8 }}>
        {[5, 10, 20, 50].map((x) => (
          <button key={x} className="btn grow small" onClick={() => setAmt(String(x))}>
            ₪{x}
          </button>
        ))}
      </div>
      <Field label="תיאור (לא חובה)">
        <input
          value={name}
          placeholder="פריט כללי"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ok()}
        />
      </Field>
      <div className="row gap-s" style={{ alignItems: 'center' }}>
        <span>כמות</span>
        <div className="qty">
          <button onClick={() => setQty((q) => q + 1)}>+</button>
          <span>{qty}</span>
          <button onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
        </div>
      </div>
      <button className="btn primary big" style={{ width: '100%', marginTop: 12 }} disabled={!(price > 0)} onClick={ok}>
        הוסף לסל {price > 0 ? money(price * qty) : ''}
      </button>
    </Modal>
  )
}

export default function Pos({ user }) {
  const v = useVersion()
  const [cart, setCart] = useState([]) // [{productId, qty}] — פריט כללי: {productId:'gen:..', qty, gen:{name, price}}
  const [genOpen, setGenOpen] = useState(false)
  const [customerId, setCustomerId] = useState(null)
  const [staffAuth, setStaffAuth] = useState(null) // {buyerId, method, approvedBy} — מחיר מוכרים מאומת
  const [verifyFor, setVerifyFor] = useState(null) // {targetUserId}
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
  const staff = !!staffAuth

  const categories = useMemo(() => [...new Set(products.filter((p) => p.showInPos !== false).map((p) => p.category || 'כללי'))].sort(), [products])

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
    let arr = products.filter((p) => p.showInPos !== false) // כפתורים — רק מוצרים שנבחרו; סריקה וחיפוש מוצאים הכול
    if (q.trim()) {
      arr = products
      const s = q.trim().toLowerCase()
      arr = arr.filter((p) => p.name.toLowerCase().includes(s) || productCodes(p).some((c) => c.includes(s)))
    } else if (cat === '__top') {
      const byId = new Map(products.map((p) => [p.id, p]))
      const tops = topIds.map((id) => byId.get(id)).filter((p) => p && p.showInPos !== false)
      arr = tops.length ? tops : arr
    } else if (cat !== '__all') arr = arr.filter((p) => (p.category || 'כללי') === cat)
    return cat === '__top' && !q ? arr : [...arr].sort((a, b) => a.name.localeCompare(b.name, 'he'))
  }, [products, cat, q, topIds])

  // הנחת עובד — לפי ההגדרה של העובד המאומת. הנחה קבועה של בחור — לפי הגדרת הבחור.
  const staffPct = staffAuth ? Number(get('user', staffAuth.buyerId)?.staffDiscountPct) || 0 : 0
  const customerPct = Number(customer?.discountPct) || 0
  const promos = useMemo(() => livePromos(), [v])
  const priced = priceCart(
    cart.map((c) => ({ ...c, p: c.gen ? genProduct(c) : get('product', c.productId) })).filter((l) => l.p),
    { staff, staffPct, customerPct }
  )
  const lines = priced.lines.map((l) => ({ ...l, price: l.unit }))
  const discountPct = priced.customerPct
  const total = priced.total
  const saving = round2(priced.regularTotal - total)
  const itemsCount = lines.reduce((s, l) => s + l.qty, 0)
  const balance = customer ? balanceOf(customer.id) : 0

  // ---- מסך לקוח ----
  useEffect(() => listenHello(), [])
  const dispTitle = getSetting('general').title || ''
  useEffect(() => {
    const cust = customer ? { name: customer.name, balance } : null
    if (!lines.length) return publishDisplay({ state: 'idle', title: dispTitle, customer: cust })
    publishDisplay({
      state: 'cart',
      title: dispTitle,
      customer: cust,
      lines: lines.map((l) => ({ name: l.p.name, emoji: l.p.emoji || '', qty: l.qty, unit: l.unit, sum: round2(l.unit * l.qty), promo: l.promoName || '' })),
      total,
      saving,
      count: itemsCount,
    })
  }, [JSON.stringify(cart), customerId, total, balance, dispTitle])
  function thanks(extra = {}) {
    const c = customer ? { name: customer.name, balance: balanceOf(customer.id) } : null
    publishDisplay({ state: 'thanks', title: dispTitle, total, customer: extra.wallet ? c : null, change: extra.change || 0 })
  }

  function add(p, n = 1) {
    setCart((c) => {
      const ex = c.find((x) => x.productId === p.id)
      if (ex) return c.map((x) => (x.productId === p.id ? { ...x, qty: x.qty + n } : x)).filter((x) => x.qty > 0)
      return n > 0 ? [...c, { productId: p.id, qty: n }] : c
    })
  }
  function selectCustomer(c) {
    setCustomerId(c?.id || null)
    setStaffAuth(null)
    if (c?.isStaff) {
      // המוכר המחובר קונה לעצמו — כבר מזוהה. אחרת — צריך אימות של הקונה
      if (c.userId && c.userId === user.id) setStaffAuth({ buyerId: user.id, method: 'self', approvedBy: user.id })
      else setVerifyFor({ targetUserId: c.userId || null })
    }
    setPicker(false)
  }
  function clear() {
    setCart([])
    setCustomerId(null)
    setStaffAuth(null)
    setCartOpen(false)
  }

  function handleCode(code) {
    code = String(code).trim()
    const p = products.find((x) => productHasCode(x, code))
    if (p) {
      add(p)
      toast('➕ ' + p.name)
      return true
    }
    const c = list('customer').find((x) => sameCode(x.card, code))
    if (c) {
      selectCustomer(c)
      toast('👤 ' + c.name)
      return true
    }
    toast('לא נמצא ברקוד ' + code, 'err')
    return false
  }
  const scanField = useScanField(q, setQ, handleCode)
  useBarcodeScanner(handleCode, !picker && !cashModal && !cam && !creditOpen && !terminalOpen && !verifyFor && !genOpen)

  function items() {
    return lines.map((l) => ({
      productId: l.p.general ? 'general' : l.p.id,
      name: l.p.name,
      ...(l.p.general ? { general: true } : {}),
      qty: l.qty,
      price: l.unit,
      regularPrice: l.regular,
      cost: Number(l.p.cost) || 0,
      ...(l.p.general ? {} : { category: l.p.category || '', barcode: l.p.barcode || '' }),
      ...(l.promoId ? { promoId: l.promoId, promoName: l.promoName } : {}),
      ...(l.staffApplied ? { staffApplied: true } : {}),
    }))
  }
  function payWallet() {
    if (!customer) return setPicker(true)
    if (balance < total && !customer.allowNegative) {
      toast(`אין מספיק יתרה (${money(balance)})`, 'err')
      return
    }
    sell({ ...saleArgs('wallet') })
    thanks({ wallet: true })
    toast(`✓ ${customer.name} — נשארו ${money(balance - total)}`)
    clear()
  }
  function payCash(received) {
    sell({ ...saleArgs('cash'), received })
    openDrawer() // מגירת כסף — רק במזומן
    const change = round2((received || total) - total)
    thanks({ change })
    toast(change > 0 ? `✓ שולם. עודף: ${money(change)}` : '✓ שולם במזומן')
    setCashModal(false)
    clear()
  }

  function saleArgs(payment, extra = {}) {
    return {
      items: items(),
      customerId: customer?.id || null,
      payment,
      discountPct,
      sellerId: user.id,
      staff: staff && !priced.staffFallback,
      promoDiscounts: priced.promoDiscounts.map(({ promoId, name, amount }) => ({ promoId, name, amount })),
      extra: { ...(staffAuth ? { staffAuth: { ...staffAuth, pct: staffPct } } : {}), ...extra },
    }
  }
  function payTerminal(t) {
    sell(saleArgs('terminal', { terminal: t }))
    thanks()
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
            onChange={scanField.onChange}
            onKeyDown={(e) => {
              if (scanField.onKeyDown(e)) return
              if (e.key === 'Enter' && q.trim()) {
                const exact = products.find((p) => productHasCode(p, q))
                const card = list('customer').find((c) => sameCode(c.card, q))
                if (exact || card) {
                  handleCode(q)
                  setQ('')
                } else if (shown.length === 1) {
                  add(shown[0])
                  setQ('')
                } else if (/^\d{6,}$/.test(q.trim())) {
                  handleCode(q)
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
          <button className="btn" onClick={() => setGenOpen(true)} title="פריט כללי — מקלידים סכום">
            ✏️ פריט כללי
          </button>
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
                  {(() => {
                    const up = unitPromoFor(p, promos)
                    const su = staff ? staffUnit(p, staffPct) : null
                    const unit = Math.min(up ? up.unit : Number(p.price), su ?? Infinity)
                    const bund = bundlesFor(p, promos)
                    return (
                      <>
                        <span className="tile-price">
                          {unit < Number(p.price) && <s className="tile-old">{money(p.price)}</s>} {money(unit)}
                        </span>
                        {(up || bund.length > 0) && <span className="promo-flag">{up ? promoLabel(up.promo) : promoLabel(bund[0])}</span>}
                      </>
                    )
                  })()}
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
                <small>
                  {l.unit < l.regular && <s className="muted">{money(l.regular)}</s>} {money(l.unit)} ליח׳
                  {l.promoName && <span className="promo-tag"> 🏷 {l.promoName}</span>}
                  {l.staffApplied && <span className="promo-tag"> 🔐 עובד</span>}
                </small>
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
              <input
                type="checkbox"
                checked={staff}
                onChange={(e) => (e.target.checked ? setVerifyFor({ targetUserId: customer?.isStaff ? customer.userId || null : null }) : setStaffAuth(null))}
              />
              מחיר מוכרים
              {staffAuth && (
                <small className="muted">
                  {' '}
                  ✓ {get('user', staffAuth.buyerId)?.name}
                  {staffPct ? ` · ${staffPct}%` : ''}
                </small>
              )}
            </label>
          </div>
          {priced.promoDiscounts.map((d) => (
            <div className="sum-row promo-row" key={d.promoId}>
              <span>
                🏷 {d.name}
                {d.groups > 1 ? ` ×${d.groups}` : ''}
              </span>
              <span>−{money(d.amount)}</span>
            </div>
          ))}
          {priced.customerDiscount > 0 && (
            <div className="sum-row muted">
              <span>הנחה קבועה {discountPct}%</span>
              <span>−{money(priced.customerDiscount)}</span>
            </div>
          )}
          {saving > 0 && <div className="saving">חסכת {money(saving)} 🎉</div>}
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
            {drawerCfg().enabled && can(user, 'drawer') && (
              <button
                className="btn small grow"
                onClick={async () => {
                  const ok = await openDrawerManual(user)
                  toast(ok ? '🔓 המגירה נפתחה (נרשם)' : 'לא הצלחתי לפתוח את המגירה — בדוק בהגדרות', ok ? undefined : 'err')
                }}
              >
                🔓 פתח מגירה
              </button>
            )}
          </div>
        </div>
      </section>

      {picker && <CustomerPicker onPick={selectCustomer} onClose={() => setPicker(false)} />}
      {genOpen && (
        <GeneralItemModal
          onClose={() => setGenOpen(false)}
          onAdd={(name, price, qty) => {
            setCart((c) => [...c, { productId: 'gen:' + uid(), qty, gen: { name, price } }])
            toast('➕ ' + name + ' ' + money(price * qty))
            setGenOpen(false)
          }}
        />
      )}
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
            thanks()
            toast('✓ שולם באשראי')
            clear()
          }}
          onClose={() => setCreditOpen(false)}
        />
      )}
      {verifyFor && (
        <VerifyStaffModal
          targetUserId={verifyFor.targetUserId}
          onOk={(a) => {
            setStaffAuth(a)
            setVerifyFor(null)
            toast('✓ מחיר מוכרים — ' + (get('user', a.buyerId)?.name || ''))
          }}
          onCancel={() => setVerifyFor(null)}
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
                <td>
                  {s.customerId ? get('customer', s.customerId)?.name || '—' : '—'}
                  {s.staffAuth && <small className="tag"> מחיר מוכרים: {users.get(s.staffAuth.buyerId)}</small>}
                </td>
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
                  {s.discount > 0 && <small className="muted"> (הנחה {money(s.discount)})</small>}
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
