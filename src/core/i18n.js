// Мова інтерфейсу.
//
// Ключ перекладу — сам український рядок, а не вигаданий код на кшталт
// `ideas.empty.title`. Так у коді видно текст, який побачить людина, а не
// шифр, за яким треба лізти у словник; а якщо перекладу немає, застосунок
// показує українською — і ніколи порожнє місце замість слова.
//
// Мова лежить окремо від решти налаштувань і читається без store: її
// питають з найглибших модулів (дати, відмінки), і залежність від сховища
// стану замкнула б їх у кільце.

import { readJson, writeJson } from './storage.js';
import { pl } from './lang/pl.js';
import { en } from './lang/en.js';

const LANG_KEY = 'dreamcut.lang.v1';
const SETTINGS_KEY = 'dreamcut.ops.v1';

export const LANGUAGES = [
  { id: 'uk', native: 'Українська', locale: 'uk-UA' },
  { id: 'pl', native: 'Polski', locale: 'pl-PL' },
  { id: 'en', native: 'English', locale: 'en-GB' },
];

export const DEFAULT_LANGUAGE = 'uk';

// Українська — це не «ще один словник», а сам текст у коді. Тому її тут
// немає: t() для неї просто повертає те, що їй дали.
const DICTIONARIES = { pl, en };

const listeners = new Set();
let current = null;

/** Мова, обрана людиною, або вгадана з телефона. */
export function getLanguage() {
  if (current) return current;

  const stored = readJson(LANG_KEY, null);
  if (typeof stored === 'string' && DICTIONARIES[stored]) {
    current = stored;
    return current;
  }
  if (stored === 'uk') {
    current = 'uk';
    return current;
  }

  // Колись мова жила в налаштуваннях. Забирати вибір у людини через
  // переїзд ключа не можна — тому старе значення підхоплюємо один раз.
  const legacy = readJson(SETTINGS_KEY, null)?.settings?.language;
  current = isKnown(legacy) ? legacy : guessLanguage();
  return current;
}

export function setLanguage(id) {
  const next = isKnown(id) ? id : DEFAULT_LANGUAGE;
  current = next;
  writeJson(LANG_KEY, next);

  for (const listener of listeners) {
    try {
      listener(next);
    } catch (error) {
      console.error('Помилка в підписнику мови:', error);
    }
  }

  return next;
}

export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isKnown(id) {
  return LANGUAGES.some((language) => language.id === id);
}

export function languageInfo(id = getLanguage()) {
  return LANGUAGES.find((language) => language.id === id) ?? LANGUAGES[0];
}

/** Тег локалі для Intl — для чисел і дат. */
export function localeTag() {
  return languageInfo().locale;
}

/**
 * Переклад рядка.
 *
 * `t('Збережено')` — просто текст. `t('{n} збережено', { n: 5 })` — текст із
 * підстановкою: підставляємо ПІСЛЯ пошуку, бо в іншій мові число може стояти
 * в іншому місці речення.
 */
export function t(text, params = null) {
  if (typeof text !== 'string' || !text) return text;

  const dictionary = DICTIONARIES[getLanguage()];
  const translated = dictionary?.strings?.[text] ?? text;

  return params ? fill(translated, params) : translated;
}

function fill(text, params) {
  return text.replace(/\{(\w+)\}/g, (whole, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : whole
  ));
}

/**
 * Число зі словом у потрібній формі: 1 день, 2 дні, 5 днів.
 *
 * Виклик лишається українським — `plural(n, 'день', 'дні', 'днів')`, — а
 * словник шукає ці три форми як один ключ. Так у коді видно живі слова,
 * а не абстрактні one/few/many.
 */
export function plural(count, one, few, many) {
  const language = getLanguage();
  const forms = DICTIONARIES[language]?.plurals?.[`${one}|${few}|${many}`] ?? [one, few, many];
  return `${count} ${pickForm(count, forms, language)}`;
}

/** Саме слово, без числа. */
export function pluralWord(count, one, few, many) {
  const language = getLanguage();
  const forms = DICTIONARIES[language]?.plurals?.[`${one}|${few}|${many}`] ?? [one, few, many];
  return pickForm(count, forms, language);
}

function pickForm(count, forms, language) {
  const [one, few, many] = forms;

  // Англійська: одне або решта. Третьої форми немає, тому many не чіпаємо.
  if (language === 'en') return Math.abs(count) === 1 ? one : few;

  const abs = Math.abs(count) % 100;
  const last = abs % 10;

  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** Назви місяців і днів тижня — для дат. */
export function calendarNames() {
  const dictionary = DICTIONARIES[getLanguage()];
  return {
    months: dictionary?.months ?? UK_MONTHS,
    weekdays: dictionary?.weekdays ?? UK_WEEKDAYS,
    dateOrder: dictionary?.dateOrder ?? 'dm',
  };
}

const UK_MONTHS = [
  'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня',
];

const UK_WEEKDAYS = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function guessLanguage() {
  // Мову телефона питаємо тільки в телефоні. У тестах і в нативній оболонці
  // navigator теж є, але каже своє — і застосунок мовчки заговорив би не тією
  // мовою, якою його писали.
  const tags = typeof window !== 'undefined' && Array.isArray(window.navigator?.languages)
    ? window.navigator.languages
    : [];

  for (const tag of tags) {
    const id = String(tag).slice(0, 2).toLowerCase();
    if (isKnown(id)) return id;
  }

  return DEFAULT_LANGUAGE;
}
