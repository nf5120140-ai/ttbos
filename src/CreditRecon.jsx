// 💳 התאמת אשראי מול נדרים פלוס
// צד הקופה: מכירות וטעינות במסופון (מספר אישור שהמוכר הקליד) + אשראי אונליין (מספר אישור שנדרים החזירו)
// צד נדרים: קובץ אקסל/CSV שמורידים מנדרים פלוס. ההתאמה לפי מספר אישור, ואם אין — לפי סכום ותאריך.
import { useMemo, useRef, useState } from 'react'
import { list, getAny, round2 } from './db.js'
import { money, fmtDT, toast, Empty } from './ui.jsx'

const loadXlsx = () => import('xlsx')

const normConf = (v) =>
  String(v ?? '')
    .replace(/\.0+$/, '')
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
const sameDay = (a, b) => a && b && Math.abs(new Date(a) - new Date(b)) < 36 * 3600e3 // עד יום וחצי הפרש (שעות/אזור זמן)

// ---------- צד הקופה ----------
export function registerCredit(sIso, eIso, users) {
  const rows = []
  const custName = (id) => (id ? getAny('customer', id)?.name || '' : '')
  for (const s of list('sale'))
    if (s.payment === 'terminal' && s.createdAt >= sIso && s.createdAt < eIso)
      rows.push({
        id: 's' + s.id,
        kind: 'מכירה · מסופון',
        date: s.createdAt,
        amount: s.total,
        conf: s.terminal?.confirmation || '',
        phone: s.terminal?.phone || '',
        last4: s.terminal?.last4 || '',
        who: users.get(s.sellerId) || '',
        cust: custName(s.customerId),
        voided: !!s.voided,
      })
  for (const w of list('wallet'))
    if (w.type === 'topup' && w.method === 'terminal' && w.createdAt >= sIso && w.createdAt < eIso)
      rows.push({
        id: 'w' + w.id,
        kind: 'טעינת ארנק · מסופון',
        date: w.createdAt,
        amount: w.amount,
        conf: w.terminal?.confirmation || '',
        phone: w.terminal?.phone || '',
        last4: w.terminal?.last4 || '',
        who: users.get(w.userId) || '',
        cust: custName(w.customerId),
        voided: !!w.voided,
      })
  for (const p of list('payment')) {
    const d = p.paidAt || p.createdAt
    if (!['paid', 'client_ok', 'suspicious'].includes(p.status) || d < sIso || d >= eIso) continue
    rows.push({
      id: 'p' + p.id,
      kind: (p.purpose === 'topup' || p.purpose === 'parent_topup' ? 'טעינת ארנק' : 'מכירה') + ' · אונליין',
      date: d,
      amount: p.amount,
      conf: p.confirmation || p.clientResponse?.Confirmation || '',
      phone: p.phone || '',
      last4: p.lastNum || p.clientResponse?.LastNum || '',
      who: users.get(p.userId) || p.payerName || '',
      cust: custName(p.customerId),
      nedarimId: p.historyId || p.clientResponse?.ID || '',
      voided: false,
      suspicious: p.status === 'suspicious',
    })
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1))
}

// ---------- קריאת הקובץ של נדרים ----------
const COLS = {
  conf: ['מספר אישור', 'מס אישור', 'מס. אישור', 'אישור', 'confirmation', 'approval', 'קוד אישור'],
  amount: ['סכום', 'סכום עסקה', 'סכום העסקה', 'סה"כ', 'amount', 'sum', 'סך'],
  date: ['תאריך', 'תאריך עסקה', 'תאריך ושעה', 'זמן', 'date', 'transactiontime', 'time'],
  nid: ['מזהה', 'מס עסקה', 'מספר עסקה', 'id', 'transactionid', 'מזהה עסקה'],
  name: ['שם', 'שם לקוח', 'שם בעל הכרטיס', 'clientname', 'name', 'תורם'],
  phone: ['טלפון', 'נייד', 'phone'],
  last4: ['4 ספרות', 'ספרות אחרונות', 'lastnum', 'כרטיס', 'מספר כרטיס'],
  status: ['סטטוס', 'מצב', 'status'],
}
const LABEL = { conf: 'מספר אישור', amount: 'סכום', date: 'תאריך', nid: 'מזהה עסקה', name: 'שם', phone: 'טלפון', last4: '4 ספרות', status: 'סטטוס' }
const clean = (h) => String(h ?? '').toLowerCase().replace(/["'׳״.]/g, '').replace(/\s+/g, ' ').trim()

function detect(header) {
  const map = {}
  header.forEach((h, idx) => {
    const c = clean(h)
    if (!c) return
    for (const [k, aliases] of Object.entries(COLS)) {
      if (map[k] != null) continue
      if (aliases.some((a) => c === clean(a))) map[k] = idx
    }
  })
  // התאמה חלקית (למשל "סכום ב-₪")
  header.forEach((h, idx) => {
    const c = clean(h)
    if (!c || Object.values(map).includes(idx)) return
    for (const [k, aliases] of Object.entries(COLS)) if (map[k] == null && aliases.some((a) => clean(a).length > 2 && c.includes(clean(a)))) map[k] = idx
  })
  return map
}

function parseDate(v) {
  if (v == null || v === '') return ''
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 864e5))
    return new Date(d.getTime() + d.getTimezoneOffset() * 60000).toISOString() // סדרה של אקסל = שעון מקומי
  }
  if (v instanceof Date) return v.toISOString()
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return new Date(y, Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)).toISOString()
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)).toISOString()
  return ''
}
const parseAmount = (v) => {
  if (typeof v === 'number') return v
  const n = Number(String(v ?? '').replace(/[₪,\s]/g, '').replace(/[^\d.-]/g, ''))
  return isNaN(n) ? 0 : n
}

