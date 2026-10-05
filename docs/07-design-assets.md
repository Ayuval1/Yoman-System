# נכסי העיצוב — מקורות מלאים

> **מה זה:** כל מה שצריך כדי לבנות מחדש את הריפו מאפס, בלי להוריד אף קובץ.
> הכול טקסט. אין פה תמונה אחת — יש את מה שמייצר את התמונות.
>
> **המסמך המחייב להחלטות עיצוב: `03-design-rules.md`.** כאן רק הקוד.
> נוצר 24.9.2026, בסגירת שכבת העיצוב.

---

## למה המסמך הזה קיים

עד פרק העיצוב כל פרק ייצר טקסט, וטקסט יושב במסמכי הפרויקט. פרק העיצוב
הוא הראשון שייצר **קבצים בינאריים** — אייקונים ותמונות — שאין להם בית כאן.

הפתרון אינו לשמור בינאריים. **הפתרון הוא לשמור את מה שמייצר אותם.**
`icon.svg` הוא טקסט. הסקריפט שממיר אותו ל-PNG הוא טקסט. ביחד הם
מייצרים את האייקון בכל מכונה, בכל רגע.

**אומת:** הקבצים שנוצרים מהסקריפטים זהים בית-בית לקבצים שאושרו בשיחה.

---

## שחזור מלא — מה מריצים

```bash
mkdir -p yoman/{public,src,design/mockups,design/renders,tools}
cd yoman
# מדביקים את הקבצים מהמסמך הזה למקומם, ואז:
pip install playwright && playwright install chromium
python tools/build-icons.py
python tools/build-day-icons.py
python tools/render-mockups.py
```

קוד המסכים עצמם נמצא ב-**`08-design-mockups.md`** (גדול מדי למסמך אחד).

---

## מבנה הריפו

```
public/          ← מה ש-Vercel מגיש. שורש האתר
  index.html · manifest.json · sw.js · tokens.css
  apple-touch-icon-180.png   ← היחיד שהאייפון קורא בפועל
  icon-192.png · icon-512.png · icon-1024.png
  day-icons/     31 אייקוני ימים — לא בשימוש ב-PWA
src/             icon.svg · tokens.css        ← מקורות
design/mockups/  שישה מסכי HTML שאושרו       ← המקור ל-CSS האמיתי
design/renders/  תמונות — תוצר, נוצר מחדש
tools/           שלושה סקריפטים
vercel.json · .gitignore · .env.example · README.md
```

---

## `src/icon.svg`

המקור היחיד לכל קבצי האייקון. 1024×1024, אטום, בלי פינות מעוגלות — iOS מוסיף אותן בעצמו.

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#0A7A36"/>
  <path fill="#FFFFFF" d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71z"/>
  <path fill="#16A64B" d="M232 176h560c39 0 71 32 71 71v70H161v-70c0-39 32-71 71-71z"/>
  <rect x="318" y="118" width="46" height="98" rx="23" fill="#FFFFFF"/>
  <rect x="660" y="118" width="46" height="98" rx="23" fill="#FFFFFF"/>
  <g fill="#16A64B">
    <circle cx="330" cy="430" r="30"/><circle cx="512" cy="430" r="30"/><circle cx="694" cy="430" r="30"/>
    <circle cx="330" cy="570" r="30"/><circle cx="512" cy="570" r="30"/><circle cx="694" cy="570" r="30"/>
  </g>
</svg>
```

---

## `tools/build-icons.py`

```python
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
```

---

## `tools/build-day-icons.py`

```python
#!/usr/bin/env python3
"""
build-day-icons.py — מייצר 31 אייקונים, אחד לכל יום בחודש.

⚠️ קרא את זה לפני שאתה משתמש בהם:
    ב-PWA האייקונים האלה **לא יתחלפו על מסך הבית**. iOS קורא את
    apple-touch-icon פעם אחת בהתקנה ושומר אותו במטמון שברמת הדומיין.
    המטמון שורד מחיקה והוספה מחדש של הקיצור, ניקוי היסטוריה וניקוי נתוני אתר.
    האייקון הפעיל של האפליקציה הוא apple-touch-icon-180.png — בלי ספרה.

    הסט נשמר לשני מסלולים בלבד:
      1. וידג'ט (למשל Scriptable) — שם רענון יומי אפשרי.
      2. מעבר עתידי לאפליקציה נייטיב — setAlternateIconName.
         ⚠️ מציג התראת מערכת בכל החלפה, ורץ רק כשהאפליקציה בחזית.

תלות:
    pip install playwright
    playwright install chromium

הרצה (מתוך שורש הריפו):
    python tools/build-day-icons.py

פלט → public/day-icons/apple-touch-icon-01.png … -31.png  (180×180)
"""

