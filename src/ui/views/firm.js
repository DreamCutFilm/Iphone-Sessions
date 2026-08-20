// Вкладка «Фірма»: список моїх фірм і сторінка кожної.
//
// Це екран не про роботу, а про саму фірму — хто це, чим займаються, хто
// в команді, хто головний і хто я тут. Робота живе на звичайних вкладках:
// перемкнувся на фірму — і проєкти з задачами вже її.

import { el, emptyState, appendIf, toast } from '../dom.js';
import { pageHeader, sectionTitle, chip, dueVariant } from '../components.js';
import { navigate } from '../router.js';
import { isSignedIn } from '../../core/cloud.js';
import { knownCompanies, getContext, setContext } from '../../core/context.js';
import { teamOf, roleLabel, canManage, changeRole, removeMember, ROLES } from '../../core/account.js';
import { companyProjects } from '../../core/sharing.js';
import { importCatalog } from '../../core/catalog.js';
import { getState } from '../../core/store.js';
import { statusLabel } from '../../core/models.js';
import { describeDue, plural } from '../../core/dates.js';
import { freshnessNote } from '../context-bar.js';
import { openSheet, closeSheet, confirmSheet, field, formBody, textInput, selectInput } from '../sheet.js';
import {
  PERMISSIONS, emptyRole, describeRole, sensitiveGrants,
  rolesOf, createRole, updateRole, removeRole, assignRole, permissionsOf,
} from '../../core/roles.js';

export function firmView() {
  const page = el('div.page');
  page.append(pageHeader('Фірма'));

  if (!isSignedIn()) {
    page.append(emptyState(
      'Потрібен акаунт',
      'Фірма — це спільні проєкти, команда й гонорари. Без неї застосунок працює як завжди.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => navigate('/account') }, 'Увійти'),
    ));
    return page;
  }

  const companies = knownCompanies();
  if (!companies.length) {
    page.append(emptyState(
      'Ти ще не у фірмі',
      'Створи свою або приєднайся до наявної — за кодом запрошення чи заявкою.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => navigate('/account') }, 'До акаунта'),
    ));
    return page;
  }

  const context = getContext();

  page.append(sectionTitle('Мої фірми', el('span.section-hint', String(companies.length))));
  page.append(el('div.list', companies.map((company) => {
    const active = context.kind === 'company' && context.id === company.id;

    return el(
      'article.card',
      { onclick: () => navigate(`/firm/${company.id}`) },
      el('div.card-body',
        el('p.card-title', company.name),
        company.city && el('p.card-sub', company.city),
        el('div.row-meta',
          chip(roleLabel(company.role), company.role === 'owner' ? 'money' : ''),
          active ? chip('зараз тут', 'project') : null,
          company.listed ? chip('у каталозі') : chip('прихована'))),
      el('span.card-chevron', '›'),
    );
  })));

  page.append(el('div.form',
    el('button.btn.btn--ghost.btn--wide', {
      type: 'button', onclick: () => navigate('/account'),
    }, 'Створити фірму або приєднатися')));

  return page;
}

// --- Сторінка фірми ---------------------------------------------------------

export function firmDetailView(companyId) {
  const page = el('div.page');
  const company = knownCompanies().find((entry) => entry.id === companyId);

  page.append(pageHeader(company?.name ?? 'Фірма', { back: '/firm' }));

  if (!company) {
    page.append(emptyState('Фірму не знайдено', 'Можливо, тебе прибрали з команди.'));
    return page;
  }

  const context = getContext();
  const here = context.kind === 'company' && context.id === company.id;

  page.append(el('div.facts',
    chip(`@${company.slug || '—'}`, 'project'),
    company.city ? chip(`📍 ${company.city}`) : null,
    chip(`ти — ${roleLabel(company.role)}`, company.role === 'owner' ? 'money' : ''),
    company.listed ? chip('у каталозі') : chip('прихована')));

  if (company.about) page.append(el('div.note-card', company.about));

  // Перемикання прямо звідси: людина щойно прочитала, що це за фірма, —
  // логічно тут-таки в неї й зайти.
  page.append(el('div.form', here
    ? el('p.settings-note', '✓ Зараз застосунок показує справи цієї фірми.')
    : el('button.btn.btn--primary.btn--wide', {
        type: 'button',
        onclick: () => {
          setContext({ kind: 'company', id: company.id, name: company.name, role: company.role });
          navigate('/overview');
        },
      }, `Працювати у «${company.name}»`)));

  appendIf(page, catalogBlock(company));

  const teamHost = el('div');
  const rolesHost = el('div');
  const projectsHost = el('div');
  page.append(teamHost, rolesHost, projectsHost);

  loadTeam(teamHost, company);
  if (permissionsOf(company).can_manage_team) loadRoles(rolesHost, company);
  loadProjects(projectsHost, company);

  return page;
}

