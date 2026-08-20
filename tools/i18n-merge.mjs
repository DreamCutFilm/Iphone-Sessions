// Додає переклади у словники: приймає JSON [{ uk, pl, en }] і вставляє
// рядки у src/core/lang/*.js, зберігаючи порядок за українським ключем.
//
// Руками таке зводити довго й легко проґавити кому; а словник, у якому
// загубився один рядок, мовчки покаже його чужою мовою.

import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('використання: node tools/i18n-merge.mjs переклади.json');
  process.exit(1);
}

const rows = JSON.parse(readFileSync(file, 'utf8'));

for (const lang of ['pl', 'en']) {
  const path = `src/core/lang/${lang}.js`;
  const source = readFileSync(path, 'utf8');

  const start = source.indexOf('strings: {');
  const end = source.lastIndexOf('},');
  if (start < 0 || end < 0) throw new Error(`не знайшов словник у ${path}`);

  const body = source.slice(start + 'strings: {'.length, end);
  const entries = new Map();

  for (const match of body.matchAll(/^\s*(['"])((?:\\.|(?!\1).)*)\1:\s*(['"])((?:\\.|(?!\3).)*)\3,\s*$/gm)) {
    entries.set(unescapeJs(match[2]), unescapeJs(match[4]));
  }

  let added = 0;
  for (const row of rows) {
    const value = row[lang];
    if (typeof value !== 'string' || !value) continue;
    if (!entries.has(row.uk)) added += 1;
    entries.set(row.uk, value);
  }

  const sorted = [...entries.entries()].sort((a, b) => a[0].localeCompare(b[0], 'uk'));
  const text = sorted.map(([key, value]) => `    ${quote(key)}: ${quote(value)},`).join('\n');

  writeFileSync(path, `${source.slice(0, start)}strings: {\n${text}\n  ${source.slice(end)}`);
  console.log(`${path}: +${added}, усього ${sorted.length}`);
}

function quote(text) {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function unescapeJs(text) {
  return text.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}
