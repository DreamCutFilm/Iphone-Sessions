// Екран огляду — те, що оператор бачить, відкривши застосунок на бігу.
// Спочатку прострочене, потім сьогоднішнє, потім найближчі дні.

import { el, emptyState } from '../dom.js';
import { pageHeader, sectionTitle, taskRow, statTile, agendaDay, fab, formatMoney } from '../components.js';
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
