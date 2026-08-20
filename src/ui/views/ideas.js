// Ідеї — швидкий блокнот для задумів, які приходять не за розкладом.

import { el, emptyState, appendIf } from '../dom.js';
import { inCompany, currentCompany } from '../../core/context.js';
import { contextBar, freshnessNote } from '../context-bar.js';
import { pageHeader, sectionTitle, chip, fab } from '../components.js';
import { editIdea } from '../editors.js';
import { shareIdea, withdrawIdea, canShareIdeas } from '../idea-share.js';
import { firmIdeas, publishedIdeas } from '../../core/firm-ideas.js';
import { getState, patchItem } from '../../core/store.js';
import { allTags, projectById } from '../../core/selectors.js';
import { formatDate, toDateOnly } from '../../core/dates.js';

let activeTag = null;
let query = '';

export function ideasView() {
  return inCompany() ? firmIdeasView() : myIdeasView();
}

/**
 * Ідеї очима фірми.
 *
 * Спершу те, чим поділилася команда, — заради цього сюди й заходять у фірмі.
 * Нижче власний блокнот: щоб поділитися чимось із нього, не блукаючи
 * між вкладками.
 */
function firmIdeasView() {
  const company = currentCompany();
  const page = el('div.page');

  page.append(pageHeader('Ідеї', {
    subtitle: company.name,
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Нова ідея', onclick: () => editIdea() }, '+'),
  }));

  appendIf(page, contextBar());

  const host = el('div');
  page.append(host);
  loadFirmIdeas(host, company);

  page.append(fab('Нова ідея', () => editIdea()));
  return page;
}

async function loadFirmIdeas(host, company) {
  host.replaceChildren(el('p.settings-note', 'Завантажую…'));

  let feed;
  let mine;
  try {
    [feed, mine] = await Promise.all([firmIdeas(company.id), publishedIdeas(company.id)]);
  } catch (error) {
    host.replaceChildren(
      el('p.settings-note', error?.message ?? 'Немає звʼязку з сервером'),
      el('div.form', el('button.btn.btn--ghost.btn--wide', {
        type: 'button', onclick: () => loadFirmIdeas(host, company),
      }, 'Спробувати ще раз')),
    );
    return;
  }

  const reload = () => loadFirmIdeas(host, company);
  const shared = feed.value;
  const publishedLocalIds = new Set(mine.value);
  const parts = [];

  const stale = freshnessNote(feed.fresh ? mine : feed, reload);
  if (stale) parts.push(stale);

  parts.push(sectionTitle('Спільні ідеї', el('span.section-hint', `${shared.length}`)));
  parts.push(shared.length
    ? el('div.ideas', shared.map((idea) => firmIdeaCard(idea, company, reload)))
    : emptyState(
      'Команда ще нічим не ділилася',
      'Будь-яку свою ідею можна відправити сюди — знизу вибери її й натисни «У фірму».',
    ));

  const state = getState();
  const own = [...state.ideas]
    .sort((a, b) => Number(b.starred) - Number(a.starred) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12);

  parts.push(sectionTitle('Мій блокнот', el('span.section-hint', 'лише на цьому телефоні')));
  parts.push(own.length
    ? el('div.ideas', own.map((idea) => myIdeaRow(idea, company, publishedLocalIds, reload)))
    : emptyState('Порожньо', 'Записуй кадри, ходи камери, референси — усе, що шкода забути.'));

  host.replaceChildren(...parts);
}

function firmIdeaCard(idea, company, reload) {
  const meta = idea.tags.map((tag) => chip(tag));
  if (idea.projectTitle) meta.push(chip(idea.projectTitle, 'project'));

  const canRemove = idea.isMine && idea.localId;

  return el(
    'article.card.idea-card',
    el(
      'div.card-body',
      el('div.idea-head',
        el('p.card-title', idea.title),
        canRemove
          ? el('button.link', {
              type: 'button',
              onclick: () => withdrawIdea(company.id, idea.localId, { title: idea.title, onDone: reload }),
            }, 'Прибрати')
          : null),
      idea.body ? el('p.idea-body', idea.body) : null,
      el('div.row-meta', meta,
        el('span.idea-date', [idea.author, formatDate(toDateOnly(new Date(idea.createdAt)))]
          .filter(Boolean).join(' · '))),
    ),
  );
}

