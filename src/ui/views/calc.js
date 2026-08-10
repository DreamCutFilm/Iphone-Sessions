// Операторські калькулятори.
//
// Спільний принцип: при введенні перемальовується ТІЛЬКИ блок результату.
// Якби перемальовувалася сторінка, поле втрачало б фокус, а на телефоні ще й
// закривалася б клавіатура — користуватися цим на майданчику було б неможливо.

import { el, toast } from '../dom.js';
import { pageHeader, sectionTitle } from '../components.js';
import { field, selectInput, numberInput, textInput, segmented } from '../sheet.js';
import { navigate } from '../router.js';
import { getState, patchSettings } from '../../core/store.js';

import { SENSORS, COMMON_FOCAL_LENGTHS, APERTURE_STOPS, cropFactor } from '../../core/cine/sensors.js';
import { depthOfField, fieldOfView, coverageAtDistance, fullFrameEquivalent, formatDistance, focalForFraming } from '../../core/cine/optics.js';
import {
  shutterSpeedFromAngle, formatShutter, speedRamp, ndFromStops,
  stopsBetweenApertures, COMMON_FPS, COMMON_SHUTTER_ANGLES, ND_PRESETS,
} from '../../core/cine/exposure.js';
import { CODECS, CARD_SIZES, getCodec, effectiveMbps, sizeForDuration, durationForSize, cardsNeeded, formatSize, formatDuration } from '../../core/cine/media.js';
import { framesToTimecode, timecodeToFrames, durationBetween, addTimecodes, isDropFrameRate, formatSeconds } from '../../core/cine/timecode.js';
import { shootingWindows } from '../../core/cine/sun.js';
import { formatTime, formatDate, todayISO, plural } from '../../core/dates.js';

const TOOLS = [
  { id: 'dof', title: 'Глибина різкості', hint: 'Гіперфокал, ближня й дальня межі', mark: '⊙' },
  { id: 'fov', title: 'Кут огляду', hint: 'Що влізе в кадр і яке фокусне взяти', mark: '◫' },
  { id: 'shutter', title: 'Затвор і швидкість', hint: 'Кут затвора, витримка, рампа', mark: '◐' },
  { id: 'nd', title: 'ND і стопи', hint: 'Скільки світла прибрати', mark: '◑' },
  { id: 'storage', title: 'Карти памʼяті', hint: 'Скільки місця зʼїсть зміна', mark: '▤' },
  { id: 'timecode', title: 'Таймкод', hint: 'Тривалість, сума, drop-frame', mark: '⏱' },
  { id: 'sun', title: 'Золота година', hint: 'Схід, захід, вікна зйомки', mark: '☀' },
];

// Значення полів зберігаються між переходами в межах сеансу.
const memory = {};

function remember(toolId, defaults) {
  if (!memory[toolId]) memory[toolId] = { ...defaults };
  return memory[toolId];
}

export function calcMenuView() {
  const page = el('div.page');
  page.append(pageHeader('Кіно', { subtitle: 'Розрахунки для майданчика' }));
  page.append(el('div.tool-grid', TOOLS.map((tool) => el(
    'button.tool',
    { type: 'button', onclick: () => navigate(`/calc/${tool.id}`) },
    el('span.tool-mark', tool.mark),
    el('span.tool-title', tool.title),
    el('span.tool-hint', tool.hint),
  ))));
  return page;
}

export function calcToolView(toolId) {
  const builders = {
    dof: dofTool, fov: fovTool, shutter: shutterTool, nd: ndTool,
    storage: storageTool, timecode: timecodeTool, sun: sunTool,
  };
  const build = builders[toolId];
  const tool = TOOLS.find((item) => item.id === toolId);

  const page = el('div.page');
  if (!build) {
    page.append(pageHeader('Невідомий розрахунок', { back: '/calc' }));
    return page;
  }
  page.append(pageHeader(tool.title, { subtitle: tool.hint, back: '/calc' }));
  page.append(build());
  return page;
}

/**
 * Обгортка калькулятора.
 *
 * Головне число закріплене вгорі екрана й лишається видимим, поки крутиш форму:
 * на телефоні результат інакше опинявся б під клавіатурою або далеко внизу.
 * computeResult повертає { hero: { value, label }, body }.
 */