import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "day-icons"
SIZE = 180

# אותה גאומטריה כמו src/icon.svg, בתוספת ספרת היום בגוף הלוח.
TEMPLATE = """<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#0A7A36"/>
  <path fill="#FFFFFF" d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71z"/>
  <path fill="#16A64B" d="M232 176h560c39 0 71 32 71 71v70H161v-70c0-39 32-71 71-71z"/>
  <rect x="318" y="118" width="46" height="98" rx="23" fill="#FFFFFF"/>
  <rect x="660" y="118" width="46" height="98" rx="23" fill="#FFFFFF"/>
  <text x="512" y="560" text-anchor="middle" dominant-baseline="middle"
        font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="300" fill="#0A7A36"
        letter-spacing="-8">{day}</text>
</svg>"""


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": SIZE, "height": SIZE})

        for day in range(1, 32):
            svg = TEMPLATE.format(day=day)
            (OUT / f"day-{day:02d}.svg").write_text(svg, encoding="utf-8")
            page.set_content(
                "<!doctype html><html><head><style>"
                "*{margin:0;padding:0}"
                f"html,body{{width:{SIZE}px;height:{SIZE}px;overflow:hidden}}"
                f"svg{{display:block;width:{SIZE}px;height:{SIZE}px}}"
                "</style></head><body>" + svg + "</body></html>"
            )
            page.screenshot(path=str(OUT / f"apple-touch-icon-{day:02d}.png"))

        browser.close()

    print(f"נוצרו 31 אייקוני ימים ב-{OUT}")
    print("תזכורת: ב-PWA הם לא מתחלפים. ראה ההערה בראש הקובץ.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

---

## `tools/render-mockups.py`

```python
#!/usr/bin/env python3
"""
render-mockups.py — מרנדר את קבצי ה-HTML של המסכים לתמונות PNG.

המסכים נכתבו כ-HTML ולא כתמונות בכוונה: ה-HTML הוא המקור שממנו נגזר
ה-CSS האמיתי של האפליקציה. התמונה היא רק כדי להסתכל.

מידות: 440×956 — אייפון 16 פרו מקס, ב-device_scale_factor=3.

⚠️ הפונט: ה-mockים משתמשים ב-Assistant כתחליף ל-SF Hebrew, שלא קיים
   על לינוקס. באפליקציה האמיתית זה system-ui ואין צורך בתחליף.

תלות:
    pip install playwright
    playwright install chromium

הרצה (מתוך שורש הריפו):
    python tools/render-mockups.py
"""

import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "design" / "mockups"
OUT = ROOT / "design" / "renders"

WIDTH, HEIGHT, SCALE = 440, 956, 3

SCREENS = [
    "s_main_light",   # מסך ראשי, מצב בהיר
    "s_main_dark",    # מסך ראשי, מצב כהה
    "s_close_light",  # סגירת 21:00, בהיר
    "s_close_dark",   # סגירת 21:00, כהה
    "states",         # ארבעה מצבי מסך: שתיקה · תמונה · ערימה פתוחה · יום ראשון
    "home",           # מסך הבית של האייפון עם המספר על האייקון
]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    missing = [n for n in SCREENS if not (SRC / f"{n}.html").exists()]
    if missing:
        print("חסרים קבצים:", ", ".join(missing))
        return 1

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={"width": WIDTH, "height": HEIGHT},
            device_scale_factor=SCALE,
        )
        for name in SCREENS:
            page.goto((SRC / f"{name}.html").as_uri())
            page.wait_for_timeout(600)  # להמתין לטעינת הפונט

            # states.html הוא גיליון של ארבעה מסכים זה לצד זה — ה-body שלו
            # רחב מ-440. מודדים את גודל התוכן בפועל ומתאימים את החלון,
            # במקום להניח שכל מסך הוא בגודל אייפון בודד.
            size = page.evaluate(
                "() => ({ w: Math.ceil(document.body.scrollWidth),"
                "         h: Math.ceil(document.body.scrollHeight) })"
            )
            if size["w"] > WIDTH or size["h"] > HEIGHT:
                page.set_viewport_size({"width": size["w"], "height": size["h"]})
                page.wait_for_timeout(300)

            page.screenshot(path=str(OUT / f"{name}.png"), full_page=False)
            page.set_viewport_size({"width": WIDTH, "height": HEIGHT})
            print(f"  ✓ {name}.png")
        browser.close()

    print(f"\nנוצרו {len(SCREENS)} תמונות ב-{OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

---

## `src/tokens.css`

משתני העיצוב. `public/tokens.css` הוא עותק זהה — עורכים כאן ומעתיקים, לא להפך.

```css
/* ============================================================
   tokens.css — משתני העיצוב של האפליקציה
   נגזר מהמסכים שאושרו. המקור המחייב: docs/03-design-rules.md
   ------------------------------------------------------------
   כלל: קוד האפליקציה לא כותב ערך צבע/רדיוס/צל ישירות.
        הוא מושך מכאן. אחרת מצב כהה נשבר בשקט.
   ============================================================ */

:root {
  /* --- ירוק: המערכת ופעולה --- */
  --deep:  #0A7A36;   /* משטחים ופעולה */
  --deep2: #0E8C40;   /* הגוון העליון בגרדיאנט הכותרת */
  --live:  #16A64B;   /* הבועות של יובל */

  /* --- מנטה: פס דרגה 2 --- */
  --mint: #F0F8F3;

  /* --- ענבר: "דורש אותך". אקנט יחיד, לא מעטר --- */
  --amber:   #96650F;
  --amberbg: #FCF3E2;

  /* --- משטחים --- */
  --bg:      #EDEFF2;   /* רקע המסך, ראש הגרדיאנט */
  --bg2:     #E4E9EB;   /* תחתית הגרדיאנט */
  --card:    #FFFFFF;   /* כרטיסים ובועות מערכת */
  --card1:   #FFFFFF;   /* כרטיס דרגה 1 */

  /* --- טקסט --- */
  --label:  #0B1410;
  --label2: rgba(45, 60, 52, .62);
  --label3: rgba(45, 60, 52, .34);
  --sep:    rgba(45, 60, 52, .14);

  /* --- רדיוסים --- *
   * iOS מעוגל. 14px הרגיש "רבועי" ונפסל.                    */
  --r-hero:  34px;  /* פינות תחתונות של הכותרת */
  --r-card1: 24px;  /* כרטיס דרגה 1 */
  --r-card2: 22px;  /* כרטיס דרגה 2 · בועות */
  --r-card3: 20px;  /* כרטיס דרגה 3 */
  --r-pill: 100px;  /* כפתורים ושורת הקלט */

  /* --- צללים: לפי דרגת עוצמה, לא אחיד --- */
  --sh-hero:  0 10px 26px rgba(6, 60, 28, .30), 0 2px 6px rgba(6, 60, 28, .18);
  --sh-card1: 0 10px 24px rgba(8, 52, 30, .16), 0 2px 6px rgba(8, 52, 30, .08);
  --sh-card2: 0 4px 12px rgba(8, 52, 30, .09);
  --sh-card3: 0 2px 7px rgba(8, 52, 30, .06);
  --sh-bubble: 0 3px 10px rgba(8, 52, 30, .09);
  --sh-me:    0 4px 12px rgba(22, 166, 75, .26);
  --sh-peek:  0 7px 14px rgba(8, 52, 30, .10);

  /* --- שכבת הגרעין: איך הרקע מקבל עומק --- */
  --grain-blend: multiply;
  --grain-opacity: .5;
  --glow: rgba(14, 140, 64, .20);   /* ההילה שיורדת מהכותרת */

  /* --- טיפוגרפיה --- *
   * system-ui באייפון = SF Hebrew. אין להחליף בפונט של גוגל.
   * Heebo היה הסימן הכי חזק ל"מרגיש אנדרואיד".              */
  --font: system-ui, -apple-system, sans-serif;
  --fs-title: 33px;   /* כותרת היום */
  --fs-body:  17px;
  --fs-time:  15px;   /* שעה בשורה, עם tabular-nums */
  --fs-label: 13px;
  /* משקלים אינם עוברים 700. הכובד מגיע מגודל, לא מעובי. */
  --fw-bold: 700;
  --fw-med:  600;
}

/* ============================================================
   מצב כהה — פלטה שנייה, לא היפוך.
   שלושה כללים: הירוק מתעמעם · הכרטיסים עולים ולא יורדים ·
   הגרעין עובר ל-screen כי על רקע כהה הוא צריך להאיר.
   ============================================================ */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --deep:  #0A5A2A;
    --deep2: #0C6B33;
    --live:  #149042;

    --mint: #16291F;

    --amber:   #D9A03C;
    --amberbg: #2A2211;

    --bg:    #141A17;
    --bg2:   #0D1210;
    --card:  #1B2420;
    --card1: #1D2621;   /* דרגה 1 בהיר יותר — חשוב יותר = גבוה יותר */

    --label:  #EEF4F0;
    --label2: rgba(226, 240, 232, .60);
    --label3: rgba(226, 240, 232, .32);
    --sep:    rgba(226, 240, 232, .12);

    --accent-on-dark: #54CC85;   /* תוויות ירוקות על כרטיס כהה */

    --sh-card1: 0 12px 28px rgba(0, 0, 0, .5), 0 2px 6px rgba(0, 0, 0, .4);
    --sh-bubble: 0 4px 12px rgba(0, 0, 0, .42);

    --grain-blend: screen;
    --grain-opacity: .28;
    --glow: rgba(20, 160, 74, .20);
  }
}

