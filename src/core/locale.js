// Мова інтерфейсу та валюта.
//
// Валюта — це суто спосіб показу: у сховищі гонорар лежить звичайним числом,
// без прив'язки до валюти. Тому перемикач НЕ конвертує вже введені суми,
// він лише міняє підпис. Це свідоме рішення: курс змінюється щодня, і тихий
// перерахунок історичних гонорарів спотворив би дані.

export const LANGUAGES = [
  { id: 'uk', label: 'Українська', native: 'Українська', ready: true },
  // Переклад ще не готовий. Вибір зберігається — коли тексти зʼявляться,
  // застосунок підхопить його без додаткових налаштувань.
  { id: 'pl', label: 'Польська', native: 'Polski', ready: false },
];

export const DEFAULT_LANGUAGE = 'uk';

export function getLanguage(id) {
  return LANGUAGES.find((language) => language.id === id) ?? LANGUAGES[0];
}

export const CURRENCIES = [
  { code: 'UAH', symbol: '₴', position: 'suffix', label: 'Гривня', locale: 'uk-UA' },
  { code: 'PLN', symbol: 'zł', position: 'suffix', label: 'Злотий', locale: 'pl-PL' },
  { code: 'USD', symbol: '$', position: 'prefix', label: 'Долар США', locale: 'en-US' },
  { code: 'EUR', symbol: '€', position: 'prefix', label: 'Євро', locale: 'de-DE' },
];

export const DEFAULT_CURRENCY = 'UAH';

export function getCurrency(code) {
  return CURRENCIES.find((currency) => currency.code === code)
    ?? CURRENCIES.find((currency) => currency.code === DEFAULT_CURRENCY);
}

/** Тільки знак валюти — для підписів полів на кшталт «Гонорар, ₴». */
export function currencySymbol(code) {
  return getCurrency(code).symbol;
}

/**
 * Сума з розділювачами розрядів і знаком валюти.
 * Розряди завжди відокремлюємо звичайним пробілом: у різних локалях Intl
 * підставляє то нерозривний, то вузький нерозривний пробіл, і на вузькому
 * екрані це давало різну ширину для однакових за виглядом сум.
 */
export function formatMoney(value, code = DEFAULT_CURRENCY) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';

  const currency = getCurrency(code);
  const rounded = Math.round(value * 100) / 100;
  const hasCents = !Number.isInteger(rounded);

  const digits = new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })
    .format(rounded)
    // Прибираємо всі різновиди нерозривних пробілів на користь звичайного.
    .replace(/[   ]/g, ' ');

  return currency.position === 'prefix'
    ? `${currency.symbol}${digits}`
    : `${digits} ${currency.symbol}`;
}
