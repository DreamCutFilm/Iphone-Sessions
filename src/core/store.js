// Єдине джерело правди для всього застосунку.
//
// Стан тримається в памʼяті, пишеться на диск із затримкою (щоб набір тексту
// не смикав сховище на кожну літеру) і сповіщає підписників про зміни.
// Модуль не знає про DOM — його можна запустити в нативній оболонці чи в тестах.

import { readJson, writeJson } from './storage.js';
import { normalizeIdea, normalizeProject, normalizeTask } from './models.js';
import { normalizeEquipment } from './equipment.js';
import { normalizeEstimate } from './estimates.js';
import { DEFAULT_CURRENCY, DEFAULT_LANGUAGE } from './locale.js';

const STORAGE_KEY = 'dreamcut.ops.v1';
const SAVE_DELAY_MS = 250;
const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = {
  // Мова інтерфейсу. Вибір зберігається навіть для мов, переклад яких ще
  // не готовий, — щоб не питати вдруге, коли тексти зʼявляться.
  language: DEFAULT_LANGUAGE,
  // Валюта гонорарів. Впливає лише на показ, суми не перераховуються.
  currency: DEFAULT_CURRENCY,

  // Значення за замовчуванням для калькуляторів — щоб не вводити щоразу.
  sensorId: 's35',
  codecId: 'prores422hq-1080',
  fps: 25,
  // Координати для розрахунку золотої години. Заповнюються з геолокації або вручну.
  latitude: null,
  longitude: null,
  locationLabel: '',
};

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    projects: [],
    tasks: [],
    ideas: [],
    equipment: [],
    estimates: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

function loadState() {
  const raw = readJson(STORAGE_KEY, null);
  if (!raw || typeof raw !== 'object') return emptyState();

  return {
    version: SCHEMA_VERSION,
    projects: toList(raw.projects, normalizeProject),
    tasks: toList(raw.tasks, normalizeTask),
    ideas: toList(raw.ideas, normalizeIdea),
    // Колекції, яких не було в ранніх версіях, просто зʼявляються порожніми —
    // старе сховище через це не ламається.
    equipment: toList(raw.equipment, normalizeEquipment),
    estimates: toList(raw.estimates, normalizeEstimate),
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
  };
}

function toList(value, normalize) {
  if (!Array.isArray(value)) return [];
  return value.map(normalize).filter(Boolean);
}

let state = loadState();
const listeners = new Set();
let saveTimer = null;

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Єдиний спосіб змінити стан. Мутація застосовується до чернетки, після чого
 * стан замінюється новим обʼєктом — підписники завжди бачать цілісну картину.
 */
export function update(mutator) {
  const draft = {
    ...state,
    projects: [...state.projects],
    tasks: [...state.tasks],
    ideas: [...state.ideas],
    equipment: [...state.equipment],
    estimates: [...state.estimates],
    settings: { ...state.settings },
  };
  const result = mutator(draft);
  state = result ?? draft;
  scheduleSave();
  notify();
  return state;
}

/** Замінює весь стан цілком — використовується при імпорті резервної копії. */
export function replaceState(next) {
  state = {
    version: SCHEMA_VERSION,
    projects: toList(next.projects, normalizeProject),
    tasks: toList(next.tasks, normalizeTask),
    ideas: toList(next.ideas, normalizeIdea),
    equipment: toList(next.equipment, normalizeEquipment),
    estimates: toList(next.estimates, normalizeEstimate),
    settings: { ...DEFAULT_SETTINGS, ...(next.settings ?? {}) },
  };
  saveNow();
  notify();
  return state;
}

function notify() {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (error) {
      console.error('Помилка в підписнику стану:', error);
    }
  }
}

function scheduleSave() {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

export function saveNow() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  writeJson(STORAGE_KEY, state);
}

// --- Операції над колекціями ---------------------------------------------

const COLLECTIONS = {
  projects: 'projects',
  tasks: 'tasks',
  ideas: 'ideas',
  equipment: 'equipment',
  estimates: 'estimates',
};

export function addItem(collection, item) {
  assertCollection(collection);
  update((draft) => {
    draft[collection] = [item, ...draft[collection]];
  });
  return item;
}

export function patchItem(collection, id, changes) {
  assertCollection(collection);
  update((draft) => {
    draft[collection] = draft[collection].map((item) =>
      item.id === id ? { ...item, ...changes, updatedAt: new Date().toISOString() } : item,
    );
  });
}

export function removeItem(collection, id) {
  assertCollection(collection);
  update((draft) => {
    draft[collection] = draft[collection].filter((item) => item.id !== id);
    // Записи не повинні посилатися на видалений проєкт.
    if (collection === 'projects') {
      draft.tasks = draft.tasks.map((task) => (task.projectId === id ? { ...task, projectId: null } : task));
      draft.ideas = draft.ideas.map((idea) => (idea.projectId === id ? { ...idea, projectId: null } : idea));
      draft.estimates = draft.estimates.map((estimate) =>
        estimate.projectId === id ? { ...estimate, projectId: null } : estimate);
    }

    // Позиції кошторисів памʼятають, з якої техніки їх додали. Саму позицію
    // зберігаємо — ціна вже зафіксована й переписувати кошторис заднім числом
    // не можна, — але посилання на видалений запис прибираємо.
    if (collection === 'equipment') {
      draft.estimates = draft.estimates.map((estimate) => ({
        ...estimate,
        items: estimate.items.map((item) => (item.equipmentId === id ? { ...item, equipmentId: null } : item)),
      }));
    }
  });
}

export function findItem(collection, id) {
  assertCollection(collection);
  return state[collection].find((item) => item.id === id) ?? null;
}

export function patchSettings(changes) {
  update((draft) => {
    draft.settings = { ...draft.settings, ...changes };
  });
}

function assertCollection(collection) {
  if (!COLLECTIONS[collection]) throw new Error(`Невідома колекція: ${collection}`);
}
