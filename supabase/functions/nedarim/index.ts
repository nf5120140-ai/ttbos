// ============================================================
// תתבוס — פונקציית שרת לתשלומי אשראי דרך נדרים פלוס
// שם הפונקציה ב-Supabase: nedarim
// חובה לכבות "Verify JWT" (נדרים פלוס וההורים פונים בלי התחברות)
//
// סודות (Edge Functions → Secrets):
//   NEDARIM_WEBHOOK_SECRET  — מומלץ. מפתח חתימת HMAC מנדרים (הגדרות > API > Webhook > חתימת HMAC)
//   NEDARIM_API_PASSWORD    — לא חובה. npk_... לאימות כפול מול הסטוריית העסקאות
//
// פעולות:
//   POST {action:'info',      customerId}                     → שם הבחור + פרטי מוסד (לדף ההורים)
//   POST {action:'create',    customerId, amount, payerName}  → פותח טעינה ממתינה + מקים עסקה בנדרים
//   POST {action:'create_tx', paymentId}                      → מקים עסקה בנדרים לתשלום ממתין מהקופה
//   POST {action:'status',    paymentId}                      → מצב התשלום
//   POST ?cb=1&pid=...  (מנדרים פלוס)                          → עדכון עסקה: רושם את המכירה / הטעינה
//
// הסכום נקבע תמיד כאן בשרת (CreateTransaction) — הדפדפן שולח לאייפרם רק את מזהה העסקה.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const NEDARIM_IPS = ['18.196.146.117', '18.194.219.73']
const TEST_MOSAD = '0'
const TEST_APIVALID = 'j+iyEFN3bE'
const CREATE_URL = Deno.env.get('NEDARIM_CREATE_URL') || 'https://matara.pro/nedarimplus/V6/Files/WebServices/DebitIframe.aspx?Action=CreateTransaction'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const nowIso = () => new Date().toISOString()
const uid = () => crypto.randomUUID()
const clean = (s: unknown, max = 100) =>
  String(s ?? '')
    .replace(/[<>]/g, '')
    .slice(0, max)

async function getRecord(kind: string, id: string) {
  if (!id) return null
  const { data } = await db.from('tt_records').select('data,deleted').eq('kind', kind).eq('id', id).maybeSingle()
  if (!data || data.deleted) return null
  return data.data as Record<string, any>
}

async function putRecords(rows: Array<[string, Record<string, any>]>) {
  const now = nowIso()
  const payload = rows.map(([kind, obj]) => {
    const rec: Record<string, any> = { ...obj, kind, updatedAt: now, createdAt: obj.createdAt || now, device: obj.device || 'nedarim' }
    return { kind, id: rec.id, data: rec, updated_at: now, deleted: !!rec.deleted, device: rec.device }
  })
  const { error } = await db.from('tt_records').upsert(payload, { onConflict: 'kind,id' })
  if (error) throw error
}

// ---------- הגדרות המוסד ----------
async function settings() {
  const s = (await getRecord('setting', 'nedarim')) || {}
  const g = (await getRecord('setting', 'general')) || {}
  const test = !!s.testMode
  const mosad = test ? TEST_MOSAD : String(s.mosad || '')
  const apiValid = test ? TEST_APIVALID : String(s.apiValid || '')
  if (!test && (!mosad || !apiValid)) throw new Error('תשלום באשראי לא הוגדר במערכת')
  if (s.enabled === false) throw new Error('תשלום באשראי כבוי')
  return { s, g, test, mosad, apiValid, minTopup: Number(s.minTopup || 0), title: s.title || g.title || 'מזנון' }
}

