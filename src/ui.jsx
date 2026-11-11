import { useEffect, useRef, useState } from 'react'
import { subscribe } from './db.js'
import { onStatus } from './sync.js'

// ---------- hooks ----------
export function useVersion() {
  const [v, setV] = useState(0)
  useEffect(() => subscribe(setV), [])
  return v
}
export function useSyncStatus() {
  const [s, setS] = useState({})
  useEffect(() => onStatus(setS), [])
  return s
}

// ---------- format ----------
export function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return '₪' + v.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
export const fmtDate = (iso) => new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
export const fmtDT = (iso) => fmtDate(iso) + ' ' + fmtTime(iso)

export function can(user, perm) {
  if (!user) return false
  if (user.role === 'manager') return true
  if (perm === 'terminal') return user.perms?.terminal !== false // אשראי במסופון — פתוח כברירת מחדל
  return !!user.perms?.[perm]
}

export function waLink(phone, text) {
  let p = String(phone || '').replace(/\D/g, '')
  if (p.startsWith('0')) p = '972' + p.slice(1)
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`
}

export function downloadFile(name, content, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + content], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(a.href)
    a.remove()
  }, 500)
}
export function toCsv(rows) {
  return rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
}

export function resizeImage(file, size = 220) {
  return new Promise((res, rej) => {
    const img = new Image()
    const r = new FileReader()
    r.onload = () => {
      img.onload = () => {
        const c = document.createElement('canvas')
        const s = Math.min(1, size / Math.max(img.width, img.height))
        c.width = Math.round(img.width * s)
        c.height = Math.round(img.height * s)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        res(c.toDataURL('image/jpeg', 0.8))
      }
      img.onerror = rej
      img.src = r.result
    }
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

// ---------- toast ----------
let toastSetter = null
export function toast(msg, kind = 'ok') {
  toastSetter && toastSetter({ msg, kind, id: Date.now() })
}
export function ToastHost() {
  const [t, setT] = useState(null)
  useEffect(() => {
    toastSetter = setT
    return () => (toastSetter = null)
  }, [])
  useEffect(() => {
    if (!t) return
    const h = setTimeout(() => setT(null), 2600)
    return () => clearTimeout(h)
  }, [t])
  if (!t) return null
  return <div className={'toast ' + t.kind}>{t.msg}</div>
}

// ---------- confirm ----------
let confirmSetter = null
export function confirmDlg(text, okText = 'אישור') {
  return new Promise((resolve) => confirmSetter && confirmSetter({ text, okText, resolve }))
}
export function ConfirmHost() {
  const [c, setC] = useState(null)
  useEffect(() => {
    confirmSetter = setC
    return () => (confirmSetter = null)
  }, [])
  if (!c) return null
  const done = (v) => {
    c.resolve(v)
    setC(null)
  }
  return (
    <Modal title="אישור" onClose={() => done(false)} small>
      <p style={{ fontSize: 18, margin: '8px 0 20px' }}>{c.text}</p>
      <div className="row gap">
        <button className="btn danger grow" onClick={() => done(true)}>
          {c.okText}
        </button>
        <button className="btn grow" onClick={() => done(false)}>
          ביטול
        </button>
      </div>
    </Modal>
  )
}

// ---------- components ----------
export function Modal({ title, onClose, children, small, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={'modal' + (small ? ' small' : '') + (wide ? ' wide' : '')}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="סגור">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track">
        <span className="knob" />
      </span>
      <span>{label}</span>
    </label>
  )
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>
}

export function ProductThumb({ p, size = 48 }) {
  if (p?.img) return <img className="thumb" src={p.img} alt="" style={{ width: size, height: size }} />
  return (
    <span className="thumb emoji" style={{ width: size, height: size, fontSize: size * 0.6 }}>
      {p?.emoji || '📦'}
    </span>
  )
}

/** קליטת סורק ברקודים (מתחבר כמקלדת) — מזהה הקלדה מהירה שמסתיימת ב-Enter */
export function useBarcodeScanner(onCode, enabled = true) {
  const ref = useRef(onCode)
  ref.current = onCode
  useEffect(() => {
    if (!enabled) return
    let buf = ''
    let last = 0
    const h = (e) => {
      const t = e.target
      const tag = t?.tagName
      const inField = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && !t.dataset?.scan
      if (inField) return
      const now = performance.now()
      if (e.key === 'Enter') {
        if (buf.length >= 3) {
          e.preventDefault()
          ref.current(buf)
        }
        buf = ''
        return
      }
      if (e.key.length !== 1) return
      if (now - last > 80) buf = ''
      buf += e.key
      last = now
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [enabled])
}

/** סריקה במצלמה (Chrome באנדרואיד תומך ב-BarcodeDetector) */
export const cameraScanSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window

export function CameraScanner({ onCode, onClose }) {
  const vid = useRef(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let stream = null
    let stop = false
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        vid.current.srcObject = stream
        await vid.current.play()
        // eslint-disable-next-line no-undef
        const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'] })
        const loop = async () => {
          if (stop) return
          try {
            const codes = await det.detect(vid.current)
            if (codes.length) {
              onCode(codes[0].rawValue)
              return
            }
          } catch {}
          setTimeout(loop, 200)
        }
        loop()
      } catch (e) {
        setErr('אין גישה למצלמה: ' + (e.message || e))
      }
    })()
    return () => {
      stop = true
      stream && stream.getTracks().forEach((t) => t.stop())
    }
  }, [])
  return (
    <Modal title="סריקה במצלמה" onClose={onClose} small>
      {err ? <p className="err">{err}</p> : <video ref={vid} className="cam" playsInline muted />}
      <p className="muted center">כוון את הברקוד למרכז המסך</p>
    </Modal>
  )
}
