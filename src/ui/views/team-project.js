// Спільний проєкт зсередини — робочий екран людини, яка їде на майданчик.
//
// Тут має бути відповідь на три питання, з якими відкривають застосунок
// зранку: коли й куди, що я роблю, що везу. Гроші — останні, і кожен бачить
// рівно свої: цифри, яких людині не належить знати, до неї не доїжджають
// із сервера взагалі.

import { el, emptyState, toast, appendIf } from '../dom.js';
import { t } from '../../core/i18n.js';
import { pageHeader, sectionTitle, chip, dueVariant } from '../components.js';
import { navigate } from '../router.js';
import { isSignedIn } from '../../core/cloud.js';
import { currentCompany } from '../../core/context.js';
import { freshnessNote } from '../context-bar.js';
import { permissionsOf } from '../../core/roles.js';
import { firmEstimates } from '../../core/sharing.js';
import { toggleFirmTask } from '../../core/firm-projects.js';
import {
  editFirmProject, editFirmTask, editFirmEstimate, firmItemPicker, editFirmItem,
} from '../firm-project-forms.js';
import {
  companyProjects, sharedTasks, sharedItems, projectPayoutRows, sharedProfit,
} from '../../core/sharing.js';
import { statusLabel } from '../../core/models.js';
import { estimateStatusLabel, unitLabel } from '../../core/estimates.js';
import { categoryLabel } from '../../core/equipment.js';
import { formatMoney } from '../../core/locale.js';
import { formatDate, describeDue, weekdayShort, daysUntil, plural } from '../../core/dates.js';
import { mapsLink, isValidCoordinate, formatCoordinates } from '../../core/geo.js';

export function teamProjectView(projectId) {
  const page = el('div.page');
  page.append(pageHeader('Проєкт фірми', { back: '/team-projects' }));

  if (!isSignedIn() || !currentCompany()) {
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

  const company = currentCompany();
  let project;
  let result;
  try {
    result = await companyProjects(company.id);
    project = result.value.find((entry) => entry.id === projectId) ?? null;
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

  const stale = freshnessNote(result, () => load(host, projectId));
  if (stale) parts.push(stale);

  const mayEdit = permissionsOf(company).can_edit;

  parts.push(el('h2.page-title', project.title));
  if (project.client) parts.push(el('p.page-subtitle', project.client));

  if (mayEdit) {
    parts.push(el('div.form', el('button.btn.btn--ghost.btn--wide', {
      type: 'button',
      onclick: () => editFirmProject(
        { ...project, notes: project.notes ?? '' },
        company,
        () => load(host, projectId),
      ),
    }, '✎ Правити проєкт')));
  }

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
        ? `🗺 ${t('Прокласти маршрут')} · ${formatCoordinates(project.latitude, project.longitude, 4)}`
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
  const estimatesHost = el('div');
  const moneyHost = el('div');
  host.append(tasksHost, itemsHost, estimatesHost, moneyHost);

  const reload = () => load(host, projectId);

  loadTasks(tasksHost, project, company, mayEdit, reload);
  loadItems(itemsHost, project);
  loadEstimates(estimatesHost, project, company, mayEdit, reload);
  loadMoney(moneyHost, project, company, mayEdit, reload);
}

async function loadTasks(host, project, company, mayEdit, reload) {
  host.replaceChildren(sectionTitle('Що зробити'), el('p.settings-note', 'Завантажую…'));

  let tasks;
  try {
    tasks = (await sharedTasks(project.id)).value;
  } catch {
    host.replaceChildren(sectionTitle('Що зробити'), el('p.settings-note', 'Не вдалося завантажити.'));
    return;
  }

  if (!tasks.length) {
    host.replaceChildren(
      sectionTitle('Що зробити'),
      el('p.settings-note', 'Задач по цьому проєкту поки немає.'),
      mayEdit
        ? el('div.form', el('button.btn.btn--ghost.btn--wide', {
            type: 'button',
            onclick: () => editFirmTask(null, company, project.id, reload),
          }, '+ Додати задачу'))
        : null,
    );
    return;
  }

  const open = tasks.filter((task) => !task.done);
  const done = tasks.filter((task) => task.done);

  // Свої задачі — вгору. Людина шукає в цьому списку саме їх.
  open.sort((a, b) => Number(b.isMine) - Number(a.isMine));

  const parts = [sectionTitle(
    'Що зробити',
    mayEdit
      ? el('button.link', {
          type: 'button',
          onclick: () => editFirmTask(null, company, project.id, reload),
        }, '+ додати')
      : el('span.section-hint', `${open.length} ${t('з')} ${tasks.length}`),
  )];
  parts.push(el('div.list', open.map((task) => taskRow(task, { company, project, mayEdit, reload }))));

  if (done.length) {
    parts.push(sectionTitle('Виконано', el('span.section-hint', String(done.length))));
    parts.push(el('div.list.list--muted',
      done.slice(0, 10).map((task) => taskRow(task, { company, project, mayEdit, reload }))));
  }

  host.replaceChildren(...parts);
}

function taskRow(task, { company, project, mayEdit, reload } = {}) {
  const meta = [];
  if (task.isMine) meta.push(chip('це тобі', 'money'));
  else if (task.assignee) meta.push(chip(`👤 ${task.assignee}`));
  else meta.push(chip('спільна'));
  if (task.due) meta.push(chip(describeDue(task.due), dueVariant(task.due)));
  if (task.priority === 'high') meta.push(chip('терміново', 'danger'));

  return el(
    'article.row',
    {
      class: task.done ? 'is-done' : '',
      onclick: mayEdit
        ? () => editFirmTask(
            { ...task, assigneeId: null, assigneeName: task.assignee },
            company, project.id, reload,
          )
        : null,
    },
    el('button.task-check', {
      type: 'button',
      class: task.done ? 'is-done' : '',
      'aria-label': task.done ? 'Повернути в роботу' : 'Позначити виконаною',
      onclick: mayEdit
        ? async (event) => {
            event.stopPropagation();
            try {
              await toggleFirmTask(company.id, project.id, task.id, !task.done);
              reload();
            } catch (error) {
              toast(error?.message ?? 'Не вдалося', { error: true });
            }
          }
        : null,
    }, task.done ? '✓' : ''),
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
    items = (await sharedItems(project.id)).value;
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
      t('{items} {verb} в ренталі — по неї треба заїхати.', {
        items: plural(rented.length, 'позиція', 'позиції', 'позицій'),
        verb: rented.length === 1 ? t('береться') : t('беруться'),
      })));
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
        item.cost > 0 ? chip(`${t('оренда')} ${formatMoney(item.cost, item.currency)}`) : null)),
  ))));

  host.replaceChildren(...parts);
}