// ---------- הקמת עסקה בנדרים (הסכום ננעל כאן) ----------
async function createNedarimTx(_req: Request, p: Record<string, any>, payer: { name?: string; phone?: string } = {}) {
  const st = await settings()
  // הכתובת הציבורית של הפונקציה (req.url בתוך Supabase הוא כתובת פנימית)
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '')
  const cb = `${base}/functions/v1/nedarim?cb=1&pid=${encodeURIComponent(p.id)}`
  const form = new URLSearchParams({
    Mosad: st.mosad,
    ApiValid: st.apiValid,
    PaymentType: 'Ragil',
    Currency: '1',
    Amount: String(p.amount),
    Tashlumim: '1',
    FirstName: clean(payer.name || (st.test ? 'בדיקה' : ''), 50),
    LastName: '',
    Phone: clean(payer.phone || (st.test ? '0500000000' : ''), 20).replace(/\D/g, ''),
    Street: st.test ? 'בדיקה' : '',
    City: st.test ? 'בדיקה' : '',
    Zeout: st.test ? '890108558' : '',
    Mail: st.test ? clean(st.g.email || 'test@example.com', 50) : '',
    Groupe: clean(st.title, 100),
    Comment: clean(`tt:${p.id} ${p.purpose === 'topup' ? 'טעינת ארנק' : 'מזנון'}${p.comment ? ' ' + p.comment : ''}`, 300).replace(/https?:|www\./gi, ''),
    Param2: p.id,
    CallBack: cb,
    CallBackMailError: clean(st.g.email || '', 100),
    AjaxId: String(Date.now()) + Math.floor(Math.random() * 1000),
  })
  const r = await fetch(CREATE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form })
  const text = await r.text()
  let out: Record<string, any> = {}
  try {
    out = JSON.parse(text)
  } catch {
    throw new Error('תשובה לא צפויה מנדרים: ' + text.slice(0, 120))
  }
  if (out.Status !== 'OK' || !out.ID) throw new Error(out.Message || 'נדרים לא הקימו את העסקה')
  await putRecords([['payment', { ...p, createId: String(out.ID), test: st.test, createdTxAt: nowIso() }]])
  return { ID: String(out.ID), Key: out.Key || '', test: st.test }
}

// ---------- אימות מקור העדכון ----------
function clientIp(req: Request) {
  const cf = (req.headers.get('cf-connecting-ip') || '').trim()
  if (cf) return cf
  const xf = (req.headers.get('x-forwarded-for') || '').split(',').map((x) => x.trim()).filter(Boolean)
  return xf[xf.length - 1] || ''
}

async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

/** מחזיר רשימת בעיות (ריקה = מקור מאומת) */
async function verifyOrigin(req: Request, raw: string) {
  const problems: string[] = []
  const secret = Deno.env.get('NEDARIM_WEBHOOK_SECRET')
  const ip = clientIp(req)
  if (secret) {
    const ts = req.headers.get('x-nedarim-timestamp') || ''
    const sig = (req.headers.get('x-nedarim-signature') || '').replace(/^v1=/, '')
    if (!ts || !sig) problems.push('חסרה חתימת HMAC')
    else {
      if (Math.abs(Date.now() / 1000 - Number(ts)) > 900) problems.push('חותמת זמן ישנה')
      const expected = await hmacHex(secret, ts + '.' + raw)
      if (!safeEqual(expected, sig.toLowerCase())) problems.push('חתימת HMAC לא תואמת')
    }
  } else if (!NEDARIM_IPS.includes(ip)) {
    problems.push('כתובת IP לא מוכרת: ' + ip)
  }
  return { problems, ip }
}

// אימות כפול מול הסטוריית העסקאות (רק אם הוגדר NEDARIM_API_PASSWORD)
async function verifyWithHistory(mosad: string, historyId: string, amount: number) {
  const apiPassword = Deno.env.get('NEDARIM_API_PASSWORD')
  if (!apiPassword || !mosad || !/^\d+$/.test(historyId)) return null
  const url = new URL('https://matara.pro/nedarimplus/Reports/Manage3.aspx')
  url.searchParams.set('Action', 'GetHistoryJson')
  url.searchParams.set('MosadId', mosad)
  url.searchParams.set('ApiPassword', apiPassword)
  url.searchParams.set('LastId', String(Number(historyId) - 1))
  url.searchParams.set('MaxId', '1')
  try {
    const rows = JSON.parse(await (await fetch(url)).text())
    const t = (Array.isArray(rows) ? rows : []).find((x: any) => String(x.TransactionId) === historyId)
    return !!t && Math.abs(Number(t.Amount) - amount) < 0.01
  } catch {
    return null
  }
}

