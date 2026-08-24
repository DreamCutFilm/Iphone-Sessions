// Налаштування: те, що людина міняє під себе.
//
// Обслуговування самого застосунку — оновлення, резервні копії, версія —
// живе окремо, на екрані «Про програму». Різні за природою речі поруч
// заважають одна одній: копію доводилось шукати між вибором сенсора
// й дозволом на сповіщення.

import { el, toast } from '../dom.js';
import { t } from '../../core/i18n.js';
import { pageHeader, sectionTitle } from '../components.js';
import { field, selectInput, numberInput, textInput } from '../sheet.js';
import { getState, patchSettings } from '../../core/store.js';
import { SENSORS } from '../../core/cine/sensors.js';
import { CODECS } from '../../core/cine/media.js';
import { COMMON_FPS } from '../../core/cine/exposure.js';
import { LANGUAGES, CURRENCIES, getLanguage, setLanguage, getCurrency, formatMoney } from '../../core/locale.js';
import { notificationState, requestNotifications } from '../reminders.js';
import { navigate } from '../router.js';
import { isSignedIn, currentUser } from '../../core/cloud.js';

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

function parseOrNull(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
