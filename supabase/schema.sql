-- ============================================================
-- תתבוס — מבנה מסד הנתונים ב-Supabase
-- להריץ פעם אחת: Supabase → SQL Editor → New query → להדביק → Run
-- ============================================================

-- טבלה אחת לכל הנתונים (מוצרים, בחורים, מכירות, תנועות ארנק, מלאי...)
-- כל מכשיר שומר מקומית ושולח לכאן. server_ts נקבע בשרת — לפיו מכשירים מושכים שינויים.
create table if not exists public.tt_records (
  kind        text        not null,
  id          text        not null,
  data        jsonb       not null,
  updated_at  timestamptz not null,
  deleted     boolean     not null default false,
  device      text,
  server_ts   timestamptz not null default clock_timestamp(),
  primary key (kind, id)
);

create index if not exists tt_records_server_ts_idx on public.tt_records (server_ts);

-- כל כתיבה מקבלת חותמת זמן של השרת
create or replace function public.tt_touch()
returns trigger
language plpgsql
as $$
begin
  new.server_ts := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists tt_touch on public.tt_records;
create trigger tt_touch
before insert or update on public.tt_records
for each row execute function public.tt_touch();

-- קליטת שינויים ממכשיר: שינוי ישן לא דורס שינוי חדש יותר
create or replace function public.tt_push(rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.tt_records (kind, id, data, updated_at, deleted, device)
  select r->>'kind',
         r->>'id',
         r->'data',
         (r->>'updated_at')::timestamptz,
         coalesce((r->>'deleted')::boolean, false),
         r->>'device'
  from jsonb_array_elements(rows) as r
  on conflict (kind, id) do update
    set data       = excluded.data,
        updated_at = excluded.updated_at,
        deleted    = excluded.deleted,
        device     = excluded.device
    where public.tt_records.updated_at <= excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- הרשאות: רק מכשיר שהתחבר עם חשבון המזנון
alter table public.tt_records enable row level security;

drop policy if exists tt_records_auth on public.tt_records;
create policy tt_records_auth on public.tt_records
  for all to authenticated
  using (true)
  with check (true);

revoke all on function public.tt_push(jsonb) from public, anon;
grant execute on function public.tt_push(jsonb) to authenticated;

-- עדכונים בזמן אמת בין המכשירים
do $$
begin
  alter publication supabase_realtime add table public.tt_records;
exception when duplicate_object then null;
end $$;
