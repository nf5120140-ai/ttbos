// ============================================================
// תתבוס — קליטת חשבונית / תעודת משלוח
// מצלמים או מעלים → המערכת קוראת (Claude דרך שרת) → מסך אישור → מלאי מתעדכן
// ============================================================
import { useState } from 'react'
import { DEMO, list, get, save, receiveStock, uid, round2 } from './db.js'
import { cloudConfigured, callAuthFn } from './sync.js'
import { Modal, Field, money, toast, ProductThumb } from './ui.jsx'

const MAX_PAGES = 6

function fileToPayload(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onerror = rej
    if (file.type === 'application/pdf') {
      if (file.size > 8 * 1024 * 1024) return rej(new Error('קובץ PDF גדול מדי (עד 8MB)'))
      r.onload = () => res({ data: String(r.result).split(',')[1], mediaType: 'application/pdf', preview: null, name: file.name })
      r.readAsDataURL(file)
      return
    }
    r.onload = () => {
      const img = new Image()
      img.onload = () => {
        const max = 1800
        const s = Math.min(1, max / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * s)
        c.height = Math.round(img.height * s)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        const url = c.toDataURL('image/jpeg', 0.85)
        res({ data: url.split(',')[1], mediaType: 'image/jpeg', preview: url, name: file.name })
      }
      img.onerror = () => rej(new Error('לא הצלחתי לקרוא את התמונה'))
      img.src = r.result
    }
    r.readAsDataURL(file)
  })
}

