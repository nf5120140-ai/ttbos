// ============================================================
// תתבוס — אשראי דרך נדרים פלוס + "שולם במסוף"
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { DEMO, get, list, getSetting, createPendingPayment, commitPaymentClientSide, markPaymentFailed, round2 } from './db.js'
import { cloudConfigured, flushNow, nedarimFnUrl, callPublicFn, status as syncStatus, syncNow } from './sync.js'
import { Modal, Field, money, toast, useVersion, fmtTime } from './ui.jsx'

const IFRAME_URL = 'https://www.matara.pro/nedarimplus/iframe/?Picture=Hide'
const isNedarimOrigin = (o) => /^https:\/\/(www\.)?matara\.pro$/.test(String(o || ''))

/** האם אפשר לקבל אשראי מהמכשיר הזה */
export function creditStatus() {
  const s = getSetting('nedarim')
  if (DEMO) return { ok: false, why: 'לא זמין במצב הדגמה' }
  if (!cloudConfigured) return { ok: false, why: 'צריך חיבור לשרת' }
  if (!s.mosad || !s.apiValid) return { ok: false, why: 'מנהל צריך להגדיר את נדרים פלוס בהגדרות' }
  if (s.enabled === false) return { ok: false, why: 'אשראי כבוי בהגדרות' }
  if (!navigator.onLine) return { ok: false, why: 'אין אינטרנט' }
  return { ok: true, mosad: String(s.mosad), apiValid: String(s.apiValid), minTopup: Number(s.minTopup || 0) }
}

/**
 * טופס האשראי של נדרים פלוס.
 * prepare() — נקרא בלחיצה על "חייב", מחזיר {paymentId}. רק אחרי שהתשלום הממתין שמור בשרת.
 * onDone(resp, paymentId) — העסקה עברה.
 */
