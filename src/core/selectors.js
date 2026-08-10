// Похідні вибірки зі стану: що горить, що сьогодні, що далі.
// Чисті функції — приймають стан, повертають дані. Зручно тестувати й переносити.

import { ACTIVE_STATUSES, priorityWeight } from './models.js';
import { daysUntil, todayISO } from './dates.js';

export function activeProjects(state) {
  return state.projects
    .filter((project) => ACTIVE_STATUSES.includes(project.status))
    .sort(byDeadline);
}

export function projectById(state, id) {
  return state.projects.find((project) => project.id === id) ?? null;
}

export function tasksOfProject(state, projectId) {
  return state.tasks.filter((task) => task.projectId === projectId).sort(taskOrder);
}

export function openTasks(state) {
  return state.tasks.filter((task) => !task.done).sort(taskOrder);
}

/** Прострочені задачі — найважливіше, що має бачити оператор першим. */
export function overdueTasks(state) {
  return openTasks(state).filter((task) => task.due && daysUntil(task.due) < 0);
}

export function todayTasks(state) {
  const today = todayISO();
  return openTasks(state).filter((task) => task.due === today);
}

/** Задачі на найближчі N днів (без сьогоднішніх і прострочених). */
export function upcomingTasks(state, days = 7) {
  return openTasks(state).filter((task) => {
    if (!task.due) return false;
    const diff = daysUntil(task.due);
    return diff > 0 && diff <= days;
  });
}

export function somedayTasks(state) {
  return openTasks(state).filter((task) => !task.due);
}

/**
 * Зведений календар дедлайнів: здача проєктів + знімальні дні + задачі з датою.
 * Повертає масив, згрупований за датою, відсортований від найближчого.
 */
export function deadlineAgenda(state, { days = 60 } = {}) {
  const buckets = new Map();

  const push = (date, entry) => {
    if (!date) return;
    const diff = daysUntil(date);
    if (diff === null || diff > days) return;
    if (!buckets.has(date)) buckets.set(date, { date, diff, entries: [] });
    buckets.get(date).entries.push(entry);
  };

  for (const project of state.projects) {
    if (project.status === 'archived') continue;
    push(project.deadline, { kind: 'deadline', title: project.title, project });
    for (const day of project.shootDays) {
      push(day, { kind: 'shoot', title: project.title, project });
    }
  }

  for (const task of state.tasks) {
    if (task.done || !task.due) continue;
    push(task.due, { kind: 'task', title: task.title, task, project: projectById(state, task.projectId) });
  }

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Нагадування, час яких настав, а користувача ще не повідомили. */
export function dueReminders(state, now = new Date()) {
  return state.tasks.filter((task) => {
    if (task.done || !task.remindAt || task.remindedAt) return false;
    return new Date(task.remindAt).getTime() <= now.getTime();
  });
}

/** Найближчі майбутні нагадування — для екрана огляду. */
export function upcomingReminders(state, now = new Date()) {
  return state.tasks
    .filter((task) => !task.done && task.remindAt && new Date(task.remindAt).getTime() > now.getTime())
    .sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt));
}

export function starredIdeas(state) {
  return state.ideas.filter((idea) => idea.starred);
}

export function allTags(state) {
  const tags = new Set();
  for (const idea of state.ideas) for (const tag of idea.tags) tags.add(tag);
  return [...tags].sort((a, b) => a.localeCompare(b, 'uk'));
}

/** Скільки не закрито грошей — корисно тримати перед очима. */
export function unpaidTotal(state) {
  return state.projects
    .filter((project) => !project.paid && typeof project.fee === 'number' && project.status !== 'archived')
    .reduce((sum, project) => sum + project.fee, 0);
}

// --- Порядок сортування ---------------------------------------------------

/** Спершу термінові, потім за датою, задачі без дати — в кінці. */
export function taskOrder(a, b) {
  const priorityDiff = priorityWeight(a.priority) - priorityWeight(b.priority);
  if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
  if (a.due && !b.due) return -1;
  if (!a.due && b.due) return 1;
  if (priorityDiff !== 0) return priorityDiff;
  return b.createdAt.localeCompare(a.createdAt);
}

function byDeadline(a, b) {
  if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
  if (a.deadline) return -1;
  if (b.deadline) return 1;
  return b.createdAt.localeCompare(a.createdAt);
}
