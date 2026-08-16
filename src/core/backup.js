// Експорт та імпорт даних.
//
// Дані живуть у сховищі браузера, і воно не вічне: очищення Safari, зміна
// телефона, переустановка — усе це стирає базу. Тому резервна копія у вигляді
// звичайного JSON-файлу є частиною застосунку, а не приємним доповненням.
// Цей же формат читатиме майбутня нативна версія.

import { getState, replaceState } from './store.js';
import { toDateOnly } from './dates.js';

// Позначка формату навмисно лишається старою, попри перейменування застосунку:
// вона записана всередині вже зроблених резервних копій, і зміна зробила б
// їх нечитабельними. Це службовий ідентифікатор, користувач його не бачить.
export const BACKUP_FORMAT = 'dreamcut-ops-backup';
export const BACKUP_VERSION = 1;

export function buildBackup() {
  const state = getState();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    projects: state.projects,
    tasks: state.tasks,
    ideas: state.ideas,
    equipment: state.equipment,
    crew: state.crew,
    estimates: state.estimates,
    settings: state.settings,
  };
}

export function backupFileName() {
  return `dreamcut-app-${toDateOnly(new Date())}.json`;
}

/**
 * Розбирає вміст файлу резервної копії.
 * Кидає помилку з людським текстом — його показуємо просто в інтерфейсі.
 */
export function parseBackup(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Файл не є коректним JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Файл порожній або пошкоджений.');
  }
  if (parsed.format !== BACKUP_FORMAT) {
    throw new Error('Це не резервна копія DreamCut App.');
  }
  if (typeof parsed.version === 'number' && parsed.version > BACKUP_VERSION) {
    throw new Error('Копію зроблено новішою версією застосунку. Онови застосунок.');
  }
  return parsed;
}

/** Замінює всі дані вмістом копії. Повертає підсумок для повідомлення. */
export function restoreBackup(rawText) {
  const parsed = parseBackup(rawText);
  const next = replaceState(parsed);
  return {
    projects: next.projects.length,
    tasks: next.tasks.length,
    ideas: next.ideas.length,
    equipment: next.equipment.length,
    crew: next.crew.length,
    estimates: next.estimates.length,
  };
}

/**
 * Доливає дані з копії до наявних, не чіпаючи те, що вже є.
 * Записи з однаковим id вважаються тими самими і пропускаються.
 */
export function mergeBackup(rawText) {
  const parsed = parseBackup(rawText);
  const state = getState();
  const added = { projects: 0, tasks: 0, ideas: 0, equipment: 0, crew: 0, estimates: 0 };

  const merged = { ...state, settings: state.settings };
  for (const collection of ['projects', 'tasks', 'ideas', 'equipment', 'crew', 'estimates']) {
    const known = new Set(state[collection].map((item) => item.id));
    const incoming = Array.isArray(parsed[collection]) ? parsed[collection] : [];
    const fresh = incoming.filter((item) => item && !known.has(item.id));
    added[collection] = fresh.length;
    merged[collection] = [...state[collection], ...fresh];
  }

  replaceState(merged);
  return added;
}
