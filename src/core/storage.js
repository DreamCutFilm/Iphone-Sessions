// Адаптер сховища.
//
// Це єдине місце, яке знає, КУДИ фізично пишуться дані. У вебі це localStorage,
// у нативному застосунку його замінюють на файл, SQLite чи UserDefaults —
// решта коду про це не знає і не змінюється.

const MEMORY = new Map();

/** Сховище в памʼяті — запасний варіант, коли localStorage недоступний (режим приватного перегляду). */
const memoryAdapter = {
  name: 'memory',
  read(key) {
    return MEMORY.has(key) ? MEMORY.get(key) : null;
  },
  write(key, value) {
    MEMORY.set(key, value);
  },
  remove(key) {
    MEMORY.delete(key);
  },
};

const localAdapter = {
  name: 'localStorage',
  read(key) {
    return globalThis.localStorage.getItem(key);
  },
  write(key, value) {
    globalThis.localStorage.setItem(key, value);
  },
  remove(key) {
    globalThis.localStorage.removeItem(key);
  },
};

function pickAdapter() {
  try {
    const probe = '__dreamcut_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return localAdapter;
  } catch {
    return memoryAdapter;
  }
}

let adapter = pickAdapter();

/** Дозволяє нативній оболонці підставити власне сховище до старту застосунку. */
export function setStorageAdapter(custom) {
  adapter = custom;
}

export function storageName() {
  return adapter.name;
}

export function readJson(key, fallback = null) {
  try {
    const raw = adapter.read(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    adapter.write(key, JSON.stringify(value));
    return true;
  } catch (error) {
    // Найімовірніша причина — вичерпана квота сховища.
    console.warn('Не вдалося зберегти дані:', error);
    return false;
  }
}

export function removeKey(key) {
  adapter.remove(key);
}
