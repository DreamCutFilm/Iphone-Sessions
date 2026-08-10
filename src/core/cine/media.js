// Носії: скільки влізе на карту і скільки місця з’їсть знімальний день.
//
// Бітрейти наведені приблизні, з офіційних таблиць виробників. Для кодеків
// зі змінним бітрейтом (BRAW, R3D, H.265) реальна цифра плаває, тому
// в інтерфейсі завжди закладаємо запас.

/** Бітрейт у Мбіт/с на «рідній» кадровій частоті baseFps. */
export const CODECS = [
  { id: 'prores422proxy-1080', label: 'ProRes 422 Proxy · 1080p', mbps: 45, baseFps: 25, group: 'ProRes' },
  { id: 'prores422lt-1080', label: 'ProRes 422 LT · 1080p', mbps: 102, baseFps: 25, group: 'ProRes' },
  { id: 'prores422-1080', label: 'ProRes 422 · 1080p', mbps: 147, baseFps: 25, group: 'ProRes' },
  { id: 'prores422hq-1080', label: 'ProRes 422 HQ · 1080p', mbps: 220, baseFps: 25, group: 'ProRes' },
  { id: 'prores4444-1080', label: 'ProRes 4444 · 1080p', mbps: 330, baseFps: 25, group: 'ProRes' },
  { id: 'prores422-uhd', label: 'ProRes 422 · UHD', mbps: 590, baseFps: 25, group: 'ProRes' },
  { id: 'prores422hq-uhd', label: 'ProRes 422 HQ · UHD', mbps: 880, baseFps: 25, group: 'ProRes' },
  { id: 'prores4444-uhd', label: 'ProRes 4444 · UHD', mbps: 1320, baseFps: 25, group: 'ProRes' },
  { id: 'braw31-6k', label: 'Blackmagic RAW 3:1 · 6K', mbps: 1150, baseFps: 24, group: 'RAW' },
  { id: 'braw51-6k', label: 'Blackmagic RAW 5:1 · 6K', mbps: 690, baseFps: 24, group: 'RAW' },
  { id: 'braw81-6k', label: 'Blackmagic RAW 8:1 · 6K', mbps: 430, baseFps: 24, group: 'RAW' },
  { id: 'r3d-8k-71', label: 'REDCODE 7:1 · 8K', mbps: 1900, baseFps: 24, group: 'RAW' },
  { id: 'arriraw-46k', label: 'ARRIRAW · 4.6K', mbps: 2900, baseFps: 24, group: 'RAW' },
  { id: 'proresraw-4k', label: 'ProRes RAW HQ · 4K', mbps: 2000, baseFps: 30, group: 'RAW' },
  { id: 'xavcsi-4k', label: 'Sony XAVC S-I · 4K', mbps: 600, baseFps: 25, group: 'Камерні' },
  { id: 'xavchs-4k', label: 'Sony XAVC HS · 4K', mbps: 200, baseFps: 25, group: 'Камерні' },
  { id: 'xfavc-4k', label: 'Canon XF-AVC · 4K', mbps: 410, baseFps: 25, group: 'Камерні' },
  { id: 'h265-4k', label: 'H.265 10-bit · 4K', mbps: 150, baseFps: 25, group: 'Камерні' },
  { id: 'h264-1080', label: 'H.264 · 1080p', mbps: 50, baseFps: 25, group: 'Камерні' },
  { id: 'iphone-prores-4k', label: 'iPhone ProRes · 4K', mbps: 1900, baseFps: 30, group: 'Камерні' },
];

export const DEFAULT_CODEC_ID = 'prores422hq-1080';

export function getCodec(id) {
  return CODECS.find((codec) => codec.id === id) ?? CODECS.find((codec) => codec.id === DEFAULT_CODEC_ID);
}

/** Типові обсяги карт і дисків у гігабайтах (десяткових, як пише виробник). */
export const CARD_SIZES = [64, 128, 256, 512, 1024, 2048, 4096];

/**
 * Бітрейт з поправкою на кадрову частоту.
 * Для внутрішньокадрових кодеків (ProRes, RAW) залежність практично лінійна:
 * удвічі більше кадрів — удвічі більший потік.
 */
export function effectiveMbps(codec, fps) {
  const rate = Number(fps);
  if (!(rate > 0) || !(codec.baseFps > 0)) return codec.mbps;
  return (codec.mbps * rate) / codec.baseFps;
}

/**
 * Скільки місця займе запис.
 * Гігабайти рахуємо десяткові (10⁹ байтів) — так само, як маркують карти.
 */
export function sizeForDuration({ mbps, minutes, cameras = 1, copies = 1, headroomPercent = 0 }) {
  const rate = Number(mbps);
  const time = Number(minutes);
  if (!(rate > 0) || !(time > 0)) return null;

  const gigabytes = (rate * time * 60) / 8 / 1000;
  const withCameras = gigabytes * Math.max(1, Number(cameras) || 1);
  const withCopies = withCameras * Math.max(1, Number(copies) || 1);
  const total = withCopies * (1 + Math.max(0, Number(headroomPercent) || 0) / 100);

  return {
    perCameraGb: gigabytes,
    totalGb: total,
    terabytes: total / 1000,
    gbPerHour: (rate * 3600) / 8 / 1000,
  };
}

/** Скільки хвилин запису влізе на носій заданого обсягу. */
export function durationForSize({ mbps, gigabytes, cameras = 1 }) {
  const rate = Number(mbps);
  const size = Number(gigabytes);
  if (!(rate > 0) || !(size > 0)) return null;

  const minutesTotal = (size * 8 * 1000) / rate / 60;
  const minutes = minutesTotal / Math.max(1, Number(cameras) || 1);

  return {
    minutes,
    hours: minutes / 60,
    label: formatDuration(minutes),
  };
}

/** Скільки карт треба взяти на зміну, щоб не перекидати матеріал у полі. */
export function cardsNeeded({ totalGb, cardGb }) {
  const total = Number(totalGb);
  const card = Number(cardGb);
  if (!(total > 0) || !(card > 0)) return null;
  return Math.ceil(total / card);
}

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  if (minutes < 1) return `${Math.round(minutes * 60)} с`;
  const whole = Math.floor(minutes);
  const hours = Math.floor(whole / 60);
  const mins = whole % 60;
  if (hours === 0) return `${whole} хв`;
  return mins === 0 ? `${hours} год` : `${hours} год ${mins} хв`;
}

export function formatSize(gigabytes) {
  if (!Number.isFinite(gigabytes)) return '—';
  if (gigabytes < 1) return `${Math.round(gigabytes * 1000)} МБ`;
  if (gigabytes < 1000) return `${gigabytes.toFixed(gigabytes < 10 ? 2 : 0)} ГБ`;
  return `${(gigabytes / 1000).toFixed(2)} ТБ`;
}