function toolShell(buildForm, computeResult) {
  const hero = el('div.tool-hero');
  const detail = el('div.result');

  const update = () => {
    const output = computeResult() ?? {};
    hero.replaceChildren();
    detail.replaceChildren();

    if (output.hero) {
      hero.append(
        el('p.tool-hero-value', output.hero.value),
        el('p.tool-hero-label', output.hero.label),
      );
      hero.classList.remove('is-empty');
    } else {
      hero.classList.add('is-empty');
    }

    if (output.body) detail.append(output.body);
  };

  const form = buildForm(update);
  update();
  return el('div.tool-page', hero, form, detail);
}

function sensorSelect(value, onChange) {
  return selectInput(
    SENSORS.map((sensor) => ({ value: sensor.id, label: sensor.label })),
    { value, onchange: (event) => onChange(event.target.value) },
  );
}

function resultRow(label, value, variant = '') {
  return el(`div.result-row${variant ? `.result-row--${variant}` : ''}`, el('span.result-label', label), el('span.result-value', value));
}

/** Повідомлення замість результату, коли даних бракує. */
function needInput(message = 'Заповни всі поля.') {
  return { hero: null, body: el('p.result-hint', message) };
}

/** Ряд швидких кнопок — щоб не набирати типові значення вручну. */
function quickPicks(values, onPick, format = String) {
  return el('div.quick-picks', values.map((value) => el(
    'button.quick-pick',
    { type: 'button', onclick: () => onPick(value) },
    format(value),
  )));
}

// --- Глибина різкості -----------------------------------------------------

function dofTool() {
  const settings = getState().settings;
  const state = remember('dof', { sensorId: settings.sensorId, focal: 50, aperture: 2.8, distance: 3 });

  return toolShell(
    (update) => {
      const focalInput = numberInput({
        value: state.focal, min: 1, step: 1,
        oninput: (event) => { state.focal = Number(event.target.value); update(); },
      });
      const apertureInput = numberInput({
        value: state.aperture, min: 0.7, step: 0.1,
        oninput: (event) => { state.aperture = Number(event.target.value); update(); },
      });
      const distanceInput = numberInput({
        value: state.distance, min: 0.1, step: 0.1,
        oninput: (event) => { state.distance = Number(event.target.value); update(); },
      });

      return el(
        'div.form',
        field('Сенсор', sensorSelect(state.sensorId, (value) => {
          state.sensorId = value;
          patchSettings({ sensorId: value });
          update();
        })),
        field('Фокусна відстань, мм', focalInput),
        quickPicks(COMMON_FOCAL_LENGTHS, (value) => {
          state.focal = value; focalInput.value = value; update();
        }),
        field('Діафрагма', apertureInput),
        quickPicks([1.4, 2, 2.8, 4, 5.6, 8, 11, 16], (value) => {
          state.aperture = value; apertureInput.value = value; update();
        }, (value) => `f/${value}`),
        field('Дистанція фокуса, м', distanceInput),
        quickPicks([0.5, 1, 1.5, 2, 3, 5, 10, 20], (value) => {
          state.distance = value; distanceInput.value = value; update();
        }, (value) => `${value} м`),
      );
    },
    () => {
      const dof = depthOfField({
        focalMm: state.focal, aperture: state.aperture,
        sensorId: state.sensorId, distanceM: state.distance,
      });
      if (!dof) return needInput();

      const body = el(
        'div',
        el('div.dof-bar',
          el('span.dof-front', { style: { flex: String(Math.max(0.05, dof.inFront)) } }),
          el('span.dof-point'),
          el('span.dof-back', { style: { flex: String(dof.behind === Infinity ? 3 : Math.max(0.05, dof.behind)) } }),
        ),
        resultRow('Ближня межа', formatDistance(dof.near)),
        resultRow('Точка фокуса', formatDistance(state.distance), 'accent'),
        resultRow('Дальня межа', formatDistance(dof.far)),
        resultRow('Перед обʼєктом', formatDistance(dof.inFront)),
        resultRow('За обʼєктом', dof.behind === Infinity ? '∞' : formatDistance(dof.behind)),
        resultRow('Гіперфокал', formatDistance(dof.hyperfocal)),
        el('p.result-hint', `Кружок нерізкості ${dof.coc} мм · ${dof.sensor.label}`),
        dof.far === Infinity
          ? el('p.result-note', 'Фокус за гіперфокалом — усе до нескінченності різке.')
          : null,
      );

      return {
        hero: {
          value: dof.total === Infinity ? '∞' : formatDistance(dof.total),
          label: 'загальна глибина різкості',
        },
        body,
      };
    },
  );
}

