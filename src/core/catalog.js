// Каталоги фірми: техніка й люди.
//
// Ті самі поняття, що й у власних каталогах на телефоні, — але один список
// на всю фірму. Двоє адміністраторів більше не ведуть два різні переліки
// тієї самої техніки, а людина з команди нарешті бачить бодай той, за яким
// їй їхати на майданчик.
//
// Числа приходять уже підрізаними: ціну клієнту, собівартість і чужі гонорари
// сервер кладе у відповідь лише тому, кому це дозволено роллю. Тут їх не
// ховають — тут їх просто може не бути, і екран мусить це розрізняти.

import { rpc, insert, patch, remove } from './cloud.js';
import { withMemory, forget } from './cache.js';

export function firmEquipment(companyId) {
  return withMemory(`gear.${companyId}`, async () => {
    const rows = await rpc('company_gear', { p_company: companyId });
    return (rows ?? []).map((row) => ({
      id: row.id,
      localId: row.local_id ?? '',
      title: row.title,
      category: row.category ?? 'other',
      ownership: row.ownership ?? 'own',
      dayRate: money(row.day_rate),
      dayCost: money(row.day_cost),
      notes: row.notes ?? '',
      archived: Boolean(row.archived),
      canEdit: Boolean(row.can_edit),
    }));
  });
}

export function firmCrew(companyId) {
  return withMemory(`people.${companyId}`, async () => {
    const rows = await rpc('company_people', { p_company: companyId });
    return (rows ?? []).map((row) => ({
      id: row.id,
      localId: row.local_id ?? '',
      name: row.name ?? '',
      role: row.role ?? '',
      fee: money(row.fee),
      rate: money(row.rate),
      phone: row.phone ?? '',
      email: row.email ?? '',
      userId: row.user_id ?? null,
      notes: row.notes ?? '',
      archived: Boolean(row.archived),
      isMe: Boolean(row.is_me),
      canEdit: Boolean(row.can_edit),
    }));
  });
}

/** Після будь-якої зміни памʼять застаріла — інакше екран покаже вчорашнє. */
export function forgetCatalog(companyId) {
  forget(`gear.${companyId}`);
  forget(`people.${companyId}`);
}

// --- Зміни -----------------------------------------------------------------

export async function saveFirmEquipment(companyId, item) {
  const row = {
    title: item.title?.trim() || 'Без назви',
    category: item.category ?? 'other',
    ownership: item.ownership ?? 'own',
    day_rate: item.dayRate ?? null,
    day_cost: item.dayCost ?? null,
    notes: item.notes?.trim() || null,
    archived: Boolean(item.archived),
    updated_at: new Date().toISOString(),
  };

  const saved = item.id
    ? await patch('company_equipment', `id=eq.${item.id}`, row)
    : await insert('company_equipment', { company_id: companyId, ...row });

  forgetCatalog(companyId);
  return saved;
}

export async function removeFirmEquipment(companyId, id) {
  await remove('company_equipment', `id=eq.${id}`);
  forgetCatalog(companyId);
}

export async function saveFirmCrew(companyId, member) {
  const row = {
    name: member.name?.trim() || null,
    role: member.role?.trim() || 'Оператор',
    fee: member.fee ?? null,
    rate: member.rate ?? null,
    phone: member.phone?.trim() || null,
    email: member.email?.trim().toLowerCase() || null,
    user_id: member.userId || null,
    notes: member.notes?.trim() || null,
    archived: Boolean(member.archived),
    updated_at: new Date().toISOString(),
  };

  const saved = member.id
    ? await patch('company_crew', `id=eq.${member.id}`, row)
    : await insert('company_crew', { company_id: companyId, ...row });

  forgetCatalog(companyId);
  return saved;
}

export async function removeFirmCrew(companyId, id) {
  await remove('company_crew', `id=eq.${id}`);
  forgetCatalog(companyId);
}

// --- Перенесення свого каталогу --------------------------------------------

/**
 * Що саме поїде у фірму.
 *
 * Чиста функція: приймає стан і повертає пакунок. Кожна позиція везе свій
 * місцевий номер — за ним база впізнає, що це та сама річ, і повторне
 * перенесення оновлює її, а не створює другий комплект.
 */
export function buildCatalogPayload(state) {
  return {
    equipment: (state.equipment ?? []).map((item) => ({
      local_id: item.id,
      title: item.title,
      category: item.category,
      ownership: item.ownership,
      day_rate: item.dayRate,
      day_cost: item.dayCost,
      notes: item.notes || null,
      archived: Boolean(item.archived),
    })),
    crew: (state.crew ?? []).map((member) => ({
      local_id: member.id,
      name: member.name || null,
      role: member.role,
      fee: member.fee,
      rate: member.rate,
      phone: member.phone || null,
      email: member.email || null,
      user_id: member.userId || null,
      notes: member.notes || null,
      archived: Boolean(member.archived),
    })),
  };
}

export async function importCatalog(companyId, state) {
  const payload = buildCatalogPayload(state);

  const moved = await rpc('import_catalog', {
    p_company: companyId,
    p_equipment: payload.equipment,
    p_crew: payload.crew,
  });

  forgetCatalog(companyId);
  return Number(moved) || 0;
}

function money(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
