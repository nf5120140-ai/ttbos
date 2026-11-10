import { useEffect, useState } from 'react'
import { initDb, list, get, save, saveMany, hashPin, ensureDefaultManager, deviceName, setDeviceName, wipeLocal, KINDS } from './db.js'
import { startSync, syncNow, cloudConfigured, cloudLogin, cloudLogout, setCloudConfig } from './sync.js'
import { seedDemo } from './seed.js'
import { useVersion, useSyncStatus, can, toast, confirmDlg, ToastHost, ConfirmHost, Modal, Field, Toggle, downloadFile, fmtTime } from './ui.jsx'
import Pos from './Pos.jsx'
import { Customers, Inventory, Orders } from './Manage.jsx'
import { Reports, CashCount } from './Reports.jsx'

export default function App() {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState(null)
  const [tab, setTab] = useState('pos')
  const sync = useSyncStatus()
  useVersion()

  useEffect(() => {
    ;(async () => {
      await initDb()
      if (!cloudConfigured) ensureDefaultManager()
      // גרסת הדגמה בלבד: טוען נתוני דוגמה אוטומטית
      if (import.meta.env.VITE_DEMO && list('product').length === 0) seedDemo()
      await startSync()
      setReady(true)
    })()
  }, [])

  // נעילה אוטומטית אחרי 10 דקות ללא פעילות
  useEffect(() => {
    if (!user) return
    let t
    const reset = () => {
      clearTimeout(t)
      t = setTimeout(() => setUser(null), 10 * 60 * 1000)
    }
    reset()
    ;['pointerdown', 'keydown'].forEach((e) => window.addEventListener(e, reset))
    return () => {
      clearTimeout(t)
      ;['pointerdown', 'keydown'].forEach((e) => window.removeEventListener(e, reset))
    }
  }, [user])

  if (!ready) return <div className="splash">תתבוס…</div>

  // ענן מוגדר אבל המכשיר לא מחובר — חיבור חד-פעמי למכשיר
  if (cloudConfigured && !sync.authed) return <CloudGate />
  if (cloudConfigured && !sync.pulledOnce && list('user').length === 0) return (
      <div className="splash">
        טוען נתונים מהשרת…
        {sync.error && (
          <div className="err small">
            {sync.error} <button className="btn small" onClick={syncNow}>נסה שוב</button>
          </div>
        )}
      </div>
    )

  if (!user) return <SellerLogin onLogin={(u) => (setUser(u), setTab('pos'))} />

  const fresh = get('user', user.id) || user
  const tabs = [
    ['pos', '🛒', 'קופה', true],
    ['customers', '👛', 'ארנקים', true],
    ['inventory', '📦', 'מלאי', fresh.role === 'manager'],
    ['orders', '🚚', 'הזמנות', fresh.role === 'manager'],
    ['reports', '📊', 'דוחות', can(fresh, 'reports')],
    ['count', '💰', 'ספירה', true],
    ['settings', '⚙️', 'הגדרות', true],
  ].filter((t) => t[3])

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">ת</span>
          <span>תתבוס</span>
        </div>
        <nav>
          {tabs.map(([k, i, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              <span className="nav-i">{i}</span>
              <span className="nav-l">{l}</span>
            </button>
          ))}
        </nav>
        <div className="top-end">
          <SyncBadge s={sync} />
          <button className="user-chip" onClick={() => setUser(null)} title="החלף מוכר / נעל">
            👤 {fresh.name} 🔒
          </button>
        </div>
      </header>
      <main>
        {tab === 'pos' && <Pos user={fresh} />}
        {tab === 'customers' && <Customers user={fresh} />}
        {tab === 'inventory' && <Inventory user={fresh} />}
        {tab === 'orders' && <Orders user={fresh} />}
        {tab === 'reports' && <Reports user={fresh} />}
        {tab === 'count' && <CashCount user={fresh} />}
        {tab === 'settings' && <Settings user={fresh} sync={sync} />}
      </main>
      <ToastHost />
      <ConfirmHost />
    </div>
  )
}

function SyncBadge({ s }) {
  if (s.mode === 'local') return <span className="sync local" title="עובד מקומית בלבד — לא מוגדר שרת">● מקומי</span>
  if (!s.online) return <span className="sync off" title="אין אינטרנט — הכל נשמר ויסונכרן אחר כך">● לא מקוון{s.pending ? ` (${s.pending})` : ''}</span>
  if (s.error) return <button className="sync err" title={s.error} onClick={syncNow}>● שגיאת סנכרון</button>
  if (s.syncing || s.pending) return <span className="sync busy">● מסנכרן{s.pending ? ` (${s.pending})` : ''}</span>
  return <span className="sync ok" title={s.lastSync ? 'סונכרן ' + fmtTime(s.lastSync.toISOString()) : ''}>● מסונכרן</span>
}