/* אותם ערכים, כשהמשתמש בוחר כהה ידנית */
:root[data-theme="dark"] {
  --deep: #0A5A2A;  --deep2: #0C6B33;  --live: #149042;
  --mint: #16291F;
  --amber: #D9A03C; --amberbg: #2A2211;
  --bg: #141A17;    --bg2: #0D1210;
  --card: #1B2420;  --card1: #1D2621;
  --label: #EEF4F0;
  --label2: rgba(226, 240, 232, .60);
  --label3: rgba(226, 240, 232, .32);
  --sep: rgba(226, 240, 232, .12);
  --accent-on-dark: #54CC85;
  --sh-card1: 0 12px 28px rgba(0, 0, 0, .5), 0 2px 6px rgba(0, 0, 0, .4);
  --sh-bubble: 0 4px 12px rgba(0, 0, 0, .42);
  --grain-blend: screen;
  --grain-opacity: .28;
  --glow: rgba(20, 160, 74, .20);
}

/* ============================================================
   בסיס
   ============================================================ */
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }

html { background: var(--bg2); }

body {
  font-family: var(--font);
  font-size: var(--fs-body);
  color: var(--label);
  background: linear-gradient(180deg, var(--bg) 0%, var(--bg2) 100%);
  min-height: 100dvh;
}

