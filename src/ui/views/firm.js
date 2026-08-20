// Вкладка «Фірма»: список моїх фірм і сторінка кожної.
//
// Це екран не про роботу, а про саму фірму — хто це, чим займаються, хто
// в команді, хто головний і хто я тут. Робота живе на звичайних вкладках:
// перемкнувся на фірму — і проєкти з задачами вже її.

import { el, emptyState, appendIf } from '../dom.js';
import { pageHeader, sectionTitle, chip, dueVariant } from '../components.js';
import { navigate } from '../router.js';
import { isSignedIn } from '../../core/cloud.js';
import { knownCompanies, getContext, setContext } from '../../core/context.js';
import { teamOf, roleLabel, canManage } from '../../core/account.js';
import { companyProjects } from '../../core/sharing.js';
import { statusLabel } from '../../core/models.js';
import { describeDue } from '../../core/dates.js';
import { freshnessNote } from '../context-bar.js';

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

  const teamHost = el('div');
  const projectsHost = el('div');
  page.append(teamHost, projectsHost);

  loadTeam(teamHost, company);
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
    el('span.row-mark', member.isMe ? '🙋' : (member.role === 'owner' ? '★' : '👤')),
    el('div.row-body',
      el('p.row-title', member.name || member.title || 'Без імені'),
      el('div.row-meta',
        chip(roleLabel(member.role), member.role === 'owner' ? 'money' : ''),
        member.title ? chip(member.title) : null,
        member.isMe ? chip('це ти') : null)),
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
