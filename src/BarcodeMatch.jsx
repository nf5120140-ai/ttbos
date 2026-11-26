// ============================================================
// ברקוד דומה למוצר קיים — "האם התכוונת ל…?"
// קורה בעיקר כשמוצרים הוכנסו עם ברקוד חתוך (למשל מקבלה: 8753111 במקום 7290008753111).
// askSimilar(code) → Promise<{action:'use', product} | {action:'new'} | null>
// ============================================================
import { useEffect, useState } from 'react'
import { similarProducts, gtinValid, fixBarcode, digitsOf, stockOf, get, save, audit } from './db.js'
import { Modal, money, ProductThumb } from './ui.jsx'

let setter = null

/** מחזיר null מיד אם אין מוצר דומה */
export function askSimilar(code, { userId, allowNew = true, newLabel = 'לא — זה מוצר חדש' } = {}) {
  const cands = similarProducts(code)
  if (!cands.length || !setter) return Promise.resolve(null)
  return new Promise((resolve) => setter({ code, cands, userId, allowNew, newLabel, resolve }))
}

// מדגיש את החלק המשותף בסוף הברקוד
function Code({ code, other }) {
  const a = String(code)
  const b = digitsOf(other)
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return (
    <span dir="ltr" className="bc-code">
      {a.slice(0, a.length - n)}
      <b>{a.slice(a.length - n)}</b>
    </span>
  )
}

export function SimilarHost() {
  const [s, setS] = useState(null)
  useEffect(() => {
    setter = setS
    return () => {
      if (setter === setS) setter = null
    }
  }, [])
  if (!s) return null
  const done = (v) => {
    s.resolve(v)
    setS(null)
  }
  const valid = gtinValid(s.code)
  return (
    <Modal title="🔎 ברקוד דומה למוצר שכבר קיים" onClose={() => done(null)}>
      <p>
        סרקת <Code code={s.code} other={s.cands[0].code} />{' '}
        {valid ? <span className="ok-text small">✓ ברקוד תקני</span> : <span className="neg small">⚠ ברקוד לא תקני</span>}
      </p>
      <p className="muted small">יש מוצר עם ברקוד דומה — כנראה אותו מוצר שהוכנס עם ברקוד חתוך. האם התכוונת ל…</p>
      {s.cands.map(({ p, code, why }) => {
        const otherValid = gtinValid(code)
        return (
          <div key={p.id} className="bc-cand">
            <div className="row gap-s" style={{ alignItems: 'center' }}>
              <ProductThumb p={p} size={44} />
              <div className="grow">
                <b>{p.name}</b>
                <div className="small">
                  ברקוד במערכת: <Code code={code} other={s.code} /> {otherValid ? <span className="ok-text">✓</span> : <span className="neg">⚠ {why === 'suffix' ? 'חתוך' : 'לא תקני'}</span>}
                </div>
                <div className="muted small">
                  במלאי {stockOf(p.id)} · {money(p.price)}
                </div>
              </div>
            </div>
            <div className="row gap-s wrap" style={{ marginTop: 6 }}>
              {valid && !otherValid ? (
                <button
                  className="btn primary"
                  onClick={() => {
                    fixBarcode(p.id, code, s.code, s.userId)
                    done({ action: 'use', product: get('product', p.id) })
                  }}
                >
                  ✓ זה המוצר — תקן את הברקוד ל-{s.code}
                </button>
              ) : (
                <button
                  className="btn primary"
                  onClick={() => {
                    const cur = get('product', p.id)
                    save('product', { ...cur, barcodes: [...(cur.barcodes || []), s.code] })
                    audit('barcode_add', { productId: p.id, productName: p.name, newCode: s.code, similarTo: code }, s.userId)
                    done({ action: 'use', product: get('product', p.id) })
                  }}
                >
                  ✓ זה המוצר — הוסף את {s.code} כברקוד נוסף
                </button>
              )}
              {valid && !otherValid && (
                <button
                  className="btn"
                  onClick={() => {
                    const cur = get('product', p.id)
                    save('product', { ...cur, barcodes: [...(cur.barcodes || []), s.code] })
                    audit('barcode_add', { productId: p.id, productName: p.name, newCode: s.code, similarTo: code }, s.userId)
                    done({ action: 'use', product: get('product', p.id) })
                  }}
                >
                  זה המוצר — השאר גם את הברקוד הישן
                </button>
              )}
            </div>
          </div>
        )
      })}
      <div className="row gap-s" style={{ marginTop: 10 }}>
        {s.allowNew && (
          <button className="btn grow" onClick={() => done({ action: 'new' })}>
            ➕ {s.newLabel}
          </button>
        )}
        <button className="btn" onClick={() => done(null)}>
          ביטול
        </button>
      </div>
    </Modal>
  )
}
