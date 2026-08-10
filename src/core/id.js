// Генерація ідентифікаторів. Не залежить від DOM — переноситься в нативний застосунок як є.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Короткий сортований за часом ідентифікатор.
 * Перші 8 символів — час створення (base36), решта — випадковий хвіст.
 * Завдяки цьому записи природно сортуються за датою навіть без окремого поля.
 */
export function newId(prefix = '') {
  const time = Date.now().toString(36).padStart(8, '0');
  let tail = '';
  const bytes = randomBytes(6);
  for (const byte of bytes) tail += ALPHABET[byte % ALPHABET.length];
  return prefix ? `${prefix}_${time}${tail}` : `${time}${tail}`;
}

function randomBytes(length) {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    return cryptoApi.getRandomValues(new Uint8Array(length));
  }
  const fallback = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) fallback[i] = Math.floor(Math.random() * 256);
  return fallback;
}
