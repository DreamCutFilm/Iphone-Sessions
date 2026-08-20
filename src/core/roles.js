// Ролі фірми й те, що вони відкривають.
//
// Дозволів шість, і це не випадкове число. Спокуса зробити галочку на кожне
// поле велика, але сорок галочок неможливо втримати в голові: за півроку
// ніхто не памʼятає, яка комбінація що відкриває, і одного дня хтось випадково
// показує гонорари всій команді. Шість дозволів читаються очима за десять
// секунд, і небезпечної комбінації з них не збереш.
//
// Список тут — лише для екрана. Вирішує завжди база: навіть якщо застосунок
// намалює галочку не там, чужих грошей вона не відкриє.

import { query, insert, patch, remove } from './cloud.js';

export const PERMISSIONS = [
  {
    id: 'can_see_client_money',
    label: 'Суми клієнта й заробіток',
    hint: 'Скільки платить замовник і що лишається фірмі.',
    danger: true,
  },
  {
    id: 'can_see_all_payouts',
    label: 'Гонорари всієї команди',
    hint: 'Хто скільки отримує. Свій власний гонорар людина бачить завжди.',
    danger: true,
  },
  {
    id: 'can_see_client_contacts',
    label: 'Хто замовник',
    hint: 'Назва клієнта в картці проєкту.',
  },
  {
    id: 'can_see_rental',
    label: 'Оренда техніки',
    hint: 'У скільки обходиться техніка. Що саме везти — видно всім і без цього.',
  },
  {
    id: 'can_edit',
    label: 'Правити проєкти',
    hint: 'Створювати й змінювати проєкти та кошториси, публікувати їх у фірму.',
  },
  {
    id: 'can_manage_team',
    label: 'Керувати командою',
    hint: 'Запрошувати людей, приймати заявки, роздавати ролі.',
    danger: true,
  },
];

const FIELDS = PERMISSIONS.map((permission) => permission.id);

export function emptyRole(name = '') {
  const role = { name, position: 0 };
  for (const field of FIELDS) role[field] = false;
  // Без цього людина не знає, що везти на майданчик, — тому увімкнено одразу.
  role.can_see_rental = true;
  return role;
}

/** Коротко, що роль відкриває: для рядка у списку. */
export function describeRole(role) {
  const granted = PERMISSIONS.filter((permission) => role[permission.id]);
  if (!granted.length) return 'Бачить тільки свої задачі та гонорар';
  return granted.map((permission) => permission.label.toLowerCase()).join(', ');
}

/** Чи роль відкриває щось із того, що варто помітити перед збереженням. */
export function sensitiveGrants(role) {
  return PERMISSIONS.filter((permission) => permission.danger && role[permission.id]);
}

// --- Робота з базою --------------------------------------------------------

export async function rolesOf(companyId) {
  const rows = await query('company_roles', {
    select: `id,name,position,${FIELDS.join(',')}`,
    filter: `company_id=eq.${companyId}`,
    order: 'position.asc',
  });
  return rows ?? [];
}

export async function createRole(companyId, role) {
  return insert('company_roles', { company_id: companyId, ...pick(role) });
}

export async function updateRole(roleId, role) {
  return patch('company_roles', `id=eq.${roleId}`, pick(role));
}

export async function removeRole(roleId) {
  return remove('company_roles', `id=eq.${roleId}`);
}

/** Призначити роль людині. Порожньо — зняти роль. */
export async function assignRole(membershipId, roleId) {
  return patch('memberships', `id=eq.${membershipId}`, { role_id: roleId || null });
}

function pick(role) {
  const out = { name: String(role.name ?? '').trim(), position: Number(role.position) || 0 };
  for (const field of FIELDS) out[field] = Boolean(role[field]);
  return out;
}

/**
 * Що дозволено мені в цій фірмі — за рівнем і роллю.
 *
 * Порахувати це на пристрої безпечно рівно тому, що воно ні на що не впливає:
 * цифри однаково приходять із сервера вже підрізаними. Тут це потрібно лише
 * для того, щоб не малювати кнопок, які все одно відмовлять.
 */
export function permissionsOf(company) {
  const all = Object.fromEntries(FIELDS.map((field) => [field, true]));

  if (!company) return Object.fromEntries(FIELDS.map((field) => [field, false]));
  if (company.role === 'owner') return all;
  if (company.role === 'admin') return { ...all, can_manage_team: false };

  const role = company.roleGrants ?? null;
  if (!role) {
    return {
      ...Object.fromEntries(FIELDS.map((field) => [field, false])),
      can_see_rental: true,
    };
  }

  return Object.fromEntries(FIELDS.map((field) => [field, Boolean(role[field])]));
}
