import { useEffect, useState } from 'react'
import { DEMO, initDb, list, getSetting, setSetting, get, save, saveMany, hashPin, ensureDefaultManager, deviceName, setDeviceName, wipeLocal, KINDS } from './db.js'
import { startSync, syncNow, cloudConfigured, cloudLogin, cloudSignup, cloudResetPassword, cloudSetPassword, cloudLogout, setCloudConfig, nedarimFnUrl } from './sync.js'
import { ParentTopup } from './Credit.jsx'
import { useFingerprint, fpIdentify, fpEnroll } from './fp.js'
import { seedDemo } from './seed.js'
import { useVersion, useSyncStatus, can, toast, confirmDlg, ToastHost, ConfirmHost, Modal, Field, Toggle, downloadFile, fmtTime } from './ui.jsx'
import Pos from './Pos.jsx'
import { Customers, Inventory, Orders } from './Manage.jsx'
import { Reports, CashCount } from './Reports.jsx'

const TOPUP_ID = (() => {
  try {
    return new URLSearchParams(location.search).get('topup')
  } catch {
    return null
  }
})()

export default function App() {
  if (TOPUP_ID) return <ParentTopup customerId={TOPUP_ID} />
  return <KioskApp />
}

function KioskApp() {
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
      if ((DEMO || import.meta.env.VITE_DEMO) && list('product').length === 0) seedDemo()
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
  if (cloudConfigured && sync.recovery) return <SetNewPassword />
  if (cloudConfigured && (!sync.authed || sync.member === false)) return <CloudGate notMember={sync.authed && sync.member === false} email={sync.email} />
  if (cloudConfigured && sync.member === null) return <div className="splash">מתחבר…</div>
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
  if (DEMO) return <span className="sync local" title="מצב הדגמה — לא מחובר לשרת">● הדגמה</span>
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
  const fp = useFingerprint()
  const [fpBusy, setFpBusy] = useState(false)
  const hasFp = users.some((u) => u.fpTemplates?.length)
  async function fingerLogin() {
    setErr('')
    setFpBusy(true)
    try {
      const r = await fpIdentify()
      const u = users.find((x) => x.id === r.userId)
      if (!u) throw new Error('האצבע לא מזוהה')
      if (sel && sel.id !== u.id) throw new Error(`האצבע שייכת ל${u.name}`)
      onLogin(u)
    } catch (e) {
      setErr(e.message || String(e))
    }
    setFpBusy(false)
  }

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
        {DEMO && (
          <div className="demo-note">
            🧪 <b>מצב הדגמה</b> — נתוני דוגמה בלבד, נשמרים רק במכשיר הזה.
            <br />
            מנהל: קוד <b>1234</b> · מוכר יוסי: קוד <b>1111</b>
          </div>
        )}
        {fp.ready && hasFp && (
          <button className="btn primary big" disabled={fpBusy} onClick={fingerLogin}>
            {fpBusy ? '👆 הנח אצבע על הקורא…' : '👆 כניסה באצבע'}
          </button>
        )}
        {!sel ? (
          <>
            {err && <div className="err">{err}</div>}
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
            {onlyDefault && !DEMO && <p className="muted small">קוד ראשוני: 1234 — שנה אותו בהגדרות</p>}
          </>
        )}
      </div>
    </div>
  )
}

