// Кошторис: позиції, знижка, податок, маржа.
//
// Ключове рішення — кошторис має дві сторони одних і тих самих даних:
//   • внутрішня: скільки позиція коштує НАМ (оренда, підряд) і що лишається;
//   • клієнтська: лише те, що клієнт має бачити.
// Тому собівартість лежить у тих самих позиціях, а не в окремому документі —
// інакше два документи неминуче розʼїдуться. Клієнтський вигляд готує
// clientView(), і саме він піде назовні.
//
// Валюта записується в сам кошторис, а не береться з налаштувань під час
// показу: інакше зміна валюти в налаштуваннях заднім числом переписала б
// уже надіслані клієнту суми.

import { newId } from './id.js';
import { DEFAULT_CURRENCY } from './locale.js';

export const ESTIMATE_STATUSES = [
  { id: 'draft', label: 'Чернетка', hint: 'Ще рахуємо' },
  { id: 'sent', label: 'Надіслано', hint: 'У клієнта на розгляді' },
  { id: 'approved', label: 'Погоджено', hint: 'Можна працювати' },
  { id: 'declined', label: 'Відхилено', hint: 'Не склалося' },
];

const STATUS_IDS = ESTIMATE_STATUSES.map((status) => status.id);

export function estimateStatusLabel(id) {
  return ESTIMATE_STATUSES.find((status) => status.id === id)?.label ?? id;
}

/** Розділи кошторису — у тому порядку, в якому їх звично читають. */
export const ITEM_CATEGORIES = [
  { id: 'equipment', label: 'Техніка' },
  { id: 'crew', label: 'Команда' },
  { id: 'logistics', label: 'Логістика' },
  { id: 'post', label: 'Постпродакшн' },
  { id: 'other', label: 'Інше' },
];

const ITEM_CATEGORY_IDS = ITEM_CATEGORIES.map((category) => category.id);

export function itemCategoryLabel(id) {
  return ITEM_CATEGORIES.find((category) => category.id === id)?.label ?? 'Інше';
}

/** Одиниці, в яких рахують позиції кошторису. */
export const UNITS = ['зміна', 'день', 'година', 'шт', 'км', 'послуга'];

// Одиниці часу поводяться інакше за штучні: техніку беруть «2 камери на
// 2 зміни», а не «2 камери × 2 штуки». Від цього залежить, як читається рядок.
const TIME_UNITS = new Set(['зміна', 'день', 'година']);

/** Форми множини: 1 зміна, 2 зміни, 5 змін. */
const UNIT_FORMS = {
  'зміна': ['зміна', 'зміни', 'змін'],
  'день': ['день', 'дні', 'днів'],
  'година': ['година', 'години', 'годин'],
  'послуга': ['послуга', 'послуги', 'послуг'],
  'шт': ['шт', 'шт', 'шт'],
  'км': ['км', 'км', 'км'],
};

