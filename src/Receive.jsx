// ============================================================
// 📦 קליטת סחורה בסורק — מצב מחסן
// ברקודי פקודה (מודפסים): CMD-COUNT · CMD-RECEIVE · CMD-EXIT · CMD-OK · CMD-CANCEL · CMD-D0..CMD-D9
//  • CMD-COUNT  — כל סריקה של מוצר מוסיפה 1 למלאי
//  • CMD-RECEIVE — סורקים מוצר, מזינים כמות (מקלדת או ברקודי ספרות), מאשרים. מוצר חדש: גם עלות ומכירה
// כל סריקה מגיעה לשדה הברקוד בלבד, גם כשהפוקוס בשדה אחר (מאזין גלובלי שמזהה הקלדה מהירה של סורק).
// כל שינוי מלאי נרשם בתנועות המלאי עם מי / מתי / כמה / מצב / מקור (סורק / ידני / ברקודי ספרות).
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { list, get, save, uid, round2, stockOf, productHasCode, similarProducts } from './db.js'
import { toast, Field, ProductThumb, confirmDlg, useVersion } from './ui.jsx'
import { lookupBarcode, tempName, applyWebName, retryTempNames } from './lookup.js'
import { useScanTarget } from './scan.js'
import { askSimilar } from './BarcodeMatch.jsx'

// ---------- צלילים ----------
let actx = null
function beep(kind = 'ok') {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)()
    const seq = kind === 'ok' ? [[880, 0.08]] : kind === 'mode' ? [[660, 0.09], [990, 0.12]] : kind === 'save' ? [[784, 0.07], [1175, 0.1]] : [[220, 0.15], [0, 0.06], [220, 0.2]]
    let t = actx.currentTime
    for (const [f, d] of seq) {
      if (f) {
        const o = actx.createOscillator()
        const g = actx.createGain()
        o.frequency.value = f
        o.type = kind === 'err' ? 'square' : 'sine'
        g.gain.value = 0.15
        o.connect(g).connect(actx.destination)
        o.start(t)
        o.stop(t + d)
      }
      t += d
    }
  } catch {}
}

// ---------- המסך ----------
const MODE_KEY = 'tt_wh_mode'
const MODES = { count: { label: 'מצב ספירה — כל סריקה מוסיפה 1', cls: 'wh-count' }, receive: { label: 'מצב קליטה — סריקה, כמות, אישור', cls: 'wh-receive' } }
const findByCode = (code) => list('product').find((p) => productHasCode(p, code))

