// Форми створення й редагування записів. Усі відкриваються як панелі знизу.

import { el, toast } from './dom.js';
import { t } from '../core/i18n.js';
import {
  openSheet, closeSheet, confirmSheet, field, formBody,
  textInput, textArea, selectInput, dateInput, numberInput, segmented,
} from './sheet.js';
import { addItem, patchItem, removeItem, getState } from '../core/store.js';
import { createProject, createTask, createIdea, PROJECT_STATUSES, PROJECT_STYLES, PRIORITIES } from '../core/models.js';
import { toLocalInputValue, fromLocalInputValue, formatDate, todayISO, expandDateRange, plural } from '../core/dates.js';
import { currencySymbol } from '../core/locale.js';
import { crewLabel } from '../core/crew.js';
import { isValidCoordinate, formatCoordinates } from '../core/geo.js';
import { openMapPicker } from './map-picker.js';
import { shareIdea, canShareIdeas } from './idea-share.js';
import { navigate } from './router.js';

// Службове значення для пункту «Свій варіант…» у списку типів зйомки.
// Порожній рядок зайнятий пунктом «Не вказано», тож потрібен окремий маркер.
const CUSTOM_STYLE = '__custom__';

function projectOptions() {
  return [
    { value: '', label: 'Без проєкту' },
    ...getState().projects
      .filter((project) => project.status !== 'archived')
      .map((project) => ({ value: project.id, label: project.title })),
  ];
}

/** Кому можна доручити задачу: каталог команди. */
function crewOptions() {
  return [
    { value: '', label: 'Спільна — для всіх' },
    ...getState().crew
      .filter((member) => !member.archived)
      .map((member) => ({ value: member.id, label: crewLabel(member) })),
  ];
}

// --- Задача ---------------------------------------------------------------

export function editTask(existing = null, defaults = {}) {
  const task = existing ?? createTask(defaults);
  const draft = { ...task };

  const titleInput = textInput({
    value: draft.title === 'Без назви' && !existing ? '' : draft.title,
    placeholder: 'Що зробити',
    oninput: (event) => { draft.title = event.target.value; },
  });

  const body = formBody(
    field('Задача', titleInput),
    field(
      'Проєкт',
      selectInput(projectOptions(), {
        value: draft.projectId ?? '',
        onchange: (event) => { draft.projectId = event.target.value || null; },
      }),
    ),
    field(
      'Кому',
      selectInput(crewOptions(), {
        value: draft.crewId ?? '',
        onchange: (event) => { draft.crewId = event.target.value || null; },
      }),
      'Коли проєкт опублікований у фірмі, людина побачить цю задачу як свою. '
      + 'Порожньо — задача спільна, її бачить уся команда.',
    ),
    field(
      'Термін',
      dateInput({ value: draft.due ?? '', onchange: (event) => { draft.due = event.target.value || null; } }),
      'Порожньо — задача без дати, живе у списку «Колись».',
    ),
    field(
      'Нагадати',
      el('input.input', {
        type: 'datetime-local',
        value: toLocalInputValue(draft.remindAt),
        onchange: (event) => {
          draft.remindAt = fromLocalInputValue(event.target.value);
          // Новий час нагадування означає, що показати його треба заново.
          draft.remindedAt = null;
        },
      }),
    ),
    field('Пріоритет', segmented(
      PRIORITIES.map((priority) => ({ value: priority.id, label: priority.label })),
      draft.priority,
      (value) => { draft.priority = value; },
    )),
    field('Нотатка', textArea({
      value: draft.notes,
      placeholder: 'Деталі, техніка, контакти',
      oninput: (event) => { draft.notes = event.target.value; },
    })),
  );

  openSheet({
    title: existing ? 'Задача' : 'Нова задача',
    body,
    actions: [
      existing
        ? el('button.btn.btn--ghost', {
            type: 'button',
            onclick: () => confirmSheet({
              title: 'Видалити задачу?',
              message: t('«{name}» зникне назавжди.', { name: task.title }),
              onConfirm: () => { removeItem('tasks', task.id); toast('Задачу видалено'); },
            }),
          }, 'Видалити')
        : el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: () => {
          if (!draft.title.trim()) { toast('Впиши, що треба зробити', { error: true }); return; }
          if (existing) patchItem('tasks', task.id, draft);
          else addItem('tasks', { ...draft, title: draft.title.trim() });
          closeSheet();
          toast(existing ? 'Збережено' : 'Задачу додано');
        },
      }, 'Зберегти'),
    ],
  });
}