// --- Кут огляду -----------------------------------------------------------

function fovTool() {
  const settings = getState().settings;
  const state = remember('fov', { sensorId: settings.sensorId, focal: 35, distance: 5, subject: 1.8 });

  return toolShell(
    (update) => {
      const focalInput = numberInput({
        value: state.focal, min: 1, step: 1,
        oninput: (event) => { state.focal = Number(event.target.value); update(); },
      });
      return el(
        'div.form',
        field('Сенсор', sensorSelect(state.sensorId, (value) => { state.sensorId = value; update(); })),
        field('Фокусна відстань, мм', focalInput),
        quickPicks(COMMON_FOCAL_LENGTHS, (value) => { state.focal = value; focalInput.value = value; update(); }),
        field('Дистанція до обʼєкта, м', numberInput({
          value: state.distance, min: 0.1, step: 0.1,
          oninput: (event) => { state.distance = Number(event.target.value); update(); },
        })),
        field('Ширина обʼєкта, м', numberInput({
          value: state.subject, min: 0.05, step: 0.1,
          oninput: (event) => { state.subject = Number(event.target.value); update(); },
        }), 'Людина в повний зріст — близько 0.6 м завширшки, група — 2–3 м.'),
      );
    },
    () => {
      const fov = fieldOfView({ focalMm: state.focal, sensorId: state.sensorId });
      const coverage = coverageAtDistance({ focalMm: state.focal, sensorId: state.sensorId, distanceM: state.distance });
      const equivalent = fullFrameEquivalent({ focalMm: state.focal, sensorId: state.sensorId });
      const suggested = focalForFraming({ sensorId: state.sensorId, distanceM: state.distance, subjectWidthM: state.subject });
      if (!fov || !coverage) return needInput();

      const body = el(
        'div',
        resultRow('Вертикальний', `${fov.vertical.toFixed(1)}°`),
        resultRow('Діагональний', `${fov.diagonal.toFixed(1)}°`),
        sectionTitle('На вказаній дистанції'),
        resultRow('Ширина кадру', formatDistance(coverage.width), 'accent'),
        resultRow('Висота кадру', formatDistance(coverage.height)),
        sectionTitle('Підбір оптики'),
        resultRow(`Щоб обʼєкт ${state.subject} м зайняв кадр`, suggested ? `${Math.round(suggested)} мм` : '—', 'accent'),
        resultRow('Еквівалент на повному кадрі', equivalent ? `${Math.round(equivalent)} мм` : '—'),
        resultRow('Кроп-фактор сенсора', `${cropFactor(fov.sensor).toFixed(2)}×`),
      );

      return {
        hero: { value: `${fov.horizontal.toFixed(1)}°`, label: 'горизонтальний кут огляду' },
        body,
      };
    },
  );
}

// --- Затвор ---------------------------------------------------------------

