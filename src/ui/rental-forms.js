// Форми ренталу: сам рентал і позиції його прайсу.

import { el, toast } from './dom.js';
import { t } from '../core/i18n.js';
import {
  openSheet, closeSheet, confirmSheet, field, formBody,
  textInput, textArea, numberInput, selectInput,
} from './sheet.js';
import { addItem, patchItem, removeItem, getState } from '../core/store.js';
import { createRental, createRentalItem, RENTAL_CATEGORIES } from '../core/rentals.js';
import { currencySymbol } from '../core/locale.js';
import { isValidCoordinate, formatCoordinates } from '../core/geo.js';
import { openMapPicker } from './map-picker.js';

export function editRental(existing = null, draftOverride = null) {
  const rental = existing ?? createRental();
  const draft = draftOverride ? { ...draftOverride } : { ...rental };

  const pointNote = el('p.settings-note', pointLabel(draft));

  const body = formBody(
    field('Назва ренталу', textInput({
      value: existing || draftOverride ? draft.name : '',
      placeholder: 'Kinorent, Cinelight…',
      oninput: (event) => { draft.name = event.target.value; },
    })),
    field('Телефон', textInput({
      value: draft.phone,
      type: 'tel',
      placeholder: '+380…',
      oninput: (event) => { draft.phone = event.target.value; },
    }), 'Той, за яким домовляються про техніку.'),
    field('Сайт або прайс', textInput({
      value: draft.site,
      placeholder: 'kinorent.example',
      oninput: (event) => { draft.site = event.target.value; },
    })),
    field('Адреса', textInput({
      value: draft.location,
      placeholder: 'Львів, вул. Городоцька 100',
      oninput: (event) => { draft.location = event.target.value; },
    }), 'За нею відкриється маршрут у Картах.'),
    el('button.btn.btn--ghost.btn--wide', {
      type: 'button',
      onclick: () => pickPoint(),
    }, '🗺 Обрати точку на карті'),
    pointNote,
    field('Нотатка', textArea({
      value: draft.notes,
      placeholder: 'Години роботи, з ким домовлятись, умови застави',
      oninput: (event) => { draft.notes = event.target.value; },
    })),
  );

  const pickPoint = () => {
    const snapshot = { ...draft };
    openMapPicker({
      latitude: draft.latitude,
      longitude: draft.longitude,
      label: draft.name,
      onPick: (picked) => editRental(existing, {
        ...snapshot,
        latitude: picked?.latitude ?? null,
        longitude: picked?.longitude ?? null,
      }),
      onCancel: () => editRental(existing, snapshot),
    });
  };

  openSheet({
    title: existing ? 'Рентал' : 'Новий рентал',
    body,
    actions: [
      existing
        ? el('button.btn.btn--ghost', {
            type: 'button',
            onclick: () => confirmSheet({
              title: 'Видалити рентал?',
              message: t('«{name}» зникне разом з усіма позиціями.', { name: rental.name }),
              onConfirm: () => { removeItem('rentals', rental.id); toast('Видалено'); },
            }),
          }, 'Видалити')
        : el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: () => {
          if (!draft.name.trim()) { toast('Впиши назву', { error: true }); return; }
          const patch = { ...draft, name: draft.name.trim(), updatedAt: new Date().toISOString() };
          if (existing) patchItem('rentals', rental.id, patch);
          else addItem('rentals', patch);
          closeSheet();
          toast(existing ? 'Збережено' : 'Рентал додано');
        },
      }, 'Зберегти'),
    ],
  });
}

/**
 * Позиція прайсу.
 *
 * Позиції живуть усередині ренталу, а не окремою колекцією: прайс належить
 * ренталу так само, як гонорар — людині, і поодинці такий рядок ні про що
 * не говорить. Тому редагується він теж через сам рентал.
 */
export function editRentalItem(rentalId, existing = null) {
  const rental = getState().rentals.find((entry) => entry.id === rentalId);
  if (!rental) return;

  const item = existing ?? createRentalItem();
  const draft = { ...item };
  const symbol = currencySymbol(getState().settings.currency);

  const body = formBody(
    field('Що саме', textInput({
      value: existing ? draft.title : '',
      placeholder: 'Sony FX6, Aputure 600d…',
      oninput: (event) => { draft.title = event.target.value; },
    })),
    field('Розділ', selectInput(
      RENTAL_CATEGORIES.map((category) => ({ value: category.id, label: category.label })),
      { value: draft.category, onchange: (event) => { draft.category = event.target.value; } },
    )),
    field(t('Ціна за зміну, {symbol}', { symbol }), numberInput({
      value: draft.price || '',
      min: 0,
      step: 50,
      oninput: (event) => { draft.price = Number(event.target.value) || 0; },
    }), 'Скільки рентал бере за одну зміну.'),
    field('Опис', textArea({
      value: draft.notes,
      placeholder: 'Що входить у комплект, стан, застава',
      oninput: (event) => { draft.notes = event.target.value; },
    })),
  );

  openSheet({
    title: existing ? 'Позиція ренталу' : 'Нова позиція',
    body,
    actions: [
      existing
        ? el('button.btn.btn--ghost', {
            type: 'button',
            onclick: () => {
              save(rental.items.filter((entry) => entry.id !== item.id));
              toast('Позицію прибрано');
            },
          }, 'Прибрати')
        : el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: () => {
          if (!draft.title.trim()) { toast('Впиши назву позиції', { error: true }); return; }
          const next = { ...draft, title: draft.title.trim() };
          save(existing
            ? rental.items.map((entry) => (entry.id === item.id ? next : entry))
            : [...rental.items, next]);
          toast(existing ? 'Збережено' : 'Позицію додано');
        },
      }, 'Зберегти'),
    ],
  });

  function save(items) {
    patchItem('rentals', rental.id, { items, updatedAt: new Date().toISOString() });
    closeSheet();
  }
}

function pointLabel(draft) {
  return isValidCoordinate(draft.latitude, draft.longitude)
    ? `📍 ${formatCoordinates(draft.latitude, draft.longitude)}`
    : 'Точку на карті не задано';
}
