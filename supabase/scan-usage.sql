-- ============================================================
-- תתבוס — מעקב סריקות חשבוניות לכל חנות (להריץ פעם אחת ב-SQL Editor)
-- הפונקציה invoice-scan רושמת כל סריקה: חנות, עמודים, טוקנים, הצלחה.
-- מנהל-על רואה סיכום לכל חנות לפי חודש (לחיוב הלקוח).
-- דורש multi-store.sql
-- ============================================================
create table if not exists public.tt_scan_log (
  id            bigint generated always as identity primary key,
  store_id      uuid references public.tt_stores (id) on delete set null,
  user_id       uuid,
  created_at    timestamptz not null default now(),
  pages         int not null default 1,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  model         text,
  ok            boolean not null default true,
  error         text
);
create index if not exists tt_scan_log_store_at on public.tt_scan_log (store_id, created_at);
alter table public.tt_scan_log enable row level security; -- רק הפונקציה (service role) כותבת; קריאה דרך הפונקציה למטה

create or replace function public.tt_admin_scan_stats(p_from timestamptz, p_to timestamptz)
returns table (store_id uuid, scans bigint, ok_scans bigint, pages bigint, input_tokens bigint, output_tokens bigint, last_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.tt_is_super() then
    raise exception 'not allowed';
  end if;
  return query
    select l.store_id, count(*), count(*) filter (where l.ok), coalesce(sum(l.pages), 0),
           coalesce(sum(l.input_tokens), 0), coalesce(sum(l.output_tokens), 0), max(l.created_at)
    from public.tt_scan_log l
    where l.created_at >= p_from and l.created_at < p_to
    group by l.store_id;
end;
$$;
revoke all on function public.tt_admin_scan_stats(timestamptz, timestamptz) from public, anon;
grant execute on function public.tt_admin_scan_stats(timestamptz, timestamptz) to authenticated;
