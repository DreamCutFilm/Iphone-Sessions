-- DreamCut App — схема бази для акаунтів, фірм і команди.
--
-- Запуск: Supabase → SQL Editor → New query → вставити цей файл → Run.
-- Файл можна виконувати повторно: усе створюється через "if not exists"
-- і "create or replace", тож повторний запуск нічого не зламає.
--
-- Головний принцип: права доступу живуть У БАЗІ, а не в застосунку.
-- Навіть якщо в інтерфейсі колись буде помилка, чужі гроші вона не відкриє —
-- база просто не віддасть ці рядки.

-- ---------------------------------------------------------------------------
-- 1. Профілі
-- ---------------------------------------------------------------------------
-- Один рядок на кожного, хто зареєструвався. Створюється автоматично
-- тригером — інакше застосунку довелося б памʼятати про це при кожному вході.

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  full_name   text,
  phone       text,
  -- Ким людина зайшла з першого екрана: фірма чи клієнт.
  kind        text not null default 'company' check (kind in ('company', 'client')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, kind)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'kind', 'company')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. Фірми
-- ---------------------------------------------------------------------------

create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  -- Коротке імʼя для посилань і пошуку: dreamcut, а не «DreamCut Film».
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  city        text,
  about       text,
  phone       text,
  email       text,
  website     text,
  -- Чи видно фірму в публічному каталозі. Поки що вмикається вручну:
  -- відкритий каталог без модерації швидко наповнюється порожніми картками.
  listed      boolean not null default false,
  created_by  uuid not null references auth.users on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists companies_listed_idx on public.companies (listed) where listed;
create index if not exists companies_city_idx on public.companies (city);

-- ---------------------------------------------------------------------------
-- 3. Членство в фірмі
-- ---------------------------------------------------------------------------
-- owner  — директор: бачить заробіток, керує людьми
-- admin  — адміністратор: бачить заробіток, не керує ролями
-- member — команда: бачить оренду й СВІЙ гонорар

create table if not exists public.memberships (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'admin', 'member')),
  -- Посада в команді: «Оператор», «Монтажер». Потрібна, щоб звʼязати людину
  -- з рядком кошторису й показувати їй саме її гонорар.
  title       text,
  created_at  timestamptz not null default now(),
  unique (company_id, user_id)
);

create index if not exists memberships_user_idx on public.memberships (user_id);

-- ---------------------------------------------------------------------------
-- 4. Заявки на приєднання
-- ---------------------------------------------------------------------------

