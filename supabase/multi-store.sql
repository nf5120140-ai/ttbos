-- ============================================================
-- תתבוס — כמה חנויות נפרדות באותה מערכת (להריץ פעם אחת ב-SQL Editor)
-- דורש שקודם הורצו: schema.sql, members.sql, members-admin.sql
--
-- • כל מי שנרשם עם מייל חדש פותח חנות חדשה — במצב "ממתין לאישור"
-- • רק מנהל-על מאשר / חוסם חנויות, ויכול להיכנס לנתונים של חנות לתמיכה
--   (המייל של מנהל-העל מוגדר בפקודה נפרדת — ראה בסוף הקובץ)
-- • לכל חנות נתונים נפרדים לגמרי
-- • הנתונים הקיימים הופכים לחנות הראשונה (פעילה)
-- אפשר להריץ שוב בלי נזק.
-- ============================================================

-- ---------- טבלאות ----------
create table if not exists public.tt_stores (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default '',
  phone      text,
  owner      uuid,
  status     text not null default 'pending' check (status in ('pending', 'active', 'blocked')),
  features   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.tt_stores enable row level security; -- רק דרך הפונקציות

create table if not exists public.tt_super (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  acting_store uuid references public.tt_stores (id) on delete set null -- חנות שמנהל-העל נכנס אליה כרגע
);
alter table public.tt_super add column if not exists acting_store uuid references public.tt_stores (id) on delete set null;
alter table public.tt_super enable row level security;

-- מיילים של מנהלי-על (גם כאלה שעוד לא נרשמו)
create table if not exists public.tt_super_emails (email text primary key);
alter table public.tt_super_emails enable row level security;

alter table public.tt_members add column if not exists store_id uuid references public.tt_stores (id) on delete cascade;
alter table public.tt_invites add column if not exists store_id uuid references public.tt_stores (id) on delete cascade;
alter table public.tt_records add column if not exists store_id uuid;

-- ---------- העברת הנתונים הקיימים לחנות הראשונה ----------
do $$
declare
  sid uuid;
begin
  if exists (select 1 from public.tt_members where store_id is null)
     or exists (select 1 from public.tt_records where store_id is null)
     or exists (select 1 from public.tt_invites where store_id is null) then
    select id into sid from public.tt_stores order by created_at limit 1;
    if sid is null then
      insert into public.tt_stores (name, status, features)
      values ('החנות הראשית', 'active', '{"invoice_scan": true, "env_secrets": true}'::jsonb)
      returning id into sid;
    end if;
    update public.tt_members set store_id = sid where store_id is null;
    update public.tt_invites set store_id = sid where store_id is null;
    -- בלי לשנות את חותמת הזמן — כדי שהמכשירים לא יורידו הכול מחדש
    alter table public.tt_records disable trigger tt_touch;
    update public.tt_records set store_id = sid where store_id is null;
    alter table public.tt_records enable trigger tt_touch;
    update public.tt_stores
       set owner = (select user_id from public.tt_members where store_id = sid order by created_at limit 1)
     where id = sid and owner is null;
  end if;
end $$;

-- מפתח ראשי לפי חנות (אותו מזהה יכול להופיע בשתי חנויות)
do $$
begin
  if not exists (
    select 1 from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
    where i.indrelid = 'public.tt_records'::regclass and i.indisprimary and a.attname = 'store_id'
  ) then
    alter table public.tt_records alter column store_id set not null;
    alter table public.tt_records drop constraint if exists tt_records_pkey;
    alter table public.tt_records add primary key (store_id, kind, id);
  end if;
end $$;
create index if not exists tt_records_store_ts_idx on public.tt_records (store_id, server_ts);

-- ---------- מי אני ----------
-- החנות שלי: מנהל-על שנכנס לחנות → אותה חנות; אחרת → החנות שאני חבר בה
create or replace function public.tt_my_store()
returns uuid
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select acting_store from public.tt_super where user_id = auth.uid()),
    (select store_id from public.tt_members where user_id = auth.uid())
  )
$$;

create or replace function public.tt_is_super()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.tt_super where user_id = auth.uid()) $$;

-- "חבר" = שייך לחנות פעילה, או מנהל-על שנכנס לחנות (גם אם היא ממתינה/חסומה — לתמיכה)
create or replace function public.tt_is_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.tt_super where user_id = auth.uid() and acting_store is not null)
      or exists (
        select 1 from public.tt_members m join public.tt_stores s on s.id = m.store_id
        where m.user_id = auth.uid() and s.status = 'active'
           and not exists (select 1 from public.tt_super x where x.user_id = auth.uid() and x.acting_store is not null)
      )