async function readNedarimFile(file) {
  const XLSX = await loadXlsx()
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', codepage: 1255 })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }).filter((r) => r.some((c) => String(c).trim() !== ''))
  // שורת הכותרת = השורה הראשונה (מתוך 15) שיש בה גם אישור/סכום
  let hi = 0
  let best = -1
  for (let i = 0; i < Math.min(15, all.length); i++) {
    const m = detect(all[i])
    const score = (m.conf != null ? 2 : 0) + (m.amount != null ? 2 : 0) + Object.keys(m).length
    if (score > best) {
      best = score
      hi = i
    }
  }
  return { header: all[hi] || [], rows: all.slice(hi + 1), map: detect(all[hi] || []) }
}

function toNedarimRows(rows, map) {
  const g = (r, k) => (map[k] != null ? r[map[k]] : '')
  return rows
    .map((r, i) => {
      const status = String(g(r, 'status') || '')
      let amount = parseAmount(g(r, 'amount'))
      if (/בוטל|זיכוי|refund|cancel/i.test(status) && amount > 0) amount = -amount
      return {
        id: 'n' + i,
        conf: String(g(r, 'conf') ?? '').replace(/\.0+$/, '').trim(),
        amount: round2(amount),
        date: parseDate(g(r, 'date')),
        nid: String(g(r, 'nid') ?? '').replace(/\.0+$/, ''),
        name: String(g(r, 'name') || ''),
        phone: String(g(r, 'phone') || ''),
        last4: String(g(r, 'last4') || '').replace(/\.0+$/, '').slice(-4),
        status,
      }
    })
    .filter((r) => r.amount !== 0 || r.conf)
}

// ---------- ההתאמה ----------
export function reconcile(reg, ned, sIso, eIso) {
  const out = []
  const used = new Set()
  const byConf = new Map()
  for (const n of ned) {
    const c = normConf(n.conf)
    if (c) byConf.set(c, [...(byConf.get(c) || []), n])
  }
  const regLive = reg.filter((r) => !r.voided)
  const pending = []
  for (const r of regLive) {
    const c = normConf(r.conf)
    const cand = c ? (byConf.get(c) || []).find((n) => !used.has(n.id)) : null
    if (cand) {
      used.add(cand.id)
      out.push({ status: Math.abs(cand.amount - r.amount) < 0.01 ? 'ok' : 'amount', reg: r, ned: cand })
    } else pending.push(r)
  }
  // בלי מספר אישור תואם — מנסים לפי סכום + אותו יום (+ 4 ספרות אם יש)
  for (const r of pending) {
    const cand = ned.find(
      (n) => !used.has(n.id) && Math.abs(n.amount - r.amount) < 0.01 && sameDay(n.date, r.date) && (!r.last4 || !n.last4 || n.last4 === String(r.last4).slice(-4))
    )
    if (cand) {
      used.add(cand.id)
      out.push({ status: 'byAmount', reg: r, ned: cand })
    } else out.push({ status: 'noNedarim', reg: r, ned: null })
  }
  for (const n of ned)
    if (!used.has(n.id)) out.push({ status: n.date && (n.date < sIso || n.date >= eIso) ? 'outside' : 'noRegister', reg: null, ned: n })
  for (const r of reg.filter((x) => x.voided)) out.push({ status: 'voided', reg: r, ned: null })
  const d = (x) => x.reg?.date || x.ned?.date || ''
  return out.sort((a, b) => (d(a) < d(b) ? -1 : 1))
}

