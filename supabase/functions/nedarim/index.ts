// ============================================================
// תתבוס — פונקציית שרת לתשלומי אשראי דרך נדרים פלוס
// שם הפונקציה ב-Supabase: nedarim
// חובה לכבות "Verify JWT" (נדרים פלוס וההורים פונים בלי התחברות)
//
// פעולות:
//   POST {action:'info',   customerId}                       → שם הבחור + פרטי מוסד (לדף ההורים)
//   POST {action:'create', customerId, amount, payerName}    → פותח תשלום ממתין לטעינת ארנק
//   POST {action:'status', paymentId}                        → מצב התשלום
//   POST ?cb=1  (מנדרים פלוס)                                 → אישור תשלום: רושם את המכירה / הטעינה
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const NEDARIM_IPS = ['18.196.146.117', '18.194.219.73']

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

async function getRecord(kind: string, id: string) {
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

// כתובת השולח. לוקחים את cf-connecting-ip (נקבע ע"י Cloudflare ואי אפשר לזייף),
// ואם אין — את הכתובת האחרונה ב-x-forwarded-for (זו שהוסיף השרת שלנו, לא השולח)
function clientIp(req: Request) {
  const cf = (req.headers.get('cf-connecting-ip') || '').trim()
  if (cf) return cf
  const xf = (req.headers.get('x-forwarded-for') || '').split(',').map((x) => x.trim()).filter(Boolean)
  return xf[xf.length - 1] || ''
}

// אימות נוסף מול נדרים פלוס (רק אם הוגדר הסוד NEDARIM_API_PASSWORD) — לשימוש כשה-IP לא מזוהה
async function verifyWithNedarim(mosad: string, transactionId: string, paymentId: string, amount: number) {
  const apiPassword = Deno.env.get('NEDARIM_API_PASSWORD')
  if (!apiPassword || !mosad || !/^\d+$/.test(transactionId)) return false
  const url = new URL('https://matara.pro/nedarimplus/Reports/Manage3.aspx')
  url.searchParams.set('Action', 'GetHistoryJson')
  url.searchParams.set('MosadId', mosad)
  url.searchParams.set('ApiPassword', apiPassword)
  url.searchParams.set('LastId', String(Number(transactionId) - 1))
  url.searchParams.set('MaxId', '1')
  try {
    const r = await fetch(url)
    const rows = JSON.parse(await r.text())
    const t = (Array.isArray(rows) ? rows : []).find((x: any) => String(x.TransactionId) === transactionId)
    return !!t && Math.abs(Number(t.Amount) - amount) < 0.01 && String(t.Comments || '').includes('tt:' + paymentId)
  } catch {
    return false
  }
}

// מוציא את מזהה התשלום שלנו מתוך הקאלבק (Param1 / Param2 / הערות)
function findPaymentId(body: Record<string, any>) {
  for (const k of ['Param1', 'Param2', 'param1', 'param2']) if (body[k]) return String(body[k]).trim()
  const c = String(body.Comments || body.Comment || '')
  const m = c.match(/tt:([0-9a-fA-F-]{20,})/)
  return m ? m[1] : ''
}

// ---------- אישור תשלום מנדרים פלוס ----------
async function handleCallback(req: Request, body: Record<string, any>) {
  const ip = clientIp(req)
  const ipOk = NEDARIM_IPS.includes(ip)
  const paymentId = findPaymentId(body)
  const amount = Number(body.Amount || 0)

  if (!paymentId) {
    await putRecords([['payment', { id: uid(), status: 'orphan', amount, raw: body, ip, purpose: 'unknown' }]])
    return json({ ok: true, note: 'no payment id' })
  }
  const p = await getRecord('payment', paymentId)
  if (!p) {
    await putRecords([['payment', { id: uid(), status: 'orphan', amount, raw: body, ip, refId: paymentId, purpose: 'unknown' }]])
    return json({ ok: true, note: 'unknown payment' })
  }
  if (p.status === 'paid') return json({ ok: true, note: 'already paid' })

  const info = {
    transactionId: String(body.TransactionId || body.ID || ''),
    confirmation: String(body.Confirmation || ''),
    lastNum: String(body.LastNum || ''),
    payerName: String(body.ClientName || body.FirstName || ''),
    paidAt: nowIso(),
    ip,
  }

  const problems: string[] = []
  if (!ipOk) {
    const s = (await getRecord('setting', 'nedarim')) || {}
    const verified = await verifyWithNedarim(String(s.mosad || body.MosadNumber || ''), info.transactionId, paymentId, amount)
    if (!verified) problems.push('כתובת IP לא מוכרת: ' + ip)
  }
  if (Math.abs(amount - Number(p.amount)) > 0.01) problems.push(`סכום לא תואם (${amount} במקום ${p.amount})`)
  if (problems.length) {
    await putRecords([['payment', { ...p, status: 'suspicious', problems, raw: body, ...info }]])
    return json({ ok: false, problems })
  }

  // הכל תקין — רושמים את המכירה / הטעינה, ומסמנים את התשלום כמאושר
  const ops: Array<[string, Record<string, any>]> = (p.ops || []).map(([k, o]: [string, any]) => [
    k,
    { ...o, ...(k === 'sale' || k === 'wallet' ? { verified: true, nedarimId: info.transactionId } : {}) },
  ])
  ops.push(['payment', { ...p, status: 'paid', ...info }])
  await putRecords(ops)
  return json({ ok: true })
}

// ---------- דף טעינה להורים ----------
async function publicSettings() {
  const s = (await getRecord('setting', 'nedarim')) || {}
  if (!s.mosad || !s.apiValid || s.enabled === false) throw new Error('תשלום באשראי לא הוגדר במערכת')
  if (s.parentLinks === false) throw new Error('טעינה דרך קישור כבויה')
  return { mosad: String(s.mosad), apiValid: String(s.apiValid), minTopup: Number(s.minTopup || 0), title: s.title || 'מזנון' }
}

async function handleInfo(body: Record<string, any>) {
  const c = await getRecord('customer', String(body.customerId || ''))
  if (!c || c.active === false) return json({ error: 'הקישור לא תקף' }, 404)
  const s = await publicSettings()
  return json({ name: c.name, group: c.group || '', minTopup: s.minTopup, title: s.title, mosad: s.mosad, apiValid: s.apiValid })
}

async function handleCreate(req: Request, body: Record<string, any>) {
  const c = await getRecord('customer', String(body.customerId || ''))
  if (!c || c.active === false) return json({ error: 'הקישור לא תקף' }, 404)
  const s = await publicSettings()
  const amount = Math.round(Number(body.amount || 0) * 100) / 100
  if (!(amount > 0) || amount > 5000) return json({ error: 'סכום לא תקין' }, 400)
  if (s.minTopup && amount < s.minTopup) return json({ error: `סכום מינימלי לטעינה: ${s.minTopup} ₪` }, 400)
  const now = nowIso()
  const paymentId = uid()
  const payerName = String(body.payerName || '').slice(0, 50)
  const ops = [
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
  ]
  await putRecords([['payment', { id: paymentId, purpose: 'topup', amount, ops, customerId: c.id, status: 'pending', source: 'parent-link', payerName, deviceName: 'קישור להורים', device: 'parent-link' }]])
  return json({ paymentId, amount, mosad: s.mosad, apiValid: s.apiValid })
}

async function handleStatus(body: Record<string, any>) {
  const p = await getRecord('payment', String(body.paymentId || ''))
  if (!p) return json({ error: 'לא נמצא' }, 404)
  return json({ status: p.status })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  let body: Record<string, any> = {}
  try {
    const text = await req.text()
    try {
      body = JSON.parse(text)
    } catch {
      body = Object.fromEntries(new URLSearchParams(text))
    }
  } catch {}
  try {
    const url = new URL(req.url)
    if (url.searchParams.has('cb') || (!body.action && (body.TransactionId || body.Status || body.Confirmation))) return await handleCallback(req, body)
    if (body.action === 'info') return await handleInfo(body)
    if (body.action === 'create') return await handleCreate(req, body)
    if (body.action === 'status') return await handleStatus(body)
    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500)
  }
})