async function loadTeam(host, company) {
  host.replaceChildren(sectionTitle('Команда'), el('p.settings-note', 'Завантажую…'));

  let team;
  try {
    team = await teamOf(company.id);
  } catch (error) {
    host.replaceChildren(
      sectionTitle('Команда'),
      el('p.settings-note', error?.message ?? 'Немає звʼязку з сервером'),
      el('div.form', el('button.btn.btn--ghost.btn--wide', {
        type: 'button', onclick: () => loadTeam(host, company),
      }, 'Спробувати ще раз')),
    );
    return;
  }

  // Керівники йдуть першими — на них дивляться, коли шукають, до кого звертатись.
  const order = { owner: 0, admin: 1, member: 2 };
  const sorted = [...team].sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));

  const parts = [sectionTitle('Команда', el('span.section-hint', String(team.length)))];

  parts.push(el('div.list', sorted.map((member) => el(
    'article.row',
    canManage(company.role) && !member.isMe
      ? { onclick: () => memberRoleSheet(member, company, () => loadTeam(host, company)) }
      : null,
    el('span.row-mark', member.isMe ? '🙋' : (member.role === 'owner' ? '★' : '👤')),
    el('div.row-body',
      el('p.row-title', member.name || member.title || 'Без імені'),
      el('div.row-meta',
        chip(roleLabel(member.role), member.role === 'owner' ? 'money' : ''),
        member.roleName ? chip(member.roleName, 'project') : null,
        member.isMe ? chip('це ти') : null)),
    canManage(company.role) && !member.isMe ? el('span.card-chevron', '›') : null,
  ))));

  if (canManage(company.role)) {
    parts.push(el('div.form', el('button.btn.btn--ghost.btn--wide', {
      type: 'button', onclick: () => navigate('/account'),
    }, 'Запросити людину')));
  }

  host.replaceChildren(...parts);
}

async function loadProjects(host, company) {
  host.replaceChildren(sectionTitle('Активні проєкти'), el('p.settings-note', 'Завантажую…'));

  let result;
  try {
    result = await companyProjects(company.id);
  } catch (error) {
    host.replaceChildren(
      sectionTitle('Активні проєкти'),
      el('p.settings-note', error?.message ?? 'Немає звʼязку з сервером'),
    );
    return;
  }

  const active = result.value.filter((project) => project.status !== 'archived' && project.status !== 'done');
  const parts = [sectionTitle('Активні проєкти', el('span.section-hint', String(active.length)))];

  if (!active.length) {
    parts.push(el('p.settings-note', 'Активних проєктів немає.'));
  } else {
    parts.push(el('div.list', active.map((project) => el(
      'article.card',
      { onclick: () => navigate(`/team-projects/${project.id}`) },
      el('div.card-body',
        el('p.card-title', project.title),
        project.client && el('p.card-sub', project.client),
        el('div.row-meta',
          chip(statusLabel(project.status), `status-${project.status}`),
          project.deadline ? chip(`⚑ ${describeDue(project.deadline)}`, dueVariant(project.deadline)) : null,
          // «Хто ти в цьому проєкті» — найкоротша чесна відповідь: чи є в ньому
          // твій гонорар. Якщо є — ти в ньому працюєш, а не просто спостерігаєш.
          project.myPayout > 0 ? chip('ти в команді', 'money') : null)),
      el('span.card-chevron', '›'),
    ))));
  }

  host.replaceChildren(...parts);
  appendIf(host, freshnessNote(result, () => loadProjects(host, company)));
}


