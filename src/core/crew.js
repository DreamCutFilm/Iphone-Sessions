// Каталог команди: люди, яких наймаєш на зйомку.
//
// Дві ставки, як і в техніці, але сенс дзеркальний:
//   • fee  — скільки ти ПЛАТИШ людині за зміну (твоя витрата);
//   • rate — скільки ставиш за неї клієнту (твій дохід).
// Різниця між ними — те, що лишається тобі за організацію. Часто вони рівні,
// і це нормально: тоді ти просто передаєш гонорар далі без націнки.

import { newId } from './id.js';

/** Ролі на майданчику. Список — підказка, а не обмеження. */
export const CREW_ROLES = [
  'Оператор',
  'Другий оператор',
  'Оператор камери',
  'Режисер',
  'Режисер трансляції (пульт)',
  'Технічний режисер',
  'Асистент оператора',
  'Фокус-пулер',
  'Монтажер',
  'Колорист',
  'Звукорежисер',
  'Гафер',
  'Освітлювач',
  'Пілот дрона',
  'Стедікам-оператор',
  'Продюсер',
  'Адміністратор',
  'Гример',
  'Стиліст',
];

export function createCrew(input = {}) {
  const now = new Date().toISOString();
  return {
    id: newId('crw'),
    // Імʼя людини. Якщо ще не знаєш, хто саме — лишається порожнім,
    // і позиція працює як роль: «Оператор камери».
    name: text(input.name),
    role: text(input.role) || 'Оператор',
    // Скільки платимо людині за зміну.
    fee: positive(input.fee),
    // Скільки ставимо клієнту. Порожньо — беремо стільки ж, скільки платимо.
    rate: positive(input.rate),
    phone: text(input.phone),
    // Пошта, якою людина заходить у застосунок. Потрібна рівно для одного:
    // звʼязати гонорар у проєкті з її акаунтом, щоб вона побачила саме свій.
    // Без пошти людина в каталозі є, а гонорар для неї — просто рядок.
    email: text(input.email).toLowerCase(),
    notes: text(input.notes),
    archived: Boolean(input.archived),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeCrew(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = createCrew(raw);
  return {
    ...base,
    id: text(raw.id) || base.id,
    createdAt: isoOr(raw.createdAt, base.createdAt),
    updatedAt: isoOr(raw.updatedAt, base.updatedAt),
  };
}

/** Як підписати людину в списках: «Андрій — Оператор» або просто роль. */
export function crewLabel(member) {
  if (!member) return '';
  return member.name ? `${member.name} — ${member.role}` : member.role;
}

/** Ставка для клієнта. Не задана окремо — беремо гонорар без націнки. */
export function clientRate(member) {
  return member.rate ?? member.fee ?? 0;
}

/** Скільки лишається тобі з цієї людини за зміну. */
export function crewMargin(member) {
  return clientRate(member) - (member.fee ?? 0);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positive(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function isoOr(value, fallback) {
  if (typeof value !== 'string' || !value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}
