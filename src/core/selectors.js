// Похідні вибірки зі стану: що горить, що сьогодні, що далі.
// Чисті функції — приймають стан, повертають дані. Зручно тестувати й переносити.

import { ACTIVE_STATUSES, priorityWeight } from './models.js';
import { daysUntil, todayISO } from './dates.js';
import { crewPayouts, costByPurpose, estimateTotals } from './estimates.js';

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

export function estimatesOfProject(state, projectId) {
  return state.estimates
    .filter((estimate) => estimate.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Гонорари команди по всьому проєкту: зведення з усіх його кошторисів.
 *
 * Це не окремий список, який довелося б вести паралельно, а погляд на ті самі
 * позиції кошторису під іншим кутом — скільки ти маєш виплатити людям.
 * Тому суми тут не можуть розійтися з кошторисом за визначенням.
 */
export function projectPayouts(state, projectId) {
  const estimates = estimatesOfProject(state, projectId);
  const byPerson = new Map();
  let total = 0;

  for (const estimate of estimates) {
    for (const entry of crewPayouts(estimate)) {
      total += entry.payout;

      // Одну людину могли внести в кілька кошторисів — зводимо в один рядок.
      // Позиції без привʼязки до каталогу групуються за назвою.
      const key = entry.crewId ?? `title:${entry.title}`;
      const existing = byPerson.get(key);

      if (existing) {
        existing.payout += entry.payout;
        existing.lines.push({ estimate, entry });
      } else {
        byPerson.set(key, {
          key,
          crewId: entry.crewId,
          title: entry.title,
          payout: entry.payout,
          currency: estimate.currency,
          lines: [{ estimate, entry }],
        });
      }
    }
  }

  return {
    people: [...byPerson.values()].sort((a, b) => b.payout - a.payout),
    total: Math.round(total * 100) / 100,
    currency: estimates[0]?.currency ?? state.settings.currency,
  };
}

/**
 * Кошториси, за якими рахуються гроші проєкту.
 *
 * Береться найпізніша стадія, яка є: погоджені важать більше за надіслані,
 * надіслані — за чернетки. Інакше два варіанти ціни, що лежать поруч,
 * склалися б і показали дохід удвічі більший за справжній.
 * Відхилені не рахуються ніколи.
 */
export function billingEstimates(state, projectId) {
  const all = estimatesOfProject(state, projectId).filter((estimate) => estimate.status !== 'declined');

  for (const stage of ['approved', 'sent', 'draft']) {
    const found = all.filter((estimate) => estimate.status === stage);
    if (found.length) return { estimates: found, basis: stage };
  }
  return { estimates: [], basis: null };
}

const BASIS_LABELS = {
  approved: 'за погодженим кошторисом',
  sent: 'за надісланим кошторисом',
  draft: 'за чернеткою кошторису',
};

/**
 * Гроші проєкту: скільки платить клієнт, скільки з цього піде на оренду
 * й гонорари, і що лишиться тобі.
 */
export function projectFinance(state, projectId) {
  const project = projectById(state, projectId);
  const { estimates, basis } = billingEstimates(state, projectId);

  let income = 0;
  let rental = 0;
  let payouts = 0;
  let other = 0;

  for (const estimate of estimates) {
    const totals = estimateTotals(estimate);
    const costs = costByPurpose(estimate);

    // Дохід рахуємо БЕЗ податку: ПДВ ти лише передаєш далі, він ніколи
    // не був твоїми грішми й у заробіток потрапляти не має.
    income += totals.afterDiscount;
    rental += costs.rental;
    payouts += costs.payouts;
    other += costs.other;
  }

  // Кошторисів ще немає — спираємось на гонорар, вписаний у сам проєкт.
  const fallbackIncome = estimates.length === 0 && typeof project?.fee === 'number' ? project.fee : 0;
  const totalIncome = round(income || fallbackIncome);
  const expenses = round(rental + payouts + other);
  const profit = round(totalIncome - expenses);

  return {
    income: totalIncome,
    rental: round(rental),
    payouts: round(payouts),
    other: round(other),
    expenses,
    profit,
    marginPercent: totalIncome > 0 ? round((profit / totalIncome) * 100) : 0,
    basis,
    basisLabel: basis ? BASIS_LABELS[basis] : (fallbackIncome ? 'за гонораром проєкту' : ''),
    estimateCount: estimates.length,
    currency: estimates[0]?.currency ?? state.settings.currency,
  };
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
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
