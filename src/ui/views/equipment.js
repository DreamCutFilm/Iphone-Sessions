// Каталог техніки з цінами оренди.

import { el, emptyState } from '../dom.js';
import { pageHeader, sectionTitle, chip, fab, statTile } from '../components.js';
import { editEquipment } from '../estimate-forms.js';
import { getState } from '../../core/store.js';
import { EQUIPMENT_CATEGORIES, unitMargin } from '../../core/equipment.js';
import { formatMoney } from '../../core/locale.js';

export function equipmentView() {
  const state = getState();
  const currency = state.settings.currency;
  const catalog = state.equipment;
  const page = el('div.page');

  page.append(pageHeader('Каталог техніки', {
    subtitle: `${catalog.length} позицій`,
    back: '/estimates',
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Додати техніку', onclick: () => editEquipment() }, '+'),
  }));

  if (!catalog.length) {
    page.append(emptyState(
      'Каталог порожній',
      'Внеси свою техніку з цінами оренди — і кошториси складатимуться в кілька тапів, без згадування цін напамʼять.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => editEquipment() }, 'Додати першу позицію'),
    ));
    page.append(fab('Додати техніку', () => editEquipment()));
    return page;
  }

  // Скільки коштує зміна, якщо виставити геть усе — орієнтир для великих зйомок.
  const dayTotal = catalog.reduce((sum, item) => sum + (item.dayRate ?? 0), 0);
  const ownCount = catalog.filter((item) => item.ownership === 'own').length;

  page.append(el('div.stats',
    statTile(String(ownCount), 'своєї'),
    statTile(String(catalog.length - ownCount), 'орендую'),
    statTile(formatMoney(dayTotal, currency), 'зміна цілком')));

  for (const category of EQUIPMENT_CATEGORIES) {
    const group = catalog
      .filter((item) => item.category === category.id)
      .sort((a, b) => a.title.localeCompare(b.title, 'uk'));
    if (!group.length) continue;

    page.append(sectionTitle(category.label, el('span.section-hint', String(group.length))));
    page.append(el('div.list', group.map((item) => {
      const margin = unitMargin(item);

      return el(
        'article.row',
        { onclick: () => editEquipment(item) },
        el('div.row-body',
          el('p.row-title', item.title),
          item.notes && el('p.row-note', item.notes),
          el('div.row-meta',
            chip(item.ownership === 'own' ? 'Своя' : 'Оренда', item.ownership === 'own' ? 'money' : ''),
            item.dayCost ? chip(`собівартість ${formatMoney(item.dayCost, currency)}`) : null,
            item.dayCost && margin !== 0 ? chip(`+${formatMoney(margin, currency)}`, margin > 0 ? '' : 'danger') : null)),
        el('span.item-amount', formatMoney(item.dayRate ?? 0, currency)),
      );
    })));
  }

  page.append(fab('Додати техніку', () => editEquipment()));
  return page;
}
