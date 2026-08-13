// Форми кошторисів і каталогу техніки.

import { el, toast } from './dom.js';
import {
  openSheet, closeSheet, confirmSheet, field, formBody,
  textInput, textArea, selectInput, numberInput, segmented,
} from './sheet.js';
import { addItem, patchItem, removeItem, getState } from '../core/store.js';
import {
  createEquipment, EQUIPMENT_CATEGORIES, EQUIPMENT_PRESETS, OWNERSHIP, categoryLabel,
} from '../core/equipment.js';
import {
  createEstimate, createItem, itemFromEquipment, itemAmount,
  ESTIMATE_STATUSES, ITEM_CATEGORIES, UNITS,
} from '../core/estimates.js';
import { formatMoney, currencySymbol, CURRENCIES } from '../core/locale.js';
import { navigate } from './router.js';

// --- Техніка --------------------------------------------------------------

export function editEquipment(existing = null, defaults = {}) {
  const equipment = existing ?? createEquipment(defaults);
  const draft = { ...equipment };
  const symbol = currencySymbol(getState().settings.currency);

  const titleInput = textInput({
    value: existing ? draft.title : '',
    placeholder: 'Назва',
    oninput: (event) => { draft.title = event.target.value; },
  });

  // Підказки залежать від обраної категорії — інакше список був би
  // на сотню позицій і користі з нього не було б.
  const presets = el('div.quick-picks');
  const renderPresets = () => {
    presets.replaceChildren();
    for (const name of EQUIPMENT_PRESETS[draft.category] ?? []) {
      presets.append(el('button.quick-pick', {
        type: 'button',
        onclick: () => { draft.title = name; titleInput.value = name; },
      }, name));
    }
  };
  renderPresets();

  const body = formBody(
    field('Категорія', selectInput(
      EQUIPMENT_CATEGORIES.map((category) => ({ value: category.id, label: category.label })),
      {
        value: draft.category,
        onchange: (event) => { draft.category = event.target.value; renderPresets(); },
      },
    )),
    field('Назва', titleInput),
    presets,
    field('Чия', segmented(
      OWNERSHIP.map((item) => ({ value: item.id, label: item.label })),
      draft.ownership,
      (value) => { draft.ownership = value; },
    )),
    field(`Ціна за зміну, ${symbol}`, numberInput({
      value: draft.dayRate ?? '',
      placeholder: '0',
      oninput: (event) => { draft.dayRate = parseMoney(event.target.value); },
    }), 'Скільки береш із клієнта.'),
    field(`Собівартість за зміну, ${symbol}`, numberInput({
      value: draft.dayCost ?? '',
      placeholder: '0',
      oninput: (event) => { draft.dayCost = parseMoney(event.target.value); },
    }), 'Скільки коштує тобі: оренда в іншого рентала чи амортизація. Клієнт цього не бачить.'),
    field('Нотатка', textInput({
      value: draft.notes,
      placeholder: 'Що входить у комплект',
      oninput: (event) => { draft.notes = event.target.value; },
    })),
  );

  openSheet({
    title: existing ? 'Техніка' : 'Нова позиція каталогу',
    body,
    actions: [
      existing
        ? el('button.btn.btn--ghost', {
            type: 'button',
            onclick: () => confirmSheet({
              title: 'Видалити з каталогу?',
              message: `«${equipment.title}» зникне з каталогу. Позиції в уже складених кошторисах залишаться — ціни там зафіксовані.`,
              onConfirm: () => { removeItem('equipment', equipment.id); toast('Видалено з каталогу'); },
            }),
          }, 'Видалити')
        : el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: () => {
          if (!draft.title.trim()) { toast('Впиши назву', { error: true }); return; }
          if (existing) patchItem('equipment', equipment.id, draft);
          else addItem('equipment', { ...draft, title: draft.title.trim() });
          closeSheet();
          toast(existing ? 'Збережено' : 'Додано в каталог');
        },
      }, 'Зберегти'),
    ],
  });
}

// --- Кошторис -------------------------------------------------------------

