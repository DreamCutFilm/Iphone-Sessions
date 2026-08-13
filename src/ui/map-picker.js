// Вибір точки на карті.
//
// Карта зібрана вручну з плиток OpenStreetMap, без сторонніх бібліотек: так
// застосунок лишається без залежностей і не важчає на сотні кілобайт заради
// одного екрана. Принцип звичний — тягнеш карту, точка береться з центру
// під перехрестям. Наводитись пальцем точно в позначку на телефоні незручно,
// а рухати всю карту — легко.
//
// Плитки — єдине місце, де застосунок звертається до мережі. Без інтернету
// карта чесно про це каже, а координати все одно можна взяти з телефона
// або ввести вручну.

import { el, toast } from './dom.js';
import { openSheet, closeSheet } from './sheet.js';
import {
  lonLatToTile, tileToLonLat, tileUrl, clampZoom, clampLatitude, wrapLongitude,
  formatCoordinates, parseCoordinates, isValidCoordinate, metersPerPixel,
  MIN_ZOOM, MAX_ZOOM,
} from '../core/geo.js';

const TILE_SIZE = 256;
const FALLBACK_CENTER = { latitude: 50.4501, longitude: 30.5234 }; // Київ

/**
 * @param {object} options
 * @param {number|null} options.latitude   поточна точка, якщо вже є
 * @param {number|null} options.longitude
 * @param {string} options.label           підпис місця (для заголовка)
 * @param {(point: {latitude:number, longitude:number}|null) => void} options.onPick
 * @param {() => void} [options.onCancel] викликається, якщо панель закрили
 *        хрестиком чи тапом повз неї — щоб форма, з якої прийшли, повернулась
 *        разом із уже введеними даними
 */
