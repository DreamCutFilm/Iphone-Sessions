// Ренталь: у кого брати техніку, за скільки і куди їхати.
//
// Поки що список веде сам оператор — вписує тих, з ким працює. Далі рентал
// зможе вести свій прайс сам, і тоді ці ж екрани показуватимуть чуже,
// а не тільки власноруч записане. Тому екран одразу зроблено як каталог
// ренталів, а не як «нотатку з телефонами».

import { el, emptyState, appendIf } from '../dom.js';
import { t } from '../../core/i18n.js';
import { pageHeader, sectionTitle, chip, fab, formatMoney } from '../components.js';
import { contextBar } from '../context-bar.js';
import { navigate } from '../router.js';
import { getState } from '../../core/store.js';
import { rentalGroups, priceRange, rentalCategoryLabel } from '../../core/rentals.js';
import { editRental, editRentalItem } from '../rental-forms.js';
import { mapsLink, isValidCoordinate, formatCoordinates } from '../../core/geo.js';
import { plural } from '../../core/dates.js';

export function rentalsView() {
  const state = getState();
  const page = el('div.page');

  page.append(pageHeader('Рентал', {
    subtitle: state.rentals.length
      ? plural(state.rentals.length, 'рентал', 'ренталі', 'ренталів')
      : null,
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Новий рентал', onclick: () => editRental() }, '+'),
  }));

  appendIf(page, contextBar());
  page.append(soonNote());

  if (!state.rentals.length) {
    page.append(emptyState(
      'Ренталів ще немає',
      'Внеси тих, у кого береш техніку: ціни, що саме є і куди їхати. '
      + 'Коли на зйомці бракує камери, шукати доведеться не в переписці.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => editRental() }, 'Додати рентал'),
    ));
    return page;
  }

  page.append(el('div.list', state.rentals.map(rentalCard)));
  page.append(fab('Новий рентал', () => editRental()));
  return page;
}

function rentalCard(rental) {
  const currency = getState().settings.currency;
  const range = priceRange(rental);
  const meta = [];

  if (rental.items.length) meta.push(chip(plural(rental.items.length, 'позиція', 'позиції', 'позицій')));
  if (range) {
    meta.push(chip(range.from === range.to
      ? formatMoney(range.from)
      : `${formatMoney(range.from)} – ${formatMoney(range.to)}`, 'money'));
  }
  if (rental.location) meta.push(chip(`📍 ${rental.location}`));

  return el(
    'article.card',
    { onclick: () => navigate(`/rentals/${rental.id}`) },
    el('div.card-body',
      el('p.card-title', rental.name),
      rental.phone && el('p.card-sub', rental.phone),
      el('div.row-meta', meta)),
    el('span.card-chevron', '›'),
  );
}

export function rentalDetailView(rentalId) {
  const state = getState();
  const rental = state.rentals.find((entry) => entry.id === rentalId);
  const page = el('div.page');

  if (!rental) {
    page.append(pageHeader('Рентал', { back: '/rentals' }));
    page.append(emptyState('Рентал не знайдено', 'Можливо, його видалили.'));
    return page;
  }

  page.append(pageHeader(rental.name, {
    subtitle: rental.location || null,
    back: '/rentals',
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Редагувати', onclick: () => editRental(rental) }, '✎'),
  }));

  // Телефон — посилання, а не текст: на майданчику дзвонять, а не переписують
  // цифри в клавіатуру.
  if (rental.phone) {
    page.append(el('a.btn.btn--primary.btn--wide',
      { href: `tel:${rental.phone.replace(/[^+\d]/g, '')}` }, `📞 ${rental.phone}`));
  }

  const navigation = mapsLink({
    latitude: rental.latitude,
    longitude: rental.longitude,
    label: rental.location,
  });

  if (navigation) {
    page.append(el(
      'a.btn.btn--ghost.btn--wide.map-link',
      { href: navigation, target: '_blank', rel: 'noopener' },
      isValidCoordinate(rental.latitude, rental.longitude)
        ? `🗺 ${t('Прокласти маршрут')} · ${formatCoordinates(rental.latitude, rental.longitude, 4)}`
        : '🗺 Знайти локацію в Картах',
    ));
  }

  if (rental.site) {
    page.append(el('a.btn.btn--ghost.btn--wide',
      { href: withScheme(rental.site), target: '_blank', rel: 'noopener' }, `🔗 ${rental.site}`));
  }

  if (rental.notes) page.append(el('div.note-card', rental.notes));

  const groups = rentalGroups(rental);

  page.append(sectionTitle('Прайс',
    el('button.link', { type: 'button', onclick: () => editRentalItem(rental.id) }, '+ додати')));

  if (!groups.length) {
    page.append(emptyState('Позицій ще немає', 'Додай техніку з цінами — і на зйомці не доведеться згадувати їх напамʼять.'));
    page.append(fab('Нова позиція', () => editRentalItem(rental.id)));
    return page;
  }

  for (const group of groups) {
    page.append(sectionTitle(rentalCategoryLabel(group.id), el('span.section-hint', String(group.items.length))));
    page.append(el('div.list', group.items.map((item) => el(
      'article.row',
      { onclick: () => editRentalItem(rental.id, item) },
      el('div.row-body',
        el('p.row-title', item.title),
        item.notes && el('p.row-note', item.notes)),
      item.price > 0
        ? chip(`${formatMoney(item.price)} ${t('за зміну')}`, 'money')
        : chip('ціну не вказано'),
    ))));
  }

  page.append(fab('Нова позиція', () => editRentalItem(rental.id)));
  return page;
}

/**
 * Чесна табличка «ще в розробці».
 *
 * Розділ працює, але не так, як працюватиме: зараз усе вписується руками й
 * лежить на цьому телефоні. Не сказати про це означало б, що людина внесе
 * двадцять ренталів і чекатиме, що команда їх побачить.
 */
function soonNote() {
  return el('div.banner.banner--soon',
    el('p.banner-title', '🚧 Розділ у розробці'),
    el('p.banner-text',
      'Поки що ренталь ведеш ти сам, і список лишається на цьому телефоні. '
      + 'Далі рентали зможуть вести свій прайс самі — і він оновлюватиметься без тебе.'));
}

function withScheme(site) {
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}
