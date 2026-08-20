// «Поділитися з фірмою» — і зворотна дія.
//
// Окрема панель, а не галочка у формі ідеї: поділитися — це вчинок, після
// якого текст читають інші люди. Галочка, яку можна зачепити пальцем повз,
// для такого не годиться.

import { el, toast } from './dom.js';
import { openSheet, closeSheet, confirmSheet, field, formBody, selectInput } from './sheet.js';
import { knownCompanies } from '../core/context.js';
import { publishIdea, unpublishIdea } from '../core/firm-ideas.js';
import { isSignedIn } from '../core/cloud.js';

/** Чи взагалі є куди ділитися: без фірм кнопку показувати немає сенсу. */
export function canShareIdeas() {
  return isSignedIn() && knownCompanies().length > 0;
}

/**
 * Поділитися ідеєю.
 *
 * Коли фірма одна — питаємо лише підтвердження. Коли їх кілька — питаємо,
 * у яку саме: ідея, показана не тій команді, гірша за неопубліковану.
 */
export function shareIdea(idea, { onDone = null } = {}) {
  const companies = knownCompanies();
  if (!companies.length) {
    toast('Спершу приєднайся до фірми', { error: true });
    return;
  }

  let target = companies[0].id;

  const rows = [];

  if (companies.length > 1) {
    rows.push(field('Фірма', selectInput(
      companies.map((company) => ({ value: company.id, label: company.name })),
      { value: target, onchange: (event) => { target = event.target.value; } },
    )));
    rows.push(el('p.settings-note',
      'Ідею побачить уся команда обраної фірми — з твоїм імʼям. '
      + 'Особистий блокнот лишається на телефоні: туди не потрапить нічого.'));
  } else {
    rows.push(el('p.settings-note',
      `Ідею побачить уся команда «${companies[0].name}» — з твоїм імʼям. `
      + 'Особистий блокнот лишається на телефоні: туди не потрапить нічого.'));
  }

  openSheet({
    title: `«${idea.title}»`,
    body: formBody(...rows),
    actions: [
      el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          button.textContent = 'Надсилаю…';
          try {
            await publishIdea(target, idea);
            closeSheet();
            toast('Ідея у фірмі');
            if (onDone) onDone();
          } catch (error) {
            button.disabled = false;
            button.textContent = 'Поділитися';
            toast(error?.message ?? 'Не вдалося надіслати', { error: true });
          }
        },
      }, 'Поділитися'),
    ],
  });
}

/** Прибрати ідею з фірми. Сам запис на телефоні лишається недоторканим. */
export function withdrawIdea(companyId, localId, { title = 'Ідея', onDone = null } = {}) {
  confirmSheet({
    title: 'Прибрати з фірми?',
    message: `«${title}» зникне у команди. У твоєму блокноті ідея лишиться.`,
    confirmLabel: 'Прибрати',
    onConfirm: async () => {
      try {
        await unpublishIdea(companyId, localId);
        toast('Прибрано з фірми');
        if (onDone) onDone();
      } catch (error) {
        toast(error?.message ?? 'Не вдалося прибрати', { error: true });
      }
    },
  });
}
