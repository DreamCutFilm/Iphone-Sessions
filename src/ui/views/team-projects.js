// Проєкти фірми — спільний екран для всієї команди.
//
// Один і той самий екран показує різне різним людям, і це не хитрість
// інтерфейсу: чисел, яких людині не належить бачити, у відповіді сервера
// просто немає. Тому тут ніде немає перевірок «якщо роль така — сховати».
// Замість них скрізь одне питання: це число прийшло чи ні.

import { el, emptyState } from '../dom.js';
import { pageHeader, sectionTitle, chip, dueVariant } from '../components.js';
import { navigate } from '../router.js';
import { isSignedIn } from '../../core/cloud.js';
import { currentCompany } from '../../core/context.js';
import { freshnessNote } from '../context-bar.js';
import { companyProjects, sharedProfit } from '../../core/sharing.js';
import { statusLabel } from '../../core/models.js';
import { formatMoney } from '../../core/locale.js';
import { describeDue, plural } from '../../core/dates.js';

export function teamProjectsView() {
  const page = el('div.page');
  page.append(pageHeader('Проєкти фірми', { back: '/overview' }));

  if (!isSignedIn()) {
    page.append(emptyState(
      'Потрібен акаунт',
      'Спільні проєкти живуть у фірмі. Увійди — і побачиш те, над чим працює команда.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => navigate('/account') }, 'Увійти'),
    ));
    return page;
  }

  const company = currentCompany();
  if (!company) {
    page.append(emptyState(
      'Ти ще не у фірмі',
      'Створи свою або приєднайся до наявної — і тут зʼявляться спільні проєкти.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => navigate('/account') }, 'До акаунта'),
    ));
    return page;
  }

  const host = el('div');
  page.append(host);
  load(host, company);

  return page;
}

async function load(host, company) {
  host.replaceChildren(sectionTitle(company.name), el('p.settings-note', 'Завантажую…'));

  let result;
  try {
    result = await companyProjects(company.id);
  } catch (error) {
    host.replaceChildren(
      sectionTitle(company.name),
      el('p.settings-note', error?.message ?? 'Немає звʼязку з сервером'),
      el('div.form', el('button.btn.btn--ghost.btn--wide', {
        type: 'button', onclick: () => load(host, company),
      }, 'Спробувати ще раз')),
    );
    return;
  }

  const projects = result.value;

  if (!projects.length) {
    host.replaceChildren(
      sectionTitle(company.name),
      el('p.settings-note',
        company.role === 'member'
          ? 'Тут поки порожньо. Проєкти зʼявляться, коли керівник їх опублікує.'
          : 'Тут поки порожньо. Відкрий свій проєкт і натисни «Опублікувати у фірмі» — '
            + 'команда одразу побачить зйомку, а кожен свій гонорар.'),
    );
    return;
  }

  const parts = [sectionTitle(company.name, el('span.section-hint', plural(projects.length, 'проєкт', 'проєкти', 'проєктів')))];
  parts.push(el('div.list', projects.map((project) => projectCard(project))));
  const stale = freshnessNote(result, () => load(host, company));
  if (stale) parts.push(stale);

  parts.push(el('div.form', el('button.btn.btn--ghost.btn--wide', {
    type: 'button', onclick: () => load(host, company),
  }, '⟳ Оновити')));

  host.replaceChildren(...parts);
}

function projectCard(project) {
  const meta = [chip(statusLabel(project.status), `status-${project.status}`)];
  if (project.style) meta.push(chip(project.style, 'project'));
  if (project.deadline) meta.push(chip(`⚑ ${describeDue(project.deadline)}`, dueVariant(project.deadline)));
  if (project.shootDays.length) meta.push(chip(`🎥 ${plural(project.shootDays.length, 'зміна', 'зміни', 'змін')}`));
  if (project.location) meta.push(chip(`📍 ${project.location}`));

  return el(
    'article.card',
    { onclick: () => navigate(`/team-projects/${project.id}`) },
    el(
      'div.card-body',
      el('p.card-title', project.title),
      project.client && el('p.card-sub', project.client),
      el('div.row-meta', meta),
      moneyBlock(project),
    ),
    el('span.card-chevron', '›'),
  );
}

/**
 * Гроші проєкту.
 *
 * Рядок зʼявляється тільки тоді, коли число справді прийшло. Порожнє поле
 * означає «не для тебе», і показувати замість нього нуль чи прочерк не можна:
 * і те, і те читалося б як «зйомка безкоштовна».
 */
function moneyBlock(project) {
  const rows = el('div.row-meta');
  const money = (value) => formatMoney(value, project.currency);

  if (project.fee !== null) rows.append(chip(`Клієнт: ${money(project.fee)}`, 'money'));
  if (project.rental > 0) rows.append(chip(`Оренда: ${money(project.rental)}`));
  if (project.payoutTotal !== null && project.payoutTotal > 0) {
    rows.append(chip(`Гонорари: ${money(project.payoutTotal)}`));
  }
  if (project.myPayout > 0) rows.append(chip(`Мій гонорар: ${money(project.myPayout)}`, 'money'));

  const profit = sharedProfit(project);
  if (profit !== null) {
    rows.append(chip(`Заробіток: ${money(profit)}`, profit >= 0 ? 'money' : 'danger'));
  }

  return rows;
}

