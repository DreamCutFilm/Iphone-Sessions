// Перемикач «Моє / фірма» — той самий на всіх головних екранах.
//
// Стоїть одразу під заголовком і ніде більше не дублюється: якби кожен екран
// перемикався окремо, людина губила б, де вона зараз, і бачила б своє на
// одній вкладці й фірмове на сусідній.
//
// Коли фірма одна, смуга все одно потрібна: вона відповідає на питання
// «а я зараз де?» — і без неї фірмові дані виглядали б як власні.

import { el } from './dom.js';
import { t } from '../core/i18n.js';
import { getContext, setContext, knownCompanies, MINE } from '../core/context.js';
import { isSignedIn } from '../core/cloud.js';
import { rerender } from './router.js';
import { describeAge } from '../core/cache.js';

export function contextBar() {
  if (!isSignedIn()) return null;

  const companies = knownCompanies();
  if (!companies.length) return null;

  const current = getContext();

  // Фірми в памʼяті лежать без ознаки «kind» — вона є тільки в контексті.
  // Тому вигляд рядка вирішує не поле в даних, а місце в списку: перший
  // елемент — це «Моє», решта — фірми.
  const options = [
    { id: null, name: 'Моє', mine: true },
    ...companies.map((company) => ({ ...company, mine: false })),
  ];

  return el('div.context-bar', options.map((option) => {
    const active = option.mine
      ? current.kind === 'mine'
      : current.kind === 'company' && current.id === option.id;

    return el('button.context-chip', {
      type: 'button',
      class: active ? 'is-active' : '',
      'aria-pressed': active ? 'true' : 'false',
      onclick: () => {
        if (active) return;
        setContext(option.mine
          ? MINE
          : { kind: 'company', id: option.id, name: option.name, role: option.role });
        rerender();
      },
    }, option.name);
  }));
}

/**
 * Підпис під даними, які прийшли з мережі.
 *
 * Показуємо лише тоді, коли є про що сказати: свіже мовчить, старе — ні.
 * Обіцянка «не видавати старе за свіже» тримається саме на цьому рядку.
 */
export function freshnessNote(result, onRetry = null) {
  if (!result || result.fresh) return null;

  const note = el('p.settings-note.settings-note--stale',
    t('⚠ Немає звʼязку. Показано те, що завантажилось {when}.', { when: describeAge(result.at) }));

  if (!onRetry) return note;

  return el('div',
    note,
    el('button.link', { type: 'button', onclick: onRetry }, 'Спробувати ще раз'));
}
