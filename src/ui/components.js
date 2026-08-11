// Спільні блоки інтерфейсу, які повторюються на кількох екранах.

import { el, haptic } from './dom.js';
import { navigate } from './router.js';
import { patchItem, getState } from '../core/store.js';
import { formatMoney as formatMoneyIn } from '../core/locale.js';
import { describeDue, daysUntil, formatDate, weekdayShort, formatDateTime } from '../core/dates.js';
import { statusLabel } from '../core/models.js';

export function pageHeader(title, { subtitle = null, action = null, back = null } = {}) {
  return el(
    'header.page-header',
    back && el('button.icon-btn.icon-btn--back', { type: 'button', onclick: () => navigate(back) }, '‹'),
    el('div.page-header-text', el('h1.page-title', title), subtitle && el('p.page-subtitle', subtitle)),
    action,
  );
}

export function sectionTitle(text, right = null) {
  return el('div.section-title', el('span', text), right);
}

export function chip(text, variant = '') {
  return el(`span.chip${variant ? `.chip--${variant}` : ''}`, text);
}

/** Колір позначки дедлайну: прострочено — червоний, сьогодні-завтра — жовтий. */
export function dueVariant(dateOnlyValue) {
  const diff = daysUntil(dateOnlyValue);
  if (diff === null) return '';
  if (diff < 0) return 'danger';
  if (diff <= 1) return 'warn';
  if (diff <= 3) return 'soon';
  return '';
}

/** Рядок задачі з великою зоною натискання для позначки «зроблено». */
export function taskRow(task, { project = null, onEdit = null } = {}) {
  const toggle = el('button.task-check', {
    type: 'button',
    'aria-label': task.done ? 'Повернути в роботу' : 'Позначити виконаною',
    class: task.done ? 'is-done' : '',
    onclick: (event) => {
      event.stopPropagation();
      haptic();
      patchItem('tasks', task.id, {
        done: !task.done,
        doneAt: task.done ? null : new Date().toISOString(),
      });
    },
  }, task.done ? '✓' : '');

  const meta = [];
  if (task.due) meta.push(chip(describeDue(task.due), dueVariant(task.due)));
  if (task.priority === 'high' && !task.done) meta.push(chip('Терміново', 'danger'));
  if (task.remindAt && !task.done) meta.push(chip(`🔔 ${formatDateTime(task.remindAt)}`));
  if (project) meta.push(chip(project.title));

  return el(
    'article.row.task-row',
    { class: task.done ? 'is-done' : '', onclick: onEdit ? () => onEdit(task) : null },
    toggle,
    el(
      'div.row-body',
      el('p.row-title', task.title),
      task.notes && el('p.row-note', task.notes),
      meta.length ? el('div.row-meta', meta) : null,
    ),
  );
}

export function projectCard(project, { taskCount = 0, openCount = 0 } = {}) {
  const meta = [chip(statusLabel(project.status), `status-${project.status}`)];
  if (project.style) meta.push(chip(project.style, 'project'));
  if (project.deadline) meta.push(chip(`⚑ ${describeDue(project.deadline)}`, dueVariant(project.deadline)));
  if (project.shootDays.length) meta.push(chip(`🎥 ${project.shootDays.length}`));
  if (openCount) meta.push(chip(`✓ ${openCount} з ${taskCount}`));
  if (typeof project.fee === 'number' && !project.paid) meta.push(chip(`${formatMoney(project.fee)}`, 'money'));

  return el(
    'article.card.project-card',
    { onclick: () => navigate(`/projects/${project.id}`) },
    el(
      'div.card-body',
      el('p.card-title', project.title),
      project.client && el('p.card-sub', project.client),
      el('div.row-meta', meta),
    ),
    el('span.card-chevron', '›'),
  );
}

/** Один день у стрічці дедлайнів. */
export function agendaDay(day) {
  const diff = daysUntil(day.date);
  const label = diff === 0 ? 'Сьогодні' : diff === 1 ? 'Завтра' : `${formatDate(day.date)}, ${weekdayShort(day.date)}`;

  const entries = day.entries.map((entry) => {
    const marks = { shoot: '🎥', deadline: '⚑', task: '✓' };
    const kinds = { shoot: 'Знімальний день', deadline: 'Здача', task: 'Задача' };
    return el(
      'div.agenda-entry',
      { onclick: entry.project ? () => navigate(`/projects/${entry.project.id}`) : null },
      el('span.agenda-mark', marks[entry.kind]),
      el(
        'div.agenda-text',
        el('p.agenda-title', entry.title),
        el('p.agenda-kind', entry.kind === 'task' && entry.project ? `${kinds[entry.kind]} · ${entry.project.title}` : kinds[entry.kind]),
      ),
    );
  });

  return el(
    'section.agenda-day',
    { class: diff < 0 ? 'is-overdue' : diff <= 1 ? 'is-near' : '' },
    el('h3.agenda-date', label),
    el('div.agenda-entries', entries),
  );
}

/** Сума у валюті, обраній у налаштуваннях. */
export function formatMoney(value) {
  return formatMoneyIn(value, getState().settings.currency);
}

/** Плаваюча кнопка додавання в правому нижньому куті. */
export function fab(label, onClick) {
  return el('button.fab', { type: 'button', 'aria-label': label, onclick: onClick }, '+');
}

export function statTile(value, label, variant = '') {
  return el(`div.stat${variant ? `.stat--${variant}` : ''}`, el('p.stat-value', value), el('p.stat-label', label));
}
