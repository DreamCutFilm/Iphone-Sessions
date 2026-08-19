// Перевірка розрахункового ядра. Запуск: node --test tests/
//
// Тести навмисно спираються на величини, які оператор може перевірити з досвіду
// чи за друкованими таблицями: гіперфокал 50 мм на f/2.8, кут затвора 180°,
// схід сонця в Києві, drop-frame таймкод.

import test from 'node:test';
import assert from 'node:assert/strict';

import { depthOfField, fieldOfView, hyperfocalMm, coverageAtDistance, fullFrameEquivalent } from '../src/core/cine/optics.js';
import { shutterSpeedFromAngle, angleFromShutterSpeed, speedRamp, ndFromStops, stopsBetweenApertures } from '../src/core/cine/exposure.js';
import { sizeForDuration, durationForSize, effectiveMbps, getCodec, cardsNeeded } from '../src/core/cine/media.js';
import { framesToTimecode, timecodeToFrames, durationBetween, addTimecodes, isDropFrameRate } from '../src/core/cine/timecode.js';
import { sunTimes, shootingWindows } from '../src/core/cine/sun.js';
import { daysUntil, describeDue, parseDateOnly, toDateOnly, plural, expandDateRange } from '../src/core/dates.js';
import {
  lonLatToTile, tileToLonLat, tileUrl, clampZoom, wrapLongitude,
  parseCoordinates, mapsLink,
} from '../src/core/geo.js';
import { taskOrder, projectPayouts, projectFinance } from '../src/core/selectors.js';
import { createTask, createProject } from '../src/core/models.js';
import { formatMoney, currencySymbol, getCurrency, getLanguage, CURRENCIES, LANGUAGES } from '../src/core/locale.js';
import { createEquipment, unitMargin } from '../src/core/equipment.js';
import { makeSlug, isValidSlug, generateCode, roleLabel, canManage } from '../src/core/account.js';
import { createCrew, crewLabel, clientRate, crewMargin, normalizeCrew } from '../src/core/crew.js';
import { buildProjectPayload, unlinkedPayouts, sharedProfit } from '../src/core/sharing.js';
import {
  createEstimate, createItem, itemAmount, estimateTotals,
  totalsByCategory, clientView, itemFromEquipment, estimateToText, describeItemCount,
  itemCost, itemFromCrew, crewPayouts, costByPurpose,
} from '../src/core/estimates.js';

