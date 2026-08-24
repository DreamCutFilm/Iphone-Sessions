// Ренталами. Хто здає техніку, за скільки і де її забирати.
//
// Це не той самий каталог, що «Техніка». Там — те, що є в тебе на руках;
// тут — чуже, що можна взяти, коли свого не вистачає. Різниця не формальна:
// у власній техніці головне питання «скільки я на цьому заробляю», а в
// чужій — «скільки це коштуватиме і чи встигну доїхати».
//
// Наступним кроком ренталу дадуть увійти сюди самому й вести свій прайс, —
// тому позиції вже зараз лежать окремим списком усередині ренталу, а не
// звалені в одну купу з власною технікою.

import { newId } from './id.js';
import { EQUIPMENT_CATEGORIES, categoryLabel } from './equipment.js';

export { EQUIPMENT_CATEGORIES as RENTAL_CATEGORIES, categoryLabel as rentalCategoryLabel };

export function createRental(input = {}) {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name: input.name?.trim() || 'Без назви',
    phone: input.phone?.trim() || '',
    site: input.site?.trim() || '',
    location: input.location?.trim() || '',
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    notes: input.notes?.trim() || '',
    items: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createRentalItem(input = {}) {
  return {
    id: newId(),
    title: input.title?.trim() || 'Без назви',
    category: input.category || 'camera',
    // Ціна за зміну — так само, як у власному каталозі: єдина одиниця,
    // у якій рахують оренду, і зводити її з чимось іншим не доводиться.
    price: toMoney(input.price),
    notes: input.notes?.trim() || '',
  };
}

export function normalizeRental(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const base = createRental(raw);
  return {
    ...base,
    id: raw.id ?? base.id,
    createdAt: raw.createdAt ?? base.createdAt,
    updatedAt: raw.updatedAt ?? base.updatedAt,
    latitude: Number.isFinite(Number(raw.latitude)) ? Number(raw.latitude) : null,
    longitude: Number.isFinite(Number(raw.longitude)) ? Number(raw.longitude) : null,
    items: Array.isArray(raw.items)
      ? raw.items.map(normalizeRentalItem).filter(Boolean)
      : [],
  };
}

function normalizeRentalItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = createRentalItem(raw);
  return { ...base, id: raw.id ?? base.id };
}

/** Що є в ренталі, згруповане за розділами — так його читають на майданчику. */
export function rentalGroups(rental) {
  const groups = [];

  for (const category of EQUIPMENT_CATEGORIES) {
    const items = (rental.items ?? []).filter((item) => item.category === category.id);
    if (items.length) groups.push({ ...category, items });
  }

  const known = new Set(EQUIPMENT_CATEGORIES.map((category) => category.id));
  const rest = (rental.items ?? []).filter((item) => !known.has(item.category));
  if (rest.length) groups.push({ id: 'other', label: 'Інше', items: rest });

  return groups;
}

/**
 * Найдешевша й найдорожча позиція — щоб у списку ренталів було видно рівень цін.
 * Порожній рентал повертає null: «від 0 ₴» читалося б як обіцянка безкоштовного.
 */
export function priceRange(rental) {
  const prices = (rental.items ?? []).map((item) => item.price).filter((price) => price > 0);
  if (!prices.length) return null;
  return { from: Math.min(...prices), to: Math.max(...prices) };
}

function toMoney(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
}
