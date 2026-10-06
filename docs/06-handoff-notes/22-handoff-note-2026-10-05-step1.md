# 22 — פתק מעבר: שלב 1 נבנה (5.10.2026)

קרא קודם: `CLAUDE.md`, ואז מסמך זה. הוא מחליף את "איך להתחיל את הסשן הבא" ב-`21`. מצב עבודה: Plan. הפתק בנוי בחמשת השדות הקבועים של `seder-usgira`.

## 📍 איפה עצרנו
שלב 1 בנוי ומוזג ל-`main` ([PR 8](https://github.com/Ayuval1/Yoman-System/pull/8)). הבנייה נעשתה בסוכן חדש, בענף `claude/step1-infrastructure`.

- נבדק הדיסק: **אין קוד אפליקציה** (`02:160` כתב שהשלד קיים, וזה לא נכון בריפו). נרשם ב-`02`.
- נבנו: נקודת קליטה (`api/intake.js`), Cron מוגן (`api/cron-plan.js`), סכמת 6 טבלאות (`db/schema.sql`), שני Cron ב-`vercel.json`. תלות אחת: `@neondatabase/serverless`.
- **אומת (פלט אמיתי):** 17 בדיקות עם מסד מדומה; הסכמה רצה פעמיים על PGlite; ה-claim האטומי החזיר 2 ואז 0. פריסת הענף ב-Vercel עלתה (READY). `POST /api/intake` בלי סוד: 401. `GET`: 405. `/api/cron-plan` בלי Bearer: 401. חיבור הריפו ל-Vercel פועל (פריסה אוטומטית לכל ענף).
- **אומת אחרי הצהריים, מול מסד אמיתי (5.10.2026):** יובל חיבר מסד Neon (`neon-orange-anchor`, Free, `iad1`) ל-`yoman-system`; `DATABASE_URL` נוצר אוטומטי. 6 הטבלאות נוצרו בעורך ה-Query של Neon (הרצה פקודה אחת בכל פעם; מספר העמודות תואם: 15, 7, 5, 10, 7, 8). יובל הכניס `INTAKE_SECRET` ו-`CRON_SECRET` ב-Production בלבד, ובוצע Redeploy. **קליטה אמיתית:** `POST /api/intake` עם הסוד החזיר 200, ושורה אחת נשמרה ב-`sources` (`channel=shortcut`, `sender=NULL`, הטקסט `step1 test`, hash, `received_at`). שורת הבדיקה נשארת בטבלה (אין מחיקה פיזית).
- **לא אומת:** תחרות אמיתית של שני חיבורים ל-claim; שה-Cron מופיע בהגדרות הפרויקט ומתקבל ב-Hobby (הבנייה עברה, ההגדרה לא נראתה); שורה ב-`probe_log` מ-Cron אמיתי (עוד לא רץ); `\n` מול `\r\n` בשדה Form (משפיע על ה-hash; הבדיקה נשלחה משורת פקודה, לא מהקיצור).
- **לא נעשה:** שורת יומן החיבורים ב-Notion (Notion לא מחובר בסשן).

## ✅ מה הוכרע (לא פותחים מחדש)
- שלב 1 נבנה לפי רשימת הקבצים שבסיכום שיובל אישר. שום קובץ קיים לא שונה בבנייה.
- יובל אישר את ההנחות ("אני מניח שזה בסדר"). **אישור זה לא הופך אותן לעובדות:** הן נשארות "הנחה, לא אומת" ב-`05`.
- הכרעות מ-`21` שעדיין בתוקף: החלטות טכניות אצל הסקיל והעדפות אצל יובל; סיכום לפני כל שלב וסוכן חדש לכתיבת הקוד; Garmin לפי `03-scheduling-rules:35` (מותנה); Anthropic ממשיכים עם סיכון פתוח; Gemini עדיף אם עובר את השער; עבודה מקומית בלבד עם גיבוי לריפו; DST ב-25.10.2026.
- חיבור הריפו ל-Vercel נסגר (היה "לא אומת" ב-`14:63`).

## ⚠️ פתוח / ממתין להכרעה
1. ~~הכנסת הסודות~~ ✅ **נעשה ב-5.10.2026** (ראה "אומת"). `INTAKE_SECRET` ו-`CRON_SECRET` קיימים רק ב-Production, לא ב-Preview; בענפי Preview הקליטה תחזיר 401. את ערך `INTAKE_SECRET` יובל שומר אצלו לשלב 2.
2. ההנחות ב-`05` (שורת "שלב 1 — הנחות"): שם הכותרת `x-intake-secret`, `INTAKE_SECRET`, שדות Form `text` ו-`sender`, hash כ-sha256 של הטקסט, ושעות Cron `0 5` ו-`0 17` UTC שהן זמניות.
3. שדות הטבלאות פרט ל-`sources` הם הצעה מ-`20:21`; `06` לא עודכן.
4. שאר הפתוחים מ-`21`: Anthropic, Garmin, Hobby מול העסק, ספי השער, תקרת הוצאה, DST מול נוסח החוק.
5. סקריפטים בסקיל: רעיון של יובל, לא הוכרע.
6. הכרעה ראשונה בשיחה הבאה: להתחיל שלב 2 (בדיקת הקיצור), אחרי סיכום ואישור.

## ▶️ הצעד הבא
מצב Plan: שלב 2 (בדיקת הקיצור באייפון) אחרי סיכום ואישור מפורש. קודם לבדוק שהסקיל `yoman-builder` ברשימה.

## 📁 קבצים שנגעתי בהם
**נוצרו:** `api/intake.js`, `api/cron-plan.js`, `db/schema.sql`, `vercel.json`, `package.json`, `package-lock.json`, `.gitignore`, `docs/06-handoff-notes/22-handoff-note-2026-10-05-step1.md`.

**שונו:** `docs/01-foundation/02-build-plan.md` (שורת שלב 1 והערת השלד), `docs/01-foundation/05-open-questions.md` (שורת "שלב 1 — הנחות"), `docs/01-foundation/01-system-overview.md` (שתי שורות החלטה: Neon וסודות; שורה ב"מה נפסל"), `docs/03-working-method/04-working-method.md` (שני כללי עבודה וסעיף "עבודה עם הדפדפן של יובל"), `.claude/skills/yoman-builder/reference/open-items.md` ו-`precedence.md` (חיבור הריפו נסגר). מחוץ לריפו: קובץ הזיכרון `project_yoman_system.md`.

**לא שונה בכוונה:** `docs/01-foundation/00-project-instructions.md` (`CLAUDE.md` גובר), ולכן אין צורך להעתיק הוראות פרויקט מחדש.

**נקראו בלבד:** `CLAUDE.md`, `docs/01-foundation/06-db-schema.md`, `docs/14`, `docs/15`, `docs/17`, `docs/20`, `docs/02-rules/03-app-channel-rules.md`, וקבצי הסקיל `yoman-builder`.
