#!/usr/bin/env python3
"""Генерує іконки застосунку.

Малюємо діафрагму обʼєктива: кільце з шести пелюсток. Тримати іконки в репозиторії
згенерованими, а не мальованими вручну, зручно — розміри завжди узгоджені,
і будь-який розмір додається одним рядком.

Запуск: python3 tools/make-icons.py
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

BG = (11, 12, 14)
ACCENT = (255, 176, 32)
ACCENT_DIM = (168, 112, 18)

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "assets" / "icons"

# (розмір, імʼя, частка полотна під саму позначку)
# Для maskable іконки лишаємо більше полів: Android обрізає її по колу.
TARGETS = [
    (180, "icon-180.png", 0.62),   # apple-touch-icon
    (192, "icon-192.png", 0.62),
    (512, "icon-512.png", 0.62),
    (512, "icon-maskable.png", 0.46),
]


def draw_aperture(size: int, mark_ratio: float) -> Image.Image:
    # Малюємо з чотириразовим запасом і зменшуємо — так краї виходять гладкими
    # без окремого згладжування.
    scale = 4
    canvas = size * scale
    image = Image.new("RGB", (canvas, canvas), BG)
    draw = ImageDraw.Draw(image)

    center = canvas / 2
    radius = canvas * mark_ratio / 2
    blades = 6

    # Суцільний диск — це «метал» діафрагми.
    draw.ellipse(
        [center - radius, center - radius, center + radius, center + radius],
        fill=ACCENT,
    )

    # Шестикутний отвір посередині — те, крізь що йде світло.
    hole_radius = radius * 0.46
    hexagon = [
        (
            center + hole_radius * math.cos(math.radians(angle)),
            center + hole_radius * math.sin(math.radians(angle)),
        )
        for angle in range(-90, 270, 360 // blades)
    ]
    draw.polygon(hexagon, fill=BG)

    # Стики пелюсток: кожна сторона отвору продовжується назовні до краю диска.
    # Саме ці лінії роблять позначку впізнаваною діафрагмою, а не просто зіркою.
    seam_width = max(2, int(canvas * 0.022))
    for index in range(blades):
        start = hexagon[index]
        end = hexagon[(index + 1) % blades]

        length = math.dist(start, end)
        direction = ((end[0] - start[0]) / length, (end[1] - start[1]) / length)

        # Продовжуємо сторону за її кінець, доки не впремося в край диска.
        far = (end[0] + direction[0] * radius * 2, end[1] + direction[1] * radius * 2)
        draw.line([end, far], fill=BG, width=seam_width)

    # Обрізаємо все, що вилізло за коло диска.
    mask = Image.new("L", (canvas, canvas), 0)
    ImageDraw.Draw(mask).ellipse(
        [center - radius, center - radius, center + radius, center + radius], fill=255
    )
    plate = Image.new("RGB", (canvas, canvas), BG)
    plate.paste(image, (0, 0), mask)

    # Тонке кільце корпусу навколо.
    ring = ImageDraw.Draw(plate)
    ring_gap = radius * 1.16
    ring.ellipse(
        [center - ring_gap, center - ring_gap, center + ring_gap, center + ring_gap],
        outline=ACCENT_DIM,
        width=max(2, int(canvas * 0.016)),
    )

    return plate.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for size, name, ratio in TARGETS:
        icon = draw_aperture(size, ratio)
        icon.save(OUTPUT_DIR / name, "PNG", optimize=True)
        print(f"{name}: {size}×{size}")


if __name__ == "__main__":
    main()