export function InvoiceIntake({ user, onClose }) {
  const [pages, setPages] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)

  const available = cloudConfigured && !DEMO

  async function addFiles(e) {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    setErr('')
    try {
      const add = []
      for (const f of files) add.push(await fileToPayload(f))
      setPages((p) => [...p, ...add].slice(0, MAX_PAGES))
    } catch (x) {
      setErr(x.message)
    }
  }

  async function scan() {
    setBusy(true)
    setErr('')
    try {
      const products = list('product').map((p) => ({ id: p.id, name: p.name, barcode: p.barcode || '', category: p.category || '' }))
      const suppliers = list('supplier').map((s) => ({ id: s.id, name: s.name }))
      const r = await callAuthFn('invoice-scan', { files: pages.map(({ data, mediaType }) => ({ data, mediaType })), products, suppliers })
      if (!r?.lines?.length) throw new Error('לא נמצאו פריטים במסמך. נסה צילום ברור יותר.')
      setResult(r)
    } catch (x) {
      setErr(x.message || String(x))
    }
    setBusy(false)
  }

  if (result) return <InvoiceReview doc={result} user={user} onClose={onClose} onBack={() => setResult(null)} />

  return (
    <Modal title="🧾 קליטת חשבונית / תעודת משלוח" onClose={onClose}>
      {!available ? (
        <p className="err">{DEMO ? 'לא זמין במצב הדגמה' : 'צריך חיבור לשרת'}</p>
      ) : (
        <>
          <p className="muted">צלם את המסמך (אפשר כמה עמודים) או העלה תמונה / PDF. המערכת תקרא את הפריטים ותציג לך לאישור לפני שהמלאי מתעדכן.</p>
          <div className="row gap-s wrap">
            <label className="btn primary big grow">
              📷 צלם מסמך
              <input type="file" accept="image/*" capture="environment" hidden onChange={addFiles} />
            </label>
            <label className="btn big grow">
              📎 העלה קובץ
              <input type="file" accept="image/*,application/pdf" multiple hidden onChange={addFiles} />
            </label>
          </div>
          {pages.length > 0 && (
            <div className="pages">
              {pages.map((p, i) => (
                <div className="page-thumb" key={i}>
                  {p.preview ? <img src={p.preview} alt="" /> : <div className="pdf">PDF</div>}
                  <button className="icon-btn" onClick={() => setPages(pages.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                  <small>עמוד {i + 1}</small>
                </div>
              ))}
            </div>
          )}
          {err && <div className="err">{err}</div>}
          <button className="btn green big grow" disabled={!pages.length || busy} onClick={scan}>
            {busy ? '⏳ קורא את המסמך… (עד חצי דקה)' : `🔍 קרא את המסמך${pages.length > 1 ? ` (${pages.length} עמודים)` : ''}`}
          </button>
        </>
      )}
    </Modal>
  )
}

function InvoiceReview({ doc, user, onClose, onBack }) {
  const products = list('product').sort((a, b) => a.name.localeCompare(b.name, 'he'))
  const suppliers = list('supplier')
  const [supplierId, setSupplierId] = useState(doc.supplierId || '')
  const [newSupplier, setNewSupplier] = useState(doc.supplierId ? '' : doc.supplierName || '')
  const [docNumber, setDocNumber] = useState(doc.docNumber || '')
  const [lines, setLines] = useState(() =>
    (doc.lines || []).map((l) => ({
      key: uid(),
      include: true,
      docName: l.name || '',
      barcode: l.barcode || '',
      productId: l.productId || '__new',
      qty: Number(l.qty) || 0,
      unitCost: l.unitCost != null ? round2(l.unitCost) : '',
      updateCost: true,
      newPrice: '',
      newCategory: '',
      confidence: l.confidence || 'medium',
      packSize: l.packSize || 1,
    }))
  )
  const openOrders = list('order').filter((o) => o.status === 'sent' && (!supplierId || o.supplierId === supplierId))
  const [orderId, setOrderId] = useState(openOrders.length === 1 ? openOrders[0].id : '')
  const [err, setErr] = useState('')

  const upd = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const inc = lines.filter((l) => l.include)
  const sum = round2(inc.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0))
  const newCount = inc.filter((l) => l.productId === '__new').length

  function apply() {
    setErr('')
    for (const l of inc) {
      if (!(Number(l.qty) > 0)) return setErr(`כמות חסרה ב"${l.docName}"`)
      if (l.productId === '__new' && !l.docName.trim()) return setErr('חסר שם למוצר חדש')
    }
    let sid = supplierId
    if (!sid && newSupplier.trim()) sid = save('supplier', { name: newSupplier.trim() }).id
    const invId = uid()
    const applied = []
    for (const l of inc) {
      let pid = l.productId
      const cost = l.unitCost === '' ? null : Number(l.unitCost)
      if (pid === '__new') {
        const price = Number(l.newPrice)
        const p = save('product', {
          name: l.docName.trim(),
          barcode: l.barcode || '',
          category: l.newCategory.trim() || 'כללי',
          price: price > 0 ? price : 0,
          staffPrice: '',
          cost: cost ?? '',
          supplierId: sid || null,
          minStock: 5,
          parStock: 20,
          emoji: '📦',
          active: price > 0, // בלי מחיר מכירה — לא מוצג בקופה עד שיתומחר
        })
        pid = p.id
      } else {
        const p = get('product', pid)
        if (p && ((l.updateCost && cost != null && cost !== Number(p.cost)) || (!p.supplierId && sid) || (!p.barcode && l.barcode)))
          save('product', {
            ...p,
            ...(l.updateCost && cost != null ? { cost } : {}),
            ...(!p.supplierId && sid ? { supplierId: sid } : {}),
            ...(!p.barcode && l.barcode ? { barcode: l.barcode } : {}),
          })
      }
      receiveStock(pid, Number(l.qty), user.id, 'invoice', invId)
      applied.push({ productId: pid, name: get('product', pid)?.name || l.docName, docName: l.docName, qty: Number(l.qty), unitCost: cost })
    }
    save('invoice', {
      id: invId,
      supplierId: sid || null,
      supplierName: doc.supplierName || newSupplier,
      docType: doc.docType || '',
      docNumber,
      docDate: doc.docDate || null,
      docTotal: doc.total ?? null,
      total: sum,
      lines: applied,
      userId: user.id,
    })
    if (orderId) {
      const o = get('order', orderId)
      if (o) save('order', { ...o, status: 'received', receivedAt: new Date().toISOString(), invoiceId: invId })
    }
    const pending = applied.filter((a) => !get('product', a.productId)?.active).length
    toast(`✓ נקלטו ${applied.length} פריטים למלאי` + (pending ? ` · ${pending} מוצרים חדשים מחכים למחיר מכירה` : ''))
    onClose()
  }

  return (
    <Modal title="אישור קליטה למלאי" onClose={onClose} wide>
      <div className="form-grid">
        <Field label="ספק">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">{newSupplier ? `➕ ספק חדש: ${newSupplier}` : '—'}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="מספר מסמך">
          <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
        </Field>
        {openOrders.length > 0 && (
          <Field label="סגור הזמנה פתוחה">
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">— לא —</option>
              {openOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {get('supplier', o.supplierId)?.name} · {new Date(o.createdAt).toLocaleDateString('he-IL')} ({o.lines.length} פריטים)
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <p className="muted small">
        {doc.docType || 'מסמך'} {doc.docDate ? '· ' + doc.docDate : ''} · עבור על השורות ותקן מה שצריך. שורות בצהוב — המערכת לא בטוחה.
      </p>

      <div className="inv-lines">
        {lines.map((l, i) => {
          const p = l.productId !== '__new' && l.productId !== '__skip' ? get('product', l.productId) : null
          return (
            <div key={l.key} className={'inv-line' + (!l.include ? ' off' : '') + (l.confidence === 'low' ? ' low' : '')}>
              <label className="chk">
                <input type="checkbox" checked={l.include} onChange={(e) => upd(i, { include: e.target.checked })} />
              </label>
              <div className="inv-doc">
                <small className="muted">במסמך:</small>
                <b>{l.docName}</b>
                {l.packSize > 1 && <small className="muted"> (מארז {l.packSize})</small>}
              </div>
              <div className="inv-match">
                <ProductThumb p={p || { emoji: '➕' }} size={30} />
                <select value={l.productId} onChange={(e) => upd(i, { productId: e.target.value })} disabled={!l.include}>
                  <option value="__new">➕ מוצר חדש</option>
                  {products.map((pp) => (
                    <option key={pp.id} value={pp.id}>
                      {pp.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="inv-num">
                <small>כמות</small>
                <input type="number" inputMode="numeric" value={l.qty} onChange={(e) => upd(i, { qty: e.target.value })} disabled={!l.include} />
              </label>
              <label className="inv-num">
                <small>עלות ליח׳</small>
                <input type="number" inputMode="decimal" value={l.unitCost} onChange={(e) => upd(i, { unitCost: e.target.value })} disabled={!l.include} />
              </label>
              {l.productId === '__new' ? (
                <div className="inv-new">
                  <input placeholder="מחיר מכירה" type="number" inputMode="decimal" value={l.newPrice} onChange={(e) => upd(i, { newPrice: e.target.value })} disabled={!l.include} />
                  <input placeholder="קטגוריה" value={l.newCategory} onChange={(e) => upd(i, { newCategory: e.target.value })} disabled={!l.include} list="inv-cats" />
                </div>
              ) : (
                <label className="chk small">
                  <input type="checkbox" checked={l.updateCost} onChange={(e) => upd(i, { updateCost: e.target.checked })} disabled={!l.include} />
                  עדכן עלות{p?.cost ? ` (היה ${money(p.cost)})` : ''}
                </label>
              )}
            </div>
          )
        })}
        <datalist id="inv-cats">
          {[...new Set(products.map((p) => p.category).filter(Boolean))].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className="sum-row">
        <span>
          {inc.length} שורות{newCount ? ` · ${newCount} מוצרים חדשים` : ''}
        </span>
        <b>
          {money(sum)}
          {doc.total ? <small className={Math.abs(doc.total - sum) > 1 ? ' warn' : ' muted'}> (במסמך: {money(doc.total)})</small> : null}
        </b>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="row gap wrap">
        <button className="btn green big grow" onClick={apply} disabled={!inc.length}>
          ✓ אשר והוסף למלאי
        </button>
        <button className="btn" onClick={onBack}>
          ← צילום מחדש
        </button>
      </div>
    </Modal>
  )
}
