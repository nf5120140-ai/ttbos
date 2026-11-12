// ============================================================
// תתבוס — מחירון להדפסה ולתליה
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { list, getSetting } from './db.js'
import { money, ProductThumb } from './ui.jsx'
import { unitPromoFor, bundlesFor, livePromos, promoLabel } from './pricing.js'

const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem('tt_pricelist') || '{}')
  } catch {
    return {}
  }
}

export function PriceList({ onClose }) {
  const [o, setO] = useState(() => ({ mode: 'category', cols: 2, staff: false, icons: true, big: false, ...loadPrefs() }))
  const set = (k, v) => setO((p) => ({ ...p, [k]: v }))
  useEffect(() => {
    try {
      localStorage.setItem('tt_pricelist', JSON.stringify(o))
    } catch {}
  }, [o])

  const g = getSetting('general')
  const title = g.title || 'המזנון'
  const date = new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const products = useMemo(
    () =>
      list('product')
        .filter((p) => p.active !== false && Number(p.price) > 0)
        .sort((a, b) => a.name.localeCompare(b.name, 'he')),
    []
  )
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

  const promos = useMemo(() => livePromos(), [])
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
                      <span className="pl-name">{p.name}</span>
                      <span className="pl-dots" />
                      <span className="pl-price">
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
    </div>,
    document.body
  )
}
