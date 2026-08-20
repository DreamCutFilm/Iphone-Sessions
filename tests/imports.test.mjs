// Перевірка звʼязків між файлами.
//
// Цей файл зʼявився після чорного екрана. Причина була дрібна до образливого:
// у списку імпортів загубилася кома. Тести ядра цього не бачили — вони
// перевіряють розрахунки, а не те, чи застосунок узагалі запуститься.
//
// Тут перевіряється саме це: кожен файл читається, кожне імʼя, яке один файл
// бере в іншого, там справді є, і всі шляхи ведуть у наявні файли. Помилка
// такого роду коштує всього застосунку — він не показує нічого, — тож ловити
// її має найдешевша перевірка, а не людина з телефоном у руці.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function allSources(dir = join(root, 'src'), found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) allSources(path, found);
    else if (entry.name.endsWith('.js')) found.push(path);
  }
  return found;
}

const files = [...allSources(), join(root, 'src/app.js')].filter(
  (path, index, list) => list.indexOf(path) === index,
);

/** Що файл віддає назовні. */
function exportsOf(source) {
  const names = new Set();

  for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+([\w$]+)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s+class\s+([\w$]+)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s+(?:const|let|var)\s+([\w$]+)/g)) names.add(match[1]);
  // export { a, b as c }
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  if (/export\s+default/.test(source)) names.add('default');

  return names;
}

/** Що файл бере в інших: [{ from, names }]. */
function importsOf(source) {
  const result = [];

  for (const match of source.matchAll(/import\s+([^;]*?)\s+from\s+'([^']+)'/g)) {
    const [, clause, from] = match;
    const names = [];

    // names — як воно зветься в чужому файлі, locals — як тут.
    // «formatMoney as formatMoneyIn» це два різні імені, і плутати їх не можна:
    // перше перевіряємо на боці сусіда, друге — на своєму.
    const locals = [];

    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const [source, alias] = trimmed.split(/\s+as\s+/);
        names.push(source.trim());
        locals.push((alias ?? source).trim());
      }
    }

    const plain = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    if (plain && !plain.startsWith('*')) {
      names.push('default');
      locals.push(plain);
    }

    result.push({ from, names, locals, clause });
  }

  return result;
}

const sources = new Map(files.map((path) => [path, readFileSync(path, 'utf8')]));

/**
 * Лишити з файлу тільки код.
 *
 * Без цього перевірка нижче спотикалася об українську мову: «service worker
 * (для оновлення кешу)» у коментарі виглядає для неї як виклик worker().
 *
 * Іде посимвольно, а не регулярним виразом, і саме тому: рядок у зворотних
 * лапках може містити всередині ще один такий рядок, і жоден вираз цього
 * надійно не розбере — перша ж спроба зʼїла оголошення функції разом
 * із половиною файлу. Вставки ${…} навмисно лишаються: там теж живий код,
 * і перевіряти його треба нарівні з рештою.
 */
function codeOnly(source) {
  let out = '';
  let i = 0;

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      i += 1;
      while (i < source.length && source[i] !== char) i += source[i] === '\\' ? 2 : 1;
      i += 1;
      out += '""';
      continue;
    }
    if (char === '`') {
      i += 1;
      let depth = 0;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (depth === 0 && source[i] === '`') { i += 1; break; }
        if (depth === 0 && source[i] === '$' && source[i + 1] === '{') {
          depth = 1; i += 2; out += ' ';
          continue;
        }
        if (depth > 0) {
          if (source[i] === '{') depth += 1;
          if (source[i] === '}') { depth -= 1; if (depth === 0) { i += 1; out += ' '; continue; } }
          out += source[i];
        }
        i += 1;
      }
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

test('звʼязки: кожен файл читається як модуль', async () => {
  for (const path of files) {
    // Уже сам розбір ловить зламаний синтаксис — а він валить застосунок цілком.
    await assert.doesNotReject(
      () => import(`file://${path}`).catch((error) => {
        // DOM у Node немає, і це нормально: нас цікавить лише розбір і звʼязки.
        if (error instanceof SyntaxError || /does not provide an export/.test(error.message)) {
          throw error;
        }
        return null;
      }),
      `${relative(root, path)} не читається`,
    );
  }
});

test('звʼязки: усі шляхи ведуть у наявні файли', () => {
  for (const [path, source] of sources) {
    for (const { from } of importsOf(source)) {
      if (!from.startsWith('.')) continue;
      const target = resolve(dirname(path), from);
      assert.ok(existsSync(target), `${relative(root, path)} шукає ${from}, а такого файлу немає`);
    }
  }
});

test('звʼязки: кожне запозичене імʼя справді існує', () => {
  for (const [path, source] of sources) {
    for (const { from, names } of importsOf(source)) {
      if (!from.startsWith('.')) continue;

      const target = resolve(dirname(path), from);
      const available = exportsOf(sources.get(target) ?? readFileSync(target, 'utf8'));

      for (const name of names) {
        assert.ok(
          available.has(name),
          `${relative(root, path)} бере «${name}» з ${from}, але той цього не віддає. `
          + `Найчастіше це загублена кома в списку імпортів.`,
        );
      }
    }
  }
});

