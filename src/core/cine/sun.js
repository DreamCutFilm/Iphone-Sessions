// Сонце: схід, захід, золота й синя години.
//
// Астрономічний розрахунок за загальновідомими формулами положення Сонця
// (Meeus, спрощена версія). Працює повністю офлайн — на локації без звʼязку
// це критично. Точність — близько хвилини, чого для планування зйомки вистачає.

const RAD = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const OBLIQUITY = RAD * 23.4397; // нахил осі Землі

/** Висоти Сонця над горизонтом, які нас цікавлять (градуси). */
const EVENTS = [
  { angle: -18, rise: 'astroDawn', set: 'astroDusk' },
  { angle: -12, rise: 'nauticalDawn', set: 'nauticalDusk' },
  // Громадянські сутінки. Ранкова синя година триває від цієї позначки до сходу,
  // вечірня — від заходу до неї ж.
  { angle: -6, rise: 'blueHourStart', set: 'blueHourEnd' },
  { angle: -0.833, rise: 'sunrise', set: 'sunset' },
  { angle: 6, rise: 'goldenHourEnd', set: 'goldenHourStart' },
];

function toJulian(date) {
  return date.valueOf() / MS_PER_DAY - 0.5 + J1970;
}

function fromJulian(julian) {
  return new Date((julian + 0.5 - J1970) * MS_PER_DAY);
}

function toDays(date) {
  return toJulian(date) - J2000;
}

function solarMeanAnomaly(days) {
  return RAD * (357.5291 + 0.98560028 * days);
}

function eclipticLongitude(meanAnomaly) {
  // Рівняння центру — поправка на еліптичність орбіти.
  const center =
    RAD * (1.9148 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly) + 0.0003 * Math.sin(3 * meanAnomaly));
  const perihelion = RAD * 102.9372;
  return meanAnomaly + center + perihelion + Math.PI;
}

function declination(longitude) {
  return Math.asin(Math.sin(OBLIQUITY) * Math.sin(longitude));
}

function julianCycle(days, lw) {
  return Math.round(days - 0.0009 - lw / (2 * Math.PI));
}

function approxTransit(ht, lw, cycle) {
  return 0.0009 + (ht + lw) / (2 * Math.PI) + cycle;
}

function solarTransitJ(ds, meanAnomaly, longitude) {
  return J2000 + ds + 0.0053 * Math.sin(meanAnomaly) - 0.0069 * Math.sin(2 * longitude);
}

function hourAngle(height, latitude, dec) {
  const cosH =
    (Math.sin(height) - Math.sin(latitude) * Math.sin(dec)) / (Math.cos(latitude) * Math.cos(dec));
  // |cos| > 1 означає, що Сонце того дня взагалі не перетинає цю висоту:
  // полярний день або полярна ніч.
  if (cosH > 1 || cosH < -1) return null;
  return Math.acos(cosH);
}

/**
 * Часи сонячних подій для дати й координат.
 * Повертає обʼєкт із Date або null, якщо подія того дня не настає.
 */
export function sunTimes(date, latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const lw = RAD * -lon;
  const phi = RAD * lat;

  const days = toDays(date);
  const cycle = julianCycle(days, lw);
  const dsNoon = approxTransit(0, lw, cycle);
  const meanAnomaly = solarMeanAnomaly(dsNoon);
  const longitudeSun = eclipticLongitude(meanAnomaly);
  const dec = declination(longitudeSun);
  const noonJ = solarTransitJ(dsNoon, meanAnomaly, longitudeSun);

  const result = { solarNoon: fromJulian(noonJ), nadir: fromJulian(noonJ - 0.5) };

  for (const event of EVENTS) {
    const w = hourAngle(RAD * event.angle, phi, dec);
    if (w === null) {
      result[event.rise] = null;
      result[event.set] = null;
      continue;
    }
    const setJ = solarTransitJ(approxTransit(w, lw, cycle), meanAnomaly, longitudeSun);
    const riseJ = noonJ - (setJ - noonJ);
    result[event.rise] = fromJulian(riseJ);
    result[event.set] = fromJulian(setJ);
  }

  return result;
}

/** Поточна висота Сонця над горизонтом у градусах — від'ємна означає «зайшло». */
export function sunAltitude(date, latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const days = toDays(date);
  const meanAnomaly = solarMeanAnomaly(days);
  const longitudeSun = eclipticLongitude(meanAnomaly);
  const dec = declination(longitudeSun);
  const ra = Math.atan2(Math.sin(longitudeSun) * Math.cos(OBLIQUITY), Math.cos(longitudeSun));

  const siderealTime = RAD * (280.16 + 360.9856235 * days) - RAD * -lon;
  const h = siderealTime - ra;
  const phi = RAD * lat;

  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h));
  return altitude / RAD;
}

/**
 * Готові до показу вікна зйомки: ранкова й вечірня золота година,
 * синя година, тривалість світлового дня.
 */
export function shootingWindows(date, latitude, longitude) {
  const times = sunTimes(date, latitude, longitude);
  if (!times) return null;

  const span = (from, to) => {
    if (!from || !to) return null;
    return { from, to, minutes: Math.round((to - from) / 60000) };
  };

  return {
    times,
    morningGolden: span(times.sunrise, times.goldenHourEnd),
    eveningGolden: span(times.goldenHourStart, times.sunset),
    morningBlue: span(times.blueHourStart, times.sunrise),
    eveningBlue: span(times.sunset, times.blueHourEnd),
    daylightMinutes: times.sunrise && times.sunset ? Math.round((times.sunset - times.sunrise) / 60000) : null,
  };
}
