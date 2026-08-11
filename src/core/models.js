// Доменні моделі: проєкти, задачі, ідеї.
//
// Кожна модель має фабрику (створення) і нормалізатор (безпечне читання з диска
// чи з імпортованого файлу, де дані можуть бути пошкоджені або застарілі).

import { newId } from './id.js';

export const PROJECT_STATUSES = [
  { id: 'lead', label: 'Заявка', hint: 'Клієнт написав, ще домовляємось' },
  { id: 'prep', label: 'Підготовка', hint: 'Препрод, локації, техніка' },
  { id: 'shoot', label: 'Зйомка', hint: 'Знімальні дні' },
  { id: 'post', label: 'Пост', hint: 'Монтаж, колор, звук' },
  { id: 'done', label: 'Здано', hint: 'Матеріал у клієнта' },
  { id: 'archived', label: 'Архів', hint: 'Прибрано з активних' },
];

/**
 * Тип зйомки. Список — це підказка, а не обмеження: поле зберігає звичайний
 * рядок, тож будь-який свій варіант рівноправний із готовими.
 */
export const PROJECT_STYLES = [
  'Однокамерна зйомка',
  'Багатокамерна зйомка',
  'Онлайн-трансляція',
  'Музичний кліп',
  'Реклама',
  'Подкаст',
  'Репортаж',
  'Весілля',
  'Документальне',
  'Інтервʼю',
  'Предметна зйомка',
  'Аерозйомка',
];

export const PRIORITIES = [
  { id: 'high', label: 'Терміново', weight: 0 },
  { id: 'normal', label: 'Звичайно', weight: 1 },
  { id: 'low', label: 'Колись', weight: 2 },
];

export const ACTIVE_STATUSES = ['lead', 'prep', 'shoot', 'post'];

const PROJECT_STATUS_IDS = PROJECT_STATUSES.map((status) => status.id);
const PRIORITY_IDS = PRIORITIES.map((priority) => priority.id);

export function statusLabel(id) {
  return PROJECT_STATUSES.find((status) => status.id === id)?.label ?? id;
}

export function priorityLabel(id) {
  return PRIORITIES.find((priority) => priority.id === id)?.label ?? id;
}

export function priorityWeight(id) {
  return PRIORITIES.find((priority) => priority.id === id)?.weight ?? 1;
}

// --- Проєкт ---------------------------------------------------------------

export function createProject(input = {}) {
  const now = new Date().toISOString();
  return {
    id: newId('prj'),
    title: text(input.title) || 'Без назви',
    client: text(input.client),
    // Тип зйомки: довільний рядок, підказки — у PROJECT_STYLES.
    style: text(input.style),
    status: oneOf(input.status, PROJECT_STATUS_IDS, 'lead'),
    // Дата здачі матеріалу клієнту — саме вона рахується як дедлайн проєкту.
    deadline: dateOnly(input.deadline),
    // Знімальні дні: масив дат у форматі YYYY-MM-DD.
    shootDays: Array.isArray(input.shootDays) ? input.shootDays.map(dateOnly).filter(Boolean) : [],
    location: text(input.location),
    // Координати локації, якщо місце позначили на карті. Живуть поруч із
    // текстовою адресою, а не замість неї: на майданчику стають у пригоді
    // обидва — і назва павільйону, і точка для навігації.
    latitude: coordinate(input.latitude, 90),
    longitude: coordinate(input.longitude, 180),
    fee: number(input.fee),
    paid: Boolean(input.paid),
    notes: text(input.notes),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeProject(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = createProject(raw);
  return {
    ...base,
    id: text(raw.id) || base.id,
    createdAt: isoOr(raw.createdAt, base.createdAt),
    updatedAt: isoOr(raw.updatedAt, base.updatedAt),
  };
}

// --- Задача ---------------------------------------------------------------

export function createTask(input = {}) {
  const now = new Date().toISOString();
  return {
    id: newId('tsk'),
    title: text(input.title) || 'Без назви',
    projectId: text(input.projectId) || null,
    due: dateOnly(input.due),
    // Момент нагадування (повна дата з часом). Якщо порожньо — нагадування нема.
    remindAt: isoOrNull(input.remindAt),
    // Позначка, що про це нагадування вже повідомили, щоб не смикати повторно.
    remindedAt: isoOrNull(input.remindedAt),
    priority: oneOf(input.priority, PRIORITY_IDS, 'normal'),
    done: Boolean(input.done),
    doneAt: isoOrNull(input.doneAt),
    notes: text(input.notes),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = createTask(raw);
  return {
    ...base,
    id: text(raw.id) || base.id,
    createdAt: isoOr(raw.createdAt, base.createdAt),
    updatedAt: isoOr(raw.updatedAt, base.updatedAt),
  };
}

// --- Ідея -----------------------------------------------------------------

export function createIdea(input = {}) {
  const now = new Date().toISOString();
  return {
    id: newId('idea'),
    title: text(input.title) || 'Без назви',
    body: text(input.body),
    tags: Array.isArray(input.tags) ? input.tags.map(text).filter(Boolean) : [],
    projectId: text(input.projectId) || null,
    starred: Boolean(input.starred),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeIdea(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = createIdea(raw);
  return {
    ...base,
    id: text(raw.id) || base.id,
    createdAt: isoOr(raw.createdAt, base.createdAt),
    updatedAt: isoOr(raw.updatedAt, base.updatedAt),
  };
}

// --- Допоміжні перевірки --------------------------------------------------

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Координата в допустимих межах, інакше null — щоб зіпсована точка не «летіла» на карті. */
function coordinate(value, limit) {
  const parsed = number(value);
  if (parsed === null || Math.abs(parsed) > limit) return null;
  return parsed;
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** Дата без часу у форматі YYYY-MM-DD, або null. */
function dateOnly(value) {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : null;
}

function isoOrNull(value) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isoOr(value, fallback) {
  return isoOrNull(value) ?? fallback;
}
