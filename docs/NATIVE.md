# Шлях у Xcode: як зробити з цього справжній застосунок

Застосунок навмисно побудовано так, щоб перехід у нативний iOS-проєкт був
переїздом, а не переписуванням. Тут — три можливі шляхи й те, що вже зроблено
для кожного з них.

## Чому це взагалі можливо

Код поділено на два шари, і межа між ними жорстка:

| Шар | Де лежить | Чи знає про браузер |
|---|---|---|
| Ядро: моделі, сховище, вибірки, кінорозрахунки | `src/core/` | **Ні** |
| Інтерфейс: екрани, форми, маршрути | `src/ui/`, `src/app.js` | Так |

У `src/core/` немає жодного звертання до `document`, `window` чи DOM. Це
перевіряється тестами, які виконуються в Node без браузера (`npm test`).
Отже, будь-який варіант нативізації зачіпає щонайбільше шар інтерфейсу, а
формули глибини різкості, обсягу карт, таймкоду й сонця переїжджають як є.

Два місця свідомо зроблено точками заміни:

- `src/core/storage.js` — адаптер сховища. `setStorageAdapter()` дозволяє
  підставити нативне сховище (файл, SQLite, `UserDefaults`), не чіпаючи
  решту коду.
- `src/ui/reminders.js` — нагадування. У вебі це `Notification` і опитування
  за таймером, у нативі — `UNUserNotificationCenter`.

---

## Шлях 1. Capacitor — найкоротший (рекомендую починати з нього)

[Capacitor](https://capacitorjs.com) загортає наявні файли у справжній
Xcode-проєкт. Веб-код лишається той самий, зверху зʼявляються нативні
можливості: сповіщення в будь-якому стані застосунку, файли, шаринг.

На Mac з установленим Xcode:

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "DreamCut App" com.dreamcut.ops --web-dir=.
npx cap add ios
npx cap open ios          # відкриється Xcode
```

`capacitor.config.json` уже лежить у репозиторії з правильним `webDir`, тож
крок `init` можна пропустити.

Далі в Xcode: обрати свою команду розробника в **Signing & Capabilities**,
підключити iPhone кабелем і натиснути ▶. Застосунок стане на телефон.

Що варто підключити одразу після цього:

```bash
npm install @capacitor/local-notifications
```

і замінити нутрощі `src/ui/reminders.js` на виклики `LocalNotifications` —
тоді нагадування приходитимуть навіть коли застосунок закритий. Зовнішній
інтерфейс модуля (`startReminders`, `notificationState`,
`requestNotifications`) міняти не треба, решта коду про підміну не дізнається.

**Витрати:** безкоштовно для встановлення на власний iPhone (сертифікат діє
7 днів, потім переустановка). Для App Store або безстрокової установки —
Apple Developer Program, 99 $ на рік.

## Шлях 2. Власна оболонка на SwiftUI + WKWebView

Якщо не хочеться зайвої залежності — достатньо ~40 рядків Swift:

```swift
import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Без цього localStorage у WKWebView поводиться непередбачувано
        config.websiteDataStore = .default()

        let view = WKWebView(frame: .zero, configuration: config)
        view.scrollView.bounces = false
        view.isOpaque = false

        // Файли застосунку кладемо в бандл як папку (Create folder references)
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
            view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}
}

@main
struct DreamCutApp: App {
    var body: some Scene {
        WindowGroup { WebView().ignoresSafeArea() }
    }
}
```

Скопіювати `index.html`, `src/`, `assets/` у папку `www` всередині проєкту —
і застосунок готовий. Мінус порівняно з Capacitor: нативні можливості
(сповіщення, файли) доведеться підключати вручну через `WKScriptMessageHandler`.

## Шлях 3. Повністю нативний SwiftUI

Найдорожчий і найякісніший варіант. Переносиш лише `src/core/` — формули
перекладаються на Swift майже дослівно, бо це чиста математика без залежностей.
Інтерфейс пишеться заново на SwiftUI.

Що переноситься найлегше:

- `src/core/cine/optics.js` → `struct Optics` з тими самими функціями
- `src/core/cine/sun.js` → `struct Sun`; алгоритм не використовує нічого,
  крім `Foundation.Date` і тригонометрії
- `src/core/models.js` → `struct Project: Codable`, `struct Task: Codable`
- Формат резервної копії (`src/core/backup.js`) уже є `Codable`-сумісним JSON,
  тож нативна версія читатиме копії, зроблені вебверсією, без конвертації

Тести з `tests/core.test.mjs` варто перекласти на XCTest — вони фіксують
правильні відповіді (гіперфокал, drop-frame, схід сонця в Києві) і зловлять
помилку перекладу формул.

---

## Що зробити перед публікацією в App Store

1. **Іконки.** `tools/make-icons.py` генерує PNG потрібних розмірів,
   включно з 1024×1024 для App Store.
2. **Політика приватності.** Формально потрібна навіть тут. Текст простий і
   чесний: застосунок не збирає жодних даних, усе лишається на пристрої,
   мережа не використовується.
3. **Геолокація.** У `Info.plist` потрібен `NSLocationWhenInUseUsageDescription`
   з поясненням — інакше запит координат для золотої години мовчки провалиться.
4. **Сповіщення.** `UNUserNotificationCenter.requestAuthorization` і опис
   у `Info.plist`.

## Чого краще не робити

Не переносити стан у нативний шар «наполовину». Або сховище цілком у Swift
(через `setStorageAdapter`), або цілком у вебі. Проміжний варіант, де частина
записів живе в `localStorage`, а частина в SQLite, породить розсинхрон, який
дуже дорого ловити.