function shutterTool() {
  const settings = getState().settings;
  const state = remember('shutter', { fps: settings.fps, angle: 180, captureFps: 100, projectFps: settings.fps });

  return toolShell(
    (update) => {
      const fpsInput = numberInput({
        value: state.fps, min: 1, step: 0.01,
        oninput: (event) => { state.fps = Number(event.target.value); update(); },
      });
      const angleInput = numberInput({
        value: state.angle, min: 1, max: 360, step: 1,
        oninput: (event) => { state.angle = Number(event.target.value); update(); },
      });

      return el(
        'div.form',
        field('Кадрова частота, к/с', fpsInput),
        quickPicks(COMMON_FPS, (value) => {
          state.fps = value; fpsInput.value = value;
          patchSettings({ fps: value });
          update();
        }),
        field('Кут затвора, °', angleInput),
        quickPicks(COMMON_SHUTTER_ANGLES, (value) => { state.angle = value; angleInput.value = value; update(); }, (value) => `${value}°`),
        sectionTitle('Уповільнення'),
        field('Знімаю з частотою, к/с', numberInput({
          value: state.captureFps, min: 1, step: 1,
          oninput: (event) => { state.captureFps = Number(event.target.value); update(); },
        })),
        field('Частота проєкту, к/с', numberInput({
          value: state.projectFps, min: 1, step: 1,
          oninput: (event) => { state.projectFps = Number(event.target.value); update(); },
        })),
      );
    },
    () => {
      const shutter = shutterSpeedFromAngle({ angle: state.angle, fps: state.fps });
      const ramp = speedRamp({ captureFps: state.captureFps, projectFps: state.projectFps });
      if (!shutter) return needInput('Заповни частоту й кут.');

      const natural = shutterSpeedFromAngle({ angle: 180, fps: state.fps });

      const body = el(
        'div',
        resultRow('Природний рух (180°)', formatShutter(natural.seconds), 'accent'),
        state.angle !== 180
          ? resultRow(
              'Відхилення від 180°',
              `${(Math.log2(state.angle / 180) >= 0 ? '+' : '')}${Math.log2(state.angle / 180).toFixed(2)} стопа`,
            )
          : null,
        el('p.result-note', state.angle > 180
          ? 'Ширший кут — довша витримка, більше змазу й більше світла.'
          : state.angle < 180
            ? 'Вужчий кут — різкіший, «стробний» рух і менше світла.'
            : 'Класика: рух виглядає природно.'),
        ramp ? el('div',
          sectionTitle('Уповільнення'),
          resultRow('Швидкість відтворення', `${ramp.percent.toFixed(1)} %`, 'accent'),
          resultRow('Коефіцієнт', `${ramp.slowdown.toFixed(2)}× ${ramp.slowdown > 1 ? 'повільніше' : 'швидше'}`),
          resultRow('1 хв зйомки стане', formatDuration(ramp.slowdown)),
          resultRow('Витримка на зйомці', formatShutter(shutterSpeedFromAngle({ angle: state.angle, fps: state.captureFps }).seconds)),
        ) : null,
      );

      return {
        hero: {
          value: formatShutter(shutter.seconds),
          label: `витримка при ${state.angle}° і ${state.fps} к/с`,
        },
        body,
      };
    },
  );
}

// --- ND і стопи -----------------------------------------------------------

function ndTool() {
  const state = remember('nd', { stops: 3, from: 8, to: 2.8 });

  return toolShell(
    (update) => {
      const stopsInput = numberInput({
        value: state.stops, min: 0, max: 15, step: 0.5,
        oninput: (event) => { state.stops = Number(event.target.value); update(); },
      });
      return el(
        'div.form',
        field('Прибрати стопів', stopsInput),
        quickPicks(ND_PRESETS.map((preset) => preset.stops), (value) => {
          state.stops = value; stopsInput.value = value; update();
        }, (value) => `${value}`),
        sectionTitle('Скільки стопів між діафрагмами'),
        field('Було f/', numberInput({
          value: state.from, min: 0.7, step: 0.1,
          oninput: (event) => { state.from = Number(event.target.value); update(); },
        })),
        field('Стало f/', numberInput({
          value: state.to, min: 0.7, step: 0.1,
          oninput: (event) => { state.to = Number(event.target.value); update(); },
        })),
      );
    },
    () => {
      const nd = ndFromStops(state.stops);
      const between = stopsBetweenApertures(state.from, state.to);

      const body = el(
        'div',
        nd ? el('div',
          resultRow('Оптична щільність', nd.density.toFixed(1)),
          resultRow('Кратність', `${Math.round(nd.factor)}×`),
        ) : null,
        sectionTitle('Різниця діафрагм'),
        between === null
          ? el('p.result-hint', 'Вкажи обидві діафрагми.')
          : el('div',
              resultRow(`f/${state.from} → f/${state.to}`, `${between > 0 ? '+' : ''}${between.toFixed(2)} стопа`, 'accent'),
              el('p.result-note', between > 0
                ? `Відкриваєш діафрагму — світла більше на ${Math.abs(between).toFixed(1)} стопа. Компенсуй ND ${(Math.abs(between) * 0.3).toFixed(1)}.`
                : `Закриваєш діафрагму — світла менше на ${Math.abs(between).toFixed(1)} стопа.`),
            ),
        sectionTitle('Готові фільтри'),
        el('div.nd-table', ND_PRESETS.map((preset) => el(
          'div.nd-cell',
          el('span.nd-density', `ND ${preset.density.toFixed(1)}`),
          el('span.nd-stops', `${preset.stops} ст · ${2 ** preset.stops}×`),
        ))),
      );

      return {
        hero: nd
          ? {
              value: nd.label,
              label: `${plural(state.stops, 'стоп', 'стопи', 'стопів')} · у ${Math.round(nd.factor)}× менше світла`,
            }
          : null,
        body,
      };
    },
  );
}