export function openMapPicker({ latitude, longitude, label = '', onPick, onCancel = null }) {
  const hasPoint = isValidCoordinate(latitude, longitude);
  const state = {
    latitude: hasPoint ? latitude : FALLBACK_CENTER.latitude,
    longitude: hasPoint ? longitude : FALLBACK_CENTER.longitude,
    zoom: hasPoint ? 15 : 11,
  };

  const tileLayer = el('div.map-tiles');
  const viewport = el('div.map-viewport', tileLayer, el('div.map-crosshair', '✛'));
  const readout = el('p.map-readout');
  const scaleNote = el('p.map-scale');
  const offlineNote = el('p.map-offline', 'Карта не завантажується — схоже, немає інтернету. Координати все одно можна взяти з телефона кнопкою «Я тут» або вставити вручну нижче.');
  offlineNote.hidden = true;

  let tilesFailed = 0;
  let anyTileLoaded = false;
  let waitTimer = null;

  // Плитка може не впасти з помилкою, а просто зависнути — так буває на
  // слабкому звʼязку. Без цього очікування користувач бачив би порожній
  // прямокутник і не розумів, чому.
  const watchForSilence = () => {
    if (anyTileLoaded || waitTimer) return;
    waitTimer = setTimeout(() => {
      waitTimer = null;
      if (!anyTileLoaded) offlineNote.hidden = false;
    }, 6000);
  };

  const stopWatching = () => {
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = null;
  };

  const render = () => {
    const width = viewport.clientWidth || 320;
    const height = viewport.clientHeight || 260;

    const center = lonLatToTile(state.longitude, state.latitude, state.zoom);
    const centerPx = { x: center.x * TILE_SIZE, y: center.y * TILE_SIZE };

    const firstX = Math.floor((centerPx.x - width / 2) / TILE_SIZE);
    const lastX = Math.floor((centerPx.x + width / 2) / TILE_SIZE);
    const firstY = Math.floor((centerPx.y - height / 2) / TILE_SIZE);
    const lastY = Math.floor((centerPx.y + height / 2) / TILE_SIZE);

    const tiles = [];
    for (let x = firstX; x <= lastX; x += 1) {
      for (let y = firstY; y <= lastY; y += 1) {
        const url = tileUrl(x, y, state.zoom);
        if (!url) continue;

        const image = el('img.map-tile', {
          src: url,
          alt: '',
          loading: 'eager',
          draggable: false,
          style: {
            left: `${x * TILE_SIZE - centerPx.x + width / 2}px`,
            top: `${y * TILE_SIZE - centerPx.y + height / 2}px`,
          },
        });

        image.addEventListener('error', () => {
          tilesFailed += 1;
          // Одна невдала плитка — дрібниця, суцільна невдача — це офлайн.
          if (tilesFailed >= 3 && !anyTileLoaded) offlineNote.hidden = false;
        });
        image.addEventListener('load', () => {
          anyTileLoaded = true;
          offlineNote.hidden = true;
          stopWatching();
        });

        tiles.push(image);
      }
    }

    tileLayer.replaceChildren(...tiles);
    watchForSilence();
    readout.textContent = formatCoordinates(state.latitude, state.longitude);
    const perPixel = metersPerPixel(state.latitude, state.zoom);
    scaleNote.textContent = `Масштаб ${state.zoom} · приблизно ${Math.round(perPixel)} м у пікселі`;
  };

  // --- Перетягування -------------------------------------------------------

  let dragging = null;

  viewport.addEventListener('pointerdown', (event) => {
    dragging = { x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-dragging');
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    dragging = { x: event.clientX, y: event.clientY };

    const center = lonLatToTile(state.longitude, state.latitude, state.zoom);
    // Тягнемо карту вправо — центр зміщується вліво, звідси мінус.
    const next = tileToLonLat(
      center.x - dx / TILE_SIZE,
      center.y - dy / TILE_SIZE,
      state.zoom,
    );
    state.latitude = clampLatitude(next.latitude);
    state.longitude = wrapLongitude(next.longitude);
    render();
  });

  const endDrag = (event) => {
    if (!dragging) return;
    dragging = null;
    viewport.classList.remove('is-dragging');
    if (event?.pointerId !== undefined && viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  const setZoom = (delta) => {
    const next = clampZoom(state.zoom + delta);
    if (next === state.zoom) return;
    state.zoom = next;
    render();
  };

  // --- Ручне введення координат -------------------------------------------

  const manualInput = el('input.input', {
    type: 'text',
    inputmode: 'decimal',
    placeholder: '50.4501, 30.5234',
    onchange: (event) => {
      const parsed = parseCoordinates(event.target.value);
      if (!parsed) {
        if (event.target.value.trim()) toast('Не розпізнав координати', { error: true });
        return;
      }
      state.latitude = parsed.latitude;
      state.longitude = parsed.longitude;
      state.zoom = Math.max(state.zoom, 14);
      render();
      toast('Точку перенесено');
    },
  });

  const locateButton = el('button.btn.btn--ghost.btn--wide', {
    type: 'button',
    onclick: () => {
      if (!navigator.geolocation) { toast('Пристрій не дає координат', { error: true }); return; }
      toast('Визначаю місце…');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          state.latitude = position.coords.latitude;
          state.longitude = position.coords.longitude;
          state.zoom = 16;
          render();
          toast('Готово — точка на твоєму місці');
        },
        () => toast('Не вдалося отримати геолокацію', { error: true }),
        { enableHighAccuracy: true, timeout: 10_000 },
      );
    },
  }, '📍 Я тут');

  const body = el(
    'div.map-picker',
    el(
      'div.map-frame',
      viewport,
      el(
        'div.map-zoom',
        el('button.map-zoom-btn', { type: 'button', 'aria-label': 'Наблизити', onclick: () => setZoom(1) }, '+'),
        el('button.map-zoom-btn', { type: 'button', 'aria-label': 'Віддалити', onclick: () => setZoom(-1) }, '−'),
      ),
    ),
    readout,
    scaleNote,
    offlineNote,
    el('p.map-hint', 'Тягни карту — точка береться з-під перехрестя.'),
    locateButton,
    el('label.field', el('span.field-label', 'Або встав координати'), manualInput),
    el('p.map-credit', '© OpenStreetMap contributors'),
  );

  // Прапорець відрізняє свідомий вибір від закриття хрестиком: інакше
  // onCancel спрацьовував би ще й після натискання «Зберегти точку».
  let resolved = false;
  const finish = (point) => {
    resolved = true;
    closeSheet();
    onPick(point);
  };

  const sheet = openSheet({
    title: label ? `Місце: ${label}` : 'Місце на карті',
    body,
    onClose: () => {
      stopWatching();
      if (!resolved && onCancel) onCancel();
    },
    actions: [
      el('button.btn.btn--ghost', {
        type: 'button',
        onclick: () => finish(null),
      }, hasPoint ? 'Прибрати точку' : 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: () => finish({ latitude: state.latitude, longitude: state.longitude }),
      }, 'Зберегти точку'),
    ],
  });

  // Розміри стають відомі лише після вставки в дерево.
  requestAnimationFrame(render);
  return sheet;
}
