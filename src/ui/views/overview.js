// Екран огляду — те, що оператор бачить, відкривши застосунок на бігу.
// Спочатку прострочене, потім сьогоднішнє, потім найближчі дні.

import { el, emptyState, appendIf } from '../dom.js';
import { pageHeader, sectionTitle, taskRow, statTile, agendaDay, fab, formatMoney, chip, dueVariant } from '../components.js';
import { isSignedIn } from '../../core/cloud.js';
import { currentCompany, inCompany } from '../../core/context.js';
import { contextBar, freshnessNote } from '../context-bar.js';
import { companyProjects, myFirmTasks } from '../../core/sharing.js';
import { editTask, quickTask } from '../editors.js';
import { navigate } from '../router.js';
import { getState } from '../../core/store.js';
import {
  overdueTasks, todayTasks, upcomingTasks, activeProjects,
  deadlineAgenda, upcomingReminders, projectById, unpaidTotal,
} from '../../core/selectors.js';
import { todayISO, formatDate, weekdayShort, formatTime, formatDateTime, describeDue, daysUntil } from '../../core/dates.js';
import { shootingWindows } from '../../core/cine/sun.js';

export function overviewView() {
  return inCompany() ? firmOverview() : myOverview();
}

/**
 * Огляд очима фірми.
 *
 * Ті самі питання, що й на власному екрані — що сьогодні, що горить, що далі, —
 * але про справи фірми. Особисті лічильники сюди не потрапляють: «0 у роботі»
 * поруч із завтрашньою зйомкою фірми читається як «нічого не відбувається».
 */
function firmOverview() {
  const state = getState();
  const company = currentCompany();
  const page = el('div.page');

  page.append(pageHeader(greeting(), {
    subtitle: `${formatDate(todayISO())}, ${weekdayFull()}`,
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Налаштування', onclick: () => navigate('/settings') }, '⚙'),
  }));

  appendIf(page, contextBar());

  const sun = sunBlock(state);
  if (sun) page.append(sun);

  const host = el('div');
  page.append(host);
  loadFirmOverview(host, company);

  return page;
}

async function loadFirmOverview(host, company) {
  host.replaceChildren(el('p.settings-note', 'Завантажую…'));

  let projectsResult;
  let tasksResult;
  try {
    [projectsResult, tasksResult] = await Promise.all([
      companyProjects(company.id),
      myFirmTasks(company.id),
    ]);
  } catch (error) {
    host.replaceChildren(
      el('p.settings-note', error?.message ?? 'Немає звʼязку з сервером'),
      el('div.form', el('button.btn.btn--ghost.btn--wide', {
        type: 'button', onclick: () => loadFirmOverview(host, company),
      }, 'Спробувати ще раз')),
    );
    return;
  }

  const projects = projectsResult.value;
  const tasks = tasksResult.value;
  const today = todayISO();
  const parts = [];

  const stale = freshnessNote(projectsResult.fresh ? tasksResult : projectsResult,
    () => loadFirmOverview(host, company));
  if (stale) parts.push(stale);

  const mine = tasks.filter((task) => task.isMine);
  const overdue = mine.filter((task) => task.due && daysUntil(task.due) < 0);
  const upcomingShoots = projects.filter((project) => project.shootDays.some((day) => day >= today));

  parts.push(el('div.stats',
    statTile(String(projects.length), 'проєктів'),
    statTile(String(mine.length), 'моїх задач', mine.length ? 'warn' : ''),
    statTile(String(overdue.length), 'прострочено', overdue.length ? 'danger' : '')));

  const shootingToday = projects.filter((project) => project.shootDays.includes(today));
  if (shootingToday.length) {
    parts.push(el('div.banner.banner--shoot',
      el('p.banner-title', '🎥 Сьогодні знімальний день'),
      el('p.banner-text', shootingToday
        .map((project) => [project.title, project.location].filter(Boolean).join(' · '))
        .join('  |  '))));
  }

  const byId = new Map(projects.map((project) => [project.id, project]));
  const taskRows = (list) => el('div.list', list.map((task) => {
    // Стисло, одним рядком: проєкт і де це. Саме цих слів бракує,
    // коли дивишся в телефон на ходу.
    const project = byId.get(task.projectId);
    const where = [task.projectTitle, project?.location].filter(Boolean).join(' · ');

    return el(
      'article.row',
      { onclick: () => navigate(`/team-projects/${task.projectId}`) },
      el('span.row-mark', task.isMine ? '🙋' : '○'),
      el('div.row-body',
        el('p.row-title', task.title),
        el('p.row-note', where),
        task.due ? el('div.row-meta', chip(describeDue(task.due), dueVariant(task.due))) : null),
      el('span.card-chevron', '›'),
    );
  }));

  if (overdue.length) {
    parts.push(sectionTitle('Прострочено'));
    parts.push(taskRows(overdue));
  }

  const rest = mine.filter((task) => !overdue.includes(task));
  parts.push(sectionTitle('Мої задачі', el('span.section-hint', company.name)));
  parts.push(rest.length
    ? taskRows(rest.slice(0, 8))
    : emptyState('За тобою задач немає', 'Керівник закріпить — вони зʼявляться тут.'));

  const shared = tasks.filter((task) => !task.isMine).slice(0, 5);
  if (shared.length) {
    parts.push(sectionTitle('Спільні задачі'));
    parts.push(taskRows(shared));
  }

  if (upcomingShoots.length) {
    parts.push(sectionTitle('Найближчі зйомки',
      el('button.link', { type: 'button', onclick: () => navigate('/projects') }, 'усі проєкти')));
    parts.push(el('div.list', upcomingShoots.slice(0, 5).map((project) => {
      const next = [...project.shootDays].filter((day) => day >= today).sort()[0];
      return el(
        'article.row',
        { onclick: () => navigate(`/team-projects/${project.id}`) },
        el('span.row-mark', '🎬'),
        el('div.row-body',
          el('p.row-title', project.title),
          el('p.row-note', [
            next ? `Зйомка ${describeDue(next).toLowerCase()}` : project.client,
            project.location,
          ].filter(Boolean).join(' · '))),
        el('span.card-chevron', '›'),
      );
    })));
  }

  if (!projects.length && !tasks.length) {
    parts.push(emptyState(
      `Поки тихо в «${company.name}»`,
      'Зйомок за тобою ще не закріпили. Щойно керівник опублікує проєкт — він зʼявиться тут.',
    ));
  }

  host.replaceChildren(...parts);
}