// --- Проєкт ---------------------------------------------------------------

/**
 * @param {object|null} existing запис, що редагується
 * @param {object|null} draftOverride незбережені дані форми — потрібні, щоб
 *        повернути користувача рівно туди, де він був, після вибору місця
 *        на карті (карта відкривається окремою панеллю поверх цієї)
 */
export function editProject(existing = null, draftOverride = null) {
  const project = existing ?? createProject();
  const draft = draftOverride
    ? { ...draftOverride, shootDays: [...draftOverride.shootDays] }
    : { ...project, shootDays: [...project.shootDays] };

  const shootList = el('div.day-list');

  const renderShootDays = () => {
    shootList.replaceChildren();
    const sorted = [...draft.shootDays].sort();
    for (const day of sorted) {
      shootList.append(el(
        'span.day-chip',
        formatDate(day),
        el('button.day-remove', {
          type: 'button',
          'aria-label': 'Прибрати день',
          onclick: () => {
            draft.shootDays = draft.shootDays.filter((value) => value !== day);
            renderShootDays();
          },
        }, '×'),
      ));
    }
    if (!sorted.length) shootList.append(el('span.day-empty', 'Знімальних днів ще немає'));
  };
  renderShootDays();

  // Знімальні дні задаються проміжком «від — до» і додаються ЛИШЕ по кнопці.
  // Раніше день додавався на кожну зміну поля дати, а колесо вибору на iPhone
  // спершу віддає сьогоднішнє число — через це замість однієї обраної дати
  // у списку опинялися дві.
  const shootFrom = dateInput({ value: '' });
  const shootTo = dateInput({ value: '' });

  const addShootDays = () => {
    const days = expandDateRange(shootFrom.value, shootTo.value);
    if (!days.length) {
      toast('Спершу вкажи дату «від»', { error: true });
      return;
    }

    const fresh = days.filter((day) => !draft.shootDays.includes(day));
    draft.shootDays.push(...fresh);
    renderShootDays();

    shootFrom.value = '';
    shootTo.value = '';

    if (!fresh.length) toast('Ці дні вже додано');
    else toast(fresh.length === 1 ? 'День додано' : t('Додано {days}', { days: plural(fresh.length, 'день', 'дні', 'днів') }));
  };

  const body = formBody(
    field('Назва проєкту', textInput({
      value: existing || draftOverride ? draft.title : '',
      placeholder: 'Кліп, реклама, весілля…',
      oninput: (event) => { draft.title = event.target.value; },
    })),
    field('Клієнт', textInput({
      value: draft.client,
      placeholder: 'Хто замовник',
      oninput: (event) => { draft.client = event.target.value; },
    })),
    styleField(draft),
    field('Знімальні дні', el(
      'div.day-picker',
      el(
        'div.day-range',
        el('label.day-range-item', el('span.field-label', 'Від'), shootFrom),
        el('label.day-range-item', el('span.field-label', 'До'), shootTo),
      ),
      el('button.btn.btn--ghost.btn--wide', { type: 'button', onclick: addShootDays }, 'Додати дні'),
      shootList,
    ), 'Один день — заповни лише «Від». Для зміни на кілька днів вкажи обидві дати.'),
    field('Здача матеріалу', dateInput({
      value: draft.deadline ?? '',
      onchange: (event) => { draft.deadline = event.target.value || null; },
    }), 'Дедлайн, від якого рахується все інше.'),
    // Карта відкривається окремою панеллю поверх форми, тож форму треба вміти
    // відтворити разом із усім, що вже введено, але ще не збережено.
    locationField(draft, (updated) => editProject(existing, updated)),
    field(t('Гонорар, {symbol}', { symbol: currencySymbol(getState().settings.currency) }), numberInput({
      value: draft.fee ?? '',
      placeholder: '0',
      oninput: (event) => {
        const parsed = Number.parseFloat(event.target.value);
        draft.fee = Number.isFinite(parsed) ? parsed : null;
      },
    })),
    el('label.switch',
      el('input', {
        type: 'checkbox',
        checked: draft.paid,
        onchange: (event) => { draft.paid = event.target.checked; },
      }),
      el('span', 'Оплачено'),
    ),
    field('Стадія проєкту', selectInput(
      PROJECT_STATUSES.map((status) => ({ value: status.id, label: status.label })),
      { value: draft.status, onchange: (event) => { draft.status = event.target.value; } },
    )),
    field('Нотатки', textArea({
      value: draft.notes,
      placeholder: 'Референси, техніка, побажання клієнта',
      oninput: (event) => { draft.notes = event.target.value; },
    })),
  );

  openSheet({
    title: existing ? 'Проєкт' : 'Новий проєкт',
    body,
    actions: [
      existing
        ? el('button.btn.btn--ghost', {
            type: 'button',
            onclick: () => confirmSheet({
              title: 'Видалити проєкт?',
              message: t('«{name}» зникне. Задачі та ідеї залишаться, але без привʼязки.', { name: project.title }),
              onConfirm: () => {
                removeItem('projects', project.id);
                navigate('/projects');
                toast('Проєкт видалено');
              },
            }),
          }, 'Видалити')
        : el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: () => {
          if (!draft.title.trim()) { toast('У проєкту має бути назва', { error: true }); return; }
          if (existing) {
            patchItem('projects', project.id, draft);
          } else {
            addItem('projects', { ...draft, title: draft.title.trim() });
          }
          closeSheet();
          toast(existing ? 'Збережено' : 'Проєкт створено');
        },
      }, 'Зберегти'),
    ],
  });
}

