import { useEffect, useMemo, useState } from 'react'
import Receive from './Receive.jsx'
import { retryTempNames, approveName, lookupBarcode } from './lookup.js'
import { list, get, save, remove, productCodes, sameCode, splitCodes, balanceOf, stockOf, topup, buildTopup, voidTopup, receiveStock, setStockTo, round2, getSetting } from './db.js'
import { CreditModal, TerminalModal, creditStatus } from './Credit.jsx'
import { InvoiceIntake } from './Invoice.jsx'
import { PriceList } from './PriceList.jsx'
import { Promos } from './Promos.jsx'
import { ImportProducts, exportProducts } from './ImportProducts.jsx'
import {
  useVersion,
  money,
  fmtDT,
  fmtDate,
  can,
  toast,
  confirmDlg,
  Modal,
  Field,
  Toggle,
  Empty,
  ProductThumb,
  waLink,
  resizeImage,
  cameraScanSupported,
  CameraScanner,
  downloadFile,
  toCsv,
} from './ui.jsx'

// ============================================================
// ארנקים — בחורים ויתרות
// ============================================================
export function Customers({ user }) {
  const v = useVersion()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)
  const [top, setTop] = useState(null)
  const [hist, setHist] = useState(null)
  const [filter, setFilter] = useState('all')
  const all = useMemo(() => list('customer'), [v])
  const shown = all
    .filter((c) => (filter === 'inactive' ? c.active === false : c.active !== false))
    .filter((c) => filter !== 'low' || balanceOf(c.id) < 20)
    .filter((c) => !q || c.name.includes(q) || String(c.card || '') === q || (c.group || '').includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'))
  const totalBal = round2(all.filter((c) => c.active !== false).reduce((s, c) => s + balanceOf(c.id), 0))

  function exportCsv() {
    downloadFile(
      'yitrot.csv',
      toCsv([['שם', 'שיעור', 'כרטיס', 'טלפון הורים', 'יתרה'], ...shown.map((c) => [c.name, c.group, c.card, c.parentPhone, balanceOf(c.id)])])
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>ארנקים</h2>
        <div className="row gap-s wrap">
          <span className="pill">סה״כ יתרות: {money(totalBal)}</span>
          <button className="btn" onClick={exportCsv}>
            ⬇ אקסל
          </button>
          <button className="btn primary" onClick={() => setEdit({ active: true })}>
            + בחור חדש
          </button>
        </div>
      </div>
      <div className="toolbar">
        <input placeholder="🔍 שם / כרטיס / שיעור" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">פעילים</option>
          <option value="low">יתרה נמוכה (פחות מ-₪20)</option>
          <option value="inactive">לא פעילים</option>
        </select>
      </div>
      <div className="cards">
        {shown.map((c) => {
          const b = balanceOf(c.id)
          return (
            <div className="card cust" key={c.id}>
              <div className="cust-top" onClick={() => setHist(c)}>
                <div>
                  <b>{c.name}</b> {c.isStaff && <span className="tag">מוכר</span>}
                  <div className="muted small">
                    {c.group} {c.card && '· כרטיס ' + c.card}
                  </div>
                </div>
                <div className={'bal ' + (b < 0 ? 'neg' : b < 20 ? 'warn' : 'pos-bal')}>{money(b)}</div>
              </div>
              <div className="row gap-s">
                {can(user, 'topup') && (
                  <button className="btn green small grow" onClick={() => setTop(c)}>
                    + טעינה
                  </button>
                )}
                <button className="btn small grow" onClick={() => setHist(c)}>
                  היסטוריה
                </button>
                {user.role === 'manager' && (
                  <button className="btn small" onClick={() => setEdit(c)}>
                    ✎
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {!shown.length && <Empty>אין בחורים להצגה</Empty>}
      {edit && <CustomerEditor c={edit} onClose={() => setEdit(null)} />}
      {top && <TopupModal c={top} user={user} onClose={() => setTop(null)} />}
      {hist && <CustomerHistory c={hist} user={user} onClose={() => setHist(null)} onTopup={() => setTop(hist)} />}
    </div>
  )
}

function CustomerEditor({ c, onClose }) {
  const [f, setF] = useState({ discountPct: 0, ...c })
  const [cam, setCam] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e })
  function ok() {
    if (!f.name?.trim()) return toast('חסר שם', 'err')
    if (f.card && list('customer').some((x) => x.id !== f.id && String(x.card) === String(f.card))) return toast('מספר כרטיס כבר קיים', 'err')
    save('customer', { ...f, name: f.name.trim(), discountPct: Number(f.discountPct) || 0 })
    toast('נשמר')
    onClose()
  }
  async function del() {
    if (balanceOf(c.id) !== 0 && !(await confirmDlg(`לבחור יש יתרה של ${money(balanceOf(c.id))}. למחוק בכל זאת?`, 'מחק'))) return
    if (!(await confirmDlg('למחוק את ' + c.name + '?', 'מחק'))) return
    remove('customer', c.id)
    onClose()
  }
  return (
    <Modal title={c.id ? 'עריכת בחור' : 'בחור חדש'} onClose={onClose}>
      <div className="form-grid">
        <Field label="שם מלא">
          <input value={f.name || ''} onChange={set('name')} autoFocus />
        </Field>
        <Field label="שיעור / קבוצה">
          <input value={f.group || ''} onChange={set('group')} list="groups" />
          <datalist id="groups">
            {[...new Set(list('customer').map((x) => x.group).filter(Boolean))].map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>
        <Field label="מספר כרטיס / ברקוד" hint="לסריקה מהירה בקופה">
          <div className="row gap-s">
            <input value={f.card || ''} onChange={set('card')} />
            {cameraScanSupported && (
              <button className="btn" onClick={() => setCam(true)}>
                📷
              </button>
            )}
          </div>
        </Field>
        <Field label="טלפון הורים (לוואטסאפ)">
          <input value={f.parentPhone || ''} onChange={set('parentPhone')} inputMode="tel" />
        </Field>
        <Field label="הנחה קבועה %">
          <input type="number" value={f.discountPct} onChange={set('discountPct')} />
        </Field>
      </div>
      <Toggle checked={f.isStaff} onChange={set('isStaff')} label="מוכר במזנון (מקבל מחיר מוכרים)" />
      {f.isStaff && (
        <Field label="המשתמש שלו בקופה (לאימות בקוד / באצבע)" hint="כשהוא קונה — יתבקש הקוד האישי שלו">
          <select value={f.userId || ''} onChange={set('userId')}>
            <option value="">— לא מקושר (יבחרו בזמן הקנייה) —</option>
            {list('user')
              .filter((u) => u.active !== false)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      <Toggle checked={f.allowNegative} onChange={set('allowNegative')} label="מותר לרדת למינוס" />
      <Toggle checked={f.active !== false} onChange={(x) => setF({ ...f, active: x })} label="פעיל" />
      <div className="row gap modal-actions">
        <button className="btn primary grow" onClick={ok}>
          שמור
        </button>
        {c.id && (
          <button className="btn danger" onClick={del}>
            מחק
          </button>
        )}
      </div>
      {cam && (
        <CameraScanner
          onClose={() => setCam(false)}
          onCode={(x) => {
            setF((p) => ({ ...p, card: x }))
            setCam(false)
          }}
        />
      )}
    </Modal>
  )
}

function TopupModal({ c, user, onClose }) {
  const [amt, setAmt] = useState('')
  const [method, setMethod] = useState('cash')
  const [note, setNote] = useState('')
  const [step, setStep] = useState(null) // null | credit | terminal
  const credit = creditStatus()
  const a = Number(amt)
  function ok() {
    if (!a || a <= 0) return toast('הכנס סכום', 'err')
    if (method === 'credit') {
      if (!credit.ok) return toast(credit.why, 'err')
      return setStep('credit')
    }
    if (method === 'terminal') return setStep('terminal')
    topup(c.id, a, method, user.id, note)
    toast(`נטען ${money(a)} ל${c.name}`)
    onClose()
  }
  if (step === 'credit')
    return (
      <CreditModal
        title={'טעינת ארנק באשראי — ' + c.name}
        amount={a}
        purpose="topup"
        customerId={c.id}
        user={user}
        comment={'טעינת ארנק ' + c.name}
        buildOps={() => [buildTopup(c.id, a, 'credit', user.id, note)]}
        onPaid={() => toast(`✓ נטען ${money(a)} ל${c.name}`)}
        onClose={onClose}
      />
    )
  if (step === 'terminal')
    return (
      <TerminalModal
        amount={a}
        defaultPhone={c.parentPhone || ''}
        onClose={() => setStep(null)}
        onConfirm={(t) => {
          topup(c.id, a, 'terminal', user.id, note, { terminal: t })
          toast(`נטען ${money(a)} ל${c.name}`)
          onClose()
        }}
      />
    )
  return (
    <Modal title={'טעינת ארנק — ' + c.name} onClose={onClose} small>
      <p className="muted">יתרה נוכחית: {money(balanceOf(c.id))}</p>
      <div className="quick">
        {[20, 50, 100, 150, 200, 300].map((x) => (
          <button key={x} className={'btn' + (a === x ? ' primary' : '')} onClick={() => setAmt(String(x))}>
            {money(x)}
          </button>
        ))}
      </div>
      <input className="big-input" type="number" inputMode="decimal" placeholder="סכום" value={amt} onChange={(e) => setAmt(e.target.value)} />
      <div className="seg">
        {[
          ['cash', '💵 מזומן'],
          creditStatus().ok && ['credit', '💳 אשראי אונליין'],
          can(user, 'terminal') && ['terminal', '📟 אשראי במסופון'],
          ['transfer', '🏦 העברה / ביט'],
          ['office', '🏢 דרך המשרד'],
        ]
          .filter(Boolean)
          .map(([k, l]) => (
            <button key={k} className={method === k ? 'on' : ''} onClick={() => setMethod(k)}>
              {l}
            </button>
          ))}
      </div>
      {method === 'credit' && !credit.ok && <small className="err">{credit.why}</small>}
      <input placeholder="הערה (לא חובה)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn green big grow" onClick={ok}>
        {method === 'credit' ? 'המשך לתשלום באשראי' : method === 'terminal' ? 'המשך — פרטי העסקה' : '✓ טען'}
      </button>
    </Modal>
  )
}

const METHOD = { cash: 'מזומן', transfer: 'העברה/ביט', office: 'משרד', credit: 'אשראי אונליין', terminal: 'אשראי במסופון' }
const TXT = { topup: 'טעינה', purchase: 'קנייה', refund: 'החזר (ביטול)', topup_void: 'ביטול טעינה', adjust: 'תיקון' }

function CustomerHistory({ c, user, onClose, onTopup }) {
  useVersion()
  const users = new Map(list('user').map((u) => [u.id, u.name]))
  const txs = list('wallet')
    .filter((w) => w.customerId === c.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const b = balanceOf(c.id)
  function sendParent() {
    const lines = txs
      .slice(0, 15)
      .map((t) => {
        const s = t.type === 'purchase' ? get('sale', t.ref) : null
        const what = s ? s.items.map((i) => i.name + (i.qty > 1 ? '×' + i.qty : '')).join(', ') : TXT[t.type]
        return `${fmtDate(t.createdAt)} ${what} ${t.amount > 0 ? '+' : ''}${t.amount}`
      })
      .join('\n')
    const text = `שלום, דו״ח מזנון עבור ${c.name}\nיתרה נוכחית: ${money(b)}\n\nתנועות אחרונות:\n${lines}`
    window.open(waLink(c.parentPhone, text), '_blank')
  }
  function sendLink() {
    const link = location.origin + '/?topup=' + c.id
    const text = `שלום, זה קישור לטעינת הארנק של ${c.name} במזנון (תשלום מאובטח באשראי דרך נדרים פלוס):\n${link}`
    if (c.parentPhone) window.open(waLink(c.parentPhone, text), '_blank')
    else {
      navigator.clipboard?.writeText(link).then(
        () => toast('הקישור הועתק'),
        () => prompt('העתק את הקישור', link)
      )
    }
  }
  async function vt(t) {
    const extra = t.method === 'credit' ? ' ⚠ את הזיכוי בכרטיס צריך לעשות בנדרים פלוס.' : t.method === 'terminal' ? ' ⚠ את הזיכוי צריך לעשות במסופון.' : ''
    if (!(await confirmDlg(`לבטל טעינה של ${money(t.amount)}?${extra}`, 'בטל טעינה'))) return
    voidTopup(t, user.id)
  }
  return (
    <Modal title={c.name} onClose={onClose} wide>
      <div className="row gap wrap space">
        <div className={'bal big ' + (b < 0 ? 'neg' : 'pos-bal')}>{money(b)}</div>
        <div className="row gap-s">
          {can(user, 'topup') && (
            <button
              className="btn green"
              onClick={() => {
                onClose()
                onTopup()
              }}
            >
              + טעינה
            </button>
          )}
          {c.parentPhone && (
            <button className="btn" onClick={sendParent}>
              📲 שלח דו״ח להורים
            </button>
          )}
          {creditStatus().ok && getSetting('nedarim').parentLinks !== false && (
            <button className="btn" onClick={sendLink}>
              🔗 קישור טעינה באשראי
            </button>
          )}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>תאריך</th>
              <th>פעולה</th>
              <th>פירוט</th>
              <th>סכום</th>
              <th>ע״י</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {txs.map((t) => {
              const s = t.type === 'purchase' || t.type === 'refund' ? get('sale', t.ref) : null
              return (
                <tr key={t.id} className={t.voided ? 'voided' : ''}>
                  <td>{fmtDT(t.createdAt)}</td>
                  <td>{TXT[t.type] || t.type}</td>
                  <td>
                    {s ? s.items.map((i) => i.name + (i.qty > 1 ? ' ×' + i.qty : '')).join(', ') : METHOD[t.method] || ''}
                    {t.method === 'credit' && t.type === 'topup' && !t.verified && <small className="warn"> (ממתין לאישור)</small>}
                    {t.terminal && <small className="muted"> אישור {t.terminal.confirmation} · {t.terminal.phone}</small>}
                    {t.note ? ' · ' + t.note : ''}
                  </td>
                  <td className={t.amount < 0 ? 'neg' : 'pos-bal'}>
                    <b>{money(t.amount)}</b>
                  </td>
                  <td>{users.get(t.userId) || ''}</td>
                  <td>
                    {t.type === 'topup' && !t.voided && can(user, 'void') && (
                      <button className="btn small danger" onClick={() => vt(t)}>
                        ביטול
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!txs.length && <Empty>אין תנועות</Empty>}
      </div>
    </Modal>
  )
}

// ============================================================
// מלאי ומוצרים
// ============================================================
export function Inventory({ user }) {
  const v = useVersion()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('active')
  const [edit, setEdit] = useState(null)
  const [recv, setRecv] = useState(null)
  const [countMode, setCountMode] = useState(false)
  const [invoice, setInvoice] = useState(false)
  const [priceList, setPriceList] = useState(false)
  const [promos, setPromos] = useState(false)
  const [importing, setImporting] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [scanMode, setScanMode] = useState(false)
  const [miss, setMiss] = useState(null) // מסנן "חסר מידע"
  const [sel, setSel] = useState(() => new Set())
  const [counts, setCounts] = useState({})
  const products = useMemo(() => list('product'), [v])
  const suppliers = new Map(list('supplier').map((s) => [s.id, s.name]))
  useEffect(() => {
    retryTempNames()
  }, [])
  const missCounts = useMemo(() => {
    const act = products.filter((p) => p.active !== false)
    const o = {}
    for (const m of MISSING) o[m.key] = act.filter((p) => m.test(p)).length
    return o
  }, [products, v])
  const missDef = MISSING.find((m) => m.key === miss)
  const shown = products
    .filter((p) => (filter === 'inactive' ? p.active === false : p.active !== false))
    .filter((p) => !missDef || missDef.test(p))
    .filter((p) => filter !== 'low' || stockOf(p.id) <= (Number(p.minStock) || 0))
    .filter((p) => !q || p.name.includes(q) || productCodes(p).some((c) => c.includes(q)) || (p.category || '').includes(q))
    .sort((a, b) => (a.category || '').localeCompare(b.category || '', 'he') || a.name.localeCompare(b.name, 'he'))
  const lowCount = products.filter((p) => p.active !== false && stockOf(p.id) <= (Number(p.minStock) || 0)).length
  const stockValue = round2(products.filter((p) => p.active !== false).reduce((s, p) => s + Math.max(0, stockOf(p.id)) * (Number(p.cost) || 0), 0))

  function saveCounts() {
    let n = 0
    for (const [pid, val] of Object.entries(counts)) {
      if (val === '' || val == null) continue
      setStockTo(pid, Number(val), user.id)
      n++
    }
    setCounts({})
    setCountMode(false)
    toast(`עודכנו ${n} מוצרים`)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>מלאי</h2>
        <div className="row gap-s wrap">
          <span className="pill">שווי מלאי (עלות): {money(stockValue)}</span>
          {lowCount > 0 && (
            <button className="pill warn" onClick={() => setFilter('low')}>
              ⚠ {lowCount} במלאי נמוך
            </button>
          )}
          {countMode ? (
            <>
              <button className="btn green" onClick={saveCounts}>
                ✓ שמור ספירה
              </button>
              <button className="btn" onClick={() => setCountMode(false)}>
                ביטול
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => setCountMode(true)}>
              📋 ספירת מלאי
            </button>
          )}
          <button className="btn primary" onClick={() => setScanMode(true)}>
            📦 קליטה בסורק
          </button>
          <button className="btn" onClick={() => setImporting(true)}>
            📥 ייבוא מאקסל
          </button>
          <button className="btn" onClick={() => exportProducts().catch((e) => toast(e.message, 'err'))}>
            📤 ייצוא לאקסל
          </button>
          <button className="btn" onClick={() => setBulk(true)}>
            🗂 סגירת קטגוריה / עונה
          </button>
          <button className="btn" onClick={() => setPromos(true)}>
            🏷 מבצעים
          </button>
          <button className="btn" onClick={() => setPriceList(true)}>
            🖨 מחירון
          </button>
          <button className="btn" onClick={() => setInvoice(true)}>
            🧾 קליטת חשבונית
          </button>
          <button className="btn primary" onClick={() => setEdit({ active: true, minStock: 5, parStock: 20 })}>
            + מוצר
          </button>
        </div>
      </div>
      <div className="toolbar">
        <input placeholder="🔍 שם / ברקוד / קטגוריה" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="active">פעילים</option>
          <option value="low">מלאי נמוך</option>
          <option value="inactive">לא פעילים</option>
        </select>
      </div>
      <div className="miss-chips">
        {MISSING.filter((m) => missCounts[m.key] > 0).map((m) => (
          <button key={m.key} className={'miss-chip' + (miss === m.key ? ' on' : '') + (m.warn ? ' warn' : '') + (m.view ? ' view' : '')} onClick={() => (setMiss(miss === m.key ? null : m.key), setSel(new Set()))}>
            {missCounts[m.key]} {m.label}
          </button>
        ))}
        {miss === 'pendingName' && missCounts.pendingName > 0 && (
          <button
            className="btn small green"
            onClick={async () => {
              if (!(await confirmDlg(`לאשר את כל ${missCounts.pendingName} השמות שנמצאו ברשת?`, '✓ אשר הכול', 'ביטול', 'primary'))) return
              for (const p of products.filter((x) => x.nameStatus === 'web')) approveName(p)
              toast('✓ השמות אושרו')
            }}
          >
            ✓ אשר את כל השמות מהרשת
          </button>
        )}
      </div>
      {sel.size > 0 && <BulkAssign ids={sel} onDone={() => setSel(new Set())} />}
      <div className="table-wrap">
        <table className="inv">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  title="סמן הכול"
                  checked={shown.length > 0 && shown.every((p) => sel.has(p.id))}
                  onChange={(e) => setSel(e.target.checked ? new Set(shown.map((p) => p.id)) : new Set())}
                />
              </th>
              <th></th>
              <th>מוצר</th>
              <th>קטגוריה</th>
              <th>מחיר</th>
              <th>מחיר מוכרים</th>
              <th>עלות</th>
              <th>מלאי</th>
              <th>{countMode ? 'נספר' : 'מינימום'}</th>
              <th>ספק</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const st = stockOf(p.id)
              const low = st <= (Number(p.minStock) || 0)
              return (
                <tr key={p.id} className={sel.has(p.id) ? 'sel' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={sel.has(p.id)}
                      onChange={(e) => {
                        const n = new Set(sel)
                        e.target.checked ? n.add(p.id) : n.delete(p.id)
                        setSel(n)
                      }}
                    />
                  </td>
                  <td>
                    <ProductThumb p={p} size={36} />
                  </td>
                  <td>
                    <b>{p.name}</b>
                    {p.nameStatus === 'web' && (
                      <span className="tag web">
                        🌐 מהרשת, לא אושר{' '}
                        <button className="link" onClick={() => approveName(p)}>
                          ✓ אשר
                        </button>
                      </span>
                    )}
                    {p.nameStatus === 'temp' && <span className="tag temp">חסר שם</span>}
                    {p.showInPos === false && <span className="tag">🙈 בלי כפתור</span>}
                    {p.priceGroup && <span className="tag">📋 {p.priceGroup}</span>}
                    {p.barcode && (
                      <div className="muted small">
                        {p.barcode}
                        {p.barcodes?.length ? ` +${p.barcodes.length} ברקודים` : ''}
                      </div>
                    )}
                  </td>
                  <td>{p.category}</td>
                  <td>{miss === 'price' ? <InlineNum p={p} field="price" /> : money(p.price)}</td>
                  <td>{miss === 'staffPrice' ? <InlineNum p={p} field="staffPrice" /> : p.staffPrice !== '' && p.staffPrice != null ? money(p.staffPrice) : '—'}</td>
                  <td>{miss === 'cost' ? <InlineNum p={p} field="cost" /> : p.cost ? money(p.cost) : '—'}</td>
                  <td>
                    <b className={st <= 0 ? 'neg' : low ? 'warn' : ''}>{st}</b>
                  </td>
                  <td>
                    {countMode ? (
                      <input
                        className="count-in"
                        type="number"
                        inputMode="numeric"
                        placeholder={String(st)}
                        value={counts[p.id] ?? ''}
                        onChange={(e) => setCounts({ ...counts, [p.id]: e.target.value })}
                      />
                    ) : (
                      p.minStock
                    )}
                  </td>
                  <td className="small">{suppliers.get(p.supplierId) || ''}</td>
                  <td className="nowrap">
                    <button className="btn small green" onClick={() => setRecv(p)}>
                      + קבלה
                    </button>{' '}
                    <button className="btn small" onClick={() => setEdit(p)}>
                      ✎
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!shown.length && <Empty>אין מוצרים</Empty>}
      </div>
      {edit && <ProductEditor p={edit} user={user} onClose={() => setEdit(null)} />}
      {recv && <ReceiveModal p={recv} user={user} onClose={() => setRecv(null)} />}
      {invoice && <InvoiceIntake user={user} onClose={() => setInvoice(false)} />}
      {priceList && <PriceList onClose={() => setPriceList(false)} />}
      {promos && <Promos onClose={() => setPromos(false)} />}
      {bulk && <BulkCategory user={user} onClose={() => setBulk(false)} />}
      {scanMode && (
        <div className="wh-overlay">
          <Receive user={user} onClose={() => setScanMode(false)} onEditProduct={(p) => setEdit(p)} />
        </div>
      )}
      {importing && <ImportProducts user={user} onClose={() => setImporting(false)} />}
    </div>
  )
}

const EMOJIS = ['🥤', '💧', '🥛', '🧃', '☕', '🍵', '🥜', '🥨', '🥔', '🍫', '🍬', '🍭', '🍪', '🥪', '🥐', '🫓', '🥮', '🍕', '🌭', '🍦', '🍎', '🍌', '🧀', '🥚', '🍩', '🧁', '📦']

function ProductEditor({ p, user, onClose }) {
  const [f, setF] = useState({ ...p, barcodes: Array.isArray(p.barcodes) ? p.barcodes : [] })
  const [extra, setExtra] = useState('')
  const [initStock, setInitStock] = useState('')
  const [cam, setCam] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e })
  const cats = [...new Set(list('product').map((x) => x.category).filter(Boolean))]
  const moves = p.id
    ? list('stock')
        .filter((m) => m.productId === p.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, 8)
    : []
  async function pickImg(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const img = await resizeImage(file, 320)
      setF((prev) => ({ ...prev, img }))
    } catch {
      toast('לא הצלחתי לטעון תמונה', 'err')
    }
  }
  function addExtra(v) {
    const codes = splitCodes(v)
    if (!codes.length) return
    setF((pp) => {
      const cur = productCodes(pp)
      const add = codes.filter((c) => !cur.some((y) => sameCode(y, c)))
      if (!pp.barcode && add.length) return { ...pp, barcode: add[0], barcodes: [...pp.barcodes, ...add.slice(1)] }
      return { ...pp, barcodes: [...pp.barcodes, ...add] }
    })
    setExtra('')
  }
  function ok() {
    if (!f.name?.trim()) return toast('חסר שם', 'err')
    if (!(Number(f.price) >= 0) || f.price === '' || f.price == null) return toast('חסר מחיר', 'err')
    const mine = productCodes(f)
    for (const c of mine) {
      const other = list('product').find((x) => x.id !== f.id && productCodes(x).some((y) => sameCode(y, c)))
      if (other) return toast(`ברקוד ${c} כבר קיים במוצר "${other.name}"`, 'err')
    }
    if (mine.some((c, i) => mine.findIndex((y) => sameCode(y, c)) !== i)) return toast('אותו ברקוד מופיע פעמיים', 'err')
    const rec = save('product', {
      ...f,
      name: f.name.trim(),
      price: Number(f.price),
      staffPrice: f.staffPrice === '' || f.staffPrice == null ? '' : Number(f.staffPrice),
      cost: f.cost === '' || f.cost == null ? '' : Number(f.cost),
      minStock: Number(f.minStock) || 0,
      parStock: Number(f.parStock) || 0,
      category: (f.category || 'כללי').trim(),
      priceGroup: String(f.priceGroup || '').trim(),
      nameStatus: 'ok', // נשמר בעריכה = נבדק ואושר
      ...(f.img && f.imgStatus === 'web' ? { imgStatus: 'ok' } : {}),
    })
    if (!p.id && Number(initStock)) receiveStock(rec.id, Number(initStock), user.id, 'receive')
    toast('נשמר')
    onClose()
  }
  async function del() {
    if (!(await confirmDlg('למחוק את ' + p.name + ' מהמלאי?\nכל המכירות שלו נשארות בדוחות, עם המחירים שבהם נמכר.\n(אפשר גם רק לסמן "לא פעיל" — כך אפשר להחזיר אותו בעתיד)', 'מחק'))) return
    remove('product', p.id)
    onClose()
  }
  const margin = Number(f.price) && Number(f.cost) ? Math.round(((f.price - f.cost) / f.price) * 100) : null
  return (
    <Modal title={p.id ? 'עריכת מוצר' : 'מוצר חדש'} onClose={onClose} wide>
      <div className="row gap wrap">
        <div className="img-pick">
          <ProductThumb p={f} size={96} />
          <div className="row gap-s">
            <label className="btn small">
              📷 צלם
              <input type="file" accept="image/*" capture="environment" hidden onChange={pickImg} />
            </label>
            <label className="btn small">
              🖼 גלריה
              <input type="file" accept="image/*" hidden onChange={pickImg} />
            </label>
          </div>
          {f.img && (
            <button className="btn small" onClick={() => setF({ ...f, img: '' })}>
              הסר תמונה
            </button>
          )}
        </div>
        <div className="emoji-pick">
          {EMOJIS.map((e) => (
            <button key={e} className={f.emoji === e ? 'on' : ''} onClick={() => setF({ ...f, emoji: e })}>
              {e}
            </button>
          ))}
        </div>
      </div>
      <div className="form-grid">
        <Field label="שם המוצר">
          <div className="row gap-s">
            <input value={f.name || ''} onChange={set('name')} autoFocus />
            {f.barcode && (
              <button
                type="button"
                className="btn small"
                title="חיפוש שם לפי הברקוד ברשת"
                onClick={async () => {
                  toast('מחפש…')
                  const r = await lookupBarcode(f.barcode)
                  if (r.status === 'found') {
                    setF((pp) => ({ ...pp, name: r.name, ...(r.image && !pp.img ? { img: r.image } : {}) }))
                    toast('✓ נמצא: ' + r.name)
                  } else toast(r.status === 'error' ? 'אין חיבור לשירות החיפוש — נסה שוב מאוחר יותר' : 'לא נמצא שם לברקוד הזה', 'err')
                }}
              >
                🌐
              </button>
            )}
          </div>
        </Field>
        <Field label="קטגוריה">
          <input value={f.category || ''} onChange={set('category')} list="cats" placeholder="שתייה / חטיפים…" />
          <datalist id="cats">
            {cats.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="ברקוד">
          <div className="row gap-s">
            <input value={f.barcode || ''} onChange={set('barcode')} placeholder="סרוק או הקלד" />
            {cameraScanSupported && (
              <button className="btn" onClick={() => setCam(true)}>
                📷
              </button>
            )}
          </div>
        </Field>
        <Field label="ברקודים נוספים (למשל לכל מידה / צבע — אותו מוצר ואותו מחיר)">
          <div className="chips">
            {f.barcodes.map((c) => (
              <span key={c} className="chip">
                {c}
                <button className="icon-btn" title="הסר" onClick={() => setF((pp) => ({ ...pp, barcodes: pp.barcodes.filter((x) => x !== c) }))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="row gap-s">
            <input
              value={extra}
              placeholder="סרוק או הקלד ← Enter"
              onChange={(e) => setExtra(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== 'Tab') return
                e.preventDefault()
                addExtra(extra)
              }}
            />
            <button className="btn" onClick={() => addExtra(extra)}>
              + הוסף
            </button>
          </div>
        </Field>
        <Field label="מחיר מכירה ₪">
          <input type="number" inputMode="decimal" value={f.price ?? ''} onChange={set('price')} />
        </Field>
        <Field label="מחיר מוכרים קבוע ₪" hint="ריק = לפי אחוז ההנחה של העובד">
          <input type="number" inputMode="decimal" value={f.staffPrice ?? ''} onChange={set('staffPrice')} />
        </Field>
        <Field label="מחיר עלות ₪" hint={margin != null ? `רווח ${margin}%` : 'לחישוב רווח'}>
          <input type="number" inputMode="decimal" value={f.cost ?? ''} onChange={set('cost')} />
        </Field>
        <Field label="מלאי מינימום" hint="מתחת לזה — התראה">
          <input type="number" value={f.minStock ?? ''} onChange={set('minStock')} />
        </Field>
        <Field label="מלאי רצוי" hint="להזמנה אוטומטית מספק">
          <input type="number" value={f.parStock ?? ''} onChange={set('parStock')} />
        </Field>
        <Field label="ספק">
          <select value={f.supplierId || ''} onChange={set('supplierId')}>
            <option value="">—</option>
            {list('supplier').map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {!p.id && (
          <Field label="מלאי התחלתי">
            <input type="number" value={initStock} onChange={(e) => setInitStock(e.target.value)} />
          </Field>
        )}
      </div>
      <Toggle checked={f.active !== false} onChange={(x) => setF({ ...f, active: x })} label="פעיל (אפשר למכור)" />
      <Toggle checked={f.showInPos !== false} onChange={(x) => setF({ ...f, showInPos: x })} label="כפתור במסך הקופה (כבוי = רק בסריקה / חיפוש)" />
      <Toggle checked={f.inPriceList !== false} onChange={(x) => setF({ ...f, inPriceList: x })} label="מופיע במחירון" />
      {f.inPriceList !== false && (
        <Field label="שם במחירון — לאיחוד סוגים (למשל כל הסוגים של דוריטוס: 'דוריטוס')">
          <input list="price-groups" value={f.priceGroup || ''} placeholder="ריק = שם המוצר" onChange={set('priceGroup')} />
          <datalist id="price-groups">
            {[...new Set(list('product').map((x) => x.priceGroup).filter(Boolean))].map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>
      )}
      {moves.length > 0 && (
        <details className="moves">
          <summary>תנועות מלאי אחרונות (מלאי נוכחי: {stockOf(p.id)})</summary>
          {moves.map((m) => (
            <div key={m.id} className="row space small">
              <span>{fmtDT(m.createdAt)}</span>
              <span>{{ sale: 'מכירה', void: 'ביטול מכירה', receive: 'קבלה', adjust: 'ספירה', order: 'הזמנה' }[m.reason] || m.reason}</span>
              <b className={m.qty < 0 ? 'neg' : 'pos-bal'}>{m.qty > 0 ? '+' + m.qty : m.qty}</b>
            </div>
          ))}
        </details>
      )}
      <div className="row gap modal-actions">
        <button className="btn primary grow" onClick={ok}>
          שמור
        </button>
        {p.id && (
          <button className="btn danger" onClick={del}>
            מחק
          </button>
        )}
      </div>
      {cam && (
        <CameraScanner
          onClose={() => setCam(false)}
          onCode={(x) => {
            setF((pp) => (pp.barcode && !sameCode(pp.barcode, x) ? { ...pp, barcodes: pp.barcodes.some((y) => sameCode(y, x)) ? pp.barcodes : [...pp.barcodes, x] } : { ...pp, barcode: x }))
            setCam(false)
          }}
        />
      )}
    </Modal>
  )
}

function ReceiveModal({ p, user, onClose }) {
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState(p.cost ?? '')
  function ok() {
    const n = Number(qty)
    if (!n) return toast('הכנס כמות', 'err')
    receiveStock(p.id, n, user.id, 'receive')
    if (cost !== '' && Number(cost) !== Number(p.cost)) save('product', { ...p, cost: Number(cost) })
    toast(`נוספו ${n} ${p.name}`)
    onClose()
  }
  return (
    <Modal title={'קבלת סחורה — ' + p.name} onClose={onClose} small>
      <p className="muted">מלאי נוכחי: {stockOf(p.id)}</p>
      <Field label="כמות שהתקבלה">
        <input className="big-input" type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
      </Field>
      <Field label="מחיר עלות ליחידה (עדכון)">
        <input type="number" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
      </Field>
      <button className="btn green big grow" onClick={ok}>
        ✓ הוסף למלאי
      </button>
    </Modal>
  )
}

// ============================================================
// ספקים והזמנות
// ============================================================
export function Orders({ user }) {
  const v = useVersion()
  const [editSup, setEditSup] = useState(null)
  const [order, setOrder] = useState(null)
  const [recvOrder, setRecvOrder] = useState(null)
  const suppliers = useMemo(() => list('supplier').sort((a, b) => a.name.localeCompare(b.name, 'he')), [v])
  const orders = useMemo(() => list('order').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [v])
  const products = list('product').filter((p) => p.active !== false)

  function suggest(supplierId) {
    return products
      .filter((p) => (p.supplierId || '') === (supplierId || ''))
      .filter((p) => stockOf(p.id) <= (Number(p.minStock) || 0))
      .map((p) => ({ productId: p.id, name: p.name, qty: Math.max(1, Math.ceil((Number(p.parStock) || Number(p.minStock) * 2 || 10) - stockOf(p.id))), cost: Number(p.cost) || 0 }))
  }
  function newOrder(s) {
    setOrder({ supplierId: s.id, status: 'draft', lines: suggest(s.id), userId: user.id })
  }
  const STATUS = { draft: 'טיוטה', sent: 'נשלחה', received: 'התקבלה', cancelled: 'בוטלה' }

  return (
    <div className="page">
      <div className="page-head">
        <h2>ספקים והזמנות</h2>
        <button className="btn primary" onClick={() => setEditSup({})}>
          + ספק
        </button>
      </div>
      <div className="cards">
        {suppliers.map((s) => {
          const low = suggest(s.id).length
          return (
            <div className="card" key={s.id}>
              <div className="row space">
                <div>
                  <b>{s.name}</b>
                  <div className="muted small">
                    {[s.phone, s.email, s.notes].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button className="icon-btn" onClick={() => setEditSup(s)}>
                  ✎
                </button>
              </div>
              <button className={'btn grow ' + (low ? 'primary' : '')} onClick={() => newOrder(s)}>
                🛒 הזמנה חדשה {low ? `(${low} חסרים)` : ''}
              </button>
            </div>
          )
        })}
      </div>
      {!suppliers.length && <Empty>הוסף ספקים, ושייך מוצרים לספק במסך המלאי — המערכת תציע הזמנה לפי מה שחסר.</Empty>}

      <h3 className="section-title">הזמנות</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>תאריך</th>
              <th>ספק</th>
              <th>פריטים</th>
              <th>סה״כ משוער</th>
              <th>סטטוס</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>{fmtDT(o.createdAt)}</td>
                <td>{get('supplier', o.supplierId)?.name || '—'}</td>
                <td className="small">{o.lines.map((l) => `${l.name} ×${l.qty}`).join(', ')}</td>
                <td>{money(o.lines.reduce((s, l) => s + l.qty * (l.cost || 0), 0))}</td>
                <td>
                  <span className={'tag st-' + o.status}>{STATUS[o.status]}</span>
                </td>
                <td className="nowrap">
                  {o.status !== 'received' && o.status !== 'cancelled' && (
                    <>
                      <button className="btn small" onClick={() => setOrder(o)}>
                        פתח
                      </button>{' '}
                      <button className="btn small green" onClick={() => setRecvOrder(o)}>
                        התקבלה
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!orders.length && <Empty>אין הזמנות עדיין</Empty>}
      </div>
      {editSup && <SupplierEditor s={editSup} onClose={() => setEditSup(null)} />}
      {order && <OrderEditor o={order} onClose={() => setOrder(null)} />}
      {recvOrder && <ReceiveOrder o={recvOrder} user={user} onClose={() => setRecvOrder(null)} />}
    </div>
  )
}

function SupplierEditor({ s, onClose }) {
  const [f, setF] = useState({ ...s })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function del() {
    if (!(await confirmDlg('למחוק את הספק ' + s.name + '?', 'מחק'))) return
    remove('supplier', s.id)
    onClose()
  }
  return (
    <Modal title={s.id ? 'עריכת ספק' : 'ספק חדש'} onClose={onClose} small>
      <Field label="שם">
        <input value={f.name || ''} onChange={set('name')} autoFocus />
      </Field>
      <Field label="טלפון / וואטסאפ">
        <input value={f.phone || ''} onChange={set('phone')} inputMode="tel" />
      </Field>
      <Field label="מייל להזמנות">
        <input value={f.email || ''} onChange={set('email')} type="email" dir="ltr" />
      </Field>
      <Field label="הערות (ימי אספקה וכו׳)">
        <input value={f.notes || ''} onChange={set('notes')} />
      </Field>
      <div className="row gap modal-actions">
        <button
          className="btn primary grow"
          onClick={() => {
            if (!f.name?.trim()) return toast('חסר שם', 'err')
            save('supplier', f)
            onClose()
          }}
        >
          שמור
        </button>
        {s.id && (
          <button className="btn danger" onClick={del}>
            מחק
          </button>
        )}
      </div>
    </Modal>
  )
}

function OrderEditor({ o, onClose }) {
  const [lines, setLines] = useState(o.lines.map((l) => ({ ...l })))
  const [addId, setAddId] = useState('')
  const sup = get('supplier', o.supplierId)
  const products = list('product').filter((p) => p.active !== false && !lines.some((l) => l.productId === p.id))
  function persist(status) {
    const clean = lines.filter((l) => Number(l.qty) > 0).map((l) => ({ ...l, qty: Number(l.qty) }))
    if (!clean.length) {
      toast('אין פריטים בהזמנה', 'err')
      return null
    }
    return save('order', { ...o, lines: clean, status: status || o.status })
  }
  function orderText(rec) {
    const g = getSetting('general')
    const lines = rec.lines.map((l) => {
      const p = get('product', l.productId)
      return `• ${l.name} — ${l.qty} יח׳${p?.barcode ? ` (ברקוד ${p.barcode})` : ''}`
    })
    return [
      `שלום${sup?.name ? ' ' + sup.name : ''},`,
      `אבקש להזמין עבור ${g.title || 'המזנון'}:`,
      '',
      ...lines,
      '',
      `סה״כ ${rec.lines.length} פריטים.`,
      g.address ? `כתובת למשלוח: ${g.address}` : '',
      '',
      'תודה,',
      [g.contactName, g.phone].filter(Boolean).join(' · '),
    ]
      .filter((x, i, arr) => x !== '' || arr[i - 1] !== '')
      .join('\n')
      .trim()
  }
  function subject() {
    const g = getSetting('general')
    return `הזמנה מ${g.title || 'המזנון'} — ${new Date().toLocaleDateString('he-IL')}`
  }
  function send(via) {
    const rec = persist('sent')
    if (!rec) return
    const text = orderText(rec)
    if (via === 'wa') {
      if (sup?.phone) window.open(waLink(sup.phone, text), '_blank')
      else {
        navigator.clipboard?.writeText(text)
        toast('אין טלפון לספק — ההזמנה הועתקה')
      }
    } else if (via === 'mail') {
      const body = text.replace(/\n/g, '\r\n')
      location.href = `mailto:${encodeURIComponent(sup?.email || '')}?subject=${encodeURIComponent(subject())}&body=${encodeURIComponent(body)}`
    } else if (via === 'gmail') {
      const u = new URL('https://mail.google.com/mail/')
      u.searchParams.set('view', 'cm')
      u.searchParams.set('fs', '1')
      if (sup?.email) u.searchParams.set('to', sup.email)
      u.searchParams.set('su', subject())
      u.searchParams.set('body', text)
      window.open(u.toString(), '_blank')
    } else if (via === 'copy') {
      navigator.clipboard?.writeText(text).then(
        () => toast('ההזמנה הועתקה'),
        () => toast('לא הצלחתי להעתיק', 'err')
      )
      return
    }
    onClose()
  }
  async function cancel() {
    if (!o.id) return onClose()
    if (!(await confirmDlg('לבטל את ההזמנה?', 'בטל הזמנה'))) return
    save('order', { ...o, status: 'cancelled' })
    onClose()
  }
  return (
    <Modal title={'הזמנה — ' + (sup?.name || '')} onClose={onClose} wide>
      {lines.length === 0 && <Empty>אין כרגע מוצרים חסרים מהספק הזה. אפשר להוסיף ידנית.</Empty>}
      {lines.map((l, i) => (
        <div className="line" key={l.productId}>
          <ProductThumb p={get('product', l.productId)} size={32} />
          <div className="line-name">
            <b>{l.name}</b>
            <small className="muted">במלאי: {stockOf(l.productId)}</small>
          </div>
          <input className="count-in" type="number" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
          <button className="icon-btn" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      {!sup?.email && <p className="muted small">💡 אפשר להוסיף לספק כתובת מייל (בעריכת ספק ✎) — והיא תמולא אוטומטית בטיוטה.</p>}
      <div className="row gap-s">
        <select value={addId} onChange={(e) => setAddId(e.target.value)} className="grow">
          <option value="">+ הוסף מוצר…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={!addId}
          onClick={() => {
            const p = get('product', addId)
            setLines([...lines, { productId: p.id, name: p.name, qty: Math.max(1, (Number(p.parStock) || 10) - stockOf(p.id)), cost: Number(p.cost) || 0 }])
            setAddId('')
          }}
        >
          הוסף
        </button>
      </div>
      <div className="row gap wrap modal-actions">
        <button className="btn green grow" onClick={() => send('wa')}>
          📲 וואטסאפ
        </button>
        <button className="btn primary grow" onClick={() => send('mail')} title="פותח טיוטה בתוכנת המייל עם כל פרטי ההזמנה">
          📧 מייל
        </button>
        <button className="btn grow" onClick={() => send('gmail')} title="פותח טיוטה ב-Gmail בדפדפן">
          Gmail
        </button>
        <button className="btn" onClick={() => send('copy')} title="העתק את נוסח ההזמנה">
          📋
        </button>
        <button
          className="btn grow"
          onClick={() => {
            if (persist()) {
              toast('נשמר כטיוטה')
              onClose()
            }
          }}
        >
          שמור טיוטה
        </button>
        {o.id && (
          <button className="btn danger" onClick={cancel}>
            בטל הזמנה
          </button>
        )}
      </div>
    </Modal>
  )
}

function ReceiveOrder({ o, user, onClose }) {
  const [lines, setLines] = useState(o.lines.map((l) => ({ ...l, got: l.qty })))
  function ok() {
    for (const l of lines) if (Number(l.got) > 0) receiveStock(l.productId, Number(l.got), user.id, 'order', o.id)
    save('order', { ...o, status: 'received', receivedAt: new Date().toISOString(), received: lines.map((l) => ({ productId: l.productId, qty: Number(l.got) || 0 })) })
    toast('המלאי עודכן')
    onClose()
  }
  return (
    <Modal title="קבלת הזמנה" onClose={onClose}>
      <p className="muted">עדכן כמויות שהגיעו בפועל:</p>
      {lines.map((l, i) => (
        <div className="line" key={l.productId}>
          <div className="line-name">
            <b>{l.name}</b>
            <small className="muted">הוזמן: {l.qty}</small>
          </div>
          <input className="count-in" type="number" value={l.got} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, got: e.target.value } : x)))} />
        </div>
      ))}
      <button className="btn green big grow" onClick={ok}>
        ✓ הוסף הכל למלאי
      </button>
    </Modal>
  )
}


// סגירת קטגוריה / עונה: מוצרים שנמכרו זמנית (למשל בגדי חורף) — מסתירים או מוחקים מהמלאי.
// המכירות שלהם נשארות בדוחות עם השם, המחיר והכמות מזמן המכירה.
function BulkCategory({ user, onClose }) {
  const products = list('product')
  const cats = [...new Set(products.map((p) => p.category || 'כללי'))].sort((a, b) => a.localeCompare(b, 'he'))
  const [cat, setCat] = useState('')
  const inCat = products.filter((p) => (p.category || 'כללי') === cat)
  const active = inCat.filter((p) => p.active !== false)
  const inactive = inCat.filter((p) => p.active === false)
  const withStock = inCat.filter((p) => stockOf(p.id) > 0)
  const setActive = (on) => {
    const list2 = on ? inactive : active
    for (const p of list2) save('product', { ...p, active: on })
    toast(on ? `✓ ${list2.length} מוצרים הוחזרו לקופה` : `✓ ${list2.length} מוצרים הוסתרו מהקופה ומהמלאי`)
    onClose()
  }
  const delAll = async () => {
    const ok = await confirmDlg(
      `למחוק ${inCat.length} מוצרים בקטגוריה "${cat}" מהמלאי?\n\nהמכירות שלהם נשארות בדוחות (שם, מחיר וכמות כפי שנמכרו).${withStock.length ? `\n\nשים לב: ל-${withStock.length} מהם עוד יש מלאי.` : ''}\n\nאי אפשר להחזיר מוצרים שנמחקו — אם המכירה תחזור בשנה הבאה, עדיף "להסתיר".`,
      'מחק הכול'
    )
    if (!ok) return
    for (const p of inCat) remove('product', p.id)
    toast(`נמחקו ${inCat.length} מוצרים`)
    onClose()
  }
  return (
    <Modal title="🗂 סגירת קטגוריה / עונה" onClose={onClose}>
      <p className="muted small">למשל אחרי מכירת בגדי חורף: בוחרים את הקטגוריה ומסתירים או מוחקים את כל המוצרים שלה בבת אחת. הדוחות על מה שנמכר נשארים מלאים.</p>
      <Field label="קטגוריה">
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">— בחר —</option>
          {cats.map((c) => (
            <option key={c} value={c}>
              {c} ({products.filter((p) => (p.category || 'כללי') === c).length})
            </option>
          ))}
        </select>
      </Field>
      {cat && (
        <>
          <p className="small">
            {inCat.length} מוצרים · {active.length} פעילים · {inactive.length} מוסתרים{withStock.length ? ` · ל-${withStock.length} יש עוד מלאי` : ''}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {active.length > 0 && (
              <button className="btn primary" onClick={() => setActive(false)}>
                🙈 הסתר את כל הקטגוריה (מומלץ — אפשר להחזיר בעונה הבאה)
              </button>
            )}
            {inactive.length > 0 && (
              <button className="btn" onClick={() => setActive(true)}>
                👁 החזר את כל הקטגוריה לקופה
              </button>
            )}
            <button className="btn danger" onClick={delAll}>
              🗑 מחק את כל המוצרים בקטגוריה
            </button>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            דוחות: בדוחות ← "טווח" ← בוחרים את תאריכי המכירה ← "דוח מפורט" ← הקטגוריה.
          </p>
        </>
      )}
    </Modal>
  )
}

// ---------- "חסר מידע" — מסננים למנהל ----------
// "חסר" = ריק או 0. קטגוריה "כללי" (ברירת המחדל כשלא נבחרה קטגוריה) נחשבת "ללא קטגוריה".
const num = (v) => Number(v) || 0
const MISSING = [
  { key: 'pendingName', label: 'שמות מהרשת לאישור', test: (p) => p.nameStatus === 'web' },
  { key: 'name', label: 'חסרי שם', test: (p) => p.nameStatus === 'temp' || !String(p.name || '').trim(), warn: true },
  { key: 'cost', label: 'חסרי מחיר עלות', test: (p) => num(p.cost) <= 0 },
  { key: 'price', label: 'חסרי מחיר מכירה', test: (p) => num(p.price) <= 0, warn: true },
  { key: 'staffPrice', label: 'בלי מחיר מוכרים קבוע', test: (p) => p.staffPrice === '' || p.staffPrice == null || num(p.staffPrice) <= 0 },
  { key: 'supplier', label: 'ללא ספק', test: (p) => !p.supplierId || !get('supplier', p.supplierId) },
  { key: 'category', label: 'ללא קטגוריה', test: (p) => !String(p.category || '').trim() || String(p.category).trim() === 'כללי' },
  { key: 'barcode', label: 'ללא ברקוד', test: (p) => !productCodes(p).length },
  { key: 'img', label: 'ללא תמונה', test: (p) => !p.img },
  { key: 'minStock', label: 'בלי מלאי מינימום', test: (p) => num(p.minStock) <= 0 },
  { key: 'hiddenPos', label: 'בלי כפתור בקופה', test: (p) => p.showInPos === false, view: true },
  { key: 'noPriceList', label: 'לא במחירון', test: (p) => p.inPriceList === false, view: true },
  { key: 'negative', label: 'מלאי שלילי', test: (p) => stockOf(p.id) < 0, warn: true },
  { key: 'belowMin', label: 'מתחת למינימום', test: (p) => num(p.minStock) > 0 && stockOf(p.id) < num(p.minStock), warn: true },
]

// עריכה ישירה בשורה (עלות / מחיר / מחיר מוכרים)
function InlineNum({ p, field }) {
  const [v, setV] = useState(p[field] === '' || p[field] == null ? '' : String(p[field]))
  const commit = () => {
    const n = Number(v)
    if (v === '' || !(n > 0)) return
    if (n !== Number(p[field])) {
      save('product', { ...get('product', p.id), [field]: round2(n) })
      toast('נשמר')
    }
  }
  return (
    <input
      className="count-in"
      inputMode="decimal"
      value={v}
      placeholder="₪"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (commit(), e.currentTarget.blur())}
    />
  )
}

// עריכה קבוצתית: ספק / קטגוריה / אישור שמות לכמה מוצרים בבת אחת
function BulkAssign({ ids, onDone }) {
  const suppliers = list('supplier')
  const cats = [...new Set(list('product').map((p) => p.category).filter((c) => c && c !== 'כללי'))].sort((a, b) => a.localeCompare(b, 'he'))
  const [sup, setSup] = useState('')
  const [cat, setCat] = useState('')
  const [grp, setGrp] = useState('')
  const apply = (patch, msg) => {
    for (const id of ids) {
      const p = get('product', id)
      if (p) save('product', { ...p, ...patch(p) })
    }
    toast(`✓ ${msg} ל-${ids.size} מוצרים`)
    onDone()
  }
  return (
    <div className="bulk-bar">
      <b>{ids.size} מסומנים</b>
      <select value={sup} onChange={(e) => setSup(e.target.value)}>
        <option value="">ספק…</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button className="btn small" disabled={!sup} onClick={() => apply(() => ({ supplierId: sup }), 'הספק עודכן')}>
        קבע ספק
      </button>
      <input list="bulk-cats" placeholder="קטגוריה…" value={cat} onChange={(e) => setCat(e.target.value)} />
      <datalist id="bulk-cats">
        {cats.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <button className="btn small" disabled={!cat.trim()} onClick={() => apply(() => ({ category: cat.trim() }), 'הקטגוריה עודכנה')}>
        קבע קטגוריה
      </button>
      <span className="sep" />
      <button className="btn small" onClick={() => apply(() => ({ showInPos: true }), 'מוצג בכפתורי הקופה')}>
        👁 הצג בקופה
      </button>
      <button className="btn small" onClick={() => apply(() => ({ showInPos: false }), 'הוסתר מכפתורי הקופה')}>
        🙈 הסתר מכפתורי הקופה
      </button>
      <button className="btn small" onClick={() => apply(() => ({ inPriceList: true }), 'נוסף למחירון')}>
        📋 במחירון
      </button>
      <button className="btn small" onClick={() => apply(() => ({ inPriceList: false }), 'הוצא מהמחירון')}>
        לא במחירון
      </button>
      <input placeholder="שם במחירון…" value={grp} onChange={(e) => setGrp(e.target.value)} style={{ width: 130 }} />
      <button className="btn small" disabled={!grp.trim()} onClick={() => apply(() => ({ priceGroup: grp.trim(), inPriceList: true }), `אוחד במחירון כ"${grp.trim()}"`)}>
        אחד במחירון
      </button>
      <span className="sep" />
      <button className="btn small" onClick={() => apply((p) => ({ nameStatus: p.nameStatus === 'temp' ? 'temp' : 'ok', ...(p.imgStatus === 'web' ? { imgStatus: 'ok' } : {}) }), 'השמות אושרו')}>
        ✓ אשר שמות
      </button>
      <button className="btn small" onClick={onDone}>
        ביטול סימון
      </button>
    </div>
  )
}
