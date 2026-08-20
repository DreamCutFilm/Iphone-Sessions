// Каталог техніки з цінами оренди.

import { el, emptyState } from '../dom.js';
import { t } from '../../core/i18n.js';
import { plural } from '../../core/dates.js';
import { pageHeader, sectionTitle, chip, fab, statTile } from '../components.js';
import { editEquipment } from '../estimate-forms.js';
import { getState } from '../../core/store.js';
import { EQUIPMENT_CATEGORIES, unitMargin } from '../../core/equipment.js';
import { formatMoney } from '../../core/locale.js';
import { inCompany, currentCompany } from '../../core/context.js';
import { permissionsOf } from '../../core/roles.js';
import { firmEquipment } from '../../core/catalog.js';
import { editFirmGear } from '../firm-forms.js';
import { freshnessNote } from '../context-bar.js';

export function equipmentView() {
  return inCompany() ? firmGearView() : myGearView();
}

/**
 * Каталог техніки фірми.
 *
 * Один список на всіх. Ціни тут двох сортів і показуються нарізно: ціна для
 * клієнта — це гроші клієнта, собівартість — оренда. Роль може відкривати
 * одне без іншого, тож порожнє місце тут означає «не для тебе», а не «нуль».
 */
function firmGearView() {
  const company = currentCompany();
  const page = el('div.page');

  page.append(pageHeader('Техніка фірми', { subtitle: company.name, back: '/estimates' }));

  const host = el('div');
  page.append(host);
  loadFirmGear(host, company);

  return page;
}

async function loadFirmGear(host, company) {
  host.replaceChildren(el('p.settings-note', 'Завантажую…'));

  let result;
  try {
    result = await firmEquipment(company.id);
  } catch (error) {
    host.replaceChildren(
      el('p.settings-note', error?.message ?? 'Немає звʼязку з сервером'),
      el('div.form', el('button.btn.btn--ghost.btn--wide', {
        type: 'button', onclick: () => loadFirmGear(host, company),
      }, 'Спробувати ще раз')),
    );
    return;
  }

  const catalog = result.value.filter((item) => !item.archived);
  const currency = getState().settings.currency;
  const mayEdit = catalog[0]?.canEdit ?? permissionsOf(company).can_edit;
  const parts = [];

  const stale = freshnessNote(result, () => loadFirmGear(host, company));
  if (stale) parts.push(stale);

  if (!catalog.length) {
    parts.push(emptyState(
      t('У «{company}» ще немає техніки', { company: company.name }),
      mayEdit
        ? 'Додай позиції або перенеси свій каталог із телефона — на сторінці фірми.'
        : 'Керівник внесе техніку — і вона зʼявиться тут.',
      mayEdit
        ? el('button.btn.btn--primary', { type: 'button', onclick: () => editFirmGear(null, company, () => loadFirmGear(host, company)) }, 'Додати позицію')
        : null,
    ));
    host.replaceChildren(...parts);
    return;
  }

  const ownCount = catalog.filter((item) => item.ownership === 'own').length;
  parts.push(el('div.stats',
    statTile(String(ownCount), 'своєї'),
    statTile(String(catalog.length - ownCount), 'орендуємо'),
    statTile(String(catalog.length), 'позицій')));

  for (const category of EQUIPMENT_CATEGORIES) {
    const group = catalog
      .filter((item) => item.category === category.id)
      .sort((a, b) => a.title.localeCompare(b.title, 'uk'));
    if (!group.length) continue;

    parts.push(sectionTitle(category.label, el('span.section-hint', String(group.length))));
    parts.push(el('div.list', group.map((item) => el(
      'article.row',
      item.canEdit
        ? { onclick: () => editFirmGear(item, company, () => loadFirmGear(host, company)) }
        : null,
      el('span.row-mark', item.ownership === 'rented' ? '🚚' : '📦'),
      el('div.row-body',
        el('p.row-title', item.title),
        item.notes && el('p.row-note', item.notes),
        el('div.row-meta',
          chip(item.ownership === 'own' ? 'Своя' : 'Орендуємо', item.ownership === 'own' ? 'money' : 'warn'),
          item.dayCost !== null ? chip(`${t('собівартість')} ${formatMoney(item.dayCost, currency)}`) : null)),
      item.dayRate !== null ? el('span.item-amount', formatMoney(item.dayRate, currency)) : null,
    ))));
  }

  host.replaceChildren(...parts);

  if (mayEdit) {
    host.append(el('div.form', el('button.btn.btn--ghost.btn--wide', {
      type: 'button',
      onclick: () => editFirmGear(null, company, () => loadFirmGear(host, company)),
    }, '+ Додати позицію')));
  }
}

function myGearView() {
  const state = getState();
  const currency = state.settings.currency;
  const catalog = state.equipment;
  const page = el('div.page');

  page.append(pageHeader('Каталог техніки', {
    subtitle: plural(catalog.length, 'позиція', 'позиції', 'позицій'),
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
            item.dayCost ? chip(`${t('собівартість')} ${formatMoney(item.dayCost, currency)}`) : null,
            item.dayCost && margin !== 0 ? chip(`+${formatMoney(margin, currency)}`, margin > 0 ? '' : 'danger') : null)),
        el('span.item-amount', formatMoney(item.dayRate ?? 0, currency)),
      );
    })));
  }

  page.append(fab('Додати техніку', () => editEquipment()));
  return page;
}
