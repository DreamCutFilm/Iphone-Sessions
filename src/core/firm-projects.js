// Проєкти, задачі й кошториси, які народжуються у фірмі.
//
// Досі проєкт потрапляв туди знімком: директор складав його на телефоні
// й публікував. Двоє адміністраторів працювати з одним проєктом не могли —
// кожен публікував свій знімок поверх чужого.
//
// Тепер проєкт живе у фірмі від початку. Знімок лишився одним-єдиним
// шляхом: перенести старий особистий проєкт. Тому «Опублікувати» більше
// не означає «оновити» — воно означає «переселити».

import { insert, patch, remove } from './cloud.js';
import { forget } from './cache.js';

/** Памʼять про фірму застаріла: після будь-якої зміни її треба забути. */
function refresh(companyId, projectId = null) {
  forget(`projects.${companyId}`);
  forget(`tasks.${companyId}`);
  if (projectId) {
    forget(`ptasks.${projectId}`);
    forget(`pitems.${projectId}`);
    forget(`payouts.${projectId}`);
    forget(`estimates.${projectId}`);
  }
}

// --- Проєкт ----------------------------------------------------------------

export async function saveFirmProject(companyId, project) {
  const row = {
    title: project.title?.trim() || 'Без назви',
    client: project.client?.trim() || null,
    style: project.style?.trim() || null,
    status: project.status || 'lead',
    deadline: project.deadline || null,
    location: project.location?.trim() || null,
    latitude: project.latitude ?? null,
    longitude: project.longitude ?? null,
    currency: project.currency || 'UAH',
    notes: project.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const saved = project.id
    ? await patch('shared_projects', `id=eq.${project.id}`, row)
    : await insert('shared_projects', { company_id: companyId, ...row });

  refresh(companyId, saved?.id ?? project.id);
  return saved;
}

export async function removeFirmProject(companyId, projectId) {
  await remove('shared_projects', `id=eq.${projectId}`);
  refresh(companyId, projectId);
}

/**
 * Знімальні дні.
 *
 * Переписуємо цілком, а не по одному: частковий список лишив би дні від
 * попереднього варіанта графіка, і люди приїхали б не того числа.
 */
export async function setShootDays(companyId, projectId, days) {
  await remove('shared_shoot_days', `project_id=eq.${projectId}`);

  const unique = [...new Set((days ?? []).filter(Boolean))].sort();
  if (unique.length) {
    await insert('shared_shoot_days', unique.map((day) => ({ project_id: projectId, day })));
  }

  refresh(companyId, projectId);
  return unique;
}

// --- Задачі ----------------------------------------------------------------

export async function saveFirmTask(companyId, projectId, task) {
  const row = {
    title: task.title?.trim() || 'Без назви',
    assignee_id: task.assigneeId || null,
    assignee_name: task.assigneeName?.trim() || null,
    due: task.due || null,
    done: Boolean(task.done),
    priority: task.priority || 'normal',
    notes: task.notes?.trim() || null,
    position: Number(task.position) || 0,
  };

  const saved = task.id
    ? await patch('shared_tasks', `id=eq.${task.id}`, row)
    : await insert('shared_tasks', { project_id: projectId, company_id: companyId, ...row });

  refresh(companyId, projectId);
  return saved;
}

export async function toggleFirmTask(companyId, projectId, taskId, done) {
  const saved = await patch('shared_tasks', `id=eq.${taskId}`, { done: Boolean(done) });
  refresh(companyId, projectId);
  return saved;
}

export async function removeFirmTask(companyId, projectId, taskId) {
  await remove('shared_tasks', `id=eq.${taskId}`);
  refresh(companyId, projectId);
}

// --- Кошториси -------------------------------------------------------------

export async function saveFirmEstimate(companyId, estimate) {
  const row = {
    project_id: estimate.projectId || null,
    title: estimate.title?.trim() || 'Кошторис',
    status: estimate.status || 'draft',
    currency: estimate.currency || 'UAH',
    discount_percent: estimate.discountPercent ?? 0,
    tax_percent: estimate.taxPercent ?? 0,
    client_notes: estimate.clientNotes?.trim() || null,
    notes: estimate.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const saved = estimate.id
    ? await patch('company_estimates', `id=eq.${estimate.id}`, row)
    : await insert('company_estimates', { company_id: companyId, ...row });

  refresh(companyId, estimate.projectId);
  return saved;
}

export async function removeFirmEstimate(companyId, estimate) {
  await remove('company_estimates', `id=eq.${estimate.id}`);
  refresh(companyId, estimate.projectId);
}

export async function addEstimateItem(companyId, estimate, item) {
  const saved = await insert('company_estimate_items', {
    estimate_id: estimate.id,
    company_id: companyId,
    ...itemRow(item),
  });

  refresh(companyId, estimate.projectId);
  return saved;
}

export async function updateEstimateItem(companyId, estimate, item) {
  const saved = await patch('company_estimate_items', `id=eq.${item.id}`, itemRow(item));
  refresh(companyId, estimate.projectId);
  return saved;
}

export async function removeEstimateItem(companyId, estimate, itemId) {
  await remove('company_estimate_items', `id=eq.${itemId}`);
  refresh(companyId, estimate.projectId);
}

function itemRow(item) {
  return {
    title: item.title?.trim() || 'Позиція',
    category: item.category || 'equipment',
    equipment_id: item.equipmentId || null,
    crew_id: item.crewId || null,
    internal_only: Boolean(item.internalOnly),
    unit: item.unit || 'зміна',
    quantity: numberOr(item.quantity, 1),
    shifts: numberOr(item.shifts, 1),
    unit_price: numberOr(item.unitPrice, 0),
    unit_cost: numberOr(item.unitCost, 0),
    notes: item.notes?.trim() || null,
    position: Number(item.position) || 0,
  };
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// --- Позиція з каталогу фірми ----------------------------------------------

/** Рядок кошторису з техніки фірми — з підставленими цінами. */
export function itemFromFirmGear(gear, { quantity = 1, shifts = 1 } = {}) {
  return {
    title: gear.title,
    category: 'equipment',
    equipmentId: gear.id,
    unit: 'зміна',
    quantity,
    shifts,
    unitPrice: gear.dayRate ?? 0,
    unitCost: gear.dayCost ?? 0,
  };
}

/**
 * Рядок кошторису з людини фірми.
 *
 * Ставка клієнту, якщо вона задана окремо; інакше — рівно гонорар, без
 * націнки. Так само, як у власному каталозі: людина не має щоразу
 * згадувати, скільки вона вирішила накинути.
 */
export function itemFromFirmPerson(person, { shifts = 1, quantity = 1 } = {}) {
  const fee = person.fee ?? 0;

  return {
    title: person.name ? `${person.name} — ${person.role}` : person.role,
    category: 'crew',
    crewId: person.id,
    unit: 'зміна',
    quantity,
    shifts,
    unitPrice: person.rate ?? fee,
    unitCost: fee,
  };
}
