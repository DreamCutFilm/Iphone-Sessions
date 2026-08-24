// Бічне меню — те, що виїжджає зліва по натиску на три смужки.
//
// Нижні вкладки — це робота: те, куди заходиш по десять разів на день.
// Меню — це все інше: хто я, у якій фірмі, як налаштовано. Такі речі
// відкривають раз на тиждень, і тримати їх у нижньому ряду означало б
// віддати місце під те, чим майже не користуються.
//
// Панель живе окремо від дерева екрана й не перемальовується разом із ним —
// так само, як панелі знизу.

import { el, appendIf } from './dom.js';
import { navigate, rerender } from './router.js';
import { t } from '../core/i18n.js';
import { isSignedIn } from '../core/cloud.js';
import { knownCompanies, currentCompany, getContext, setContext, MINE } from '../core/context.js';
import { APP_VERSION } from '../app-meta.js';

// Повна карта застосунку, поділена за змістом. Саме повна: до цього
// «Техніка» й «Команда» відкривалися тільки з екрана кошторисів, а
// «Проєкти фірми» — з екрана проєктів. Людина не мусить знати, з якого
// саме кута застосунку її пускають у власний каталог техніки.
//
// Під кожним пунктом — один рядок про те, що всередині. Слово «Кошториси»
// без пояснення однаково зрозуміле й для рахунка клієнту, і для звіту про
// витрати, — а це різні речі.
//
// Значки з того самого набору, що й у нижніх вкладках: кольорова емодзі
// серед тонких знаків тягне око на себе й читається як «цей пункт
// головніший», хоча це неправда.
const GROUPS = [
  {
    title: 'Робота',
    items: [
      { path: '/overview', label: 'Головна', mark: '◎', hint: 'Що сьогодні й що горить' },
      { path: '/projects', label: 'Проєкти', mark: '▣', hint: 'Зйомки, дедлайни, знімальні дні' },
      { path: '/tasks', label: 'Задачі', mark: '✓', hint: 'Усе, що треба зробити' },
      { path: '/ideas', label: 'Ідеї', mark: '✳', hint: 'Блокнот задумів і референсів' },
    ],
  },
  {
    title: 'Гроші й каталоги',
    items: [
      { path: '/estimates', label: 'Кошториси', mark: '∑', hint: 'Рахунки клієнтам і заробіток' },
      { path: '/equipment', label: 'Техніка', mark: '▤', hint: 'Своя й орендована, з цінами' },
      { path: '/crew', label: 'Команда', mark: '◍', hint: 'Люди й гонорари за зміну' },
      { path: '/rentals', label: 'Рентал', mark: '⌗', hint: 'Де брати техніку й за скільки', soon: true },
    ],
  },
  {
    title: 'Фірма',
    items: [
      { path: '/firm', label: 'Фірми', mark: '⌂', hint: 'Склад, ролі, спільні каталоги' },
      { path: '/team-projects', label: 'Проєкти фірми', mark: '▦', hint: 'Спільні зйомки команди', firmOnly: true },
    ],
  },
  {
    title: 'Інструменти',
    items: [
      { path: '/calc', label: 'Кінорозрахунки', mark: 'ƒ', hint: 'Фокусна, різкість, ND, карти, таймкод, сонце' },
    ],
  },
  {
    title: 'Застосунок',
    items: [
      { path: '/account', label: 'Акаунт', mark: '◉', hint: 'Вхід, фірми, запрошення' },
      { path: '/settings', label: 'Налаштування', mark: '⚙', hint: 'Мова, валюта, сонце, сповіщення' },
      { path: '/about', label: 'Про програму', mark: '◇', hint: 'Оновлення, резервні копії, версія' },
    ],
  },
];

let active = null;

/** Кнопка «три смужки». Стоїть зліва від заголовка. */
export function menuButton() {
  return el('button.icon-btn.icon-btn--menu', {
    type: 'button',
    'aria-label': 'Меню',
    onclick: () => openMenu(),
  }, '☰');
}

