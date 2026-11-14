// ============================================================
// תתבוס — ייבוא / ייצוא מוצרים באקסל
// ============================================================
import { useMemo, useState } from 'react'
import { list, saveMany, stockOf, uid, nowIso, deviceId } from './db.js'
import { Modal, Toggle, money, toast } from './ui.jsx'

const loadXlsx = () => import('xlsx')

// שדות המוצר + שמות עמודות אפשריים (זיהוי אוטומטי)
const FIELDS = [
  { key: 'name', label: 'שם מוצר', required: true, alias: ['שם', 'שם מוצר', 'מוצר', 'תיאור', 'פריט', 'name', 'product', 'item', 'description'] },
  { key: 'price', label: 'מחיר מכירה', required: true, alias: ['מחיר', 'מחיר מכירה', 'מחיר לצרכן', 'price', 'sale price'] },
  { key: 'category', label: 'קטגוריה', alias: ['קטגוריה', 'קבוצה', 'מחלקה', 'סוג', 'category', 'group'] },
  { key: 'barcode', label: 'ברקוד', alias: ['ברקוד', 'מק"ט', 'מקט', 'קוד', 'barcode', 'sku', 'code', 'ean'] },
  { key: 'staffPrice', label: 'מחיר מוכרים', alias: ['מחיר מוכרים', 'מחיר עובד', 'מחיר צוות', 'staff price'] },
  { key: 'cost', label: 'מחיר עלות', alias: ['עלות', 'מחיר עלות', 'מחיר קנייה', 'קנייה', 'cost'] },
  { key: 'stock', label: 'מלאי', alias: ['מלאי', 'כמות', 'כמות במלאי', 'stock', 'qty', 'quantity'] },
  { key: 'minStock', label: 'מלאי מינימום', alias: ['מינימום', 'מלאי מינימום', 'min', 'min stock'] },
  { key: 'parStock', label: 'מלאי רצוי', alias: ['מלאי רצוי', 'רצוי', 'מקסימום', 'par', 'max'] },
  { key: 'supplier', label: 'ספק', alias: ['ספק', 'supplier', 'vendor'] },
]

const norm = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/["'״׳]/g, '')
    .replace(/\s+/g, ' ')
const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(/[₪,\s]/g, ''))
  return isFinite(n) ? n : null
}

export async function exportProducts() {
  const XLSX = await loadXlsx()
  const sup = new Map(list('supplier').map((s) => [s.id, s.name]))
  const rows = list('product')
    .sort((a, b) => (a.category || '').localeCompare(b.category || '', 'he') || a.name.localeCompare(b.name, 'he'))
    .map((p) => ({
      'שם מוצר': p.name,
      קטגוריה: p.category || '',
      'מחיר מכירה': p.price ?? '',
      'מחיר מוכרים': p.staffPrice ?? '',
      'מחיר עלות': p.cost ?? '',
      ברקוד: p.barcode || '',
      מלאי: stockOf(p.id),
      'מלאי מינימום': p.minStock ?? '',
      'מלאי רצוי': p.parStock ?? '',
      ספק: sup.get(p.supplierId) || '',
      פעיל: p.active === false ? 'לא' : 'כן',
    }))
  downloadSheet(XLSX, rows.length ? rows : [templateRow()], `מוצרים-${new Date().toLocaleDateString('he-IL').replace(/\./g, '-')}.xlsx`)
}

function templateRow() {
  return { 'שם מוצר': 'במבה', קטגוריה: 'חטיפים', 'מחיר מכירה': 5, 'מחיר מוכרים': 4, 'מחיר עלות': 2.5, ברקוד: '7290000066318', מלאי: 30, 'מלאי מינימום': 10, 'מלאי רצוי': 40, ספק: 'שטראוס' }
}

function downloadSheet(XLSX, rows, filename) {
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = Object.keys(rows[0]).map((k) => ({ wch: Math.max(10, k.length + 4) }))
  ws['!rightToLeft'] = true
  const wb = XLSX.utils.book_new()
  wb.Workbook = { Views: [{ RTL: true }] }
  XLSX.utils.book_append_sheet(wb, ws, 'מוצרים')
  XLSX.writeFile(wb, filename)
}

