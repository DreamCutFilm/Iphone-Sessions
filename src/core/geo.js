// Географія: перетворення координат у тайли карти й посилання в «Карти».
//
// Чиста математика без DOM — тому вкрита тестами й переноситься в нативну
// версію як є. Проєкція — Web Mercator, та сама, що в усіх звичних картах.

const MAX_LATITUDE = 85.0511287798; // межа проєкції Меркатора

export const MIN_ZOOM = 2;
export const MAX_ZOOM = 18;

export function clampLatitude(latitude) {
  return Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));
}

/** Довгота «загортається» через 180-й меридіан, а не впирається в нього. */
export function wrapLongitude(longitude) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

export function clampZoom(zoom) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom)));
}

/** Координати → дробові номери тайлів на заданому масштабі. */
export function lonLatToTile(longitude, latitude, zoom) {
  const scale = 2 ** zoom;
  const lat = (clampLatitude(latitude) * Math.PI) / 180;
  return {
    x: ((wrapLongitude(longitude) + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * scale,
  };
}

/** Номери тайлів → координати. Зворотне до lonLatToTile. */
export function tileToLonLat(x, y, zoom) {
  const scale = 2 ** zoom;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return {
    longitude: (x / scale) * 360 - 180,
    latitude: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
  };
}

/** Скільки метрів в одному пікселі — для масштабної лінійки. */
export function metersPerPixel(latitude, zoom) {
  return (156_543.03392 * Math.cos((clampLatitude(latitude) * Math.PI) / 180)) / 2 ** zoom;
}

export function isValidCoordinate(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

/** Координати в звичному вигляді: 50.4501, 30.5234. */
export function formatCoordinates(latitude, longitude, digits = 5) {
  if (!isValidCoordinate(latitude, longitude)) return '';
  return `${latitude.toFixed(digits)}, ${longitude.toFixed(digits)}`;
}

/**
 * Розбирає координати, вставлені з буфера: «50.45, 30.52», «50.45 30.52»,
 * «50.45;30.52». Саме так їх копіюють із Google Maps чи надсилають у месенджері.
 */
export function parseCoordinates(input) {
  if (typeof input !== 'string') return null;
  const match = input.trim().match(/^(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!match) return null;

  const latitude = Number.parseFloat(match[1].replace(',', '.'));
  const longitude = Number.parseFloat(match[2].replace(',', '.'));
  if (!isValidCoordinate(latitude, longitude)) return null;

  return { latitude, longitude };
}

/**
 * Посилання, що відкриває місце в застосунку «Карти».
 * На iPhone схема maps.apple.com відкриває саме нативні Карти, а не браузер.
 */
export function mapsLink({ latitude, longitude, label = '' }) {
  if (isValidCoordinate(latitude, longitude)) {
    // Шести знаків після коми вистачає на точність близько 10 см — далі
    // в адресі був би лише шум від похибки обчислень із рухомою комою.
    const point = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
    const query = label || formatCoordinates(latitude, longitude);
    return `https://maps.apple.com/?ll=${point}&q=${encodeURIComponent(query)}`;
  }
  // Немає координат — шукаємо за текстовою адресою.
  return label ? `https://maps.apple.com/?q=${encodeURIComponent(label)}` : null;
}

/** Адреса тайла OpenStreetMap. */
export function tileUrl(x, y, zoom) {
  const scale = 2 ** zoom;
  // Тайли по горизонталі повторюються навколо світу, по вертикалі — ні.
  const wrappedX = ((x % scale) + scale) % scale;
  if (y < 0 || y >= scale) return null;
  return `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`;
}
