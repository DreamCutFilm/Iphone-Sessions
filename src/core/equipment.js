// Каталог техніки з цінами оренди.
//
// Ціна зберігається за одну зміну — саме так рахують оренду на майданчику.
// Окремо тримаємо, чия техніка: своя приносить дохід, орендована — це витрата,
// і в кошторисі вони поводяться по-різному.

import { newId } from './id.js';

export const EQUIPMENT_CATEGORIES = [
  { id: 'camera', label: 'Камери' },
  { id: 'lens', label: 'Оптика' },
  { id: 'light', label: 'Світло' },
  { id: 'grip', label: 'Грип і механіка' },
  { id: 'audio', label: 'Звук' },
  { id: 'power', label: 'Живлення' },
  { id: 'media', label: 'Носії та дані' },
  { id: 'other', label: 'Інше' },
];

const CATEGORY_IDS = EQUIPMENT_CATEGORIES.map((category) => category.id);

export function categoryLabel(id) {
  return EQUIPMENT_CATEGORIES.find((category) => category.id === id)?.label ?? 'Інше';
}

/** Чия техніка. Своя — це дохід, орендована — витрата, яку треба відбити. */
export const OWNERSHIP = [
  { id: 'own', label: 'Своя' },
  { id: 'rented', label: 'Орендую' },
];

const OWNERSHIP_IDS = OWNERSHIP.map((item) => item.id);

/** Підказки назв, щоб не набирати руками. Ціни в кожного свої, тому їх тут немає. */
export const EQUIPMENT_PRESETS = {
  camera: ['Sony FX6', 'Sony FX3', 'Canon C70', 'Blackmagic 6K', 'RED Komodo', 'ARRI Alexa Mini'],
  lens: ['Набір праймів', 'Sigma 24-70', 'Canon 70-200', 'Laowa Probe', 'Анаморф'],
  light: ['Aputure 600d', 'Aputure 300x', 'Nanlite Forza', 'Astera Titan', 'Софтбокс', 'Ліхтар-панель'],
  grip: ['Слайдер', 'Штатив', 'Стедікам', 'Кран', 'Монопод', 'Ронін RS3', 'Стійки'],
  audio: ['Петличка Rode', 'Гармата Sennheiser', 'Рекордер Zoom', 'Мікшер', 'Радіосистема'],
  power: ['V-mount акумулятор', 'Генератор', 'Подовжувачі', 'Зарядна станція'],
  media: ['CFexpress 512 ГБ', 'SSD 2 ТБ', 'Кардридер', 'Ноутбук для бекапу'],
  other: ['Дим-машина', 'Дрон', 'Транспорт', 'Реквізит'],
};

export function createEquipment(input = {}) {
  const now = new Date().toISOString();
  return {
    id: newId('eqp'),
    title: text(input.title) || 'Без назви',
    category: oneOf(input.category, CATEGORY_IDS, 'other'),
    ownership: oneOf(input.ownership, OWNERSHIP_IDS, 'own'),
    // Скільки беремо з клієнта за одну зміну.
    dayRate: positive(input.dayRate),
    // Скільки коштує нам самим: оренда в іншого рентала або амортизація.
    dayCost: positive(input.dayCost),
    notes: text(input.notes),
    archived: Boolean(input.archived),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeEquipment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = createEquipment(raw);
  return {
    ...base,
    id: text(raw.id) || base.id,
    createdAt: isoOr(raw.createdAt, base.createdAt),
    updatedAt: isoOr(raw.updatedAt, base.updatedAt),
  };
}

/** Скільки заробляємо на одиниці за зміну. Для орендованої це націнка. */
export function unitMargin(equipment) {
  const rate = equipment.dayRate ?? 0;
  const cost = equipment.dayCost ?? 0;
  return rate - cost;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positive(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function isoOr(value, fallback) {
  if (typeof value !== 'string' || !value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}
