// ============================================================
// תתבוס — ניהול מבצעים
// ============================================================
import { useMemo, useState } from 'react'
import { list, get, save, remove } from './db.js'
import { Modal, Field, Toggle, money, toast, confirmDlg, useVersion, ProductThumb, Empty } from './ui.jsx'
import { promoIsLive, promoLabel } from './pricing.js'

const fmtD = (d) => (d ? d.split('-').reverse().join('/') : '')

export function Promos({ onClose }) {
  const v = useVersion()
  const [edit, setEdit] = useState(null)
  const promos = useMemo(() => list('promo').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [v])
  const stats = useMemo(() => {
    // כמה נמכר / כמה נחסך בכל מבצע (30 יום אחרונים)
    const since = new Date(Date.now() - 30 * 864e5).toISOString()
    const m = new Map()
    for (const s of list('sale')) {
      if (s.voided || s.createdAt < since) continue
      for (const i of s.items) if (i.promoId) {
        const x = m.get(i.promoId) || { qty: 0, saving: 0 }
        x.qty += i.qty
        x.saving += i.qty * Math.max(0, (i.regularPrice ?? i.price) - i.price)
        m.set(i.promoId, x)
      }
      for (const d of s.promoDiscounts || []) {
        const x = m.get(d.promoId) || { qty: 0, saving: 0 }
        x.saving += Number(d.amount) || 0
        x.qty += 1
        m.set(d.promoId, x)
      }
    }
    return m
  }, [v])

  return (
    <Modal title="🏷 מבצעים" onClose={onClose} wide>
      <div className="row space">
        <p className="muted small">המבצע מופעל אוטומטית בקופה בתאריכים שנקבעו. עובד במחיר מוכרים מקבל את הזול מבין המבצע להנחת העובד.</p>
        <button className="btn primary" onClick={() => setEdit({ type: 'pct', active: true, productIds: [] })}>
          + מבצע חדש
        </button>
      </div>
      {!promos.length && <Empty>אין מבצעים עדיין</Empty>}
      <div className="promo-list">
        {promos.map((p) => {
          const live = promoIsLive(p)
          const st = stats.get(p.id)
          return (
            <div key={p.id} className={'promo-card' + (live ? ' live' : '')} onClick={() => setEdit(p)}>
              <div className="row space">
                <b>{p.name || promoLabel(p)}</b>
                <span className={'tag ' + (live ? 'st-received' : 'st-cancelled')}>{live ? 'פעיל עכשיו' : p.active === false ? 'כבוי' : 'לא בתוקף'}</span>
              </div>
              <div className="promo-type">{promoLabel(p)}</div>
              <div className="muted small">
                {(p.productIds || [])
                  .map((id) => get('product', id)?.name)
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              <div className="muted small">
                {p.start || p.end ? `${fmtD(p.start) || '…'} עד ${fmtD(p.end) || '…'}` : 'ללא הגבלת תאריך'}
                {st ? ` · 30 יום: נחסך ${money(st.saving)}` : ''}
              </div>
            </div>
          )
        })}
      </div>
      {edit && <PromoEditor p={edit} onClose={() => setEdit(null)} />}
    </Modal>
  )
}

function PromoEditor({ p, onClose }) {
  const [f, setF] = useState({ ...p, productIds: [...(p.productIds || [])] })
  const [q, setQ] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e })
  const products = list('product')
    .filter((x) => x.active !== false)
    .sort((a, b) => (a.category || '').localeCompare(b.category || '', 'he') || a.name.localeCompare(b.name, 'he'))
  const cats = [...new Set(products.map((x) => x.category || 'כללי'))]
  const shown = products.filter((x) => !q || x.name.includes(q) || (x.category || '').includes(q))
  const toggle = (id) => setF((x) => ({ ...x, productIds: x.productIds.includes(id) ? x.productIds.filter((i) => i !== id) : [...x.productIds, id] }))
  const toggleCat = (c) => {
    const ids = products.filter((x) => (x.category || 'כללי') === c).map((x) => x.id)
    const all = ids.every((id) => f.productIds.includes(id))
    setF((x) => ({ ...x, productIds: all ? x.productIds.filter((i) => !ids.includes(i)) : [...new Set([...x.productIds, ...ids])] }))
  }

  // תצוגה מקדימה
  const sample = f.productIds.map((id) => get('product', id)).filter(Boolean)[0]
  let preview = ''
  if (sample) {
    const base = Number(sample.price)
    if (f.type === 'pct' && Number(f.pct) > 0) preview = `${sample.name}: ${money(base)} ← ${money(base * (1 - Number(f.pct) / 100))}`
    if (f.type === 'price' && f.price !== '' && f.price != null) preview = `${sample.name}: ${money(base)} ← ${money(f.price)}`
    if (f.type === 'bundle' && Number(f.qty) >= 2 && f.bundlePrice !== '' && f.bundlePrice != null)
      preview = `${f.qty} יח׳ (רגיל ${money(base * Number(f.qty))}) ← ${money(f.bundlePrice)}`
  }

  function ok() {
    if (!f.productIds.length) return toast('בחר לפחות מוצר אחד', 'err')
    if (f.type === 'pct' && !(Number(f.pct) > 0 && Number(f.pct) < 100)) return toast('אחוז הנחה בין 1 ל-99', 'err')
    if (f.type === 'price' && !(Number(f.price) >= 0) ) return toast('הכנס מחיר מבצע', 'err')
    if (f.type === 'price' && f.productIds.some((id) => Number(f.price) >= Number(get('product', id)?.price))) return toast('מחיר המבצע צריך להיות נמוך מהמחיר הרגיל', 'err')
    if (f.type === 'bundle' && !(Number(f.qty) >= 2)) return toast('כמות במבצע — לפחות 2', 'err')
    if (f.type === 'bundle' && !(Number(f.bundlePrice) > 0)) return toast('הכנס מחיר למבצע הכמות', 'err')
    if (f.start && f.end && f.end < f.start) return toast('תאריך סיום לפני תאריך התחלה', 'err')
    save('promo', {
      ...f,
      pct: f.type === 'pct' ? Number(f.pct) : null,
      price: f.type === 'price' ? Number(f.price) : null,
      qty: f.type === 'bundle' ? Math.floor(Number(f.qty)) : null,
      bundlePrice: f.type === 'bundle' ? Number(f.bundlePrice) : null,
      name: (f.name || '').trim(),
    })
    toast('המבצע נשמר')
    onClose()
  }
  async function del() {
    if (!(await confirmDlg('למחוק את המבצע?', 'מחק'))) return
    remove('promo', p.id)
    onClose()
  }

  return (
    <Modal title={p.id ? 'עריכת מבצע' : 'מבצע חדש'} onClose={onClose} wide>
      <div className="seg">
        {[
          ['pct', '% אחוז הנחה'],
          ['price', '₪ מחיר מבצע'],
          ['bundle', '🔢 כמות במחיר'],
        ].map(([k, l]) => (
          <button key={k} className={f.type === k ? 'on' : ''} onClick={() => setF({ ...f, type: k })}>
            {l}
          </button>
        ))}
      </div>
      <div className="form-grid">
        {f.type === 'pct' && (
          <Field label="אחוז הנחה">
            <input type="number" inputMode="numeric" value={f.pct ?? ''} onChange={set('pct')} placeholder="20" autoFocus />
          </Field>
        )}
        {f.type === 'price' && (
          <Field label="מחיר מבצע ליחידה ₪">
            <input type="number" inputMode="decimal" value={f.price ?? ''} onChange={set('price')} autoFocus />
          </Field>
        )}
        {f.type === 'bundle' && (
          <>
            <Field label="כמות יחידות" hint="אפשר לערבב בין המוצרים שבמבצע">
              <input type="number" inputMode="numeric" value={f.qty ?? ''} onChange={set('qty')} placeholder="3" autoFocus />
            </Field>
            <Field label="במחיר ₪">
              <input type="number" inputMode="decimal" value={f.bundlePrice ?? ''} onChange={set('bundlePrice')} placeholder="10" />
            </Field>
          </>
        )}
        <Field label="שם המבצע (לא חובה)">
          <input value={f.name || ''} onChange={set('name')} placeholder="למשל: מבצע שתייה קרה" />
        </Field>
        <Field label="מתאריך" hint="ריק = מיד">
          <input type="date" value={f.start || ''} onChange={set('start')} />
        </Field>
        <Field label="עד תאריך (כולל)" hint="ריק = עד שמכבים">
          <input type="date" value={f.end || ''} onChange={set('end')} />
        </Field>
      </div>
      {preview && <div className="promo-preview">👀 {preview}</div>}

      <div className="row space">
        <b>מוצרים במבצע ({f.productIds.length})</b>
        <input className="grow" style={{ maxWidth: 260 }} placeholder="🔍 חיפוש" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="row gap-s wrap">
        {cats.map((c) => (
          <button key={c} className="btn small" onClick={() => toggleCat(c)}>
            כל ה{c}
          </button>
        ))}
      </div>
      <div className="promo-products">
        {shown.map((x) => (
          <label key={x.id} className={'promo-prod' + (f.productIds.includes(x.id) ? ' on' : '')}>
            <input type="checkbox" checked={f.productIds.includes(x.id)} onChange={() => toggle(x.id)} />
            <ProductThumb p={x} size={26} />
            <span className="grow">{x.name}</span>
            <small className="muted">{money(x.price)}</small>
          </label>
        ))}
      </div>
      <Toggle checked={f.active !== false} onChange={(x) => setF({ ...f, active: x })} label="פעיל" />
      <div className="row gap modal-actions">
        <button className="btn primary grow" onClick={ok}>
          שמור מבצע
        </button>
        {p.id && (
          <button className="btn danger" onClick={del}>
            מחק
          </button>
        )}
      </div>
    </Modal>
  )
}
