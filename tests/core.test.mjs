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
import { taskOrder } from '../src/core/selectors.js';
import { createTask, createProject } from '../src/core/models.js';
import { formatMoney, currencySymbol, getCurrency, getLanguage, CURRENCIES, LANGUAGES } from '../src/core/locale.js';

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

test('моделі: сміттєві дані не ламають створення запису', () => {
  const project = createProject({ title: '  Кліп  ', status: 'вигадка', deadline: 'не дата', fee: 'багато' });
  assert.equal(project.title, 'Кліп', 'назва обрізається');
  assert.equal(project.status, 'lead', 'невідомий статус замінюється на типовий');
  assert.equal(project.deadline, null, 'некоректна дата стає null');
  assert.equal(project.fee, null, 'нечислова сума стає null');
});
