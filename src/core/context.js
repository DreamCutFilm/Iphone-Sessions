// Чиїми очима застосунок зараз дивиться.
//
// Два стани: «Моє» — усе особисте, на цьому телефоні, як було завжди; або
// конкретна фірма — тоді ті самі екрани показують її справи.
//
// Це не декорація, а стрижень: інакше довелося б або зліпити своє й фірмове
// в один список (і людина перестала б розуміти, де чиє), або розвести їх по
// різних екранах (і половина застосунку дублювалася б). Один перемикач
// відповідає на це питання раз — і всі екрани просто його читають.

import { readJson, writeJson } from './storage.js';

const CONTEXT_KEY = 'dreamcut.context.v1';
const COMPANIES_KEY = 'dreamcut.companies.v1';

export const MINE = { kind: 'mine', id: null, name: 'Моє' };

const listeners = new Set();

/** Фірми, у яких я є. Тримаємо на пристрої: перемикач має малюватися одразу,
 *  ще до того, як мережа відповість, — інакше він блимав би при кожному вході. */
export function knownCompanies() {
  const stored = readJson(COMPANIES_KEY, []);
  return Array.isArray(stored) ? stored : [];
}

export function rememberCompanies(companies) {
  const list = (companies ?? []).map((company) => ({
    id: company.id,
    name: company.name,
    slug: company.slug ?? '',
    role: company.role,
    city: company.city ?? '',
    about: company.about ?? '',
    listed: Boolean(company.listed),
    roleId: company.roleId ?? null,
    roleName: company.roleName ?? '',
    roleGrants: company.roleGrants ?? null,
  }));

  writeJson(COMPANIES_KEY, list);

  // Фірми не стало — з неї треба вийти, інакше застосунок показував би
  // дані, до яких доступу вже немає, і мовчки впирався б у помилки.
  const current = getContext();
  if (current.kind === 'company' && !list.some((company) => company.id === current.id)) {
    setContext(MINE);
  } else {
    // Роль могли змінити, поки нас не було, — а від неї залежить, що видно.
    const fresh = list.find((company) => company.id === current.id);
    if (fresh && fresh.role !== current.role) setContext(fresh);
  }

  return list;
}

export function getContext() {
  const stored = readJson(CONTEXT_KEY, null);
  if (!stored || stored.kind !== 'company' || !stored.id) return MINE;

  // Звіряємося зі списком: назва й роль могли змінитися.
  const known = knownCompanies().find((company) => company.id === stored.id);
  if (!known) return { kind: 'company', id: stored.id, name: stored.name ?? 'Фірма', role: stored.role ?? 'member' };

  return { kind: 'company', id: known.id, name: known.name, role: known.role };
}

export function setContext(next) {
  const value = next && next.kind === 'company' && next.id
    ? { kind: 'company', id: next.id, name: next.name, role: next.role }
    : MINE;

  writeJson(CONTEXT_KEY, value);

  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      console.error('Помилка в підписнику контексту:', error);
    }
  }

  return value;
}

export function onContextChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function inCompany() {
  return getContext().kind === 'company';
}

/** Поточна фірма з усіма подробицями зі списку, або null. */
export function currentCompany() {
  const context = getContext();
  if (context.kind !== 'company') return null;
  return knownCompanies().find((company) => company.id === context.id)
    ?? { id: context.id, name: context.name, role: context.role, slug: '', city: '', about: '' };
}