// --- Карти памʼяті --------------------------------------------------------

function storageTool() {
  const settings = getState().settings;
  const state = remember('storage', {
    codecId: settings.codecId, fps: settings.fps, minutes: 60,
    cameras: 1, copies: 2, headroom: 20, cardGb: 512,
  });

  return toolShell(
    (update) => {
      const minutesInput = numberInput({
        value: state.minutes, min: 1, step: 5,
        oninput: (event) => { state.minutes = Number(event.target.value); update(); },
      });

      return el(
      'div.form',
      field('Кодек', selectInput(
        CODECS.map((codec) => ({ value: codec.id, label: `${codec.group} · ${codec.label}` })),
        {
          value: state.codecId,
          onchange: (event) => {
            state.codecId = event.target.value;
            patchSettings({ codecId: state.codecId });
            update();
          },
        },
      )),
      field('Кадрова частота, к/с', numberInput({
        value: state.fps, min: 1, step: 1,
        oninput: (event) => { state.fps = Number(event.target.value); update(); },
      })),
      field('Хвилин запису', minutesInput, 'Скільки реально крутиться камера, а не тривалість зміни.'),
      quickPicks([30, 60, 120, 240, 480], (value) => {
        state.minutes = value;
        minutesInput.value = value;
        update();
      }, (value) => formatDuration(value)),
      field('Камер', numberInput({
        value: state.cameras, min: 1, max: 12, step: 1,
        oninput: (event) => { state.cameras = Number(event.target.value); update(); },
      })),
      field('Копій матеріалу', numberInput({
        value: state.copies, min: 1, max: 5, step: 1,
        oninput: (event) => { state.copies = Number(event.target.value); update(); },
      }), 'Робоча копія плюс бекап — це вже дві.'),
      field('Запас, %', numberInput({
        value: state.headroom, min: 0, max: 100, step: 5,
        oninput: (event) => { state.headroom = Number(event.target.value); update(); },
      })),
      field('Обʼєм однієї карти, ГБ', selectInput(
        CARD_SIZES.map((size) => ({ value: String(size), label: size >= 1024 ? `${size / 1024} ТБ` : `${size} ГБ` })),
        { value: String(state.cardGb), onchange: (event) => { state.cardGb = Number(event.target.value); update(); } },
      )),
      );
    },
    () => {
      const codec = getCodec(state.codecId);
      const mbps = effectiveMbps(codec, state.fps);
      const size = sizeForDuration({
        mbps, minutes: state.minutes, cameras: state.cameras,
        copies: state.copies, headroomPercent: state.headroom,
      });
      if (!size) return needInput();

      const perCard = durationForSize({ mbps, gigabytes: state.cardGb, cameras: 1 });
      const cards = cardsNeeded({ totalGb: size.perCameraGb * state.cameras, cardGb: state.cardGb });

      const body = el(
        'div',
        resultRow('Бітрейт', `${Math.round(mbps)} Мбіт/с`),
        resultRow('За годину на камеру', formatSize(size.gbPerHour), 'accent'),
        resultRow('Матеріал з однієї камери', formatSize(size.perCameraGb)),
        resultRow('Карт на зміну', `${cards} × ${state.cardGb >= 1024 ? `${state.cardGb / 1024} ТБ` : `${state.cardGb} ГБ`}`, 'accent'),
        resultRow(`На одну карту вміститься`, perCard ? perCard.label : '—'),
        el('p.result-note', `Розрахунок для ${codec.label} на ${state.fps} к/с. Для кодеків зі змінним бітрейтом реальний обсяг гуляє — запас ${state.headroom} % уже враховано.`),
      );

      return {
        hero: { value: formatSize(size.totalGb), label: 'усього місця з копіями та запасом' },
        body,
      };
    },
  );
}

