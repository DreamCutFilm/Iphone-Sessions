// Модальні панелі, що виїжджають знизу — звичний для iOS спосіб редагування.
//
// Панель живе окремо від основного дерева й не перемальовується разом із ним:
// інакше введений текст губив би фокус на кожній зміні стану.

import { el, clear } from './dom.js';

let activeSheet = null;

// Слухачі закриття панелі. Потрібні, бо екран під панеллю не перемальовується,
// поки вона відкрита (інакше введений текст втрачав би фокус), — і хтось має
// дізнатися, що настав момент показати зміни.
const closeListeners = new Set();

export function onSheetClosed(listener) {
  closeListeners.add(listener);
  return () => closeListeners.delete(listener);
}

export function openSheet({ title, body, actions = [], onClose = null }) {
  closeSheet();

  const backdrop = el('div.sheet-backdrop');
  const panel = el('section.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });

  const header = el(
    'header.sheet-header',
    el('h2.sheet-title', title),
    el('button.sheet-close', { type: 'button', 'aria-label': 'Закрити', onclick: () => closeSheet() }, '×'),
  );

  const content = el('div.sheet-body', body);
  const footer = actions.length ? el('footer.sheet-actions', actions) : null;

  panel.append(header, content);
  if (footer) panel.append(footer);
  backdrop.append(panel);
  document.body.append(backdrop);
  document.body.classList.add('is-locked');

  // Клік по затемненню закриває, клік усередині панелі — ні.
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeSheet();
  });

  activeSheet = { backdrop, onClose };

  // Даємо кадр на вставку в дерево, щоб спрацювала анімація появи.
  requestAnimationFrame(() => backdrop.classList.add('sheet-backdrop--open'));

  const firstField = content.querySelector('input, textarea, select');
  // Автофокус тільки на великому екрані: на iPhone він одразу викидає клавіатуру
  // й закриває половину форми.
  if (firstField && window.matchMedia('(min-width: 700px)').matches) firstField.focus();

  return { close: closeSheet, panel, content };
}

export function closeSheet() {
  if (!activeSheet) return;
  const { backdrop, onClose } = activeSheet;
  activeSheet = null;

  backdrop.classList.remove('sheet-backdrop--open');
  document.body.classList.remove('is-locked');
  setTimeout(() => backdrop.remove(), 200);
  if (onClose) onClose();

  for (const listener of closeListeners) {
    try {
      listener();
    } catch (error) {
      console.error('Помилка в слухачі закриття панелі:', error);
    }
  }
}

export function isSheetOpen() {
  return activeSheet !== null;
}

/** Підтвердження дії, яку не можна відкотити. */
export function confirmSheet({ title, message, confirmLabel = 'Видалити', onConfirm }) {
  openSheet({
    title,
    body: el('p.sheet-message', message),
    actions: [
      el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el(
        'button.btn.btn--danger',
        {
          type: 'button',
          onclick: () => {
            closeSheet();
            onConfirm();
          },
        },
        confirmLabel,
      ),
    ],
  });
}

// --- Поля форм ------------------------------------------------------------

export function field(label, input, hint = null) {
  return el('label.field', el('span.field-label', label), input, hint && el('span.field-hint', hint));
}

export function textInput(props = {}) {
  return el('input.input', { type: 'text', ...props });
}

export function textArea(props = {}) {
  return el('textarea.input.input--area', { rows: 4, ...props });
}

export function selectInput(options, props = {}) {
  const node = el('select.input', props);
  for (const option of options) {
    node.append(el('option', { value: option.value, selected: option.value === props.value }, option.label));
  }
  return node;
}

export function dateInput(props = {}) {
  return el('input.input', { type: 'date', ...props });
}

export function numberInput(props = {}) {
  return el('input.input', { type: 'number', inputmode: 'decimal', ...props });
}

/** Ряд кнопок-перемикачів — швидше за випадний список на телефоні. */
export function segmented(options, value, onChange) {
  const node = el('div.segmented', { role: 'group' });
  for (const option of options) {
    const button = el(
      'button.segmented-item',
      {
        type: 'button',
        class: option.value === value ? 'is-active' : '',
        onclick: () => {
          for (const item of node.children) item.classList.remove('is-active');
          button.classList.add('is-active');
          onChange(option.value);
        },
      },
      option.label,
    );
    node.append(button);
  }
  return node;
}

/** Форма, яку можна відправити кнопкою в підвалі панелі. */
export function formBody(...rows) {
  const form = el('form.form', { onsubmit: (event) => event.preventDefault() });
  for (const row of rows) if (row) form.append(row);
  return form;
}

export function refreshSheetBody(sheet, body) {
  clear(sheet.content);
  sheet.content.append(body);
}
