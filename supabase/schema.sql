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
  -- Пошта, якою людина зайшла. Дублюється сюди зі службової таблиці навмисно:
  -- звідти застосунок читати не може, а своїх по фірмі треба показувати
  -- списком — інакше пошту довелося б диктувати й вписувати руками.
  email       text,
  -- Ким людина зайшла з першого екрана: фірма чи клієнт.
  kind        text not null default 'company' check (kind in ('company', 'client')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Таблиця могла зʼявитися ще без цієї колонки — тоді рядок вище її не додасть.
alter table public.profiles add column if not exists email text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, kind)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'kind', 'company')
  )
  on conflict (id) do update set
    -- Пошту оновлюємо завжди: людина могла її змінити, і тоді старе значення
    -- вказувало б у нікуди. Імʼя не чіпаємо — його могли виправити руками.
    email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Зміна пошти має доїжджати до профілю, інакше гонорар почне вказувати
-- на адресу, якої вже немає.
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_new_user();

-- Ті, хто зареєструвався до появи цієї колонки, лишилися б без пошти
-- назавжди. Підтягуємо — і робимо це при кожному запуску схеми, бо
-- дешево, а розбіжність тут коштувала б невидимого гонорару.
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is distinct from u.email;

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
-- 6а. Ролі фірми й дозволи
-- ---------------------------------------------------------------------------
-- Досі ролей було три на всіх: директор, адміністратор, команда. Для фірми,
-- де монтажер, оператор і помічник роблять різне, цього мало.
--
-- Тепер директор заводить свої ролі — «Монтажер», «Оператор», «Помічник» —
-- і кожній ставить, що вона бачить. Дозволів навмисно шість, а не «на кожне
-- поле»: сорок галочок неможливо втримати в голові, і одного дня хтось
-- випадково відкрив би гонорари всій команді. Шість можна перечитати очима
-- за десять секунд, і небезпечну комбінацію з них не зібрати.
--
-- Три рівні лишаються, але тепер вони означають інше:
--   owner  — директор: може все, і забрати це в нього не можна;
--   admin  — адміністратор: може все, крім керування командою й ролями;
--   member — команда: може рівно те, що написано в його ролі.

create table if not exists public.company_roles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies on delete cascade,
  name        text not null check (length(trim(name)) > 0),

  -- Суми, які платить клієнт, і заробіток фірми.
  can_see_client_money    boolean not null default false,
  -- Гонорари всієї команди. Свій власний видно завжди й без дозволу.
  can_see_all_payouts     boolean not null default false,
  -- Хто замовник і як із ним звʼязатися.
  can_see_client_contacts boolean not null default false,
  -- Оренда техніки й у скільки вона обходиться фірмі. Увімкнено за
  -- замовчуванням: без цього людина не знає, що везти на майданчик.
  can_see_rental          boolean not null default true,
  -- Створювати й змінювати проєкти, кошториси, публікувати їх.
  can_edit                boolean not null default false,
  -- Запрошувати людей, міняти ролі, приймати заявки.
  can_manage_team         boolean not null default false,

  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (company_id, name)
);

create index if not exists company_roles_company_idx on public.company_roles (company_id);

-- Яку роль має людина. Порожньо — діють лише права свого рівня.
alter table public.memberships add column if not exists role_id uuid;

alter table public.memberships drop constraint if exists memberships_role_id_fkey;
alter table public.memberships
  add constraint memberships_role_id_fkey
  foreign key (role_id) references public.company_roles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 6б. Одне питання замість шести
-- ---------------------------------------------------------------------------
-- Уся схема тепер питає дозвіл в одному місці. Це навмисно: доки правило
-- живе в одній функції, його можна прочитати цілком і переконатися, що воно
-- те, що треба. Розсипане по двадцятьох правилах доступу, воно рано чи пізно
-- десь розійдеться саме з собою — і розійдеться тихо.

