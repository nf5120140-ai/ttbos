// ============================================================
// כפילויות ברקוד (מיזוג מוצרים עם ברקוד דומה) + יומן שינויים
// ============================================================
import { useMemo, useState } from 'react'
import { similarPairs, mergeProducts, gtinValid, stockOf, list } from './db.js'
import { Modal, money, ProductThumb, toast, confirmDlg, useVersion, fmtDT, Empty } from './ui.jsx'

function Side({ p, code, keep, onKeep }) {
  return (
    <label className={'dup-side' + (keep ? ' keep' : '')}>
      <input type="radio" checked={keep} onChange={onKeep} />
      <ProductThumb p={p} size={40} />
      <div>
        <b>{p.name}</b>
        <div className="muted small">
          <span dir="ltr">{code}</span> {gtinValid(code) ? '✓ תקני' : '⚠ לא תקני'}
        </div>
        <div className="muted small">
          מלאי {stockOf(p.id)} · {money(p.price || 0)}
        </div>
      </div>
    </label>
  )
}

export function DupTool({ user, onClose }) {
  const v = useVersion()
  const pairs = useMemo(() => similarPairs(), [v])
  const [keepMap, setKeepMap] = useState({})
  const keyOf = (x) => x.a.id + '|' + x.b.id
  // ברירת מחדל: שומרים את המוצר עם הברקוד התקני
  const keepOf = (x) => keepMap[keyOf(x)] || (gtinValid(x.bCode) && !gtinValid(x.aCode) ? 'b' : 'a')

  async function merge(x) {
    const k = keepOf(x)
    const keep = k === 'a' ? x.a : x.b
    const drop = k === 'a' ? x.b : x.a
    const keepCode = k === 'a' ? x.aCode : x.bCode
    const dropCode = k === 'a' ? x.bCode : x.aCode
    const ok = await confirmDlg(
      `למזג?\nנשאר: ${keep.name} (${keepCode})\nנמחק: ${drop.name} (${dropCode})\nהמלאי (${stockOf(drop.id)}) יתווסף למוצר שנשאר.\nהמכירות הקודמות נשארות בדוחות.`,
      '🔗 מזג',
      'ביטול',
      'primary',
    )
    if (!ok) return
    // ברקוד לא תקני של המוצר הנמחק לא נשמר (הוא היה שגוי)
    mergeProducts(keep.id, drop.id, user.id, { keepDropCode: gtinValid(dropCode) })
    toast('✓ המוצרים מוזגו')
  }
  function notSame(x) {
    // לא אותו מוצר — רק לסמן כדי שלא יופיע שוב
    const ign = JSON.parse(localStorage.getItem('tt_dup_ignore') || '[]')
    ign.push(keyOf(x))
    localStorage.setItem('tt_dup_ignore', JSON.stringify(ign))
    setKeepMap({ ...keepMap })
  }
  let ignored = []
  try {
    ignored = JSON.parse(localStorage.getItem('tt_dup_ignore') || '[]')
  } catch {}
  const rows = pairs.filter((x) => !ignored.includes(keyOf(x)))

  return (
    <Modal title="🔗 כפילויות ברקוד" onClose={onClose} wide>
      <p className="muted">
        מוצרים שהברקוד של אחד מהם הוא סוף של השני, או ש-5 הספרות האחרונות זהות (קורה כשמוצר הוכנס מקבלה עם ברקוד חתוך). בחר איזה מוצר להשאיר — השני יימחק והמלאי שלו יעבור.
      </p>
      {!rows.length && <Empty>אין כפילויות 👍</Empty>}
      {rows.map((x) => {
        const k = keepOf(x)
        const set = (s) => setKeepMap({ ...keepMap, [keyOf(x)]: s })
        return (
          <div key={keyOf(x)} className="dup-row">
            <Side p={x.a} code={x.aCode} keep={k === 'a'} onKeep={() => set('a')} />
            <Side p={x.b} code={x.bCode} keep={k === 'b'} onKeep={() => set('b')} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button className="btn primary small" onClick={() => merge(x)}>
                🔗 מזג (שמור את המסומן)
              </button>
              <button className="btn small" onClick={() => notSame(x)}>
                לא אותו מוצר
              </button>
            </div>
          </div>
        )
      })}
    </Modal>
  )
}

const ACTIONS = {
  merge: '🔗 מיזוג',
  barcode_fix: '✏ תיקון ברקוד',
  barcode_add: '➕ ברקוד נוסף',
  delete: '🗑 מחיקה',
  update: '✏ עדכון מוצר',
  stock: '📦 עדכון מלאי',
}

export function AuditLog({ onClose }) {
  const v = useVersion()
  const members = new Map(list('user').map((m) => [m.id, m.name]))
  const rows = useMemo(() => list('audit').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 500), [v])
  return (
    <Modal title="📜 יומן שינויים" onClose={onClose} wide>
      {!rows.length && <Empty>אין עדיין רשומות</Empty>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>מתי</th>
                <th>פעולה</th>
                <th>פרטים</th>
                <th>מי</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.createdAt ? fmtDT(r.createdAt) : ''}</td>
                  <td>{ACTIONS[r.action] || r.action}</td>
                  <td>{describe(r)}</td>
                  <td>{members.get(r.userId) || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

function describe(r) {
  switch (r.action) {
    case 'merge':
      return `"${r.droppedName}" (${(r.droppedCodes || []).join(', ')}) מוזג לתוך "${r.productName}"` + (r.stockMoved ? ` · הועברו ${r.stockMoved} יח'` : '')
    case 'barcode_fix':
      return `${r.productName}: ${r.oldCode} ← ${r.newCode}`
    case 'barcode_add':
      return `${r.productName}: נוסף ${r.code}`
    case 'delete':
      return `${r.productName}` + (r.codes?.length ? ` (${r.codes.join(', ')})` : '')
    case 'stock':
      return `${r.productName}: ${r.from} ← ${r.to}`
    default:
      return r.productName || ''
  }
}
