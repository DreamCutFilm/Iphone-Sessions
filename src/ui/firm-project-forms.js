// Панелі правки проєктів, задач і кошторисів фірми.
//
// Той самий вигляд, що й у власних форм, але інша механіка: тут кожне
// збереження йде в мережу й може відмовити. Тому панель закривається лише
// після успіху — інакше людина була б певна, що зберегла, а не зберегла.

import { el, toast } from './dom.js';
import {
  openSheet, closeSheet, confirmSheet, field, formBody,
  textInput, textArea, selectInput, numberInput, dateInput, segmented,
} from './sheet.js';
import { PROJECT_STATUSES, PROJECT_STYLES } from '../core/models.js';
import { PRIORITIES } from '../core/models.js';
import { ESTIMATE_STATUSES, UNITS } from '../core/estimates.js';
import { CURRENCIES, currencySymbol } from '../core/locale.js';
import { expandDateRange, formatDate } from '../core/dates.js';
import { getState } from '../core/store.js';
import { teamOf } from '../core/account.js';
import { firmEquipment, firmCrew } from '../core/catalog.js';
import {
  saveFirmProject, removeFirmProject, setShootDays,
  saveFirmTask, removeFirmTask,
  saveFirmEstimate, removeFirmEstimate,
  addEstimateItem, updateEstimateItem, removeEstimateItem,
  itemFromFirmGear, itemFromFirmPerson,
} from '../core/firm-projects.js';

// --- Проєкт ----------------------------------------------------------------

export function editFirmProject(existing, company, onDone) {
  const draft = existing
    ? { ...existing }
    : {
        title: '', client: '', style: '', status: 'lead', deadline: null,
        location: '', latitude: null, longitude: null,
        currency: getState().settings.currency, notes: '',
      };

  let days = [...(existing?.shootDays ?? [])];
  const daysHost = el('div.list');

  const renderDays = () => {
    daysHost.replaceChildren();
    if (!days.length) {
      daysHost.append(el('p.settings-note', 'Знімальних днів ще немає.'));
      return;
    }
    for (const day of [...days].sort()) {
      daysHost.append(el('article.row',
        el('span.row-mark', '🎥'),
        el('div.row-body', el('p.row-title', formatDate(day))),
        el('button.link', {
          type: 'button',
          onclick: () => { days = days.filter((entry) => entry !== day); renderDays(); },
        }, 'прибрати')));
    }
  };
  renderDays();

  // Дні додаються кнопкою, а не самим фактом вибору дати. Інакше колесо дат
  // на iPhone встигає надіслати сьогоднішнє число раніше за обране —
  // і в проєкті зʼявляється зайвий день, якого ніхто не ставив.
  let from = '';
  let to = '';

  const styleSelect = selectInput(
    [{ value: '', label: 'Не вказано' }, ...PROJECT_STYLES.map((style) => ({ value: style, label: style }))],
    { value: draft.style, onchange: (event) => { draft.style = event.target.value; } },
  );

  openSheet({
    title: existing ? 'Проєкт фірми' : 'Новий проєкт фірми',
    body: formBody(
      field('Назва', textInput({
        value: draft.title,
        placeholder: 'Концерт у Львові',
        oninput: (event) => { draft.title = event.target.value; },
      })),
      field('Клієнт', textInput({
        value: draft.client,
        placeholder: 'Хто замовив',
        oninput: (event) => { draft.client = event.target.value; },
      })),
      field('Тип зйомки', styleSelect),
      field('Знімальні дні', el('div',
        el('div.date-range',
          dateInput({ value: '', onchange: (event) => { from = event.target.value; } }),
          dateInput({ value: '', onchange: (event) => { to = event.target.value; } })),
        el('button.btn.btn--ghost.btn--wide', {
          type: 'button',
          onclick: () => {
            const added = expandDateRange(from, to || from);
            if (!added.length) { toast('Спершу вибери дати', { error: true }); return; }
            days = [...new Set([...days, ...added])];
            renderDays();
          },
        }, '+ Додати дні'),
        daysHost,
      ), 'Від і до. Один день — постав ту саму дату або лиши друге поле порожнім.'),
      field('Здача матеріалу', dateInput({
        value: draft.deadline ?? '',
        onchange: (event) => { draft.deadline = event.target.value || null; },
      })),
      field('Локація', textInput({
        value: draft.location,
        placeholder: 'Львів, Опера',
        oninput: (event) => { draft.location = event.target.value; },
      })),
      field('Валюта', selectInput(
        CURRENCIES.map((currency) => ({ value: currency.code, label: `${currency.label} (${currency.symbol})` })),
        { value: draft.currency, onchange: (event) => { draft.currency = event.target.value; } },
      )),
      field('Стадія', selectInput(
        PROJECT_STATUSES.map((status) => ({ value: status.id, label: `${status.label} — ${status.hint}` })),
        { value: draft.status, onchange: (event) => { draft.status = event.target.value; } },
      )),
      field('Нотатки', textArea({
        value: draft.notes ?? '',
        placeholder: 'Що важливо памʼятати',
        oninput: (event) => { draft.notes = event.target.value; },
      }), 'Ці нотатки бачить уся команда — на відміну від нотаток власного проєкту.'),
    ),
    actions: [
      existing
        ? el('button.btn.btn--danger', {
            type: 'button',
            onclick: () => confirmSheet({
              title: 'Видалити проєкт?',
              message: `«${existing.title}» зникне у всієї команди разом із задачами й кошторисами.`,
              onConfirm: () => run(() => removeFirmProject(company.id, existing.id), 'Видалено', onDone),
            }),
          }, 'Видалити')
        : el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      saveButton(async () => {
        if (!draft.title.trim()) { toast('Впиши назву', { error: true }); return; }
        await run(async () => {
          const saved = await saveFirmProject(company.id, draft);
          await setShootDays(company.id, saved?.id ?? existing.id, days);
        }, 'Збережено', onDone);
      }),
    ],
  });
}