function findPaymentId(url: URL, body: Record<string, any>) {
  const pid = url.searchParams.get('pid')
  if (pid) return pid
  for (const k of ['Param2', 'Param1']) if (body[k]) return String(body[k]).trim()
  const m = String(body.Comments || body.Comment || '').match(/tt:([0-9a-fA-F-]{20,})/)
  return m ? m[1] : ''
}

// ---------- עדכון עסקה מנדרים ----------
async function handleCallback(req: Request, raw: string, body: Record<string, any>) {
  const url = new URL(req.url)
  const viaOurCallback = url.searchParams.has('pid')
  const { problems, ip } = await verifyOrigin(req, raw)
  const paymentId = findPaymentId(url, body)
  const p = paymentId ? await getRecord('payment', paymentId) : null

  // ניסיון שנכשל (סירוב / קאפצ'ה / שדה חסר) — לא תשלום. האייפרם מאפשר לנסות שוב.
  if (String(body.Status || '') === 'Error') {
    if (p && p.status === 'pending' && !problems.length)
      await putRecords([['payment', { ...p, lastError: clean(String(body.Message || '').replace(/<br\s*\/?>/gi, ' '), 200), lastErrorAt: nowIso() }]])
    return json({ ok: true, note: 'error attempt' })
  }

  if (!p) {
    if (!problems.length && (body.Confirmation || body.TransactionId))
      await putRecords([['payment', { id: uid(), status: 'orphan', amount: Number(body.Amount || 0), raw: body, ip, refId: paymentId, purpose: 'unknown' }]])
    return json({ ok: true, note: 'unknown payment' })
  }
  if (p.status === 'paid') return json({ ok: true, note: 'already paid' })

  const info = {
    historyId: String(body.ID || (viaOurCallback ? '' : body.TransactionId) || ''),
    confirmation: String(body.Confirmation || ''),
    lastNum: String(body.LastNum || ''),
    payerName: clean(body.ClientName || body.FirstName || '', 50),
    paidAt: nowIso(),
    ip,
  }

  // עסקה זמנית = אין מספר אישור מחברת האשראי
  if (!info.confirmation) problems.push('עסקה זמנית — אין מספר אישור')
  // בעדכון שלנו (pid) מגיע גם TransactionId = מזהה ההקמה — חייב להתאים למה שהקמנו
  if (viaOurCallback && p.createId && body.TransactionId && String(body.TransactionId) !== String(p.createId))
    problems.push('מזהה עסקה לא תואם')
  // סכום: אם נשלח — חייב להתאים. אם לא נשלח — מספיק שהעסקה הוקמה אצלנו (הסכום ננעל בהקמה)
  if (body.Amount != null && body.Amount !== '') {
    if (Math.abs(Number(body.Amount) - Number(p.amount)) > 0.01) problems.push(`סכום לא תואם (${body.Amount} במקום ${p.amount})`)
  } else if (!p.createId) problems.push('אין סכום בעדכון והעסקה לא הוקמה בשרת')

  // מקור לא מאומת → ניסיון אחרון מול הסטוריית העסקאות
  if (problems.some((x) => x.startsWith('כתובת IP')) && info.historyId) {
    const st = await settings().catch(() => null)
    const ok = st ? await verifyWithHistory(st.mosad, info.historyId, Number(p.amount)) : null
    if (ok) problems.splice(problems.findIndex((x) => x.startsWith('כתובת IP')), 1)
  }

  if (problems.length) {
    await putRecords([['payment', { ...p, status: 'suspicious', problems, raw: body, ...info }]])
    return json({ ok: false, problems })
  }

  const ops: Array<[string, Record<string, any>]> = (p.ops || []).map(([k, o]: [string, any]) => [
    k,
    { ...o, ...(k === 'sale' || k === 'wallet' ? { verified: true, nedarimId: info.historyId, ...(p.test ? { test: true } : {}) } : {}) },
  ])
  ops.push(['payment', { ...p, status: 'paid', ...info }])
  await putRecords(ops)
  return json({ ok: true })
}

