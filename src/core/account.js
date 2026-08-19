// Фірми, команда, заявки та запрошення.
//
// Шар між застосунком і базою: тут живуть правила, зрозумілі людині
// («директор може виганяти»), а не назви таблиць.

import { rpc, query, insert, patch, remove, currentUser } from './cloud.js';
import { readJson, writeJson, removeKey } from './storage.js';

// Яку фірму застосунок вважає поточною.
//
// Зберігається на пристрої, а не питається щоразу в мережі: екран проєктів
// має відкриватися миттєво й показувати бодай назву фірми, навіть коли звʼязку
// немає. Людина майже завжди в одній фірмі — і зайве питання «в якій саме»
// їй нічого не дає.
const ACTIVE_KEY = 'dreamcut.company.v1';

export function activeCompany() {
  return readJson(ACTIVE_KEY, null);
}

export function setActiveCompany(company) {
  if (company) writeJson(ACTIVE_KEY, { id: company.id, name: company.name, role: company.role });
  else removeKey(ACTIVE_KEY);
}

export const ROLES = [
  { id: 'owner', label: 'Директор', hint: 'Бачить заробіток, керує людьми' },
  { id: 'admin', label: 'Адміністратор', hint: 'Бачить заробіток, не змінює ролі' },
  { id: 'member', label: 'Команда', hint: 'Бачить оренду й свій гонорар' },
];

export function roleLabel(id) {
  return ROLES.find((role) => role.id === id)?.label ?? id;
}

export function canManage(role) {
  return role === 'owner' || role === 'admin';
}

/**
 * Коротке імʼя фірми для посилань: «DreamCut Film» → «dreamcut-film».
 * Кирилиця транслітерується, бо в адресі вона перетворюється на нечитабельний
 * набір відсотків, а це імʼя людям доведеться диктувати вголос.
 */
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z',
  и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ъ: '',
};

export function makeSlug(name) {
  const lower = String(name ?? '').toLowerCase().trim();
  let out = '';
  for (const char of lower) {
    if (TRANSLIT[char] !== undefined) out += TRANSLIT[char];
    else if (/[a-z0-9]/.test(char)) out += char;
    else out += '-';
  }
  return out
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function isValidSlug(slug) {
  return /^[a-z0-9-]{2,40}$/.test(slug);
}

// --- Фірми -----------------------------------------------------------------

/** Фірми, у яких я є, разом із моєю роллю. */
export async function myCompanies() {
  const rows = await query('memberships', {
    select: 'role,title,created_at,companies(id,name,slug,city,about,listed)',
    filter: `user_id=eq.${currentUser()?.id}`,
  });

  return (rows ?? [])
    .filter((row) => row.companies)
    .map((row) => ({ ...row.companies, role: row.role, title: row.title }));
}

export async function createCompany({ name, slug, city, about, listed = true }) {
  return rpc('create_company', {
    p_name: name,
    p_slug: slug,
    p_city: city || null,
    p_about: about || null,
    p_listed: listed,
  });
}

export async function updateCompany(companyId, changes) {
  return patch('companies', `id=eq.${companyId}`, changes);
}

export async function searchCompanies(text) {
  return rpc('search_companies', { p_query: text });
}

// --- Команда ---------------------------------------------------------------

export async function teamOf(companyId) {
  const rows = await query('memberships', {
    select: 'id,user_id,role,title,created_at,profiles(full_name,phone)',
    filter: `company_id=eq.${companyId}`,
    order: 'created_at.asc',
  });

  return (rows ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    role: row.role,
    title: row.title ?? '',
    name: row.profiles?.full_name || '',
    phone: row.profiles?.phone || '',
    isMe: row.user_id === currentUser()?.id,
  }));
}

export async function changeRole(membershipId, role) {
  return patch('memberships', `id=eq.${membershipId}`, { role });
}

export async function removeMember(membershipId) {
  return remove('memberships', `id=eq.${membershipId}`);
}

// --- Заявки на приєднання --------------------------------------------------

export async function requestJoin(companyId, message = '') {
  return insert('join_requests', {
    company_id: companyId,
    user_id: currentUser()?.id,
    message: message.trim() || null,
  });
}

export async function pendingRequests(companyId) {
  const rows = await query('join_requests', {
    select: 'id,user_id,message,status,created_at,profiles(full_name,phone)',
    filter: `company_id=eq.${companyId}&status=eq.pending`,
    order: 'created_at.asc',
  });

  return (rows ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    message: row.message ?? '',
    name: row.profiles?.full_name || 'Без імені',
    phone: row.profiles?.phone || '',
    createdAt: row.created_at,
  }));
}

/** Мої власні заявки — щоб бачити, що чекаєш на схвалення. */
export async function myRequests() {
  return query('join_requests', {
    select: 'id,status,created_at,companies(name,slug)',
    filter: `user_id=eq.${currentUser()?.id}`,
    order: 'created_at.desc',
  });
}

export async function approveRequest(requestId, role = 'member') {
  return rpc('approve_join_request', { p_request_id: requestId, p_role: role });
}

export async function declineRequest(requestId) {
  return patch('join_requests', `id=eq.${requestId}`, {
    status: 'declined',
    decided_at: new Date().toISOString(),
  });
}

// --- Запрошення ------------------------------------------------------------

// Без літер, які плутають у розмові й на екрані: O та 0, I та 1.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = '';
  for (const [index, byte] of bytes.entries()) {
    if (index === 4) code += '-';
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

export async function createInvite(companyId, role = 'member') {
  return insert('invites', {
    company_id: companyId,
    code: generateCode(),
    role,
    created_by: currentUser()?.id,
  });
}

export async function activeInvites(companyId) {
  return query('invites', {
    select: 'id,code,role,expires_at,used_at,created_at',
    filter: `company_id=eq.${companyId}&used_at=is.null`,
    order: 'created_at.desc',
  });
}

export async function revokeInvite(inviteId) {
  return remove('invites', `id=eq.${inviteId}`);
}

export async function redeemInvite(code) {
  return rpc('redeem_invite', { p_code: code });
}

// --- Профіль ---------------------------------------------------------------

export async function myProfile() {
  const rows = await query('profiles', {
    select: 'id,full_name,phone,kind',
    filter: `id=eq.${currentUser()?.id}`,
  });
  return rows?.[0] ?? null;
}

export async function updateProfile(changes) {
  return patch('profiles', `id=eq.${currentUser()?.id}`, {
    ...changes,
    updated_at: new Date().toISOString(),
  });
}
