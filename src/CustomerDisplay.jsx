// מסך לקוח — מוצג על המסך הקטן שפונה לקונה. רק תצוגה, בלי כפתורים.
import { useEffect, useRef, useState } from 'react'
import { subscribeDisplay } from './display.js'

const money = (n) => '₪' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 })

export default function CustomerDisplay() {
  const [st, setSt] = useState({ state: 'idle' })
  const holdUntil = useRef(0)
  const listRef = useRef(null)

  useEffect(() => {
    document.body.classList.add('cd-body')
    return subscribeDisplay((p) => {
      if (!p || p.hello) return
      // מסך "תודה" נשאר כמה שניות, אלא אם מתחילים לסרוק את הקונה הבא
      if (p.state === 'thanks') holdUntil.current = Date.now() + 6000
      else if (p.state === 'idle' && Date.now() < holdUntil.current) {
        const left = holdUntil.current - Date.now()
        setTimeout(() => setSt((cur) => (cur.state === 'thanks' ? { ...p } : cur)), left)
        return
      }
      setSt(p)
    })
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [st])

  const title = st.title || 'המזנון'

  if (st.state === 'thanks')
    return (
      <div className="cd cd-center">
        <div className="cd-big">תודה! 🙏</div>
        <div className="cd-mid">שולם {money(st.total)}</div>
        {st.customer && st.customer.balance != null && (
          <div className="cd-bal">
            {st.customer.name} · יתרה בארנק: <b>{money(st.customer.balance)}</b>
          </div>
        )}
        {st.change > 0 && <div className="cd-mid">עודף: {money(st.change)}</div>}
      </div>
    )

  if (st.state !== 'cart' || !st.lines?.length)
    return (
      <div className="cd cd-center">
        <div className="cd-title">{title}</div>
        <div className="cd-big">ברוכים הבאים</div>
        {st.customer && <div className="cd-bal">{st.customer.name} · יתרה: <b>{money(st.customer.balance)}</b></div>}
      </div>
    )

  return (
    <div className="cd">
      <div className="cd-head">
        <span>{title}</span>
        {st.customer && (
          <span className="cd-cust">
            {st.customer.name} · יתרה {money(st.customer.balance)}
          </span>
        )}
      </div>
      <div className="cd-lines" ref={listRef}>
        {st.lines.map((l, i) => (
          <div key={i} className="cd-line">
            <span className="cd-name">
              {l.emoji ? l.emoji + ' ' : ''}
              {l.name}
              {l.promo && <span className="cd-promo"> · {l.promo}</span>}
            </span>
            <span className="cd-qty">{l.qty > 1 ? `${l.qty} × ${money(l.unit)}` : ''}</span>
            <span className="cd-sum">{money(l.sum)}</span>
          </div>
        ))}
      </div>
      {st.saving > 0 && <div className="cd-saving">חסכת {money(st.saving)} 🎉</div>}
      <div className="cd-total">
        <span>לתשלום ({st.count} פריטים)</span>
        <b>{money(st.total)}</b>
      </div>
    </div>
  )
}