// ---------- דף טעינה להורים ----------
async function handleInfo(body: Record<string, any>) {
  const c = await getRecord('customer', String(body.customerId || ''))
  if (!c || c.active === false) return json({ error: 'הקישור לא תקף' }, 404)
  const st = await settings()
  if (st.s.parentLinks === false) return json({ error: 'טעינה דרך קישור כבויה' }, 403)
  return json({ name: c.name, group: c.group || '', minTopup: st.minTopup, title: st.title, test: st.test })
}

async function handleCreate(req: Request, body: Record<string, any>) {
  const c = await getRecord('customer', String(body.customerId || ''))
  if (!c || c.active === false) return json({ error: 'הקישור לא תקף' }, 404)
  const st = await settings()
  if (st.s.parentLinks === false) return json({ error: 'טעינה דרך קישור כבויה' }, 403)
  const amount = Math.round(Number(body.amount || 0) * 100) / 100
  if (!(amount > 0) || amount > 5000) return json({ error: 'סכום לא תקין' }, 400)
  if (st.minTopup && amount < st.minTopup) return json({ error: `סכום מינימלי לטעינה: ${st.minTopup} ₪` }, 400)
  const now = nowIso()
  const payerName = clean(body.payerName || '', 50)
  const p = {
    id: uid(),
    purpose: 'topup',
    amount,
    customerId: c.id,
    status: 'pending',
    source: 'parent-link',
    payerName,
    comment: c.name,
    deviceName: 'קישור להורים',
    device: 'parent-link',
    ops: [
      [
        'wallet',
        {
          id: uid(),
          customerId: c.id,
          amount,
          type: 'topup',
          method: 'credit',
          note: 'טעינה מקישור' + (payerName ? ' — ' + payerName : ''),
          deviceName: 'קישור להורים',
          device: 'parent-link',
          createdAt: now,
        },
      ],
    ],
  }
  await putRecords([['payment', p]])
  const tx = await createNedarimTx(req, p, { name: payerName, phone: body.phone })
  return json({ paymentId: p.id, amount, txId: tx.ID, test: tx.test })
}

// ---------- קופה: הקמת עסקה לתשלום שכבר נשמר ----------
async function handleCreateTx(req: Request, body: Record<string, any>) {
  const p = await getRecord('payment', String(body.paymentId || ''))
  if (!p) return json({ error: 'התשלום עוד לא הגיע לשרת — נסה שוב' }, 404)
  if (p.status !== 'pending') return json({ error: 'התשלום כבר טופל' }, 409)
  if (!(Number(p.amount) > 0) || Number(p.amount) > 5000) return json({ error: 'סכום לא תקין' }, 400)
  const tx = await createNedarimTx(req, p, { name: body.payerName, phone: body.phone })
  return json({ paymentId: p.id, txId: tx.ID, test: tx.test })
}

async function handleStatus(body: Record<string, any>) {
  const p = await getRecord('payment', String(body.paymentId || ''))
  if (!p) return json({ error: 'לא נמצא' }, 404)
  return json({ status: p.status, lastError: p.lastError || '' })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const raw = await req.text().catch(() => '')
  let body: Record<string, any> = {}
  try {
    body = JSON.parse(raw)
  } catch {
    body = Object.fromEntries(new URLSearchParams(raw))
  }
  try {
    const url = new URL(req.url)
    if (url.searchParams.has('cb') || (!body.action && (body.Status || body.Confirmation || body.TransactionId))) return await handleCallback(req, raw, body)
    if (body.action === 'info') return await handleInfo(body)
    if (body.action === 'create') return await handleCreate(req, body)
    if (body.action === 'create_tx') return await handleCreateTx(req, body)
    if (body.action === 'status') return await handleStatus(body)
    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500)
  }
})
