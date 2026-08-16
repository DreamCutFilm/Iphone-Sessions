// Каталог команди: кого наймаєш і за скільки.

import { el, emptyState } from '../dom.js';
import { pageHeader, sectionTitle, chip, fab, statTile } from '../components.js';
import { editCrew } from '../estimate-forms.js';
import { getState } from '../../core/store.js';
import { crewLabel, clientRate, crewMargin } from '../../core/crew.js';
import { formatMoney } from '../../core/locale.js';

export function crewView() {
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