export function editEstimate(existing = null, defaults = {}) {
  const state = getState();
  const estimate = existing ?? createEstimate({ currency: state.settings.currency, ...defaults });
  const draft = { ...estimate, items: [...estimate.items] };

  const projectOptions = [
    { value: '', label: 'Без проєкту' },
    ...state.projects
      .filter((project) => project.status !== 'archived')
      .map((project) => ({ value: project.id, label: project.title })),
  ];

  const body = formBody(
    field('Назва', textInput({
      value: existing ? draft.title : '',
      placeholder: 'Кошторис на зйомку',
      oninput: (event) => { draft.title = event.target.value; },
    })),
    field('Проєкт', selectInput(projectOptions, {
      value: draft.projectId ?? '',
      onchange: (event) => { draft.projectId = event.target.value || null; },
    })),
    field('Валюта', selectInput(
      CURRENCIES.map((currency) => ({ value: currency.code, label: `${currency.label} (${currency.symbol})` })),
      { value: draft.currency, onchange: (event) => { draft.currency = event.target.value; } },
    ), 'Записується в сам кошторис, щоб зміна валюти в налаштуваннях не переписала вже надіслані суми.'),
    field('Стан', selectInput(
      ESTIMATE_STATUSES.map((status) => ({ value: status.id, label: status.label })),
      {
        value: draft.status,
        onchange: (event) => {
          draft.status = event.target.value;
          // Дати проставляються самі — вручну їх ніхто не заповнює.
          if (draft.status === 'sent' && !draft.sentAt) draft.sentAt = new Date().toISOString();
          if (draft.status === 'approved' && !draft.approvedAt) draft.approvedAt = new Date().toISOString();
        },
      },
    )),
    field('Знижка, %', numberInput({
      value: draft.discountPercent || '',
      placeholder: '0',
      oninput: (event) => { draft.discountPercent = parseMoney(event.target.value) ?? 0; },
    })),
    field('Податок, %', numberInput({
      value: draft.taxPercent || '',
      placeholder: '0',
      oninput: (event) => { draft.taxPercent = parseMoney(event.target.value) ?? 0; },
    }), 'ПДВ або інший податок зверху. Нуль, якщо працюєш без нього.'),
    field('Нотатка для клієнта', textArea({
      value: draft.clientNotes,
      placeholder: 'Що входить у ціну, умови, терміни',
      oninput: (event) => { draft.clientNotes = event.target.value; },
    }), 'Піде разом із кошторисом.'),
    field('Внутрішня нотатка', textArea({
      value: draft.notes,
      placeholder: 'Домовленості з ренталом, запас на торг',
      oninput: (event) => { draft.notes = event.target.value; },
    }), 'Ніколи не потрапляє до клієнта.'),
  );

  openSheet({
    title: existing ? 'Кошторис' : 'Новий кошторис',
    body,
    actions: [
      existing
        ? el('button.btn.btn--ghost', {
            type: 'button',
            onclick: () => confirmSheet({
              title: 'Видалити кошторис?',
              message: `«${estimate.title}» зникне разом з усіма позиціями.`,
              onConfirm: () => {
                removeItem('estimates', estimate.id);
                navigate('/estimates');
                toast('Кошторис видалено');
              },
            }),
          }, 'Видалити')
        : el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: () => {
          if (!draft.title.trim()) { toast('Дай кошторису назву', { error: true }); return; }
          if (existing) {
            patchItem('estimates', estimate.id, draft);
          } else {
            const saved = { ...draft, title: draft.title.trim() };
            addItem('estimates', saved);
            navigate(`/estimates/${saved.id}`);
          }
          closeSheet();
          toast(existing ? 'Збережено' : 'Кошторис створено');
        },
      }, 'Зберегти'),
    ],
  });
}

// --- Позиція кошторису ----------------------------------------------------