// --- Задача ----------------------------------------------------------------

export function editFirmTask(existing, company, projectId, onDone) {
  const draft = existing
    ? { ...existing, assigneeId: existing.assigneeId ?? '' }
    : { title: '', assigneeId: '', assigneeName: '', due: null, priority: 'normal', notes: '' };

  const whoHost = el('div.form');

  teamOf(company.id)
    .then((team) => {
      whoHost.replaceChildren(field('Кому', selectInput(
        [{ value: '', label: 'Спільна — для всіх' },
          ...team.map((member) => ({
            value: member.userId,
            label: member.name || member.roleName || member.email || 'Без імені',
          }))],
        {
          value: draft.assigneeId,
          onchange: (event) => {
            draft.assigneeId = event.target.value;
            draft.assigneeName = event.target.selectedOptions[0]?.textContent ?? '';
          },
        },
      ), 'Людина побачить цю задачу як свою — і на екрані огляду теж.'));
    })
    .catch(() => {
      whoHost.replaceChildren(el('p.settings-note', 'Не вдалося прочитати склад фірми.'));
    });

  openSheet({
    title: existing ? 'Задача фірми' : 'Нова задача',
    body: formBody(
      field('Задача', textInput({
        value: draft.title,
        placeholder: 'Що зробити',
        oninput: (event) => { draft.title = event.target.value; },
      })),
      whoHost,
      field('Термін', dateInput({
        value: draft.due ?? '',
        onchange: (event) => { draft.due = event.target.value || null; },
      })),
      field('Пріоритет', segmented(
        PRIORITIES.map((priority) => ({ value: priority.id, label: priority.label })),
        draft.priority,
        (value) => { draft.priority = value; },
      )),
      field('Деталі', textArea({
        value: draft.notes ?? '',
        placeholder: 'Як саме це зробити, куди заїхати, до котрої',
        oninput: (event) => { draft.notes = event.target.value; },
      }), 'Це прочитає той, кому задача дісталася.'),
    ),
    actions: [
      existing
        ? el('button.btn.btn--danger', {
            type: 'button',
            onclick: () => confirmSheet({
              title: 'Видалити задачу?',
              message: `«${existing.title}» зникне в усієї команди.`,
              onConfirm: () => run(() => removeFirmTask(company.id, projectId, existing.id), 'Видалено', onDone),
            }),
          }, 'Видалити')
        : el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      saveButton(async () => {
        if (!draft.title.trim()) { toast('Впиши задачу', { error: true }); return; }
        await run(() => saveFirmTask(company.id, projectId, draft), 'Збережено', onDone);
      }),
    ],
  });
}