// ---------- כניסת מוכר ----------
function SellerLogin({ onLogin }) {
  useVersion()
  const users = list('user').filter((u) => u.active !== false)
  const [sel, setSel] = useState(users.length === 1 ? users[0] : null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const onlyDefault = users.length === 1 && users[0].pinHash === hashPin('1234')

  function press(d) {
    setErr('')
    const p = (pin + d).slice(0, 8)
    setPin(p)
    if (sel && p.length >= 4 && hashPin(p) === sel.pinHash) {
      setPin('')
      onLogin(sel)
    }
  }
  function submit() {
    if (sel && hashPin(pin) === sel.pinHash) onLogin(sel)
    else {
      setErr('קוד שגוי')
      setPin('')
    }
  }
  useEffect(() => {
    const h = (e) => {
      if (!sel) return
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Enter') submit()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  return (
    <div className="login">
      <div className="login-box">
        <div className="login-logo">ת</div>
        <h1>תתבוס</h1>
        <p className="muted">{deviceName()}</p>
        {!sel ? (
          <>
            <h3>מי מוכר עכשיו?</h3>
            <div className="seller-list">
              {users.map((u) => (
                <button key={u.id} className="seller" onClick={() => setSel(u)}>
                  <span className="av">{u.name[0]}</span>
                  {u.name}
                  {u.role === 'manager' && <small>מנהל</small>}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <button className="seller sel" onClick={() => (setSel(null), setPin(''))}>
              <span className="av">{sel.name[0]}</span>
              {sel.name} <small>החלף</small>
            </button>
            <div className="pin-dots">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={i < pin.length ? 'on' : ''} />
              ))}
              {pin.length > 4 && <span className="on" />}
            </div>
            {err && <div className="err">{err}</div>}
            <div className="pad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => (
                <button key={k} onClick={() => (k === '⌫' ? setPin(pin.slice(0, -1)) : k === '✓' ? submit() : press(k))}>
                  {k}
                </button>
              ))}
            </div>
            {onlyDefault && <p className="muted small">קוד ראשוני: 1234 — שנה אותו בהגדרות</p>}
          </>
        )}
      </div>
    </div>
  )
}

// ---------- חיבור מכשיר לשרת ----------
function CloudGate() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function go(e) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await cloudLogin(email.trim(), pw)
    } catch (x) {
      setErr(navigator.onLine ? 'פרטים שגויים: ' + x.message : 'צריך אינטרנט לחיבור הראשון של המכשיר')
    }
    setBusy(false)
  }
  return (
    <div className="login">
      <form className="login-box" onSubmit={go}>
        <div className="login-logo">ת</div>
        <h1>חיבור מכשיר</h1>
        <p className="muted">פעם אחת לכל מכשיר — עם חשבון המזנון. אחרי זה הקופה עובדת גם בלי אינטרנט.</p>
        <input placeholder="אימייל של המזנון" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" />
        <input placeholder="סיסמה" value={pw} onChange={(e) => setPw(e.target.value)} type="password" autoComplete="current-password" />
        {err && <div className="err">{err}</div>}
        <button className="btn primary big" disabled={busy}>
          {busy ? 'מתחבר…' : 'התחבר'}
        </button>
      </form>
    </div>
  )
}