export function openMenu() {
  closeMenu();

  const backdrop = el('div.menu-backdrop');
  const panel = el('nav.menu-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Меню' });

  panel.append(el('div.menu-head',
    el('p.menu-title', 'DreamCut App'),
    el('p.menu-note', whereAmI())));

  appendIf(panel, contextSwitch());

  const current = window.location.hash.replace(/^#/, '') || '/overview';
  // Пункти, яким без фірми нема куди вести, не показуємо зовсім: порожній
  // рядок, що щоразу відповідає «спершу увійди», — це не карта, а глухий кут.
  const hasFirm = isSignedIn() && knownCompanies().length > 0;

  for (const group of GROUPS) {
    const items = group.items.filter((item) => !item.firmOnly || hasFirm);
    if (!items.length) continue;

    panel.append(el('p.menu-group', group.title));
    panel.append(el('div.menu-list', items.map((item) => menuRow(item, current))));
  }

  // Версія внизу — там, де її шукають. Заразом це відповідь на питання
  // «а в мене оновилось?», яке інакше веде людину блукати екранами.
  panel.append(el('div.menu-foot',
    el('button.menu-version', {
      type: 'button',
      onclick: () => {
        closeMenu();
        setTimeout(() => navigate('/about'), 120);
      },
    }, t('Версія {version}', { version: APP_VERSION }))));

  backdrop.append(panel);
  document.body.append(backdrop);
  document.body.classList.add('is-locked');

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeMenu();
  });

  document.addEventListener('keydown', onKey);
  active = { backdrop };

  requestAnimationFrame(() => backdrop.classList.add('menu-backdrop--open'));
}

export function closeMenu() {
  if (!active) return;
  const { backdrop } = active;
  active = null;

  document.removeEventListener('keydown', onKey);
  backdrop.classList.remove('menu-backdrop--open');
  document.body.classList.remove('is-locked');
  setTimeout(() => backdrop.remove(), 220);
}

export function isMenuOpen() {
  return active !== null;
}

function menuRow(item, current) {
  const isHere = current === item.path || current.startsWith(`${item.path}/`);

  return el('button.menu-item', {
    type: 'button',
    class: isHere ? 'is-active' : '',
    'aria-current': isHere ? 'page' : null,
    onclick: () => {
      closeMenu();
      // Даємо панелі поїхати геть, і лише тоді міняємо екран: інакше
      // новий екран малюється під ще видимою панеллю й це смикає око.
      setTimeout(() => navigate(item.path), 120);
    },
  },
  el('span.menu-mark', item.mark),
  el('span.menu-text',
    el('span.menu-label', item.label, item.soon ? el('span.menu-soon', 'в розробці') : null),
    el('span.menu-hint', item.hint)));
}

function onKey(event) {
  if (event.key === 'Escape') closeMenu();
}

/**
 * Перемикач «Моє / фірма» — той самий, що й смугою під заголовком.
 *
 * У меню він потрібен тому, що меню — це карта: людина відкриває його,
 * щоб зрозуміти, де вона й куди може піти. Питання «чиї це дані» —
 * частина того самого питання, і відповідати на нього деінде дивно.
 */
function contextSwitch() {
  if (!isSignedIn()) return null;

  const companies = knownCompanies();
  if (!companies.length) return null;

  const context = getContext();
  const options = [
    { id: null, name: 'Моє', note: 'Тільки на цьому телефоні', mine: true },
    ...companies.map((company) => ({ ...company, note: 'Спільні дані фірми', mine: false })),
  ];

  return el('div.menu-context', options.map((option) => {
    const isHere = option.mine ? context.kind === 'mine' : context.id === option.id;

    return el('button.menu-context-item', {
      type: 'button',
      class: isHere ? 'is-active' : '',
      'aria-pressed': isHere ? 'true' : 'false',
      onclick: () => {
        closeMenu();
        if (isHere) return;
        setContext(option.mine
          ? MINE
          : { kind: 'company', id: option.id, name: option.name, role: option.role });
        // Контекст міняє вміст усіх екранів, тож перемальовуємо після того,
        // як панель поїде: інакше зміна відбувається під нею й непомітно.
        setTimeout(() => rerender(), 120);
      },
    },
    el('span.menu-mark', isHere ? '●' : '○'),
    el('span.menu-text',
      el('span.menu-label', option.name),
      el('span.menu-hint', option.note)));
  }));
}

/**
 * Підпис під назвою: де людина зараз.
 *
 * Питання «я зараз у своєму чи у фірмовому» виникає найчастіше саме тоді,
 * коли відкриваєш меню, — тож відповідь стоїть просто тут.
 */
function whereAmI() {
  if (!isSignedIn()) return 'Усе на цьому телефоні';

  const company = currentCompany();
  if (company) return company.name;

  return knownCompanies().length ? 'Моє' : 'Особистий акаунт';
}