create table if not exists public.join_requests (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  message     text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  unique (company_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 5. Запрошення за посиланням
-- ---------------------------------------------------------------------------

create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies on delete cascade,
  code        text not null unique,
  role        text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_by  uuid not null references auth.users on delete cascade,
  expires_at  timestamptz not null default (now() + interval '14 days'),
  used_at     timestamptz,
  used_by     uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5а. Звʼязок із профілями
-- ---------------------------------------------------------------------------
-- Спочатку `user_id` вказував напряму на auth.users. Формально правильно —
-- але тоді запит «дай команду разом з іменами» не працює: сервер даних не
-- бачить дороги від членства до профілю й відмовляє. Дорога має бути явною,
-- тож переставляємо звʼязок на profiles. Це безпечно: рядок профілю створює
-- тригер у ту ж мить, що й самого користувача, а видалення користувача
-- по ланцюжку зносить і профіль, і членства.
--
-- Спершу знімаємо старий звʼязок, потім ставимо новий — так цей блок можна
-- виконувати повторно.

alter table public.memberships drop constraint if exists memberships_user_id_fkey;
alter table public.memberships
  add constraint memberships_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

alter table public.join_requests drop constraint if exists join_requests_user_id_fkey;
alter table public.join_requests
  add constraint join_requests_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- Хто фірму завів — це запис в історію, а не влада над нею. Влада — у ролі
-- «директор» у таблиці членства. Тому видалення людини не має впиратися
-- у фірму: людина йде, фірма лишається, поле просто порожніє.
alter table public.companies alter column created_by drop not null;
alter table public.companies drop constraint if exists companies_created_by_fkey;
alter table public.companies
  add constraint companies_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 6. Допоміжні функції
-- ---------------------------------------------------------------------------
-- Вони позначені security definer навмисно. Правило доступу до memberships,
-- яке саме читає memberships, спричинило б нескінченну рекурсію — база просто
-- відмовиться його виконувати. Функція обходить цю пастку: вона читає таблицю
-- з правами власника, але віддає назовні лише «так» або «ні».

create or replace function public.is_member(cid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where company_id = cid and user_id = auth.uid()
  );
$$;

create or replace function public.member_role(cid uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.memberships
  where company_id = cid and user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_manager(cid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.member_role(cid) in ('owner', 'admin');
$$;

-- Кого мені видно на імʼя.
--
-- Двоє: свої по фірмі — і ті, хто постукав до фірми, якою я керую. Друге
-- обовʼязкове: заявка без імені й телефону — це «хтось хоче до вас», і
-- прийняти таке рішення неможливо.
--
-- Функція знову security definer, і з тієї ж причини, що вище: правило для
-- профілів, яке саме читає таблиці з правилами, заганяє базу в глухий кут.
create or replace function public.can_see_profile(pid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    pid = auth.uid()
    or exists (
      select 1
      from public.memberships mine
      join public.memberships theirs on theirs.company_id = mine.company_id
      where mine.user_id = auth.uid() and theirs.user_id = pid
    )
    or exists (
      select 1
      from public.join_requests request
      join public.memberships mine on mine.company_id = request.company_id
      where request.user_id = pid
        and request.status = 'pending'
        and mine.user_id = auth.uid()
        and mine.role in ('owner', 'admin')
    );
$$;

-- ---------------------------------------------------------------------------
-- 7. Права доступу
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.companies     enable row level security;
alter table public.memberships   enable row level security;
alter table public.join_requests enable row level security;
alter table public.invites       enable row level security;

-- Профілі: свій завжди; чужий — своя команда і ті, хто подав заявку до фірми,
-- якою я керую. Решта людей у базі для мене не існує.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (public.can_see_profile(id));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Фірми: свою бачить команда, чужу — тільки якщо вона в каталозі.
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select
  using (listed or public.is_member(id));

-- Створити фірму може будь-хто, хто ввійшов, але лише від свого імені.
drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies for insert
  with check (auth.uid() = created_by);

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update
  using (public.is_manager(id)) with check (public.is_manager(id));

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies for delete
  using (public.member_role(id) = 'owner');

-- Членство: бачить уся команда фірми.
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select
  using (user_id = auth.uid() or public.is_member(company_id));

-- Перший рядок членства створює сам засновник, коли робить фірму.
-- Далі додавати людей можуть тільки керівники.
drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships for insert
  with check (
    public.is_manager(company_id)
    or (
      user_id = auth.uid()
      and not exists (select 1 from public.memberships m where m.company_id = memberships.company_id)
    )
  );

drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships for update
  using (public.member_role(company_id) = 'owner')
  with check (public.member_role(company_id) = 'owner');

-- Піти з фірми можна самому; вигнати — тільки директор.
drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships for delete
  using (user_id = auth.uid() or public.member_role(company_id) = 'owner');

-- Заявки: свою бачить автор, усі — керівники фірми.
drop policy if exists join_requests_select on public.join_requests;
create policy join_requests_select on public.join_requests for select
  using (user_id = auth.uid() or public.is_manager(company_id));

drop policy if exists join_requests_insert on public.join_requests;
create policy join_requests_insert on public.join_requests for insert
  with check (user_id = auth.uid());

drop policy if exists join_requests_update on public.join_requests;
create policy join_requests_update on public.join_requests for update
  using (public.is_manager(company_id)) with check (public.is_manager(company_id));

drop policy if exists join_requests_delete on public.join_requests;
create policy join_requests_delete on public.join_requests for delete
  using (user_id = auth.uid() or public.is_manager(company_id));

-- Запрошення: бачать лише керівники. Стороння людина не читає таблицю —
-- вона активує код через функцію нижче.
drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites for select
  using (public.is_manager(company_id));

drop policy if exists invites_insert on public.invites;
create policy invites_insert on public.invites for insert
  with check (public.is_manager(company_id) and created_by = auth.uid());

drop policy if exists invites_delete on public.invites;
create policy invites_delete on public.invites for delete
  using (public.is_manager(company_id));

-- ---------------------------------------------------------------------------
-- 8. Дії, які не можна віддати клієнтському коду
-- ---------------------------------------------------------------------------

-- Створення фірми: сама фірма й перший рядок членства мають зʼявитися разом.
-- Якби це робили двома запитами, обрив звʼязку між ними лишив би фірму
-- без власника — і вона стала б недосяжною назавжди.
create or replace function public.create_company(
  p_name text,
  p_slug text,
  p_city text default null,
  p_about text default null,
  p_listed boolean default true
)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  new_company public.companies;
begin
  if auth.uid() is null then
    raise exception 'Потрібно ввійти';
  end if;

  insert into public.companies (name, slug, city, about, listed, created_by)
  values (trim(p_name), lower(trim(p_slug)), nullif(trim(p_city), ''), nullif(trim(p_about), ''),
          coalesce(p_listed, true), auth.uid())
  returning * into new_company;

  insert into public.memberships (company_id, user_id, role)
  values (new_company.id, auth.uid(), 'owner');

  return new_company;
end;
$$;

-- Активація запрошення. Стороння людина не має доступу до таблиці invites,
-- тому код перевіряється тут, з правами власника.
create or replace function public.redeem_invite(p_code text)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  found_invite public.invites;
  target public.companies;
begin
  if auth.uid() is null then
    raise exception 'Потрібно ввійти';
  end if;

  select * into found_invite from public.invites
  where code = upper(trim(p_code)) limit 1;

  if found_invite.id is null then
    raise exception 'Запрошення не знайдено';
  end if;
  if found_invite.used_at is not null then
    raise exception 'Запрошення вже використано';
  end if;
  if found_invite.expires_at < now() then
    raise exception 'Термін дії запрошення минув';
  end if;

  insert into public.memberships (company_id, user_id, role)
  values (found_invite.company_id, auth.uid(), found_invite.role)
  on conflict (company_id, user_id) do nothing;

  update public.invites
  set used_at = now(), used_by = auth.uid()
  where id = found_invite.id;

  select * into target from public.companies where id = found_invite.company_id;
  return target;
end;
$$;

-- Схвалення заявки: змінити стан і додати в команду треба одночасно.
create or replace function public.approve_join_request(p_request_id uuid, p_role text default 'member')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.join_requests;
begin
  select * into req from public.join_requests where id = p_request_id;
  if req.id is null then
    raise exception 'Заявку не знайдено';
  end if;
  if not public.is_manager(req.company_id) then
    raise exception 'Немає прав приймати заявки цієї фірми';
  end if;

  insert into public.memberships (company_id, user_id, role)
  values (req.company_id, req.user_id, coalesce(p_role, 'member'))
  on conflict (company_id, user_id) do nothing;

  update public.join_requests
  set status = 'approved', decided_at = now()
  where id = p_request_id;
end;
$$;

-- Пошук фірми за назвою для того, хто ще не в команді.
-- Показує лише те, що й так публічне: назву, місто, коротке імʼя.
--
-- Прихована фірма не знаходиться. Це не дрібниця: якщо вимикач «показувати
-- в каталозі» не впливає на пошук, він бреше — а фірма, яка навмисно
-- сховалась, однаково отримує заявки від незнайомих людей.
create or replace function public.search_companies(p_query text)
returns table (id uuid, name text, slug text, city text, about text, listed boolean)
language sql
security definer
stable
set search_path = public
as $$
  select c.id, c.name, c.slug, c.city, c.about, c.listed
  from public.companies c
  where c.listed
    and length(trim(coalesce(p_query, ''))) >= 2
    and (c.name ilike '%' || trim(p_query) || '%' or c.slug ilike '%' || trim(p_query) || '%')
  order by c.name
  limit 20;
$$;

drop function if exists public.create_company(text, text, text, text);

grant execute on function public.create_company(text, text, text, text, boolean) to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
grant execute on function public.approve_join_request(uuid, text) to authenticated;
grant execute on function public.search_companies(text) to authenticated;
