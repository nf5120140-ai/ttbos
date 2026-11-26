-- ============================================================
-- תתבוס — השלמת סריקות מלפני המעקב (להריץ פעם אחת, אחרי scan-usage.sql)
-- לכל חשבונית שנקלטה ואושרה בעבר (רשומת invoice) נרשמת סריקה אחת עם model = 'backfill'.
-- סריקות שלא אושרו או שנכשלו לפני המעקב — לא נשמרו בשום מקום, ולכן לא נספרות.
-- אפשר להריץ שוב בלי כפילויות.
-- ============================================================
insert into public.tt_scan_log (store_id, created_at, pages, model, ok, error)
select r.store_id,
       coalesce(nullif(r.data->>'createdAt', '')::timestamptz, r.updated_at),
       1, 'backfill', true, 'invoice:' || r.id
from public.tt_records r
where r.kind = 'invoice' and not r.deleted
  and not exists (select 1 from public.tt_scan_log l where l.error = 'invoice:' || r.id);

-- הסיכום מחזיר גם כמה מהסריקות הן מלפני המעקב (בלי נתוני עלות)
drop function if exists public.tt_admin_scan_stats(timestamptz, timestamptz);
create function public.tt_admin_scan_stats(p_from timestamptz, p_to timestamptz)
returns table (store_id uuid, scans bigint, ok_scans bigint, pages bigint, input_tokens bigint, output_tokens bigint, last_at timestamptz, backfill bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.tt_is_super() then
    raise exception 'not allowed';
  end if;
  return query
    select l.store_id, count(*), count(*) filter (where l.ok), coalesce(sum(l.pages), 0),
           coalesce(sum(l.input_tokens), 0), coalesce(sum(l.output_tokens), 0), max(l.created_at),
           count(*) filter (where l.model = 'backfill')
    from public.tt_scan_log l
    where l.created_at >= p_from and l.created_at < p_to
    group by l.store_id;
end;
$$;
revoke all on function public.tt_admin_scan_stats(timestamptz, timestamptz) from public, anon;
grant execute on function public.tt_admin_scan_stats(timestamptz, timestamptz) to authenticated;
