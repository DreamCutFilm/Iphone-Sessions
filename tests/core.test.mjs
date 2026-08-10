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
import { daysUntil, describeDue, parseDateOnly, toDateOnly, plural } from '../src/core/dates.js';
import { taskOrder } from '../src/core/selectors.js';
import { createTask, createProject } from '../src/core/models.js';

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

test('моделі: сміттєві дані не ламають створення запису', () => {
  const project = createProject({ title: '  Кліп  ', status: 'вигадка', deadline: 'не дата', fee: 'багато' });
  assert.equal(project.title, 'Кліп', 'назва обрізається');
  assert.equal(project.status, 'lead', 'невідомий статус замінюється на типовий');
  assert.equal(project.deadline, null, 'некоректна дата стає null');
  assert.equal(project.fee, null, 'нечислова сума стає null');
});