// --- Кошторис --------------------------------------------------------------

export function editFirmEstimate(existing, company, projectId, onDone) {
  const draft = existing
    ? { ...existing }
    : {
        projectId,
        title: 'Кошторис',
        status: 'draft',
        currency: getState().settings.currency,
        discountPercent: 0,
        taxPercent: 0,
        clientNotes: '',
        notes: '',
      };

  openSheet({
    title: existing ? 'Кошторис' : 'Новий кошторис',
    body: formBody(
      field('Назва', textInput({
        value: draft.title,
        placeholder: 'Кошторис',
        oninput: (event) => { draft.title = event.target.value; },
      })),
      field('Стан', selectInput(
        ESTIMATE_STATUSES.map((status) => ({ value: status.id, label: status.label })),
        { value: draft.status, onchange: (event) => { draft.status = event.target.value; } },
      ), 'Гроші проєкту рахуються за затвердженим кошторисом; якщо його немає — '
        + 'за надісланим, а тоді за чернеткою.'),
      field('Валюта', selectInput(
        CURRENCIES.map((currency) => ({ value: currency.code, label: `${currency.label} (${currency.symbol})` })),
        { value: draft.currency, onchange: (event) => { draft.currency = event.target.value; } },
      )),
      field('Знижка, %', numberInput({
        value: draft.discountPercent || '',
        placeholder: '0',
        oninput: (event) => { draft.discountPercent = Number(event.target.value) || 0; },
      })),
      field('Нотатка клієнту', textArea({
        value: draft.clientNotes ?? '',
        placeholder: 'Що входить у ціну',
        oninput: (event) => { draft.clientNotes = event.target.value; },
      })),
    ),
    actions: [
      existing
        ? el('button.btn.btn--danger', {
            type: 'button',
            onclick: () => confirmSheet({
              title: 'Видалити кошторис?',
              message: 'Позиції зникнуть разом із ним, а гроші проєкту перерахуються.',
              onConfirm: () => run(() => removeFirmEstimate(company.id, existing), 'Видалено', onDone),
            }),
          }, 'Видалити')
        : el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      saveButton(async () => {
        await run(() => saveFirmEstimate(company.id, draft), 'Збережено', onDone);
      }),
    ],
  });
}

/**
 * Вибір позиції з каталогу фірми.
 *
 * Це і є те, заради чого каталоги переїхали у фірму: кошторис збирається
 * з того самого списку, який бачить уся команда, а не з копії на чиємусь
 * телефоні.
 */