/**
 * Каталоги фірми — вхід і перенесення.
 *
 * Каталог, зібраний за рік, ніхто не вбиватиме руками вдруге. Тому поруч
 * із входом стоїть кнопка перенесення: вона везе техніку й людей із цього
 * телефона у фірму. Кожна позиція памʼятає свій місцевий номер, тож
 * повторний перенос оновлює те саме, а не створює другий комплект.
 */
function catalogBlock(company) {
  const perms = permissionsOf(company);
  const state = getState();
  const mine = state.equipment.length + state.crew.length;

  const block = el('div');
  block.append(sectionTitle('Каталоги фірми'));

  block.append(el('div.list',
    el('article.row', { onclick: () => navigate('/equipment') },
      el('span.row-mark', '🎒'),
      el('div.row-body', el('p.row-title', 'Техніка'), el('p.row-note', 'Що є у фірми й де це брати')),
      el('span.card-chevron', '›')),
    el('article.row', { onclick: () => navigate('/crew') },
      el('span.row-mark', '👥'),
      el('div.row-body', el('p.row-title', 'Команда'), el('p.row-note', 'Кого наймаємо й за скільки')),
      el('span.card-chevron', '›'))));

  if (perms.can_edit && mine > 0) {
    block.append(el('div.form',
      el('button.btn.btn--ghost.btn--wide', {
        type: 'button',
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          button.textContent = 'Переношу…';
          try {
            const moved = await importCatalog(company.id, getState());
            toast(`Перенесено позицій: ${moved}`);
            navigate('/equipment');
          } catch (error) {
            toast(error?.message ?? 'Немає звʼязку з сервером', { error: true });
          } finally {
            button.disabled = false;
            button.textContent = '↑ Перенести мій каталог у фірму';
          }
        },
      }, '↑ Перенести мій каталог у фірму'),
      el('p.settings-note',
        `На цьому телефоні ${plural(mine, 'позиція', 'позиції', 'позицій')} у власних каталогах. `
        + 'Перенесення нічого не стирає: власні каталоги лишаються на місці, '
        + 'а повторний перенос оновлює вже перенесене, а не дублює його.')));
  }

  return block;
}

// --- Ролі -------------------------------------------------------------------

async function loadRoles(host, company) {
  host.replaceChildren(sectionTitle('Ролі'), el('p.settings-note', 'Завантажую…'));

  let roles;
  try {
    roles = await rolesOf(company.id);
  } catch (error) {
    host.replaceChildren(
      sectionTitle('Ролі'),
      el('p.settings-note', error?.message ?? 'Немає звʼязку з сервером'),
    );
    return;
  }

  const parts = [sectionTitle('Ролі', el('span.section-hint', String(roles.length)))];

  parts.push(el('p.settings-note',
    'Роль — це посада й те, що вона відкриває. Директор бачить усе завжди, '
    + 'адміністратор — усе, крім керування командою. Решті видно рівно те, '
    + 'що написано в їхній ролі; свої задачі й свій гонорар — завжди.'));

  parts.push(el('div.list', roles.map((role) => el(
    'article.row',
    { onclick: () => roleSheet(role, company, () => loadRoles(host, company)) },
    el('span.row-mark', '🎭'),
    el('div.row-body',
      el('p.row-title', role.name),
      el('p.row-note', describeRole(role))),
    el('span.card-chevron', '›'),
  ))));

  parts.push(el('div.form', el('button.btn.btn--ghost.btn--wide', {
    type: 'button',
    onclick: () => roleSheet(null, company, () => loadRoles(host, company)),
  }, '+ Нова роль')));

  host.replaceChildren(...parts);
}

/**
 * Створення й правка ролі.
 *
 * Дозволи, які відкривають гроші, підписані окремо й помітно: різниця між
 * «бачить оренду» і «бачить, скільки платить клієнт» коштує дорого, і
 * помилитися тут має бути важко.
 */