/* מספרים מיושרים — שעות ותאריכים לא "רוקדים" בין שורות */
.tnum, time { font-variant-numeric: tabular-nums; }

/* שעה נכתבת תמיד משמאל לימין, גם בתוך טקסט עברי */
.ltr { direction: ltr; unicode-bidi: isolate; }
```

---

## `public/index.html`

שלד האפליקציה לפרק 7. אין לוגיקה עסקית — רק התקנה, דחיפה, והמספר על האייקון.

```html
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<!-- viewport-fit=cover — בלעדיו התוכן נחתך מתחת לסרגל הבית של האייפון -->
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>מערכת יומן</title>

<!-- ============================================================
     האייקון — התג היחיד ש-iOS קורא בפועל.
     ⚠️ iOS מתעלם מ-icons שב-manifest.json. אל תסתמך עליו.
     ⚠️ המטמון של התג הזה נקבע ברמת הדומיין ושורד מחיקה והוספה
        מחדש של הקיצור. לכן: לא מתקינים על מסך הבית לפני
        שהאייקון הסופי כבר בשרת.
     ============================================================ -->
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-180.png">
<link rel="icon" href="/icon-192.png" type="image/png">
<link rel="manifest" href="/manifest.json">

<!-- מסך מלא בלי סרגלי ספארי, כשמופעל ממסך הבית -->
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="מערכת יומן">
<meta name="theme-color" content="#0A7A36">