$$;

create or replace function public.tt_my_status()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object(
       'store_id', s.id, 'name', s.name,
       'status', case when public.tt_is_super() then 'active' else s.status end,
       'real_status', s.status, 'features', s.features,
       'is_super', public.tt_is_super(), 'is_owner', s.owner = auth.uid(),
       'acting', exists (select 1 from public.tt_super x where x.user_id = auth.uid() and x.acting_store = s.id))
     from public.tt_stores s
     where s.id = public.tt_my_store()),
    jsonb_build_object('status', 'none', 'is_super', public.tt_is_super())
  )
$$;

-- ---------- הרשאות על הנתונים: רק החנות שלי, ורק אם היא פעילה ----------
drop policy if exists tt_records_auth on public.tt_records;
drop policy if exists tt_records_members on public.tt_records;
drop policy if exists tt_records_store on public.tt_records;
create policy tt_records_store on public.tt_records
  for all to authenticated
  using (store_id = public.tt_my_store() and public.tt_is_member())
  with check (store_id = public.tt_my_store() and public.tt_is_member());

-- קליטת שינויים ממכשיר — החנות נקבעת בשרת לפי המשתמש (המכשיר לא יכול לבחור)
create or replace function public.tt_push(rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
  sid uuid := public.tt_my_store();
begin
  if sid is null or not public.tt_is_member() then
    raise exception 'store not active';
  end if;
  insert into public.tt_records (store_id, kind, id, data, updated_at, deleted, device)
  select sid,
         r->>'kind',
         r->>'id',
         r->'data',
         (r->>'updated_at')::timestamptz,
         coalesce((r->>'deleted')::boolean, false),
         r->>'device'
  from jsonb_array_elements(rows) as r
  on conflict (store_id, kind, id) do update
    set data       = excluded.data,
        updated_at = excluded.updated_at,
        deleted    = excluded.deleted,
        device     = excluded.device
    where public.tt_records.updated_at <= excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------- הרשמה ----------
-- מייל שהוזמן → מצטרף לחנות שהזמינה אותו
-- הראשון במערכת → חנות פעילה + מנהל-על
-- כל השאר → חנות חדשה שממתינה לאישור
create or replace function public.tt_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  sid uuid;
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  select * into inv from public.tt_invites where email = lower(new.email) limit 1;
  if found then
    insert into public.tt_members (user_id, email, store_id) values (new.id, new.email, inv.store_id)
    on conflict do nothing;
    delete from public.tt_invites where email = lower(new.email);
  elsif exists (select 1 from public.tt_super_emails where email = lower(new.email)) then
    -- מנהל-על: בלי חנות משלו
    insert into public.tt_super (user_id) values (new.id) on conflict do nothing;
  elsif not exists (select 1 from public.tt_members) then
    insert into public.tt_stores (name, phone, owner, status, features)
    values (coalesce(nullif(meta->>'store_name', ''), 'החנות הראשית'), meta->>'phone', new.id, 'active', '{"invoice_scan": true, "env_secrets": true}'::jsonb)
    returning id into sid;
    insert into public.tt_members (user_id, email, store_id) values (new.id, new.email, sid);
  else
    insert into public.tt_stores (name, phone, owner, status)
    values (coalesce(nullif(meta->>'store_name', ''), new.email), meta->>'phone', new.id, 'pending')
    returning id into sid;
    insert into public.tt_members (user_id, email, store_id) values (new.id, new.email, sid);
  end if;
  return new;
end;
$$;

-- ---------- ניהול מיילים בתוך החנות (מחליף את members-admin) ----------
create or replace function public.tt_list_members()
returns table (email text, status text, created_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = public
as $$
declare
  sid uuid := public.tt_my_store();
begin
  if not public.tt_is_member() then
    raise exception 'not allowed';
  end if;
  return query
    select m.email, 'member'::text, m.created_at, m.user_id = auth.uid() from public.tt_members m where m.store_id = sid
    union all
    select i.email, 'invite'::text, i.created_at, false from public.tt_invites i where i.store_id = sid
    order by 3;
end;
$$;

create or replace function public.tt_invite(p_email text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  e text := lower(trim(p_email));
  sid uuid := public.tt_my_store();
  uid uuid;
  other uuid;
begin
  if not public.tt_is_member() then
    raise exception 'not allowed';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'bad email';
  end if;
  select id into uid from auth.users where lower(email) = e limit 1;
  if uid is not null then
    select store_id into other from public.tt_members where user_id = uid;
    if other is not null and other <> sid then
      raise exception 'belongs to another store';
    end if;
    insert into public.tt_members (user_id, email, store_id) values (uid, e, sid) on conflict do nothing;
    delete from public.tt_invites where email = e;
    return 'member';
  end if;
  insert into public.tt_invites (email, invited_by, store_id) values (e, auth.uid(), sid)
  on conflict (email) do update set store_id = excluded.store_id, invited_by = excluded.invited_by
    where public.tt_invites.store_id = sid;
  return 'invite';
end;
$$;

create or replace function public.tt_remove_member(p_email text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  e text := lower(trim(p_email));
  sid uuid := public.tt_my_store();
begin
  if not public.tt_is_member() then
    raise exception 'not allowed';
  end if;
  if exists (select 1 from public.tt_members where user_id = auth.uid() and lower(email) = e) then
    raise exception 'cannot remove yourself';
  end if;
  delete from public.tt_members where lower(email) = e and store_id = sid;
  delete from public.tt_invites where email = e and store_id = sid;
  return 'ok';
end;
$$;

-- ---------- מנהל-על: חנויות ----------
create or replace function public.tt_admin_stores()
returns table (id uuid, name text, phone text, owner_email text, status text, features jsonb, created_at timestamptz,
               members bigint, records bigint, last_activity timestamptz, is_mine boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.tt_is_super() then
    raise exception 'not allowed';
  end if;
  return query
    select s.id, s.name, s.phone,
           (select u.email::text from auth.users u where u.id = s.owner),
           s.status, s.features, s.created_at,
           (select count(*) from public.tt_members m where m.store_id = s.id),
           (select count(*) from public.tt_records r where r.store_id = s.id),
           (select max(r.server_ts) from public.tt_records r where r.store_id = s.id),
           s.id = public.tt_my_store()
    from public.tt_stores s
    order by (s.status = 'pending') desc, s.created_at desc;
end;
$$;

create or replace function public.tt_admin_set_status(p_store uuid, p_status text)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not public.tt_is_super() then
    raise exception 'not allowed';
  end if;
  if p_status not in ('pending', 'active', 'blocked') then
    raise exception 'bad status';
  end if;
  update public.tt_stores set status = p_status where id = p_store;
  return 'ok';
end;
$$;

create or replace function public.tt_admin_set_feature(p_store uuid, p_key text, p_on boolean)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not public.tt_is_super() then
    raise exception 'not allowed';
  end if;
  update public.tt_stores set features = features || jsonb_build_object(p_key, p_on) where id = p_store;
  return 'ok';
end;
$$;

-- מנהל-על: המיילים של חנות (לשליחת שחזור סיסמה)
create or replace function public.tt_admin_members(p_store uuid)
returns table (email text, is_owner boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.tt_is_super() then
    raise exception 'not allowed';
  end if;
  return query
    select m.email, m.user_id = s.owner, m.created_at
    from public.tt_members m join public.tt_stores s on s.id = m.store_id
    where m.store_id = p_store
    order by 2 desc, 3;
end;
$$;

-- מנהל-על: כניסה לנתונים של חנות (null = יציאה)
create or replace function public.tt_admin_enter(p_store uuid)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not public.tt_is_super() then
    raise exception 'not allowed';
  end if;
  update public.tt_super set acting_store = p_store where user_id = auth.uid();
  return 'ok';
end;
$$;

create or replace function public.tt_set_store_name(p_name text)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not public.tt_is_member() then
    raise exception 'not allowed';
  end if;
  update public.tt_stores set name = left(trim(p_name), 80) where id = public.tt_my_store();
  return 'ok';
end;
$$;

-- ---------- הרשאות הפעלה ----------
do $$
declare
  f text;
begin
  foreach f in array array[
    'tt_my_store()', 'tt_is_super()', 'tt_is_member()', 'tt_my_status()', 'tt_push(jsonb)',
    'tt_list_members()', 'tt_invite(text)', 'tt_remove_member(text)',
    'tt_admin_stores()', 'tt_admin_set_status(uuid, text)', 'tt_admin_set_feature(uuid, text, boolean)',
    'tt_set_store_name(text)', 'tt_admin_enter(uuid)', 'tt_admin_members(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ============================================================
-- הגדרת מנהל-על (להריץ פעם אחת, עם המייל שלך):
--   insert into public.tt_super_emails values ('your@email.com') on conflict do nothing;
--   insert into public.tt_super (user_id) select id from auth.users where lower(email) = 'your@email.com' on conflict do nothing;
-- ============================================================
