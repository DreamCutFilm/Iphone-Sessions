// Мінімальні помічники для роботи з DOM.
//
// Без фреймворку — щоб застосунок відкривався миттєво, важив кілька десятків
// кілобайт і не мав збірки. Це ж робить перенесення в нативну оболонку
// тривіальним: там просто лежать ті самі файли.
//
// Тут же відбувається переклад. Через el() проходить кожне слово, яке
// показує застосунок, — тож одне місце робить те, на що інакше пішла б
// тисяча правок у екранах, і жоден новий екран не забуде перекластися.
// Дані людини (назва проєкту, імʼя в команді) у словнику не значаться,
// тому повертаються як є. Виняток буває один: якщо людина назве проєкт
// точнісінько так, як звучить якийсь напис у застосунку, назва перекладеться
// разом із ним. Ціна невелика — і вона куди менша за тисячу правок, які
// довелося б рознести по екранах, аби перекладати кожен напис окремо.

import { t } from '../core/i18n.js';

// Написи, які живуть у властивостях, а не в тексті. Решту атрибутів не
// чіпаємо: там ідентифікатори й класи, які перекладати не можна.
const TEXT_PROPS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'value']);

/**
 * el('div.card', { onclick }, 'текст', childNode)
 * Селектор підтримує теги, класи (.card) та id (#main).
 */
export function el(selector, props = null, ...children) {
  const { tag, id, classes } = parseSelector(selector);
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');

  if (props && typeof props === 'object' && !isRenderable(props)) {
    applyProps(node, props);
  } else if (props !== null && props !== undefined) {
    children.unshift(props);
  }

  append(node, children);
  return node;
}

function parseSelector(selector) {
  const [head, ...classes] = String(selector).split('.');
  const [tag, id] = head.split('#');
  return { tag: tag || 'div', id, classes };
}

function isRenderable(value) {
  return value instanceof Node || Array.isArray(value);
}

function applyProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = [node.className, value].filter(Boolean).join(' ');
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key in node && key !== 'list') {
      // value перекладаємо лише у кнопки: в полі вводу це текст людини,
      // і підміна словником стерла б написане.
      node[key] = TEXT_PROPS.has(key) && (key !== 'value' || node.tagName === 'BUTTON')
        ? t(String(value))
        : value;
    } else {
      node.setAttribute(key, value === true ? '' : TEXT_PROPS.has(key) ? t(String(value)) : value);
    }
  }
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(t(String(child))));
  }
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
}

/**
 * Додати до вузла тільки те, що справді є.
 *
 * Звичайний append домальовує «null» словом, якщо йому дати порожнечу, —
 * і на екрані зʼявляється рядок «null» посеред інтерфейсу. Блоки, яких може
 * не бути (фірма, підказка, попередження), проходять через це.
 */
export function appendIf(container, ...children) {
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) container.append(child);
  }
  return container;
}

export function mount(container, ...children) {
  clear(container);
  append(container, children);
  return container;
}

/** Текст, який показуємо замість порожнього списку. */
export function emptyState(title, hint, action = null) {
  return el('div.empty', el('p.empty-title', title), hint && el('p.empty-hint', hint), action);
}

export function icon(name) {
  return el('span.icon', { 'aria-hidden': 'true' }, ICONS[name] ?? '');
}

// Іконки — емодзі: не тягнуть шрифтів, однаково виглядають на всіх iPhone.
const ICONS = {
  overview: '◎',
  projects: '▣',
  tasks: '✓',
  ideas: '✳',
  calc: 'ƒ',
  settings: '⚙',
  add: '+',
  back: '‹',
  close: '×',
  shoot: '🎥',
  deadline: '⚑',
  reminder: '🔔',
  sun: '☀',
};

/** Коротке спливне повідомлення внизу екрана. */
let toastTimer = null;
export function toast(message, { error = false } = {}) {
  let node = document.querySelector('.toast');
  if (!node) {
    node = el('div.toast');
    document.body.append(node);
  }
  node.textContent = t(message);
  node.classList.toggle('toast--error', error);
  node.classList.add('toast--visible');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('toast--visible'), 2600);
}

/** Тактильний відгук там, де він доречний (підтримується не всюди). */
export function haptic() {
  if (typeof navigator.vibrate === 'function') navigator.vibrate(8);
}