const near = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: отримано ${actual}, очікувалось ${expected} ±${tolerance}`,
  );
};

test('гіперфокал 50 мм f/2.8 на Super 35', () => {
  // H = f²/(N·c) + f = 2500/(2.8·0.02) + 50 ≈ 44 693 мм ≈ 44.7 м
  const hyperfocal = hyperfocalMm(50, 2.8, 0.02);
  near(hyperfocal / 1000, 44.69, 0.05, 'гіперфокал у метрах');
});

test('глибина різкості симетрична навколо точки фокуса на близькій дистанції', () => {
  const dof = depthOfField({ focalMm: 50, aperture: 2.8, sensorId: 's35', distanceM: 3 });
  assert.ok(dof.near < 3 && dof.far > 3, 'точка фокуса має бути всередині зони різкості');
  // На коротких дистанціях зона різкості за обʼєктом більша, ніж перед ним.
  assert.ok(dof.behind > dof.inFront, 'за обʼєктом різкості має бути більше');
  near(dof.near, 2.82, 0.05, 'ближня межа');
  near(dof.far, 3.2, 0.05, 'дальня межа');
});

test('за гіперфокалом дальня межа — нескінченність', () => {
  const dof = depthOfField({ focalMm: 50, aperture: 2.8, sensorId: 's35', distanceM: 60 });
  assert.equal(dof.far, Infinity);
  assert.equal(dof.total, Infinity);
});

test('ширший обʼєктив дає більшу глибину різкості', () => {
  const wide = depthOfField({ focalMm: 24, aperture: 2.8, sensorId: 's35', distanceM: 3 });
  const long = depthOfField({ focalMm: 85, aperture: 2.8, sensorId: 's35', distanceM: 3 });
  assert.ok(wide.total > long.total, '24 мм має перекрити більше, ніж 85 мм');
});

test('кут огляду 50 мм на повному кадрі ≈ 39.6°', () => {
  const fov = fieldOfView({ focalMm: 50, sensorId: 'ff' });
  near(fov.horizontal, 39.6, 0.3, 'горизонтальний кут');
  near(fov.diagonal, 46.8, 0.3, 'діагональний кут');
});

test('покриття кадру: 50 мм на повному кадрі з 10 м бере 7.2 м по ширині', () => {
  const coverage = coverageAtDistance({ focalMm: 50, sensorId: 'ff', distanceM: 10 });
  near(coverage.width, 7.2, 0.01, 'ширина покриття');
});

test('еквівалент фокусного: Super 35 має кроп близько 1.4×', () => {
  const equivalent = fullFrameEquivalent({ focalMm: 50, sensorId: 's35' });
  near(equivalent, 69.6, 0.5, 'еквівалент на повному кадрі');
});

test('правило 180 градусів', () => {
  near(shutterSpeedFromAngle({ angle: 180, fps: 25 }).denominator, 50, 0.001, 'витримка при 25 к/с');
  near(shutterSpeedFromAngle({ angle: 180, fps: 24 }).denominator, 48, 0.001, 'витримка при 24 к/с');
  near(angleFromShutterSpeed({ denominator: 50, fps: 25 }), 180, 0.001, 'зворотний перерахунок');
});

test('рампа швидкості: 100 к/с у проєкті 25 к/с — уповільнення в 4 рази', () => {
  const ramp = speedRamp({ captureFps: 100, projectFps: 25 });
  near(ramp.percent, 25, 0.001, 'відсоток швидкості');
  near(ramp.slowdown, 4, 0.001, 'коефіцієнт уповільнення');
});

test('ND-фільтри: 6 стопів = ND 1.8 = у 64 рази менше світла', () => {
  const nd = ndFromStops(6);
  near(nd.density, 1.8, 0.001, 'щільність');
  near(nd.factor, 64, 0.001, 'кратність');
});

test('різниця в стопах між f/2.8 і f/8 ≈ 3', () => {
  near(stopsBetweenApertures(2.8, 8), 3.03, 0.05, 'стопи');
});

test('обʼєм: ProRes 422 HQ 1080p — приблизно 99 ГБ за годину', () => {
  const codec = getCodec('prores422hq-1080');
  const size = sizeForDuration({ mbps: codec.mbps, minutes: 60 });
  near(size.totalGb, 99, 1, 'гігабайти за годину');
});

test('обʼєм множиться на камери та копії', () => {
  const single = sizeForDuration({ mbps: 220, minutes: 60 });
  const multi = sizeForDuration({ mbps: 220, minutes: 60, cameras: 2, copies: 2 });
  near(multi.totalGb, single.totalGb * 4, 0.01, 'дві камери у двох копіях');
});

test('запас у відсотках додається зверху', () => {
  const withHeadroom = sizeForDuration({ mbps: 100, minutes: 60, headroomPercent: 20 });
  const plain = sizeForDuration({ mbps: 100, minutes: 60 });
  near(withHeadroom.totalGb, plain.totalGb * 1.2, 0.01, 'запас 20 %');
});

test('тривалість і обʼєм — взаємно зворотні', () => {
  const size = sizeForDuration({ mbps: 880, minutes: 45 });
  const duration = durationForSize({ mbps: 880, gigabytes: size.totalGb });
  near(duration.minutes, 45, 0.01, 'зворотний перерахунок');
});

test('бітрейт масштабується з кадровою частотою', () => {
  const codec = getCodec('prores422hq-1080');
  near(effectiveMbps(codec, 50), codec.mbps * 2, 0.001, '50 к/с удвічі важчі за 25');
});

test('кількість карт округлюється вгору', () => {
  assert.equal(cardsNeeded({ totalGb: 300, cardGb: 128 }), 3);
  assert.equal(cardsNeeded({ totalGb: 256, cardGb: 128 }), 2);
});

test('таймкод: перетворення в кадри й назад без drop-frame', () => {
  const frames = timecodeToFrames('01:00:00:00', 25, false);
  assert.equal(frames, 90_000);
  assert.equal(framesToTimecode(90_000, 25, false), '01:00:00:00');
});

test('drop-frame визначається для 29.97 і 59.94', () => {
  assert.equal(isDropFrameRate(29.97), true);
  assert.equal(isDropFrameRate(59.94), true);
  assert.equal(isDropFrameRate(25), false);
});

test('drop-frame: перші кадри хвилини пропускаються, крім десятої', () => {
  // Класична перевірка: після 00:00:59;29 йде 00:01:00;02, а не ;00
  const before = timecodeToFrames('00:00:59;29', 29.97, true);
  assert.equal(framesToTimecode(before + 1, 29.97, true), '00:01:00;02');
  // А на десятій хвилині пропуску немає.
  const beforeTenth = timecodeToFrames('00:09:59;29', 29.97, true);
  assert.equal(framesToTimecode(beforeTenth + 1, 29.97, true), '00:10:00;00');
});

test('drop-frame: година таймкоду відповідає годині реального часу', () => {
  const frames = timecodeToFrames('01:00:00;00', 29.97, true);
  // За годину реального часу при 29.97 к/с проходить 107 892 кадри.
  assert.equal(frames, 107_892);
});

test('таймкод: тривалість між точками з переходом через опівніч', () => {
  const straight = durationBetween('10:00:00:00', '10:30:00:00', 25);
  assert.equal(straight.timecode, '00:30:00:00');
  const wrapped = durationBetween('23:50:00:00', '00:10:00:00', 25);
  assert.equal(wrapped.timecode, '00:20:00:00');
  assert.equal(wrapped.wrapped, true);
});

test('таймкод: додавання і віднімання', () => {
  assert.equal(addTimecodes('00:10:00:00', '00:05:30:00', 25).timecode, '00:15:30:00');
  assert.equal(addTimecodes('00:10:00:00', '00:05:30:00', 25, { subtract: true }).timecode, '00:04:30:00');
});

test('сонце: схід і захід у Києві влітку', () => {
  // 10 серпня 2026, Київ (50.45 N, 30.52 E): схід 05:39, полудень 13:04,
  // захід 20:29 за київським часом (UTC+3). Звіряємо в UTC, щоб тест не залежав
  // від часового поясу машини, на якій його запускають.
  const times = sunTimes(new Date('2026-08-10T12:00:00Z'), 50.45, 30.52);
  const utcHours = (date) => date.getUTCHours() + date.getUTCMinutes() / 60;
  near(utcHours(times.sunrise), 2.65, 0.1, 'схід (UTC)');
  near(utcHours(times.solarNoon), 10.07, 0.1, 'сонячний полудень (UTC)');
  near(utcHours(times.sunset), 17.48, 0.1, 'захід (UTC)');
});

test('сонце: золота година йде після сходу і перед заходом', () => {
  const windows = shootingWindows(new Date('2026-08-10T12:00:00Z'), 50.45, 30.52);
  assert.ok(windows.morningGolden.minutes > 20, 'ранкова золота година має тривати відчутний час');
  assert.ok(windows.eveningGolden.minutes > 20, 'вечірня золота година так само');
  assert.ok(windows.times.sunrise < windows.times.goldenHourEnd, 'ранкова золота — після сходу');
  assert.ok(windows.times.goldenHourStart < windows.times.sunset, 'вечірня золота — до заходу');
  assert.ok(windows.daylightMinutes > 800, 'у серпні в Києві день довгий');
});

test('сонце: полярна ніч не ламає розрахунок', () => {
  const times = sunTimes(new Date('2026-12-21T12:00:00Z'), 78.2, 15.6); // Шпіцберген
  assert.equal(times.sunrise, null, 'сходу немає — має бути null, а не помилка');
  assert.ok(times.solarNoon instanceof Date, 'полудень рахується завжди');
});

test('дати: YYYY-MM-DD не зсувається через часовий пояс', () => {
  const date = parseDateOnly('2026-08-10');
  assert.equal(date.getDate(), 10);
  assert.equal(date.getMonth(), 7);
  assert.equal(toDateOnly(date), '2026-08-10');
});

test('дати: залишок днів і людський опис', () => {
  const today = toDateOnly(new Date());
  assert.equal(daysUntil(today), 0);
  assert.equal(describeDue(today), 'Сьогодні');
  const yesterday = toDateOnly(new Date(Date.now() - 86_400_000));
  assert.equal(describeDue(yesterday), 'Вчора');
});

test('відмінювання днів', () => {
  assert.equal(plural(1, 'день', 'дні', 'днів'), '1 день');
  assert.equal(plural(3, 'день', 'дні', 'днів'), '3 дні');
  assert.equal(plural(5, 'день', 'дні', 'днів'), '5 днів');
  assert.equal(plural(11, 'день', 'дні', 'днів'), '11 днів');
  assert.equal(plural(21, 'день', 'дні', 'днів'), '21 день');
});

test('сортування задач: спершу з датою, потім за терміновістю', () => {
  const withDate = createTask({ title: 'З датою', due: '2026-01-01' });
  const noDate = createTask({ title: 'Без дати' });
  assert.ok(taskOrder(withDate, noDate) < 0, 'задача з датою йде вище');

  const urgent = createTask({ title: 'Терміново', priority: 'high' });
  const someday = createTask({ title: 'Колись', priority: 'low' });
  assert.ok(taskOrder(urgent, someday) < 0, 'термінова йде вище');
});

test('знімальні дні: проміжок розгортається включно з обома кінцями', () => {
  assert.deepEqual(expandDateRange('2026-08-12', '2026-08-14'), ['2026-08-12', '2026-08-13', '2026-08-14']);
});

test('знімальні дні: без другої дати виходить один день', () => {
  assert.deepEqual(expandDateRange('2026-08-15', ''), ['2026-08-15']);
  assert.deepEqual(expandDateRange('2026-08-15', null), ['2026-08-15']);
});

test('знімальні дні: перевернутий проміжок не дає порожнечі', () => {
  // Користувач вписав «до» раніше за «від» — краще один день, ніж нічого.
  assert.deepEqual(expandDateRange('2026-08-15', '2026-08-10'), ['2026-08-15']);
});

test('знімальні дні: проміжок через межу місяця', () => {
  assert.deepEqual(expandDateRange('2026-08-30', '2026-09-02'),
    ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
});

test('знімальні дні: помилка в році не додає тисячі днів', () => {
  const days = expandDateRange('2026-08-01', '2126-08-01');
  assert.equal(days.length, 90, 'спрацьовує запобіжник');
});

test('знімальні дні: без початкової дати не додається нічого', () => {
  assert.deepEqual(expandDateRange('', '2026-08-14'), []);
  assert.deepEqual(expandDateRange(null, null), []);
});

test('карта: координати й номери тайлів переводяться туди й назад', () => {
  const zoom = 14;
  const tile = lonLatToTile(30.5234, 50.4501, zoom);
  const back = tileToLonLat(tile.x, tile.y, zoom);
  near(back.latitude, 50.4501, 0.0001, 'широта');
  near(back.longitude, 30.5234, 0.0001, 'довгота');
});

test('карта: горизонтальна координата збігається з формулою проєкції', () => {
  // По довготі проєкція лінійна, тож очікуване значення виводиться просто:
  // x = (довгота + 180) / 360 × 2^zoom. Це незалежна перевірка, а не
  // запамʼятоване число.
  const zoom = 10;
  const longitude = 30.5234; // Київ
  const expectedX = ((longitude + 180) / 360) * 2 ** zoom;

  const tile = lonLatToTile(longitude, 50.4501, zoom);
  near(tile.x, expectedX, 1e-9, 'номер тайла по горизонталі');
  assert.equal(Math.floor(tile.x), 598);

  // По вертикалі формула логарифмічна, тому звіряємо через зворотне
  // перетворення: воно має повернути ту саму широту.
  const back = tileToLonLat(tile.x, tile.y, zoom);
  near(back.latitude, 50.4501, 1e-9, 'широта після зворотного перетворення');
});

test('карта: північ дає менший номер тайла, ніж південь', () => {
  // Вісь Y у сітці зростає донизу — переплутаний знак тут найчастіша помилка.
  const north = lonLatToTile(30, 60, 8);
  const south = lonLatToTile(30, 40, 8);
  assert.ok(north.y < south.y, 'північніша точка має бути вище на сітці');
});

test('карта: полюси не ламають проєкцію Меркатора', () => {
  const tile = lonLatToTile(0, 89.9, 5);
  assert.ok(Number.isFinite(tile.y), 'y має лишатися числом');
  assert.ok(tile.y >= 0, 'і не вилітати за межі сітки');
});

test('карта: довгота загортається через 180-й меридіан', () => {
  assert.equal(wrapLongitude(181), -179);
  assert.equal(wrapLongitude(-181), 179);
  assert.equal(wrapLongitude(30), 30);
});

test('карта: масштаб обмежений розумними межами', () => {
  assert.equal(clampZoom(0), 2);
  assert.equal(clampZoom(99), 18);
  assert.equal(clampZoom(14), 14);
});

test('карта: адреса тайла складається правильно, а за межами сітки її немає', () => {
  assert.equal(tileUrl(599, 351, 10), 'https://tile.openstreetmap.org/10/599/351.png');
  // По вертикалі світ не замкнений — таких тайлів не існує.
  assert.equal(tileUrl(0, -1, 10), null);
  // А по горизонталі замкнений: тайл «за краєм» — це тайл з іншого боку.
  assert.equal(tileUrl(-1, 5, 3), 'https://tile.openstreetmap.org/3/7/5.png');
});

test('координати: розбираються у звичних форматах вставки', () => {
  assert.deepEqual(parseCoordinates('50.4501, 30.5234'), { latitude: 50.4501, longitude: 30.5234 });
  assert.deepEqual(parseCoordinates('50.4501 30.5234'), { latitude: 50.4501, longitude: 30.5234 });
  assert.deepEqual(parseCoordinates(' -33.8688;151.2093 '), { latitude: -33.8688, longitude: 151.2093 });
});

test('координати: сміття й неможливі значення відкидаються', () => {
  assert.equal(parseCoordinates('десь у Києві'), null);
  assert.equal(parseCoordinates('91, 30'), null, 'широта понад 90 неможлива');
  assert.equal(parseCoordinates('50, 181'), null, 'довгота понад 180 неможлива');
  assert.equal(parseCoordinates(''), null);
});

test('карти: посилання відкриває точку, а без точки — пошук за адресою', () => {
  const withPoint = mapsLink({ latitude: 50.4501, longitude: 30.5234, label: 'Павільйон' });
  // Шість знаків після коми — фіксований формат, щоб у посилання не потрапляв
  // хвіст похибки обчислень на кшталт 49.83748576369466.
  assert.ok(withPoint.includes('ll=50.450100,30.523400'), 'координати в посиланні');
  assert.ok(withPoint.includes('maps.apple.com'), 'відкриваються нативні Карти');

  const messy = mapsLink({ latitude: 49.83748576369466, longitude: 24.036566455078173, label: '' });
  assert.ok(messy.includes('ll=49.837486,24.036566'), 'довгий хвіст обрізається');

  const withoutPoint = mapsLink({ latitude: null, longitude: null, label: 'Київ, вул. Хрещатик 1' });
  assert.ok(withoutPoint.includes('q=') && !withoutPoint.includes('ll='), 'лишається тільки пошук');

  assert.equal(mapsLink({ latitude: null, longitude: null, label: '' }), null, 'нічого шукати — немає посилання');
});

test('проєкт: тип зйомки зберігається, зіпсовані координати відкидаються', () => {
  const project = createProject({
    title: 'Кліп', style: 'Музичний кліп',
    latitude: 50.4501, longitude: 30.5234,
  });
  assert.equal(project.style, 'Музичний кліп');
  assert.equal(project.latitude, 50.4501);

  const broken = createProject({ title: 'Кліп', latitude: 999, longitude: 'схід' });
  assert.equal(broken.latitude, null, 'широта поза межами стає null');
  assert.equal(broken.longitude, null, 'текст замість довготи стає null');
});

test('валюта: знак стоїть там, де його очікують у кожній валюті', () => {
  assert.equal(formatMoney(48000, 'UAH'), '48 000 ₴');
  assert.equal(formatMoney(48000, 'PLN'), '48 000 zł');
  assert.equal(formatMoney(48000, 'USD'), '$48 000');
  assert.equal(formatMoney(48000, 'EUR'), '€48 000');
});

test('валюта: копійки показуються лише коли вони є, і завжди двома знаками', () => {
  assert.equal(formatMoney(1500, 'UAH'), '1 500 ₴');
  // Половина гривні — це «50 копійок», а не «5»: для грошей дробова частина
  // завжди двозначна, інакше суму читають неправильно.
  assert.equal(formatMoney(1500.5, 'UAH'), '1 500,50 ₴');
  assert.equal(formatMoney(1500.25, 'UAH'), '1 500,25 ₴');
  assert.equal(formatMoney(0, 'UAH'), '0 ₴');
});

test('валюта: розряди відокремлені звичайним пробілом, а не нерозривним', () => {
  const formatted = formatMoney(1234567, 'UAH');
  assert.ok(!/[  ]/.test(formatted), 'нерозривних пробілів бути не має');
  assert.equal(formatted, '1 234 567 ₴');
});

test('валюта: невідомий код не ламає показ, а відкочується на гривню', () => {
  assert.equal(formatMoney(100, 'BTC'), '100 ₴');
  assert.equal(getCurrency('вигадка').code, 'UAH');
  assert.equal(currencySymbol('PLN'), 'zł');
});

test('валюта: нечислове значення дає порожній рядок, а не «NaN ₴»', () => {
  assert.equal(formatMoney(null, 'UAH'), '');
  assert.equal(formatMoney(undefined, 'UAH'), '');
  assert.equal(formatMoney(Number.NaN, 'UAH'), '');
});

test('валюти: усі чотири на місці й мають знак', () => {
  assert.deepEqual(CURRENCIES.map((currency) => currency.code), ['UAH', 'PLN', 'USD', 'EUR']);
  for (const currency of CURRENCIES) {
    assert.ok(currency.symbol.length > 0, `${currency.code} без знаку`);
    assert.ok(['prefix', 'suffix'].includes(currency.position), `${currency.code} без позиції знаку`);
  }
});

test('мови: українська готова, польська поки позначена як неготова', () => {
  assert.equal(getLanguage('uk').ready, true);
  assert.equal(getLanguage('pl').ready, false);
  // Невідома мова не має ламати застосунок.
  assert.equal(getLanguage('вигадка').id, 'uk');
  assert.deepEqual(LANGUAGES.map((language) => language.id), ['uk', 'pl']);
});

// --- Кошториси ------------------------------------------------------------

/** Типовий кошторис знімального дня: дві камери на дві зміни плюс оператор. */
function sampleEstimate(overrides = {}) {
  return createEstimate({
    title: 'Рекламний ролик',
    currency: 'UAH',
    items: [
      // 2 камери × 2 зміни × 3000, собівартість 1000 (орендую в рентала)
      createItem({ title: 'Sony FX6', category: 'equipment', quantity: 2, shifts: 2, unitPrice: 3000, unitCost: 1000 }),
      // 1 оператор × 2 зміни × 8000, собівартість 0 (це я)
      createItem({ title: 'Оператор', category: 'crew', quantity: 1, shifts: 2, unitPrice: 8000, unitCost: 0 }),
    ],
    ...overrides,
  });
}

test('кошторис: сума позиції — кількість × зміни × ціна', () => {
  const item = createItem({ quantity: 2, shifts: 3, unitPrice: 1500 });
  assert.equal(itemAmount(item), 9000);
});

test('кошторис: підсумок складається з позицій', () => {
  const totals = estimateTotals(sampleEstimate());
  // 2×2×3000 = 12 000, плюс 1×2×8000 = 16 000
  assert.equal(totals.subtotal, 28000);
  assert.equal(totals.total, 28000, 'без знижки й податку підсумок дорівнює сумі');
});

test('кошторис: собівартість і маржа рахуються окремо від ціни', () => {
  const totals = estimateTotals(sampleEstimate());
  assert.equal(totals.cost, 4000, 'оренда камер: 2×2×1000');
  assert.equal(totals.margin, 24000);
  assert.equal(totals.marginPercent, 85.71);
});

test('кошторис: знижка зменшує суму до нарахування податку', () => {
  const totals = estimateTotals(sampleEstimate({ discountPercent: 10 }));
  assert.equal(totals.discount, 2800);
  assert.equal(totals.afterDiscount, 25200);
  assert.equal(totals.total, 25200);
});

test('кошторис: податок нараховується на суму після знижки', () => {
  const totals = estimateTotals(sampleEstimate({ discountPercent: 10, taxPercent: 23 }));
  assert.equal(totals.afterDiscount, 25200);
  assert.equal(totals.tax, 5796, '23 % від 25 200');
  assert.equal(totals.total, 30996);
});

test('кошторис: податок не потрапляє в маржу', () => {
  // ПДВ — не твої гроші, ти лише передаєш їх далі. Якби він рахувався
  // в маржу, прибуток на папері виглядав би більшим, ніж є насправді.
  const withoutTax = estimateTotals(sampleEstimate());
  const withTax = estimateTotals(sampleEstimate({ taxPercent: 23 }));
  assert.equal(withTax.margin, withoutTax.margin);
  assert.ok(withTax.total > withoutTax.total, 'а на підсумок податок впливає');
});

test('кошторис: знижка маржу зменшує — вона йде з твоєї кишені', () => {
  const plain = estimateTotals(sampleEstimate());
  const discounted = estimateTotals(sampleEstimate({ discountPercent: 20 }));
  assert.ok(discounted.margin < plain.margin);
  assert.equal(discounted.margin, 18400, '22 400 після знижки мінус 4 000 собівартості');
});

test('кошторис: безглузді відсотки не ламають підсумок', () => {
  assert.equal(estimateTotals(sampleEstimate({ discountPercent: 300 })).discount, 28000, 'більше 100 % не буває');
  assert.equal(estimateTotals(sampleEstimate({ discountPercent: -50 })).discount, 0, 'відʼємної знижки не буває');
});

test('кошторис: порожній кошторис дає нулі, а не помилку', () => {
  const totals = estimateTotals(createEstimate({ title: 'Порожній' }));
  assert.equal(totals.subtotal, 0);
  assert.equal(totals.total, 0);
  assert.equal(totals.marginPercent, 0, 'ділення на нуль не відбувається');
});

test('кошторис: суми округлюються до копійок і сходяться з рядками', () => {
  const estimate = createEstimate({
    items: [
      createItem({ title: 'А', quantity: 3, shifts: 1, unitPrice: 33.33 }),
      createItem({ title: 'Б', quantity: 1, shifts: 1, unitPrice: 0.01 }),
    ],
  });
  const totals = estimateTotals(estimate);
  assert.equal(totals.subtotal, 100, '99.99 + 0.01');
});

test('кошторис: позиції групуються за розділами в потрібному порядку', () => {
  const groups = totalsByCategory(sampleEstimate());
  assert.deepEqual(groups.map((group) => group.label), ['Техніка', 'Команда']);
  assert.equal(groups[0].amount, 12000);
  assert.equal(groups[1].amount, 16000);
});

test('клієнтський вигляд не містить жодного сліду собівартості', () => {
  const view = clientView(sampleEstimate({ notes: 'Домовився з ренталом за пів ціни' }));
  const serialized = JSON.stringify(view);

  assert.ok(!serialized.includes('unitCost'), 'собівартості немає');
  assert.ok(!serialized.includes('margin'), 'маржі немає');
  assert.ok(!serialized.includes('1000'), 'ціни рентала немає навіть числом');
  assert.ok(!serialized.includes('Домовився'), 'внутрішня нотатка не витікає');

  assert.equal(view.total, 28000, 'а підсумок для клієнта на місці');
  assert.equal(view.groups.length, 2);
});

// --- Гонорари команди ------------------------------------------------------

test('команда: позиція з каталогу бере гонорар у собівартість', () => {
  const operator = createCrew({ name: 'Андрій', role: 'Оператор камери', fee: 4000, rate: 6000 });
  const item = itemFromCrew(operator, { shifts: 2, clientRate: clientRate(operator) });

  assert.equal(item.category, 'crew');
  assert.equal(item.crewId, operator.id);
  assert.equal(item.unitCost, 4000, 'гонорар людини — це твоя витрата');
  assert.equal(item.unitPrice, 6000, 'а клієнту виставляєш свою ставку');
  assert.equal(itemAmount(item), 12000);
  assert.equal(itemCost(item), 8000);
});

test('команда: без окремої ставки клієнту гонорар передається без націнки', () => {
  const editor = createCrew({ name: 'Оля', role: 'Монтажер', fee: 5000 });
  assert.equal(clientRate(editor), 5000);
  assert.equal(crewMargin(editor), 0);
});

test('команда: підпис — імʼя з роллю, або сама роль, якщо людина ще не знайдена', () => {
  assert.equal(crewLabel(createCrew({ name: 'Андрій', role: 'Оператор' })), 'Андрій — Оператор');
  assert.equal(crewLabel(createCrew({ role: 'Режисер трансляції (пульт)' })), 'Режисер трансляції (пульт)');
});

test('позиція «тільки для мене» не потрапляє в рахунок, але входить у витрати', () => {
  const estimate = createEstimate({
    title: 'Трансляція',
    items: [
      createItem({ title: 'Знімальна зміна', category: 'crew', unitPrice: 20000, unitCost: 0 }),
      // Монтажера найняв, але клієнту окремим рядком не показуєш
      createItem({ title: 'Монтажер', category: 'crew', unitPrice: 0, unitCost: 6000, internalOnly: true }),
    ],
  });

  const totals = estimateTotals(estimate);
  assert.equal(totals.subtotal, 20000, 'клієнт бачить лише зміну');
  assert.equal(totals.cost, 6000, 'а монтажера ти все одно оплачуєш');
  assert.equal(totals.margin, 14000);
});

test('прихована позиція не витікає в клієнтський вигляд', () => {
  const estimate = createEstimate({
    items: [
      createItem({ title: 'Знімальна зміна', category: 'crew', unitPrice: 20000 }),
      createItem({ title: 'Монтажер Оля', category: 'crew', unitCost: 6000, internalOnly: true }),
    ],
  });

  const serialized = JSON.stringify(clientView(estimate));
  assert.ok(!serialized.includes('Монтажер'), 'прихованої позиції в рахунку немає');
  assert.ok(serialized.includes('Знімальна зміна'), 'звичайна на місці');

  const text = estimateToText(estimate, formatMoney);
  assert.ok(!text.includes('Монтажер'), 'і в тексті для месенджера теж немає');
});

test('гонорари кошторису: хто скільки має отримати', () => {
  const estimate = createEstimate({
    items: [
      createItem({ title: 'Оператор Андрій', category: 'crew', crewId: 'crw_1', shifts: 2, unitPrice: 6000, unitCost: 4000 }),
      createItem({ title: 'Монтажер Оля', category: 'crew', crewId: 'crw_2', unitCost: 6000, internalOnly: true }),
      createItem({ title: 'Sony FX6', category: 'equipment', unitPrice: 3000, unitCost: 1000 }),
    ],
  });

  const payouts = crewPayouts(estimate);
  assert.equal(payouts.length, 2, 'техніка у виплатах не рахується');
  assert.equal(payouts[0].payout, 8000, '2 зміни по 4 000');
  assert.equal(payouts[0].billed, 12000);
  assert.equal(payouts[1].payout, 6000);
  assert.equal(payouts[1].billed, 0, 'прихована позиція клієнту не виставлена');
});

test('гонорари проєкту зводяться з усіх його кошторисів', () => {
  const state = {
    settings: { currency: 'UAH' },
    estimates: [
      createEstimate({
        projectId: 'prj_1', currency: 'UAH', createdAt: '2026-08-01T10:00:00.000Z',
        items: [createItem({ title: 'Оператор Андрій', category: 'crew', crewId: 'crw_1', shifts: 2, unitCost: 4000 })],
      }),
      createEstimate({
        projectId: 'prj_1', currency: 'UAH',
        items: [
          // Той самий оператор у другому кошторисі — має злитися в один рядок
          createItem({ title: 'Оператор Андрій', category: 'crew', crewId: 'crw_1', unitCost: 4000 }),
          createItem({ title: 'Монтажер Оля', category: 'crew', crewId: 'crw_2', unitCost: 6000 }),
        ],
      }),
      // Чужий проєкт до підсумку потрапити не має
      createEstimate({
        projectId: 'prj_2', currency: 'UAH',
        items: [createItem({ title: 'Хтось інший', category: 'crew', unitCost: 99000 })],
      }),
    ],
  };

  const payouts = projectPayouts(state, 'prj_1');
  assert.equal(payouts.total, 18000, '8 000 + 4 000 + 6 000');
  assert.equal(payouts.people.length, 2, 'одна людина — один рядок');

  const andriy = payouts.people.find((person) => person.crewId === 'crw_1');
  assert.equal(andriy.payout, 12000, 'обидва кошториси разом');
  assert.equal(andriy.lines.length, 2);

  // Найбільша виплата йде першою — так видно головну статтю витрат
  assert.equal(payouts.people[0].crewId, 'crw_1');
});

test('гонорари проєкту без кошторисів — нуль, а не помилка', () => {
  const payouts = projectPayouts({ settings: { currency: 'UAH' }, estimates: [] }, 'prj_1');
  assert.equal(payouts.total, 0);
  assert.deepEqual(payouts.people, []);
});

// --- Заробіток -------------------------------------------------------------

test('витрати розкладаються на оренду, гонорари та решту', () => {
  const estimate = createEstimate({
    items: [
      createItem({ title: 'Камера', category: 'equipment', unitPrice: 10000, unitCost: 3000 }),
      createItem({ title: 'Світло', category: 'equipment', unitPrice: 4000, unitCost: 1500 }),
      createItem({ title: 'Оператор', category: 'crew', unitPrice: 8000, unitCost: 5000 }),
      createItem({ title: 'Таксі', category: 'logistics', unitPrice: 1000, unitCost: 800 }),
    ],
  });

  const costs = costByPurpose(estimate);
  assert.equal(costs.rental, 4500, 'оренда: 3 000 + 1 500');
  assert.equal(costs.payouts, 5000);
  assert.equal(costs.other, 800);
  assert.equal(costs.total, 10300);
  assert.equal(costs.total, estimateTotals(estimate).cost, 'розклад має сходитися із загальною собівартістю');
});

/** Проєкт із двома кошторисами: погодженим і чернеткою-варіантом. */
function financeState() {
  return {
    settings: { currency: 'UAH' },
    projects: [{ id: 'p1', title: 'Концерт', fee: null }],
    estimates: [
      createEstimate({
        projectId: 'p1', status: 'approved', currency: 'UAH', taxPercent: 20,
        items: [
          createItem({ title: 'Камера', category: 'equipment', unitPrice: 10000, unitCost: 3000 }),
          createItem({ title: 'Оператор', category: 'crew', unitPrice: 8000, unitCost: 5000 }),
        ],
      }),
      createEstimate({
        projectId: 'p1', status: 'draft', currency: 'UAH',
        items: [createItem({ title: 'Дорожчий варіант', category: 'equipment', unitPrice: 99000, unitCost: 50000 })],
      }),
    ],
  };
}

test('заробіток: від суми клієнта віднімаються всі витрати', () => {
  const finance = projectFinance(financeState(), 'p1');
  assert.equal(finance.income, 18000);
  assert.equal(finance.rental, 3000);
  assert.equal(finance.payouts, 5000);
  assert.equal(finance.expenses, 8000);
  assert.equal(finance.profit, 10000);
  assert.equal(finance.marginPercent, 55.56);
});

test('заробіток рахується за найпізнішою стадією, а не сумою всіх варіантів', () => {
  // Дві чернетки поруч — це два варіанти ціни, а не подвійний дохід.
  const finance = projectFinance(financeState(), 'p1');
  assert.equal(finance.basis, 'approved', 'погоджений важить більше за чернетку');
  assert.equal(finance.estimateCount, 1);
  assert.ok(!finance.basisLabel.includes('чернет'), 'підпис має пояснювати, звідки цифра');

  // Приберемо погоджений — тоді рахуватись має чернетка.
  const state = financeState();
  state.estimates = state.estimates.filter((estimate) => estimate.status !== 'approved');
  const draftOnly = projectFinance(state, 'p1');
  assert.equal(draftOnly.basis, 'draft');
  assert.equal(draftOnly.income, 99000);
});

test('заробіток: податок не рахується доходом', () => {
  // ПДВ проходить крізь тебе — у кишені він не лишається.
  const finance = projectFinance(financeState(), 'p1');
  const estimate = financeState().estimates[0];
  assert.equal(estimateTotals(estimate).total, 21600, 'клієнт платить із податком');
  assert.equal(finance.income, 18000, 'а доходом рахується сума без нього');
});

test('заробіток: відхилений кошторис не враховується', () => {
  const state = financeState();
  state.estimates = state.estimates.map((estimate) =>
    estimate.status === 'approved' ? { ...estimate, status: 'declined' } : estimate);

  const finance = projectFinance(state, 'p1');
  assert.equal(finance.basis, 'draft', 'відхилений випадає, лишається чернетка');
  assert.equal(finance.income, 99000);
});

test('заробіток: без кошторисів береться гонорар із самого проєкту', () => {
  const state = { settings: { currency: 'UAH' }, projects: [{ id: 'p1', fee: 30000 }], estimates: [] };
  const finance = projectFinance(state, 'p1');
  assert.equal(finance.income, 30000);
  assert.equal(finance.profit, 30000, 'витрат немає — заробіток дорівнює гонорару');
  assert.equal(finance.basisLabel, 'за гонораром проєкту');
});

test('заробіток: витрати більші за дохід дають збиток, а не нуль', () => {
  const state = {
    settings: { currency: 'UAH' },
    projects: [{ id: 'p1', fee: null }],
    estimates: [createEstimate({
      projectId: 'p1', status: 'approved', currency: 'UAH',
      items: [
        createItem({ title: 'Зміна', category: 'crew', unitPrice: 6000, unitCost: 6000 }),
        // Монтажера найняв, але клієнту не виставив
        createItem({ title: 'Монтажер', category: 'crew', unitCost: 4000, internalOnly: true }),
      ],
    })],
  };

  const finance = projectFinance(state, 'p1');
  assert.equal(finance.income, 6000);
  assert.equal(finance.payouts, 10000);
  assert.equal(finance.profit, -4000, 'збиток показується як є');
});

test('кількість позиції відмінюється правильно й без зайвого «1 ×»', () => {
  const one = createItem({ quantity: 1, shifts: 1, unit: 'зміна' });
  assert.equal(describeItemCount(one), '1 зміна', 'рядок «1 × 1 зміна» читався б як помилка');

  assert.equal(describeItemCount(createItem({ quantity: 1, shifts: 3, unit: 'зміна' })), '3 зміни');
  assert.equal(describeItemCount(createItem({ quantity: 1, shifts: 5, unit: 'зміна' })), '5 змін');
  assert.equal(describeItemCount(createItem({ quantity: 2, shifts: 2, unit: 'зміна' })), '2 × 2 зміни');
  assert.equal(describeItemCount(createItem({ quantity: 1, shifts: 11, unit: 'день' })), '11 днів');
  assert.equal(describeItemCount(createItem({ quantity: 1, shifts: 21, unit: 'день' })), '21 день');
  assert.equal(describeItemCount(createItem({ quantity: 1, shifts: 2, unit: 'година' })), '2 години');
});

test('кількість штучних позицій не плутається зі змінами', () => {
  // Для «шт» час не має сенсу: рахується кількість, а не тривалість.
  assert.equal(describeItemCount(createItem({ quantity: 3, shifts: 1, unit: 'шт' })), '3 шт');
  assert.equal(describeItemCount(createItem({ quantity: 120, shifts: 1, unit: 'км' })), '120 км');
  assert.equal(describeItemCount(createItem({ quantity: 2, shifts: 1, unit: 'послуга' })), '2 послуги');
});

test('текст для клієнта містить підсумок і не містить собівартості', () => {
  const text = estimateToText(
    sampleEstimate({ clientNotes: 'Ціна включає трансфер по місту.', discountPercent: 10 }),
    formatMoney,
  );

  assert.ok(text.includes('РЕКЛАМНИЙ РОЛИК'), 'назва вгорі');
  assert.ok(text.includes('Техніка') && text.includes('Команда'), 'розділи на місці');
  assert.ok(text.includes('Sony FX6: 2 × 2 зміни'), 'кількість і зміни видно');
  assert.ok(text.includes('Знижка: −2 800 ₴'), 'знижка показана');
  assert.ok(text.includes('РАЗОМ: 25 200 ₴'), 'підсумок правильний');
  assert.ok(text.includes('трансфер'), 'нотатка для клієнта на місці');
  assert.ok(!text.includes('1 000'), 'ціна рентала в текст не потрапляє');
});

test('позиція з каталогу техніки бере обидві ціни', () => {
  const camera = createEquipment({ title: 'Sony FX6', category: 'camera', dayRate: 3000, dayCost: 1000 });
  const item = itemFromEquipment(camera, { quantity: 2, shifts: 3 });

  assert.equal(item.title, 'Sony FX6');
  assert.equal(item.unitPrice, 3000);
  assert.equal(item.unitCost, 1000, 'собівартість переноситься теж');
  assert.equal(item.equipmentId, camera.id, 'звʼязок із каталогом зберігається');
  assert.equal(itemAmount(item), 18000);
});

test('техніка: відʼємні ціни відкидаються, маржа рахується', () => {
  const item = createEquipment({ title: 'Слайдер', dayRate: 800, dayCost: 300 });
  assert.equal(unitMargin(item), 500);

  const broken = createEquipment({ title: 'Дрон', dayRate: -100, dayCost: 'дорого' });
  assert.equal(broken.dayRate, null);
  assert.equal(broken.dayCost, null);
  assert.equal(unitMargin(broken), 0, 'без цін маржа нульова, а не NaN');
});

test('моделі: сміттєві дані не ламають створення запису', () => {
  const project = createProject({ title: '  Кліп  ', status: 'вигадка', deadline: 'не дата', fee: 'багато' });
  assert.equal(project.title, 'Кліп', 'назва обрізається');
  assert.equal(project.status, 'lead', 'невідомий статус замінюється на типовий');
  assert.equal(project.deadline, null, 'некоректна дата стає null');
  assert.equal(project.fee, null, 'нечислова сума стає null');
});

test('фірма: коротке імʼя виходить читабельним і латиницею', () => {
  assert.equal(makeSlug('DreamCut Film'), 'dreamcut-film');
  assert.equal(makeSlug('Студія «Веста»'), 'studiia-vesta', 'кирилиця транслітерується');
  assert.equal(makeSlug('  ---Кіно---  '), 'kino', 'дефіси по краях прибираються');
  assert.equal(makeSlug('А'.repeat(60)).length, 40, 'довжина обмежена');

  assert.ok(isValidSlug('dreamcut-film'));
  assert.ok(!isValidSlug('Дрім'), 'кирилиця в адресі неприйнятна');
  assert.ok(!isValidSlug('a'), 'одна літера — замало');
  assert.ok(!isValidSlug('dream cut'), 'пробіли неприйнятні');
});

test('запрошення: код без символів, які плутають', () => {
  const code = generateCode();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(!/[O0I1]/.test(code), 'нуль і одиниця з літерами не плутаються');

  const codes = new Set(Array.from({ length: 200 }, () => generateCode()));
  assert.equal(codes.size, 200, 'коди не повторюються');
});

test('ролі: керувати можуть лише директор і адміністратор', () => {
  assert.ok(canManage('owner'));
  assert.ok(canManage('admin'));
  assert.ok(!canManage('member'), 'команда людей не додає');
  assert.ok(!canManage('вигадка'));
  assert.equal(roleLabel('member'), 'Команда');
  assert.equal(roleLabel('невідомо'), 'невідомо', 'невідому роль показуємо як є, а не ховаємо');
});

test('публікація: у фірму летить те саме, що в проєкті', () => {
  const crew = [
    createCrew({ name: 'Петро', role: 'Оператор', fee: 4000, rate: 6000 }),
    createCrew({ name: 'Оля', role: 'Монтажерка', fee: 3000 }),
  ];
  crew[0].email = 'PETRO@Example.com ';
  const normalized = normalizeCrew(crew[0]);

  const project = createProject({
    title: 'Концерт', client: 'Філармонія', status: 'shoot',
    deadline: '2026-09-01', shootDays: ['2026-08-29', '2026-08-28'], location: 'Львів',
  });

  const estimate = createEstimate({
    projectId: project.id, currency: 'UAH', status: 'approved',
    items: [
      createItem({ title: 'Камера', category: 'equipment', quantity: 2, shifts: 2, unitPrice: 3000, unitCost: 1500 }),
      itemFromCrew(crew[0], { shifts: 2 }),
      itemFromCrew(crew[1], { shifts: 1 }),
    ],
  });

  const state = {
    projects: [project], tasks: [], ideas: [], crew, equipment: [],
    estimates: [estimate], settings: { currency: 'UAH' },
  };

  const payload = buildProjectPayload(state, project.id);

  assert.equal(payload.project.local_id, project.id);
  assert.equal(payload.project.title, 'Концерт');
  assert.deepEqual(payload.project.shoot_days, ['2026-08-29', '2026-08-28']);
  assert.equal(payload.project.rental_cost, 6000, 'оренда: 2 камери × 2 зміни × 1500');
  assert.equal(payload.project.payout_total, 11000, 'гонорари: 4000×2 + 3000');
  assert.equal(payload.project.fee, estimateTotals(estimate).afterDiscount, 'сума клієнта — з кошторису');

  assert.equal(payload.project.notes, null, 'внутрішні нотатки назовні не йдуть');

  const petro = payload.payouts.find((entry) => entry.name === 'Петро');
  assert.equal(petro.amount, 8000);
  assert.equal(petro.role_title, 'Оператор');
  assert.equal(normalized.email, 'petro@example.com', 'пошта зводиться до нижнього регістру');
});

test('публікація: людину без пошти видно заздалегідь', () => {
  const withMail = createCrew({ name: 'Петро', role: 'Оператор', fee: 4000, email: 'petro@example.com' });
  const without = createCrew({ name: 'Оля', role: 'Монтажерка', fee: 3000 });
  const project = createProject({ title: 'Кліп' });
  const estimate = createEstimate({
    projectId: project.id,
    items: [itemFromCrew(withMail, {}), itemFromCrew(without, {})],
  });

  const state = {
    projects: [project], tasks: [], ideas: [], crew: [withMail, without],
    equipment: [], estimates: [estimate], settings: { currency: 'UAH' },
  };

  const unlinked = unlinkedPayouts(buildProjectPayload(state, project.id));
  assert.deepEqual(unlinked, ['Оля'], 'попереджаємо саме про того, хто не побачить гонорар');
});

test('спільний проєкт: заробіток рахується лише коли всі числа видно', () => {
  const director = {
    fee: 60000, rental: 12000, other: 3000, payoutTotal: 13000, myPayout: 0,
  };
  assert.equal(sharedProfit(director), 32000);

  // Рядовому учаснику сума клієнта не приходить зовсім — і заробіток
  // не має «дорахуватися» з нулів, бо вийшов би збиток на порожньому місці.
  const member = { fee: null, rental: 12000, other: 3000, payoutTotal: null, myPayout: 8000 };
  assert.equal(sharedProfit(member), null);
});
