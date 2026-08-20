// Проєкти: список за стадіями та картка окремого проєкту.

import { el, emptyState, toast, appendIf } from '../dom.js';
import { t } from '../../core/i18n.js';
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
import { formatDate, describeDue, weekdayShort, daysUntil, plural } from '../../core/dates.js';
import { mapsLink, isValidCoordinate, formatCoordinates } from '../../core/geo.js';
import { navigate } from '../router.js';
import { confirmSheet } from '../sheet.js';
import { isSignedIn } from '../../core/cloud.js';
import { canManage } from '../../core/account.js';
import { currentCompany, inCompany } from '../../core/context.js';
import { contextBar, freshnessNote } from '../context-bar.js';
import { permissionsOf } from '../../core/roles.js';
import { editFirmProject } from '../firm-project-forms.js';
import {
  buildProjectPayload, unlinkedPayouts, publishProject, unpublishProject, companyProjects,
} from '../../core/sharing.js';

export function projectsView() {
  return inCompany() ? firmProjectsView() : myProjectsView();
}

/**
 * Проєкти фірми як головний список.
 *
 * Коли застосунок дивиться очима фірми, її проєкти — це не додаток збоку,
 * а весь зміст екрана. У людини з команди своїх проєктів немає взагалі,
 * і показувати їй «створи перший» замість завтрашньої зйомки — знущання.
 */
function firmProjectsView() {
  const company = currentCompany();
  const page = el('div.page');

  const mayEdit = permissionsOf(company).can_edit;

  page.append(pageHeader('Проєкти', {
    subtitle: company.name,
    action: mayEdit
      ? el('button.icon-btn', {
          type: 'button',
          'aria-label': 'Новий проєкт фірми',
          onclick: () => editFirmProject(null, company, () => navigate('/projects')),
        }, '+')
      : null,
  }));
  appendIf(page, contextBar());

  const host = el('div');
  page.append(host);
  loadFirmProjects(host, company);

  return page;
}

async function loadFirmProjects(host, company) {
  host.replaceChildren(el('p.settings-note', 'Завантажую…'));

  let result;
  try {
    result = await companyProjects(company.id);
  } catch (error) {
    host.replaceChildren(
      el('p.settings-note', error?.message ?? 'Немає звʼязку з сервером'),
      el('div.form', el('button.btn.btn--ghost.btn--wide', {
        type: 'button', onclick: () => loadFirmProjects(host, company),
      }, 'Спробувати ще раз')),
    );
    return;
  }

  const projects = result.value;
  const parts = [];

  const stale = freshnessNote(result, () => loadFirmProjects(host, company));
  if (stale) parts.push(stale);

  if (!projects.length) {
    parts.push(emptyState(
      t('У «{company}» поки порожньо', { company: company.name }),
      mayEditHere(company)
        ? 'Створи перший — кнопкою «+» угорі. Або перемкнись на «Моє» й перенеси туди свій.'
        : 'Проєкти зʼявляться, коли керівник їх заведе.',
      mayEditHere(company)
        ? el('button.btn.btn--primary', {
            type: 'button',
            onclick: () => editFirmProject(null, company, () => navigate('/projects')),
          }, 'Створити проєкт')
        : null,
    ));
  } else {
    // Групуємо так само, як власні: за стадією виробництва. Людина не має
    // перевчатися, перемкнувшись на фірму.
    for (const status of PROJECT_STATUSES) {
      const group = projects
        .filter((project) => project.status === status.id)
        .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
      if (!group.length) continue;

      parts.push(sectionTitle(status.label, el('span.section-hint', String(group.length))));
      parts.push(el('div.list', group.map(firmProjectCard)));
    }
  }

  host.replaceChildren(...parts);
}

function firmProjectCard(project) {
  const meta = [chip(statusLabel(project.status), `status-${project.status}`)];
  if (project.deadline) meta.push(chip(`⚑ ${describeDue(project.deadline)}`, dueVariant(project.deadline)));
  if (project.shootDays.length) meta.push(chip(`🎥 ${project.shootDays.length}`));
  if (project.location) meta.push(chip(`📍 ${project.location}`));
  if (project.myPayout > 0) meta.push(chip(formatMoneyIn(project.myPayout, project.currency), 'money'));

  return el(
    'article.card',
    { onclick: () => navigate(`/team-projects/${project.id}`) },
    el('div.card-body',
      el('p.card-title', project.title),
      project.client && el('p.card-sub', project.client),
      el('div.row-meta', meta)),
    el('span.card-chevron', '›'),
  );
}

