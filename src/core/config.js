// Підключення до бази.
//
// Ключ тут публічний і таким задуманий: він потрапляє в код, що виконується
// в браузері, тож приховати його неможливо в принципі. Дані захищає не він,
// а правила доступу в самій базі (supabase/schema.sql) — без входу цей ключ
// не дає прочитати жодного чужого рядка.
//
// СЕКРЕТНИЙ ключ (sb_secret_… або service_role) сюди класти не можна ніколи:
// він обходить усі правила доступу й дає повний доступ до бази.

export const SUPABASE_URL = 'https://whbxhdnbydjibkqtispm.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_CVilEBXkRbLGd4o6q89gKg_YgPSfEjk';

/** Чи налаштовано підключення. Без нього застосунок працює як раніше — локально. */
export function isCloudConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}