function myOverview() {
  const state = getState();
  const overdue = overdueTasks(state);
  const today = todayTasks(state);
  const upcoming = upcomingTasks(state, 7);
  const projects = activeProjects(state);
  const reminders = upcomingReminders(state).slice(0, 3);
  const agenda = deadlineAgenda(state, { days: 21 }).slice(0, 6);
  const unpaid = unpaidTotal(state);

  const shootToday = projects.filter((project) => project.shootDays.includes(todayISO()));

  const page = el('div.page');

  page.append(pageHeader(greeting(), {
    subtitle: `${formatDate(todayISO())}, ${weekdayFull()}`,
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Налаштування', onclick: () => navigate('/settings') }, '⚙'),
  }));

  appendIf(page, contextBar());

  page.append(el(
    'div.stats',
    statTile(String(projects.length), 'у роботі'),
    statTile(String(overdue.length), 'прострочено', overdue.length ? 'danger' : ''),
    statTile(String(today.length), 'на сьогодні', today.length ? 'warn' : ''),
    unpaid > 0 ? statTile(formatMoney(unpaid), 'не оплачено') : null,
  ));

  if (shootToday.length) {
    page.append(el(
      'div.banner.banner--shoot',
      el('p.banner-title', '🎥 Сьогодні знімальний день'),
      el('p.banner-text', shootToday.map((project) => project.title).join(' · ')),
    ));
  }

  const sun = sunBlock(state);
  if (sun) page.append(sun);

  if (overdue.length) {
    page.append(sectionTitle('Прострочено'));
    page.append(el('div.list', overdue.slice(0, 5).map((task) => taskRow(task, {
      project: projectById(state, task.projectId),
      onEdit: (item) => editTask(item),
    }))));
  }

  page.append(sectionTitle('Сьогодні', today.length ? null : el('span.section-hint', 'вільно')));
  page.append(today.length
    ? el('div.list', today.map((task) => taskRow(task, {
        project: projectById(state, task.projectId),
        onEdit: (item) => editTask(item),
      })))
    : emptyState('На сьогодні задач немає', 'Гарний день, щоб рушити щось велике.'));

  if (reminders.length) {
    page.append(sectionTitle('Найближчі нагадування'));
    page.append(el('div.list', reminders.map((task) => el(
      'article.row',
      { onclick: () => editTask(task) },
      el('span.row-mark', '🔔'),
      el('div.row-body',
        el('p.row-title', task.title),
        el('p.row-note', formatDateTime(task.remindAt))),
    ))));
  }

  if (upcoming.length) {
    page.append(sectionTitle('Цього тижня', el('button.link', { type: 'button', onclick: () => navigate('/tasks') }, 'усі задачі')));
    page.append(el('div.list', upcoming.slice(0, 5).map((task) => taskRow(task, {
      project: projectById(state, task.projectId),
      onEdit: (item) => editTask(item),
    }))));
  }

  if (agenda.length) {
    page.append(sectionTitle('Календар'));
    page.append(el('div.agenda', agenda.map(agendaDay)));
  }

  if (!state.projects.length && !state.tasks.length) {
    page.append(emptyState(
      'Порожньо — і це нормально',
      'Створи перший проєкт, і задачі, дедлайни та знімальні дні зберуться навколо нього.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => navigate('/projects') }, 'До проєктів'),
    ));
  }

  page.append(fab('Нова задача', quickTask));
  return page;
}

/** Вікна золотої години на сьогодні — якщо координати вже задані. */
function sunBlock(state) {
  const { latitude, longitude, locationLabel } = state.settings;
  if (latitude === null || longitude === null) return null;

  const windows = shootingWindows(new Date(), latitude, longitude);
  if (!windows) return null;

  const range = (span) => (span ? `${formatTime(span.from)} – ${formatTime(span.to)}` : '—');

  return el(
    'div.sun-card',
    { onclick: () => navigate('/calc/sun') },
    el('div.sun-head', el('span', '☀'), el('span.sun-place', locationLabel || 'Золота година')),
    el(
      'div.sun-grid',
      el('div.sun-item', el('p.sun-label', 'Ранкова золота'), el('p.sun-value', range(windows.morningGolden))),
      el('div.sun-item', el('p.sun-label', 'Вечірня золота'), el('p.sun-value', range(windows.eveningGolden))),
      el('div.sun-item', el('p.sun-label', 'Схід'), el('p.sun-value', windows.times.sunrise ? formatTime(windows.times.sunrise) : '—')),
      el('div.sun-item', el('p.sun-label', 'Захід'), el('p.sun-value', windows.times.sunset ? formatTime(windows.times.sunset) : '—')),
    ),
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Ще знімаєш?';
  if (hour < 12) return 'Доброго ранку';
  if (hour < 18) return 'Доброго дня';
  return 'Доброго вечора';
}

function weekdayFull() {
  const names = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота'];
  return names[new Date().getDay()];
}
