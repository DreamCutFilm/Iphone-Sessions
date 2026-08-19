// Спільні проєкти: як проєкт із телефона потрапляє у фірму і що бачить команда.
//
// Розподіл обовʼязків тут навмисно жорсткий:
//   • цей модуль ЗБИРАЄ те, що можна віддати назовні;
//   • база ВИРІШУЄ, кому з цього що показати.
//
// Тобто застосунок не «ховає» суму клієнта від команди — він її надсилає,
// а база не кладе її у відповідь тому, кому не можна. Якби рішення ухвалював
// застосунок, будь-яка помилка в ньому відкривала б чужі гроші; тепер
// найгірше, що може статися від помилки тут, — щось не покажеться.

import { rpc } from './cloud.js';
import { projectById, projectFinance, projectPayouts } from './selectors.js';

/**
 * Що саме летить у фірму.
 *
 * Чиста функція: приймає стан і повертає готовий пакунок. Мережі не торкається,
 * тож її видно в тестах повністю — а це рівно те місце, де помилка коштувала б
 * найдорожче.
 */
export function buildProjectPayload(state, projectId) {
  const project = projectById(state, projectId);
  if (!project) return null;

  const finance = projectFinance(state, projectId);
  const payouts = projectPayouts(state, projectId);

  return {
    project: {
      local_id: project.id,
      title: project.title,
      client: project.client,
      style: project.style,
      status: project.status,
      deadline: project.deadline,
      location: project.location,
      latitude: project.latitude,
      longitude: project.longitude,
      currency: finance.currency,
      // Скільки платить клієнт. Летить у базу, але звідти повертається
      // тільки директору й адміністраторам.
      fee: finance.income || null,
      rental_cost: finance.rental,
      other_cost: finance.other,
      payout_total: finance.payouts,
      shoot_days: project.shootDays,
      // Внутрішні нотатки проєкту назовні не йдуть узагалі: вони писалися
      // для себе, і команда в них не мала б опинитися несподівано.
      notes: null,
    },
    payouts: payouts.people.map((person) => {
      const member = person.crewId
        ? state.crew.find((entry) => entry.id === person.crewId)
        : null;

      return {
        user_id: member?.userId || null,
        email: member?.email || null,
        name: member?.name || person.title,
        role_title: member?.role || null,
        amount: person.payout,
        currency: person.currency,
      };
    }),
  };
}

/**
 * Кого з гонорарів не звʼяжуть з акаунтом.
 *
 * Людина без пошти в каталозі свій гонорар не побачить — і не дізнається чому.
 * Тому список таких людей показуємо ДО публікації, а не після.
 */
export function unlinkedPayouts(payload) {
  return (payload?.payouts ?? [])
    .filter((entry) => !entry.user_id && !entry.email)
    .map((entry) => entry.name);
}

export async function publishProject(companyId, state, projectId) {
  const payload = buildProjectPayload(state, projectId);
  if (!payload) throw new Error('Проєкт не знайдено');

  return rpc('publish_project', {
    p_company: companyId,
    p_project: payload.project,
    p_payouts: payload.payouts,
  });
}

export async function unpublishProject(companyId, localId) {
  return rpc('unpublish_project', { p_company: companyId, p_local_id: localId });
}

/** Проєкти фірми — уже підрізані базою під того, хто питає. */
export async function companyProjects(companyId) {
  const rows = await rpc('company_projects', { p_company: companyId });
  return (rows ?? []).map(fromRow);
}

export async function projectPayoutRows(projectId) {
  const rows = await rpc('project_payouts', { p_project: projectId });
  return (rows ?? []).map((row) => ({
    name: row.name || 'Без імені',
    role: row.role_title || '',
    amount: Number(row.amount) || 0,
    currency: row.currency,
    isMine: Boolean(row.is_mine),
  }));
}

/**
 * Рядок із бази — у звичний вигляд.
 *
 * Порожнє поле тут означає «тобі не показують», а не «нуль». Різницю треба
 * зберегти саме тут: нуль на екрані виглядав би як безкоштовна зйомка.
 */
function fromRow(row) {
  return {
    id: row.id,
    localId: row.local_id,
    title: row.title,
    client: row.client ?? '',
    style: row.style ?? '',
    status: row.status,
    deadline: row.deadline,
    location: row.location ?? '',
    latitude: row.latitude,
    longitude: row.longitude,
    currency: row.currency,
    fee: money(row.fee),
    rental: money(row.rental_cost) ?? 0,
    other: money(row.other_cost) ?? 0,
    payoutTotal: money(row.payout_total),
    myPayout: money(row.my_payout) ?? 0,
    shootDays: Array.isArray(row.shoot_days) ? row.shoot_days : [],
    updatedAt: row.updated_at,
    canManage: Boolean(row.can_manage),
  };
}

/** Заробіток проєкту — рахується лише тоді, коли всі числа справді видно. */
export function sharedProfit(project) {
  if (project.fee === null || project.payoutTotal === null) return null;
  return round(project.fee - project.rental - project.other - project.payoutTotal);
}

function money(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