<link rel="stylesheet" href="/tokens.css">
<style>
  /* שלד בלבד. העיצוב המלא נגזר מ-design/mockups/ — ראה README. */
  .app { display: flex; flex-direction: column; min-height: 100dvh; }

  .hero {
    position: relative; z-index: 2; color: #fff;
    padding: calc(env(safe-area-inset-top) + 8px) 24px 44px;
    background: linear-gradient(168deg, var(--deep2) 0%, var(--deep) 66%, #096B2F 100%);
    border-radius: 0 0 var(--r-hero) var(--r-hero);
    box-shadow: var(--sh-hero);
  }
  .hero h1 { font-size: var(--fs-title); font-weight: var(--fw-bold); letter-spacing: -.9px; }
  .hero p  { font-size: 14.5px; opacity: .72; margin-top: 2px; }

  .feed { flex: 1; padding: 0 16px 10px; display: flex; flex-direction: column; gap: 15px; }

  .composer {
    padding: 10px 16px calc(env(safe-area-inset-bottom) + 10px);
    display: flex; align-items: center; gap: 10px;
  }
  .composer input {
    flex: 1; border: 0; background: var(--card);
    border-radius: var(--r-pill); padding: 12px 18px;
    font: inherit; color: var(--label); box-shadow: var(--sh-card3);
  }
</style>
</head>
<body>
  <div class="app">
    <header class="hero">
      <h1 id="today">—</h1>
      <p id="todayDate"></p>
    </header>

    <main class="feed" id="feed" aria-live="polite"></main>

    <form class="composer" id="composer">
      <input id="msg" placeholder="הודעה" autocomplete="off" enterkeyhint="send">
    </form>
  </div>

<script type="module">
// ============================================================
// שלד לפרק 7. אין פה לוגיקה עסקית — רק מה שצריך כדי שה-PWA
// יתקין, ירשם לדחיפה, וידע לעדכן את המספר על האייקון.
// ============================================================

const DAYS = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני',
                'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function paintDate(now = new Date()) {
  document.getElementById('today').textContent = 'יום ' + DAYS[now.getDay()];
  document.getElementById('todayDate').textContent =
    `${now.getDate()} ב${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}
paintDate();

// --- Service Worker: תנאי הכרחי להתקנה ולדחיפה ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err =>
    console.error('[app] רישום sw נכשל', err));
}

// --- המספר על האייקון ---
// app_badge = הודעות שלא נקראו + פריטים שיובל לא ענה עליהם.
// setAppBadge קובע ערך מוחלט; אין פעולת הגדלה. הספירה היא של השרת.
export async function setBadge(count) {
  if (!('setAppBadge' in navigator)) return false;   // לא נתמך — לא נופלים
  try {
    count > 0 ? await navigator.setAppBadge(count) : await navigator.clearAppBadge();
    return true;
  } catch (err) {
    console.warn('[app] setAppBadge נכשל', err);
    return false;
  }
}

// --- הרשמה לדחיפה ---
// ⚠️ ב-iOS ההרשאה נדרשת בתוך מחווה של המשתמש (לחיצה), ורק
//    כשהאפליקציה רצה ממסך הבית. בספארי רגילה זה ייכשל.
export async function enablePush(vapidPublicKey) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return null;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidPublicKey,   // מגיע מהשרת, לא מוטבע כאן
  });
}

// ⚠️ אין כפתורים בהתראה באייפון — ספארי מתעלמת מ-actions.
//    ההתראה פותחת את הצ'אט; האישור קורה בתוך האפליקציה.

document.getElementById('composer').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('msg');
  if (!input.value.trim()) return;
  // פרק 8: שליחה לשרת הקליטה.
  input.value = '';
});
</script>
</body>
</html>
```

---

## `public/manifest.json`

⚠️ iOS מתעלם מ-`icons` כאן. הוא קיים בשביל ההתקנה והשם, לא בשביל האייקון.

```json
{
  "name": "מערכת יומן",
  "short_name": "מערכת יומן",
  "description": "מערכת הניהול האישית — יומן, משימות והתחייבויות",
  "lang": "he",
  "dir": "rtl",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#EDEFF2",
  "theme_color": "#0A7A36",
  "icons": [
    { "src": "/icon-192.png",  "sizes": "192x192",   "type": "image/png" },
    { "src": "/icon-512.png",  "sizes": "512x512",   "type": "image/png" },
    { "src": "/icon-1024.png", "sizes": "1024x1024", "type": "image/png", "purpose": "any" }
  ]
}
```

---

## `public/sw.js`

```javascript
/* ============================================================
   sw.js — Service Worker
   שלד לפרק 7. שלושה תפקידים בלבד בשלב הזה:
     1. להתקיים — בלי SW רשום אין התקנה ואין דחיפה.
     2. לקבל דחיפה ולהציג התראה.
     3. לפתוח את הצ'אט בלחיצה על ההתראה.
   ============================================================ */

const CACHE = 'yoman-shell-v1';
const SHELL = ['/', '/index.html', '/tokens.css', '/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* רשת קודם, מטמון כגיבוי.
   הפוך היה מציג ליובל תמונת מצב ישנה — וזה בדיוק מה
   שמסוכן במערכת שכל תפקידה הוא להיות מעודכנת. */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

/* ------------------------------------------------------------
   דחיפה.
   ⚠️ ב-iOS אין כפתורים בהתראה — ספארי מתעלמת מ-actions.
      ההתראה פותחת מסך; האישור קורה בתוך האפליקציה.
   השדה badge נושא את המספר לאייקון: לא-נקראו + ממתינים.
   ------------------------------------------------------------ */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const title = data.title || 'מערכת יומן';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    dir: 'rtl',
    lang: 'he',
    tag: data.tag || 'yoman',
    renotify: Boolean(data.tag),
    data: { url: data.navigate || '/' },
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    if (typeof data.app_badge === 'number' && 'setAppBadge' in navigator) {
      try {
        data.app_badge > 0
          ? await navigator.setAppBadge(data.app_badge)
          : await navigator.clearAppBadge();
      } catch { /* לא נתמך — ההתראה עצמה כבר הוצגה */ }
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if ('focus' in client) { await client.focus(); return client.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
```

---

## `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "outputDirectory": "public",
  "cleanUrls": true,
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" },
        { "key": "Service-Worker-Allowed", "value": "/" }
      ]
    },
    {
      "source": "/manifest.json",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache" },
        { "key": "Content-Type", "value": "application/manifest+json; charset=utf-8" }
      ]
    },
    {
      "source": "/apple-touch-icon-180.png",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=300" }
      ]
    }
  ]
}
```

---

## `.gitignore`

```
node_modules/
.env
.env.*
!.env.example
.vercel/
__pycache__/
*.pyc
.DS_Store
```

---

## `.env.example`

שמות בלבד. הערכים לעולם לא נכנסים לריפו.

```
# מפתחות וסודות — משתני סביבה בלבד. לא בקוד ולא בקבצים.
# הקובץ הזה מתעד שמות בלבד. הערכים עצמם לעולם לא נכנסים לריפו.

