# 27 — פתק מעבר: חבילת הסידור והכלים (6.10.2026)

קרא קודם: `CLAUDE.md`, ואז מסמך זה. הוא בא אחרי `23` (שלב 2) ומחליף את "הצעד הבא" שם. מצב עבודה: Plan. הפתק בנוי בחמשת השדות הקבועים של `seder-usgira`. לשון פנייה: זכר.

## 📍 איפה עצרנו
שלב 2 (בדיקת הקיצור) נסגר ב-`23`. אחריו נבנתה חבילה אחת של סידור וכלים, בתשעה פרקים לפי `netanel-gen`:

| # | פרק | תוצר | מצב |
|---|---|---|---|
| 1 | בדיקת מצביעים | `.claude/skills/yoman-builder/scripts/check-pointers.py` | נבדק בהרצה: פלט זהה בכל הרצה; תופס הפניה שבורה בעותק בדיקה |
| 2 | סידור הריפו | `docs/` בתיקיות ממוספרות `01-foundation` עד `07-guides`; 40 קבצים עם `git mv`; 57 הפניות `docs/שם-קובץ` תוקנו | הוכח: תיקון הנתיבים הוא נתיב בלבד (הפיכת המיפוי החזירה את הקבצים המקוריים בבייט); 276 הפניות "קובץ:שורה" תקינות |
| 3 | הצלת `04` | `docs/03-working-method/24-working-with-yuval.md`; הערת הפניה בראש `04`; שורה 44 ב-`CLAUDE.md` | `CLAUDE.md` נשאר 150 שורות |
| 4 | ספר פקודות | `.claude/skills/yoman-builder/reference/ops-commands.md` | כל פקודה מסומנת אומת / לא אומת |
| 5 | מתכון הקיצור | `docs/07-guides/26-shortcut-recipe.md` | בלי סוד |
| 6 | מדריך פעולות ידניות | `docs/07-guides/25-manual-actions-guide.md` | |
| 7 | עדכון הסקיל והתבנית | `SKILL.md` (שלבים 1, 2, 5, 6), `template/step-brief.md` (שדה "מה מהתוכנית ומה הנחה שלי") | |
| 8 | סקריפט סגירה | `.claude/skills/yoman-builder/scripts/close-session.py` | נבדק בריפו בדיקה (8 תרחישים). הרצה יבשה על הריפו האמיתי לא שינתה דבר |
| 9 | סגירה | פתק זה, ו-`05` | |

- **שלב 2 לא נגע בקוד.** גם חבילה זו לא נגעה ב-`api/`, `db/`, `package.json` ו-`vercel.json`.
- **תוצאת בדיקת המצביעים אחרי הסידור:** 9 שבורים, כולם מוכרים: 3 קבצים שאינם בריפו, ו-6 הערות בקבצי האפליקציה שמפנות לנתיבי `docs/` ישנים (לא שונו בכוונה).
- **לא נעשה:** שורת יומן החיבורים ב-Notion (לא מחובר בסשן).

## ✅ מה הוכרע (לא פותחים מחדש)
- **מבנה `docs/`:** תיקיות ממוספרות, **מספרי הקבצים נשארים כמזהים קבועים** (אפשרות א, יובל). לא ממספרים מחדש.
- **`data/`, `memory/`, `plugins/`, `yoman-system-export.zip`:** לא נגעו. ברמת השורש השמות `docs`, `data`, `memory`, `plugins` נשארים.
- **`04`:** נשאר כתיעוד היסטורי; הכללים החיים עברו ל-`24` (אפשרות 2 של יובל, ואפשרות 1 לגבי אילו סעיפים). עריכות רק ב-`24`.
- **אין סקיל או סוכן חדש.** סקריפטים בתוך `yoman-builder` (יובל אישר "אפשר סקריפטים" ב-5.10). בדיקת מצביעים: לא `docs/12`.
- **מיזוג בסוף סשן:** לפי `CLAUDE.md:27`, עכשיו עם `close-session.py` (קודם dry-run).
- הכרעות מ-`22` ו-`23` שעדיין בתוקף: החלטות טכניות אצל הסקיל והעדפות אצל יובל; סיכום לפני כל שלב וסוכן חדש לכתיבת קוד; Garmin מותנה; Anthropic ממשיכים עם סיכון פתוח; Gemini אם עובר את השער; DST ב-25.10.2026.

