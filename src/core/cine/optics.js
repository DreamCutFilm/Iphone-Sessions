// Оптика: глибина різкості, гіперфокал, кут огляду, покриття кадру.
//
// Усі відстані в розрахунках зводяться до міліметрів, а назовні повертаються
// в метрах — так, як їх називають на майданчику.

import { getSensor, sensorDiagonal } from './sensors.js';
import { t } from '../i18n.js';

/**
 * Гіперфокальна відстань (мм).
 * H = f²/(N·c) + f — за нею все від H/2 до нескінченності виглядає різким.
 */
export function hyperfocalMm(focalMm, aperture, coc) {
  if (!(focalMm > 0) || !(aperture > 0) || !(coc > 0)) return null;
  return (focalMm * focalMm) / (aperture * coc) + focalMm;
}

/**
 * Глибина різкості для наведення на distanceM метрів.
 * Повертає межі в метрах; far = Infinity, якщо фокус за гіперфокалом.
 */
export function depthOfField({ focalMm, aperture, sensorId, distanceM }) {
  const sensor = getSensor(sensorId);
  const coc = sensor.coc;
  const focal = Number(focalMm);
  const stop = Number(aperture);
  const distance = Number(distanceM) * 1000; // м → мм

  if (!(focal > 0) || !(stop > 0) || !(distance > 0)) return null;

  const hyperfocal = hyperfocalMm(focal, stop, coc);

  const nearMm = (distance * (hyperfocal - focal)) / (hyperfocal + distance - 2 * focal);
  const beyondHyperfocal = distance >= hyperfocal;
  const farMm = beyondHyperfocal
    ? Infinity
    : (distance * (hyperfocal - focal)) / (hyperfocal - distance);

  const near = nearMm / 1000;
  const far = beyondHyperfocal ? Infinity : farMm / 1000;

  return {
    near,
    far,
    total: beyondHyperfocal ? Infinity : far - near,
    // Скільки різкості перед точкою фокуса і скільки за нею — на це спирається
    // фокус-пулер, коли вирішує, куди «садити» брак.
    inFront: distance / 1000 - near,
    behind: beyondHyperfocal ? Infinity : far - distance / 1000,
    hyperfocal: hyperfocal / 1000,
    coc,
    sensor,
  };
}

/** Кути огляду в градусах для заданого фокусного. */
export function fieldOfView({ focalMm, sensorId }) {
  const sensor = getSensor(sensorId);
  const focal = Number(focalMm);
  if (!(focal > 0)) return null;

  const angle = (size) => 2 * Math.atan(size / (2 * focal)) * (180 / Math.PI);

  return {
    horizontal: angle(sensor.width),
    vertical: angle(sensor.height),
    diagonal: angle(sensorDiagonal(sensor)),
    sensor,
  };
}

/** Який шматок простору поміститься в кадр на відстані distanceM. */
export function coverageAtDistance({ focalMm, sensorId, distanceM }) {
  const sensor = getSensor(sensorId);
  const focal = Number(focalMm);
  const distance = Number(distanceM);
  if (!(focal > 0) || !(distance > 0)) return null;

  return {
    width: (sensor.width * distance) / focal,
    height: (sensor.height * distance) / focal,
    sensor,
  };
}

/**
 * Яке фокусне потрібне, щоб на відстані distanceM у кадр вліз обʼєкт
 * шириною subjectWidthM. Рахує «назад» від потрібної крупності.
 */
export function focalForFraming({ sensorId, distanceM, subjectWidthM }) {
  const sensor = getSensor(sensorId);
  const distance = Number(distanceM);
  const subject = Number(subjectWidthM);
  if (!(distance > 0) || !(subject > 0)) return null;
  return (sensor.width * distance) / subject;
}

/** Еквівалент фокусного на повному кадрі — щоб порівнювати з фотографічною звичкою. */
export function fullFrameEquivalent({ focalMm, sensorId }) {
  const sensor = getSensor(sensorId);
  const fullFrame = getSensor('ff');
  const focal = Number(focalMm);
  if (!(focal > 0)) return null;
  return (focal * sensorDiagonal(fullFrame)) / sensorDiagonal(sensor);
}

/** Акуратний запис відстані: 0.85 м, 3.2 м, 12 м, ∞. */
export function formatDistance(meters) {
  if (meters === Infinity) return '∞';
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1) return `${(meters * 100).toFixed(0)} ${t('см')}`;
  if (meters < 10) return `${meters.toFixed(2)} ${t('м')}`;
  if (meters < 100) return `${meters.toFixed(1)} ${t('м')}`;
  return `${Math.round(meters)} ${t('м')}`;
}
