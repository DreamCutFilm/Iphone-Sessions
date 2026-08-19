// Спільний проєкт зсередини — робочий екран людини, яка їде на майданчик.
//
// Тут має бути відповідь на три питання, з якими відкривають застосунок
// зранку: коли й куди, що я роблю, що везу. Гроші — останні, і кожен бачить
// рівно свої: цифри, яких людині не належить знати, до неї не доїжджають
// із сервера взагалі.

import { el, emptyState } from '../dom.js';
import { pageHeader, sectionTitle, chip, dueVariant } from '../components.js';
import { navigate } from '../router.js';
import { isSignedIn } from '../../core/cloud.js';
import { activeCompany } from '../../core/account.js';
import {
  companyProjects, sharedTasks, sharedItems, projectPayoutRows, sharedProfit,
} from '../../core/sharing.js';
import { statusLabel } from '../../core/models.js';
import { categoryLabel } from '../../core/equipment.js';
import { formatMoney } from '../../core/locale.js';
import { formatDate, describeDue, weekdayShort, daysUntil } from '../../core/dates.js';
import { mapsLink, isValidCoordinate, formatCoordinates } from '../../core/geo.js';

export function teamProjectView(projectId) {
  const page = el('div.page');
  page.append(pageHeader('Проєкт фірми', { back: '/team-projects' }));

  if (!isSignedIn() || !activeCompany()) {
    page.append(emptyState('Потрібен акаунт', 'Спільні проєкти живуть у фірмі.'));
    return page;
  }

  const host = el('div');
  page.append(host);
  load(host, projectId);

  return page;
}

async function load(host, projectId) {
  host.replaceChildren(el('p.settings-note', 'Завантажую…'));

  const company = activeCompany();
  let project;
  try {
    const all = await companyProjects(company.id);
    project = all.find((entry) => entry.id === projectId) ?? null;
  } catch (error) {
    host.replaceChildren(
      el('p.settings-note', error?.message ?? 'Немає звʼязку з сервером'),
      el('div.form', el('button.btn.btn--ghost.btn--wide', {
        type: 'button', onclick: () => load(host, projectId),
      }, 'Спробувати ще раз')),
    );
    return;
  }

  if (!project) {
    host.replaceChildren(emptyState(
      'Проєкт не знайдено',
      'Можливо, його прибрали з фірми.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => navigate('/team-projects') }, 'До списку'),
    ));
    return;
  }

  const parts = [];

  parts.push(el('h2.page-title', project.title));
  if (project.client) parts.push(el('p.page-subtitle', project.client));

  const facts = [chip(statusLabel(project.status), `status-${project.status}`)];
  if (project.style) facts.push(chip(`🎬 ${project.style}`, 'project'));
  if (project.deadline) {
    facts.push(chip(deadlineLabel(project.deadline), dueVariant(project.deadline)));
  }
  if (project.location) facts.push(chip(`📍 ${project.location}`));
  parts.push(el('div.facts', facts));

  // Маршрут — те, заради чого локація взагалі потрібна на телефоні.
  const navigation = mapsLink({
    latitude: project.latitude,
    longitude: project.longitude,
    // Назву проєкту як адресу не підставляємо: «Кліп для гурту» в Картах
    // не знайдеться, а кнопка обіцяла б маршрут, якого немає.
    label: project.location,
  });
  if (navigation) {
    parts.push(el('a.btn.btn--ghost.btn--wide.map-link',
      { href: navigation, target: '_blank', rel: 'noopener' },
      isValidCoordinate(project.latitude, project.longitude)
        ? `🗺 Прокласти маршрут · ${formatCoordinates(project.latitude, project.longitude, 4)}`
        : '🗺 Знайти локацію в Картах'));
  }

  if (project.shootDays.length) {
    parts.push(sectionTitle('Знімальні дні'));
    parts.push(el('div.list', [...project.shootDays].sort().map((day) => el(
      'article.row',
      { class: daysUntil(day) < 0 ? 'is-past' : '' },
      el('span.row-mark', '🎥'),
      el('div.row-body',
        el('p.row-title', `${formatDate(day)}, ${weekdayShort(day)}`),
        el('p.row-note', daysUntil(day) === 0 ? 'Сьогодні' : describeDue(day))),
    ))));
  }

  host.replaceChildren(...parts);

  const tasksHost = el('div');
  const itemsHost = el('div');
  const moneyHost = el('div');
  host.append(tasksHost, itemsHost, moneyHost);

  loadTasks(tasksHost, project);
  loadItems(itemsHost, project);
  loadMoney(moneyHost, project);
}

async function loadTasks(host, project) {
  host.replaceChildren(sectionTitle('Що зробити'), el('p.settings-note', 'Завантажую…'));

  let tasks;
  try {
    tasks = await sharedTasks(project.id);
  } catch {
    host.replaceChildren(sectionTitle('Що зробити'), el('p.settings-note', 'Не вдалося завантажити.'));
    return;
  }

  if (!tasks.length) {
    host.replaceChildren(sectionTitle('Що зробити'),
      el('p.settings-note', 'Задач по цьому проєкту поки немає.'));
    return;
  }

  const open = tasks.filter((task) => !task.done);
  const done = tasks.filter((task) => task.done);

  // Свої задачі — вгору. Людина шукає в цьому списку саме їх.
  open.sort((a, b) => Number(b.isMine) - Number(a.isMine));

  const parts = [sectionTitle('Що зробити', el('span.section-hint', `${open.length} з ${tasks.length}`))];
  parts.push(el('div.list', open.map(taskRow)));

  if (done.length) {
    parts.push(sectionTitle('Виконано', el('span.section-hint', String(done.length))));
    parts.push(el('div.list.list--muted', done.slice(0, 10).map(taskRow)));
  }

  host.replaceChildren(...parts);
}

