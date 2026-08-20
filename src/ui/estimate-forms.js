// Форми кошторисів і каталогу техніки.

import { el, toast } from './dom.js';
import { t } from '../core/i18n.js';
import {
  openSheet, closeSheet, confirmSheet, field, formBody,
  textInput, textArea, selectInput, numberInput, segmented,
} from './sheet.js';
import { addItem, patchItem, removeItem, getState } from '../core/store.js';
import {
  createEquipment, EQUIPMENT_CATEGORIES, EQUIPMENT_PRESETS, OWNERSHIP, categoryLabel,
} from '../core/equipment.js';
import {
  createEstimate, createItem, itemFromEquipment, itemFromCrew, itemAmount,
  ESTIMATE_STATUSES, ITEM_CATEGORIES, UNITS,
} from '../core/estimates.js';
import { createCrew, CREW_ROLES, crewLabel, clientRate } from '../core/crew.js';
import { formatMoney, currencySymbol, CURRENCIES } from '../core/locale.js';
import { navigate } from './router.js';
import { chip } from './components.js';
import { isSignedIn } from '../core/cloud.js';
import { teamOf, roleLabel } from '../core/account.js';
import { currentCompany } from '../core/context.js';

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
    field(t('Ціна за зміну, {symbol}', { symbol }), numberInput({
      value: draft.dayRate ?? '',
      placeholder: '0',
      oninput: (event) => { draft.dayRate = parseMoney(event.target.value); },
    }), 'Скільки береш із клієнта.'),
    field(t('Собівартість за зміну, {symbol}', { symbol }), numberInput({
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
              message: t('«{name}» зникне з каталогу. Позиції в уже складених кошторисах залишаться — ціни там зафіксовані.', { name: equipment.title }),
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

// --- Команда --------------------------------------------------------------

export function editCrew(existing = null, defaults = {}) {
  const member = existing ?? createCrew(defaults);
  const draft = { ...member };
  const symbol = currencySymbol(getState().settings.currency);

  const roleInput = textInput({
    value: draft.role,
    placeholder: 'Оператор камери',
    oninput: (event) => { draft.role = event.target.value; },
  });

  const nameInput = textInput({
    value: draft.name,
    placeholder: 'Хто саме',
    oninput: (event) => { draft.name = event.target.value; },
  });

  const body = formBody(
    field('Роль', roleInput),
    el('div.quick-picks', CREW_ROLES.map((role) => el('button.quick-pick', {
      type: 'button',
      onclick: () => { draft.role = role; roleInput.value = role; },
    }, role))),
    field('Імʼя', nameInput, 'Можна лишити порожнім — тоді це просто роль, яку ще треба закрити.'),
    field(t('Гонорар за зміну, {symbol}', { symbol }), numberInput({
      value: draft.fee ?? '',
      placeholder: '0',
      oninput: (event) => { draft.fee = parseMoney(event.target.value); },
    }), 'Скільки ти платиш цій людині.'),
    field(t('Ставка клієнту за зміну, {symbol}', { symbol }), numberInput({
      value: draft.rate ?? '',
      placeholder: 'стільки ж, скільки гонорар',
      oninput: (event) => { draft.rate = parseMoney(event.target.value); },
    }), 'Порожньо — виставляєш клієнту рівно гонорар, без націнки.'),
    field('Телефон', textInput({
      value: draft.phone,
      type: 'tel',
      placeholder: '+380…',
      oninput: (event) => { draft.phone = event.target.value; },
    })),
    emailField(draft, () => nameInput, () => roleInput),
    field('Нотатка', textInput({
      value: draft.notes,
      placeholder: 'Своя камера, працює з дроном…',
      oninput: (event) => { draft.notes = event.target.value; },
    })),
  );

  openSheet({
    title: existing ? 'Людина в команді' : 'Додати людину',
    body,
    actions: [
      existing
        ? el('button.btn.btn--ghost', {
            type: 'button',
            onclick: () => confirmSheet({
              title: 'Прибрати з команди?',
              message: t('«{name}» зникне з каталогу. Гонорари у вже складених кошторисах залишаться — суми там зафіксовані.', { name: crewLabel(member) }),
              onConfirm: () => { removeItem('crew', member.id); toast('Прибрано з команди'); },
            }),
          }, 'Видалити')
        : el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: () => {
          if (!draft.role.trim()) { toast('Вкажи роль', { error: true }); return; }
          if (existing) patchItem('crew', member.id, draft);
          else addItem('crew', { ...draft, role: draft.role.trim() });
          closeSheet();
          toast(existing ? 'Збережено' : 'Додано в команду');
        },
      }, 'Зберегти'),
    ],
  });
}

/**
 * Пошта людини — з підказкою зі складу фірми.
 *
 * Пошту треба вписати рівно так, як людина нею заходить: жодної помилки
 * застосунок не помітить, а гонорар просто мовчки не дійде. Тому головний
 * шлях — вибрати зі списку своєї команди, а поле лишається на випадок,
 * коли людини у фірмі ще немає.
 *
 * Список розкривається під полем, а не окремою панеллю: панель у застосунку
 * одна, і друга закрила б цю форму разом із усім, що вже набрано.
 */
function emailField(draft, getNameInput, getRoleInput) {
  const input = textInput({
    value: draft.email,
    type: 'email',
    inputmode: 'email',
    autocapitalize: 'none',
    placeholder: 'вибери зі списку або впиши',
    oninput: (event) => {
      draft.email = event.target.value.trim().toLowerCase();
      // Вписали руками — отже, попередній вибір зі списку більше не діє.
      draft.userId = null;
      render();
    },
    onfocus: () => { open = true; load(); render(); },
  });

  const list = el('div.team-pick');
  const company = isSignedIn() ? currentCompany() : null;

  let open = false;
  let team = null;      // null — ще не питали
  let failed = false;
  let loading = false;

  async function load() {
    if (team !== null || loading || !company) return;
    loading = true;
    render();
    try {
      team = await teamOf(company.id);
    } catch {
      failed = true;
    } finally {
      loading = false;
      render();
    }
  }

  function choose(person) {
    draft.email = person.email;
    draft.userId = person.userId;
    input.value = person.email;

    // Порожні поля заповнюємо, заповнені не чіпаємо: людина могла навмисно
    // написати «Андрій (друга камера)», і підміна це стерла б.
    const nameInput = getNameInput();
    if (!draft.name.trim() && person.name) {
      draft.name = person.name;
      nameInput.value = person.name;
    }
    const roleInput = getRoleInput();
    if (!draft.role.trim() && person.title) {
      draft.role = person.title;
      roleInput.value = person.title;
    }

    open = false;
    render();
    toast(t('{name} — гонорар дійде', { name: person.name || person.email }));
  }

  function render() {
    list.replaceChildren();

    if (draft.userId) {
      list.append(el('p.settings-note', '✓ Звʼязано з акаунтом у фірмі — гонорар дійде.'));
      return;
    }
    if (!open || !company) return;

    if (loading) { list.append(el('p.settings-note', 'Читаю склад фірми…')); return; }
    if (failed) { list.append(el('p.settings-note', 'Не вдалося прочитати склад фірми. Впиши пошту руками.')); return; }
    if (!team) return;

    // Показуємо лише тих, у кого пошта справді є: інші нічим не допоможуть.
    const typed = draft.email.trim().toLowerCase();
    const found = team
      .filter((person) => person.email)
      .filter((person) => !typed
        || person.email.includes(typed)
        || person.name.toLowerCase().includes(typed));

    if (!found.length) {
      list.append(el('p.settings-note', team.length > 1
        ? 'Серед своїх такого немає. Впиши пошту руками або запроси людину у фірму.'
        : 'У фірмі поки нікого, крім тебе. Запроси людей — і вони зʼявляться тут списком.'));
      return;
    }

    list.append(el('div.list', found.map((person) => el(
      'article.row',
      { onclick: () => choose(person) },
      el('span.row-mark', person.isMe ? '🙋' : '👤'),
      el('div.row-body',
        el('p.row-title', person.name || person.email),
        el('div.row-meta',
          chip(person.title || roleLabel(person.role)),
          chip(person.email))),
    ))));
  }

  render();

  return el('div',
    field('Пошта', input, company
      ? 'Натисни — і зʼявиться склад твоєї фірми. Саме за поштою людина побачить свій гонорар у спільному проєкті.'
      : 'Та сама, якою людина заходить у застосунок. Без неї вона не побачить свій гонорар у спільному проєкті.'),
    list);
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
      CURRENCIES.map((currency) => ({ value: currency.code, label: `${t(currency.label)} (${currency.symbol})` })),
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
              message: t('«{name}» зникне разом з усіма позиціями.', { name: estimate.title }),
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
    total.textContent = t('Сума позиції: {sum}', { sum: formatMoney(itemAmount(draft), estimate.currency) });
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
    field(t('Ціна за одиницю, {symbol}', { symbol }), numberInput({
      value: draft.unitPrice || '',
      placeholder: '0',
      oninput: (event) => { draft.unitPrice = parseMoney(event.target.value) ?? 0; refreshTotal(); },
    })),
    field(`${draft.category === 'crew' ? t('Гонорар людині') : t('Собівартість')}, ${symbol}`, numberInput({
      value: draft.unitCost || '',
      placeholder: '0',
      oninput: (event) => { draft.unitCost = parseMoney(event.target.value) ?? 0; },
    }), 'Скільки платиш ти. Клієнт цього не бачить.'),
    el('label.switch',
      el('input', {
        type: 'checkbox',
        checked: draft.internalOnly,
        onchange: (event) => { draft.internalOnly = event.target.checked; },
      }),
      el('span', 'Тільки для мене'),
    ),
    el('p.field-hint',
      'Позиція не потрапить у рахунок клієнту, але витрата на неї рахуватиметься. ' +
      'Зручно, коли людину найняв, а окремим рядком клієнту не показуєш.'),
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
export function openItemPicker(estimate, { source = 'equipment' } = {}) {
  const state = getState();
  const equipment = state.equipment.filter((item) => !item.archived);
  const crew = state.crew.filter((item) => !item.archived);

  const listHost = el('div.list');
  let query = '';
  let active = source;

  const addToEstimate = (item, label) => {
    patchItem('estimates', estimate.id, { items: [...estimate.items, item] });
    closeSheet();
    toast(t('Додано: {name}', { name: label }));
  };

  const render = () => {
    const needle = query.trim().toLowerCase();
    listHost.replaceChildren();

    if (active === 'crew') {
      if (!crew.length) {
        listHost.append(el('p.settings-note',
          'У команді ще нікого немає. Додай людей із їхніми гонорарами — і найматимеш їх у кошторис одним тапом.'));
        return;
      }

      const matched = crew.filter((member) => !needle || crewLabel(member).toLowerCase().includes(needle));
      if (!matched.length) {
        listHost.append(el('p.settings-note', 'Нікого не знайшлось.'));
        return;
      }

      for (const member of matched) {
        const rate = clientRate(member);
        listHost.append(el(
          'article.row',
          {
            onclick: () => addToEstimate(
              itemFromCrew(member, { label: crewLabel(member), clientRate: rate }),
              crewLabel(member),
            ),
          },
          el('div.row-body',
            el('p.row-title', crewLabel(member)),
            el('p.row-note',
              `${t('гонорар')} ${formatMoney(member.fee ?? 0, estimate.currency)}` +
              (rate !== (member.fee ?? 0) ? ` · ${t('клієнту')} ${formatMoney(rate, estimate.currency)}` : ''))),
          el('span.card-chevron', '+'),
        ));
      }
      return;
    }

    if (!equipment.length) {
      listHost.append(el('p.settings-note', 'Каталог порожній. Додай техніку — і вона зʼявлятиметься тут разом із цінами.'));
      return;
    }

    const matched = equipment.filter((item) => !needle || item.title.toLowerCase().includes(needle));
    if (!matched.length) {
      listHost.append(el('p.settings-note', 'Нічого не знайшлось.'));
      return;
    }

    for (const item of matched) {
      listHost.append(el(
        'article.row',
        { onclick: () => addToEstimate(itemFromEquipment(item), item.title) },
        el('div.row-body',
          el('p.row-title', item.title),
          el('p.row-note', `${categoryLabel(item.category)} · ${t('{sum} за зміну', { sum: formatMoney(item.dayRate ?? 0, estimate.currency) })}`)),
        el('span.card-chevron', '+'),
      ));
    }
  };
  render();

  openSheet({
    title: 'Додати в кошторис',
    body: el(
      'div.form',
      segmented(
        [{ value: 'equipment', label: '🎒 Техніка' }, { value: 'crew', label: '👤 Команда' }],
        active,
        (value) => { active = value; render(); },
      ),
      el('div.search-bar', el('input.input.input--search', {
        type: 'search',
        placeholder: 'Пошук',
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