test('звʼязки: у списках імпорту не загубилася кома', () => {
  for (const [path, source] of sources) {
    for (const { clause } of importsOf(source)) {
      const braces = clause.match(/\{([^}]*)\}/);
      if (!braces) continue;

      for (const part of braces[1].split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        // Всередині одного елемента може бути лише «щось as щось».
        const words = trimmed.split(/\s+/);
        const looksValid = words.length === 1 || (words.length === 3 && words[1] === 'as');
        assert.ok(
          looksValid,
          `${relative(root, path)}: «${trimmed}» — схоже, між іменами загубилася кома`,
        );
      }
    }
  }
});

/**
 * Виклик функції, якої в цьому файлі немає.
 *
 * Саме так екран став чорним удруге: назву функції змінили в одному місці,
 * а в іншому лишили стару. Синтаксис цілий, імпорти на місці — застосунок
 * падає аж у браузері, і то лише коли дійде до того рядка.
 *
 * Перевірка навмисно проста: беремо все, що викликається як `імʼя(`, і
 * питаємо, чи воно взагалі десь у цьому файлі є — серед імпортів, оголошень
 * чи відомих браузерних імен. Це не повноцінний аналіз області видимості,
 * але саме цю помилку ловить надійно.
 */
const BROWSER_GLOBALS = new Set([
  'Array', 'Boolean', 'Date', 'Error', 'JSON', 'Map', 'Math', 'Number', 'Object',
  'Promise', 'RegExp', 'Set', 'String', 'Symbol', 'URLSearchParams', 'WeakMap',
  'Intl', 'Blob', 'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response',
  'Image', 'Notification', 'Audio', 'AbortController', 'CustomEvent', 'Event',
  'TextEncoder', 'TextDecoder', 'Uint8Array', 'Int32Array', 'Float64Array',
  'console', 'document', 'window', 'navigator', 'location', 'history', 'localStorage',
  'sessionStorage', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'crypto', 'caches', 'matchMedia',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'structuredClone', 'queueMicrotask', 'alert', 'confirm', 'prompt', 'self', 'globalThis',
  // Слова мови, які теж стоять перед дужкою: if (…), catch (…), async (…).
  'super', 'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
  'await', 'new', 'do', 'else', 'yield', 'void', 'delete', 'in', 'of', 'this',
  'async', 'try', 'throw', 'case', 'instanceof', 'export', 'import', 'constructor',
]);

test('звʼязки: усе, що викликається, справді десь оголошено', () => {
  for (const [path, raw] of sources) {
    const source = codeOnly(raw);
    const known = new Set(BROWSER_GLOBALS);

    // Імпорти беремо з оригіналу: у прибраному тексті шляхів уже немає.
    for (const { locals } of importsOf(raw)) for (const name of locals) known.add(name);
    for (const match of source.matchAll(/(?:function|class)\s+([\w$]+)/g)) known.add(match[1]);
    // Короткий запис методів у обʼєкті: { read(key) { … } }
    for (const match of source.matchAll(/^\s*([\w$]+)\s*\(([^)]*)\)\s*\{/gm)) {
      known.add(match[1]);
      for (const part of match[2].split(',')) {
        const name = part.trim().replace(/[{}[\]]/g, '').split(/[:=]/)[0].trim();
        if (name) known.add(name);
      }
    }
    // Аргументи звичайних функцій: function render(build) { … build() … }
    for (const match of source.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) {
      for (const part of match[1].split(',')) {
        const name = part.trim().replace(/[{}[\]]/g, '').split(/[:=]/)[0].trim();
        if (name) known.add(name);
      }
    }
    for (const match of source.matchAll(/(?:const|let|var)\s+([\w$]+)/g)) known.add(match[1]);
    // Розбір на частини: const { a, b } = ... і (a, b) => ...
    for (const match of source.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)) {
      for (const part of match[1].split(',')) {
        const name = part.trim().split(/[:=]/)[0].trim();
        if (name) known.add(name);
      }
    }
    for (const match of source.matchAll(/\(([^)]*)\)\s*=>/g)) {
      for (const part of match[1].split(',')) {
        const name = part.trim().replace(/[{}[\]]/g, '').split(/[:=]/)[0].trim();
        if (name) known.add(name);
      }
    }
    for (const match of source.matchAll(/([\w$]+)\s*=>/g)) known.add(match[1]);
    // Імена методів обʼєктів і властивостей: their(  — не наша справа.

    for (const match of source.matchAll(/(^|[^.\w$'"`])([a-z][\w$]*)\s*\(/g)) {
      const name = match[2];
      if (known.has(name)) continue;
      assert.fail(
        `${relative(root, path)} викликає «${name}()», але такого імені у файлі немає. `
        + 'Схоже, функцію перейменували в одному місці й забули в іншому.',
      );
    }
  }
});

test('офлайн: усі файли застосунку є в списку кешу', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+\.(?:js|css))'/g)].map((match) => match[1]));

  for (const path of files) {
    const relativePath = relative(root, path).replace(/\\/g, '/');
    assert.ok(
      listed.has(relativePath),
      `${relativePath} не внесено до списку в sw.js — офлайн застосунок його не знайде`,
    );
  }
});
