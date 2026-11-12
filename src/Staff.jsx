// ============================================================
// תתבוס — אימות מוכר שקונה במחיר מוכרים (קוד אישי / אישור מנהל / טביעת אצבע)
// ============================================================
import { useEffect, useState } from 'react'
import { list, get, hashPin } from './db.js'
import { Modal, toast } from './ui.jsx'
import { useFingerprint, fpIdentify } from './fp.js'

/**
 * targetUserId — המוכר שאמור לקנות (אם הבחור מקושר למשתמש). אם ריק — בוחרים מהרשימה.
 * onOk({ buyerId, method, approvedBy })
 */
export function VerifyStaffModal({ targetUserId, onOk, onCancel }) {
  const users = list('user').filter((u) => u.active !== false)
  const [buyerId, setBuyerId] = useState(targetUserId || null)
  const [mode, setMode] = useState('self') // self = קוד של הקונה | manager = אישור מנהל
  const [managerId, setManagerId] = useState(null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [fpBusy, setFpBusy] = useState(false)
  const fp = useFingerprint()
  const buyer = buyerId ? get('user', buyerId) : null
  const managers = users.filter((u) => u.role === 'manager')
  const checker = mode === 'self' ? buyer : managerId ? get('user', managerId) : null

  function check(p) {
    if (!checker) return
    if (p.length >= 4 && hashPin(p) === checker.pinHash) {
      onOk({ buyerId, method: mode === 'self' ? 'pin' : 'manager', approvedBy: checker.id })
    }
  }
  function press(d) {
    setErr('')
    const p = (pin + d).slice(0, 8)
    setPin(p)
    check(p)
  }
  function submit() {
    if (checker && hashPin(pin) === checker.pinHash) onOk({ buyerId, method: mode === 'self' ? 'pin' : 'manager', approvedBy: checker.id })
    else {
      setErr('קוד שגוי')
      setPin('')
    }
  }
  async function byFinger() {
    setErr('')
    setFpBusy(true)
    try {
      const r = await fpIdentify()
      const u = get('user', r.userId)
      if (!u) throw new Error('האצבע לא מזוהה')
      if (mode === 'self') {
        if (buyerId && u.id !== buyerId) throw new Error(`האצבע שייכת ל${u.name}, לא ל${buyer?.name}`)
        onOk({ buyerId: u.id, method: 'fingerprint', approvedBy: u.id })
      } else {
        if (u.role !== 'manager') throw new Error(`${u.name} אינו מנהל`)
        onOk({ buyerId, method: 'manager-fingerprint', approvedBy: u.id })
      }
    } catch (e) {
      setErr(e.message || String(e))
    }
    setFpBusy(false)
  }

  useEffect(() => {
    const h = (e) => {
      if (!checker) return
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Enter') submit()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  return (
    <Modal title="🔐 אימות מחיר מוכרים" onClose={onCancel} small>
      {!buyerId ? (
        <>
          <p className="muted">מי המוכר שקונה?</p>
          <div className="seller-list">
            {users.map((u) => (
              <button key={u.id} className="seller" onClick={() => setBuyerId(u.id)}>
                <span className="av">{u.name[0]}</span>
                {u.name}
              </button>
            ))}
          </div>
          {fp.ready && (
            <button className="btn primary big" disabled={fpBusy} onClick={byFinger}>
              {fpBusy ? '👆 הנח אצבע על הקורא…' : '👆 זיהוי באצבע'}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="seg">
            <button className={mode === 'self' ? 'on' : ''} onClick={() => (setMode('self'), setPin(''), setErr(''))}>
              {buyer?.name} מאשר
            </button>
            <button className={mode === 'manager' ? 'on' : ''} onClick={() => (setMode('manager'), setPin(''), setErr(''), setManagerId(managers.length === 1 ? managers[0].id : null))}>
              אישור מנהל
            </button>
          </div>
          {mode === 'manager' && !managerId && (
            <div className="seller-list">
              {managers.map((u) => (
                <button key={u.id} className="seller" onClick={() => setManagerId(u.id)}>
                  <span className="av">{u.name[0]}</span>
                  {u.name}
                </button>
              ))}
            </div>
          )}
          {checker && (
            <>
              <p className="center">
                <b>{checker.name}</b> — {fp.ready ? 'הנח אצבע או הקש את הקוד האישי' : 'הקש את הקוד האישי'}
              </p>
              {fp.ready && (
                <button className="btn primary big" disabled={fpBusy} onClick={byFinger}>
                  {fpBusy ? '👆 הנח אצבע על הקורא…' : '👆 אימות באצבע'}
                </button>
              )}
              <div className="pin-dots">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={i < pin.length ? 'on' : ''} />
                ))}
              </div>
              <div className="pad">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => (
                  <button key={k} onClick={() => (k === '⌫' ? setPin(pin.slice(0, -1)) : k === '✓' ? submit() : press(k))}>
                    {k}
                  </button>
                ))}
              </div>
            </>
          )}
          {!targetUserId && (
            <button className="btn small" onClick={() => (setBuyerId(null), setPin(''))}>
              ← מוכר אחר
            </button>
          )}
        </>
      )}
      {err && <div className="err center">{err}</div>}
      <button className="btn" onClick={onCancel}>
        בלי מחיר מוכרים
      </button>
    </Modal>
  )
}

export const staffMethodLabel = (m) =>
  ({ self: 'המוכר עצמו (מחובר)', pin: 'קוד אישי', manager: 'אישור מנהל', fingerprint: 'טביעת אצבע', 'manager-fingerprint': 'אצבע של מנהל' })[m] || m || ''

export { toast }
