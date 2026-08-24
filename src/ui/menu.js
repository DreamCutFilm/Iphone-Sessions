// Бічне меню — те, що виїжджає зліва по натиску на три смужки.
//
// Нижні вкладки — це робота: те, куди заходиш по десять разів на день.
// Меню — це все інше: хто я, у якій фірмі, як налаштовано. Такі речі
// відкривають раз на тиждень, і тримати їх у нижньому ряду означало б
// віддати місце під те, чим майже не користуються.
//
// Панель живе окремо від дерева екрана й не перемальовується разом із ним —
// так само, як панелі знизу.

import { el } from './dom.js';
import { navigate } from './router.js';
import { isSignedIn } from '../core/cloud.js';
import { knownCompanies, currentCompany } from '../core/context.js';

// Значки навмисно з того самого набору, що й у нижніх вкладках: одна
// кольорова емодзі серед чотирьох тонких знаків одразу тягне око на себе
// й читається як «цей пункт головніший», хоча це неправда.
const ITEMS = [
  { path: '/overview', label: 'Головна', mark: '◎' },
  { path: '/account', label: 'Акаунт', mark: '◉' },
  { path: '/firm', label: 'Фірми', mark: '⌂' },
  { path: '/settings', label: 'Налаштування', mark: '⚙' },
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

  const current = window.location.hash.replace(/^#/, '') || '/overview';

  panel.append(el('div.menu-list', ITEMS.map((item) => {
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
    }, el('span.menu-mark', item.mark), el('span', item.label));
  })));

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

function onKey(event) {
  if (event.key === 'Escape') closeMenu();
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
