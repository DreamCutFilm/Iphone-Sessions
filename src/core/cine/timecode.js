// Таймкод: переведення в кадри й назад, додавання, різниця.
//
// Окремо оброблено drop-frame — режим для 29.97 і 59.94, де з нумерації
// викидають кадри, щоб таймкод не розʼїхався з реальним часом. Це стабільне
// джерело плутанини на майданчику, тому рахуємо його чесно, а не «майже».

export function isDropFrameRate(fps) {
  const rate = Number(fps);
  return Math.abs(rate - 29.97) < 0.01 || Math.abs(rate - 59.94) < 0.01;
}

/** Кількість кадрів, які пропускають на початку кожної хвилини. */
function dropCount(fps) {
  return Math.round(Number(fps) / 15); // 2 для 29.97, 4 для 59.94
}

/** '01:23:45:12' → номер кадру. */
export function timecodeToFrames(timecode, fps, dropFrame = isDropFrameRate(fps)) {
  const parsed = parseTimecode(timecode);
  if (!parsed) return null;
  const rate = Math.round(Number(fps));
  if (!(rate > 0)) return null;

  const { hours, minutes, seconds, frames } = parsed;
  let total = ((hours * 60 + minutes) * 60 + seconds) * rate + frames;

  if (dropFrame) {
    const drop = dropCount(fps);
    const totalMinutes = hours * 60 + minutes;
    // Пропускаємо кадри в кожній хвилині, крім кожної десятої.
    total -= drop * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return total;
}

/** Номер кадру → '01:23:45:12'. */
export function framesToTimecode(frameCount, fps, dropFrame = isDropFrameRate(fps)) {
  let frames = Math.round(Number(frameCount));
  const rate = Math.round(Number(fps));
  if (!Number.isFinite(frames) || !(rate > 0)) return null;

  const negative = frames < 0;
  frames = Math.abs(frames);

  if (dropFrame) {
    const drop = dropCount(fps);
    const framesPer10Min = rate * 60 * 10 - drop * 9;
    const framesPerMin = rate * 60 - drop;

    const tens = Math.floor(frames / framesPer10Min);
    let rest = frames % framesPer10Min;

    frames += drop * 9 * tens;
    if (rest >= drop) {
      // Перша хвилина десятихвилинного блоку йде без пропуску.
      rest -= drop;
      frames += drop * Math.floor(rest / framesPerMin);
    }
  }

  const ff = frames % rate;
  const totalSeconds = Math.floor(frames / rate);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600) % 24;

  const separator = dropFrame ? ';' : ':';
  const body = `${pad(hh)}:${pad(mm)}:${pad(ss)}${separator}${pad(ff)}`;
  return negative ? `-${body}` : body;
}

export function parseTimecode(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2})[:;.](\d{1,2})[:;.](\d{1,2})[:;.](\d{1,3})$/);
  if (!match) return null;
  const [, hours, minutes, seconds, frames] = match.map(Number);
  if (minutes > 59 || seconds > 59) return null;
  return { hours, minutes, seconds, frames };
}

/** Сума або різниця двох таймкодів. */
export function addTimecodes(a, b, fps, { subtract = false } = {}) {
  const first = timecodeToFrames(a, fps);
  const second = timecodeToFrames(b, fps);
  if (first === null || second === null) return null;
  const result = subtract ? first - second : first + second;
  return {
    frames: result,
    timecode: framesToTimecode(result, fps),
    seconds: result / Number(fps),
  };
}

/** Тривалість між двома таймкодами, з урахуванням переходу через опівніч. */
export function durationBetween(fromTimecode, toTimecode, fps) {
  const from = timecodeToFrames(fromTimecode, fps);
  const to = timecodeToFrames(toTimecode, fps);
  if (from === null || to === null) return null;

  const perDay = Math.round(Number(fps) * 60 * 60 * 24);
  const frames = to >= from ? to - from : to + perDay - from;

  return {
    frames,
    timecode: framesToTimecode(frames, fps),
    seconds: frames / Number(fps),
    wrapped: to < from,
  };
}

/** Реальний час у секундах → таймкод. Враховує, що 29.97 ≠ 30. */
export function secondsToTimecode(seconds, fps) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return null;
  return framesToTimecode(Math.round(value * Number(fps)), fps);
}

export function framesToSeconds(frames, fps) {
  return Number(frames) / Number(fps);
}

/** Секунди → «1 год 12 хв 30 с». */
export function formatSeconds(totalSeconds) {
  const value = Math.max(0, Math.round(Number(totalSeconds)));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  const parts = [];
  if (hours) parts.push(`${hours} год`);
  if (minutes) parts.push(`${minutes} хв`);
  if (seconds || parts.length === 0) parts.push(`${seconds} с`);
  return parts.join(' ');
}

function pad(value) {
  return String(value).padStart(2, '0');
}
