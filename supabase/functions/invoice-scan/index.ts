// ============================================================
// תתבוס — קריאת חשבונית / תעודת משלוח עם Claude
// שם הפונקציה ב-Supabase: invoice-scan
// משאירים "Verify JWT" דלוק — רק מכשיר מחובר יכול לקרוא לה
// סוד נדרש: ANTHROPIC_API_KEY  (Edge Functions → Secrets)
// ============================================================

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-5-5'

function buildPrompt(products: any[], suppliers: any[]) {
  const plist = products.map((p) => `${p.id} | ${p.name} | ${p.barcode || ''} | ${p.category || ''}`).join('\n')
  const slist = suppliers.map((s) => `${s.id} | ${s.name}`).join('\n')
  return `זו חשבונית או תעודת משלוח של ספק למזנון של ישיבה. קרא אותה והחזר JSON בלבד (בלי טקסט נוסף, בלי \`\`\`), במבנה:
{
  "supplierName": "שם הספק כפי שמופיע במסמך",
  "supplierId": "מזהה מרשימת הספקים אם מתאים, אחרת null",
  "docType": "חשבונית" | "תעודת משלוח" | "אחר",
  "docNumber": "מספר המסמך או null",
  "docDate": "YYYY-MM-DD או null",
  "total": מספר — סה"כ לתשלום כולל מע"מ, או null,
  "lines": [
    {
      "name": "שם הפריט כפי שכתוב במסמך",
      "barcode": "ברקוד אם מופיע, אחרת null",
      "packSize": מספר יחידות באריזה/קרטון אם כתוב (למשל מארז 24 → 24), אחרת 1,
      "qty": כמות היחידות הבודדות שהתקבלו בסה"כ (כמות × packSize),
      "unitCost": מחיר עלות ליחידה בודדת כולל מע"מ (אם המחירים במסמך לפני מע"מ — הוסף 18%),
      "productId": "מזהה מוצר מהרשימה אם זה בבירור אותו מוצר (גם אם השם מעט שונה), אחרת null",
      "confidence": "high" | "medium" | "low"
    }
  ]
}

כללים:
- אל תמציא פריטים. אם שורה לא קריאה — הכנס מה שכן קריא ו-confidence "low".
- דלג על שורות של הנחה כללית, דמי משלוח, פיקדון וסיכומים.
- התאמה לרשימת המוצרים: לפי ברקוד אם יש, אחרת לפי שם. אם אין התאמה ברורה — productId: null.

רשימת המוצרים במזנון (מזהה | שם | ברקוד | קטגוריה):
${plist || '(אין מוצרים עדיין)'}

רשימת הספקים (מזהה | שם):
${slist || '(אין ספקים)'}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const key = Deno.env.get('ANTHROPIC_API_KEY')
    if (!key) return json({ error: 'חסר ANTHROPIC_API_KEY בסודות של Supabase' }, 500)
    const body = await req.json()
    const { products = [], suppliers = [] } = body
    // files: [{data, mediaType}] — כמה עמודים / תמונות של אותו מסמך
    const files: Array<{ data: string; mediaType: string }> = body.files || (body.file ? [{ data: body.file, mediaType: body.mediaType }] : [])
    if (!files.length) return json({ error: 'לא התקבל קובץ' }, 400)
    if (files.length > 6) return json({ error: 'עד 6 עמודים בכל פעם' }, 400)

    const docs = files.map((f) =>
      f.mediaType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } }
        : { type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } }
    )

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        messages: [{ role: 'user', content: [...docs, { type: 'text', text: buildPrompt(products, suppliers) }] }],
      }),
    })
    const out = await r.json()
    if (!r.ok) return json({ error: 'שגיאה בקריאת המסמך: ' + (out?.error?.message || r.status) }, 502)
    const text: string = (out.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end < 0) return json({ error: 'לא הצלחתי לקרוא את המסמך. נסה תמונה ברורה יותר.' }, 422)
    const parsed = JSON.parse(text.slice(start, end + 1))
    // ניקוי: מזהים שלא קיימים ברשימה → null
    const pids = new Set(products.map((p: any) => p.id))
    const sids = new Set(suppliers.map((s: any) => s.id))
    parsed.lines = (parsed.lines || []).map((l: any) => ({ ...l, productId: pids.has(l.productId) ? l.productId : null }))
    if (!sids.has(parsed.supplierId)) parsed.supplierId = null
    return json(parsed)
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500)
  }
})
