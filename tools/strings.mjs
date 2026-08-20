// Витягує з коду всі рядки, які бачить людина, — щоб перекладачу (і тесту
// повноти) не доводилось гадати, чи все на місці.
//
// Коментарі не рахуються: вони написані для того, хто читає код, і
// перекладу не потребують.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CYRILLIC = /[Ѐ-ӿ]/;

export function uiFiles(root = 'src') {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.js')) out.push(path);
    }
  };
  walk(root);
  return out.sort();
}

/** Рядкові літерали з кирилицею: { text, dynamic, file }. */
export function extractStrings(source) {
  const found = [];
  let i = 0;

  const skipComment = () => {
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      return true;
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      return true;
    }
    return false;
  };

  while (i < source.length) {
    if (skipComment()) continue;

    const char = source[i];

    if (char === "'" || char === '"') {
      const quote = char;
      i += 1;
      let text = '';
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') { text += source[i + 1] === 'n' ? '\n' : source[i + 1]; i += 2; continue; }
        text += source[i];
        i += 1;
      }
      i += 1;
      if (CYRILLIC.test(text)) found.push({ text, dynamic: false });
      continue;
    }

    if (char === '`') {
      i += 1;
      let text = '';
      let dynamic = false;
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '$' && source[i + 1] === '{') {
          dynamic = true;
          let depth = 1;
          i += 2;
          const from = i;
          while (i < source.length && depth > 0) {
            if (source[i] === '{') depth += 1;
            if (source[i] === '}') depth -= 1;
            i += 1;
          }
          // Усередині ${…} теж буває текст — саме там живуть t('ГБ') та
          // подібні вкраплення. Без цього вони випали б із перевірки
          // повноти, і словник вважався б повним, коли він неповний.
          found.push(...extractStrings(source.slice(from, i - 1)));
          text += '{}';
          continue;
        }
        text += source[i];
        i += 1;
      }
      i += 1;
      if (CYRILLIC.test(text)) found.push({ text, dynamic });
      continue;
    }

    i += 1;
  }

  return found;
}

/** Склеєні рядки виду 'початок ' + 'кінець' — у коді їх переносять, а людина бачить одне речення. */
export function joinAdjacent(source) {
  return source.replace(/(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\+\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g,
    (whole, q1, a, q2, b) => `${q1}${a}${b}${q1}`);
}

if (process.argv[1]?.endsWith('strings.mjs')) {
  const rows = new Map();
  for (const file of uiFiles()) {
    let source = readFileSync(file, 'utf8');
    for (let pass = 0; pass < 6; pass += 1) source = joinAdjacent(source);
    for (const item of extractStrings(source)) {
      const key = item.text;
      if (!rows.has(key)) rows.set(key, { ...item, files: new Set() });
      rows.get(key).files.add(file);
    }
  }

  const list = [...rows.values()].sort((a, b) => a.text.localeCompare(b.text, 'uk'));
  if (process.argv[2] === '--json') {
    console.log(JSON.stringify(list.map((r) => ({ text: r.text, dynamic: r.dynamic, files: [...r.files] })), null, 1));
  } else {
    for (const row of list) console.log((row.dynamic ? '~ ' : '  ') + JSON.stringify(row.text));
    console.error(`\nусього: ${list.length} (з підстановкою: ${list.filter((r) => r.dynamic).length})`);
  }
}
