// Маршрутизація на хеші (#/projects/prj_123).
//
// Хеш обрано свідомо: такий застосунок працює і з file://, і з будь-якої
// підпапки на GitHub Pages, і всередині WKWebView нативної оболонки —
// без жодних налаштувань сервера.

const routes = [];
let notFound = null;
let currentPath = null;
let onNavigate = null;

/** Реєструє маршрут. Шаблон виду '/projects/:id'. */
export function route(pattern, handler) {
  routes.push({ pattern, handler, matcher: buildMatcher(pattern) });
}

export function setNotFound(handler) {
  notFound = handler;
}

export function setNavigationListener(listener) {
  onNavigate = listener;
}

function buildMatcher(pattern) {
  const names = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return escapeRegex(segment);
      names.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { regex: new RegExp(`^${source}$`), names };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function currentRoute() {
  const hash = window.location.hash.replace(/^#/, '');
  return hash || '/overview';
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

export function back() {
  if (window.history.length > 1) window.history.back();
  else navigate('/overview');
}

function resolve() {
  const path = currentRoute();
  currentPath = path;

  for (const entry of routes) {
    const match = path.match(entry.matcher.regex);
    if (!match) continue;
    const params = {};
    entry.matcher.names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1]);
    });
    entry.handler(params);
    if (onNavigate) onNavigate(path);
    return;
  }

  if (notFound) notFound(path);
  if (onNavigate) onNavigate(path);
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  if (!window.location.hash) navigate('/overview', { replace: true });
  else resolve();
}

/** Перемальовує поточний екран — викликається при зміні даних. */
export function rerender() {
  if (currentPath !== null) resolve();
}