export function ImportProducts({ user, onClose }) {
  const [sheet, setSheet] = useState(null) // { headers, rows, fileName }
  const [map, setMap] = useState({}) // fieldKey -> header index
  const [updateExisting, setUpdateExisting] = useState(true)
  const [updateStock, setUpdateStock] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function template() {
    const XLSX = await loadXlsx()
    downloadSheet(XLSX, [templateRow()], 'תבנית-מוצרים.xlsx')
  }

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErr('')
    setBusy(true)
    try {
      const XLSX = await loadXlsx()
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }).filter((r) => r.some((c) => String(c).trim() !== ''))
      if (all.length < 2) throw new Error('הקובץ ריק או שאין בו שורות מעבר לכותרות')
      // שורת הכותרות = הראשונה שיש בה לפחות 2 התאמות
      let hIdx = 0
      for (let i = 0; i < Math.min(5, all.length); i++) {
        const hits = all[i].filter((c) => FIELDS.some((f) => f.alias.includes(norm(c)))).length
        if (hits >= 2) {
          hIdx = i
          break
        }
      }
      const headers = all[hIdx].map((h, i) => String(h).trim() || `עמודה ${i + 1}`)
      const rows = all.slice(hIdx + 1)
      const auto = {}
      FIELDS.forEach((f) => {
        const i = headers.findIndex((h) => f.alias.includes(norm(h)))
        if (i >= 0 && !Object.values(auto).includes(i)) auto[f.key] = i
      })
      setMap(auto)
      setSheet({ headers, rows, fileName: file.name })
    } catch (x) {
      setErr('לא הצלחתי לקרוא את הקובץ: ' + (x.message || x))
    }
    setBusy(false)
  }

  // ---- ניתוח השורות ----
  const analysis = useMemo(() => {
    if (!sheet) return null
    const existing = list('product')
    const byBarcode = new Map(existing.filter((p) => p.barcode).map((p) => [String(p.barcode).trim(), p]))
    const byName = new Map(existing.map((p) => [norm(p.name), p]))
    const seen = new Set()
    const get = (r, k) => (map[k] != null ? r[map[k]] : '')
    return sheet.rows.map((r, i) => {
      const name = String(get(r, 'name') ?? '').trim()
      const barcode = String(get(r, 'barcode') ?? '').trim().replace(/\.0+$/, '')
      const price = num(get(r, 'price'))
      const row = {
        line: i + 1,
        name,
        barcode,
        price,
        category: String(get(r, 'category') ?? '').trim(),
        staffPrice: num(get(r, 'staffPrice')),
        cost: num(get(r, 'cost')),
        stock: num(get(r, 'stock')),
        minStock: num(get(r, 'minStock')),
        parStock: num(get(r, 'parStock')),
        supplier: String(get(r, 'supplier') ?? '').trim(),
      }
      const match = (barcode && byBarcode.get(barcode)) || byName.get(norm(name))
      const key = barcode || norm(name)
      if (!name) return { ...row, status: 'error', why: 'חסר שם' }
      if (seen.has(key)) return { ...row, status: 'error', why: 'כפול בקובץ' }
      seen.add(key)
      if (match) return { ...row, status: updateExisting ? 'update' : 'skip', match }
      if (price == null || price < 0) return { ...row, status: 'error', why: 'חסר מחיר' }
      return { ...row, status: 'new' }
    })
  }, [sheet, map, updateExisting])

  const counts = analysis
    ? analysis.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {})
    : {}

  function doImport() {
    if (map.name == null) return setErr('צריך לבחור איזו עמודה היא "שם מוצר"')
    setBusy(true)
    const suppliers = new Map(list('supplier').map((s) => [norm(s.name), s.id]))
    const ops = []
    const supId = (name) => {
      if (!name) return null
      const k = norm(name)
      if (!suppliers.has(k)) {
        const id = uid()
        ops.push(['supplier', { id, name }])
        suppliers.set(k, id)
      }
      return suppliers.get(k)
    }
    const now = nowIso()
    let added = 0,
      updated = 0
    for (const r of analysis) {
      if (r.status === 'new') {
        const id = uid()
        ops.push([
          'product',
          {
            id,
            name: r.name,
            category: r.category || 'כללי',
            price: r.price,
            staffPrice: r.staffPrice ?? '',
            cost: r.cost ?? '',
            barcode: r.barcode,
            minStock: r.minStock ?? 5,
            parStock: r.parStock ?? 20,
            supplierId: supId(r.supplier),
            emoji: '📦',
            active: true,
          },
        ])
        if (r.stock) ops.push(['stock', { id: uid(), productId: id, qty: r.stock, reason: 'import', userId: user.id, createdAt: now, device: deviceId() }])
        added++
      } else if (r.status === 'update') {
        const p = r.match
        const patch = { ...p }
        if (r.name) patch.name = r.name
        if (r.price != null) patch.price = r.price
        if (r.category) patch.category = r.category
        if (r.staffPrice != null) patch.staffPrice = r.staffPrice
        if (r.cost != null) patch.cost = r.cost
        if (r.barcode) patch.barcode = r.barcode
        if (r.minStock != null) patch.minStock = r.minStock
        if (r.parStock != null) patch.parStock = r.parStock
        if (r.supplier) patch.supplierId = supId(r.supplier)
        ops.push(['product', patch])
        if (updateStock && r.stock != null) {
          const diff = Math.round((r.stock - stockOf(p.id)) * 100) / 100
          if (diff) ops.push(['stock', { id: uid(), productId: p.id, qty: diff, reason: 'adjust', userId: user.id, createdAt: now, device: deviceId() }])
        }
        updated++
      }
    }
    if (ops.length) saveMany(ops)
    toast(`✓ נוספו ${added} מוצרים · עודכנו ${updated}`)
    setBusy(false)
    onClose()
  }

  return (
    <Modal title="📥 ייבוא מוצרים מאקסל" onClose={onClose} wide>
      {!sheet ? (
        <>
          <p className="muted">
            מעלים קובץ אקסל (או CSV) עם רשימת מוצרים. השורה הראשונה = כותרות. המערכת מזהה לבד עמודות כמו <b>שם, מחיר, קטגוריה, ברקוד, עלות, מלאי, ספק</b>.
          </p>
          <div className="row gap-s wrap">
            <label className="btn primary big grow">
              {busy ? 'קורא…' : '📂 בחר קובץ אקסל'}
              <input type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" hidden onChange={pick} />
            </label>
            <button className="btn big" onClick={template}>
              ⬇ הורד תבנית לדוגמה
            </button>
          </div>
          <p className="muted small">💡 אפשר גם לייצא את המוצרים הקיימים (כפתור "ייצוא לאקסל"), לערוך באקסל, ולייבא חזרה — מוצרים קיימים יתעדכנו לפי ברקוד או שם.</p>
        </>
      ) : (
        <>
          <div className="row space wrap">
            <b>📄 {sheet.fileName}</b>
            <button className="btn small" onClick={() => setSheet(null)}>
              קובץ אחר
            </button>
          </div>
          <details open={map.name == null || map.price == null}>
            <summary className="muted">התאמת עמודות {map.name == null || map.price == null ? '— חובה לבחור שם ומחיר' : '(זוהה אוטומטית)'}</summary>
            <div className="map-grid">
              {FIELDS.map((f) => (
                <label key={f.key} className="field">
                  <span>
                    {f.label}
                    {f.required && ' *'}
                  </span>
                  <select value={map[f.key] ?? ''} onChange={(e) => setMap({ ...map, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                    <option value="">— לא בקובץ —</option>
                    {sheet.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </details>
          <Toggle checked={updateExisting} onChange={setUpdateExisting} label="לעדכן מוצרים שכבר קיימים (לפי ברקוד או שם)" />
          {updateExisting && map.stock != null && <Toggle checked={updateStock} onChange={setUpdateStock} label="לעדכן גם את המלאי של מוצרים קיימים לכמות שבקובץ" />}

          <div className="imp-counts">
            <span className="tag st-received">חדשים: {counts.new || 0}</span>
            <span className="tag st-sent">לעדכון: {counts.update || 0}</span>
            {counts.skip ? <span className="tag st-cancelled">קיימים (לא יעודכנו): {counts.skip}</span> : null}
            {counts.error ? <span className="tag imp-err">שגיאות: {counts.error}</span> : null}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>מצב</th>
                  <th>שם</th>
                  <th>קטגוריה</th>
                  <th>מחיר</th>
                  <th>מוכרים</th>
                  <th>עלות</th>
                  <th>ברקוד</th>
                  <th>מלאי</th>
                  <th>ספק</th>
                </tr>
              </thead>
              <tbody>
                {analysis.slice(0, 300).map((r) => (
                  <tr key={r.line} className={'imp-' + r.status}>
                    <td>{r.line}</td>
                    <td className="nowrap">
                      {{ new: '➕ חדש', update: '✎ עדכון', skip: '— קיים', error: '⚠ ' + r.why }[r.status]}
                    </td>
                    <td>
                      {r.name}
                      {r.status === 'update' && r.match.name !== r.name && <small className="muted"> (היה: {r.match.name})</small>}
                    </td>
                    <td>{r.category}</td>
                    <td>
                      {r.price != null ? money(r.price) : ''}
                      {r.status === 'update' && r.price != null && Number(r.match.price) !== r.price && <small className="muted"> (היה {money(r.match.price)})</small>}
                    </td>
                    <td>{r.staffPrice != null ? money(r.staffPrice) : ''}</td>
                    <td>{r.cost != null ? money(r.cost) : ''}</td>
                    <td className="small">{r.barcode}</td>
                    <td>{r.stock ?? ''}</td>
                    <td className="small">{r.supplier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {analysis.length > 300 && <p className="muted center small">מוצגות 300 שורות ראשונות מתוך {analysis.length}</p>}
          </div>
          {err && <div className="err">{err}</div>}
          <button className="btn green big grow" disabled={busy || !((counts.new || 0) + (counts.update || 0))} onClick={doImport}>
            ✓ ייבא {(counts.new || 0) + (counts.update || 0)} מוצרים
          </button>
        </>
      )}
      {err && !sheet && <div className="err">{err}</div>}
    </Modal>
  )
}

