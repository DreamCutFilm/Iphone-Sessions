// Робота з датами.
//
// Важливо: дати без часу (YYYY-MM-DD) розбираються ВРУЧНУ, а не через new Date(),
// бо new Date('2026-08-10') трактує рядок як UTC і в нашому поясі може дати
// попередній день. Для календаря оператора така помилка неприпустима.

import { t, plural, calendarNames } from './i18n.js';

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' → Date у локальній півночі. */
export function parseDateOnly(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/** Date → 'YYYY-MM-DD' у локальному поясі. */
export function toDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayISO() {
  return toDateOnly(new Date());
}

export function addDays(dateOnlyValue, days) {
  const date = parseDateOnly(dateOnlyValue) ?? new Date();
  date.setDate(date.getDate() + days);
  return toDateOnly(date);
}

/**
 * Усі дати проміжку включно: '2026-08-12' … '2026-08-14' → три дати.
 *
 * Якщо кінець не вказано або він раніший за початок — повертає один день.
 * Обмеження зверху захищає від друкарської помилки в році: інакше замість
 * трьох знімальних днів у проєкт потрапили б тисячі.
 */
export function expandDateRange(from, to, maxDays = 90) {
  const start = parseDateOnly(from);
  if (!start) return [];

  const end = parseDateOnly(to);
  if (!end || end < start) return [toDateOnly(start)];

  const days = [];
  const cursor = new Date(start);
  while (cursor <= end && days.length < maxDays) {
    days.push(toDateOnly(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** Скільки днів лишилось: 0 — сьогодні, відʼємне — прострочено. */
export function daysUntil(dateOnlyValue, from = new Date()) {
  const target = parseDateOnly(dateOnlyValue);
  if (!target) return null;
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((target.getTime() - start.getTime()) / MS_PER_DAY);
}

/** «10 серпня», «10 серпня 2027» якщо рік не поточний. */
export function formatDate(dateOnlyValue) {
  const date = parseDateOnly(dateOnlyValue);
  if (!date) return '';

  // Порядок слів у даті різний: «10 серпня», але «August 10».
  const { months, dateOrder } = calendarNames();
  const month = months[date.getMonth()];
  const base = dateOrder === 'md'
    ? `${month} ${date.getDate()}`
    : `${date.getDate()} ${month}`;

  return date.getFullYear() === new Date().getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

export function weekdayShort(dateOnlyValue) {
  const date = parseDateOnly(dateOnlyValue);
  return date ? calendarNames().weekdays[date.getDay()] : '';
}

/** Людський опис дедлайну: «Сьогодні», «Завтра», «Прострочено на 3 дні». */
export function describeDue(dateOnlyValue) {
  const diff = daysUntil(dateOnlyValue);
  if (diff === null) return '';
  if (diff === 0) return t('Сьогодні');
  if (diff === 1) return t('Завтра');
  if (diff === 2) return t('Післязавтра');
  if (diff === -1) return t('Вчора');
  if (diff < 0) return t('Прострочено на {days}', { days: plural(Math.abs(diff), 'день', 'дні', 'днів') });
  if (diff <= 14) return t('Через {days}', { days: plural(diff, 'день', 'дні', 'днів') });
  return formatDate(dateOnlyValue);
}

// Відмінок числа переїхав до i18n: правило залежить від мови. Ре-експорт
// лишається, бо половина застосунку кличе plural саме звідси.
export { plural };

export function formatTime(date) {
  if (!date) return '';
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

export function formatDateTime(isoValue) {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatDate(toDateOnly(date))}, ${formatTime(date)}`;
}

/** ISO-момент → значення для <input type="datetime-local"> у локальному поясі. */
export function toLocalInputValue(isoValue) {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';
  return `${toDateOnly(date)}T${formatTime(date)}`;
}

/** Значення з <input type="datetime-local"> → ISO-момент. */
export function fromLocalInputValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