/** Одиниця у формі, узгодженій із числом. */
export function unitLabel(unit, count) {
  const forms = UNIT_FORMS[unit];
  if (!forms) return unit;

  const abs = Math.abs(Math.round(count)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

/**
 * Кількість словами: «2 × 2 зміни», «1 зміна», «3 шт».
 * Зайву одиницю не пишемо — рядок «1 × 1 зміна» читається як помилка.
 */
export function describeItemCount(item) {
  const quantity = Number(item.quantity) || 0;
  const shifts = Number(item.shifts) || 0;

  if (!TIME_UNITS.has(item.unit)) {
    const base = `${quantity} ${unitLabel(item.unit, quantity)}`;
    return shifts > 1 ? `${base} × ${shifts}` : base;
  }

  const time = `${shifts} ${unitLabel(item.unit, shifts)}`;
  return quantity === 1 ? time : `${quantity} × ${time}`;
}

// --- Позиція --------------------------------------------------------------

export function createItem(input = {}) {
  return {
    id: newId('itm'),
    title: text(input.title) || 'Позиція',
    category: oneOf(input.category, ITEM_CATEGORY_IDS, 'equipment'),
    // Звідки взяли позицію — щоб потім бачити, яка техніка найходовіша.
    equipmentId: text(input.equipmentId) || null,
    unit: UNITS.includes(input.unit) ? input.unit : 'зміна',
    quantity: amount(input.quantity, 1),
    // Скільки змін працює ця кількість: 2 камери × 3 зміни.
    shifts: amount(input.shifts, 1),
    unitPrice: amount(input.unitPrice, 0),
    // Наша собівартість тієї ж одиниці. Клієнт її не бачить ніколи.
    unitCost: amount(input.unitCost, 0),
    notes: text(input.notes),
  };
}

export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = createItem(raw);
  return { ...base, id: text(raw.id) || base.id };
}

/** Сума позиції для клієнта. */
export function itemAmount(item) {
  return round(item.quantity * item.shifts * item.unitPrice);
}

/** Скільки ця позиція коштує нам. */
export function itemCost(item) {
  return round(item.quantity * item.shifts * item.unitCost);
}

// --- Кошторис -------------------------------------------------------------

export function createEstimate(input = {}) {
  const now = new Date().toISOString();
  return {
    id: newId('est'),
    projectId: text(input.projectId) || null,
    title: text(input.title) || 'Кошторис',
    status: oneOf(input.status, STATUS_IDS, 'draft'),
    currency: text(input.currency) || DEFAULT_CURRENCY,
    items: Array.isArray(input.items) ? input.items.map(normalizeItem).filter(Boolean) : [],
    discountPercent: amount(input.discountPercent, 0),
    // ПДВ або інший податок зверху. Нуль — якщо працюєш без нього.
    taxPercent: amount(input.taxPercent, 0),
    // Нотатка, яку побачить клієнт: умови, що входить у ціну.
    clientNotes: text(input.clientNotes),
    // Внутрішня нотатка. Назовні не йде.
    notes: text(input.notes),
    sentAt: isoOrNull(input.sentAt),
    approvedAt: isoOrNull(input.approvedAt),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeEstimate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = createEstimate(raw);
  return {
    ...base,
    id: text(raw.id) || base.id,
    createdAt: isoOr(raw.createdAt, base.createdAt),
    updatedAt: isoOr(raw.updatedAt, base.updatedAt),
  };
}

/**
 * Підсумки кошторису.
 *
 * Маржа рахується ДО податку: ПДВ — не твої гроші, ти лише передаєш їх далі.
 * Якщо включити його в маржу, прибуток на папері виглядав би більшим, ніж є.
 */
export function estimateTotals(estimate) {
  const items = Array.isArray(estimate?.items) ? estimate.items : [];

  const subtotal = round(items.reduce((sum, item) => sum + itemAmount(item), 0));
  const cost = round(items.reduce((sum, item) => sum + itemCost(item), 0));

  const discountPercent = clampPercent(estimate?.discountPercent);
  const discount = round((subtotal * discountPercent) / 100);
  const afterDiscount = round(subtotal - discount);

  const taxPercent = clampPercent(estimate?.taxPercent);
  const tax = round((afterDiscount * taxPercent) / 100);
  const total = round(afterDiscount + tax);

  const margin = round(afterDiscount - cost);
  const marginPercent = afterDiscount > 0 ? round((margin / afterDiscount) * 100) : 0;

  return { subtotal, discount, afterDiscount, tax, total, cost, margin, marginPercent, itemCount: items.length };
}

/** Підсумки за розділами — так кошторис читають клієнти. */
export function totalsByCategory(estimate) {
  const items = Array.isArray(estimate?.items) ? estimate.items : [];

  return ITEM_CATEGORIES
    .map((category) => {
      const own = items.filter((item) => item.category === category.id);
      return {
        id: category.id,
        label: category.label,
        items: own,
        amount: round(own.reduce((sum, item) => sum + itemAmount(item), 0)),
      };
    })
    .filter((group) => group.items.length > 0);
}

/**
 * Те, що можна показати клієнту: жодного сліду собівартості й маржі.
 * Саме цей обʼєкт піде назовні — коли зʼявиться сервер, він же
 * повертатиметься клієнтському застосунку.
 */
export function clientView(estimate) {
  const totals = estimateTotals(estimate);

  return {
    title: estimate.title,
    status: estimate.status,
    currency: estimate.currency,
    notes: estimate.clientNotes,
    sentAt: estimate.sentAt,
    groups: totalsByCategory(estimate).map((group) => ({
      label: group.label,
      amount: group.amount,
      items: group.items.map((item) => ({
        title: item.title,
        unit: item.unit,
        quantity: item.quantity,
        shifts: item.shifts,
        // Готовий підпис кількості — щоб і текст, і майбутній клієнтський
        // застосунок показували однаково, без власних правил відмінювання.
        count: describeItemCount(item),
        unitPrice: item.unitPrice,
        amount: itemAmount(item),
      })),
    })),
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total,
  };
}

/**
 * Кошторис звичайним текстом — щоб надіслати клієнту в месенджер.
 * Поки немає сервера, це головний спосіб доставки; коли зʼявиться —
 * лишиться як швидкий варіант «просто скинути в чат».
 *
 * Будується з clientView, а не з кошторису напряму: так собівартість
 * фізично не має шляху потрапити в текст.
 */
export function estimateToText(estimate, formatAmount) {
  const view = clientView(estimate);
  const money = (value) => formatAmount(value, view.currency);
  const lines = [];

  lines.push(view.title.toUpperCase());
  lines.push('');

  for (const group of view.groups) {
    lines.push(`— ${group.label} —`);
    for (const item of group.items) {
      lines.push(`${item.title}: ${item.count} × ${money(item.unitPrice)} = ${money(item.amount)}`);
    }
    lines.push('');
  }

  if (view.discount > 0) {
    lines.push(`Сума: ${money(view.subtotal)}`);
    lines.push(`Знижка: −${money(view.discount)}`);
  }
  if (view.tax > 0) lines.push(`Податок: ${money(view.tax)}`);

  lines.push(`РАЗОМ: ${money(view.total)}`);

  if (view.notes) {
    lines.push('');
    lines.push(view.notes);
  }

  return lines.join('\n');
}

/** Позиція кошторису з каталогу техніки — з підставленими цінами. */
export function itemFromEquipment(equipment, { shifts = 1, quantity = 1 } = {}) {
  return createItem({
    title: equipment.title,
    category: 'equipment',
    equipmentId: equipment.id,
    unit: 'зміна',
    quantity,
    shifts,
    unitPrice: equipment.dayRate ?? 0,
    unitCost: equipment.dayCost ?? 0,
  });
}

// --- Допоміжне ------------------------------------------------------------

/** Гроші округлюємо до копійок на кожному кроці, щоб підсумок сходився з рядками. */
function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function amount(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function clampPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 100);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function isoOrNull(value) {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isoOr(value, fallback) {
  return isoOrNull(value) ?? fallback;
}
