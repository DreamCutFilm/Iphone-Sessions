// Повнота перекладу.
//
// Обіцянка «застосунок говорить трьома мовами» перевіряється тут, а не на
// око: якщо в екрані зʼявився новий український рядок, а у словниках його
// немає, тест падає з переліком забутого. Інакше польська версія тихо
// заростала б українськими вкрапленнями.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { uiFiles, extractStrings, joinAdjacent } from '../tools/strings.mjs';
import { pl } from '../src/core/lang/pl.js';
import { en } from '../src/core/lang/en.js';

// Рядки, які людина не бачить або які не перекладаються.
const SKIP = new Set([
  // Помилка для розробника: спрацьовує лише тоді, коли в коді описка.
  'Невідома колекція: {}',
  // Імʼя файлу резервної копії. Його читає файлова система, не людина.
  'dreamcut-app-пошкоджена-{}.json',
]);

function appStrings() {
  const found = new Map();

  for (const file of uiFiles('src')) {
    // Самі словники й двигун перекладу з себе ж не перекладаються: там
    // лежать ключі та запасні назви місяців, а не тексти екранів.
    if (file.includes('lang') || file.endsWith('i18n.js')) continue;

    let source = readFileSync(file, 'utf8');
    // Довгі речення в коді розбиті на кілька рядків через +. Людина бачить
    // їх як одне речення — і в словнику вони мають бути одним ключем.
    for (let pass = 0; pass < 6; pass += 1) source = joinAdjacent(source);

    for (const { text } of extractStrings(source)) {
      if (SKIP.has(text)) continue;
      if (!found.has(text)) found.set(text, file);
    }
  }

  return found;
}

test('переклад: кожен український рядок є у польському словнику', () => {
  const missing = [...appStrings()]
    .filter(([text]) => !pl.strings[text])
    .map(([text, file]) => `${file}: ${JSON.stringify(text)}`);

  assert.deepEqual(missing, [], `без польського перекладу: ${missing.length}`);
});

test('переклад: кожен український рядок є в англійському словнику', () => {
  const missing = [...appStrings()]
    .filter(([text]) => !en.strings[text])
    .map(([text, file]) => `${file}: ${JSON.stringify(text)}`);

  assert.deepEqual(missing, [], `без англійського перекладу: ${missing.length}`);
});

test('переклад: у словниках немає рядків, яких уже немає в коді', () => {
  const live = appStrings();
  const stale = [];

  for (const [language, dictionary] of [['pl', pl], ['en', en]]) {
    for (const key of Object.keys(dictionary.strings)) {
      if (!live.has(key)) stale.push(`${language}: ${JSON.stringify(key)}`);
    }
  }

  assert.deepEqual(stale, [], `зайвих записів: ${stale.length}`);
});

test('переклад: форми множини описані для всіх мов', () => {
  const used = new Set();

  for (const file of uiFiles('src')) {
    // Самі словники не рахуємо: там уже переклади, а не українські форми.
    if (file.includes('lang')) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/plural(?:Word)?\(\s*[^,]+,\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'/g)) {
      used.add(`${match[1]}|${match[2]}|${match[3]}`);
    }
    // Одиниці кошторису перелічені таблицею, а не викликом.
    for (const match of source.matchAll(/'([^']+)': \['([^']+)', '([^']+)', '([^']+)'\]/g)) {
      used.add(`${match[2]}|${match[3]}|${match[4]}`);
    }
  }

  for (const [language, dictionary] of [['pl', pl], ['en', en]]) {
    for (const key of used) {
      assert.ok(dictionary.plurals[key], `${language}: немає форм для «${key}»`);
    }
  }
});

test('переклад: місяці й дні тижня на місці', () => {
  for (const dictionary of [pl, en]) {
    assert.equal(dictionary.months.length, 12);
    assert.equal(dictionary.weekdays.length, 7);
  }
});
