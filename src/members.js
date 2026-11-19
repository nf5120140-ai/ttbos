// ניהול מיילים עם גישה למערכת — מתוך הקופה (דרך פונקציות ב-Supabase, members-admin.sql)
import { createClient } from '@supabase/supabase-js'
import { sb, SB_URL, SB_KEY } from './sync.js'

const errText = (e) => {
  const m = String(e?.message || e || '')
  if (/function .*tt_(list_members|invite|remove_member)|Could not find the function/i.test(m)) return 'צריך להריץ פעם אחת את הקובץ members-admin.sql ב-Supabase'
  if (/not allowed/.test(m)) return 'אין הרשאה'
  if (/bad email/.test(m)) return 'כתובת מייל לא תקינה'
  if (/cannot remove yourself/.test(m)) return 'אי אפשר להסיר את המייל שאתה מחובר איתו'
  if (/already registered|already been registered/i.test(m)) return 'already'
  if (/Password should be|password/i.test(m)) return 'הסיסמה חייבת להיות לפחות 6 תווים'
  if (/fetch/i.test(m)) return 'אין חיבור לאינטרנט'
  return m
}

export async function listMembers() {
  const { data, error } = await sb.rpc('tt_list_members')
  if (error) throw new Error(errText(error))
  return data || []
}

/** פותח מייל חדש עם סיסמה (בלי לנתק את המנהל), או מאשר מייל קיים */
export async function addMember(email, password) {
  email = String(email || '').trim().toLowerCase()
  // 1. מאשרים מראש — כך שברגע ההרשמה הוא מקבל גישה
  const { data: st, error } = await sb.rpc('tt_invite', { p_email: email })
  if (error) throw new Error(errText(error))
  if (st === 'member' || !password) return st // כבר רשום — קיבל גישה מיד / רק אישור בלי סיסמה
  // 2. יוצרים את החשבון בחיבור נפרד, כדי שהמנהל יישאר מחובר
  const tmp = createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'tt-tmp-signup' } })
  const { error: e2 } = await tmp.auth.signUp({ email, password })
  if (e2) {
    const t = errText(e2)
    if (t !== 'already') throw new Error(t)
  }
  return 'created'
}

export async function removeMember(email) {
  const { error } = await sb.rpc('tt_remove_member', { p_email: email })
  if (error) throw new Error(errText(error))
}
