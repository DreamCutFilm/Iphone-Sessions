// Про програму: версія, оновлення, резервні копії.
//
// Це не налаштування. Налаштування — те, що людина міняє під себе: мова,
// валюта, звідки рахувати сонце. А тут — обслуговування самого застосунку:
// перевірити оновлення, зберегти копію, врятувати дані. Речі різні за
// природою, і поки вони лежали на одному екрані, копію доводилось шукати
// між вибором сенсора й дозволом на сповіщення.

import { el, toast } from '../dom.js';
import { t } from '../../core/i18n.js';
import { pageHeader, sectionTitle } from '../components.js';
import { confirmSheet } from '../sheet.js';
import { getState, replaceState, damagedData, forgetDamagedData } from '../../core/store.js';
import { buildBackup, backupFileName, restoreBackup, mergeBackup } from '../../core/backup.js';
import { storageName } from '../../core/storage.js';
import { APP_VERSION } from '../../app-meta.js';

export function aboutView() {
  const state = getState();
  const page = el('div.page');

  page.append(pageHeader('Про програму', { back: '/overview' }));

  page.append(el(
    'div.about',
    el('p.about-name', 'DreamCut App'),
    el('p.about-line', t('Версія {version}', { version: APP_VERSION })),
    el('p.about-line', t('Сховище: {name}', { name: storageName() })),
    el('p.about-line', 'Працює офлайн. Розрахунки виконуються на пристрої.'),
  ));

  page.append(sectionTitle('Оновлення'));
  page.append(el('div.form', updateButton()));

  const damaged = damagedData();
  if (damaged) {
    page.append(sectionTitle('Увага'));
    page.append(damagedBlock(damaged));
  }

  page.append(sectionTitle('Резервні копії'));
  page.append(el(
    'div.form',
    el('p.settings-note',
      t('Зараз збережено: {projects} проєктів, {tasks} задач, {ideas} ідей. ', {
        projects: state.projects.length,
        tasks: state.tasks.length,
        ideas: state.ideas.length,
      })
      + 'Усе лежить локально на цьому пристрої й нікуди не надсилається.'),
    el('button.btn.btn--primary.btn--wide', { type: 'button', onclick: exportBackup }, '⇩ Зберегти резервну копію'),
    el('button.btn.btn--ghost.btn--wide', { type: 'button', onclick: () => importBackup({ merge: true }) }, '⇧ Долити з копії'),
    el('button.btn.btn--ghost.btn--wide', { type: 'button', onclick: () => importBackup({ merge: false }) }, '⇧ Замінити все з копії'),
    el('button.btn.btn--danger.btn--wide', {
      type: 'button',
      onclick: () => confirmSheet({
        title: 'Стерти всі дані?',
        message: 'Проєкти, задачі та ідеї зникнуть безповоротно. Спершу збережи резервну копію.',
        confirmLabel: 'Стерти',
        onConfirm: () => {
          replaceState({ projects: [], tasks: [], ideas: [], settings: getState().settings });
          toast('Дані стерто');
        },
      }),
    }, 'Стерти всі дані'),
  ));

  return page;
}

/**
 * Ручна перевірка оновлення.
 *
 * Застосунок показує вміст із кешу, тож нова версія сама собою зʼявляється
 * лише з наступного запуску. Ця кнопка робить те саме одразу й на очах:
 * питає сервер, забирає нову версію й перезавантажується.
 */
function updateButton() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) {
    return el('p.settings-note', 'Оновлення керується сервером застосунку. Тут воно недоступне.');
  }

  return el('button.btn.btn--ghost.btn--wide', {
    type: 'button',
    onclick: async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = t('Перевіряю…');

      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) throw new Error('немає реєстрації');

        await registration.update();

        // Нова версія стає активною одразу — і сторінку треба перечитати,
        // інакше на екрані лишиться стара.
        if (registration.waiting || registration.installing) {
          toast('Нова версія знайдена — перезапускаю');
          setTimeout(() => window.location.reload(), 900);
          return;
        }

        toast(t('У тебе найновіша версія — {version}', { version: APP_VERSION }));
      } catch {
        toast('Не вдалося перевірити. Потрібен інтернет.', { error: true });
      } finally {
        button.disabled = false;
        button.textContent = t('⟳ Перевірити оновлення');
      }
    },
  }, '⟳ Перевірити оновлення');
}

/**
 * Попередження про пошкоджену базу.
 *
 * Застосунок стартував порожнім не тому, що даних не було, а тому, що їх не
 * вдалося прочитати. Копію відкладено вбік — звідси її можна витягнути файлом
 * і врятувати записи вручну.
 */
function damagedBlock(raw) {
  return el(
    'div.form',
    el('p.settings-note',
      '⚠ Попередню базу не вдалося прочитати, тому застосунок відкрився порожнім. '
      + 'Пошкоджені дані збережено окремо — завантаж їх файлом, звідти можна витягнути записи. '
      + 'Не стирай цю копію, доки не переконаєшся, що все на місці.'),
    el('button.btn.btn--primary.btn--wide', {
      type: 'button',
      onclick: () => {
        downloadText(raw, `dreamcut-app-пошкоджена-${new Date().toISOString().slice(0, 10)}.json`);
        toast('Файл збережено');
      },
    }, '⇩ Завантажити пошкоджену базу'),
    el('button.btn.btn--ghost.btn--wide', {
      type: 'button',
      onclick: () => confirmSheet({
        title: 'Прибрати попередження?',
        message: 'Пошкоджену копію буде стерто остаточно. Спершу переконайся, що ти її завантажив.',
        confirmLabel: 'Стерти копію',
        onConfirm: () => {
          forgetDamagedData();
          toast('Копію прибрано');
        },
      }),
    }, 'Прибрати попередження'),
  );
}

function exportBackup() {
  downloadText(JSON.stringify(buildBackup(), null, 2), backupFileName());
  toast('Копію збережено у «Файли»');
}

function downloadText(text, fileName) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = el('a', { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  // Звільняємо памʼять, але не одразу: Safari встигає підхопити файл.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importBackup({ merge }) {
  const input = el('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (merge) {
        const added = mergeBackup(text);
        toast(t('Долито: {projects} проєктів, {tasks} задач, {ideas} ідей', {
          projects: added.projects, tasks: added.tasks, ideas: added.ideas,
        }));
      } else {
        const restored = restoreBackup(text);
        toast(t('Відновлено: {projects} проєктів, {tasks} задач, {ideas} ідей', {
          projects: restored.projects, tasks: restored.tasks, ideas: restored.ideas,
        }));
      }
    } catch (error) {
      toast(error.message, { error: true });
    }
  });
  input.click();
}
