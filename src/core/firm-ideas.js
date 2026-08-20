// Ідеї, якими поділилися з фірмою.
//
// Ідея на телефоні лишається особистою — це блокнот, і більшість записів
// у ньому нікого, крім автора, не стосується. У фірму йде тільки те, що
// людина сама туди відправила, окремою дією.
//
// Публікуємо не копію, а той самий запис: local_id їде разом з ідеєю, тож
// повторне «поділитися» після правки оновлює те, що команда вже бачить,
// а не додає поруч другий, майже такий самий текст.

import { rpc } from './cloud.js';
import { withMemory, forget } from './cache.js';

/** Стрічка ідей фірми. Повертає { value, at, fresh }, як і решта читань. */
export function firmIdeas(companyId) {
  return withMemory(`ideas.${companyId}`, async () => {
    const rows = await rpc('company_idea_feed', { p_company: companyId });
    return (rows ?? []).map((row) => ({
      id: row.id,
      localId: row.local_id ?? null,
      title: row.title,
      body: row.body ?? '',
      tags: Array.isArray(row.tags) ? row.tags : [],
      projectId: row.project_id ?? null,
      projectTitle: row.project_title ?? '',
      author: row.author_name ?? '',
      isMine: Boolean(row.is_mine),
      createdAt: row.created_at,
    }));
  });
}

/**
 * Які з моїх ідей уже у фірмі.
 *
 * Без цього списку кнопка «Поділитися» виглядала б однаково і до, і після, —
 * і людина натискала б її вдруге, не розуміючи, спрацювало чи ні.
 */
export function publishedIdeas(companyId) {
  return withMemory(`myideas.${companyId}`, async () => {
    const rows = await rpc('my_published_ideas', { p_company: companyId });
    return (rows ?? []).map((row) => row.local_id).filter(Boolean);
  });
}

export async function publishIdea(companyId, idea) {
  const id = await rpc('publish_idea', {
    p_company: companyId,
    p_idea: {
      local_id: idea.id,
      title: idea.title,
      body: idea.body || null,
      tags: idea.tags ?? [],
      // Особистий проєкт і фірмовий — різні записи. Звʼязати їх може лише
      // база: вона знає, який фірмовий проєкт приїхав із цього телефона.
      project_local_id: idea.projectId || null,
    },
  });

  forgetIdeas(companyId);
  return id;
}

export async function unpublishIdea(companyId, localId) {
  await rpc('unpublish_idea', { p_company: companyId, p_local_id: localId });
  forgetIdeas(companyId);
}

export function forgetIdeas(companyId) {
  forget(`ideas.${companyId}`);
  forget(`myideas.${companyId}`);
}