export function NedarimFrame({ mosad, apiValid, amount, comment = '', prepare, onDone, onFail, askPayer = true, payButtonText }) {
  const frame = useRef(null)
  const pending = useRef(null) // paymentId של העסקה שבתהליך
  const cbs = useRef({})
  cbs.current = { onDone, onFail }
  const [height, setHeight] = useState(0)
  const [phase, setPhase] = useState('loading') // loading | ready | paying | done
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  // מאזין אחד בלבד לכל חיי הרכיב (לפי הנחיות נדרים — אחרת חיוב כפול)
  useEffect(() => {
    const h = (e) => {
      if (!isNedarimOrigin(e.origin)) return
      const d = e.data
      if (!d || !d.Name) return
      if (d.Name === 'Height') {
        setHeight(parseInt(d.Value) + 15)
        setPhase((p) => (p === 'loading' ? 'ready' : p))
      }
      if (d.Name === 'TransactionResponse') {
        const v = d.Value || {}
        const pid = pending.current
        if (!pid) return
        if (v.Status === 'Error') {
          pending.current = null
          setErr(v.Message || 'העסקה נדחתה')
          setPhase('ready')
          markPaymentFailed?.(pid, v.Message)
          cbs.current.onFail?.(pid, v.Message)
        } else {
          pending.current = null
          setPhase('done')
          cbs.current.onDone?.(v, pid)
        }
      }
    }
    window.addEventListener('message', h)
    return () => window.removeEventListener('message', h)
  }, [])

  function post(msg) {
    frame.current?.contentWindow?.postMessage(msg, '*')
  }

  async function pay() {
    if (phase !== 'ready') return
    setErr('')
    setPhase('paying')
    try {
      const { paymentId } = await prepare({ name: name.trim(), phone: phone.replace(/\D/g, '') })
      pending.current = paymentId
      post({
        Name: 'FinishTransaction2',
        Value: {
          Mosad: mosad,
          ApiValid: apiValid,
          PaymentType: 'Ragil',
          Currency: '1',
          Zeout: '',
          FirstName: name.trim().slice(0, 50),
          LastName: '',
          Street: '',
          City: '',
          Phone: phone.replace(/\D/g, '').slice(0, 20),
          Mail: '',
          Amount: String(round2(amount)),
          Tashlumim: '1',
          Day: '',
          Groupe: 'מזנון',
          Comment: (`tt:${paymentId} ` + comment).slice(0, 300),
          Param1: paymentId,
          Param2: paymentId,
          ForceUpdateMatching: '',
          ThirdPartyReceipt: '',
          CallBack: nedarimFnUrl ? nedarimFnUrl + '?cb=1' : '',
          CallBackMailError: '',
          Tokef: '',
        },
      })
    } catch (e) {
      pending.current = null
      setErr(e.message || String(e))
      setPhase('ready')
    }
  }

  return (
    <div className="nedarim">
      {askPayer && phase !== 'done' && (
        <div className="row gap-s">
          <input placeholder="שם בעל הכרטיס (לא חובה)" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="טלפון (לא חובה)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      )}
      {phase === 'loading' && <div className="muted center">טוען טופס תשלום מאובטח…</div>}
      <iframe
        ref={frame}
        title="תשלום מאובטח — נדרים פלוס"
        src={IFRAME_URL}
        scrolling="no"
        onLoad={() => post({ Name: 'GetHeight' })}
        style={{ width: '100%', border: 'none', height: phase === 'done' ? 0 : height, display: phase === 'done' ? 'none' : 'block' }}
      />
      {err && <div className="err center">{err}</div>}
      {phase !== 'done' && (
        <button className="btn primary big grow" disabled={phase !== 'ready'} onClick={pay}>
          {phase === 'paying' ? 'מבצע חיוב… לא לסגור' : payButtonText || `💳 חייב ${money(amount)}`}
        </button>
      )}
      <p className="muted small center">🔒 פרטי הכרטיס מוזנים ישירות במערכת נדרים פלוס ואינם עוברים דרך תתבוס</p>
    </div>
  )
}

/** חלון תשלום אשראי מהקופה / טעינת ארנק בקופה */
export function CreditModal({ title, amount, purpose, buildOps, customerId, user, comment, onPaid, onClose }) {
  useVersion()
  const cs = creditStatus()
  const [paymentId, setPaymentId] = useState(null)
  const [done, setDone] = useState(null)
  const p = paymentId ? get('payment', paymentId) : null

  // אחרי תשלום — דוגם את השרת עד שהאישור מנדרים מגיע
  useEffect(() => {
    if (!done) return
    let n = 0
    const t = setInterval(() => {
      n++
      syncNow()
      if (n > 20) clearInterval(t)
    }, 2500)
    return () => clearInterval(t)
  }, [done])

  async function prepare() {
    if (!navigator.onLine) throw new Error('אין אינטרנט')
    const ops = buildOps()
    const rec = createPendingPayment({ purpose, amount, ops, customerId, userId: user?.id })
    const ok = await flushNow(8000)
    if (!ok) throw new Error('אין חיבור לשרת — נסה שוב' + (syncStatus.error ? ` (${syncStatus.error})` : ''))
    setPaymentId(rec.id)
    return { paymentId: rec.id }
  }

  if (!cs.ok)
    return (
      <Modal title={title} onClose={onClose} small>
        <p className="err">{cs.why}</p>
      </Modal>
    )

  return (
    <Modal title={title} onClose={() => (done || !paymentId || p?.status === 'failed' ? onClose() : toast('העסקה בתהליך — המתן', 'err'))}>
      <div className="pay-amount">{money(amount)}</div>
      {!done ? (
        <NedarimFrame
          mosad={cs.mosad}
          apiValid={cs.apiValid}
          amount={amount}
          comment={comment}
          prepare={prepare}
          onDone={(resp, pid) => {
            commitPaymentClientSide(pid, resp)
            setDone(resp)
            onPaid?.(resp, pid)
          }}
        />
      ) : (
        <div className="paid-box">
          <div className="paid-ok">✓ התשלום עבר</div>
          <div className="muted">
            {done.Confirmation ? `מספר אישור: ${done.Confirmation}` : ''} {done.LastNum ? ` · כרטיס ****${done.LastNum}` : ''}
          </div>
          <div className={'verify ' + (p?.status === 'paid' ? 'ok' : '')}>
            {p?.status === 'paid' ? '✓ אושר ע״י נדרים פלוס' : '⏳ ממתין לאישור מהשרת… (העסקה כבר נרשמה)'}
          </div>
          <button className="btn primary big grow" onClick={onClose}>
            סגור
          </button>
        </div>
      )}
    </Modal>
  )
}

/** אשראי במסופון (נדרים / כל מסוף) — סולקים במסופון ורושמים כאן את הפרטים */
export function TerminalModal({ amount, defaultPhone = '', onConfirm, onClose }) {
  const [conf, setConf] = useState('')
  const [phone, setPhone] = useState(defaultPhone)
  const [last4, setLast4] = useState('')
  const [err, setErr] = useState('')
  function ok() {
    const c = conf.trim().replace(/\s/g, '')
    const ph = phone.replace(/\D/g, '').replace(/^972/, '0')
    const l = last4.replace(/\D/g, '')
    if (c.replace(/\D/g, '').length < 4) return setErr('הקלד את מספר האישור / העסקה מהמסופון')
    if (!/^0\d{8,9}$/.test(ph)) return setErr('הקלד מספר טלפון תקין של הקונה')
    if (l && l.length !== 4) return setErr('4 ספרות אחרונות — בדיוק 4 ספרות (או להשאיר ריק)')
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const t0 = today.toISOString()
    const dup =
      list('sale').some((s) => s.terminal?.confirmation === c && s.createdAt >= t0 && !s.voided) ||
      list('wallet').some((w) => w.terminal?.confirmation === c && w.createdAt >= t0 && !w.voided)
    if (dup) return setErr('מספר האישור הזה כבר נרשם היום')
    onConfirm({ confirmation: c, phone: ph, last4: l })
  }
  return (
    <Modal title="💳 תשלום באשראי — מסופון" onClose={onClose} small>
      <div className="pay-amount">{money(amount)}</div>
      <p className="muted center">סה״כ לתשלום — סלוק בסכום הזה במסופון, ואז מלא:</p>
      <Field label="מספר אישור / עסקה *">
        <input className="big-input" inputMode="numeric" value={conf} onChange={(e) => setConf(e.target.value)} autoFocus />
      </Field>
      <Field label="טלפון של הקונה * (לזיהוי במקרה של בעיה)">
        <input className="big-input" inputMode="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05X-XXXXXXX" />
      </Field>
      <Field label="4 ספרות אחרונות של הכרטיס (לא חובה)">
        <input inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value)} />
      </Field>
      {err && <div className="err">{err}</div>}
      <button className="btn primary big grow" onClick={ok}>
        ✓ שולם — רשום
      </button>
    </Modal>
  )
}

