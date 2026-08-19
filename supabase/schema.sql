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

-- ---------------------------------------------------------------------------
-- 9. Спільні проєкти
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
create policy shared_projects_all on public.shared_projects for all
  using (public.is_manager(company_id)) with check (public.is_manager(company_id));

drop policy if exists shared_shoot_days_all on public.shared_shoot_days;
create policy shared_shoot_days_all on public.shared_shoot_days for all
  using (exists (
    select 1 from public.shared_projects p
    where p.id = project_id and public.is_manager(p.company_id)
  ))
  with check (exists (
    select 1 from public.shared_projects p
    where p.id = project_id and public.is_manager(p.company_id)
  ));

-- Гонорари: керівник бачить усі, людина — тільки свій власний рядок.
drop policy if exists shared_payouts_select on public.shared_payouts;
create policy shared_payouts_select on public.shared_payouts for select
  using (public.is_manager(company_id) or user_id = auth.uid());

drop policy if exists shared_payouts_write on public.shared_payouts;
create policy shared_payouts_write on public.shared_payouts for all
  using (public.is_manager(company_id)) with check (public.is_manager(company_id));

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
  if not public.is_manager(p_company) then
    raise exception 'Публікувати проєкти може директор або адміністратор';
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
  if not public.is_manager(p_company) then
    raise exception 'Прибрати проєкт може директор або адміністратор';
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
  using (public.is_manager(company_id)) with check (public.is_manager(company_id));

drop policy if exists shared_items_select on public.shared_items;
create policy shared_items_select on public.shared_items for select
  using (public.is_member(company_id));

drop policy if exists shared_items_write on public.shared_items;
create policy shared_items_write on public.shared_items for all
  using (public.is_manager(company_id)) with check (public.is_manager(company_id));

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
    p.client,
    p.style,
    p.status,
    p.deadline,
    p.location,
    p.latitude,
    p.longitude,
    p.currency,
    case when public.is_manager(p.company_id) then p.fee end,
    p.rental_cost,
    p.other_cost,
    case when public.is_manager(p.company_id) then p.payout_total end,
    (
      select coalesce(sum(sp.amount), 0)
      from public.shared_payouts sp
      where sp.project_id = p.id and sp.user_id = auth.uid()
    ),
    coalesce(
      (select array_agg(d.day order by d.day) from public.shared_shoot_days d where d.project_id = p.id),
      '{}'::date[]
    ),
    p.notes,
    p.updated_at,
    public.is_manager(p.company_id)
  from public.shared_projects p
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
  select sp.name, sp.role_title, sp.amount, sp.currency, coalesce(sp.user_id = auth.uid(), false)
  from public.shared_payouts sp
  join public.shared_projects p on p.id = sp.project_id
  where sp.project_id = p_project
    and public.is_member(p.company_id)
    and (public.is_manager(p.company_id) or sp.user_id = auth.uid())
  order by sp.amount desc;
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
  select i.title, i.category, i.count_label, i.ownership, i.cost, i.currency, i.notes
  from public.shared_items i
  join public.shared_projects p on p.id = i.project_id
  where i.project_id = p_project and public.is_member(p.company_id)
  order by i.position;
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
    and (public.is_manager(p.company_id) or t.assignee_id = auth.uid() or t.assignee_id is null)
  order by coalesce(t.assignee_id = auth.uid(), false) desc, t.due nulls last, t.position;
$$;

grant execute on function public.publish_project(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.project_tasks(uuid) to authenticated;
grant execute on function public.project_items(uuid) to authenticated;
grant execute on function public.my_company_tasks(uuid) to authenticated;
grant execute on function public.unpublish_project(uuid, text) to authenticated;
grant execute on function public.company_projects(uuid) to authenticated;
grant execute on function public.project_payouts(uuid) to authenticated;