// ---------- כניסה למערכת (פעם אחת לכל מכשיר) ----------
function CloudGate({ notMember, email: currentEmail }) {
  const [mode, setMode] = useState(() => (localStorage.getItem('tt_email') ? 'login' : 'choose')) // choose | login | signup | forgot
  const [email, setEmail] = useState(() => localStorage.getItem('tt_email') || '')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')

  const go = (m) => {
    setMode(m)
    setErr('')
    setInfo('')
  }
  const remember = () => {
    try {
      localStorage.setItem('tt_email', email.trim())
    } catch {}
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setInfo('')
    const em = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return setErr('כתובת מייל לא תקינה')
    if (!navigator.onLine) return setErr('צריך אינטרנט בכניסה הראשונה של המכשיר')
    setBusy(true)
    try {
      if (mode === 'login') {
        remember()
        const ok = await cloudLogin(em, pw)
        if (!ok) setErr('המייל הזה לא מחובר למזנון. היכנס עם המייל שנרשם בפעם הראשונה.')
      } else if (mode === 'signup') {
        if (pw.length < 6) throw new Error('סיסמה של 6 תווים לפחות')
        if (pw !== pw2) throw new Error('הסיסמאות לא זהות')
        remember()
        const r = await cloudSignup(em, pw)
        if (r === 'exists') {
          setMode('login')
          setPw('')
          setPw2('')
          setInfo('המייל הזה כבר רשום — הכנס את הסיסמה שלו')
        } else if (r === 'confirm') {
          setMode('login')
          setInfo('נשלח מייל אישור. לחץ על הקישור במייל ואז התחבר כאן.')
        }
      } else if (mode === 'forgot') {
        await cloudResetPassword(em)
        setInfo('נשלח מייל עם קישור לבחירת סיסמה חדשה. פתח אותו במכשיר הזה.')
      }
    } catch (x) {
      setErr(x.message || String(x))
    }
    setBusy(false)
  }

  return (
    <div className="login">
      <form className="login-box" onSubmit={submit}>
        <div className="login-logo">ת</div>
        <h1>תתבוס</h1>
        {notMember && (
          <div className="err">
            המייל {currentEmail} לא מחובר למזנון.
            <button type="button" className="btn small" onClick={() => cloudLogout()}>
              התנתק
            </button>
          </div>
        )}

        {mode === 'choose' && (
          <>
            <p className="muted">כל המכשירים של המזנון נכנסים עם אותו מייל וסיסמה. עושים את זה פעם אחת בכל מכשיר.</p>
            <button type="button" className="btn primary big" onClick={() => go('login')}>
              יש לי כבר חשבון — כניסה
            </button>
            <button type="button" className="btn big" onClick={() => go('signup')}>
              פעם ראשונה — רישום המזנון
            </button>
          </>
        )}

        {mode !== 'choose' && (
          <>
            <h3>{mode === 'login' ? 'כניסה' : mode === 'signup' ? 'רישום המזנון (פעם ראשונה בלבד)' : 'שכחתי סיסמה'}</h3>
            {mode === 'signup' && <p className="muted small">בוחרים מייל וסיסמה. אחר כך בכל מכשיר נוסף נכנסים עם אותם פרטים.</p>}
            <input placeholder="מייל" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" dir="ltr" />
            {mode !== 'forgot' && (
              <div className="pw-wrap">
                <input
                  placeholder="סיסמה"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  type={show ? 'text' : 'password'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  dir="ltr"
                />
                <button type="button" className="icon-btn" onClick={() => setShow(!show)} title="הצג סיסמה">
                  {show ? '🙈' : '👁'}
                </button>
              </div>
            )}
            {mode === 'signup' && <input placeholder="סיסמה שוב" value={pw2} onChange={(e) => setPw2(e.target.value)} type={show ? 'text' : 'password'} autoComplete="new-password" dir="ltr" />}
            {err && <div className="err">{err}</div>}
            {info && <div className="info">{info}</div>}
            <button className="btn primary big" disabled={busy}>
              {busy ? 'רגע…' : mode === 'login' ? 'כניסה' : mode === 'signup' ? 'הרשמה וכניסה' : 'שלח לי קישור'}
            </button>
            <div className="row space small">
              {mode !== 'login' && (
                <button type="button" className="link" onClick={() => go('login')}>
                  יש לי חשבון — כניסה
                </button>
              )}
              {mode !== 'signup' && (
                <button type="button" className="link" onClick={() => go('signup')}>
                  פעם ראשונה? רישום
                </button>
              )}
              {mode === 'login' && (
                <button type="button" className="link" onClick={() => go('forgot')}>
                  שכחתי סיסמה
                </button>
              )}
            </div>
          </>
        )}
      </form>
    </div>
  )
}

function SetNewPassword() {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="login">
      <form
        className="login-box"
        onSubmit={async (e) => {
          e.preventDefault()
          if (pw.length < 6) return setErr('סיסמה של 6 תווים לפחות')
          setBusy(true)
          try {
            await cloudSetPassword(pw)
            toast('הסיסמה עודכנה')
          } catch (x) {
            setErr(x.message)
          }
          setBusy(false)
        }}
      >
        <div className="login-logo">ת</div>
        <h1>סיסמה חדשה</h1>
        <input placeholder="סיסמה חדשה" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" dir="ltr" />
        {err && <div className="err">{err}</div>}
        <button className="btn primary big" disabled={busy}>
          שמור
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
                <span>מחובר כ</span>
                <b dir="ltr">{sync.email}</b>
              </div>
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
                      const p = prompt('סיסמה חדשה לחשבון המזנון (לפחות 6 תווים). שים לב — המכשירים האחרים יישארו מחוברים.')
                      if (!p) return
                      try {
                        await cloudSetPassword(p)
                        toast('הסיסמה עודכנה')
                      } catch (x) {
                        toast(x.message, 'err')
                      }
                    }}
                  >
                    החלף סיסמה
                  </button>
                )}
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

      {isMgr && <GeneralSettings />}

      {isMgr && <NedarimSettings mode={sync.mode} />}

      {isMgr && (
        <div className="card">
          <div className="row space">
            <h3>מוכרים ומשתמשים</h3>
            <button className="btn primary" onClick={() => setEdit({ role: 'seller', active: true, staffDiscountPct: 0, perms: { void: true, topup: true, terminal: true, reports: false } })}>
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
                  <th>הנחת עובד</th>
                  <th>מסופון</th>
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
                    {['void', 'topup'].map((p) => (
                      <td key={p}>{can(u, p) ? '✓' : '—'}</td>
                    ))}
                    <td>{Number(u.staffDiscountPct) ? u.staffDiscountPct + '%' : '—'}</td>
                    {['terminal', 'reports'].map((p) => (
                      <td key={p}>{can(u, p) ? '✓' : '—'}</td>
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
  const fp = useFingerprint()
  const [enrolling, setEnrolling] = useState(false)
  async function enroll() {
    setEnrolling(true)
    try {
      const t = await fpEnroll()
      setF((x) => ({ ...x, fpTemplates: [...(x.fpTemplates || []), t].slice(-3) }))
      toast('✓ האצבע נרשמה — לחץ שמור')
    } catch (e) {
      toast(e.message || String(e), 'err')
    }
    setEnrolling(false)
  }
  const setPerm = (k) => (v) => setF({ ...f, perms: { ...f.perms, [k]: v } })
  function ok() {
    if (!f.name?.trim()) return toast('חסר שם', 'err')
    if (!u.id && pin.length < 4) return toast('קוד של 4 ספרות לפחות', 'err')
    if (pin && pin.length < 4) return toast('קוד של 4 ספרות לפחות', 'err')
    if (pin && list('user').some((x) => x.id !== u.id && x.pinHash === hashPin(pin))) return toast('הקוד תפוס, בחר אחר', 'err')
    if (u.id === me.id && f.role !== 'manager') return toast('אי אפשר להוריד לעצמך הרשאת מנהל', 'err')
    if (u.role === 'manager' && (f.role !== 'manager' || f.active === false) && list('user').filter((x) => x.role === 'manager' && x.active !== false).length <= 1)
      return toast('חייב להישאר לפחות מנהל אחד', 'err')
    save('user', { ...f, name: f.name.trim(), staffDiscountPct: Math.max(0, Math.min(100, Number(f.staffDiscountPct) || 0)), ...(pin ? { pinHash: hashPin(pin) } : {}) })
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
      <Field label="אחוז הנחת עובד (כשהוא קונה לעצמו)" hint="מוצר עם 'מחיר מוכרים' קבוע — יקבל את המחיר הזה במקום האחוז">
        <input type="number" inputMode="numeric" min="0" max="100" value={f.staffDiscountPct ?? ''} onChange={(e) => setF({ ...f, staffDiscountPct: e.target.value })} placeholder="0" />
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
          <Toggle checked={f.perms.terminal !== false} onChange={setPerm('terminal')} label="מותר לרשום אשראי במסופון" />
          <Toggle checked={f.perms.reports} onChange={setPerm('reports')} label="רואה דוחות" />
        </>
      )}
      <Toggle checked={f.active !== false} onChange={(v) => setF({ ...f, active: v })} label="פעיל" />
      <div className="fp-box">
        <b>👆 טביעת אצבע</b>{' '}
        <span className="muted small">{f.fpTemplates?.length ? `${f.fpTemplates.length} אצבעות רשומות` : 'לא רשום'}</span>
        {fp.ready ? (
          <div className="row gap-s">
            <button className="btn small primary" disabled={enrolling} onClick={enroll}>
              {enrolling ? 'הנח את האצבע 3 פעמים…' : '+ רשום אצבע'}
            </button>
            {f.fpTemplates?.length > 0 && (
              <button className="btn small" onClick={() => setF({ ...f, fpTemplates: [] })}>
                מחק טביעות
              </button>
            )}
          </div>
        ) : (
          <div className="muted small">קורא טביעות לא מחובר למחשב הזה</div>
        )}
      </div>
      <button className="btn primary big grow" onClick={ok}>
        שמור
      </button>
    </Modal>
  )
}

function NedarimSettings({ mode }) {
  const cur = getSetting('nedarim')
  const [f, setF] = useState({ enabled: true, parentLinks: true, minTopup: 50, title: 'מזנון הישיבה', ...cur })
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e })
  function saveIt() {
    const mosad = String(f.mosad || '').replace(/\D/g, '')
    if (mosad && mosad.length !== 7) return toast('מספר מוסד צריך להיות 7 ספרות', 'err')
    if (f.apiValid && /^npk_/i.test(f.apiValid)) return toast('זה המפתח הסודי (ApiPassword)! צריך את "טקסט האימות" ApiValid', 'err')
    if (f.testMode && !getSetting('general').email) return toast('במצב בדיקה נדרים מחייבים מייל — מלא מייל ב"פרטי המזנון" ושמור', 'err')
    setSetting('nedarim', { ...f, mosad, apiValid: String(f.apiValid || '').trim(), minTopup: Number(f.minTopup) || 0 })
    toast('נשמר')
  }
  return (
    <div className="card">
      <h3>💳 תשלום באשראי — נדרים פלוס</h3>
      {mode === 'local' || DEMO ? (
        <p className="muted">זמין רק כשהמערכת מחוברת לשרת.</p>
      ) : (
        <>
          <p className="muted small">
            בנדרים פלוס: עוד ← מפתחות API. מעתיקים את <b>מספר המוסד</b> ואת <b>טקסט האימות (ApiValid)</b>.{' '}
            <b>לא</b> את מפתח ה-ApiPassword (npk_…).
          </p>
          <div className="form-grid">
            <Field label="מספר מוסד">
              <input dir="ltr" inputMode="numeric" value={f.mosad || ''} onChange={set('mosad')} />
            </Field>
            <Field label="טקסט אימות (ApiValid)">
              <input dir="ltr" value={f.apiValid || ''} onChange={set('apiValid')} />
            </Field>
            <Field label="סכום מינימלי לטעינה בקישור ₪">
              <input type="number" value={f.minTopup} onChange={set('minTopup')} />
            </Field>
            <Field label="שם שיופיע בדף ההורים">
              <input value={f.title || ''} onChange={set('title')} />
            </Field>
          </div>
          <Toggle checked={!!f.testMode} onChange={set('testMode')} label="🧪 מצב בדיקה (מוסד הבדיקות של נדרים — לא מחייב באמת)" />
          {f.testMode && (
            <p className="test-note small">
              במצב בדיקה עובדים רק כרטיסי טסט, למשל <span dir="ltr">4557430402321333</span>, תוקף <span dir="ltr">05/31</span>, CVV <span dir="ltr">098</span>.
              הטעינות והמכירות כן נרשמות בתתבוס — אחרי הבדיקה בטל אותן. לכבות לפני עבודה אמיתית!
            </p>
          )}
          <Toggle checked={f.enabled !== false} onChange={set('enabled')} label="אשראי פעיל בקופה" />
          <Toggle checked={f.parentLinks !== false} onChange={set('parentLinks')} label="אפשר קישורי טעינה להורים" />
          <details>
            <summary className="muted small">כתובת לאישורי תשלום (לידיעה)</summary>
            <code className="small" dir="ltr" style={{ wordBreak: 'break-all' }}>
              {nedarimFnUrl}?cb=1
            </code>
            <p className="muted small">הכתובת נשלחת אוטומטית עם כל עסקה — אין צורך להגדיר אותה בנדרים. מומלץ להפעיל בנדרים "חתימת HMAC" ולשמור את המפתח בסוד NEDARIM_WEBHOOK_SECRET ב-Supabase.</p>
          </details>
          <button className="btn primary" onClick={saveIt}>
            שמור
          </button>
        </>
      )}
    </div>
  )
}

function GeneralSettings() {
  const cur = getSetting('general')
  const [f, setF] = useState({ title: 'מזנון הישיבה', ...cur })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <div className="card">
      <h3>🏪 פרטי המזנון</h3>
      <p className="muted small">מופיעים במחירון ובהזמנות לספקים (וואטסאפ / מייל).</p>
      <div className="form-grid">
        <Field label="שם המזנון">
          <input value={f.title || ''} onChange={set('title')} />
        </Field>
        <Field label="איש קשר להזמנות">
          <input value={f.contactName || ''} onChange={set('contactName')} />
        </Field>
        <Field label="טלפון">
          <input value={f.phone || ''} onChange={set('phone')} inputMode="tel" dir="ltr" />
        </Field>
        <Field label="כתובת למשלוח">
          <input value={f.address || ''} onChange={set('address')} />
        </Field>
        <Field label="מייל (התראות על תקלות תשלום)">
          <input value={f.email || ''} onChange={set('email')} type="email" dir="ltr" />
        </Field>
      </div>
      <button
        className="btn primary"
        onClick={() => {
          setSetting('general', { ...f, title: (f.title || '').trim() || 'מזנון' })
          toast('נשמר')
        }}
      >
        שמור
      </button>
    </div>
  )
}
