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

    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) names.push(name);
      }
    }

    const plain = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    if (plain && !plain.startsWith('*')) names.push('default');

    result.push({ from, names, clause });
  }

  return result;
}

const sources = new Map(files.map((path) => [path, readFileSync(path, 'utf8')]));

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
