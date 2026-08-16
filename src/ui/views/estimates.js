// Кошториси: список, картка з позиціями, клієнтський вигляд.

import { el, emptyState, toast } from '../dom.js';
import { pageHeader, sectionTitle, chip, fab, statTile } from '../components.js';
import { openSheet, closeSheet } from '../sheet.js';
import { editEstimate, editEstimateItem, openItemPicker } from '../estimate-forms.js';
import { navigate } from '../router.js';
import { getState, patchItem } from '../../core/store.js';
import { projectById } from '../../core/selectors.js';
import {
  estimateTotals, totalsByCategory, itemAmount, estimateToText,
  estimateStatusLabel, describeItemCount, itemCost, crewPayouts, ESTIMATE_STATUSES,
} from '../../core/estimates.js';
import { formatMoney } from '../../core/locale.js';
import { formatDate, toDateOnly } from '../../core/dates.js';

export function estimatesView() {
  const state = getState();
  const page = el('div.page');

  page.append(pageHeader('Кошториси', {
    subtitle: `${state.estimates.length} усього`,
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Новий кошторис', onclick: () => editEstimate() }, '+'),
  }));

  page.append(el(
    'div.catalog-links',
    el('button.btn.btn--ghost', { type: 'button', onclick: () => navigate('/equipment') },
      `🎒 Техніка · ${state.equipment.length}`),
    el('button.btn.btn--ghost', { type: 'button', onclick: () => navigate('/crew') },
      `👤 Команда · ${state.crew.length}`),
  ));

  if (!state.estimates.length) {
    page.append(emptyState(
      'Кошторисів ще немає',
      'Склади перший — позиції можна брати з каталогу техніки, підсумок і маржа рахуються самі.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => editEstimate() }, 'Створити кошторис'),
    ));
    page.append(fab('Новий кошторис', () => editEstimate()));
    return page;
  }

  // Групуємо за станом: спершу те, що в роботі.
  for (const status of ESTIMATE_STATUSES) {
    const group = state.estimates
      .filter((estimate) => estimate.status === status.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!group.length) continue;

    page.append(sectionTitle(status.label, el('span.section-hint', String(group.length))));
    page.append(el('div.list', group.map((estimate) => estimateCard(estimate, state))));
  }

  page.append(fab('Новий кошторис', () => editEstimate()));
  return page;
}

function estimateCard(estimate, state) {
  const totals = estimateTotals(estimate);
  const project = projectById(state, estimate.projectId);

  return el(
    'article.card',
    { onclick: () => navigate(`/estimates/${estimate.id}`) },
    el(
      'div.card-body',
      el('p.card-title', estimate.title),
      project && el('p.card-sub', project.title),
      el('div.row-meta',
        chip(formatMoney(totals.total, estimate.currency), 'money'),
        chip(`${totals.itemCount} позицій`),
        totals.margin > 0 ? chip(`маржа ${totals.marginPercent}%`) : null),
    ),
    el('span.card-chevron', '›'),
  );
}

