// Точка збірки: маршрути, нижня панель вкладок, реакція на зміну даних.

import { el, mount } from './ui/dom.js';
import { route, setNotFound, startRouter, navigate, setNavigationListener, rerender } from './ui/router.js';
import { subscribe, saveNow } from './core/store.js';
import { isSheetOpen, onSheetClosed } from './ui/sheet.js';
import { startReminders } from './ui/reminders.js';

import { overviewView } from './ui/views/overview.js';
import { projectsView, projectDetailView } from './ui/views/projects.js';
import { tasksView } from './ui/views/tasks.js';
import { ideasView } from './ui/views/ideas.js';
import { calcMenuView, calcToolView } from './ui/views/calc.js';
import { estimatesView, estimateDetailView } from './ui/views/estimates.js';
import { equipmentView } from './ui/views/equipment.js';
import { settingsView } from './ui/views/settings.js';

const TABS = [
  { path: '/overview', label: 'Огляд', mark: '◎' },
  { path: '/projects', label: 'Проєкти', mark: '▣' },
  { path: '/tasks', label: 'Задачі', mark: '✓' },
  // Знак суми, а не валюти: валюта в застосунку змінна, значок вкладки — ні.
  { path: '/estimates', label: 'Кошторис', mark: '∑' },
  { path: '/ideas', label: 'Ідеї', mark: '✳' },
  { path: '/calc', label: 'Кіно', mark: 'ƒ' },
];

const screen = document.querySelector('#screen');
const tabBar = document.querySelector('#tabbar');

// Позиція прокрутки для кожного маршруту: повертаючись назад зі сторінки
// проєкту, оператор має опинитись там, де був, а не на початку списку.
const scrollMemory = new Map();
let previousPath = null;

function render(build) {
  if (previousPath) scrollMemory.set(previousPath, screen.scrollTop);
  mount(screen, build());
}

route('/overview', () => render(overviewView));
route('/projects', () => render(projectsView));
route('/projects/:id', ({ id }) => render(() => projectDetailView(id)));
route('/tasks', () => render(tasksView));
route('/ideas', () => render(ideasView));
route('/estimates', () => render(estimatesView));
route('/estimates/:id', ({ id }) => render(() => estimateDetailView(id)));
route('/equipment', () => render(equipmentView));
route('/calc', () => render(calcMenuView));
route('/calc/:tool', ({ tool }) => render(() => calcToolView(tool)));
route('/settings', () => render(settingsView));
setNotFound(() => navigate('/overview', { replace: true }));

function buildTabs(currentPath) {
  const nodes = TABS.map((tab) => {
    const isActive = currentPath === tab.path || currentPath.startsWith(`${tab.path}/`);
    return el(
      'button.tab',
      {
        type: 'button',
        class: isActive ? 'is-active' : '',
        'aria-current': isActive ? 'page' : null,
        onclick: () => navigate(tab.path),
      },
      el('span.tab-mark', tab.mark),
      el('span.tab-label', tab.label),
    );
  });
  mount(tabBar, nodes);
}

setNavigationListener((path) => {
  buildTabs(path);
  // Відновлюємо прокрутку після того, як браузер намалює новий екран.
  requestAnimationFrame(() => {
    screen.scrollTop = scrollMemory.get(path) ?? 0;
  });
  previousPath = path;
});

// Будь-яка зміна даних перемальовує поточний екран. Виняток — відкрита панель
// редагування: перемальовування під час набору тексту вибило б фокус. Тому
// зміни, що сталися при відкритій панелі, відкладаються до її закриття —
// інакше щойно збережений запис не з'являвся б у списку під панеллю.
let pendingRerender = false;

subscribe(() => {
  if (isSheetOpen()) {
    pendingRerender = true;
    return;
  }
  rerender();
});

onSheetClosed(() => {
  if (!pendingRerender) return;
  pendingRerender = false;
  rerender();
});

// Дані мають лягти на диск навіть якщо застосунок закривають різко.
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveNow();
});

startRouter();
startReminders();

// Service worker дає офлайн-режим. На file:// він недоступний — це нормально.
//
// Окрема морока — оновлення. Застосунок навмисно показує вміст із кешу, тому
// нова версія інакше зʼявлялася б аж на другий-третій запуск, і виглядало б
// це так, ніби оновлення не приїхало. Тому: питаємо про оновлення при кожному
// відкритті, а коли нова версія перебирає керування — перезавантажуємось самі.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // Чи керував сторінкою якийсь worker на момент запуску. Якщо ні — це перша
  // установка, і перезавантажуватись немає сенсу: свіжішого вмісту не буде.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('sw.js');

      const checkForUpdate = () => registration.update().catch(() => {});
      checkForUpdate();

      // Повернення до застосунку — найчастіший момент, коли є мережа
      // і варто спитати, чи не вийшла нова версія.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    } catch {
      // Офлайн-режим просто не увімкнеться; сам застосунок працює далі.
    }
  });
}