export function firmItemPicker(estimate, company, onDone) {
  const listHost = el('div.list');
  let mode = 'gear';
  let query = '';
  let gear = null;
  let people = null;

  const add = async (item, label) => {
    const position = (estimate.items?.length ?? 0);
    await run(
      () => addEstimateItem(company.id, estimate, { ...item, position }),
      `Додано: ${label}`,
      onDone,
    );
  };

  const render = () => {
    const needle = query.trim().toLowerCase();
    listHost.replaceChildren();

    const source = mode === 'gear' ? gear : people;
    if (source === null) {
      listHost.append(el('p.settings-note', 'Завантажую…'));
      return;
    }

    const rows = source.filter((entry) => {
      const text = mode === 'gear' ? entry.title : `${entry.name} ${entry.role}`;
      return !needle || text.toLowerCase().includes(needle);
    });

    if (!rows.length) {
      listHost.append(el('p.settings-note', mode === 'gear'
        ? 'Техніки не знайшлось. Внеси її в каталог фірми.'
        : 'Нікого не знайшлось. Внеси людей у каталог фірми.'));
      return;
    }

    const symbol = currencySymbol(estimate.currency);

    for (const entry of rows) {
      if (mode === 'gear') {
        listHost.append(el('article.row',
          { onclick: () => add(itemFromFirmGear(entry), entry.title) },
          el('span.row-mark', entry.ownership === 'rented' ? '🚚' : '📦'),
          el('div.row-body', el('p.row-title', entry.title)),
          entry.dayRate !== null ? el('span.item-amount', `${entry.dayRate} ${symbol}`) : null));
      } else {
        const label = entry.name ? `${entry.name} — ${entry.role}` : entry.role;
        listHost.append(el('article.row',
          { onclick: () => add(itemFromFirmPerson(entry), label) },
          el('span.row-mark', '👤'),
          el('div.row-body', el('p.row-title', label)),
          entry.fee !== null ? el('span.item-amount', `${entry.fee} ${symbol}`) : null));
      }
    }
  };

  const load = async () => {
    try {
      if (mode === 'gear' && gear === null) gear = (await firmEquipment(company.id)).value.filter((item) => !item.archived);
      if (mode === 'crew' && people === null) people = (await firmCrew(company.id)).value.filter((item) => !item.archived);
    } catch {
      if (mode === 'gear') gear = [];
      else people = [];
    }
    render();
  };

  openSheet({
    title: 'Додати з каталогу фірми',
    body: el('div.form',
      segmented(
        [{ value: 'gear', label: 'Техніка' }, { value: 'crew', label: 'Команда' }],
        mode,
        (value) => { mode = value; render(); load(); },
      ),
      el('div.search-bar', el('input.input.input--search', {
        type: 'search',
        placeholder: 'Пошук',
        oninput: (event) => { query = event.target.value; render(); },
      })),
      listHost,
    ),
    actions: [el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Закрити')],
  });

  render();
  load();
}

/** Правка однієї позиції кошторису — кількість, зміни, ціни. */
export function editFirmItem(item, estimate, company, onDone) {
  const draft = { ...item };
  const symbol = currencySymbol(estimate.currency);

  openSheet({
    title: draft.title,
    body: formBody(
      field('Назва', textInput({
        value: draft.title,
        oninput: (event) => { draft.title = event.target.value; },
      })),
      field('Кількість', numberInput({
        value: draft.quantity,
        oninput: (event) => { draft.quantity = Number(event.target.value) || 0; },
      })),
      field('Скільки змін', numberInput({
        value: draft.shifts,
        oninput: (event) => { draft.shifts = Number(event.target.value) || 0; },
      })),
      field('Одиниця', selectInput(
        UNITS.map((unit) => ({ value: unit, label: unit })),
        { value: draft.unit, onchange: (event) => { draft.unit = event.target.value; } },
      )),
      field(`Ціна клієнту за одиницю, ${symbol}`, numberInput({
        value: draft.unitPrice,
        oninput: (event) => { draft.unitPrice = Number(event.target.value) || 0; },
      })),
      field(`Собівартість за одиницю, ${symbol}`, numberInput({
        value: draft.unitCost,
        oninput: (event) => { draft.unitCost = Number(event.target.value) || 0; },
      }), 'Скільки це коштує фірмі. Команді видно саме цю суму, а не ціну клієнту.'),
      field('Тільки для нас', segmented(
        [{ value: 'no', label: 'У рахунку' }, { value: 'yes', label: 'Не показувати' }],
        draft.internalOnly ? 'yes' : 'no',
        (value) => { draft.internalOnly = value === 'yes'; },
      ), 'Витрату рахуємо, а клієнту окремим рядком не показуємо.'),
      field('Нотатка', textInput({
        value: draft.notes ?? '',
        placeholder: 'Де брати, що входить',
        oninput: (event) => { draft.notes = event.target.value; },
      })),
    ),
    actions: [
      el('button.btn.btn--danger', {
        type: 'button',
        onclick: () => run(() => removeEstimateItem(company.id, estimate, draft.id), 'Прибрано', onDone),
      }, 'Прибрати'),
      saveButton(async () => {
        await run(() => updateEstimateItem(company.id, estimate, draft), 'Збережено', onDone);
      }),
    ],
  });
}

// --- Спільне ---------------------------------------------------------------

function saveButton(action) {
  return el('button.btn.btn--primary', {
    type: 'button',
    onclick: async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Зберігаю…';
      await action();
      button.disabled = false;
      button.textContent = 'Зберегти';
    },
  }, 'Зберегти');
}

/** Панель закривається лише після успіху: інакше людина була б певна, що зберегла. */
async function run(action, okMessage, onDone) {
  try {
    await action();
    closeSheet();
    toast(okMessage);
    onDone();
  } catch (error) {
    toast(error?.message ?? 'Немає звʼязку з сервером', { error: true });
  }
}
