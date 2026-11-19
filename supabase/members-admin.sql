-- ============================================================
-- תתבוס — ניהול מיילים מתוך הקופה (להריץ פעם אחת ב-SQL Editor)
-- מאפשר למנהל בקופה: לפתוח מייל חדש, לראות מי מורשה, ולהסיר גישה.
-- דורש שקודם הורץ members.sql
-- ⚠️ אחרי שהורץ multi-store.sql — לא להריץ את הקובץ הזה שוב (הוא מחליף פונקציות של כמה חנויות)
-- ============================================================

-- מיילים שהמנהל אישר מראש — כשהם נרשמים הם מקבלים גישה אוטומטית
create table if not exists public.tt_invites (
  email      text primary key,
  invited_by uuid,
  created_at timestamptz not null default now()
);
alter table public.tt_invites enable row level security; -- אין גישה ישירה, רק דרך הפונקציות למטה

-- נרשם ראשון, או מייל שאושר מראש = מורשה
create or replace function public.tt_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.tt_members)
     or exists (select 1 from public.tt_invites where email = lower(new.email)) then
    insert into public.tt_members (user_id, email) values (new.id, new.email)
    on conflict do nothing;
    delete from public.tt_invites where email = lower(new.email);
  end if;
  return new;
end;
$$;

-- רשימת המורשים + מוזמנים שעוד לא נרשמו
create or replace function public.tt_list_members()
returns table (email text, status text, created_at timestamptz, is_me boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tt_is_member() then
    raise exception 'not allowed';
  end if;
  return query
    select m.email, 'member'::text, m.created_at, m.user_id = auth.uid() from public.tt_members m
    union all
    select i.email, 'invite'::text, i.created_at, false from public.tt_invites i
    order by 3;
end;
$$;

-- אישור מייל: אם כבר נרשם — מקבל גישה מיד; אם לא — יקבל כשיירשם
create or replace function public.tt_invite(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(trim(p_email));
  uid uuid;
begin
  if not public.tt_is_member() then
    raise exception 'not allowed';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'bad email';
  end if;
  select id into uid from auth.users where lower(email) = e limit 1;
  if uid is not null then
    insert into public.tt_members (user_id, email) values (uid, e) on conflict do nothing;
    delete from public.tt_invites where email = e;
    return 'member';
  end if;
  insert into public.tt_invites (email, invited_by) values (e, auth.uid()) on conflict do nothing;
  return 'invite';
end;
$$;

-- הסרת גישה (לא אפשר להסיר את עצמך — כדי שלא יישאר מזנון בלי מנהל)
create or replace function public.tt_remove_member(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(trim(p_email));
begin
  if not public.tt_is_member() then
    raise exception 'not allowed';
  end if;
  if exists (select 1 from public.tt_members where user_id = auth.uid() and lower(email) = e) then
    raise exception 'cannot remove yourself';
  end if;
  delete from public.tt_members where lower(email) = e;
  delete from public.tt_invites where email = e;
  return 'ok';
end;
$$;

revoke all on function public.tt_list_members() from public, anon;
revoke all on function public.tt_invite(text) from public, anon;
revoke all on function public.tt_remove_member(text) from public, anon;
grant execute on function public.tt_list_members() to authenticated;
grant execute on function public.tt_invite(text) to authenticated;
grant execute on function public.tt_remove_member(text) to authenticated;