// --- Таймкод --------------------------------------------------------------

function timecodeTool() {
  const settings = getState().settings;
  const state = remember('timecode', { fps: settings.fps, from: '10:00:00:00', to: '10:24:30:12', mode: 'duration' });

  return toolShell(
    (update) => {
      const fpsInput = numberInput({
        value: state.fps, min: 1, step: 0.01,
        oninput: (event) => { state.fps = Number(event.target.value); update(); },
      });
      return el(
        'div.form',
        field('Кадрова частота, к/с', fpsInput),
        quickPicks(COMMON_FPS, (value) => { state.fps = value; fpsInput.value = value; update(); }),
        field('Режим', segmented(
          [
            { value: 'duration', label: 'Тривалість' },
            { value: 'add', label: 'Додати' },
            { value: 'sub', label: 'Відняти' },
          ],
          state.mode,
          (value) => { state.mode = value; update(); },
        )),
        field('Перший таймкод', textInput({
          value: state.from, placeholder: '00:00:00:00', inputmode: 'numeric',
          oninput: (event) => { state.from = event.target.value; update(); },
        })),
        field('Другий таймкод', textInput({
          value: state.to, placeholder: '00:00:00:00', inputmode: 'numeric',
          oninput: (event) => { state.to = event.target.value; update(); },
        })),
      );
    },
    () => {
      const drop = isDropFrameRate(state.fps);
      let output = null;

      if (state.mode === 'duration') {
        output = durationBetween(state.from, state.to, state.fps);
      } else {
        output = addTimecodes(state.from, state.to, state.fps, { subtract: state.mode === 'sub' });
      }

      if (!output) return needInput('Формат таймкоду: ГГ:ХХ:СС:КК, наприклад 01:23:45:12.');

      const frames = output.frames;
      const seconds = frames / state.fps;

      const body = el(
        'div',
        resultRow('Кадрів', new Intl.NumberFormat('uk-UA').format(frames)),
        resultRow('Реальний час', formatSeconds(seconds), 'accent'),
        drop ? resultRow('Режим', 'Drop-frame (позначається ;)') : resultRow('Режим', 'Non-drop'),
        output.wrapped ? el('p.result-note', 'Перехід через опівніч враховано.') : null,
        drop ? el('p.result-note', 'При 29.97 і 59.94 к/с частина номерів кадрів пропускається, щоб таймкод збігався з реальним часом. Самі кадри при цьому не зникають.') : null,
      );

      return {
        hero: {
          value: output.timecode,
          label: state.mode === 'duration' ? 'тривалість' : state.mode === 'add' ? 'сума' : 'різниця',
        },
        body,
      };
    },
  );
}

// --- Золота година --------------------------------------------------------