function taskRow(task) {
  const meta = [];
  if (task.isMine) meta.push(chip('це тобі', 'money'));
  else if (task.assignee) meta.push(chip(`👤 ${task.assignee}`));
  else meta.push(chip('спільна'));
  if (task.due) meta.push(chip(describeDue(task.due), dueVariant(task.due)));
  if (task.priority === 'high') meta.push(chip('терміново', 'danger'));

  return el(
    'article.row',
    { class: task.done ? 'is-done' : '' },
    el('span.row-mark', task.isMine ? '🙋' : '○'),
    el('div.row-body',
      el('p.row-title', task.title),
      task.notes && el('p.row-note', task.notes),
      el('div.row-meta', meta)),
  );
}

async function loadItems(host, project) {
  host.replaceChildren(sectionTitle('Що везти'), el('p.settings-note', 'Завантажую…'));

  let items;
  try {
    items = await sharedItems(project.id);
  } catch {
    host.replaceChildren(sectionTitle('Що везти'), el('p.settings-note', 'Не вдалося завантажити.'));
    return;
  }

  if (!items.length) {
    host.replaceChildren(sectionTitle('Що везти'),
      el('p.settings-note', 'Техніку по цьому проєкту ще не внесли.'));
    return;
  }

  const rented = items.filter((item) => item.ownership === 'rented');

  const parts = [sectionTitle('Що везти', el('span.section-hint', String(items.length)))];

  // Орендоване — окремим рядком угорі: своє лежить на складі й нікуди не
  // дінеться, а по орендоване треба їхати, і часто не туди, де знімаєш.
  if (rented.length) {
    parts.push(el('p.settings-note',
      `${rented.length} ${rented.length === 1 ? 'позиція береться' : 'позицій беруться'} в ренталі — по неї треба заїхати.`));
  }

  parts.push(el('div.list', items.map((item) => el(
    'article.row',
    el('span.row-mark', item.ownership === 'rented' ? '🚚' : '📦'),
    el('div.row-body',
      el('p.row-title', item.title),
      item.notes && el('p.row-note', item.notes),
      el('div.row-meta',
        item.category ? chip(categoryLabel(item.category)) : null,
        item.count ? chip(item.count) : null,
        chip(item.ownership === 'rented' ? 'орендуємо' : 'своя',
          item.ownership === 'rented' ? 'warn' : ''),
        item.cost > 0 ? chip(`оренда ${formatMoney(item.cost, item.currency)}`) : null)),
  ))));

  host.replaceChildren(...parts);
}

async function loadMoney(host, project) {
  const money = (value) => formatMoney(value, project.currency);
  const parts = [sectionTitle('Гроші')];

  // Порядок навмисний: спершу те, що стосується особисто тебе.
  if (project.myPayout > 0) {
    parts.push(el('div.tool-hero.hero--inline',
      el('p.tool-hero-value', money(project.myPayout)),
      el('p.tool-hero-label', 'твій гонорар за цей проєкт')));
  }

  const rows = el('div.result');
  if (project.rental > 0) rows.append(moneyRow('Оренда техніки', money(project.rental)));
  if (project.other > 0) rows.append(moneyRow('Інші витрати', money(project.other)));
  if (project.fee !== null) rows.append(moneyRow('Платить клієнт', money(project.fee)));
  if (project.payoutTotal !== null) rows.append(moneyRow('Гонорари команді', money(project.payoutTotal)));

  const profit = sharedProfit(project);
  if (profit !== null) rows.append(moneyRow('Лишається фірмі', money(profit), 'accent'));

  if (rows.childElementCount) parts.push(rows);

  if (project.fee === null) {
    parts.push(el('p.settings-note',
      'Суму, яку платить клієнт, бачать директор і адміністратори. Тобі видно оренду техніки й твій власний гонорар.'));
  }

  host.replaceChildren(...parts);

  // Хто ще працює на проєкті — керівникові видно всіх, решті лише себе.
  const payoutsHost = el('div');
  host.append(payoutsHost);

  try {
    const payouts = await projectPayoutRows(project.id);
    if (payouts.length > 1 || (payouts.length === 1 && !payouts[0].isMine)) {
      payoutsHost.replaceChildren(
        sectionTitle('Гонорари'),
        el('div.list', payouts.map((row) => el(
          'article.row',
          el('span.row-mark', row.isMine ? '🙋' : '👤'),
          el('div.row-body',
            el('p.row-title', row.name),
            el('div.row-meta',
              row.role ? chip(row.role) : null,
              chip(formatMoney(row.amount, row.currency), row.isMine ? 'money' : ''))),
        ))),
      );
    }
  } catch {
    // Гонорари — доповнення до екрана, а не його суть: мовчки без них.
  }
}

function moneyRow(label, value, variant = '') {
  return el(`div.result-row${variant ? `.result-row--${variant}` : ''}`,
    el('span.result-label', label),
    el('span.result-value', value));
}

/** «Здача 5 вересня» або «Здача 21 серпня · Післязавтра» — без повтору дати. */
function deadlineLabel(deadline) {
  const human = describeDue(deadline);
  const date = formatDate(deadline);
  return human === date ? `⚑ Здача ${date}` : `⚑ Здача ${date} · ${human}`;
}