/**
 * Тип зйомки: список підказок плюс власний варіант.
 * Зберігається звичайним рядком, тож свій варіант нічим не гірший за готовий.
 */
function styleField(draft) {
  const isPreset = PROJECT_STYLES.includes(draft.style);
  const customInput = textInput({
    value: isPreset ? '' : draft.style,
    placeholder: 'Свій тип зйомки',
    oninput: (event) => { draft.style = event.target.value; },
  });
  // Поле для власного варіанта видно лише тоді, коли тип уже вписано вручну.
  customInput.hidden = isPreset || !draft.style;

  const select = selectInput(
    [
      { value: '', label: 'Не вказано' },
      ...PROJECT_STYLES.map((style) => ({ value: style, label: style })),
      { value: CUSTOM_STYLE, label: 'Свій варіант…' },
    ],
    {
      value: isPreset ? draft.style : (draft.style ? CUSTOM_STYLE : ''),
      onchange: (event) => {
        if (event.target.value === CUSTOM_STYLE) {
          customInput.hidden = false;
          draft.style = customInput.value.trim();
          customInput.focus();
        } else {
          customInput.hidden = true;
          draft.style = event.target.value;
        }
      },
    },
  );

  return field('Тип зйомки', el('div.style-field', select, customInput));
}

/** Локація: текстова адреса плюс точка на карті. Одне не заважає іншому. */
function locationField(draft, reopenWith) {
  const point = el('div.location-point');

  const renderPoint = () => {
    point.replaceChildren();
    if (!isValidCoordinate(draft.latitude, draft.longitude)) {
      point.append(el('span.day-empty', 'Точку на карті не задано'));
      return;
    }
    point.append(
      el('span.day-chip',
        `📍 ${formatCoordinates(draft.latitude, draft.longitude)}`,
        el('button.day-remove', {
          type: 'button',
          'aria-label': 'Прибрати точку',
          onclick: () => {
            draft.latitude = null;
            draft.longitude = null;
            renderPoint();
          },
        }, '×')),
    );
  };
  renderPoint();

  const openMap = () => {
    const snapshot = { ...draft, shootDays: [...draft.shootDays] };
    openMapPicker({
      latitude: draft.latitude,
      longitude: draft.longitude,
      label: draft.title,
      onPick: (picked) => reopenWith({
        ...snapshot,
        latitude: picked?.latitude ?? null,
        longitude: picked?.longitude ?? null,
      }),
      // Закрили карту хрестиком — повертаємо форму без змін.
      onCancel: () => reopenWith(snapshot),
    });
  };

  return field('Локація', el(
    'div.location-field',
    textInput({
      value: draft.location,
      placeholder: 'Місто, адреса, павільйон',
      oninput: (event) => { draft.location = event.target.value; },
    }),
    el('button.btn.btn--ghost.btn--wide', { type: 'button', onclick: openMap }, '🗺 Обрати на карті'),
    point,
  ), 'Адресу можна просто вписати, а можна ще й поставити точку — тоді з картки проєкту відкриється навігація.');
}

