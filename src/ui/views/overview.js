// Екран огляду — те, що оператор бачить, відкривши застосунок на бігу.
// Спочатку прострочене, потім сьогоднішнє, потім найближчі дні.

import { el, emptyState, appendIf } from '../dom.js';
import { pageHeader, sectionTitle, taskRow, statTile, agendaDay, fab, formatMoney } from '../components.js';
import { isSignedIn } from '../../core/cloud.js';
import { activeCompany } from '../../core/account.js';
import { companyProjects, myFirmTasks } from '../../core/sharing.js';
import { editTask, quickTask } from '../editors.js';
import { navigate } from '../router.js';
import { getState } from '../../core/store.js';
import {
  overdueTasks, todayTasks, upcomingTasks, activeProjects,
  deadlineAgenda, upcomingReminders, projectById, unpaidTotal,
} from '../../core/selectors.js';
import { todayISO, formatDate, weekdayShort, formatTime, formatDateTime, describeDue } from '../../core/dates.js';
import { shootingWindows } from '../../core/cine/sun.js';

export function overviewView() {
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

  const inFirm = isSignedIn() && Boolean(activeCompany());
  const emptyHere = !state.projects.length && !state.tasks.length;

  if (emptyHere && !inFirm) {
    page.append(emptyState(
      'Порожньо — і це нормально',
      'Створи перший проєкт, і задачі, дедлайни та знімальні дні зберуться навколо нього.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => navigate('/projects') }, 'До проєктів'),
    ));
  }

  appendIf(page, firmBlock({ emptyHere }));

  page.append(fab('Нова задача', quickTask));
  return page;
}

/**
 * Фірма на екрані огляду.
 *
 * Не назва фірми з посиланням «кудись туди», а те саме, що й для власних
 * справ: що знімаємо сьогодні і що я маю зробити. Людина в команді відкриває
 * застосунок саме з цим питанням, і відповідь має бути на першому екрані.
 */
function firmBlock({ emptyHere = false } = {}) {
  if (!isSignedIn()) return null;
  const company = activeCompany();
  if (!company) return null;

  const host = el('div');
  const today = todayISO();

  Promise.all([companyProjects(company.id), myFirmTasks(company.id)])
    .then(([projects, tasks]) => {
      const parts = [];

      const shootingToday = projects.filter((project) => project.shootDays.includes(today));
      if (shootingToday.length) {
        parts.push(el('div.banner.banner--shoot',
          el('p.banner-title', '🎥 Сьогодні знімальний день'),
          el('p.banner-text', shootingToday.map((project) => project.title).join(' · '))));
      }

      const mine = tasks.filter((task) => task.isMine).slice(0, 5);
      if (mine.length) {
        parts.push(sectionTitle('Мої задачі у фірмі', el('span.section-hint', company.name)));
        parts.push(el('div.list', mine.map((task) => el(
          'article.row',
          { onclick: () => navigate(`/team-projects/${task.projectId}`) },
          el('span.row-mark', '🙋'),
          el('div.row-body',
            el('p.row-title', task.title),
            el('p.row-note', task.projectTitle)),
          el('span.card-chevron', '›'),
        ))));
      }

      // Найближчі зйомки фірми — щоб було видно, що попереду, а не лише
      // сьогоднішнє. Свої проєкти вже показані вище, тому тут коротко.
      const soon = projects
        .filter((project) => project.shootDays.some((day) => day >= today))
        .slice(0, 3);
      if (soon.length) {
        parts.push(sectionTitle('Проєкти фірми',
          el('button.link', { type: 'button', onclick: () => navigate('/team-projects') }, 'усі')));
        parts.push(el('div.list', soon.map((project) => {
          const next = [...project.shootDays].filter((day) => day >= today).sort()[0];
          return el(
            'article.row',
            { onclick: () => navigate(`/team-projects/${project.id}`) },
            el('span.row-mark', '🎬'),
            el('div.row-body',
              el('p.row-title', project.title),
              el('p.row-note', next ? `Зйомка ${describeDue(next).toLowerCase()}` : project.client)),
            el('span.card-chevron', '›'),
          );
        })));
      }

      if (parts.length) host.replaceChildren(...parts);
      else if (emptyHere) {
        // Своїх справ немає, і у фірмі теж порожньо. Мовчати не можна:
        // людина вирішить, що застосунок не працює.
        host.replaceChildren(emptyState(
          `Поки тихо в «${company.name}»`,
          'Зйомок за тобою ще не закріпили. Щойно керівник опублікує проєкт — він зʼявиться тут.',
        ));
      }
    })
    .catch(() => {
      // Без мережі екран огляду лишається робочим — просто без фірми.
    });

  return host;
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