export function editEstimateItem(estimate, existingItem = null) {
  const item = existingItem ?? createItem();
  const draft = { ...item };
  const symbol = currencySymbol(estimate.currency);

  const total = el('p.item-total');
  const refreshTotal = () => {
    total.textContent = `Сума позиції: ${formatMoney(itemAmount(draft), estimate.currency)}`;
  };
  refreshTotal();

  const body = formBody(
    field('Назва', textInput({
      value: existingItem ? draft.title : '',
      placeholder: 'Що саме',
      oninput: (event) => { draft.title = event.target.value; },
    })),
    field('Розділ', selectInput(
      ITEM_CATEGORIES.map((category) => ({ value: category.id, label: category.label })),
      { value: draft.category, onchange: (event) => { draft.category = event.target.value; } },
    )),
    field('Одиниця', selectInput(
      UNITS.map((unit) => ({ value: unit, label: unit })),
      { value: draft.unit, onchange: (event) => { draft.unit = event.target.value; } },
    )),
    el('div.item-grid',
      field('Кількість', numberInput({
        value: draft.quantity,
        min: 0, step: 1,
        oninput: (event) => { draft.quantity = parseMoney(event.target.value) ?? 0; refreshTotal(); },
      })),
      field('Змін', numberInput({
        value: draft.shifts,
        min: 0, step: 1,
        oninput: (event) => { draft.shifts = parseMoney(event.target.value) ?? 0; refreshTotal(); },
      })),
    ),
    field(`Ціна за одиницю, ${symbol}`, numberInput({
      value: draft.unitPrice || '',
      placeholder: '0',
      oninput: (event) => { draft.unitPrice = parseMoney(event.target.value) ?? 0; refreshTotal(); },
    })),
    field(`Собівартість, ${symbol}`, numberInput({
      value: draft.unitCost || '',
      placeholder: '0',
      oninput: (event) => { draft.unitCost = parseMoney(event.target.value) ?? 0; },
    }), 'Клієнт цього не бачить.'),
    total,
  );

  openSheet({
    title: existingItem ? 'Позиція' : 'Нова позиція',
    body,
    actions: [
      existingItem
        ? el('button.btn.btn--ghost', {
            type: 'button',
            onclick: () => {
              patchItem('estimates', estimate.id, {
                items: estimate.items.filter((entry) => entry.id !== item.id),
              });
              closeSheet();
              toast('Позицію прибрано');
            },
          }, 'Прибрати')
        : el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: () => {
          if (!draft.title.trim()) { toast('Впиши назву позиції', { error: true }); return; }
          const saved = { ...draft, title: draft.title.trim() };
          const items = existingItem
            ? estimate.items.map((entry) => (entry.id === item.id ? saved : entry))
            : [...estimate.items, saved];
          patchItem('estimates', estimate.id, { items });
          closeSheet();
          toast(existingItem ? 'Збережено' : 'Позицію додано');
        },
      }, 'Зберегти'),
    ],
  });
}

/**
 * Вибір позиції з каталогу техніки.
 * Тап одразу додає позицію — на майданчику важлива швидкість, а кількість
 * і зміни легко поправити потім, торкнувшись рядка в кошторисі.
 */
export function openItemPicker(estimate) {
  const catalog = getState().equipment.filter((item) => !item.archived);
  const listHost = el('div.list');
  let query = '';

  const render = () => {
    const needle = query.trim().toLowerCase();
    const matched = catalog.filter((item) => !needle || item.title.toLowerCase().includes(needle));

    listHost.replaceChildren();

    if (!catalog.length) {
      listHost.append(el('p.settings-note', 'Каталог порожній. Додай техніку — і вона зʼявлятиметься тут разом із цінами.'));
      return;
    }
    if (!matched.length) {
      listHost.append(el('p.settings-note', 'Нічого не знайшлось.'));
      return;
    }

    for (const equipment of matched) {
      listHost.append(el(
        'article.row',
        {
          onclick: () => {
            const item = itemFromEquipment(equipment);
            patchItem('estimates', estimate.id, { items: [...estimate.items, item] });
            closeSheet();
            toast(`Додано: ${equipment.title}`);
          },
        },
        el('div.row-body',
          el('p.row-title', equipment.title),
          el('p.row-note', `${categoryLabel(equipment.category)} · ${formatMoney(equipment.dayRate ?? 0, estimate.currency)} за зміну`)),
        el('span.card-chevron', '+'),
      ));
    }
  };
  render();

  openSheet({
    title: 'Додати з каталогу',
    body: el(
      'div.form',
      el('div.search-bar', el('input.input.input--search', {
        type: 'search',
        placeholder: 'Пошук по каталогу',
        oninput: (event) => { query = event.target.value; render(); },
      })),
      listHost,
    ),
    actions: [
      el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Закрити'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: () => {
          closeSheet();
          editEstimateItem(estimate, null);
        },
      }, 'Своя позиція'),
    ],
  });
}

function parseMoney(value) {
  const parsed = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
