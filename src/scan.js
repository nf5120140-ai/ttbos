// ============================================================
// סורק ברקוד גלובלי — סריקה תמיד מגיעה ליעד של העמוד הפתוח (שדה הברקוד / הסל),
// לא משנה איפה הסמן נמצא. הקלדה ידנית רגילה לא נפגעת.
// כל עמוד / חלון רושם יעד עם useScanTarget; היעד העליון (חלון פתוח > עמוד) מקבל את הסריקה.
// ============================================================
import { useEffect, useRef } from 'react'

const stack = [] // [{id, prio, ref, at}]
let seq = 0

/** רישום יעד לסריקות. prio: עמוד = 0, חלון = 1, מצב מחסן = 2 */
export function useScanTarget(fn, enabled = true, prio = 0) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!enabled) return
    const t = { id: ++seq, prio, ref, at: performance.now() + seq / 1e6 }
    stack.push(t)
    return () => {
      const i = stack.indexOf(t)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [enabled, prio])
}

function top() {
  let best = null
  for (const t of stack) if (!best || t.prio > best.prio || (t.prio === best.prio && t.at > best.at)) best = t
  return best
}

// תו לפי המקש הפיזי — כך ברקוד עם אותיות נקלט נכון גם כשהמקלדת בעברית
export function keyChar(e) {
  const c = e.code || ''
  if (c.startsWith('Key')) return e.shiftKey || e.getModifierState?.('CapsLock') ? c.slice(3) : c.slice(3).toLowerCase()
  if (c.startsWith('Digit')) return c.slice(5)
  if (c.startsWith('Numpad') && /\d$/.test(c)) return c.slice(-1)
  if (c === 'Minus' || c === 'NumpadSubtract') return '-'
  if (c === 'Period' || c === 'NumpadDecimal') return '.'
  return e.key && e.key.length === 1 ? e.key : ''
}
function setNativeValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const GAP = 50 // מ"ש בין תווים — מהר יותר = סורק
const IDLE = 120 // סורק בלי Enter בסוף: מסיימים אחרי הפסקה

let installed = false
export function installGlobalScanner() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const st = { buf: '', last: 0, fast: 0, el: null, snap: null, timer: null }
  const fire = () => {
    clearTimeout(st.timer)
    const code = st.buf
    const ok = st.fast >= 3 && code.length >= 4
    st.buf = ''
    st.fast = 0
    if (!ok) return
    const t = top()
    if (t) t.ref.current(code, 'scanner')
  }
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (!top()) return
      const now = e.timeStamp || performance.now()
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (st.fast >= 3 && st.buf.length >= 4 && now - st.last < 150) {
          e.preventDefault()
          e.stopPropagation()
          fire()
        } else {
          st.buf = ''
          st.fast = 0
        }
        return
      }
      const ch = keyChar(e)
      if (!ch) return
      if (now - st.last > GAP) {
        // אולי הקלדה ידנית — התו נכנס, אבל זוכרים מה היה בשדה לפני
        clearTimeout(st.timer)
        st.buf = ch
        st.fast = 0
        const t = e.target
        st.el = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') ? t : null
        st.snap = st.el ? st.el.value : null
      } else {
        // סורק: התווים לא נכנסים לשום שדה
        e.preventDefault()
        e.stopPropagation()
        st.buf += ch
        st.fast++
        if (st.fast === 1 && st.el && st.snap != null && st.el.value !== st.snap) setNativeValue(st.el, st.snap)
        clearTimeout(st.timer)
        st.timer = setTimeout(fire, IDLE)
      }
      st.last = now
    },
    true
  )
}