## ⚠️ פתוח / ממתין להכרעה
1. **הסוד הופיע חלקית בצילום מסך.** יובל מחליט אם להחליף (`25-manual-actions-guide.md`, סעיף 8).
2. **הסעיף "קבצים במחשב של יובל" מ-`04`** לא הועתק ל-`24`; ממתין להכרעה (`05`, פריט 8).
3. **הרצה אמיתית של `close-session.py` עם `gh`:** נעשתה לראשונה בסגירת הסשן הזה. נתיב `gh` נבדק רק בקריאה ובדמה. אם נכשל באמצע, מצב המאגר מודפס.
4. **ה-Cron:** שורה ב-`probe_log` לא נבדקה.
5. **הרשאת "קבוע" בקיצור** מחר; תוכן הודעה מוואטסאפ במסד; הסוג השלישי של קלט הקיצור.
6. **בדיקת מצביעים היא מיטבית:** מדלגת על הפניות לא ברורות, ולא תופסת הפניה לקובץ הלא נכון בשם תקין.
7. שאר הפתוחים מ-`22`: Anthropic, Garmin, Hobby מול העסק, ספי השער, תקרת הוצאה, DST מול נוסח החוק.

## ▶️ הצעד הבא
מצב Plan: שלב 3 (השער, קריאת Haiku אחת ב-Sandbox עם הטוקן) אחרי סיכום ואישור מפורש. שלב 3 נוגע בטוקן המנוי של Claude, ולכן תזכורת לסיכון הפתוח לפני כתיבה (`open-items.md`). קודם לקרוא את `docs/05-chapter7/15-gate-success-criteria.md`.

## 📁 קבצים שנגעתי בהם
**נוצרו:** `docs/06-handoff-notes/27-handoff-note-2026-10-06-package.md`, `docs/03-working-method/24-working-with-yuval.md`, `docs/07-guides/25-manual-actions-guide.md`, `docs/07-guides/26-shortcut-recipe.md`, `.claude/skills/yoman-builder/scripts/check-pointers.py`, `.claude/skills/yoman-builder/scripts/close-session.py`, `.claude/skills/yoman-builder/reference/ops-commands.md`.

**שונו:** `CLAUDE.md` (15 נתיבים, ועוד שורה 44), `.claude/skills/yoman-builder/SKILL.md`, `reference/findings-14.md`, `reference/stage-order.md`, `template/step-brief.md` (נתיבים ותוכן לפי הפרקים), `docs/01-foundation/05-open-questions.md` (שורת שלב 2), `docs/03-working-method/04-working-method.md` (הערת הפניה), `docs/04-design/07-design-assets.md`, `docs/05-chapter7/12-check-project.py` (הערת "מיושן"), `docs/05-chapter7/17-step1-cloud-handoff.md`, `docs/06-handoff-notes/18, 22, 23` (נתיבים בלבד). **הועברו** (`git mv`, ללא שינוי תוכן): 40 קבצים ב-`docs/`.

**לא שונה בכוונה:** `api/`, `db/`, `package.json`, `vercel.json`, `data/`, `memory/`, `plugins/`, `docs/01-foundation/אפיון.md`, `docs/02-rules/03-permissions-rules.md` (הועברו בלבד).

**נקראו בלבד:** `docs/03-working-method/04-working-method.md` (במלואו), `docs/05-chapter7/12-check-project.py`, `.claude/skills/yoman-builder/reference/*`, שלוש השיחות הקודמות בריפו.