create or replace function public.can(cid uuid, what text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((
    select case
      -- Директора обмежити не можна: фірма інакше замкнула б сама себе.
      when m.role = 'owner' then true
      when m.role = 'admin' then what <> 'team'
      else case what
        when 'money'    then coalesce(r.can_see_client_money, false)
        when 'payouts'  then coalesce(r.can_see_all_payouts, false)
        when 'contacts' then coalesce(r.can_see_client_contacts, false)
        when 'rental'   then coalesce(r.can_see_rental, true)
        when 'edit'     then coalesce(r.can_edit, false)
        when 'team'     then coalesce(r.can_manage_team, false)
        else false
      end
    end
    from public.memberships m
    left join public.company_roles r on r.id = m.role_id
    where m.company_id = cid and m.user_id = auth.uid()
    limit 1
  ), false);
$$;

alter table public.company_roles enable row level security;

-- Ролі видно всій команді: людина має право знати, що саме їй дозволено.
drop policy if exists company_roles_select on public.company_roles;
create policy company_roles_select on public.company_roles for select
  using (public.is_member(company_id));

drop policy if exists company_roles_write on public.company_roles;
create policy company_roles_write on public.company_roles for all
  using (public.can(company_id, 'team')) with check (public.can(company_id, 'team'));

grant execute on function public.can(uuid, text) to authenticated;

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
  using (public.can(id, 'team')) with check (public.can(id, 'team'));

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
    public.can(company_id, 'team')
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
  using (user_id = auth.uid() or public.can(company_id, 'team'));

-- Заявки: свою бачить автор, усі — керівники фірми.
drop policy if exists join_requests_select on public.join_requests;
create policy join_requests_select on public.join_requests for select
  using (user_id = auth.uid() or public.can(company_id, 'team'));

drop policy if exists join_requests_insert on public.join_requests;
create policy join_requests_insert on public.join_requests for insert
  with check (user_id = auth.uid());

drop policy if exists join_requests_update on public.join_requests;
create policy join_requests_update on public.join_requests for update
  using (public.can(company_id, 'team')) with check (public.can(company_id, 'team'));

drop policy if exists join_requests_delete on public.join_requests;
create policy join_requests_delete on public.join_requests for delete
  using (user_id = auth.uid() or public.can(company_id, 'team'));

-- Запрошення: бачать лише керівники. Стороння людина не читає таблицю —
-- вона активує код через функцію нижче.
drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites for select
  using (public.can(company_id, 'team'));

drop policy if exists invites_insert on public.invites;
create policy invites_insert on public.invites for insert
  with check (public.can(company_id, 'team') and created_by = auth.uid());

drop policy if exists invites_delete on public.invites;
create policy invites_delete on public.invites for delete
  using (public.can(company_id, 'team'));

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

  insert into public.company_roles (company_id, name, position, can_see_rental)
  values
    (new_company.id, 'Оператор', 1, true),
    (new_company.id, 'Монтажер', 2, true),
    (new_company.id, 'Помічник', 3, true)
  on conflict do nothing;

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
  if not public.can(req.company_id, 'team') then
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

-- Одиниця в правильному відмінку: «2 зміни», а не «2 зміна».
-- Українське число не терпить одного слова на всі випадки, і на екрані
-- це помітно одразу.
create or replace function public.tidy_unit(value numeric, unit text)
returns text
language sql
immutable
as $$
  select case
    when unit = 'зміна' then case
      when value::int % 100 between 11 and 14 then 'змін'
      when value::int % 10 = 1 then 'зміна'
      when value::int % 10 between 2 and 4 then 'зміни'
      else 'змін' end
    when unit = 'день' then case
      when value::int % 100 between 11 and 14 then 'днів'
      when value::int % 10 = 1 then 'день'
      when value::int % 10 between 2 and 4 then 'дні'
      else 'днів' end
    when unit = 'година' then case
      when value::int % 100 between 11 and 14 then 'годин'
      when value::int % 10 = 1 then 'година'
      when value::int % 10 between 2 and 4 then 'години'
      else 'годин' end
    else unit
  end;
$$;

-- Число для людини: ціле — без хвоста, дробове — з двома знаками.
-- Дрібниця, але «2. × 2. зміна» на екрані виглядає як зламаний застосунок.
create or replace function public.tidy_number(value numeric)
returns text
language sql
immutable
as $$
  select case
    when value = trunc(value) then trunc(value)::bigint::text
    else trim(to_char(value, 'FM9999999990.99'))
  end;
$$;

-- ---------------------------------------------------------------------------
-- 8а. Каталоги фірми: техніка й команда
-- ---------------------------------------------------------------------------
-- Досі каталоги жили на телефоні того, хто їх завів. Двоє адміністраторів
-- вели два різні списки тієї самої техніки, а людина з команди не бачила
-- жодного. Тепер каталог один на фірму.
--
-- Ціни тут двох сортів, і плутати їх не можна:
--   day_rate / rate — скільки ставимо КЛІЄНТУ (це гроші клієнта);
--   day_cost / fee  — у скільки обходиться НАМ (це оренда й гонорари).
-- Тому й дозволи різні: собівартість видно за «орендою», ціну клієнту —
-- за «сумами клієнта». Одна колонка не має відкривати іншу.

create table if not exists public.company_equipment (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies on delete cascade,
  -- Звідки приїхало з телефона. За цим полем перенесення впізнає, що це
  -- та сама позиція, а не нова, — і повторний перенос не плодить дублів.
  local_id    text,
  title       text not null,
  category    text not null default 'other',
  ownership   text not null default 'own',
  day_rate    numeric(14, 2),
  day_cost    numeric(14, 2),
  notes       text,
  archived    boolean not null default false,
  updated_at  timestamptz not null default now(),
  unique (company_id, local_id)
);

create index if not exists company_equipment_idx on public.company_equipment (company_id, archived);

create table if not exists public.company_crew (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies on delete cascade,
  local_id    text,
  name        text,
  role        text not null default 'Оператор',
  -- Скільки платимо людині.
  fee         numeric(14, 2),
  -- Скільки ставимо клієнту.
  rate        numeric(14, 2),
  phone       text,
  email       text,
  -- Хто це у фірмі, якщо людина вже має акаунт.
  user_id     uuid references public.profiles (id) on delete set null,
  notes       text,
  archived    boolean not null default false,
  updated_at  timestamptz not null default now(),
  unique (company_id, local_id)
);

create index if not exists company_crew_idx on public.company_crew (company_id, archived);

alter table public.company_equipment enable row level security;
alter table public.company_crew      enable row level security;

-- Читає вся команда: список техніки — це робота, а не гроші. Числа підрізає
-- функція нижче, а не правило доступу: правило вміє лише впустити чи ні,
-- а нам треба віддати рядок без частини колонок.
drop policy if exists company_equipment_select on public.company_equipment;
create policy company_equipment_select on public.company_equipment for select
  using (public.is_member(company_id));

drop policy if exists company_equipment_write on public.company_equipment;
create policy company_equipment_write on public.company_equipment for all
  using (public.can(company_id, 'edit')) with check (public.can(company_id, 'edit'));

-- Каталог людей — інша річ: там чужі гонорари, і бачити їх має не кожен.
drop policy if exists company_crew_select on public.company_crew;
create policy company_crew_select on public.company_crew for select
  using (public.can(company_id, 'payouts') or public.can(company_id, 'edit'));

drop policy if exists company_crew_write on public.company_crew;
create policy company_crew_write on public.company_crew for all
  using (public.can(company_id, 'edit')) with check (public.can(company_id, 'edit'));

-- ---------------------------------------------------------------------------
-- 8б. Що з каталогів видно
-- ---------------------------------------------------------------------------

create or replace function public.company_gear(p_company uuid)
returns table (
  id uuid, local_id text, title text, category text, ownership text,
  day_rate numeric, day_cost numeric, notes text, archived boolean, can_edit boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    e.id, e.local_id, e.title, e.category, e.ownership,
    -- Ціна для клієнта — гроші клієнта.
    case when public.can(e.company_id, 'money') then e.day_rate end,
    -- Собівартість — оренда.
    case when public.can(e.company_id, 'rental') then e.day_cost end,
    e.notes, e.archived,
    public.can(e.company_id, 'edit')
  from public.company_equipment e
  where e.company_id = p_company and public.is_member(e.company_id)
  order by e.archived, e.title;
$$;

-- Каталог людей. Свій рядок людина бачить завжди — це її власний гонорар.
create or replace function public.company_people(p_company uuid)
returns table (
  id uuid, local_id text, name text, role text,
  fee numeric, rate numeric, phone text, email text,
  user_id uuid, notes text, archived boolean, is_me boolean, can_edit boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    c.id, c.local_id, c.name, c.role,
    case when public.can(c.company_id, 'payouts') or c.user_id = auth.uid() then c.fee end,
    case when public.can(c.company_id, 'money') then c.rate end,
    case when public.can(c.company_id, 'team') or c.user_id = auth.uid() then c.phone end,
    case when public.can(c.company_id, 'team') or c.user_id = auth.uid() then c.email end,
    c.user_id, c.notes, c.archived,
    coalesce(c.user_id = auth.uid(), false),
    public.can(c.company_id, 'edit')
  from public.company_crew c
  where c.company_id = p_company
    and public.is_member(c.company_id)
    and (
      public.can(c.company_id, 'payouts')
      or public.can(c.company_id, 'edit')
      or c.user_id = auth.uid()
    )
  order by c.archived, c.role, c.name;
$$;

-- ---------------------------------------------------------------------------
-- 8в. Перенести свій каталог у фірму
-- ---------------------------------------------------------------------------
-- Каталог, зібраний за рік, ніхто не вбиватиме руками вдруге. Переносимо
-- одним запитом і за local_id: повторний перенос оновлює те саме, а не
-- створює другий комплект.

create or replace function public.import_catalog(
  p_company uuid,
  p_equipment jsonb default '[]'::jsonb,
  p_crew jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  moved integer := 0;
  batch integer := 0;
begin
  if not public.can(p_company, 'edit') then
    raise exception 'Переносити каталог твоя роль не дозволяє';
  end if;

  insert into public.company_equipment
    (company_id, local_id, title, category, ownership, day_rate, day_cost, notes, archived, updated_at)
  select
    p_company,
    item ->> 'local_id',
    coalesce(nullif(trim(item ->> 'title'), ''), 'Без назви'),
    coalesce(item ->> 'category', 'other'),
    coalesce(item ->> 'ownership', 'own'),
    (item ->> 'day_rate')::numeric,
    (item ->> 'day_cost')::numeric,
    nullif(trim(coalesce(item ->> 'notes', '')), ''),
    coalesce((item ->> 'archived')::boolean, false),
    now()
  from jsonb_array_elements(coalesce(p_equipment, '[]'::jsonb)) as item
  on conflict (company_id, local_id) do update set
    title = excluded.title, category = excluded.category, ownership = excluded.ownership,
    day_rate = excluded.day_rate, day_cost = excluded.day_cost, notes = excluded.notes,
    archived = excluded.archived, updated_at = now();

  get diagnostics batch = row_count;
  moved := moved + batch;

  insert into public.company_crew
    (company_id, local_id, name, role, fee, rate, phone, email, user_id, notes, archived, updated_at)
  select
    p_company,
    person ->> 'local_id',
    nullif(trim(coalesce(person ->> 'name', '')), ''),
    coalesce(nullif(trim(person ->> 'role'), ''), 'Оператор'),
    (person ->> 'fee')::numeric,
    (person ->> 'rate')::numeric,
    nullif(trim(coalesce(person ->> 'phone', '')), ''),
    nullif(trim(coalesce(person ->> 'email', '')), ''),
    -- Звʼязок з акаунтом приймаємо тільки на того, хто справді у фірмі.
    (select m.user_id from public.memberships m
      where m.company_id = p_company
        and m.user_id = nullif(person ->> 'user_id', '')::uuid),
    nullif(trim(coalesce(person ->> 'notes', '')), ''),
    coalesce((person ->> 'archived')::boolean, false),
    now()
  from jsonb_array_elements(coalesce(p_crew, '[]'::jsonb)) as person
  on conflict (company_id, local_id) do update set
    name = excluded.name, role = excluded.role, fee = excluded.fee, rate = excluded.rate,
    phone = excluded.phone, email = excluded.email, user_id = excluded.user_id,
    notes = excluded.notes, archived = excluded.archived, updated_at = now();

  get diagnostics batch = row_count;
  return moved + batch;
end;
$$;

grant execute on function public.company_gear(uuid) to authenticated;
grant execute on function public.company_people(uuid) to authenticated;
grant execute on function public.import_catalog(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8е. Спільні проєкти
-- ---------------------------------------------------------------------------
-- Головне правило всієї цієї частини, словами замовника:
--
--   «Суму, яку я даю клієнту, команда не бачить. Тільки директор і
--    адміністратори. Команда бачить тільки скільки оренда техніки в ренталі,
--    та кожен бачить свій гонорар з проекту.»
--
-- Це правило реалізоване не в застосунку, а тут. Різниця принципова: помилка
-- в інтерфейсі показала б зайве число на екрані; помилка тут — єдине, що
-- справді відкрило б чужі гроші. Тому рядовий учасник не має права читати
-- таблицю проєктів взагалі — навіть ту колонку, яку йому «можна». Усе, що він
-- бачить, приходить через функцію, яка сама вирішує, що покласти у відповідь.

create table if not exists public.shared_projects (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies on delete cascade,
  -- Той самий проєкт на телефоні директора. За цим полем публікація
  -- впізнає, що це не новий проєкт, а оновлення вже опублікованого.
  local_id      text not null,
  title         text not null,
  client        text,
  style         text,
  status        text not null default 'lead',
  deadline      date,
  location      text,
  latitude      double precision,
  longitude     double precision,
  currency      text not null default 'UAH',
  -- Скільки платить клієнт. Найчутливіше число в усій базі.
  fee           numeric(14, 2),
  -- Оренда техніки. Це команда бачить: вона працює з цією технікою.
  rental_cost   numeric(14, 2) not null default 0,
  -- Решта витрат, крім оренди й гонорарів: логістика, харчування.
  other_cost    numeric(14, 2) not null default 0,
  -- Сума всіх гонорарів. Теж чутлива: знаючи її та свій гонорар,
  -- людина порахувала б чужі.
  payout_total  numeric(14, 2) not null default 0,
  notes         text,
  published_by  uuid references public.profiles (id) on delete set null,
  published_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, local_id)
);

create index if not exists shared_projects_company_idx
  on public.shared_projects (company_id, deadline);

create table if not exists public.shared_shoot_days (
  project_id  uuid not null references public.shared_projects on delete cascade,
  day         date not null,
  primary key (project_id, day)
);

-- Гонорари. Один рядок — одна людина на одному проєкті.
create table if not exists public.shared_payouts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.shared_projects on delete cascade,
  company_id  uuid not null references public.companies on delete cascade,
  -- Кому платимо. Заповнюється, коли людина вже має акаунт у фірмі —
  -- саме за цим полем вона побачить свій гонорар. Порожньо — людина ще
  -- не зареєстрована, гонорар видно лише керівникам.
  user_id     uuid references public.profiles (id) on delete set null,
  name        text,
  role_title  text,
  amount      numeric(14, 2) not null default 0,
  currency    text not null default 'UAH',
  note        text
);

create index if not exists shared_payouts_user_idx on public.shared_payouts (user_id);
create index if not exists shared_payouts_project_idx on public.shared_payouts (project_id);

alter table public.shared_projects   enable row level security;
alter table public.shared_shoot_days enable row level security;
alter table public.shared_payouts    enable row level security;

-- Проєкти: читають і пишуть ЛИШЕ керівники. Для команди дороги сюди немає —
-- вона ходить через функцію company_projects нижче.
drop policy if exists shared_projects_all on public.shared_projects;
drop policy if exists shared_projects_select on public.shared_projects;
create policy shared_projects_select on public.shared_projects for select
  using (public.can(company_id, 'money'));

drop policy if exists shared_projects_write on public.shared_projects;
create policy shared_projects_write on public.shared_projects for all
  using (public.can(company_id, 'edit')) with check (public.can(company_id, 'edit'));

drop policy if exists shared_shoot_days_all on public.shared_shoot_days;
create policy shared_shoot_days_all on public.shared_shoot_days for all
  using (exists (
    select 1 from public.shared_projects p
    where p.id = project_id and public.can(p.company_id, 'edit')
  ))
  with check (exists (
    select 1 from public.shared_projects p
    where p.id = project_id and public.can(p.company_id, 'edit')
  ));

-- Гонорари: керівник бачить усі, людина — тільки свій власний рядок.
drop policy if exists shared_payouts_select on public.shared_payouts;
create policy shared_payouts_select on public.shared_payouts for select
  using (public.can(company_id, 'payouts') or user_id = auth.uid());

drop policy if exists shared_payouts_write on public.shared_payouts;
create policy shared_payouts_write on public.shared_payouts for all
  using (public.can(company_id, 'edit')) with check (public.can(company_id, 'edit'));

-- ---------------------------------------------------------------------------
-- 8г. Кошториси фірми
-- ---------------------------------------------------------------------------
-- Досі проєкт потрапляв у фірму знімком: директор складав його на телефоні
-- й публікував. Двоє адміністраторів працювати з одним проєктом не могли —
-- кожен публікував свій знімок поверх чужого.
--
-- Тепер проєкт народжується у фірмі. Знімок лишається одним-єдиним шляхом:
-- перенести свій старий особистий проєкт. Тому local_id більше не
-- обовʼязковий — у проєкта, створеного у фірмі, його просто немає.

alter table public.shared_projects alter column local_id drop not null;

-- ---------------------------------------------------------------------------
-- 8ґ. Позиції кошторису
-- ---------------------------------------------------------------------------
-- Кошторис — це і є гроші клієнта: у кожному рядку стоїть ціна, яку йому
-- виставляють. Тому правити кошториси мало права «правити проєкти» — треба
-- ще й дозвіл на суми клієнта. Інакше «Старший оператор», якому відкрили
-- редагування дат і техніки, побачив би заразом і всі суми.

create table if not exists public.company_estimates (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies on delete cascade,
  project_id       uuid references public.shared_projects on delete cascade,
  local_id         text,
  title            text not null default 'Кошторис',
  status           text not null default 'draft'
                     check (status in ('draft', 'sent', 'approved', 'declined')),
  currency         text not null default 'UAH',
  discount_percent numeric(6, 2) not null default 0,
  tax_percent      numeric(6, 2) not null default 0,
  client_notes     text,
  notes            text,
  sent_at          timestamptz,
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, local_id)
);

create index if not exists company_estimates_project_idx on public.company_estimates (project_id);
create index if not exists company_estimates_company_idx on public.company_estimates (company_id);

create table if not exists public.company_estimate_items (
  id            uuid primary key default gen_random_uuid(),
  estimate_id   uuid not null references public.company_estimates on delete cascade,
  company_id    uuid not null references public.companies on delete cascade,
  title         text not null default 'Позиція',
  category      text not null default 'equipment',
  -- Звідки взяли позицію. Потрібне для двох речей: показати «що везти»
  -- з поміткою «своя / орендуємо» і звʼязати гонорар з акаунтом людини.
  equipment_id  uuid references public.company_equipment on delete set null,
  crew_id       uuid references public.company_crew on delete set null,
  internal_only boolean not null default false,
  unit          text not null default 'зміна',
  quantity      numeric(10, 2) not null default 1,
  shifts        numeric(10, 2) not null default 1,
  -- Ціна клієнту.
  unit_price    numeric(14, 2) not null default 0,
  -- У скільки обходиться нам.
  unit_cost     numeric(14, 2) not null default 0,
  notes         text,
  position      integer not null default 0
);

create index if not exists company_estimate_items_idx on public.company_estimate_items (estimate_id);

alter table public.company_estimates      enable row level security;
alter table public.company_estimate_items enable row level security;

-- Читати кошторис — це бачити суми клієнта. Правити — те саме плюс право
-- правити взагалі. Решта команди дивиться на проєкт крізь функції нижче,
-- які віддають лише дозволені шматки.
drop policy if exists company_estimates_select on public.company_estimates;
create policy company_estimates_select on public.company_estimates for select
  using (public.can(company_id, 'money'));

drop policy if exists company_estimates_write on public.company_estimates;
create policy company_estimates_write on public.company_estimates for all
  using (public.can(company_id, 'money') and public.can(company_id, 'edit'))
  with check (public.can(company_id, 'money') and public.can(company_id, 'edit'));

drop policy if exists company_estimate_items_select on public.company_estimate_items;
create policy company_estimate_items_select on public.company_estimate_items for select
  using (public.can(company_id, 'money'));

drop policy if exists company_estimate_items_write on public.company_estimate_items;
create policy company_estimate_items_write on public.company_estimate_items for all
  using (public.can(company_id, 'money') and public.can(company_id, 'edit'))
  with check (public.can(company_id, 'money') and public.can(company_id, 'edit'));

-- ---------------------------------------------------------------------------
-- 8д. Гроші проєкту рахуються з кошторисів
-- ---------------------------------------------------------------------------
-- Раніше суми лежали в самому проєкті: їх туди клав знімок. Тепер вони
-- рахуються з кошторисів — і розійтися з ними більше не можуть за
-- визначенням. Для перенесених старих проєктів лишається запасний шлях:
-- якщо кошторисів немає, беремо те, що приїхало знімком.
--
-- Основою беремо затверджений кошторис, якщо він є; далі — надісланий;
-- далі — чернетку. Той самий порядок, що й на телефоні: рахувати треба
-- за найпевнішим, а не за сумою всіх варіантів однієї зйомки.

create or replace function public.project_money(p_project uuid)
returns table (income numeric, rental numeric, payouts numeric, other numeric, currency text)
language sql
stable
security definer
set search_path = public
as $$
  with chosen as (
    select e.id, e.currency, e.discount_percent
    from public.company_estimates e
    where e.project_id = p_project
      and e.status <> 'declined'
      and e.status = (
        select case
          when bool_or(x.status = 'approved') then 'approved'
          when bool_or(x.status = 'sent') then 'sent'
          else 'draft'
        end
        from public.company_estimates x
        where x.project_id = p_project and x.status <> 'declined'
      )
  ),
  lines as (
    select
      c.currency,
      c.discount_percent,
      i.category,
      i.crew_id,
      i.internal_only,
      i.quantity * i.shifts * i.unit_price as amount,
      i.quantity * i.shifts * i.unit_cost  as cost
    from chosen c
    join public.company_estimate_items i on i.estimate_id = c.id
  )
  select
    round(coalesce(sum(case when internal_only then 0 else amount end), 0)
      * (1 - coalesce(max(discount_percent), 0) / 100), 2),
    round(coalesce(sum(case when category = 'equipment' then cost else 0 end), 0), 2),
    round(coalesce(sum(case when category = 'crew' or crew_id is not null then cost else 0 end), 0), 2),
    round(coalesce(sum(case
      when category <> 'equipment' and category <> 'crew' and crew_id is null then cost else 0 end), 0), 2),
    coalesce(max(currency), 'UAH')
  from lines;
$$;

grant execute on function public.project_money(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9а. Публікація проєкту у фірму
-- ---------------------------------------------------------------------------
-- Проєкт, знімальні дні й гонорари мають лягти разом або не лягти зовсім.
-- Якби це були три запити з телефону, обрив звʼязку між другим і третім
-- лишив би проєкт із гонорарами від минулого разу — тобто з неправдивими
-- сумами, які виглядають правдивими.
--
-- Гонорар звʼязується з людиною за поштою: на телефоні в картці людини
-- записана пошта, тут вона перетворюється на посилання на акаунт. Без цього
-- людина не побачила б свій гонорар, бо база не знала б, що він її.

create or replace function public.publish_project(
  p_company uuid,
  p_project jsonb,
  p_payouts jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  entry  jsonb;
  found  uuid;
begin
  if not public.can(p_company, 'edit') then
    raise exception 'Публікувати проєкти твоя роль не дозволяє';
  end if;

  insert into public.shared_projects as sp (
    company_id, local_id, title, client, style, status, deadline,
    location, latitude, longitude, currency, fee,
    rental_cost, other_cost, payout_total, notes, published_by, updated_at
  )
  values (
    p_company,
    p_project ->> 'local_id',
    coalesce(nullif(trim(p_project ->> 'title'), ''), 'Без назви'),
    nullif(trim(coalesce(p_project ->> 'client', '')), ''),
    nullif(trim(coalesce(p_project ->> 'style', '')), ''),
    coalesce(p_project ->> 'status', 'lead'),
    (p_project ->> 'deadline')::date,
    nullif(trim(coalesce(p_project ->> 'location', '')), ''),
    (p_project ->> 'latitude')::double precision,
    (p_project ->> 'longitude')::double precision,
    coalesce(p_project ->> 'currency', 'UAH'),
    (p_project ->> 'fee')::numeric,
    coalesce((p_project ->> 'rental_cost')::numeric, 0),
    coalesce((p_project ->> 'other_cost')::numeric, 0),
    coalesce((p_project ->> 'payout_total')::numeric, 0),
    nullif(trim(coalesce(p_project ->> 'notes', '')), ''),
    auth.uid(),
    now()
  )
  on conflict (company_id, local_id) do update set
    title        = excluded.title,
    client       = excluded.client,
    style        = excluded.style,
    status       = excluded.status,
    deadline     = excluded.deadline,
    location     = excluded.location,
    latitude     = excluded.latitude,
    longitude    = excluded.longitude,
    currency     = excluded.currency,
    fee          = excluded.fee,
    rental_cost  = excluded.rental_cost,
    other_cost   = excluded.other_cost,
    payout_total = excluded.payout_total,
    notes        = excluded.notes,
    published_by = excluded.published_by,
    updated_at   = now()
  returning sp.id into target;

  -- Дні й гонорари переписуємо цілком: часткове оновлення лишило б рядки
  -- від позицій, які з кошторису вже прибрали.
  delete from public.shared_shoot_days where project_id = target;
  insert into public.shared_shoot_days (project_id, day)
  select target, value::date
  from jsonb_array_elements_text(coalesce(p_project -> 'shoot_days', '[]'::jsonb))
  on conflict do nothing;

  delete from public.shared_payouts where project_id = target;
  delete from public.shared_tasks   where project_id = target;
  delete from public.shared_items   where project_id = target;

  -- Задачі. Доручену людину звʼязуємо так само, як гонорар: спершу прямим
  -- посиланням, потім поштою — і тільки якщо вона справді у цій фірмі.
  for entry in select * from jsonb_array_elements(coalesce(p_project -> 'tasks', '[]'::jsonb))
  loop
    found := nullif(entry ->> 'user_id', '')::uuid;

    if found is null and nullif(trim(coalesce(entry ->> 'email', '')), '') is not null then
      select u.id into found from auth.users u
      where lower(u.email) = lower(trim(entry ->> 'email')) limit 1;
    end if;

    if found is not null and not exists (
      select 1 from public.memberships m
      where m.company_id = p_company and m.user_id = found
    ) then
      found := null;
    end if;

    insert into public.shared_tasks
      (project_id, company_id, local_id, title, assignee_id, assignee_name, due, done, priority, notes, position)
    values (
      target, p_company,
      nullif(entry ->> 'local_id', ''),
      coalesce(nullif(trim(entry ->> 'title'), ''), 'Без назви'),
      found,
      nullif(trim(coalesce(entry ->> 'assignee_name', '')), ''),
      (entry ->> 'due')::date,
      coalesce((entry ->> 'done')::boolean, false),
      coalesce(entry ->> 'priority', 'normal'),
      nullif(trim(coalesce(entry ->> 'notes', '')), ''),
      coalesce((entry ->> 'position')::integer, 0)
    );
  end loop;

  -- Техніка. Ціни клієнту тут немає й бути не може: кладемо лише собівартість.
  insert into public.shared_items
    (project_id, company_id, title, category, count_label, ownership, cost, currency, notes, position)
  select
    target, p_company,
    coalesce(nullif(trim(item ->> 'title'), ''), 'Позиція'),
    nullif(item ->> 'category', ''),
    nullif(item ->> 'count_label', ''),
    nullif(item ->> 'ownership', ''),
    coalesce((item ->> 'cost')::numeric, 0),
    coalesce(item ->> 'currency', 'UAH'),
    nullif(trim(coalesce(item ->> 'notes', '')), ''),
    coalesce((item ->> 'position')::integer, 0)
  from jsonb_array_elements(coalesce(p_project -> 'items', '[]'::jsonb)) as item;

  for entry in select * from jsonb_array_elements(coalesce(p_payouts, '[]'::jsonb))
  loop
    -- Людину, вибрану зі списку команди, застосунок називає прямо. Пошта
    -- лишається запасним шляхом: нею звʼязуються ті, кого вписали руками.
    found := nullif(entry ->> 'user_id', '')::uuid;

    if found is null and nullif(trim(coalesce(entry ->> 'email', '')), '') is not null then
      select u.id into found
      from auth.users u
      where lower(u.email) = lower(trim(entry ->> 'email'))
      limit 1;
    end if;

    -- Чужу людину в гонорари фірми підставити не можна: посилання приймаємо
    -- тільки на того, хто справді в цій команді.
    if found is not null and not exists (
      select 1 from public.memberships m
      where m.company_id = p_company and m.user_id = found
    ) then
      found := null;
    end if;

    insert into public.shared_payouts (project_id, company_id, user_id, name, role_title, amount, currency, note)
    values (
      target,
      p_company,
      found,
      nullif(trim(coalesce(entry ->> 'name', '')), ''),
      nullif(trim(coalesce(entry ->> 'role_title', '')), ''),
      coalesce((entry ->> 'amount')::numeric, 0),
      coalesce(entry ->> 'currency', 'UAH'),
      nullif(trim(coalesce(entry ->> 'note', '')), '')
    );
  end loop;

  return target;
end;
$$;

create or replace function public.unpublish_project(p_company uuid, p_local_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can(p_company, 'edit') then
    raise exception 'Прибрати проєкт твоя роль не дозволяє';
  end if;

  delete from public.shared_projects
  where company_id = p_company and local_id = p_local_id;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9в. Задачі й техніка проєкту
-- ---------------------------------------------------------------------------
-- Без цього спільний проєкт лишався б оголошенням: «буде зйомка, ось дата».
-- Людині, яка їде на майданчик, треба знати ЩО робити і ЩО везти — і саме це
-- має відкриватися в застосунку, а не приходити голосовим у месенджері.
--
-- Ціни клієнту тут немає взагалі: у техніці зберігається лише собівартість —
-- те, у скільки оренда обходиться фірмі. Це те, що команді видно за правилом.

create table if not exists public.shared_tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.shared_projects on delete cascade,
  company_id   uuid not null references public.companies on delete cascade,
  local_id     text,
  title        text not null,
  -- Кому доручено. Порожньо — задача спільна, її бачать усі як спільну.
  assignee_id  uuid references public.profiles (id) on delete set null,
  assignee_name text,
  due          date,
  done         boolean not null default false,
  priority     text not null default 'normal',
  notes        text,
  position     integer not null default 0
);

create index if not exists shared_tasks_project_idx on public.shared_tasks (project_id);
create index if not exists shared_tasks_assignee_idx on public.shared_tasks (assignee_id);

create table if not exists public.shared_items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.shared_projects on delete cascade,
  company_id  uuid not null references public.companies on delete cascade,
  title       text not null,
  category    text,
  count_label text,
  -- Своя чи орендована. Для людини на майданчику це головне питання:
  -- зі складу забрати чи їхати в рентал.
  ownership   text,
  cost        numeric(14, 2) not null default 0,
  currency    text not null default 'UAH',
  notes       text,
  position    integer not null default 0
);

create index if not exists shared_items_project_idx on public.shared_items (project_id);

alter table public.shared_tasks enable row level security;
alter table public.shared_items enable row level security;

-- Задачі й техніку бачить уся команда: це робота, а не гроші.
drop policy if exists shared_tasks_select on public.shared_tasks;
create policy shared_tasks_select on public.shared_tasks for select
  using (public.is_member(company_id));

drop policy if exists shared_tasks_write on public.shared_tasks;
create policy shared_tasks_write on public.shared_tasks for all
  using (public.can(company_id, 'edit')) with check (public.can(company_id, 'edit'));

drop policy if exists shared_items_select on public.shared_items;
create policy shared_items_select on public.shared_items for select
  using (public.is_member(company_id));

drop policy if exists shared_items_write on public.shared_items;
create policy shared_items_write on public.shared_items for all
  using (public.can(company_id, 'edit')) with check (public.can(company_id, 'edit'));

-- ---------------------------------------------------------------------------
-- 9б. Що людина бачить
-- ---------------------------------------------------------------------------
-- Єдиний вхід для читання проєктів. Керівникові віддає все, рядовому —
-- оренду й ЙОГО ВЛАСНИЙ гонорар, а суму клієнта й загальні гонорари
-- підмінює на порожньо. Не «ховає в інтерфейсі» — саме не кладе у відповідь,
-- тож цих чисел немає навіть у трафіку.

create or replace function public.company_projects(p_company uuid)
returns table (
  id uuid,
  local_id text,
  title text,
  client text,
  style text,
  status text,
  deadline date,
  location text,
  latitude double precision,
  longitude double precision,
  currency text,
  fee numeric,
  rental_cost numeric,
  other_cost numeric,
  payout_total numeric,
  my_payout numeric,
  shoot_days date[],
  notes text,
  updated_at timestamptz,
  can_manage boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    p.id,
    p.local_id,
    p.title,
    case when public.can(p.company_id, 'contacts') then p.client end,
    p.style,
    p.status,
    p.deadline,
    p.location,
    p.latitude,
    p.longitude,
    -- Валюта тепер приходить із кошторису: саме він вирішує, у чому рахуємо.
    coalesce(nullif(m.currency, ''), p.currency),
    -- Числа рахуються з кошторисів фірми. Знімок лишається запасним шляхом
    -- для старих проєктів, перенесених із телефона: якщо кошторисів немає,
    -- беремо те, що приїхало разом із ними.
    case when public.can(p.company_id, 'money')
      then coalesce(nullif(m.income, 0), p.fee) end,
    case when public.can(p.company_id, 'rental')
      then coalesce(nullif(m.rental, 0), p.rental_cost) end,
    case when public.can(p.company_id, 'rental')
      then coalesce(nullif(m.other, 0), p.other_cost) end,
    case when public.can(p.company_id, 'money')
      then coalesce(nullif(m.payouts, 0), p.payout_total) end,
    (
      select coalesce(sum(amount), 0) from (
        select round(i.quantity * i.shifts * i.unit_cost, 2) as amount
        from public.company_estimate_items i
        join public.company_estimates est on est.id = i.estimate_id
        join public.company_crew c on c.id = i.crew_id
        where est.project_id = p.id and est.status <> 'declined' and c.user_id = auth.uid()
        union all
        select sp.amount
        from public.shared_payouts sp
        where sp.project_id = p.id and sp.user_id = auth.uid()
          and not exists (
            select 1 from public.company_estimates e2
            where e2.project_id = p.id and e2.status <> 'declined'
          )
      ) mine
    ),
    coalesce(
      (select array_agg(d.day order by d.day) from public.shared_shoot_days d where d.project_id = p.id),
      '{}'::date[]
    ),
    p.notes,
    p.updated_at,
    public.can(p.company_id, 'edit')
  from public.shared_projects p
  cross join lateral public.project_money(p.id) m
  where p.company_id = p_company
    and public.is_member(p.company_id)
  order by p.deadline nulls last, p.title;
$$;

-- Гонорари одного проєкту. Керівникові — всі, решті — лише свій.
create or replace function public.project_payouts(p_project uuid)
returns table (name text, role_title text, amount numeric, currency text, is_mine boolean)
language sql
security definer
stable
set search_path = public
as $$
  -- Гонорари з кошторисів фірми: кожен рядок з людиною — це гроші, які
  -- підуть із кишені фірми. Своє видно завжди, чуже — за дозволом.
  select name, role_title, amount, currency, is_mine
  from (
    select
      coalesce(c.name, i.title) as name,
      c.role as role_title,
      round(i.quantity * i.shifts * i.unit_cost, 2) as amount,
      est.currency,
      coalesce(c.user_id = auth.uid(), false) as is_mine
    from public.company_estimate_items i
    join public.company_estimates est on est.id = i.estimate_id
    left join public.company_crew c on c.id = i.crew_id
    where est.project_id = p_project
      and est.status <> 'declined'
      and public.is_member(i.company_id)
      and (i.category = 'crew' or i.crew_id is not null)
      and (public.can(i.company_id, 'payouts') or c.user_id = auth.uid())

    union all

    select sp.name, sp.role_title, sp.amount, sp.currency,
      coalesce(sp.user_id = auth.uid(), false)
    from public.shared_payouts sp
    join public.shared_projects p on p.id = sp.project_id
    where sp.project_id = p_project
      and public.is_member(p.company_id)
      and (public.can(p.company_id, 'payouts') or sp.user_id = auth.uid())
      and not exists (
        select 1 from public.company_estimates e2
        where e2.project_id = p_project and e2.status <> 'declined'
      )
  ) rows
  order by amount desc;
$$;

-- Задачі проєкту. Бачить уся команда — з позначкою, що доручено саме тобі.
create or replace function public.project_tasks(p_project uuid)
returns table (
  id uuid, title text, assignee_name text, due date, done boolean,
  priority text, notes text, is_mine boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select t.id, t.title, t.assignee_name, t.due, t.done, t.priority, t.notes,
         coalesce(t.assignee_id = auth.uid(), false)
  from public.shared_tasks t
  join public.shared_projects p on p.id = t.project_id
  where t.project_id = p_project and public.is_member(p.company_id)
  order by t.done, t.due nulls last, t.position;
$$;

-- Техніка проєкту: що везти й звідки брати.
create or replace function public.project_items(p_project uuid)
returns table (
  title text, category text, count_label text, ownership text,
  cost numeric, currency text, notes text
)
language sql
security definer
stable
set search_path = public
as $$
  -- Спершу дивимось у кошториси фірми: це жива правда. Якщо їх немає —
  -- проєкт перенесли знімком, і техніка лежить там, де лежала. Порядок
  -- задається окремою колонкою, бо в обʼєднанні двох джерел «position»
  -- одного з них нічого не значить для другого.
  select title, category, count_label, ownership, cost, currency, notes
  from (
    select
      i.title,
      i.category,
      -- «2 × 3 зміни» збираємо тут-таки: у кошторисі це три окремі числа.
      case
        when i.quantity > 1
          then public.tidy_number(i.quantity) || ' × '
             || public.tidy_number(i.shifts) || ' ' || public.tidy_unit(i.shifts, i.unit)
        else public.tidy_number(i.shifts) || ' ' || public.tidy_unit(i.shifts, i.unit)
      end as count_label,
      e.ownership,
      case when public.can(i.company_id, 'rental')
        then round(i.quantity * i.shifts * i.unit_cost, 2) end as cost,
      est.currency,
      coalesce(i.notes, e.notes) as notes,
      i.position as sort
    from public.company_estimate_items i
    join public.company_estimates est on est.id = i.estimate_id
    left join public.company_equipment e on e.id = i.equipment_id
    where est.project_id = p_project
      and public.is_member(i.company_id)
      and i.category <> 'crew' and i.crew_id is null
      and est.status <> 'declined'

    union all

    select i.title, i.category, i.count_label, i.ownership,
      case when public.can(p.company_id, 'rental') then i.cost end,
      i.currency, i.notes, i.position
    from public.shared_items i
    join public.shared_projects p on p.id = i.project_id
    where i.project_id = p_project
      and public.is_member(p.company_id)
      and not exists (
        select 1 from public.company_estimates e2
        where e2.project_id = p_project and e2.status <> 'declined'
      )
  ) rows
  order by sort;
$$;

-- Мої задачі по всій фірмі — щоб не заходити в кожен проєкт окремо.
create or replace function public.my_company_tasks(p_company uuid)
returns table (
  id uuid, title text, due date, done boolean, priority text, notes text,
  project_id uuid, project_title text, is_mine boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select t.id, t.title, t.due, t.done, t.priority, t.notes,
         p.id, p.title, coalesce(t.assignee_id = auth.uid(), false)
  from public.shared_tasks t
  join public.shared_projects p on p.id = t.project_id
  where p.company_id = p_company
    and public.is_member(p.company_id)
    and not t.done
    -- Керівник бачить усі задачі фірми, решта — свої та спільні (нічиї).
    and (public.can(p.company_id, 'edit') or t.assignee_id = auth.uid() or t.assignee_id is null)
  order by coalesce(t.assignee_id = auth.uid(), false) desc, t.due nulls last, t.position;
$$;

grant execute on function public.publish_project(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.project_tasks(uuid) to authenticated;
grant execute on function public.project_items(uuid) to authenticated;
grant execute on function public.my_company_tasks(uuid) to authenticated;
grant execute on function public.unpublish_project(uuid, text) to authenticated;
grant execute on function public.company_projects(uuid) to authenticated;
grant execute on function public.project_payouts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Ідеї фірми
-- ---------------------------------------------------------------------------
-- Ідея — річ дешева й особиста: записав кадр, який спав на думку в машині.
-- Більшість таких так і лишається при собі. Але частину варто показати
-- команді — і саме тому це окрема дія, а не автоматичне вивантаження
-- всього блокнота.
--
-- Дозволу тут немає навмисно: ідея нікому не коштує грошей, і ховати її
-- за роллю означало б, що людина з камерою не побачить референсу, який
-- для неї ж і зберегли.

create table if not exists public.company_ideas (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies on delete cascade,
  project_id  uuid references public.shared_projects on delete set null,
  -- Звідки приїхала з телефона: щоб повторна публікація оновлювала ту саму
  -- ідею, а не плодила копії.
  local_id    text,
  title       text not null,
  body        text,
  tags        text[] not null default '{}',
  author_id   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, local_id)
);

create index if not exists company_ideas_idx on public.company_ideas (company_id, created_at desc);

alter table public.company_ideas enable row level security;

-- Бачить уся команда. Прибрати може той, хто поділився, або керівник:
-- людина має право передумати щодо власного запису.
drop policy if exists company_ideas_select on public.company_ideas;
create policy company_ideas_select on public.company_ideas for select
  using (public.is_member(company_id));

drop policy if exists company_ideas_insert on public.company_ideas;
create policy company_ideas_insert on public.company_ideas for insert
  with check (public.is_member(company_id) and author_id = auth.uid());

drop policy if exists company_ideas_update on public.company_ideas;
create policy company_ideas_update on public.company_ideas for update
  using (author_id = auth.uid() or public.can(company_id, 'edit'));

drop policy if exists company_ideas_delete on public.company_ideas;
create policy company_ideas_delete on public.company_ideas for delete
  using (author_id = auth.uid() or public.can(company_id, 'edit'));

-- Ідеї разом з іменем того, хто поділився: без імені список читається
-- як анонімна дошка оголошень, і питати «а чия це думка?» ніде.
create or replace function public.company_idea_feed(p_company uuid)
returns table (
  id uuid, local_id text, title text, body text, tags text[],
  project_id uuid, project_title text,
  author_name text, is_mine boolean, created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    i.id, i.local_id, i.title, i.body, i.tags,
    i.project_id, p.title,
    coalesce(pr.full_name, 'Хтось із команди'),
    coalesce(i.author_id = auth.uid(), false),
    i.created_at
  from public.company_ideas i
  left join public.shared_projects p on p.id = i.project_id
  left join public.profiles pr on pr.id = i.author_id
  where i.company_id = p_company and public.is_member(i.company_id)
  order by i.created_at desc;
$$;

grant execute on function public.company_idea_feed(uuid) to authenticated;

-- Публікація ідеї. Робиться функцією, а не прямим записом, з двох причин:
-- по-перше, повторна публікація має оновити ту саму ідею, а не додати
-- близнюка; по-друге, ідея на телефоні привʼязана до особистого проєкту,
-- і звʼязати її з фірмовим може лише база — застосунок фірмових
-- ідентифікаторів не знає.
create or replace function public.publish_idea(p_company uuid, p_idea jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  found  uuid;
begin
  if not public.is_member(p_company) then
    raise exception 'Немає доступу до фірми';
  end if;

  select id into target
  from public.shared_projects
  where company_id = p_company
    and local_id is not null
    and local_id = nullif(p_idea->>'project_local_id', '')
  limit 1;

  insert into public.company_ideas
    (company_id, project_id, local_id, title, body, tags, author_id, updated_at)
  values (
    p_company,
    target,
    nullif(p_idea->>'local_id', ''),
    coalesce(nullif(trim(p_idea->>'title'), ''), 'Без назви'),
    nullif(p_idea->>'body', ''),
    coalesce(
      (select array_agg(value) from jsonb_array_elements_text(
        case when jsonb_typeof(p_idea->'tags') = 'array' then p_idea->'tags' else '[]'::jsonb end)),
      '{}'
    ),
    auth.uid(),
    now()
  )
  on conflict (company_id, local_id) do update
    set title      = excluded.title,
        body       = excluded.body,
        tags       = excluded.tags,
        project_id = excluded.project_id,
        updated_at = now()
  returning id into found;

  return found;
end;
$$;

-- Прибрати з фірми. Своє — завжди; чуже — той, кому дозволено редагувати.
create or replace function public.unpublish_idea(p_company uuid, p_local_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.company_ideas
  where company_id = p_company
    and local_id = p_local_id
    and (author_id = auth.uid() or public.can(p_company, 'edit'));
end;
$$;

-- Де вже опубліковано мої ідеї: щоб на екрані ідей було видно, що саме
-- команда вже бачить, і не публікувати вдруге наосліп.
create or replace function public.my_published_ideas(p_company uuid)
returns table (local_id text, id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select i.local_id, i.id
  from public.company_ideas i
  where i.company_id = p_company
    and i.author_id = auth.uid()
    and i.local_id is not null;
$$;

grant execute on function public.publish_idea(uuid, jsonb) to authenticated;
grant execute on function public.unpublish_idea(uuid, text) to authenticated;
grant execute on function public.my_published_ideas(uuid) to authenticated;