export default function Receive({ user, onClose, onEditProduct }) {
  useVersion()
  const [mode, setModeState] = useState(() => {
    try {
      return sessionStorage.getItem(MODE_KEY) || null
    } catch {
      return null
    }
  })
  const [code, setCode] = useState('')
  const [cur, setCur] = useState(null) // מצב קליטה: {code, pid|null, qty, cost, price, name, nameSrc, img, looking}
  const [session, setSession] = useState([]) // [{key, pid, name, added, moves:[{id, qty}]}]
  const [msg, setMsg] = useState(null) // {text, kind, code?}
  const [flash, setFlash] = useState(false)
  const busy = useRef(false)
  const similarAsked = useRef(new Set())
  const codeRef = useRef(null)
  // הכנסה מהירה: רק שם + ברקוד, כמויות ומחירים אחר כך
  const [quick, setQuickRaw] = useState(() => {
    try {
      return localStorage.getItem('tt_wh_quick') === '1'
    } catch {
      return false
    }
  })
  const setQuick = (x) => {
    setQuickRaw(x)
    try {
      localStorage.setItem('tt_wh_quick', x ? '1' : '0')
    } catch {}
  }
  const qtyRef = useRef(null)
  const costRef = useRef(null)
  const priceRef = useRef(null)
  const nameRef = useRef(null)

  useEffect(() => {
    retryTempNames()
    codeRef.current?.focus()
  }, [])

  function setMode(m) {
    setModeState(m)
    try {
      if (m) sessionStorage.setItem(MODE_KEY, m)
      else sessionStorage.removeItem(MODE_KEY)
    } catch {}
    setCur(null)
    setCode('')
    setMsg(m ? { text: MODES[m].label, kind: 'mode' } : { text: 'יצאת ממצב עבודה', kind: 'info' })
    beep('mode')
    setFlash(true)
    setTimeout(() => setFlash(false), 600)
    setTimeout(() => codeRef.current?.focus(), 30)
  }

  function addToSession(p, qty, moveId) {
    setSession((s) => {
      const i = s.findIndex((x) => x.pid === p.id)
      if (i < 0) return [{ key: p.id, pid: p.id, name: p.name, added: qty, moves: [{ id: moveId, qty }] }, ...s]
      const x = s[i]
      const nx = { ...x, added: x.added + qty, moves: [...x.moves, { id: moveId, qty }] }
      return [nx, ...s.slice(0, i), ...s.slice(i + 1)]
    })
  }

  function stockMove(p, qty, source, reason) {
    const id = uid()
    save('stock', { id, productId: p.id, qty, reason, userId: user.id, source, mode: mode || '' })
    addToSession(p, qty, id)
    return id
  }

  // ---- כל סריקה / הקלדה בשדה הברקוד מגיעה לכאן ----
  function onScan(raw, source = 'scanner') {
    const v = String(raw || '').trim()
    if (!v) return
    const up = v.toUpperCase()
    if (up.startsWith('CMD-')) return command(up.slice(4), source)
    setCode(v)
    if (!mode) {
      beep('err')
      setMsg({ text: 'קודם סרוק ברקוד פקודה (ספירה / קליטה) או בחר מצב בכפתורים', kind: 'err' })
      return
    }
    let p = findByCode(v)
    if (!p && !similarAsked.current.has(v)) {
      // ברקוד דומה למוצר קיים? שואלים לפני שממשיכים (למשל ברקוד חתוך מקבלה)
      const r = askSimilar(v, { userId: user.id, newLabel: 'לא — זה מוצר חדש' })
      r.then((res) => {
        if (!res) return
        similarAsked.current.add(v)
        if (res.action === 'use' || res.action === 'new') onScan(v, source)
      })
      if (similarProducts(v).length) return
    }
    similarAsked.current.delete(v)
    p = findByCode(v)
    if (mode === 'count') {
      if (!p) {
        beep('err')
        setMsg({ text: `מוצר לא מוכר: ${v}`, kind: 'err', code: v })
        return
      }
      stockMove(p, 1, source, 'count-scan')
      beep('ok')
      setMsg({ text: `+1 ${p.name} · במלאי עכשיו ${stockOf(p.id)}`, kind: 'ok' })
      setCode('')
      return
    }
    // הכנסה מהירה: סריקה של מוצר הבא שומרת אוטומטית את הקודם
    let autoSaved = false
    if (quick && cur && cur.code !== v && (!cur.pid || cur.qty)) autoSaved = confirm('auto') === true
    // mode === 'receive' — לא דורסים קליטה פתוחה בשקט
    else if (cur && cur.qty && cur.code !== v) {
      beep('err')
      setMsg({ text: `יש קליטה פתוחה (${cur.code}) — אשר או בטל לפני סריקה של מוצר אחר`, kind: 'err' })
      return
    }
    startReceive(v, p, autoSaved)
  }

  function startReceive(v, p, keepMsg = false) {
    beep('ok')
    if (!keepMsg) setMsg(null)
    const c = { code: v, pid: p?.id || null, qty: '', cost: '', price: '', name: '', nameSrc: '', img: '', looking: !p }
    setCur(c)
    setTimeout(() => {
      const r = quick && !p ? nameRef : qtyRef
      r.current?.focus()
      r.current?.select?.()
    }, 30)
    if (!p) {
      const known = list('product', true).find((x) => x.deleted && productHasCode(x, v)) // מוצר שנמחק בעבר — מציעים את שמו
      if (known) setCur((x) => x && x.code === v && { ...x, name: known.name, nameSrc: 'known', looking: false, cost: known.cost || '', price: known.price || '' })
      else
        lookupBarcode(v).then((r) =>
          setCur((x) => (x && x.code === v && !x.nameTouched ? { ...x, looking: false, name: r.status === 'found' ? r.name : '', nameSrc: r.status === 'found' ? 'web' : r.status, img: r.image || '' } : x && x.code === v ? { ...x, looking: false } : x))
        )
    }
  }

  function command(cmd, source) {
    if (cmd === 'COUNT') return setMode('count')
    if (cmd === 'RECEIVE') return setMode('receive')
    if (cmd === 'EXIT') return setMode(null)
    if (/^D\d$/.test(cmd)) {
      if (mode !== 'receive' || !cur) return beep('err')
      beep('ok')
      return setCur((x) => ({ ...x, qty: String(x.qty || '').replace(/^0+/, '') + cmd[1], qtySrc: 'digits' }))
    }
    if (cmd === 'OK') return confirm(source === 'scanner' ? 'digits' : source)
    if (cmd === 'CANCEL') {
      beep('ok')
      if (cur?.qty) return setCur((x) => ({ ...x, qty: '' }))
      setCur(null)
      setCode('')
      return setTimeout(() => codeRef.current?.focus(), 30)
    }
    beep('err')
    setMsg({ text: 'ברקוד פקודה לא מוכר: CMD-' + cmd, kind: 'err' })
  }

  function confirm(srcHint) {
    if (!cur || busy.current) return
    const qty = Number(cur.qty || 0)
    if (!Number.isInteger(qty) || qty < 0 || (qty === 0 && !quick)) {
      beep('err')
      setMsg({ text: 'כמות חייבת להיות מספר שלם חיובי', kind: 'err' })
      qtyRef.current?.focus()
      return
    }
    let p = cur.pid ? get('product', cur.pid) : null
    if (!p) {
      const cost = Number(cur.cost)
      const price = Number(cur.price)
      if (!quick && !(cost > 0)) {
        beep('err')
        setMsg({ text: 'מוצר חדש — חובה מחיר עלות', kind: 'err' })
        return costRef.current?.focus()
      }
      if (!quick && !(price > 0)) {
        beep('err')
        setMsg({ text: 'מוצר חדש — חובה מחיר מכירה', kind: 'err' })
        return priceRef.current?.focus()
      }
      if (findByCode(cur.code)) {
        beep('err')
        return setMsg({ text: 'הברקוד כבר קיים במוצר אחר', kind: 'err' })
      }
      busy.current = true
      const name = String(cur.name || '').trim()
      const nameStatus = name ? (cur.nameTouched || cur.nameSrc === 'known' ? 'ok' : cur.nameSrc === 'web' ? 'web' : 'ok') : 'temp'
      p = save('product', {
        name: name || tempName(cur.code),
        nameStatus,
        barcode: cur.code,
        barcodes: [],
        cost: cost > 0 ? round2(cost) : '',
        price: price > 0 ? round2(price) : '',
        staffPrice: '',
        category: '',
        active: true,
        minStock: 0,
        ...(cur.img && nameStatus === 'web' ? { img: cur.img, imgStatus: 'web' } : {}),
      })
      if (nameStatus === 'temp') applyWebName(p.id, cur.code) // ממשיך לחפש ברקע
    } else busy.current = true
    const src = cur.qtySrc === 'digits' ? 'digits' : srcHint === 'digits' ? 'digits' : 'manual'
    if (qty > 0) stockMove(p, qty, src, 'receive')
    else addToSession(p, 0, null)
    beep('save')
    const missing = [!(Number(p.price) > 0) && 'מחיר', !(Number(p.cost) > 0) && 'עלות', qty === 0 && 'כמות'].filter(Boolean)
    setMsg({ text: qty > 0 ? `✓ ${p.name}: +${qty} · במלאי עכשיו ${stockOf(p.id)}` : `✓ ${p.name} נשמר` + (missing.length ? ` (בלי ${missing.join(' / ')} — להשלים אחר כך ב"חסר מידע")` : ''), kind: 'ok' })
    setCur(null)
    setCode('')
    setTimeout(() => {
      busy.current = false
      if (srcHint !== 'auto') codeRef.current?.focus() // באוטומטי — כבר עובר למוצר הבא
    }, 250) // debounce — מונע שמירה כפולה
    return true
  }

  async function undo(row, moveIdx = null) {
    const moves = moveIdx == null ? row.moves.slice(-1) : row.moves
    const qty = moves.reduce((a, m) => a + m.qty, 0)
    if (moveIdx === 'all' && !(await confirmDlg(`לבטל את כל ה-${qty} שנוספו ל"${row.name}" בסשן הזה?`, 'בטל'))) return
    const p = get('product', row.pid)
    if (p && qty) save('stock', { productId: p.id, qty: -qty, reason: 'undo', userId: user.id, source: 'manual', ref: moves.map((m) => m.id).join(',') })
    setSession((s) =>
      s
        .map((x) => (x.pid !== row.pid ? x : { ...x, added: x.added - qty, moves: moveIdx == null ? x.moves.slice(0, -1) : [] }))
        .filter((x) => x.moves.length)
    )
    toast(`בוטל: ${row.name} −${qty}`)
    codeRef.current?.focus()
  }
  function undoLast() {
    const row = session[0]
    if (!row) return
    undo(row)
  }

  useScanTarget(onScan, true, 2)

  const p = cur?.pid ? get('product', cur.pid) : null
  const isNew = cur && !p
  const enterNext = (next) => (e) => {
    if (e.key !== 'Enter' && !(e.key === 'Tab' && !e.shiftKey && e.currentTarget === qtyRef.current && !isNew)) return
    e.preventDefault()
    if (next) next.current?.focus(), next.current?.select?.()
    else confirm('manual')
  }

  return (
    <div className="wh">
      <div className={'wh-bar ' + (mode ? MODES[mode].cls : 'wh-none') + (flash ? ' flash' : '')}>
        <b>{mode ? MODES[mode].label : 'אין מצב עבודה — סרוק ברקוד פקודה'}</b>
        <div className="row gap-s">
          <button className={'btn small' + (mode === 'count' ? ' on' : '')} onClick={() => setMode('count')}>
            ➕1 ספירה
          </button>
          <button className={'btn small' + (mode === 'receive' ? ' on' : '')} onClick={() => setMode('receive')}>
            📦 קליטה
          </button>
          {mode && (
            <button className="btn small" onClick={() => setMode(null)}>
              יציאה ממצב
            </button>
          )}
          <button className={'btn small' + (quick ? ' on' : '')} title="מכניסים עכשיו רק שם וברקוד; כמויות ומחירים משלימים אחר כך" onClick={() => setQuick(!quick)}>
            ⚡ הכנסה מהירה {quick ? '(פעיל)' : ''}
          </button>
          <button className="btn small" onClick={() => printCommandSheet().catch((e) => toast(e.message, 'err'))}>
            🖨 דף ברקודי פקודה
          </button>
          <button className="btn small" onClick={onClose}>
            ✕ סגור
          </button>
        </div>
      </div>

      <div className="wh-body">
        <div className="wh-main">
          <Field label="ברקוד">
            <input
              ref={codeRef}
              className="big-input"
              dir="ltr"
              value={code}
              placeholder="סרוק או הקלד ← Enter"
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onScan(code, 'manual')
                }
              }}
            />
          </Field>

          {msg && (
            <div className={'wh-msg ' + msg.kind}>
              {msg.text}
              {msg.code && (
                <button className="btn small" onClick={() => (mode !== 'receive' && setMode('receive'), setTimeout(() => startReceive(msg.code, null), 60))}>
                  + קלוט כמוצר חדש
                </button>
              )}
            </div>
          )}

          {mode === 'receive' && cur && (
            <div className="wh-card">
              <div className="row gap" style={{ alignItems: 'center' }}>
                {p ? <ProductThumb p={p} size={56} /> : <span className="wh-new">חדש</span>}
                <div>
                  {p ? (
                    <>
                      <b className="wh-name">{p.name}</b>
                      <div className="muted">
                        ברקוד {cur.code} · במלאי עכשיו <b>{stockOf(p.id)}</b>
                      </div>
                    </>
                  ) : (
                    <>
                      <b className="wh-name">מוצר חדש</b>
                      <div className="muted" dir="ltr">
                        {cur.code}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="wh-fields">
                <Field label={quick ? 'כמות (לא חובה)' : 'כמות *'}>
                  <input ref={qtyRef} className="big-input" inputMode="numeric" value={cur.qty} onChange={(e) => setCur({ ...cur, qty: e.target.value.replace(/\D/g, ''), qtySrc: 'manual' })} onKeyDown={enterNext(isNew ? (quick ? nameRef : costRef) : null)} />
                </Field>
                {isNew && (
                  <>
                    <Field label={quick ? 'מחיר עלות ₪ (לא חובה)' : 'מחיר עלות ₪ *'}>
                      <input ref={costRef} inputMode="decimal" value={cur.cost} onChange={(e) => setCur({ ...cur, cost: e.target.value })} onKeyDown={enterNext(priceRef)} />
                    </Field>
                    <Field label={quick ? 'מחיר מכירה ₪ (לא חובה)' : 'מחיר מכירה ₪ *'}>
                      <input ref={priceRef} inputMode="decimal" value={cur.price} onChange={(e) => setCur({ ...cur, price: e.target.value })} onKeyDown={enterNext(null)} />
                    </Field>
                    <Field label={cur.looking ? 'שם — מחפש ברשת…' : cur.nameSrc === 'web' ? 'שם (נמצא ברשת — אפשר לשנות)' : cur.nameSrc === 'known' ? 'שם (ממוצר קודם)' : 'שם (לא נמצא ברשת — לא חובה)'}>
                      <input ref={nameRef} value={cur.name} placeholder={tempName(cur.code)} onChange={(e) => setCur({ ...cur, name: e.target.value, nameTouched: true })} onKeyDown={enterNext(null)} />
                    </Field>
                  </>
                )}
              </div>
              <div className="row gap-s">
                <button className="btn primary big grow" onClick={() => confirm('manual')}>
                  ✓ אישור {cur.qty ? `(+${cur.qty})` : ''}
                </button>
                <button className="btn big" onClick={() => command('CANCEL', 'manual')}>
                  ביטול
                </button>
              </div>
              <p className="muted small">Enter עובר לשדה הבא ובשדה האחרון מאשר · ברקודי ספרות: סורקים ספרות ואז CMD-OK</p>
            </div>
          )}
          {!mode && (
            <div className="wh-help">
              <p>
                <b>➕1 ספירה</b> — כל סריקה של מוצר מוסיפה 1 למלאי (5 סריקות = +5).
              </p>
              <p>
                <b>📦 קליטה</b> — סורקים מוצר, מקלידים כמות ו-Enter. מוצר חדש: גם עלות ומכירה, והשם נמצא לבד ברשת.
              </p>
              <p className="muted small">אפשר לעבור בין המצבים גם בסריקת ברקודי הפקודה מהדף המודפס.</p>
            </div>
          )}
        </div>

        <div className="wh-session">
          <div className="row space">
            <b>בסשן הזה ({session.reduce((a, x) => a + x.added, 0)} יח׳)</b>
            {session.length > 0 && (
              <button className="btn small" onClick={undoLast}>
                ↶ בטל סריקה אחרונה
              </button>
            )}
          </div>
          {!session.length && <p className="muted small">עוד לא נקלט כלום</p>}
          {session.map((x) => {
            const pp = get('product', x.pid)
            return (
              <div key={x.key} className="wh-row">
                <div className="grow">
                  <b>{pp?.name || x.name}</b>
                  {pp?.nameStatus === 'web' && <span className="tag web">🌐 מהרשת</span>}
                  {pp?.nameStatus === 'temp' && <span className="tag temp">חסר שם</span>}
                  <div className="muted small">
                    +{x.added} · במלאי {pp ? stockOf(pp.id) : '—'}
                  </div>
                </div>
                {pp && (pp.nameStatus === 'web' || pp.nameStatus === 'temp') && onEditProduct && (
                  <button className="btn small" onClick={() => onEditProduct(pp)}>
                    ✎
                  </button>
                )}
                <button className="btn small" onClick={() => undo(x, 'all')}>
                  בטל
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------- דף ברקודי פקודה להדפסה ----------
export async function printCommandSheet() {
  const { default: JsBarcode } = await import('jsbarcode')
  const svg = (value) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    JsBarcode(el, value, { format: 'CODE128', height: 60, width: 2, displayValue: true, fontSize: 14, margin: 6 })
    return el.outerHTML
  }
  const big = [
    ['CMD-COUNT', '➕1 מצב ספירה', 'כל סריקה מוסיפה 1 למלאי'],
    ['CMD-RECEIVE', '📦 מצב קליטה', 'סריקה ← כמות ← אישור'],
    ['CMD-EXIT', 'יציאה ממצב', ''],
    ['CMD-OK', '✓ אישור', 'אחרי הקלדת / סריקת כמות'],
    ['CMD-CANCEL', '✕ ניקוי / ביטול', ''],
  ]
  const digits = Array.from({ length: 10 }, (_, i) => ['CMD-D' + i, String(i)])
  const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>ברקודי פקודה</title>
<style>
@page { size: A4; margin: 12mm }
body { font-family: Arial, sans-serif; margin: 0; color: #111 }
h1 { font-size: 20px; margin: 0 0 4px } .sub { color: #555; font-size: 12px; margin: 0 0 10px }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm 10mm }
.cmd { border: 1px solid #bbb; border-radius: 6px; padding: 4mm; text-align: center; break-inside: avoid }
.cmd b { font-size: 18px; display: block } .cmd small { color: #555 }
.dg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; margin-top: 8mm }
.d { border: 1px solid #bbb; border-radius: 6px; padding: 2mm; text-align: center; break-inside: avoid }
.d b { font-size: 22px; display: block } svg { max-width: 100%; height: auto }
</style></head><body>
<h1>ברקודי פקודה — קליטת סחורה</h1><p class="sub">סורקים כדי לעבור בין מצבים. ברקודי הספרות בונים כמות במצב קליטה (1 ואז 5 = 15) ואז "אישור".</p>
<div class="grid">${big.map(([v, t, s]) => `<div class="cmd"><b>${t}</b><small>${s}</small><div>${svg(v)}</div></div>`).join('')}</div>
<div class="dg">${digits.map(([v, t]) => `<div class="d"><b>${t}</b>${svg(v)}</div>`).join('')}</div>
</body></html>`
  const f = document.createElement('iframe')
  f.style.cssText = 'position:fixed;inset:auto;width:0;height:0;border:0;opacity:0'
  document.body.appendChild(f)
  f.contentDocument.open()
  f.contentDocument.write(html)
  f.contentDocument.close()
  await new Promise((r) => setTimeout(r, 300))
  f.contentWindow.focus()
  f.contentWindow.print()
  setTimeout(() => f.remove(), 60000)
}
