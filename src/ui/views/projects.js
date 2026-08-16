// Проєкти: список за стадіями та картка окремого проєкту.

import { el, emptyState } from '../dom.js';
import { pageHeader, sectionTitle, projectCard, taskRow, chip, fab, dueVariant, formatMoney } from '../components.js';
import { editProject, editTask } from '../editors.js';
import { editEstimate } from '../estimate-forms.js';
import { estimateTotals, estimateStatusLabel } from '../../core/estimates.js';
// Кошторис показуємо у ВЛАСНІЙ валюті, зафіксованій у ньому, а не в поточній
// із налаштувань — тому тут потрібна саме версія з явним аргументом.
import { formatMoney as formatMoneyIn } from '../../core/locale.js';
import { getState } from '../../core/store.js';
import { projectById, tasksOfProject, projectPayouts, projectFinance } from '../../core/selectors.js';
import { PROJECT_STATUSES, ACTIVE_STATUSES, statusLabel } from '../../core/models.js';
import { formatDate, describeDue, weekdayShort, daysUntil } from '../../core/dates.js';
import { mapsLink, isValidCoordinate, formatCoordinates } from '../../core/geo.js';
import { navigate } from '../router.js';

export function projectsView() {
  const state = getState();
  const page = el('div.page');

  page.append(pageHeader('Проєкти', {
    subtitle: `${state.projects.length} усього`,
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Новий проєкт', onclick: () => editProject() }, '+'),
  }));

  if (!state.projects.length) {
    page.append(emptyState(
      'Проєктів ще немає',
      'Проєкт — це рамка для дедлайну, знімальних днів, задач та ідей.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => editProject() }, 'Створити перший'),
    ));
    return page;
  }

  // Групуємо за стадією у природному порядку виробництва.
  for (const status of PROJECT_STATUSES) {
    const group = state.projects
      .filter((project) => project.status === status.id)
      .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
    if (!group.length) continue;

    page.append(sectionTitle(status.label, el('span.section-hint', String(group.length))));
    page.append(el('div.list', group.map((project) => {
      const tasks = tasksOfProject(state, project.id);
      return projectCard(project, {
        taskCount: tasks.length,
        openCount: tasks.filter((task) => !task.done).length,
      });
    })));
  }

  page.append(fab('Новий проєкт', () => editProject()));
  return page;
}

