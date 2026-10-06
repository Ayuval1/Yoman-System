#!/usr/bin/env python3
"""
build-icons.py — מייצר את כל קבצי האייקון מ-src/icon.svg.

למה סקריפט ולא קבצי PNG שמורים:
  קובץ PNG הוא תוצר. המקור הוא ה-SVG. אם נשמור רק תוצרים ונאבד את המקור,
  כל שינוי עתידי מחייב לצייר מחדש. אם נשמור את המקור ואת הסקריפט — התוצרים
  ניתנים לייצור מחדש בכל רגע, בכל מכונה, בלי תלות בקובץ שמישהו הוריד.

תלות:
    pip install playwright
    playwright install chromium

הרצה (מתוך שורש הריפו):
    python tools/build-icons.py

פלט → public/
    apple-touch-icon-180.png   ← היחיד שהאייפון קורא בפועל
    icon-192.png  icon-512.png  icon-1024.png
"""

import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "icon.svg"
OUT = ROOT / "public"

# (שם הקובץ, גודל בפיקסלים)
TARGETS = [
    ("apple-touch-icon-180.png", 180),
    ("icon-192.png", 192),
    ("icon-512.png", 512),
    ("icon-1024.png", 1024),
]


def render(page, svg: str, size: int, path: pathlib.Path) -> None:
    """מרנדר את ה-SVG לקנבס בגודל מדויק ושומר PNG אטום."""
    page.set_viewport_size({"width": size, "height": size})
    page.set_content(
        "<!doctype html><html><head><style>"
        "*{margin:0;padding:0}"
        f"html,body{{width:{size}px;height:{size}px;overflow:hidden}}"
        f"svg{{display:block;width:{size}px;height:{size}px}}"
        "</style></head><body>" + svg + "</body></html>"
    )
    page.screenshot(path=str(path), omit_background=False)


def main() -> int:
    if not SRC.exists():
        print(f"חסר קובץ מקור: {SRC}", file=sys.stderr)
        return 1

    svg = SRC.read_text(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        for name, size in TARGETS:
            render(page, svg, size, OUT / name)
            print(f"  ✓ {name}  ({size}×{size})")
        browser.close()

    print(f"\nנוצרו {len(TARGETS)} קבצים ב-{OUT}")
    print("תזכורת: iOS מתעלם מ-manifest.json. רק תג apple-touch-icon נספר.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
