// Налаштування: значення за замовчуванням, локація, резервні копії.

import { el, toast } from '../dom.js';
import { t } from '../../core/i18n.js';
import { pageHeader, sectionTitle } from '../components.js';
import { field, selectInput, numberInput, textInput, confirmSheet } from '../sheet.js';
import { getState, patchSettings, replaceState, damagedData, forgetDamagedData } from '../../core/store.js';
import { buildBackup, backupFileName, restoreBackup, mergeBackup } from '../../core/backup.js';
import { storageName } from '../../core/storage.js';
import { SENSORS } from '../../core/cine/sensors.js';
import { CODECS } from '../../core/cine/media.js';
import { COMMON_FPS } from '../../core/cine/exposure.js';
import { LANGUAGES, CURRENCIES, getLanguage, setLanguage, getCurrency, formatMoney } from '../../core/locale.js';
import { notificationState, requestNotifications } from '../reminders.js';
import { navigate } from '../router.js';
import { isSignedIn, currentUser } from '../../core/cloud.js';
import { APP_VERSION } from '../../app-meta.js';

export function settingsView() {
  const state = getState();
  const page = el('div.page');

  page.append(pageHeader('Налаштування', { back: '/overview' }));

  page.append(sectionTitle('Акаунт'));
  page.append(accountBlock());

  page.append(sectionTitle('Мова та валюта'));
  page.append(localeBlock(state));

  page.append(sectionTitle('За замовчуванням'));
  page.append(el(
    'div.form',
    field('Сенсор', selectInput(
      SENSORS.map((sensor) => ({ value: sensor.id, label: sensor.label })),
      { value: state.settings.sensorId, onchange: (event) => patchSettings({ sensorId: event.target.value }) },
    ), 'Підставляється в калькулятори оптики.'),
    field('Кодек', selectInput(
      CODECS.map((codec) => ({ value: codec.id, label: `${t(codec.group)} · ${codec.label}` })),
      { value: state.settings.codecId, onchange: (event) => patchSettings({ codecId: event.target.value }) },
    )),
    field('Кадрова частота', selectInput(
      COMMON_FPS.map((fps) => ({ value: String(fps), label: `${fps} ${t('к/с')}` })),
      { value: String(state.settings.fps), onchange: (event) => patchSettings({ fps: Number(event.target.value) }) },
    )),
  ));

  page.append(sectionTitle('Локація для сонця'));
  page.append(el(
    'div.form',
    field('Назва', textInput({
      value: state.settings.locationLabel,
      placeholder: 'Київ',
      onchange: (event) => patchSettings({ locationLabel: event.target.value }),
    })),
    field('Широта', numberInput({
      value: state.settings.latitude ?? '', step: 0.0001, placeholder: '50.45',
      onchange: (event) => patchSettings({ latitude: parseOrNull(event.target.value) }),
    })),
    field('Довгота', numberInput({
      value: state.settings.longitude ?? '', step: 0.0001, placeholder: '30.52',
      onchange: (event) => patchSettings({ longitude: parseOrNull(event.target.value) }),
    }), 'Коли координати задано, золота година зʼявляється на екрані огляду.'),
  ));

  page.append(sectionTitle('Нагадування'));
  page.append(notificationBlock());

  const damaged = damagedData();
  if (damaged) {
    page.append(sectionTitle('Увага'));
    page.append(damagedBlock(damaged));
  }

  page.append(sectionTitle('Дані'));
  page.append(el(
    'div.form',
    el('p.settings-note',
      t('Зараз збережено: {projects} проєктів, {tasks} задач, {ideas} ідей. ', { projects: state.projects.length, tasks: state.tasks.length, ideas: state.ideas.length }) +
      'Усе лежить локально на цьому пристрої й нікуди не надсилається.'),
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

  page.append(sectionTitle('Про застосунок'));
  page.append(el(
    'div.about',
    el('p.about-name', 'DreamCut App'),
    el('p.about-line', t('Версія {version}', { version: APP_VERSION })),
    el('p.about-line', t('Сховище: {name}', { name: storageName() })),
    el('p.about-line', 'Працює офлайн. Розрахунки виконуються на пристрої.'),
  ));
  page.append(el('div.form', updateButton()));

  return page;
}

/**
 * Вхід до акаунта — окремим рядком, а не цілим екраном тут.
 *
 * Акаунт живе в мережі, а решта налаштувань — на пристрої. Змішувати їх
 * на одному екрані означало б, що при відсутності звʼязку «заглючать»
 * і сенсор із валютою, які до мережі стосунку не мають.
 */
function accountBlock() {
  const signedIn = isSignedIn();
  const email = currentUser()?.email ?? '';

  return el(
    'div.list',
    el(
      'article.row',
      { onclick: () => navigate('/account') },
      el('span.row-mark', signedIn ? '🙋' : '○'),
      el('div.row-body',
        el('p.row-title', signedIn ? (email || 'Мій акаунт') : 'Увійти або створити акаунт'),
        el('p.row-note', signedIn
          ? 'Фірма, команда, запрошення'
          : 'Потрібен лише для спільної роботи. Без нього все працює як раніше.')),
      el('span.card-chevron', '›'),
    ),
  );
}

function localeBlock(state) {
  const block = el(
    'div.form',
    field('Мова інтерфейсу', selectInput(
      // Назви мов не перекладаються: людина, яка шукає свою мову у списку,
      // шукає її написаною по-своєму.
      LANGUAGES.map((item) => ({ value: item.id, label: item.native })),
      {
        value: getLanguage(),
        onchange: (event) => {
          const chosen = setLanguage(event.target.value);
          // Мову зберігаємо і в налаштуваннях: так вона поїде разом із
          // резервною копією, як і решта вибору людини. Перемалює екран
          // підписник у app.js — разом із нижніми вкладками.
          patchSettings({ language: chosen });
        },
      },
    )),

    field('Валюта', selectInput(
      CURRENCIES.map((currency) => ({
        value: currency.code,
        label: `${t(currency.label)} (${currency.symbol})`,
      })),
      {
        value: state.settings.currency,
        onchange: (event) => {
          patchSettings({ currency: event.target.value });
          toast(t('Валюта: {name}', { name: t(getCurrency(event.target.value).label) }));
        },
      },
    ), 'Змінює лише підпис сум. Уже введені гонорари не перераховуються за курсом — щоб історія проєктів не спотворювалась.'),

    el('p.settings-note', t('Приклад: {sum}', { sum: formatMoney(48000, state.settings.currency) })),
  );

  return block;
}

function notificationBlock() {
  const status = notificationState();

  if (status === 'unsupported') {
    return el('p.settings-note',
      'Цей браузер не вміє показувати системні сповіщення. Нагадування все одно спрацюють — ' +
      'застосунок покаже їх, щойно ти його відкриєш.');
  }

  if (status === 'granted') {
    return el('p.settings-note',
      '✓ Дозвіл на сповіщення надано. Нагадування спливатимуть, поки застосунок відкритий. ' +
      'Коли він закритий, iOS показує їх не завжди — тому для по-справжньому критичних речей ' +
      'дублюй нагадування у стандартний застосунок «Нагадування».');
  }

  if (status === 'denied') {
    return el('p.settings-note',
      'Сповіщення заборонені в налаштуваннях Safari. Нагадування показуватимуться всередині ' +
      'застосунку при відкритті.');
  }

  return el(
    'div.form',
    el('p.settings-note', 'Дозволь сповіщення, щоб нагадування спливали системно.'),
    el('button.btn.btn--ghost.btn--wide', {
      type: 'button',
      onclick: async () => {
        const result = await requestNotifications();
        toast(result === 'granted' ? 'Сповіщення увімкнено' : 'Дозвіл не надано');
      },
    }, 'Дозволити сповіщення'),
  );
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
      '⚠ Попередню базу не вдалося прочитати, тому застосунок відкрився порожнім. ' +
      'Пошкоджені дані збережено окремо — завантаж їх файлом, звідти можна витягнути записи. ' +
      'Не стирай цю копію, доки не переконаєшся, що все на місці.'),
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
        toast(t('Долито: {projects} проєктів, {tasks} задач, {ideas} ідей', { projects: added.projects, tasks: added.tasks, ideas: added.ideas }));
      } else {
        const restored = restoreBackup(text);
        toast(t('Відновлено: {projects} проєктів, {tasks} задач, {ideas} ідей', { projects: restored.projects, tasks: restored.tasks, ideas: restored.ideas }));
      }
    } catch (error) {
      toast(error.message, { error: true });
    }
  });
  input.click();
}

function parseOrNull(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