export function estimateDetailView(estimateId) {
  const state = getState();
  const estimate = state.estimates.find((entry) => entry.id === estimateId);
  const page = el('div.page');

  if (!estimate) {
    page.append(pageHeader('Кошторис', { back: '/estimates' }));
    page.append(emptyState('Кошторис не знайдено', 'Можливо, його видалили.'));
    return page;
  }

  const totals = estimateTotals(estimate);
  const project = projectById(state, estimate.projectId);
  const payoutTotal = crewPayouts(estimate).reduce((sum, entry) => sum + entry.payout, 0);

  page.append(pageHeader(estimate.title, {
    subtitle: project ? project.title : null,
    back: '/estimates',
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Редагувати', onclick: () => editEstimate(estimate) }, '✎'),
  }));

  page.append(el('div.tool-hero',
    el('p.tool-hero-value', formatMoney(totals.total, estimate.currency)),
    el('p.tool-hero-label', totals.tax > 0 ? 'разом із податком' : 'разом')));

  // Внутрішні цифри — те, чого клієнт не побачить ніколи.
  page.append(el('div.stats',
    statTile(formatMoney(totals.cost, estimate.currency), 'собівартість'),
    statTile(formatMoney(totals.margin, estimate.currency), 'маржа', totals.margin > 0 ? '' : 'danger'),
    statTile(`${totals.marginPercent}%`, 'від суми')));

  page.append(el('div.facts',
    chip(estimateStatusLabel(estimate.status), estimate.status === 'approved' ? 'money' : ''),
    estimate.sentAt ? chip(`Надіслано ${formatDate(toDateOnly(new Date(estimate.sentAt)))}`) : null,
    estimate.discountPercent > 0 ? chip(`Знижка ${estimate.discountPercent}%`, 'warn') : null,
    estimate.taxPercent > 0 ? chip(`Податок ${estimate.taxPercent}%`) : null));

  // --- Позиції ---
  const groups = totalsByCategory(estimate);

  if (!groups.length) {
    page.append(emptyState(
      'Позицій ще немає',
      'Додай техніку з каталогу або впиши позицію вручну.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => openItemPicker(estimate) }, 'Додати позицію'),
    ));
  } else {
    for (const group of groups) {
      page.append(sectionTitle(group.label, el('span.section-hint', formatMoney(group.amount, estimate.currency))));
      page.append(el('div.list', group.items.map((item) => el(
        'article.row',
        { onclick: () => editEstimateItem(estimate, item), class: item.internalOnly ? 'is-internal' : '' },
        el('div.row-body',
          el('p.row-title', item.title),
          el('p.row-note', item.internalOnly
            ? `${describeItemCount(item)} · виплата ${formatMoney(itemCost(item), estimate.currency)}`
            : `${describeItemCount(item)} × ${formatMoney(item.unitPrice, estimate.currency)}`),
          item.internalOnly ? el('div.row-meta', chip('тільки для мене', 'warn')) : null),
        el('span.item-amount',
          item.internalOnly ? '—' : formatMoney(itemAmount(item), estimate.currency)),
      ))));
    }

    page.append(sectionTitle('Разом'));
    page.append(el('div.result',
      totalRow('Сума позицій', formatMoney(totals.subtotal, estimate.currency)),
      totals.discount > 0 ? totalRow('Знижка', `−${formatMoney(totals.discount, estimate.currency)}`) : null,
      totals.tax > 0 ? totalRow('Податок', formatMoney(totals.tax, estimate.currency)) : null,
      totalRow('До сплати', formatMoney(totals.total, estimate.currency), 'accent'),
      totalRow('Собівартість', formatMoney(totals.cost, estimate.currency)),
      payoutTotal > 0 ? totalRow('З них гонорари команді', formatMoney(payoutTotal, estimate.currency)) : null,
      totalRow('Залишається', `${formatMoney(totals.margin, estimate.currency)} · ${totals.marginPercent}%`, 'accent'),
    ));
  }

  if (estimate.notes) {
    page.append(sectionTitle('Внутрішня нотатка'));
    page.append(el('div.note-card', estimate.notes));
  }

  page.append(sectionTitle('Дії'));
  page.append(el('div.form',
    el('button.btn.btn--ghost.btn--wide', { type: 'button', onclick: () => openItemPicker(estimate) }, '+ Додати позицію'),
    el('button.btn.btn--primary.btn--wide', { type: 'button', onclick: () => showClientView(estimate) }, '👁 Що побачить клієнт'),
    project
      ? el('button.btn.btn--ghost.btn--wide', {
          type: 'button',
          onclick: () => {
            patchItem('projects', project.id, { fee: totals.total });
            toast(`Гонорар проєкту оновлено: ${formatMoney(totals.total, estimate.currency)}`);
          },
        }, '↧ Перенести суму в гонорар проєкту')
      : null,
  ));

  page.append(fab('Додати позицію', () => openItemPicker(estimate)));
  return page;
}

function totalRow(label, value, variant = '') {
  return el(`div.result-row${variant ? `.result-row--${variant}` : ''}`,
    el('span.result-label', label),
    el('span.result-value', value));
}

/**
 * Показує кошторис очима клієнта — і дає скопіювати його текстом.
 * Поки немає сервера, це головний спосіб доставки: вставив у месенджер і все.
 */
function showClientView(estimate) {
  const text = estimateToText(estimate, formatMoney);

  const preview = el('pre.client-preview', text);

  openSheet({
    title: 'Очима клієнта',
    body: el(
      'div.form',
      el('p.settings-note', 'Рівно це побачить клієнт. Собівартості й маржі тут немає — вони фізично не потрапляють у цей текст.'),
      preview,
    ),
    actions: [
      el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Закрити'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(text);
            toast('Скопійовано — можна вставляти в чат');
          } catch {
            // Safari дозволяє запис у буфер лише у відповідь на дію користувача,
            // і зрідка все одно відмовляє. Тоді лишається виділити вручну.
            toast('Не вдалося скопіювати — виділи текст вручну', { error: true });
          }
        },
      }, 'Скопіювати'),
    ],
  });
}
