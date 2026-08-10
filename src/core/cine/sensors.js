// Довідник сенсорів.
//
// coc — допустимий кружок нерізкості (circle of confusion) у міліметрах.
// Саме він задає, що ми вважаємо «різким», тому глибина різкості без нього
// не має сенсу. Значення підібрані під кіновиробництво (перегляд на великому
// екрані), тому вони суворіші за типові фотографічні.

export const SENSORS = [
  { id: 'ff', label: 'Full Frame (36×24)', width: 36, height: 24, coc: 0.029 },
  { id: 's35', label: 'Super 35 (24.89×18.66)', width: 24.89, height: 18.66, coc: 0.02 },
  { id: 'apsc', label: 'APS-C (23.5×15.6)', width: 23.5, height: 15.6, coc: 0.019 },
  { id: 'alexa35', label: 'ARRI ALEXA 35 (27.99×19.22)', width: 27.99, height: 19.22, coc: 0.022 },
  { id: 'alexalf', label: 'ARRI ALEXA LF (36.7×25.54)', width: 36.7, height: 25.54, coc: 0.029 },
  { id: 'redvv', label: 'RED VV / 8K FF (40.96×21.6)', width: 40.96, height: 21.6, coc: 0.03 },
  { id: 'mft', label: 'Micro 4/3 (17.3×13)', width: 17.3, height: 13, coc: 0.015 },
  { id: 's16', label: 'Super 16 (12.52×7.41)', width: 12.52, height: 7.41, coc: 0.011 },
  { id: 'inch1', label: '1" (13.2×8.8)', width: 13.2, height: 8.8, coc: 0.011 },
  { id: 'iphone', label: 'iPhone основна (9.8×7.3)', width: 9.8, height: 7.3, coc: 0.008 },
];

export const DEFAULT_SENSOR_ID = 's35';

export function getSensor(id) {
  return SENSORS.find((sensor) => sensor.id === id) ?? SENSORS.find((sensor) => sensor.id === DEFAULT_SENSOR_ID);
}

export function sensorDiagonal(sensor) {
  return Math.hypot(sensor.width, sensor.height);
}

/** Кроп-фактор відносно повного кадру — для перерахунку звичних фокусних. */
export function cropFactor(sensor) {
  const fullFrame = getSensor('ff');
  return sensorDiagonal(fullFrame) / sensorDiagonal(sensor);
}

/** Стандартний ряд діафрагм у третинах стопа. */
export const APERTURE_STOPS = [
  1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6,
  6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22,
];

/** Типові фокусні кіношних наборів праймів. */
export const COMMON_FOCAL_LENGTHS = [12, 14, 16, 18, 21, 24, 25, 27, 32, 35, 40, 50, 65, 75, 85, 100, 135, 150, 200];
