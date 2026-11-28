-- ============================================================
-- איפוס נתוני מכירות לפני יום חמישי 26.11.2026 (שעון ישראל)
-- החנות: החנות שהמייל mtkm7040@gmail.com חבר בה
--
-- מה נמחק: מכירות, תשלומי אשראי (נדרים), פתיחות מגירה, ספירות קופה.
-- מה לא נוגעים: מוצרים, מלאי, לקוחות, ארנקים (יתרות), משתמשים, הגדרות.
-- המחיקה "רכה" (deleted = true) — אפשר לבטל עם החלק בסוף הקובץ.
-- הקופות מקבלות את המחיקה לבד בסנכרון הבא.
--
-- הרצה: מריצים קודם את שלב 1 בלבד (בדיקה), ואם המספרים נראים נכון — את שלב 2.
-- ============================================================


-- ---------- שלב 1: בדיקה בלבד (לא משנה כלום) ----------
with st as (
  select distinct m.store_id from public.tt_members m where lower(m.email) = 'mtkm7040@gmail.com'
)
select s.name as "חנות",
       r.kind as "סוג",
       count(*) filter (where r.data->>'createdAt' <  '2026-11-25T22:00:00.000Z') as "יימחקו (לפני חמישי)",
       count(*) filter (where r.data->>'createdAt' >= '2026-11-25T22:00:00.000Z') as "נשארים (מחמישי)"
from public.tt_records r
join st on st.store_id = r.store_id
join public.tt_stores s on s.id = r.store_id
where r.kind in ('sale', 'payment', 'kevent', 'count')
  and not r.deleted
group by s.name, r.kind
order by 1, 2;


-- ---------- שלב 2: מחיקה (להריץ אחרי שבדקת את שלב 1) ----------
/*
with st as (
  select distinct m.store_id from public.tt_members m where lower(m.email) = 'mtkm7040@gmail.com'
), ts as (
  select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as iso
)
update public.tt_records r
   set deleted = true,
       updated_at = now(),
       data = r.data || jsonb_build_object('deleted', true, 'updatedAt', ts.iso, 'resetBatch', 'reset-2026-11-26')
  from st, ts
 where r.store_id = st.store_id
   and r.kind in ('sale', 'payment', 'kevent', 'count')
   and not r.deleted
   and r.data->>'createdAt' < '2026-11-25T22:00:00.000Z';
*/


-- ---------- ביטול (רק אם צריך להחזיר) ----------
/*
with ts as (
  select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as iso
)
update public.tt_records r
   set deleted = false,
       updated_at = now(),
       data = (r.data - 'resetBatch') || jsonb_build_object('deleted', false, 'updatedAt', ts.iso)
  from ts
 where r.data->>'resetBatch' = 'reset-2026-11-26';
*/
