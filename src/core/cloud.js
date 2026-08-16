// Звернення до бази: вхід, реєстрація, запити.
//
// Написано вручну, без бібліотеки Supabase. Причина проста: застосунок не має
// збірки й жодних залежностей — усе, що браузер вантажить, лежить у цьому
// репозиторії. Офіційна бібліотека потягла б за собою збирач і зовнішній
// пакет, а нам потрібні лише кілька запитів по HTTP.
//
// Модуль не знає про DOM: його можна запустити в тестах і в нативній оболонці.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { readJson, writeJson, removeKey } from './storage.js';

const SESSION_KEY = 'dreamcut.session.v1';

// Оновлюємо токен трохи раніше, ніж він справді протухне: інакше запит,
// що вирушив за секунду до кінця, отримав би відмову вже в дорозі.
const REFRESH_MARGIN_SECONDS = 60;

let session = readJson(SESSION_KEY, null);
const listeners = new Set();

/** Підписка на вхід і вихід. Повертає функцію відписки. */
export function onSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setSession(next) {
  session = next;
  if (next) writeJson(SESSION_KEY, next);
  else removeKey(SESSION_KEY);

  for (const listener of listeners) {
    try {
      listener(next);
    } catch (error) {
      console.error('Помилка в підписнику сесії:', error);
    }
  }
}

export function currentUser() {
  return session?.user ?? null;
}

export function isSignedIn() {
  return Boolean(session?.access_token);
}

// --- Низький рівень --------------------------------------------------------

async function call(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const token = auth && session?.access_token ? session.access_token : SUPABASE_KEY;

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? safeParse(text) : null;

  if (!response.ok) {
    throw new CloudError(humanMessage(data, response.status), response.status, data);
  }
  return data;
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class CloudError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'CloudError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Технічні відповіді сервера — англійською й для розробника.
 * Перекладаємо найчастіші, бо саме їх побачить людина на екрані.
 */
function humanMessage(data, status) {
  const raw = String(data?.msg ?? data?.message ?? data?.error_description ?? data?.error ?? '');

  if (/invalid login credentials/i.test(raw)) return 'Невірна пошта або пароль';
  if (/email not confirmed/i.test(raw)) return 'Спершу підтвердь пошту — лист уже надіслано';
  if (/user already registered/i.test(raw)) return 'Такий акаунт уже існує — спробуй увійти';
  if (/password should be at least/i.test(raw)) return 'Пароль закороткий: щонайменше 6 символів';
  if (/unable to validate email|invalid format/i.test(raw)) return 'Пошта виглядає некоректно';
  if (/rate limit|too many/i.test(raw)) return 'Забагато спроб. Зачекай хвилину';
  if (/duplicate key.*companies_slug/i.test(raw)) return 'Таке коротке імʼя вже зайняте';
  if (/violates row-level security/i.test(raw)) return 'Немає прав на цю дію';
  if (status === 401) return 'Потрібно ввійти заново';
  if (status === 0 || !raw) return 'Немає звʼязку з сервером';

  return raw;
}

// --- Вхід і реєстрація -----------------------------------------------------

/**
 * Реєстрація. Supabase надсилає лист підтвердження, і доки на нього не
 * натиснуть, сесії не буде — тому повертаємо ознаку needsConfirmation,
 * щоб інтерфейс сказав про це прямо, а не мовчав.
 */
export async function signUp({ email, password, fullName = '', kind = 'company' }) {
  const data = await call('/auth/v1/signup', {
    method: 'POST',
    auth: false,
    body: { email: email.trim(), password, data: { full_name: fullName.trim(), kind } },
  });

  if (data?.access_token) {
    setSession(buildSession(data));
    return { needsConfirmation: false };
  }
  return { needsConfirmation: true };
}

export async function signIn({ email, password }) {
  const data = await call('/auth/v1/token?grant_type=password', {
    method: 'POST',
    auth: false,
    body: { email: email.trim(), password },
  });
  setSession(buildSession(data));
  return currentUser();
}

export async function signOut() {
  try {
    if (session?.access_token) await call('/auth/v1/logout', { method: 'POST', body: {} });
  } catch {
    // Навіть якщо сервер не відповів — локально виходимо однаково.
  }
  setSession(null);
}

export async function resetPassword(email) {
  await call('/auth/v1/recover', { method: 'POST', auth: false, body: { email: email.trim() } });
}

function buildSession(data) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    // Зберігаємо саме момент закінчення, а не тривалість: після перезапуску
    // застосунку тривалість уже нічого не означає.
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
    user: data.user ?? null,
  };
}

/** Оновлює токен, якщо він скоро протухне. Викликається перед кожним запитом. */
async function ensureFreshToken() {
  if (!session?.refresh_token) return;

  const secondsLeft = (session.expires_at ?? 0) - Math.floor(Date.now() / 1000);
  if (secondsLeft > REFRESH_MARGIN_SECONDS) return;

  try {
    const data = await call('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      auth: false,
      body: { refresh_token: session.refresh_token },
    });
    setSession(buildSession(data));
  } catch {
    // Токен оновити не вдалося — сесія недійсна, треба входити заново.
    setSession(null);
  }
}

// --- Дані ------------------------------------------------------------------

export async function query(table, { select = '*', filter = '', order = '', limit } = {}) {
  await ensureFreshToken();
  const parts = [`select=${encodeURIComponent(select)}`];
  if (filter) parts.push(filter);
  if (order) parts.push(`order=${encodeURIComponent(order)}`);
  if (limit) parts.push(`limit=${limit}`);
  return call(`/rest/v1/${table}?${parts.join('&')}`);
}

export async function insert(table, row) {
  await ensureFreshToken();
  const rows = await call(`/rest/v1/${table}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function patch(table, filter, changes) {
  await ensureFreshToken();
  const rows = await call(`/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: changes,
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function remove(table, filter) {
  await ensureFreshToken();
  await call(`/rest/v1/${table}?${filter}`, { method: 'DELETE' });
}

/** Виклик функції в базі — саме так робляться дії, які не можна віддати клієнту. */
export async function rpc(name, args = {}) {
  await ensureFreshToken();
  return call(`/rest/v1/rpc/${name}`, { method: 'POST', body: args });
}

/** Чи відповідає сервер. Використовується перед входом, щоб не гадати. */
export async function ping() {
  try {
    await call('/auth/v1/settings', { auth: false });
    return true;
  } catch {
    return false;
  }
}
