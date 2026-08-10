// Нагадування.
//
// Чесно про обмеження вебу на iPhone: надійно розбудити застосунок, коли він
// закритий, браузер не може — для цього потрібні push-сповіщення з сервером.
// Тому працює двоступенева схема:
//   1. Поки застосунок відкритий — системне сповіщення точно в час.
//   2. Коли застосунок відкривають — показуємо все, що прострочило.
// Нативна версія замінить цей модуль на UNUserNotificationCenter, і нагадування
// приходитимуть у будь-якому стані. Інтерфейс модуля при цьому не зміниться.

import { getState, patchItem } from '../core/store.js';
import { dueReminders } from '../core/selectors.js';
import { toast } from './dom.js';
import { navigate } from './router.js';

const CHECK_INTERVAL_MS = 30_000;
let timer = null;

export function notificationState() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function requestNotifications() {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/** Запускає перевірку нагадувань і повертає функцію зупинки. */
export function startReminders() {
  check();
  timer = setInterval(check, CHECK_INTERVAL_MS);

  // Повернення до застосунку — найчастіший момент, коли треба наздогнати пропущене.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

function check() {
  const due = dueReminders(getState());
  if (!due.length) return;

  for (const task of due) {
    show(task);
    // Позначаємо як показане, щоб не смикати щохвилини.
    patchItem('tasks', task.id, { remindedAt: new Date().toISOString() });
  }
}

function show(task) {
  const body = task.notes || 'Нагадування з DreamCut Ops';

  if (notificationState() === 'granted') {
    try {
      const notification = new Notification(task.title, {
        body,
        tag: task.id,
        icon: 'assets/icons/icon-192.png',
        badge: 'assets/icons/icon-192.png',
      });
      notification.addEventListener('click', () => {
        window.focus();
        navigate('/tasks');
        notification.close();
      });
      return;
    } catch {
      // Якщо системне сповіщення не вдалося — падаємо на внутрішнє.
    }
  }

  toast(`🔔 ${task.title}`);
}
