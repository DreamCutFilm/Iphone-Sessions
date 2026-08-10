// Задачі та нагадування — усе, що має термін.

import { el, emptyState } from '../dom.js';
import { pageHeader, sectionTitle, taskRow, fab } from '../components.js';
import { editTask } from '../editors.js';
import { getState } from '../../core/store.js';
import {
  overdueTasks, todayTasks, upcomingTasks, somedayTasks, openTasks, projectById, taskOrder,
} from '../../core/selectors.js';
import { formatDate, daysUntil } from '../../core/dates.js';

// Фільтр живе поза перемальовуванням, щоб вибір не скидався при зміні даних.
let activeFilter = 'open';

const FILTERS = [
  { id: 'open', label: 'Активні' },
  { id: 'today', label: 'Сьогодні' },
  { id: 'week', label: 'Тиждень' },
  { id: 'someday', label: 'Колись' },
  { id: 'done', label: 'Готово' },
];

export function tasksView() {
  const state = getState();
  const page = el('div.page');

  const open = openTasks(state);

  page.append(pageHeader('Задачі', {
    subtitle: `${open.length} відкритих`,
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Нова задача', onclick: () => editTask() }, '+'),
  }));

  const tabs = el('div.filters');
  for (const filter of FILTERS) {
    tabs.append(el('button.filter', {
      type: 'button',
      class: filter.id === activeFilter ? 'is-active' : '',
      onclick: () => {
        activeFilter = filter.id;
        // Перемальовуємо лише цей екран — стан застосунку не змінився.
        const fresh = tasksView();
        page.replaceWith(fresh);
      },
    }, filter.label));
  }
  page.append(tabs);

  const render = (list) => el('div.list', list.map((task) => taskRow(task, {
    project: projectById(state, task.projectId),
    onEdit: (item) => editTask(item),
  })));

  if (activeFilter === 'open') {
    const overdue = overdueTasks(state);
    const today = todayTasks(state);
    const week = upcomingTasks(state, 7);
    const later = open.filter((task) => task.due && daysUntil(task.due) > 7);
    const someday = somedayTasks(state);

    if (!open.length) {
      page.append(emptyState('Задач немає', 'Додай першу — і вона зʼявиться тут.',
        el('button.btn.btn--primary', { type: 'button', onclick: () => editTask() }, 'Нова задача')));
    }
    if (overdue.length) { page.append(sectionTitle('Прострочено')); page.append(render(overdue)); }
    if (today.length) { page.append(sectionTitle('Сьогодні')); page.append(render(today)); }
    if (week.length) { page.append(sectionTitle('Найближчі 7 днів')); page.append(render(week)); }
    if (later.length) { page.append(sectionTitle('Пізніше')); page.append(render(later)); }
    if (someday.length) { page.append(sectionTitle('Без дати')); page.append(render(someday)); }
  } else if (activeFilter === 'today') {
    const list = [...overdueTasks(state), ...todayTasks(state)];
    page.append(list.length ? render(list) : emptyState('На сьогодні порожньо', 'Нічого не горить.'));
  } else if (activeFilter === 'week') {
    const list = upcomingTasks(state, 7);
    page.append(list.length ? render(list) : emptyState('Тиждень вільний', 'Дедлайнів на найближчі 7 днів немає.'));
  } else if (activeFilter === 'someday') {
    const list = somedayTasks(state);
    page.append(list.length ? render(list) : emptyState('Список порожній', 'Сюди падає все без конкретної дати.'));
  } else {
    const done = state.tasks.filter((task) => task.done).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
    page.append(done.length
      ? el('div.list.list--muted', done.slice(0, 50).map((task) => taskRow(task, {
          project: projectById(state, task.projectId),
          onEdit: (item) => editTask(item),
        })))
      : emptyState('Ще нічого не закрито', 'Виконані задачі збираються тут.'));
  }

  page.append(fab('Нова задача', () => editTask()));
  return page;
}

export { taskOrder, formatDate };
