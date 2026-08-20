// Панелі правки каталогів фірми.
//
// Окремо від власних форм навмисно. Виглядають вони майже однаково, але
// поводяться по-різному: власна форма пише в памʼять телефона миттєво, ця —
// іде в мережу й може відмовити. Спроба обслужити обидва випадки однією
// формою скінчилася б рядками «якщо фірма, то…» у кожному обробнику.
//
// Порожнє поле ціни тут означає «тобі не показують», а не «нуль». Тому
// поле, якого людині не видно, не малюється взагалі: інакше вона зберегла б
// туди порожнечу й затерла суму, якої ніколи не бачила.

import { el, toast } from './dom.js';
import {
  openSheet, closeSheet, confirmSheet, field, formBody,
  textInput, selectInput, numberInput, segmented,
} from './sheet.js';
import { EQUIPMENT_CATEGORIES, EQUIPMENT_PRESETS, OWNERSHIP } from '../core/equipment.js';
import { CREW_ROLES } from '../core/crew.js';
import { currencySymbol } from '../core/locale.js';
import { getState } from '../core/store.js';
import {
  saveFirmEquipment, removeFirmEquipment, saveFirmCrew, removeFirmCrew,
} from '../core/catalog.js';

export function editFirmGear(existing, company, onDone) {
  const draft = existing
    ? { ...existing }
    : { title: '', category: 'other', ownership: 'own', dayRate: null, dayCost: null, notes: '' };

  const symbol = currencySymbol(getState().settings.currency);

  const titleInput = textInput({
    value: draft.title,
    placeholder: 'Назва',
    oninput: (event) => { draft.title = event.target.value; },
  });

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

  // Ціни показуємо лише ті, які людині справді видно. Порожнє поле вона
  // зберегла б як нуль — і затерла б суму, якої не бачила.
  const seesRate = !existing || existing.dayRate !== null;
  const seesCost = !existing || existing.dayCost !== null;

  openSheet({
    title: existing ? 'Техніка фірми' : 'Нова позиція',
    body: formBody(
      field('Категорія', selectInput(
        EQUIPMENT_CATEGORIES.map((category) => ({ value: category.id, label: category.label })),
        { value: draft.category, onchange: (event) => { draft.category = event.target.value; renderPresets(); } },
      )),
      field('Назва', titleInput),
      presets,
      field('Чия', segmented(
        OWNERSHIP.map((item) => ({ value: item.id, label: item.label })),
        draft.ownership,
        (value) => { draft.ownership = value; },
      )),
      seesRate ? field(`Ціна клієнту за зміну, ${symbol}`, numberInput({
        value: draft.dayRate ?? '',
        placeholder: '0',
        oninput: (event) => { draft.dayRate = parseMoney(event.target.value); },
      })) : null,
      seesCost ? field(`Собівартість за зміну, ${symbol}`, numberInput({
        value: draft.dayCost ?? '',
        placeholder: '0',
        oninput: (event) => { draft.dayCost = parseMoney(event.target.value); },
      }), 'Скільки коштує фірмі. Це бачить команда, ціну клієнту — ні.') : null,
      field('Нотатка', textInput({
        value: draft.notes,
        placeholder: 'Що входить, де забрати',
        oninput: (event) => { draft.notes = event.target.value; },
      }), 'Її прочитає той, хто поїде по цю техніку.'),
    ),
    actions: actions({
      existing,
      onDelete: () => confirmSheet({
        title: 'Прибрати з каталогу?',
        message: `«${existing.title}» зникне в усієї команди.`,
        onConfirm: () => run(() => removeFirmEquipment(company.id, existing.id), 'Прибрано', onDone),
      }),
      onSave: () => {
        if (!draft.title.trim()) { toast('Впиши назву', { error: true }); return null; }
        return run(() => saveFirmEquipment(company.id, draft), 'Збережено', onDone);
      },
    }),
  });
}

export function editFirmPerson(existing, company, onDone) {
  const draft = existing
    ? { ...existing }
    : { name: '', role: 'Оператор', fee: null, rate: null, phone: '', email: '', notes: '' };

  const symbol = currencySymbol(getState().settings.currency);

  const roleInput = textInput({
    value: draft.role,
    placeholder: 'Оператор камери',
    oninput: (event) => { draft.role = event.target.value; },
  });

  const seesFee = !existing || existing.fee !== null;
  const seesRate = !existing || existing.rate !== null;

  openSheet({
    title: existing ? 'Людина у фірмі' : 'Додати людину',
    body: formBody(
      field('Роль', roleInput),
      el('div.quick-picks', CREW_ROLES.map((role) => el('button.quick-pick', {
        type: 'button',
        onclick: () => { draft.role = role; roleInput.value = role; },
      }, role))),
      field('Імʼя', textInput({
        value: draft.name,
        placeholder: 'Хто саме',
        oninput: (event) => { draft.name = event.target.value; },
      })),
      seesFee ? field(`Гонорар за зміну, ${symbol}`, numberInput({
        value: draft.fee ?? '',
        placeholder: '0',
        oninput: (event) => { draft.fee = parseMoney(event.target.value); },
      }), 'Скільки фірма платить цій людині.') : null,
      seesRate ? field(`Ставка клієнту за зміну, ${symbol}`, numberInput({
        value: draft.rate ?? '',
        placeholder: 'стільки ж, скільки гонорар',
        oninput: (event) => { draft.rate = parseMoney(event.target.value); },
      })) : null,
      field('Телефон', textInput({
        value: draft.phone,
        type: 'tel',
        placeholder: '+380…',
        oninput: (event) => { draft.phone = event.target.value; },
      })),
      field('Пошта', textInput({
        value: draft.email,
        type: 'email',
        inputmode: 'email',
        autocapitalize: 'none',
        placeholder: 'petro@example.com',
        oninput: (event) => { draft.email = event.target.value; },
      }), 'Та сама, якою людина заходить у застосунок — за нею вона побачить свій гонорар.'),
      field('Нотатка', textInput({
        value: draft.notes,
        placeholder: 'Своя камера, працює з дроном…',
        oninput: (event) => { draft.notes = event.target.value; },
      })),
    ),
    actions: actions({
      existing,
      onDelete: () => confirmSheet({
        title: 'Прибрати з каталогу?',
        message: `${existing.name || existing.role} зникне з каталогу фірми. `
          + 'З команди людину це не виганяє — вона лишається у фірмі.',
        onConfirm: () => run(() => removeFirmCrew(company.id, existing.id), 'Прибрано', onDone),
      }),
      onSave: () => {
        if (!draft.role.trim()) { toast('Вкажи роль', { error: true }); return null; }
        return run(() => saveFirmCrew(company.id, draft), 'Збережено', onDone);
      },
    }),
  });
}

// --- Спільне ---------------------------------------------------------------

function actions({ existing, onDelete, onSave }) {
  return [
    existing
      ? el('button.btn.btn--ghost', { type: 'button', onclick: onDelete }, 'Прибрати')
      : el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
    el('button.btn.btn--primary', {
      type: 'button',
      onclick: async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = 'Зберігаю…';
        await onSave();
        button.disabled = false;
        button.textContent = 'Зберегти';
      },
    }, 'Зберегти'),
  ];
}

/** Мережева дія з людською відмовою: панель закривається лише коли вийшло. */
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

function parseMoney(value) {
  const parsed = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