function myProjectsView() {
  const state = getState();
  const page = el('div.page');

  page.append(pageHeader('Проєкти', {
    subtitle: t('{count} своїх', { count: state.projects.length }),
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Новий проєкт', onclick: () => editProject() }, '+'),
  }));

  appendIf(page, contextBar());

  if (!state.projects.length) {
    page.append(emptyState(
      'Своїх проєктів ще немає',
      'Проєкт — це рамка для дедлайну, знімальних днів, задач та ідей.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => editProject() }, 'Створити перший'),
    ));
    return page;
  }

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
  if (project.deadline) facts.push(chip(deadlineLabel(project.deadline), dueVariant(project.deadline)));
  if (project.location) facts.push(chip(`📍 ${project.location}`));
  if (typeof project.fee === 'number') facts.push(chip(`${formatMoney(project.fee)} · ${project.paid ? t('оплачено') : t('не оплачено')}`, project.paid ? '' : 'money'));
  page.append(el('div.facts', facts));

  // Посилання відкриває нативні «Карти» — з майданчика туди й треба доїхати.
  const navigation = mapsLink({
    latitude: project.latitude,
    longitude: project.longitude,
    // Назву проєкту як адресу не підставляємо: «Кліп для гурту» в Картах
    // не знайдеться, а кнопка обіцяла б маршрут, якого немає.
    label: project.location,
  });
  if (navigation) {
    page.append(el(
      'a.btn.btn--ghost.btn--wide.map-link',
      { href: navigation, target: '_blank', rel: 'noopener' },
      isValidCoordinate(project.latitude, project.longitude)
        ? `🗺 ${t('Прокласти маршрут')} · ${formatCoordinates(project.latitude, project.longitude, 4)}`
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
              chip(plural(totals.itemCount, 'позиція', 'позиції', 'позицій')))),
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
          ? t('лишається тобі · {percent}% від суми клієнта', { percent: finance.marginPercent })
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
          ? t('{count} позиції в кошторисах', { count: person.lines.length })
          : person.lines[0].entry.count)),
      el('span.item-amount', formatMoneyIn(person.payout, person.currency)),
    ))));
    page.append(el('p.settings-note',
      'Це те, що ти виплачуєш команді. Суми беруться з кошторисів проєкту, тож розійтися з ними не можуть.'));
  }

  const sharing = sharingBlock(state, project);
  if (sharing) {
    page.append(sectionTitle('Фірма'));
    page.append(sharing);
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

/**
 * Публікація проєкту у фірму.
 *
 * Свідомо ручна дія, а не автоматична синхронізація. Проєкт у роботі змінюється
 * щогодини — половина сум чорнові, людей ще не підтверджено. Автоматичне
 * вивантаження показувало б команді ці чернетки як факт, і кожна правка ставала б
 * оголошенням. Тому команда бачить проєкт тоді, коли ти сам вирішив його показати.
 */
function sharingBlock(state, project) {
  if (!isSignedIn()) return null;

  const company = currentCompany();
  if (!company) return null;

  if (!canManage(company.role)) {
    return el('p.settings-note',
      t('Ти в команді «{company}». Публікувати проєкти може директор або адміністратор.', { company: company.name }));
  }

  const payload = buildProjectPayload(state, project.id);
  const unlinked = unlinkedPayouts(payload);

  const block = el('div.form');

  block.append(el('button.btn.btn--primary.btn--wide', {
    type: 'button',
    onclick: async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = t('Публікую…');
      try {
        await publishProject(company.id, getState(), project.id);
        toast(t('Опубліковано у «{company}»', { company: company.name }));
      } catch (error) {
        toast(error?.message ?? 'Немає звʼязку з сервером', { error: true });
      } finally {
        button.disabled = false;
        button.textContent = t('↑ Опублікувати у фірмі');
      }
    },
  }, '↑ Опублікувати у фірмі'));

  block.append(el('p.settings-note',
    'Команда побачить зйомку, дати, локацію й оренду техніки. Суму клієнта й загальні '
    + 'гонорари бачиш тільки ти та адміністратори — сервер не віддає їх решті. '
    + 'Кожен бачить свій гонорар.'));

  // Гонорар без пошти нікому не належить: людина відкриє застосунок і не побачить
  // нічого. Мовчати про це не можна — помилку помітили б лише через тиждень.
  if (unlinked.length) {
    block.append(el('p.settings-note',
      t('⚠ Не побачать свій гонорар, бо в картці немає пошти: {names}. ', { names: unlinked.join(', ') })
      + 'Впиши пошту в каталозі команди — ту саму, якою людина заходить у застосунок.'));
    block.append(el('button.btn.btn--ghost.btn--wide', {
      type: 'button', onclick: () => navigate('/crew'),
    }, 'До каталогу команди'));
  }

  block.append(el('button.btn.btn--ghost.btn--wide', {
    type: 'button', onclick: () => navigate('/team-projects'),
  }, 'Проєкти фірми'));

  block.append(el('button.btn.btn--danger.btn--wide', {
    type: 'button',
    onclick: () => confirmSheet({
      title: 'Прибрати з фірми?',
      message: 'Проєкт зникне у команди. На цьому телефоні він залишиться недоторканим.',
      confirmLabel: 'Прибрати',
      onConfirm: async () => {
        try {
          await unpublishProject(company.id, project.id);
          toast('Прибрано з фірми');
        } catch (error) {
          toast(error?.message ?? 'Немає звʼязку з сервером', { error: true });
        }
      },
    }),
  }, 'Прибрати з фірми'));

  return block;
}

/** Рядок підсумку в блоці грошей. */
function moneyRow(label, value, variant = '') {
  return el(`div.result-row${variant ? `.result-row--${variant}` : ''}`,
    el('span.result-label', label),
    el('span.result-value', value));
}

export { ACTIVE_STATUSES };

/** «Здача 5 вересня» або «Здача 21 серпня · Післязавтра» — без повтору дати. */
function deadlineLabel(deadline) {
  const human = describeDue(deadline);
  const date = formatDate(deadline);
  return human === date
    ? `⚑ ${t('Здача')} ${date}`
    : `⚑ ${t('Здача')} ${date} · ${human}`;
}

/** Чи можу я тут щось міняти. Винесено, бо питається з двох місць. */
function mayEditHere(company) {
  return permissionsOf(company).can_edit;
}
