-- ============================================================
-- תתבוס — מי מורשה להיכנס (להריץ פעם אחת ב-SQL Editor)
-- המייל הראשון שנרשם הופך לחשבון המזנון. מי שנרשם אחריו
-- עם מייל אחר — לא רואה שום נתון (עד שמוסיפים אותו כאן).
-- ============================================================

create table if not exists public.tt_members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);
alter table public.tt_members enable row level security;

drop policy if exists tt_members_self on public.tt_members;
create policy tt_members_self on public.tt_members
  for select to authenticated
  using (user_id = auth.uid());

-- משתמשים שכבר קיימים (שנוצרו בלוח הבקרה) — מורשים
insert into public.tt_members (user_id, email)
select id, email from auth.users
on conflict do nothing;

-- נרשם ראשון = מורשה. אחריו — לא
create or replace function public.tt_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.tt_members) then
    insert into public.tt_members (user_id, email) values (new.id, new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists tt_on_signup on auth.users;
create trigger tt_on_signup
after insert on auth.users
for each row execute function public.tt_on_signup();

create or replace function public.tt_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tt_members where user_id = auth.uid());
$$;

revoke all on function public.tt_is_member() from public, anon;
grant execute on function public.tt_is_member() to authenticated;

-- הנתונים פתוחים רק למורשים
drop policy if exists tt_records_auth on public.tt_records;
drop policy if exists tt_records_members on public.tt_records;
create policy tt_records_members on public.tt_records
  for all to authenticated
  using (public.tt_is_member())
  with check (public.tt_is_member());

-- להוספת מייל נוסף בעתיד (אחרי שהוא נרשם באפליקציה):
-- insert into public.tt_members (user_id, email)
-- select id, email from auth.users where email = 'another@example.com';