export function projectDetailView(projectId) {
  const state = getState();
  const project = projectById(state, projectId);
  const page = el('div.page');

  if (!project) {
    page.append(pageHeader('Проєкт', { back: '/projects' }));
    page.append(emptyState('Проєкт не знайдено', 'Можливо, його видалили.'));
    return page;
  }

  const tasks = tasksOfProject(state, project.id);
  const openTasks = tasks.filter((task) => !task.done);
  const doneTasks = tasks.filter((task) => task.done);
  const ideas = state.ideas.filter((idea) => idea.projectId === project.id);

  page.append(pageHeader(project.title, {
    subtitle: project.client || null,
    back: '/projects',
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Редагувати', onclick: () => editProject(project) }, '✎'),
  }));

  const facts = [chip(statusLabel(project.status), `status-${project.status}`)];
  if (project.style) facts.push(chip(`🎬 ${project.style}`, 'project'));
  if (project.deadline) facts.push(chip(`⚑ Здача ${formatDate(project.deadline)} · ${describeDue(project.deadline)}`, dueVariant(project.deadline)));
  if (project.location) facts.push(chip(`📍 ${project.location}`));
  if (typeof project.fee === 'number') facts.push(chip(`${formatMoney(project.fee)} · ${project.paid ? 'оплачено' : 'не оплачено'}`, project.paid ? '' : 'money'));
  page.append(el('div.facts', facts));

  // Посилання відкриває нативні «Карти» — з майданчика туди й треба доїхати.
  const navigation = mapsLink({
    latitude: project.latitude,
    longitude: project.longitude,
    label: project.location || project.title,
  });
  if (navigation) {
    page.append(el(
      'a.btn.btn--ghost.btn--wide.map-link',
      { href: navigation, target: '_blank', rel: 'noopener' },
      isValidCoordinate(project.latitude, project.longitude)
        ? `🗺 Прокласти маршрут · ${formatCoordinates(project.latitude, project.longitude, 4)}`
        : '🗺 Знайти локацію в Картах',
    ));
  }

  if (project.notes) {
    page.append(el('div.note-card', project.notes));
  }

  if (project.shootDays.length) {
    page.append(sectionTitle('Знімальні дні'));
    const sorted = [...project.shootDays].sort();
    page.append(el('div.list', sorted.map((day) => {
      const diff = daysUntil(day);
      return el(
        'article.row',
        { class: diff < 0 ? 'is-past' : '' },
        el('span.row-mark', '🎥'),
        el('div.row-body',
          el('p.row-title', `${formatDate(day)}, ${weekdayShort(day)}`),
          el('p.row-note', diff === 0 ? 'Сьогодні' : describeDue(day))),
      );
    })));
  }

  page.append(sectionTitle(
    'Задачі',
    el('button.link', { type: 'button', onclick: () => editTask(null, { projectId: project.id }) }, '+ додати'),
  ));
  page.append(openTasks.length
    ? el('div.list', openTasks.map((task) => taskRow(task, { onEdit: (item) => editTask(item) })))
    : emptyState('Відкритих задач немає', 'Усе, що треба зробити для цього проєкту, тримай тут.'));

  if (doneTasks.length) {
    page.append(sectionTitle('Виконано', el('span.section-hint', String(doneTasks.length))));
    page.append(el('div.list.list--muted', doneTasks.slice(0, 10).map((task) => taskRow(task, { onEdit: (item) => editTask(item) }))));
  }

  const estimates = state.estimates.filter((estimate) => estimate.projectId === project.id);
  page.append(sectionTitle(
    'Кошториси',
    el('button.link', { type: 'button', onclick: () => editEstimate(null, { projectId: project.id, title: project.title }) }, '+ додати'),
  ));
  page.append(estimates.length
    ? el('div.list', estimates.map((estimate) => {
        const totals = estimateTotals(estimate);
        return el(
          'article.row',
          { onclick: () => navigate(`/estimates/${estimate.id}`) },
          el('div.row-body',
            el('p.row-title', estimate.title),
            el('div.row-meta',
              chip(estimateStatusLabel(estimate.status)),
              chip(`${totals.itemCount} позицій`))),
          el('span.item-amount', formatMoneyIn(totals.total, estimate.currency)),
        );
      }))
    : emptyState('Кошторису ще немає', 'Склади — позиції беруться з каталогу техніки.'));

  // Гроші проєкту: скільки платить клієнт, скільки з цього піде на оренду
  // та гонорари, і що лишається тобі.
  const finance = projectFinance(state, project.id);
  if (finance.income > 0 || finance.expenses > 0) {
    page.append(sectionTitle('Гроші', finance.basisLabel ? el('span.section-hint', finance.basisLabel) : null));

    page.append(el('div.tool-hero.hero--inline',
      el('p.tool-hero-value', formatMoneyIn(finance.profit, finance.currency)),
      el('p.tool-hero-label',
        finance.profit >= 0
          ? `лишається тобі · ${finance.marginPercent}% від суми клієнта`
          : 'збиток — витрати більші за суму клієнта')));

    page.append(el('div.result',
      moneyRow('Клієнт платить', formatMoneyIn(finance.income, finance.currency), 'accent'),
      finance.rental > 0 ? moneyRow('Оренда техніки', `−${formatMoneyIn(finance.rental, finance.currency)}`) : null,
      finance.payouts > 0 ? moneyRow('Гонорари команді', `−${formatMoneyIn(finance.payouts, finance.currency)}`) : null,
      finance.other > 0 ? moneyRow('Інші витрати', `−${formatMoneyIn(finance.other, finance.currency)}`) : null,
      moneyRow('Усього витрат', `−${formatMoneyIn(finance.expenses, finance.currency)}`),
      moneyRow('Заробіток', formatMoneyIn(finance.profit, finance.currency), finance.profit >= 0 ? 'accent' : 'danger'),
    ));

    page.append(el('p.settings-note',
      'Сума клієнта — без податку: він проходить крізь тебе й твоїм заробітком ніколи не був. ' +
      'Це видно лише тобі.'));
  }

  // Гонорари — окремою графою одразу під кошторисами. Це не другий список,
  // а зведення тих самих позицій: скільки ти маєш виплатити людям.
  const payouts = projectPayouts(state, project.id);
  if (payouts.people.length) {
    page.append(sectionTitle(
      'Гонорари',
      el('span.section-hint', formatMoneyIn(payouts.total, payouts.currency)),
    ));
    page.append(el('div.list', payouts.people.map((person) => el(
      'article.row',
      person.crewId ? { onclick: () => navigate('/crew') } : null,
      el('span.row-mark', '👤'),
      el('div.row-body',
        el('p.row-title', person.title),
        el('p.row-note', person.lines.length > 1
          ? `${person.lines.length} позиції в кошторисах`
          : person.lines[0].entry.count)),
      el('span.item-amount', formatMoneyIn(person.payout, person.currency)),
    ))));
    page.append(el('p.settings-note',
      'Це те, що ти виплачуєш команді. Суми беруться з кошторисів проєкту, тож розійтися з ними не можуть.'));
  }

  if (ideas.length) {
    page.append(sectionTitle('Ідеї', el('button.link', { type: 'button', onclick: () => navigate('/ideas') }, 'усі')));
    page.append(el('div.list', ideas.slice(0, 5).map((idea) => el(
      'article.row',
      el('span.row-mark', '✳'),
      el('div.row-body', el('p.row-title', idea.title), idea.body && el('p.row-note', idea.body)),
    ))));
  }

  page.append(fab('Нова задача', () => editTask(null, { projectId: project.id })));
  return page;
}

/** Рядок підсумку в блоці грошей. */
function moneyRow(label, value, variant = '') {
  return el(`div.result-row${variant ? `.result-row--${variant}` : ''}`,
    el('span.result-label', label),
    el('span.result-value', value));
}

export { ACTIVE_STATUSES };
