// Памʼять про те, що вже приходило з мережі.
//
// Застосунок задумувався як такий, що працює завжди — і в підвалі, і в машині,
// і в павільйоні без звʼязку. Дані фірми живуть на сервері, тож без мережі їх
// не дістати. Але «не дістати щойно» не означає «показати порожній екран»:
// що бачив учора, те можна показати й сьогодні.
//
// Головне правило тут — ніколи не видавати старе за свіже. Разом зі значенням
// зберігається момент, коли його отримали, і екран каже про це прямо:
// «дані станом на 14:30». Мовчазно старі числа гірші за їх відсутність:
// за ними виїжджають на зйомку.

import { readJson, writeJson, removeKey } from './storage.js';
import { t } from './i18n.js';

const PREFIX = 'dreamcut.cache.';

/** Скільки часу памʼять вважається придатною до показу. Далі — теж покажемо,
 *  але вже як явно застарілу. Тиждень — бо проєкт живе тижнями. */
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function remember(key, value) {
  try {
    writeJson(`${PREFIX}${key}`, { at: Date.now(), value });
  } catch {
    // Сховище переповнене — це прикро, але не привід валити запит,
    // який щойно успішно виконався.
  }
}

export function recall(key) {
  const stored = readJson(`${PREFIX}${key}`, null);
  if (!stored || typeof stored !== 'object' || !('value' in stored)) return null;
  return { value: stored.value, at: Number(stored.at) || 0 };
}

export function forget(key) {
  removeKey(`${PREFIX}${key}`);
}

/**
 * Виконати запит, а якщо мережі немає — віддати те, що памʼятаємо.
 *
 * Повертає завжди однакову форму, і в ній є `fresh`. Екран зобовʼязаний із нею
 * рахуватися: саме на цьому тримається обіцянка не видавати старе за свіже.
 */
export async function withMemory(key, load) {
  try {
    const value = await load();
    remember(key, value);
    return { value, at: Date.now(), fresh: true };
  } catch (error) {
    const stored = recall(key);
    // Нічого не памʼятаємо — тоді помилка є помилкою, і ховати її нема сенсу.
    if (!stored) throw error;
    return { value: stored.value, at: stored.at, fresh: false, error };
  }
}

/** Наскільки давні дані: «щойно», «о 14:30», «17 серпня». */
export function describeAge(at, now = Date.now()) {
  if (!at) return '';

  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 2) return 'щойно';
  if (minutes < 60) return t('{minutes} хв тому', { minutes });

  const date = new Date(at);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  const sameDay = new Date(now).toDateString() === date.toDateString();
  if (sameDay) return t('о {time}', { time });

  const months = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
    'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  return `${date.getDate()} ${months[date.getMonth()]}, ${time}`;
}

export function isStale(at, now = Date.now()) {
  return !at || now - at > STALE_AFTER_MS;
}