function roleSheet(existing, company, onDone) {
  const draft = existing ? { ...existing } : emptyRole();
  const warning = el('p.settings-note');

  const refreshWarning = () => {
    const risky = sensitiveGrants(draft);
    warning.textContent = risky.length
      ? `⚠ Ця роль відкриє: ${risky.map((item) => item.label.toLowerCase()).join(', ')}.`
      : '';
    warning.className = risky.length ? 'settings-note settings-note--stale' : 'settings-note';
  };

  const switches = PERMISSIONS.map((permission) => {
    const box = el('input', {
      type: 'checkbox',
      checked: Boolean(draft[permission.id]),
      onchange: (event) => {
        draft[permission.id] = event.target.checked;
        refreshWarning();
      },
    });

    return el('label.perm',
      box,
      el('span.perm-body',
        el('span.perm-label', permission.label),
        el('span.perm-hint', permission.hint)));
  });

  refreshWarning();

  openSheet({
    title: existing ? 'Роль' : 'Нова роль',
    body: formBody(
      field('Назва', textInput({
        value: draft.name,
        placeholder: 'Монтажер',
        oninput: (event) => { draft.name = event.target.value; },
      }), 'Так вона підписуватиметься в складі команди.'),
      el('div.perms', switches),
      warning,
    ),
    actions: [
      existing
        ? el('button.btn.btn--ghost', {
            type: 'button',
            onclick: () => confirmSheet({
              title: 'Видалити роль?',
              message: `«${existing.name}» зникне. Люди з цією роллю лишаться у фірмі, `
                + 'але бачитимуть лише свої задачі та свій гонорар.',
              onConfirm: async () => {
                try {
                  await removeRole(existing.id);
                  toast('Роль видалено');
                  onDone();
                } catch (error) {
                  toast(error?.message ?? 'Не вдалося видалити', { error: true });
                }
              },
            }),
          }, 'Видалити')
        : el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: async (event) => {
          if (!draft.name.trim()) { toast('Впиши назву ролі', { error: true }); return; }

          const button = event.currentTarget;
          button.disabled = true;
          try {
            if (existing) await updateRole(existing.id, draft);
            else await createRole(company.id, draft);
            closeSheet();
            toast('Збережено');
            onDone();
          } catch (error) {
            toast(error?.message ?? 'Не вдалося зберегти', { error: true });
          } finally {
            button.disabled = false;
          }
        },
      }, 'Зберегти'),
    ],
  });
}

/** Рівень і роль однієї людини. */
function memberRoleSheet(member, company, onDone) {
  let level = member.role;
  let roleId = member.roleId ?? '';
  const rolePicker = el('div.form');

  rolesOf(company.id)
    .then((roles) => {
      rolePicker.replaceChildren(field('Роль у фірмі', selectInput(
        [{ value: '', label: 'Без ролі — лише свої задачі й гонорар' },
          ...roles.map((role) => ({ value: role.id, label: `${role.name} — ${describeRole(role)}` }))],
        { value: roleId, onchange: (event) => { roleId = event.target.value; } },
      ), 'Рівень вирішує, чи людина керує фірмою. Роль — що саме їй видно.'));
    })
    .catch(() => {
      rolePicker.replaceChildren(el('p.settings-note', 'Не вдалося прочитати ролі фірми.'));
    });

  openSheet({
    title: member.name || 'Учасник',
    body: formBody(
      field('Рівень', selectInput(
        ROLES.map((item) => ({ value: item.id, label: `${item.label} — ${item.hint}` })),
        { value: level, onchange: (event) => { level = event.target.value; } },
      )),
      rolePicker,
    ),
    actions: [
      el('button.btn.btn--danger', {
        type: 'button',
        onclick: () => confirmSheet({
          title: 'Прибрати з команди?',
          message: `${member.name || 'Ця людина'} втратить доступ до проєктів фірми.`,
          onConfirm: async () => {
            try {
              await removeMember(member.id);
              toast('Прибрано з команди');
              onDone();
            } catch (error) {
              toast(error?.message ?? 'Не вдалося', { error: true });
            }
          },
        }),
      }, 'Прибрати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: async () => {
          try {
            if (level !== member.role) await changeRole(member.id, level);
            if ((roleId || null) !== (member.roleId ?? null)) await assignRole(member.id, roleId);
            closeSheet();
            toast('Збережено');
            onDone();
          } catch (error) {
            toast(error?.message ?? 'Не вдалося зберегти', { error: true });
          }
        },
      }, 'Зберегти'),
    ],
  });
}
