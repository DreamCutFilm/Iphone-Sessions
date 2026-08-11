// Форми створення й редагування записів. Усі відкриваються як панелі знизу.

import { el, toast } from './dom.js';
import {
  openSheet, closeSheet, confirmSheet, field, formBody,
  textInput, textArea, selectInput, dateInput, numberInput, segmented,
} from './sheet.js';
import { addItem, patchItem, removeItem, getState } from '../core/store.js';
import { createProject, createTask, createIdea, PROJECT_STATUSES, PRIORITIES } from '../core/models.js';
import { toLocalInputValue, fromLocalInputValue, formatDate, todayISO } from '../core/dates.js';
import { currencySymbol } from '../core/locale.js';
import { navigate } from './router.js';

function projectOptions() {
  return [
    { value: '', label: 'Без проєкту' },
    ...getState().projects
      .filter((project) => project.status !== 'archived')
      .map((project) => ({ value: project.id, label: project.title })),
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
              message: `«${task.title}» зникне назавжди.`,
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

export function editProject(existing = null) {
  const project = existing ?? createProject();
  const draft = { ...project, shootDays: [...project.shootDays] };

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

  const shootPicker = dateInput({
    value: '',
    onchange: (event) => {
      const value = event.target.value;
      if (value && !draft.shootDays.includes(value)) {
        draft.shootDays.push(value);
        renderShootDays();
      }
      event.target.value = '';
    },
  });

  const body = formBody(
    field('Назва', textInput({
      value: existing ? draft.title : '',
      placeholder: 'Кліп, реклама, весілля…',
      oninput: (event) => { draft.title = event.target.value; },
    })),
    field('Клієнт', textInput({
      value: draft.client,
      placeholder: 'Хто замовник',
      oninput: (event) => { draft.client = event.target.value; },
    })),
    field('Стадія', selectInput(
      PROJECT_STATUSES.map((status) => ({ value: status.id, label: status.label })),
      { value: draft.status, onchange: (event) => { draft.status = event.target.value; } },
    )),
    field('Здача матеріалу', dateInput({
      value: draft.deadline ?? '',
      onchange: (event) => { draft.deadline = event.target.value || null; },
    }), 'Дедлайн, від якого рахується все інше.'),
    field('Знімальні дні', el('div.day-picker', shootPicker, shootList)),
    field('Локація', textInput({
      value: draft.location,
      placeholder: 'Місто, адреса, павільйон',
      oninput: (event) => { draft.location = event.target.value; },
    })),
    field(`Гонорар, ${currencySymbol(getState().settings.currency)}`, numberInput({
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
              message: `«${project.title}» зникне. Задачі та ідеї залишаться, але без привʼязки.`,
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

  openSheet({
    title: existing ? 'Ідея' : 'Нова ідея',
    body,
    actions: [
      existing
        ? el('button.btn.btn--ghost', {
            type: 'button',
            onclick: () => confirmSheet({
              title: 'Видалити ідею?',
              message: `«${idea.title}» зникне назавжди.`,
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
