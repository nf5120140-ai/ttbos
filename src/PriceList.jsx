// ============================================================
// תתבוס — מחירון להדפסה ולתליה
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { list, getSetting, save, get } from './db.js'
import { money, ProductThumb, useVersion, Modal, toast } from './ui.jsx'
import { unitPromoFor, bundlesFor, livePromos, promoLabel } from './pricing.js'

const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem('tt_pricelist') || '{}')
  } catch {
    return {}
  }
}

export function PriceList({ onClose }) {
  const v = useVersion()
  const [o, setO] = useState(() => ({ mode: 'category', cols: 2, staff: false, icons: true, big: false, variants: false, ...loadPrefs() }))
  const [picking, setPicking] = useState(false)
  const set = (k, v) => setO((p) => ({ ...p, [k]: v }))
  useEffect(() => {
    try {
      localStorage.setItem('tt_pricelist', JSON.stringify(o))
    } catch {}
  }, [o])

  const g = getSetting('general')
  const title = g.title || 'המזנון'
  const date = new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const promos = useMemo(() => livePromos(), [])
  // מוצרים שנבחרו למחירון. מוצרים עם אותו "שם במחירון" מתאחדים לשורה אחת (למשל כל סוגי הדוריטוס)
  const products = useMemo(() => {
    const act = list('product').filter((p) => p.active !== false && p.inPriceList !== false && Number(p.price) > 0)
    const byGroup = new Map()
    const out = []
    for (const p of act) {
      const g = String(p.priceGroup || '').trim()
      if (!g) {
        out.push({ ...p, variants: [p] })
        continue
      }
      if (!byGroup.has(g)) {
        const row = { ...p, id: 'g:' + g, name: g, variants: [] }
        byGroup.set(g, row)
        out.push(row)
      }
      byGroup.get(g).variants.push(p)
    }
    for (const r of byGroup.values()) {
      const prices = r.variants.map((x) => Number(x.price))
      r.minPrice = Math.min(...prices)
      r.maxPrice = Math.max(...prices)
      r.price = r.minPrice
      const st = r.variants.map((x) => (x.staffPrice === '' || x.staffPrice == null ? null : Number(x.staffPrice)))
      r.staffPrice = st.every((x) => x != null && x === st[0]) ? st[0] : ''
      r.img = r.variants.find((x) => x.img)?.img || r.img
      // מבצע מוצג רק אם הוא זהה לכל הסוגים
      const units = r.variants.map((x) => unitPromoFor(x, promos)?.unit ?? null)
      r.groupPromoUnit = units.every((u) => u != null && u === units[0]) ? units[0] : null
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'he'))
  }, [v])
  const groups = useMemo(() => {
    if (o.mode === 'abc') {
      // לפי אות ראשונה
      const m = new Map()
      for (const p of products) {
        const ch = (p.name.trim()[0] || '#').toUpperCase()
        if (!m.has(ch)) m.set(ch, [])
        m.get(ch).push(p)
      }
      return [...m.entries()]
    }
    const m = new Map()
    for (const p of products) {
      const c = p.category || 'כללי'
      if (!m.has(c)) m.set(c, [])
      m.get(c).push(p)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'he'))
  }, [products, o.mode])

  const hasStaff = products.some((p) => p.staffPrice !== '' && p.staffPrice != null && Number(p.staffPrice) !== Number(p.price))

  function doPrint() {
    document.body.classList.add('pl-printing')
    const done = () => {
      document.body.classList.remove('pl-printing')
      window.removeEventListener('afterprint', done)
    }
    window.addEventListener('afterprint', done)
    setTimeout(() => {
      window.print()
      setTimeout(done, 1500)
    }, 50)
  }

  return createPortal(
    <div className="pl-wrap">
      <div className="pl-controls">
        <b>🖨 מחירון</b>
        <div className="seg">
          <button className={o.mode === 'category' ? 'on' : ''} onClick={() => set('mode', 'category')}>
            לפי קטגוריות
          </button>
          <button className={o.mode === 'abc' ? 'on' : ''} onClick={() => set('mode', 'abc')}>
            לפי א-ב
          </button>
        </div>
        <div className="seg">
          {[1, 2, 3].map((n) => (
            <button key={n} className={o.cols === n ? 'on' : ''} onClick={() => set('cols', n)}>
              {n} טורים
            </button>
          ))}
        </div>
        <label className="chk">
          <input type="checkbox" checked={o.icons} onChange={(e) => set('icons', e.target.checked)} /> תמונות
        </label>
        {hasStaff && (
          <label className="chk">
            <input type="checkbox" checked={o.staff} onChange={(e) => set('staff', e.target.checked)} /> מחיר מוכרים
          </label>
        )}
        <label className="chk">
          <input type="checkbox" checked={o.big} onChange={(e) => set('big', e.target.checked)} /> אותיות גדולות
        </label>
        <label className="chk">
          <input type="checkbox" checked={o.variants} onChange={(e) => set('variants', e.target.checked)} /> פירוט הסוגים
        </label>
        <button className="btn" onClick={() => setPicking(true)}>
          ✎ בחירת מוצרים
        </button>
        <span className="grow" />
        <button className="btn primary" onClick={doPrint}>
          🖨 הדפס
        </button>
        <button className="btn" onClick={onClose}>
          סגור
        </button>
      </div>

      <div className="pl-scroll">
        <div className={'pl-sheet' + (o.big ? ' big' : '')}>
          <header className="pl-head">
            <div className="pl-logo">ת</div>
            <div>
              <h1>מחירון</h1>
              <div className="pl-sub">{title}</div>
            </div>
            <div className="pl-date">
              מעודכן ל־
              <br />
              <b>{date}</b>
            </div>
          </header>

          {products.length === 0 ? (
            <p className="muted center">אין מוצרים פעילים עם מחיר.</p>
          ) : (
            <div className="pl-body" style={{ columnCount: o.cols }}>
              {groups.map(([name, items]) => (
                <section key={name} className={'pl-group' + (o.mode === 'abc' ? ' abc' : '')}>
                  <h2>{name}</h2>
                  {items.map((p) => (
                    <div className="pl-row" key={p.id}>
                      {o.icons && <ProductThumb p={p} size={o.big ? 30 : 24} />}
                      <span className="pl-name">
                        {p.name}
                        {o.variants && p.variants.length > 1 && <small className="pl-vars"> ({p.variants.map((x) => x.name.replace(p.name, '').trim() || x.name).join(', ')})</small>}
                      </span>
                      <span className="pl-dots" />
                      <span className="pl-price">
                        {p.variants.length > 1 ? (
                          <>
                            {p.groupPromoUnit != null && <span className="pl-promo">מבצע {money(p.groupPromoUnit)} </span>}
                            {p.minPrice === p.maxPrice ? money(p.price) : `${money(p.minPrice)}–${money(p.maxPrice)}`}
                          </>
                        ) : (
                          <>
                        {(() => {
                          const up = unitPromoFor(p, promos)
                          const b = bundlesFor(p, promos)[0]
                          return (
                            <>
                              {up && <span className="pl-promo">מבצע {money(up.unit)} </span>}
                              {!up && b && <span className="pl-promo">{promoLabel(b)} · </span>}
                            </>
                          )
                        })()}
                        {money(p.price)}
                          </>
                        )}
                        {o.staff && p.staffPrice !== '' && p.staffPrice != null && Number(p.staffPrice) !== Number(p.price) && (
                          <small className="pl-staff"> מוכרים {money(p.staffPrice)}</small>
                        )}
                      </span>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}

          <footer className="pl-foot">
            המחירון מעודכן לתאריך <b>{date}</b>. ייתכנו שינויים מעת לעת — ולכן <b>המחיר בקופה הוא הקובע.</b>
          </footer>
        </div>
      </div>
      {picking && <PickProducts onClose={() => setPicking(false)} />}
    </div>,
    document.body
  )
}

// בחירה מהירה: מה מופיע במחירון, ואיזה מוצרים מתאחדים לשורה אחת
function PickProducts({ onClose }) {
  useVersion()
  const [q, setQ] = useState('')
  const all = list('product')
    .filter((p) => p.active !== false)
    .filter((p) => !q || p.name.includes(q) || (p.category || '').includes(q) || (p.priceGroup || '').includes(q))
    .sort((a, b) => (a.category || '').localeCompare(b.category || '', 'he') || a.name.localeCompare(b.name, 'he'))
  const groups = [...new Set(list('product').map((x) => x.priceGroup).filter(Boolean))]
  const upd = (p, patch) => save('product', { ...get('product', p.id), ...patch })
  const allOn = all.every((p) => p.inPriceList !== false)
  return (
    <Modal title="✎ מה מופיע במחירון" onClose={onClose} wide>
      <p className="muted small">מסמנים מה יופיע. כדי לאחד כמה סוגים לשורה אחת — כותבים לכולם אותו "שם במחירון" (למשל: דוריטוס).</p>
      <div className="row gap-s">
        <input placeholder="🔍 חיפוש מוצר / קטגוריה" value={q} onChange={(e) => setQ(e.target.value)} />
        <button
          className="btn small"
          onClick={() => {
            for (const p of all) upd(p, { inPriceList: !allOn })
            toast(allOn ? 'כולם הוצאו מהמחירון' : 'כולם נוספו למחירון')
          }}
        >
          {allOn ? 'הורד את כל המוצגים' : 'סמן את כל המוצגים'}
        </button>
      </div>
      <datalist id="pl-groups">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <div className="table-scroll" style={{ maxHeight: '60vh' }}>
        <table>
          <thead>
            <tr>
              <th>במחירון</th>
              <th>מוצר</th>
              <th>קטגוריה</th>
              <th>מחיר</th>
              <th>שם במחירון (איחוד)</th>
            </tr>
          </thead>
          <tbody>
            {all.map((p) => (
              <tr key={p.id} className={p.inPriceList === false ? 'dim' : ''}>
                <td>
                  <input type="checkbox" checked={p.inPriceList !== false} onChange={(e) => upd(p, { inPriceList: e.target.checked })} />
                </td>
                <td>{p.name}</td>
                <td className="small">{p.category || ''}</td>
                <td>{money(p.price)}</td>
                <td>
                  <GroupInput p={p} onSave={(g) => upd(p, { priceGroup: g })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

function GroupInput({ p, onSave }) {
  const [v, setV] = useState(p.priceGroup || '')
  const commit = () => v.trim() !== (p.priceGroup || '') && onSave(v.trim())
  return <input list="pl-groups" value={v} placeholder="—" onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} style={{ minWidth: 120 }} />
}