// --- Ідея -----------------------------------------------------------------

export function editIdea(existing = null, defaults = {}) {
  const idea = existing ?? createIdea(defaults);
  const draft = { ...idea, tags: [...idea.tags] };

  const body = formBody(
    field('Ідея', textInput({
      value: existing ? draft.title : '',
      placeholder: 'Одним рядком',
      oninput: (event) => { draft.title = event.target.value; },
    })),
    field('Опис', textArea({
      value: draft.body,
      rows: 6,
      placeholder: 'Кадр, світло, рух камери, референс…',
      oninput: (event) => { draft.body = event.target.value; },
    })),
    field('Теги', textInput({
      value: draft.tags.join(', '),
      placeholder: 'через кому: світло, дрон, тайм-лапс',
      oninput: (event) => {
        draft.tags = event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean);
      },
    })),
    field('Проєкт', selectInput(projectOptions(), {
      value: draft.projectId ?? '',
      onchange: (event) => { draft.projectId = event.target.value || null; },
    })),
    el('label.switch',
      el('input', {
        type: 'checkbox',
        checked: draft.starred,
        onchange: (event) => { draft.starred = event.target.checked; },
      }),
      el('span', 'В обране'),
    ),
  );

  // «У фірму» стоїть тільки в уже збереженої ідеї: ділитися чернеткою,
  // яку ще не дописали, немає сенсу — команда побачить півдумки.
  const shareButton = existing && canShareIdeas()
    ? el('button.btn.btn--ghost.btn--wide', {
        type: 'button',
        onclick: () => {
          // Ділимося тим, що на екрані, тому спершу зберігаємо: інакше
          // команда побачила б попередній текст, а автор — свій новий.
          const fresh = { ...idea, ...draft, title: draft.title.trim() || idea.title };
          patchItem('ideas', idea.id, fresh);
          shareIdea(fresh);
        },
      }, 'Поділитися з фірмою')
    : null;

  if (shareButton) body.append(shareButton);

  openSheet({
    title: existing ? 'Ідея' : 'Нова ідея',
    body,
    actions: [
      existing
        ? el('button.btn.btn--ghost', {
            type: 'button',
            onclick: () => confirmSheet({
              title: 'Видалити ідею?',
              message: t('«{name}» зникне назавжди.', { name: idea.title }),
              onConfirm: () => { removeItem('ideas', idea.id); toast('Ідею видалено'); },
            }),
          }, 'Видалити')
        : el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: () => {
          if (!draft.title.trim()) { toast('Дай ідеї назву', { error: true }); return; }
          if (existing) patchItem('ideas', idea.id, draft);
          else addItem('ideas', { ...draft, title: draft.title.trim() });
          closeSheet();
          toast(existing ? 'Збережено' : 'Ідею збережено');
        },
      }, 'Зберегти'),
    ],
  });
}

/** Швидке додавання задачі на сьогодні — з екрана огляду. */
export function quickTask() {
  editTask(null, { due: todayISO() });
}
