// Ідеї — швидкий блокнот для задумів, які приходять не за розкладом.

import { el, emptyState } from '../dom.js';
import { pageHeader, sectionTitle, chip, fab } from '../components.js';
import { editIdea } from '../editors.js';
import { getState, patchItem } from '../../core/store.js';
import { allTags, projectById } from '../../core/selectors.js';
import { formatDate, toDateOnly } from '../../core/dates.js';

let activeTag = null;
let query = '';

export function ideasView() {
  const state = getState();
  const page = el('div.page');

  page.append(pageHeader('Ідеї', {
    subtitle: `${state.ideas.length} збережено`,
    action: el('button.icon-btn', { type: 'button', 'aria-label': 'Нова ідея', onclick: () => editIdea() }, '+'),
  }));

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