# מפתחות VAPID לדחיפה (פרק 7)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:

# מסד הנתונים (Neon)
DATABASE_URL=
```

---

## `README.md`

````markdown
# מערכת יומן — מערכת הניהול האישית

אפליקציית ווב (PWA) על האייפון. קלט, פלט, אישורים ושאלות — הכול שם.

**המסמכים המחייבים יושבים בריפו הזה, ב-`docs/`.** (מ-5.10.2026; קודם ישבו בפרויקט `מערכת יומן` ב-claude.ai.)
הריפו מחזיק מסמכים, דאטא (`data/`) וקוד.

---

## מבנה

```
public/          ← מה ש-Vercel מגיש. שורש האתר.
  index.html       שלד האפליקציה
  manifest.json
  sw.js            Service Worker — התקנה ודחיפה
  tokens.css       עותק מ-src/ (ראה "למה שני עותקים")
  apple-touch-icon-180.png   ← היחיד שהאייפון קורא בפועל
  icon-192.png  icon-512.png  icon-1024.png
  day-icons/       31 אייקוני ימים — לא בשימוש ב-PWA

src/             ← מקורות שמהם נגזרים התוצרים
  icon.svg         המקור היחיד לכל קבצי האייקון
  tokens.css       משתני העיצוב

design/
  mockups/         שישה מסכי HTML שאושרו. זה המקור ל-CSS האמיתי
  renders/         תמונות של המסכים — תוצר, נוצר מחדש בכל עת