/** דף ציבורי לטעינת ארנק ע״י ההורים: /?topup=<customerId> */
export function ParentTopup({ customerId }) {
  const [info, setInfo] = useState(null)
  const [err, setErr] = useState('')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState('amount') // amount | pay | done
  const [paymentId, setPaymentId] = useState(null)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    callPublicFn('nedarim', { action: 'info', customerId })
      .then(setInfo)
      .catch((e) => setErr(e.message))
  }, [customerId])

  useEffect(() => {
    if (step !== 'done' || !paymentId || confirmed) return
    let n = 0
    const t = setInterval(async () => {
      n++
      try {
        const r = await callPublicFn('nedarim', { action: 'status', paymentId })
        if (r.status === 'paid') {
          setConfirmed(true)
          clearInterval(t)
        }
      } catch {}
      if (n > 25) clearInterval(t)
    }, 2500)
    return () => clearInterval(t)
  }, [step, paymentId, confirmed])

  const a = Number(amount) || 0
  const min = info?.minTopup || 0
  return (
    <div className="login">
      <div className="login-box parent">
        <div className="login-logo">ת</div>
        <h1>טעינת ארנק</h1>
        {err && <p className="err">{err}</p>}
        {!info && !err && <p className="muted">טוען…</p>}
        {info && (
          <>
            <p>
              {info.title} · <b>{info.name}</b> {info.group && <span className="muted">({info.group})</span>}
            </p>
            {step === 'amount' && (
              <>
                <div className="quick">
                  {[50, 100, 150, 200, 300, 500]
                    .filter((x) => x >= min)
                    .map((x) => (
                      <button key={x} className={'btn' + (a === x ? ' primary' : '')} onClick={() => setAmount(String(x))}>
                        {money(x)}
                      </button>
                    ))}
                </div>
                <input className="big-input" type="number" inputMode="decimal" placeholder="סכום אחר" value={amount} onChange={(e) => setAmount(e.target.value)} />
                {min > 0 && <small className="muted">מינימום לטעינה: {money(min)}</small>}
                <button className="btn primary big" disabled={!(a > 0) || a < min} onClick={() => setStep('pay')}>
                  המשך לתשלום
                </button>
              </>
            )}
            {step === 'pay' && (
              <>
                <div className="pay-amount">{money(a)}</div>
                <NedarimFrame
                  mosad={info.mosad}
                  apiValid={info.apiValid}
                  amount={a}
                  comment={'טעינת ארנק ' + info.name}
                  prepare={async ({ name }) => {
                    const r = await callPublicFn('nedarim', { action: 'create', customerId, amount: a, payerName: name })
                    setPaymentId(r.paymentId)
                    return { paymentId: r.paymentId }
                  }}
                  onDone={() => setStep('done')}
                />
                <button className="btn" onClick={() => setStep('amount')}>
                  ← חזרה
                </button>
              </>
            )}
            {step === 'done' && (
              <div className="paid-box">
                <div className="paid-ok">✓ התשלום עבר בהצלחה</div>
                <div className={'verify ' + (confirmed ? 'ok' : '')}>{confirmed ? `✓ ${money(a)} נטענו לארנק של ${info.name}` : '⏳ מעדכן את הארנק…'}</div>
                <p className="muted small">אפשר לסגור את הדף.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function paymentLabel(p) {
  return { cash: 'מזומן', wallet: 'ארנק', credit: 'אשראי אונליין', terminal: 'אשראי (מסופון)' }[p] || p
}
export { fmtTime }