const ST = {
  ok: ['✓ תואם', 'ok'],
  byAmount: ['⚠ תואם לפי סכום (מס׳ אישור שונה/חסר)', 'warn'],
  amount: ['⚠ סכום שונה', 'warn'],
  noNedarim: ['❌ בקופה בלבד — לא נמצא בנדרים', 'bad'],
  noRegister: ['❌ בנדרים בלבד — לא נרשם בקופה', 'bad'],
  outside: ['מחוץ לתקופה שנבחרה', 'muted'],
  voided: ['בוטל בקופה', 'muted'],
}

async function exportXlsx(rows, fileName, sheet) {
  const XLSX = await loadXlsx()
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = Object.keys(rows[0] || {}).map((k) => ({ wch: Math.max(10, k.length + 4) }))
  ws['!views'] = [{ RTL: true }]
  const wb = XLSX.utils.book_new()
  wb.Workbook = { Views: [{ RTL: true }] }
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.writeFile(wb, fileName)
}
const dParts = (iso) => (iso ? [new Date(iso).toLocaleDateString('he-IL'), new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })] : ['', ''])

// ---------- המסך ----------
export function CreditRecon({ sIso, eIso, users, fileTag }) {
  const reg = useMemo(() => registerCredit(sIso, eIso, users), [sIso, eIso, users])
  const fileRef = useRef(null)
  const [file, setFile] = useState(null) // {name, header, rows, map}
  const [filter, setFilter] = useState('problems')
  const ned = useMemo(() => (file && file.map.amount != null ? toNedarimRows(file.rows, file.map) : null), [file])
  const result = useMemo(() => (ned ? reconcile(reg, ned, sIso, eIso) : null), [reg, ned, sIso, eIso])

  const regTotal = round2(reg.filter((r) => !r.voided).reduce((a, r) => a + r.amount, 0))
  const missingConf = reg.filter((r) => !r.voided && !r.conf).length

  const exportRegister = () => {
    if (!reg.length) return toast('אין עסקאות אשראי בתקופה', 'err')
    exportXlsx(
      reg.map((r) => {
        const [d, t] = dParts(r.date)
        return { תאריך: d, שעה: t, סוג: r.kind, 'מספר אישור': r.conf, סכום: r.amount, טלפון: r.phone, '4 ספרות': r.last4, בחור: r.cust, מוכר: r.who, 'מזהה נדרים': r.nedarimId || '', מצב: r.voided ? 'בוטל' : r.suspicious ? 'לבדיקה' : '' }
      }),
      `ashrai-kupa-${fileTag}.xlsx`,
      'אשראי בקופה'
    )
  }
  const exportCompare = () =>
    exportXlsx(
      result.map((x) => {
        const [d, t] = dParts(x.reg?.date || x.ned?.date)
        return {
          סטטוס: ST[x.status][0],
          תאריך: d,
          שעה: t,
          סוג: x.reg?.kind || '',
          'מספר אישור בקופה': x.reg?.conf || '',
          'מספר אישור בנדרים': x.ned?.conf || '',
          'סכום בקופה': x.reg ? x.reg.amount : '',
          'סכום בנדרים': x.ned ? x.ned.amount : '',
          הפרש: x.reg && x.ned ? round2(x.ned.amount - x.reg.amount) : '',
          טלפון: x.reg?.phone || x.ned?.phone || '',
          '4 ספרות': x.reg?.last4 || x.ned?.last4 || '',
          'שם בנדרים': x.ned?.name || '',
          מוכר: x.reg?.who || '',
          'מזהה נדרים': x.ned?.nid || x.reg?.nedarimId || '',
        }
      }),
      `hatama-nedarim-${fileTag}.xlsx`,
      'התאמה'
    )

  async function onFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const r = await readNedarimFile(f)
      if (!r.rows.length) return toast('הקובץ ריק', 'err')
      setFile({ name: f.name, ...r })
      setFilter('problems')
    } catch (x) {
      toast('לא הצלחתי לקרוא את הקובץ: ' + (x.message || x), 'err')
    }
  }

  const counts = {}
  for (const x of result || []) counts[x.status] = (counts[x.status] || 0) + 1
  const problems = (counts.byAmount || 0) + (counts.amount || 0) + (counts.noNedarim || 0) + (counts.noRegister || 0)
  const shown = (result || []).filter((x) => filter === 'all' || (filter === 'problems' ? ['byAmount', 'amount', 'noNedarim', 'noRegister'].includes(x.status) : x.status === filter))
  const nedTotal = ned ? round2(ned.filter((n) => !n.date || (n.date >= sIso && n.date < eIso)).reduce((a, n) => a + n.amount, 0)) : 0

  return (
    <div className="card">
      <h3>💳 התאמת אשראי מול נדרים</h3>
      <p className="muted small">
        בתקופה: {reg.filter((r) => !r.voided).length} עסקאות אשראי בקופה · {money(regTotal)}
        {missingConf > 0 && <span className="neg"> · ל-{missingConf} חסר מספר אישור</span>}
      </p>
      <div className="row gap-s wrap">
        <button className="btn" onClick={exportRegister}>
          ⬇ טבלת עסקאות האשראי (אקסל)
        </button>
        <button className="btn primary" onClick={() => fileRef.current?.click()}>
          📂 העלאת דו״ח מנדרים להשוואה
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onFile} />
        {result && (
          <button className="btn" onClick={exportCompare}>
            ⬇ ייצוא ההשוואה (אקסל)
          </button>
        )}
      </div>

      {file && (
        <div className="recon-map">
          <p className="small">
            📄 {file.name} · {file.rows.length} שורות. העמודות שזוהו — אפשר לתקן:
          </p>
          <div className="row gap-s wrap">
            {['conf', 'amount', 'date', 'last4', 'phone', 'nid', 'status'].map((k) => (
              <label key={k} className="small">
                {LABEL[k]}
                {(k === 'conf' || k === 'amount') && ' *'}
                <select value={file.map[k] ?? ''} onChange={(e) => setFile({ ...file, map: { ...file.map, [k]: e.target.value === '' ? undefined : Number(e.target.value) } })}>
                  <option value="">—</option>
                  {file.header.map((h, i) => (
                    <option key={i} value={i}>
                      {String(h || `עמודה ${i + 1}`)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {file.map.amount == null && <p className="neg small">בחר את עמודת הסכום כדי להשוות</p>}
          {file.map.conf == null && file.map.amount != null && <p className="muted small">בלי עמודת מספר אישור ההשוואה תהיה לפי סכום ותאריך בלבד</p>}
        </div>
      )}

      {result && (
        <>
          <div className="kpis">
            <div className={'kpi' + (problems ? ' warn' : '')}>
              <span>{problems ? 'לבדיקה' : 'הכול מסונכרן'}</span>
              <b>{problems ? problems : '✓'}</b>
            </div>
            <div className="kpi">
              <span>תואם</span>
              <b>{counts.ok || 0}</b>
            </div>
            <div className="kpi">
              <span>סה״כ בקופה</span>
              <b>{money(regTotal)}</b>
            </div>
            <div className="kpi">
              <span>סה״כ בנדרים (בתקופה)</span>
              <b>{money(nedTotal)}</b>
              {Math.abs(nedTotal - regTotal) > 0.01 && <small className="neg">הפרש {money(round2(nedTotal - regTotal))}</small>}
            </div>
          </div>
          <div className="seg wrap" style={{ margin: '6px 0' }}>
            {[
              ['problems', `לבדיקה (${problems})`],
              ['all', `הכול (${result.length})`],
              ['ok', `תואם (${counts.ok || 0})`],
              ['noNedarim', `בקופה בלבד (${counts.noNedarim || 0})`],
              ['noRegister', `בנדרים בלבד (${counts.noRegister || 0})`],
              ['outside', `מחוץ לתקופה (${counts.outside || 0})`],
            ].map(([k, l]) => (
              <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>סטטוס</th>
                  <th>תאריך</th>
                  <th>אישור בקופה</th>
                  <th>אישור בנדרים</th>
                  <th>קופה</th>
                  <th>נדרים</th>
                  <th>פרטים</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((x, i) => (
                  <tr key={i} className={'recon-' + ST[x.status][1]}>
                    <td className="small">{ST[x.status][0]}</td>
                    <td className="small">{fmtDT(x.reg?.date || x.ned?.date || '') || '—'}</td>
                    <td dir="ltr">{x.reg?.conf || (x.reg ? <span className="neg small">חסר</span> : '')}</td>
                    <td dir="ltr">{x.ned?.conf || ''}</td>
                    <td>{x.reg ? money(x.reg.amount) : ''}</td>
                    <td>{x.ned ? money(x.ned.amount) : ''}</td>
                    <td className="small">
                      {x.reg ? `${x.reg.kind}${x.reg.cust ? ' · ' + x.reg.cust : ''}${x.reg.who ? ' · ' + x.reg.who : ''}` : ''}
                      {x.ned && !x.reg ? [x.ned.name, x.ned.phone, x.ned.last4 && '****' + x.ned.last4].filter(Boolean).join(' · ') : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <Empty>{filter === 'problems' ? '✓ אין הבדלים — הקופה ונדרים מסונכרנים' : 'אין שורות'}</Empty>}
          </div>
        </>
      )}
      {!file && (
        <p className="muted small" style={{ marginTop: 8 }}>
          איך משווים: בנדרים פלוס מורידים לאקסל את רשימת העסקאות של אותה תקופה, ומעלים אותה כאן. המערכת מתאימה לפי מספר אישור, ואם חסר — לפי סכום ותאריך.
        </p>
      )}
    </div>
  )
}