/** Рядок власної ідеї у фірмовому вигляді: видно, чи вона вже в команди. */
function myIdeaRow(idea, company, publishedLocalIds, reload) {
  const published = publishedLocalIds.has(idea.id);

  return el(
    'article.row',
    el('span.row-mark', idea.starred ? '★' : '○'),
    el('div.row-body',
      { onclick: () => editIdea(idea) },
      el('p.row-title', idea.title),
      idea.body ? el('p.row-note', idea.body.slice(0, 90)) : null),
    published
      ? chip('у фірмі', 'ok')
      : el('button.link', {
          type: 'button',
          onclick: () => shareIdea(idea, { onDone: reload }),
        }, 'У фірму'),
  );
}

function myIdeasView() {
  const state = getState();
  const page = el('div.page');

  page.append(pageHeader('Ідеї', {
    subtitle: `${state.ideas.length} збережено`,
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Нова ідея', onclick: () => editIdea() }, '+'),
  }));

  appendIf(page, contextBar());

  if (!state.ideas.length) {
    page.append(emptyState(
      'Тут порожньо',
      'Записуй кадри, ходи камери, референси — усе, що шкода забути.',
      el('button.btn.btn--primary', { type: 'button', onclick: () => editIdea() }, 'Записати ідею'),
    ));
    page.append(fab('Нова ідея', () => editIdea()));
    return page;
  }

  const search = el('input.input.input--search', {
    type: 'search',
    value: query,
    placeholder: 'Пошук за назвою, текстом, тегом',
    oninput: (event) => {
      query = event.target.value;
      renderList();
    },
  });
  page.append(el('div.search-bar', search));

  const tags = allTags(state);
  let refreshTags = () => {};

  if (tags.length) {
    const tagBar = el('div.filters');
    tagBar.append(el('button.filter', {
      type: 'button',
      class: activeTag === null ? 'is-active' : '',
      onclick: () => { activeTag = null; refreshTags(); renderList(); },
    }, 'Усі'));
    for (const tag of tags) {
      tagBar.append(el('button.filter', {
        type: 'button',
        class: activeTag === tag ? 'is-active' : '',
        onclick: () => { activeTag = activeTag === tag ? null : tag; refreshTags(); renderList(); },
      }, tag));
    }
    page.append(tagBar);

    refreshTags = () => {
      for (const button of tagBar.children) {
        const label = button.textContent;
        const isActive = label === 'Усі' ? activeTag === null : activeTag === label;
        button.classList.toggle('is-active', isActive);
      }
    };
  }

  const listHost = el('div.ideas');
  page.append(listHost);

  function renderList() {
    const needle = query.trim().toLowerCase();
    const filtered = state.ideas
      .filter((idea) => (activeTag ? idea.tags.includes(activeTag) : true))
      .filter((idea) => {
        if (!needle) return true;
        return (
          idea.title.toLowerCase().includes(needle) ||
          idea.body.toLowerCase().includes(needle) ||
          idea.tags.some((tag) => tag.toLowerCase().includes(needle))
        );
      })
      .sort((a, b) => Number(b.starred) - Number(a.starred) || b.createdAt.localeCompare(a.createdAt));

    listHost.replaceChildren();
    if (!filtered.length) {
      listHost.append(emptyState('Нічого не знайшлось', 'Спробуй інший запит або скинь фільтр.'));
      return;
    }
    for (const idea of filtered) listHost.append(ideaCard(idea, state));
  }

  renderList();
  page.append(fab('Нова ідея', () => editIdea()));
  return page;
}

function ideaCard(idea, state) {
  const project = projectById(state, idea.projectId);
  const meta = idea.tags.map((tag) => chip(tag));
  if (project) meta.push(chip(project.title, 'project'));

  return el(
    'article.card.idea-card',
    { onclick: () => editIdea(idea) },
    el(
      'div.card-body',
      el('div.idea-head',
        el('p.card-title', idea.title),
        el('button.star', {
          type: 'button',
          class: idea.starred ? 'is-on' : '',
          'aria-label': idea.starred ? 'Прибрати з обраного' : 'В обране',
          onclick: (event) => {
            event.stopPropagation();
            patchItem('ideas', idea.id, { starred: !idea.starred });
          },
        }, idea.starred ? '★' : '☆')),
      idea.body && el('p.idea-body', idea.body),
      el('div.row-meta', meta, el('span.idea-date', formatDate(toDateOnly(new Date(idea.createdAt))))),
    ),
  );
}

export { sectionTitle };