// ---------- הגדרות ----------
function Settings({ user, sync }) {
  useVersion()
  const isMgr = user.role === 'manager'
  const [edit, setEdit] = useState(null)
  const [dn, setDn] = useState(deviceName())
  const [adv, setAdv] = useState(false)
  const [url, setUrl] = useState(() => localStorage.getItem('tt_sb_url') || '')
  const [key, setKey] = useState(() => localStorage.getItem('tt_sb_key') || '')
  const [myPin, setMyPin] = useState('')
  const users = list('user')

  function backup() {
    const out = {}
    for (const k of KINDS) out[k] = list(k, true)
    downloadFile(`tatbus-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out), 'application/json')
  }
  function restore(e) {
    const f = e.target.files?.[0]
    if (!f) return
    const r = new FileReader()
    r.onload = async () => {
      try {
        const d = JSON.parse(r.result)
        if (!(await confirmDlg('לשחזר מגיבוי? רשומות חדשות יותר לא יידרסו.', 'שחזר'))) return
        const rows = []
        for (const k of KINDS) for (const rec of d[k] || []) rows.push({ kind: k, id: rec.id, data: rec, deleted: !!rec.deleted })
        // שמירה מחדש של כל רשומה — כך היא גם נשלחת לשרת
        saveMany(rows.map((row) => [row.kind, { ...row.data }]))
        toast('שוחזר')
      } catch {
        toast('קובץ לא תקין', 'err')
      }
    }
    r.readAsText(f)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>הגדרות</h2>
      </div>

      <div className="two-col">
        <div className="card">
          <h3>המכשיר הזה</h3>
          <Field label="שם המכשיר (מופיע בדוחות ובספירת קופה)">
            <div className="row gap-s">
              <input value={dn} onChange={(e) => setDn(e.target.value)} />
              <button className="btn" onClick={() => (setDeviceName(dn.trim() || 'קופה'), toast('נשמר'))}>
                שמור
              </button>
            </div>
          </Field>
          <Field label="שינוי הקוד האישי שלי">
            <div className="row gap-s">
              <input type="password" inputMode="numeric" placeholder="קוד חדש (4+ ספרות)" value={myPin} onChange={(e) => setMyPin(e.target.value.replace(/\D/g, ''))} />
              <button
                className="btn"
                onClick={() => {
                  if (myPin.length < 4) return toast('לפחות 4 ספרות', 'err')
                  if (list('user').some((u) => u.id !== user.id && u.pinHash === hashPin(myPin))) return toast('הקוד תפוס, בחר אחר', 'err')
                  save('user', { ...user, pinHash: hashPin(myPin) })
                  setMyPin('')
                  toast('הקוד עודכן')
                }}
              >
                עדכן
              </button>
            </div>
          </Field>
        </div>

        <div className="card">
          <h3>סנכרון</h3>
          {sync.mode === 'local' ? (
            <p>
              <b>מצב מקומי</b> — הנתונים נשמרים רק במכשיר הזה. כדי לעבוד עם כמה מכשירים, הגדר Supabase (ראה README).
            </p>
          ) : (
            <>
              <div className="sum-row">
                <span>חיבור</span>
                <b>{sync.online ? 'מקוון' : 'לא מקוון'}</b>
              </div>
              <div className="sum-row">
                <span>ממתינים לשליחה</span>
                <b>{sync.pending}</b>
              </div>
              <div className="sum-row">
                <span>סנכרון אחרון</span>
                <b>{sync.lastSync ? sync.lastSync.toLocaleTimeString('he-IL') : '—'}</b>
              </div>
              {sync.error && <div className="err small">{sync.error}</div>}
              <div className="row gap-s">
                <button className="btn primary grow" onClick={syncNow}>
                  🔄 סנכרן עכשיו
                </button>
                {isMgr && (
                  <button
                    className="btn"
                    onClick={async () => {
                      if (sync.pending && !(await confirmDlg(`יש ${sync.pending} שינויים שעוד לא נשלחו! להתנתק בכל זאת?`, 'התנתק'))) return
                      cloudLogout()
                    }}
                  >
                    נתק מכשיר
                  </button>
                )}
              </div>
            </>
          )}
          {isMgr && (
            <details open={adv} onToggle={(e) => setAdv(e.target.open)}>
              <summary className="muted">הגדרת שרת ידנית (מתקדם)</summary>
              <Field label="Supabase URL">
                <input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" />
              </Field>
              <Field label="Supabase anon key">
                <input dir="ltr" value={key} onChange={(e) => setKey(e.target.value)} />
              </Field>
              <button className="btn" onClick={() => setCloudConfig(url.trim(), key.trim())}>
                שמור וטען מחדש
              </button>
            </details>
          )}
        </div>
      </div>

      {isMgr && (
        <div className="card">
          <div className="row space">
            <h3>מוכרים ומשתמשים</h3>
            <button className="btn primary" onClick={() => setEdit({ role: 'seller', active: true, perms: { void: true, topup: true, discount: true, reports: false } })}>
              + מוכר
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>שם</th>
                  <th>תפקיד</th>
                  <th>ביטול/מחיקה</th>
                  <th>טעינת ארנק</th>
                  <th>הנחות</th>
                  <th>דוחות</th>
                  <th>פעיל</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <b>{u.name}</b>
                    </td>
                    <td>{u.role === 'manager' ? 'מנהל' : 'מוכר'}</td>
                    {['void', 'topup', 'discount', 'reports'].map((p) => (
                      <td key={p}>{u.role === 'manager' || u.perms?.[p] ? '✓' : '—'}</td>
                    ))}
                    <td>{u.active !== false ? '✓' : '—'}</td>
                    <td>
                      <button className="btn small" onClick={() => setEdit(u)}>
                        ✎
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isMgr && (
        <div className="card">
          <h3>נתונים</h3>
          <div className="row gap-s wrap">
            <button className="btn" onClick={backup}>
              ⬇ גיבוי לקובץ
            </button>
            <label className="btn">
              ⬆ שחזור מגיבוי
              <input type="file" accept=".json" hidden onChange={restore} />
            </label>
            {list('product').length === 0 && (
              <button
                className="btn"
                onClick={() => {
                  seedDemo()
                  toast('נטענו נתוני דוגמה')
                }}
              >
                🧪 טען נתוני דוגמה
              </button>
            )}
            {sync.mode === 'local' && (
              <button
                className="btn danger"
                onClick={async () => {
                  if (!(await confirmDlg('למחוק את כל הנתונים במכשיר הזה? אין דרך חזרה!', 'מחק הכל'))) return
                  wipeLocal()
                  ensureDefaultManager()
                  location.reload()
                }}
              >
                מחק את כל הנתונים
              </button>
            )}
          </div>
        </div>
      )}

      <p className="muted center small">תתבוס · גרסה 0.1</p>
      {edit && <UserEditor u={edit} me={user} onClose={() => setEdit(null)} />}
    </div>
  )
}

function UserEditor({ u, me, onClose }) {
  const [f, setF] = useState({ ...u, perms: { ...(u.perms || {}) } })
  const [pin, setPin] = useState('')
  const setPerm = (k) => (v) => setF({ ...f, perms: { ...f.perms, [k]: v } })
  function ok() {
    if (!f.name?.trim()) return toast('חסר שם', 'err')
    if (!u.id && pin.length < 4) return toast('קוד של 4 ספרות לפחות', 'err')
    if (pin && pin.length < 4) return toast('קוד של 4 ספרות לפחות', 'err')
    if (pin && list('user').some((x) => x.id !== u.id && x.pinHash === hashPin(pin))) return toast('הקוד תפוס, בחר אחר', 'err')
    if (u.id === me.id && f.role !== 'manager') return toast('אי אפשר להוריד לעצמך הרשאת מנהל', 'err')
    if (u.role === 'manager' && (f.role !== 'manager' || f.active === false) && list('user').filter((x) => x.role === 'manager' && x.active !== false).length <= 1)
      return toast('חייב להישאר לפחות מנהל אחד', 'err')
    save('user', { ...f, name: f.name.trim(), ...(pin ? { pinHash: hashPin(pin) } : {}) })
    toast('נשמר')
    onClose()
  }
  return (
    <Modal title={u.id ? 'עריכת משתמש' : 'מוכר חדש'} onClose={onClose} small>
      <Field label="שם">
        <input value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
      </Field>
      <Field label={u.id ? 'קוד חדש (ריק = ללא שינוי)' : 'קוד כניסה (4+ ספרות)'}>
        <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
      </Field>
      <div className="seg">
        {[
          ['seller', 'מוכר'],
          ['manager', 'מנהל'],
        ].map(([k, l]) => (
          <button key={k} className={f.role === k ? 'on' : ''} onClick={() => setF({ ...f, role: k })}>
            {l}
          </button>
        ))}
      </div>
      {f.role === 'seller' && (
        <>
          <Toggle checked={f.perms.void} onChange={setPerm('void')} label="מותר לבטל / למחוק מכירות" />
          <Toggle checked={f.perms.topup} onChange={setPerm('topup')} label="מותר לטעון ארנקים" />
          <Toggle checked={f.perms.discount} onChange={setPerm('discount')} label="מותר לתת הנחות" />
          <Toggle checked={f.perms.reports} onChange={setPerm('reports')} label="רואה דוחות" />
        </>
      )}
      <Toggle checked={f.active !== false} onChange={(v) => setF({ ...f, active: v })} label="פעיל" />
      <button className="btn primary big grow" onClick={ok}>
        שמור
      </button>
    </Modal>
  )
}
