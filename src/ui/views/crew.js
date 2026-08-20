// Каталог команди: кого наймаєш і за скільки.

import { el, emptyState } from '../dom.js';
import { pageHeader, sectionTitle, chip, fab, statTile } from '../components.js';
import { editCrew } from '../estimate-forms.js';
import { getState } from '../../core/store.js';
import { crewLabel, clientRate, crewMargin } from '../../core/crew.js';
import { formatMoney } from '../../core/locale.js';
import { inCompany, currentCompany } from '../../core/context.js';
import { permissionsOf } from '../../core/roles.js';
import { firmCrew } from '../../core/catalog.js';
import { editFirmPerson } from '../firm-forms.js';
import { freshnessNote } from '../context-bar.js';

export function crewView() {
  return inCompany() ? firmPeopleView() : myCrewView();
}

/**
 * Каталог команди фірми.
 *
 * Хто кого бачить, вирішує сервер: керівник — усіх із гонорарами, людина
 * без дозволу — лише власний рядок. Тому порожній список тут не означає
 * «у фірмі нікого»: він може означати «тобі видно тільки себе, а тебе
 * в каталог ще не внесли».
 */
function firmPeopleView() {
  const company = currentCompany();
  const page = el('div.page');

  page.append(pageHeader('Команда фірми', { subtitle: company.name, back: '/estimates' }));

  const host = el('div');
  page.append(host);
  loadFirmPeople(host, company);

  return page;
}

async function loadFirmPeople(host, company) {
  host.replaceChildren(el('p.settings-note', 'Завантажую…'));

  let result;
  try {
    result = await firmCrew(company.id);
  } catch (error) {
    host.replaceChildren(
      el('p.settings-note', error?.message ?? 'Немає звʼязку з сервером'),
      el('div.form', el('button.btn.btn--ghost.btn--wide', {
        type: 'button', onclick: () => loadFirmPeople(host, company),
      }, 'Спробувати ще раз')),
    );
    return;
  }

  const team = result.value.filter((member) => !member.archived);
  const currency = getState().settings.currency;
  const mayEdit = permissionsOf(company).can_edit;
  const parts = [];

  const stale = freshnessNote(result, () => loadFirmPeople(host, company));
  if (stale) parts.push(stale);

  if (!team.length) {
    parts.push(emptyState(
      'Порожньо',
      mayEdit
        ? 'Внеси людей із їхніми гонорарами — або перенеси свій каталог на сторінці фірми.'
        : 'Каталог команди тобі не показують. Свій гонорар видно в самому проєкті.',
      mayEdit
        ? el('button.btn.btn--primary', { type: 'button', onclick: () => editFirmPerson(null, company, () => loadFirmPeople(host, company)) }, 'Додати людину')
        : null,
    ));
    host.replaceChildren(...parts);
    return;
  }

  const byRole = new Map();
  for (const member of team) {
    if (!byRole.has(member.role)) byRole.set(member.role, []);
    byRole.get(member.role).push(member);
  }

  parts.push(sectionTitle('У каталозі', el('span.section-hint', String(team.length))));

  for (const [role, members] of [...byRole.entries()].sort((a, b) => a[0].localeCompare(b[0], 'uk'))) {
    parts.push(sectionTitle(role, el('span.section-hint', String(members.length))));
    parts.push(el('div.list', members.map((member) => el(
      'article.row',
      member.canEdit
        ? { onclick: () => editFirmPerson(member, company, () => loadFirmPeople(host, company)) }
        : null,
      el('span.row-mark', member.isMe ? '🙋' : '👤'),
      el('div.row-body',
        el('p.row-title', member.name || member.role),
        member.notes && el('p.row-note', member.notes),
        el('div.row-meta',
          member.isMe ? chip('це ти', 'money') : null,
          member.userId ? chip('є в застосунку') : chip('без акаунта'),
          member.rate !== null ? chip(`клієнту ${formatMoney(member.rate, currency)}`) : null)),
      member.fee !== null ? el('span.item-amount', formatMoney(member.fee, currency)) : null,
    ))));
  }

  host.replaceChildren(...parts);

  if (mayEdit) {
    host.append(el('div.form', el('button.btn.btn--ghost.btn--wide', {
      type: 'button',
      onclick: () => editFirmPerson(null, company, () => loadFirmPeople(host, company)),
    }, '+ Додати людину')));
  }
}

function myCrewView() {
  const state = getState();
  const currency = state.settings.currency;
  const team = state.crew;
  const page = el('div.page');

  page.append(pageHeader('Команда', {
    subtitle: `${team.length} людей`,
    back: '/estimates',
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Додати людину', onclick: () => editCrew() }, '+'),
  }));

  if (!team.length) {
    page.append(emptyState(
      'У команді ще нікого немає',
      'Внеси операторів, монтажера, режисера трансляції з їхніми гонорарами — і додаватимеш їх у кошторис одним тапом, як техніку.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => editCrew() }, 'Додати першу людину'),
    ));
    page.append(fab('Додати людину', () => editCrew()));
    return page;
  }

  // Скільки коштує одна зміна, якщо вивести всю команду.
  const shiftCost = team.reduce((sum, member) => sum + (member.fee ?? 0), 0);
  const shiftBilled = team.reduce((sum, member) => sum + clientRate(member), 0);

  page.append(el('div.stats',
    statTile(String(team.length), 'у команді'),
    statTile(formatMoney(shiftCost, currency), 'зміна цілком'),
    statTile(formatMoney(shiftBilled - shiftCost, currency), 'твоє зверху')));

  // Групуємо за роллю: так видно, скільки в тебе операторів і хто ще потрібен.
  const byRole = new Map();
  for (const member of team) {
    if (!byRole.has(member.role)) byRole.set(member.role, []);
    byRole.get(member.role).push(member);
  }

  const roles = [...byRole.keys()].sort((a, b) => a.localeCompare(b, 'uk'));

  for (const role of roles) {
    const group = byRole.get(role).sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    page.append(sectionTitle(role, el('span.section-hint', String(group.length))));

    page.append(el('div.list', group.map((member) => {
      const margin = crewMargin(member);

      return el(
        'article.row',
        { onclick: () => editCrew(member) },
        el('div.row-body',
          el('p.row-title', member.name || member.role),
          member.notes && el('p.row-note', member.notes),
          el('div.row-meta',
            member.phone ? chip(`📞 ${member.phone}`) : null,
            margin > 0 ? chip(`+${formatMoney(margin, currency)} тобі`, 'money') : null)),
        el('span.item-amount', formatMoney(member.fee ?? 0, currency)),
      );
    })));
  }

  page.append(fab('Додати людину', () => editCrew()));
  return page;
}
