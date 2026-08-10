// Експозиція: кут затвора, витримка, ND-фільтри, перерахунок стопів.

/** Класичне «правило 180°»: витримка = 1/(2 × fps). */
export function shutterSpeedFromAngle({ angle, fps }) {
  const deg = Number(angle);
  const rate = Number(fps);
  if (!(deg > 0) || !(rate > 0)) return null;
  const seconds = deg / (360 * rate);
  return { seconds, denominator: 1 / seconds };
}

/** Зворотний хід: яким має бути кут затвора, щоб отримати задану витримку. */
export function angleFromShutterSpeed({ denominator, fps }) {
  const denom = Number(denominator);
  const rate = Number(fps);
  if (!(denom > 0) || !(rate > 0)) return null;
  return (360 * rate) / denom;
}

/** Витримка у звичному вигляді: 1/50. */
export function formatShutter(seconds) {
  if (!(seconds > 0)) return '—';
  const denominator = 1 / seconds;
  const rounded = denominator >= 10 ? Math.round(denominator) : Number(denominator.toFixed(1));
  return `1/${rounded}`;
}

/**
 * Зміна швидкості при рампі кадрової частоти.
 * Знято 100 к/с, проєкт 25 к/с → 25 % швидкості, тобто вповільнення в 4 рази.
 */
export function speedRamp({ captureFps, projectFps }) {
  const capture = Number(captureFps);
  const project = Number(projectFps);
  if (!(capture > 0) || !(project > 0)) return null;
  const factor = project / capture;
  return {
    factor,
    percent: factor * 100,
    slowdown: capture / project,
    // Скільки екранного часу вийде з однієї хвилини зйомки.
    screenSecondsPerCaptureSecond: capture / project,
  };
}

/** Різниця в стопах між двома діафрагмами. */
export function stopsBetweenApertures(from, to) {
  const a = Number(from);
  const b = Number(to);
  if (!(a > 0) || !(b > 0)) return null;
  return 2 * Math.log2(b / a);
}

/** Стопи → характеристики ND-фільтра. */
export function ndFromStops(stops) {
  const value = Number(stops);
  if (!Number.isFinite(value) || value < 0) return null;
  return {
    stops: value,
    // Оптична щільність: кожен стоп — це 0.3.
    density: value * 0.3,
    // У скільки разів менше світла проходить.
    factor: 2 ** value,
    label: `ND ${(value * 0.3).toFixed(1)}`,
  };
}

/** Щільність ND → скільки це стопів. */
export function stopsFromDensity(density) {
  const value = Number(density);
  if (!Number.isFinite(value) || value < 0) return null;
  return value / 0.3;
}

/** Поширені ND зі знімального набору. */
export const ND_PRESETS = [
  { density: 0.3, stops: 1 },
  { density: 0.6, stops: 2 },
  { density: 0.9, stops: 3 },
  { density: 1.2, stops: 4 },
  { density: 1.5, stops: 5 },
  { density: 1.8, stops: 6 },
  { density: 2.1, stops: 7 },
  { density: 2.4, stops: 8 },
];

/**
 * Компенсація експозиції: змінили один параметр — на скільки правити інші.
 * Повертає, скільки стопів треба «повернути» ND-фільтром або діафрагмою.
 */
export function exposureShift({ fromIso, toIso, fromAperture, toAperture, fromShutter, toShutter }) {
  let stops = 0;
  if (fromIso > 0 && toIso > 0) stops += Math.log2(toIso / fromIso);
  if (fromAperture > 0 && toAperture > 0) stops += 2 * Math.log2(fromAperture / toAperture);
  if (fromShutter > 0 && toShutter > 0) stops += Math.log2(toShutter / fromShutter);
  return stops;
}

export const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 100, 120, 240];

export const COMMON_SHUTTER_ANGLES = [45, 90, 144, 172.8, 180, 270, 360];