/**
 * Кошториси проєкту.
 *
 * Приходять лише тому, кому видно суми клієнта. Для решти команди тут
 * порожньо — і це не помилка завантаження, а правило: кошторис і є ті самі
 * гроші клієнта, тільки розписані по рядках.
 */
async function loadEstimates(host, project, company, mayEdit, reload) {
  const perms = permissionsOf(company);
  if (!perms.can_see_client_money) return;

  host.replaceChildren(sectionTitle('Кошториси'), el('p.settings-note', 'Завантажую…'));

  let result;
  try {
    result = await firmEstimates(project.id);
  } catch (error) {
    host.replaceChildren(sectionTitle('Кошториси'),
      el('p.settings-note', error?.message ?? 'Не вдалося завантажити.'));
    return;
  }

  const estimates = result.value;
  const parts = [sectionTitle(
    'Кошториси',
    mayEdit
      ? el('button.link', {
          type: 'button',
          onclick: () => editFirmEstimate(null, company, project.id, reload),
        }, '+ додати')
      : el('span.section-hint', String(estimates.length)),
  )];

  if (!estimates.length) {
    parts.push(el('p.settings-note', mayEdit
      ? 'Кошторису ще немає. Склади — позиції беруться з каталогу фірми, '
        + 'а гроші проєкту порахуються самі.'
      : 'Кошторисів ще немає.'));
    host.replaceChildren(...parts);
    return;
  }

  for (const estimate of estimates) {
    const totals = firmTotals(estimate);

    parts.push(el('article.card',
      el('div.card-body',
        el('p.card-title', estimate.title),
        el('div.row-meta',
          chip(estimateStatusLabel(estimate.status),
            estimate.status === 'approved' ? 'money' : ''),
          chip(plural(estimate.items.length, 'позиція', 'позиції', 'позицій')),
          chip(formatMoney(totals.forClient, estimate.currency), 'money')),
        estimate.items.length
          ? el('div.list', estimate.items.map((item) => el(
              'article.row',
              mayEdit ? { onclick: () => editFirmItem(item, estimate, company, reload) } : null,
              el('div.row-body',
                el('p.row-title', item.title),
                el('div.row-meta',
                  chip(`${item.quantity > 1 ? `${item.quantity} × ` : ''}`
                    + `${item.shifts} ${unitLabel(item.unit, item.shifts)}`),
                  item.internalOnly ? chip('не в рахунку', 'warn') : null,
                  chip(`${t('нам')} ${formatMoney(item.quantity * item.shifts * item.unitCost, estimate.currency)}`))),
              el('span.item-amount',
                formatMoney(item.internalOnly ? 0 : item.quantity * item.shifts * item.unitPrice, estimate.currency)),
            )))
          : el('p.settings-note', 'Позицій ще немає.'),
        mayEdit
          ? el('div.form',
              el('button.btn.btn--ghost.btn--wide', {
                type: 'button',
                onclick: () => firmItemPicker(estimate, company, reload),
              }, '+ Позиція з каталогу фірми'),
              el('button.link', {
                type: 'button',
                onclick: () => editFirmEstimate(estimate, company, project.id, reload),
              }, 'Налаштування кошторису'))
          : null),
    ));
  }

  host.replaceChildren(...parts);
}

/** Підсумок кошторису фірми: те саме, що рахує база, але для екрана. */
function firmTotals(estimate) {
  let forClient = 0;
  let cost = 0;

  for (const item of estimate.items) {
    const amount = item.quantity * item.shifts * item.unitPrice;
    if (!item.internalOnly) forClient += amount;
    cost += item.quantity * item.shifts * item.unitCost;
  }

  const afterDiscount = forClient * (1 - (estimate.discountPercent || 0) / 100);
  return {
    forClient: Math.round(afterDiscount * 100) / 100,
    cost: Math.round(cost * 100) / 100,
  };
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
    const payouts = (await projectPayoutRows(project.id)).value;
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
  return human === date
    ? `⚑ ${t('Здача')} ${date}`
    : `⚑ ${t('Здача')} ${date} · ${human}`;
}