tools/
  build-icons.py       icon.svg → כל קבצי ה-PNG
  build-day-icons.py   31 אייקוני ימים
  render-mockups.py    HTML → PNG

vercel.json      הגדרות פרסום
.env.example     שמות משתני הסביבה. הערכים לעולם לא כאן
```

---

## הרצה

```bash
pip install playwright
playwright install chromium

python tools/build-icons.py        # מייצר את האייקונים
python tools/build-day-icons.py    # מייצר 31 אייקוני ימים
python tools/render-mockups.py     # מרנדר את המסכים

cd public && python -m http.server 8000   # תצוגה מקומית
```

---

## כללים שאסור לשבור

**האייקון.** iOS מתעלם מ-`icons` שב-`manifest.json`. התג היחיד שנספר הוא
`<link rel="apple-touch-icon">`. המטמון שלו נקבע ברמת הדומיין ו**שורד מחיקה
והוספה מחדש של הקיצור, ניקוי היסטוריה וניקוי נתוני אתר**.
→ **לא מתקינים על מסך הבית לפני שהאייקון הסופי כבר בשרת.**

**האייקון לא מתחלף.** 31 אייקוני הימים קיימים, אבל ב-PWA הם לא יכולים
להתחלף על מסך הבית — מאותה סיבה. הם שמורים לווידג'ט או למעבר עתידי
לנייטיב בלבד.

**אין כפתורים בהתראה.** ספארי מתעלמת מ-`actions`. ההתראה פותחת מסך;
האישור קורה בתוך האפליקציה.

**סודות.** משתני סביבה בלבד. לא בקוד, לא בקבצים, לא ב-commit.
`.env.example` מתעד שמות — לעולם לא ערכים.

**צבעים ורדיוסים.** נמשכים מ-`tokens.css`. קוד שכותב `#0A7A36` ישירות
שובר את המצב הכהה בשקט.

**פרטים מזהים** לא נכנסים לקבצי המערכת.

---

## למה שני עותקים של tokens.css

`src/tokens.css` הוא המקור. `public/tokens.css` הוא מה שמוגש.
הם זהים היום; ברגע שתיכנס מערכת בנייה, `public/` ייבנה מ-`src/`.
עד אז — **עורכים ב-`src/` ומעתיקים**, לא להפך.

---

## אייקונים — למה סקריפט ולא קבצים שמורים

PNG הוא תוצר. `icon.svg` הוא המקור. אם נשמור רק תוצרים ונאבד את המקור,
כל שינוי עתידי מחייב לצייר מחדש. הסקריפטים מייצרים את הקבצים מחדש בכל
מכונה, בלי תלות בקובץ שמישהו הוריד. אומת: הקבצים שנוצרים זהים
בית-בית למקוריים שאושרו.
````

---

## מה נשאר בינארי, ולמה זה בסדר

| מה | איך משחזרים |
|---|---|
| `apple-touch-icon-180.png` ושלושת האחים שלו | `python tools/build-icons.py` |
| 31 אייקוני הימים | `python tools/build-day-icons.py` |
| שש תמונות המסכים | `python tools/render-mockups.py` |

**אין קובץ בינארי אחד שאי-אפשר לייצר מחדש מהמסמך הזה.**