function sunTool() {
  const settings = getState().settings;
  const state = remember('sun', {
    latitude: settings.latitude ?? 50.45,
    longitude: settings.longitude ?? 30.52,
    label: settings.locationLabel || 'Київ',
    date: todayISO(),
  });

  return toolShell(
    (update) => {
      const latInput = numberInput({
        value: state.latitude, step: 0.0001,
        oninput: (event) => { state.latitude = Number(event.target.value); update(); },
      });
      const lonInput = numberInput({
        value: state.longitude, step: 0.0001,
        oninput: (event) => { state.longitude = Number(event.target.value); update(); },
      });

      const locate = el('button.btn.btn--ghost.btn--wide', {
        type: 'button',
        onclick: () => {
          if (!navigator.geolocation) { toast('Пристрій не дає координат', { error: true }); return; }
          toast('Визначаю координати…');
          navigator.geolocation.getCurrentPosition(
            (position) => {
              state.latitude = Number(position.coords.latitude.toFixed(4));
              state.longitude = Number(position.coords.longitude.toFixed(4));
              state.label = 'Поточне місце';
              latInput.value = state.latitude;
              lonInput.value = state.longitude;
              patchSettings({ latitude: state.latitude, longitude: state.longitude, locationLabel: state.label });
              update();
              toast('Координати оновлено');
            },
            () => toast('Не вдалося отримати геолокацію', { error: true }),
            { enableHighAccuracy: false, timeout: 10_000 },
          );
        },
      }, '📍 Взяти координати з телефона');

      return el(
        'div.form',
        field('Дата', el('input.input', {
          type: 'date', value: state.date,
          onchange: (event) => { state.date = event.target.value || todayISO(); update(); },
        })),
        locate,
        field('Назва місця', textInput({
          value: state.label,
          oninput: (event) => { state.label = event.target.value; },
        })),
        field('Широта', latInput),
        field('Довгота', lonInput),
        el('button.btn.btn--ghost.btn--wide', {
          type: 'button',
          onclick: () => {
            patchSettings({ latitude: state.latitude, longitude: state.longitude, locationLabel: state.label });
            toast('Локацію збережено — тепер вона на екрані огляду');
          },
        }, 'Зберегти як основну локацію'),
      );
    },
    () => {
      const [year, month, day] = state.date.split('-').map(Number);
      // Опівдні за UTC — щоб розрахунок гарантовано потрапив у потрібну добу.
      const date = new Date(Date.UTC(year, month - 1, day, 12));
      const windows = shootingWindows(date, state.latitude, state.longitude);
      if (!windows) return needInput('Вкажи координати.');

      const { times } = windows;
      const span = (window) => (window ? `${formatTime(window.from)} – ${formatTime(window.to)}` : 'не настає');
      const length = (window) => (window ? `${window.minutes} хв` : '—');

      const body = el(
        'div',
        el('p.result-hint', `${state.label || 'Локація'} · ${formatDate(state.date)}`),
        el('div.sun-windows',
          sunWindow('Ранкова синя', span(windows.morningBlue), length(windows.morningBlue), 'blue'),
          sunWindow('Ранкова золота', span(windows.morningGolden), length(windows.morningGolden), 'gold'),
          sunWindow('Вечірня золота', span(windows.eveningGolden), length(windows.eveningGolden), 'gold'),
          sunWindow('Вечірня синя', span(windows.eveningBlue), length(windows.eveningBlue), 'blue'),
        ),
        sectionTitle('Сонце'),
        resultRow('Схід', times.sunrise ? formatTime(times.sunrise) : 'не сходить'),
        resultRow('Сонячний полудень', formatTime(times.solarNoon)),
        resultRow('Захід', times.sunset ? formatTime(times.sunset) : 'не заходить'),
        resultRow('Світловий день', windows.daylightMinutes !== null
          ? `${Math.floor(windows.daylightMinutes / 60)} год ${windows.daylightMinutes % 60} хв`
          : '—', 'accent'),
        sectionTitle('Сутінки'),
        resultRow('Громадянські (початок)', times.blueHourStart ? formatTime(times.blueHourStart) : '—'),
        resultRow('Громадянські (кінець)', times.blueHourEnd ? formatTime(times.blueHourEnd) : '—'),
        resultRow('Астрономічна ніч', times.astroDusk ? formatTime(times.astroDusk) : 'не настає'),
        el('p.result-note', 'Розрахунок астрономічний і працює без інтернету. Хмари й рельєф він, звісно, не враховує.'),
      );

      return {
        hero: windows.eveningGolden
          ? { value: span(windows.eveningGolden), label: 'вечірня золота година' }
          : { value: '—', label: 'золота година не настає' },
        body,
      };
    },
  );
}

function sunWindow(title, range, length, tone) {
  return el(
    `div.sun-window.sun-window--${tone}`,
    el('p.sun-window-title', title),
    el('p.sun-window-range', range),
    el('p.sun-window-length', length),
  );
}

export { TOOLS };
