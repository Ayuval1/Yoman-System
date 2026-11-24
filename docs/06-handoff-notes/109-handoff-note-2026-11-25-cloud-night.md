<div dir="rtl">

# פתק מעבר 109: לילה 24–25.11.2026 (סשן ענן, יובל ישן)

## ✨ מה חדש אצלך (לנסות קודם בטלפון)

1. **לשאול את האפליקציה במילים שלך.** למשל "מה יש לי מחר?", "מתי המבחן בהיסטוריה?" או "מה יש לי שבוע הבא?". התשובה מגיעה בבועה אחת. ה-AI מבין את השאלה, והקוד בודק ביומן ועונה. זה עובד רק כשהמוח זמין.
2. **"מה אתה יודע לעשות?"** מחזיר רשימת דוגמאות של מה אפשר לכתוב.
3. **תוכנית למידה:** אם שעה בכרטיס נתפסה עד שלחצת "כן", המערכת שמה שעה אחרת במקומה. קודם השעה פשוט נפלה.
4. **מבחן שזז או בוטל:** בבוקר שאחרי, מגיע כרטיס "לבטל את שעות הלמידה הישנות?". הן לא נמחקות לבד.
5. **ראשון ושני בבוקר:** אם לא העברת לוז 4fitness מאז יום חמישי, מופיעה תזכורת בבריף.

רשימת הבדיקה המלאה: `docs/10-team/phone-check-2026-11-25.md`.

## 📍 מה נבנה ומוזג ל-`main`

| PR | מה |
|---|---|
| [275](https://github.com/Ayuval1/Yoman-System/pull/275) | **בדיקות:** שתי הבדיקות שנכשלו במחשב של יובל. CRLF ב-`week-strip-tails`, ושעון מקובע ב-`time-suggest` |
| [276](https://github.com/Ayuval1/Yoman-System/pull/276) | **תוכנית למידה:** שעה שנתפסה ב"כן" מוחלפת משעות הרזרבה |
| [277](https://github.com/Ayuval1/Yoman-System/pull/277) | **Gemma בשער ובמוח:** בלי מצב JSON, וה-JSON נקרא מהטקסט. Gemini לא השתנה |
| [278](https://github.com/Ayuval1/Yoman-System/pull/278) | **"בזמן החופשה":** בלי כרטיס כפול בקריאות מקבילות. מזהה הודעה נגזר, בלי שינוי סכמה |
| [279](https://github.com/Ayuval1/Yoman-System/pull/279) | **שאלה חופשית על הלוח** (`schedule_query`): המוח מזהה, הקוד עונה |
| [280](https://github.com/Ayuval1/Yoman-System/pull/280) | **בריף:** תזכורת כשלוז 4fitness לא הגיע |
| [281](https://github.com/Ayuval1/Yoman-System/pull/281) | **שעות למידה של מבחן שזז או בוטל:** כרטיס "לבטל אותן?" |
| [282](https://github.com/Ayuval1/Yoman-System/pull/282) | **"מה אתה יודע לעשות?":** בועת דוגמאות |

כל PR עבר בודק עצמאי. ממצא חוסם לא נמצא, וכל ממצא "כדאי לתקן" תוקן לפני המיזוג.

**PR [273](https://github.com/Ayuval1/Yoman-System/pull/273) (דוח בוקר 24.11, "main אדום"):** בתחילת הסשן `main` היה אדום בבדיקה אחת, `time-suggest`, כי 24.11 היה יום שלישי. PR 275 תיקן את זה, ועכשיו `fail 0`. ה-PR נשאר פתוח כמו שהוא, כי הוא דוח ולא קוד. לא נסגר ולא הוגב.

## 🧪 בדיקות

- `node --test "test/*.test.js"` על `main` אחרי PR 282: `tests 3390`, `pass 3390`, `fail 0`.
- **הסביבה:** Node 22 בענן. `package.json` מבקש 24.x. הותקנו `node_modules` (`npm install`).
- **מול Postgres 16 מקומי** (מסד זמני בסשן עם `db/schema.sql`, לא Neon):
  - PR 278: שתי קריאות במקביל. בקוד הישן נוצרו 2 כרטיסים, בקוד החדש 1.
  - PR 280: לוז שעבר במסלול המוח נספר.
  - PR 281: "כן" ביטל רק את אירועי המבחן הנכון.
- **פריסה:**
  - Vercel production READY על PR 280 (`83c679d`) ו-PR 281 (`3258ca0`).
  - PR 282 (`8acfcc2`) היה בבנייה בבדיקה האחרונה, ולא נבדק אם הגיע ל-READY.
- **מה לא נבדק:**
  - שום דבר באייפון.
  - שום דבר מול Neon, Google או Gemini אמיתיים.
  - האם Gemini בוחר `schedule_query`.
  - האם Gemma עונה בלי מצב JSON.

## ⏳ מה מחכה ליובל

- **מהטלפון:** `docs/10-team/phone-check-2026-11-25.md`, ומהרשימה של 24.11 מבדיקה 7. בדיקה 9 שם כבר לא נכונה.
- **שיחה (רק יובל):** `05-open-questions.md`, "לשיחה המקומית הבאה (24.11.2026 לילה)":
  - "לא יודע" על תאריך סיום (המלצה: יום שלם אחד).
  - נוסחים של Claude שלא אושרו.
  - תזכורת 4fitness גם בשני.
  - פריטים שדורשים החלטה.
  - ועדיין: הבריפים ו"איך היה?".
- **ליד המחשב (`CRON_SECRET`):** `brain-status` ו-`lesson-backfill`, כמו בפתק 108. הפקודות בפתק 105.
- **אחרי ריצת השער הבאה:** לבדוק ב-`brain-status` אם מודל `gemma-` קיבל ציון, ולא "בלי תשובה".
- **סוד חדש:** אין. **פקודת מסד:** אין.

## ❓ פתוח (פירוט ב-`docs/10-team/problem-log.md`)

- **בועת "כן" של תוכנית הלמידה** לא נראית בצ'אט. לא אומת, כמו בפתק 108.
- **תוכנית למידה:** לוז 4fitness שמגיע אחרי "כן" לא בודק התנגשות.
- **Garmin:** כוח שבוטל לא חוזר, ו"מנוחה" לא מבטלת כוח. פתוח, לא ברור בלי בדיקה מול Garmin.
- **"בזמן החופשה":** `read_at` של כרטיס שהוחלף.
- **"לא יודע" על תאריך סיום:** מחכה ליובל.

## 📁 קבצים

- **קוד:**
  - חדשים: `lib/fitness-reminder.js`, `lib/study-cleanup.js`, `lib/help-reply.js`
  - `lib/study-plan.js`, `lib/ops/gate-probe.js`, `lib/brain/ask.js`, `lib/away.js`
  - `lib/intake-brain.js`, `lib/intake-process.js`, `lib/show-request.js`
  - `lib/brief-view.js`, `lib/chat-view.js`, `lib/exam-ask.js`
  - `api/chat.js`, `api/queues/deliver.js`
- **בדיקות:**
  - חדשות: `test/schedule-query.test.js`, `test/fitness-reminder.test.js`, `test/study-cleanup.test.js`, `test/help-reply.test.js`
  - קיימות: `test/week-strip-tails.test.js`, `test/time-suggest.test.js`, `test/study-plan.test.js`, `test/gate-probe.test.js`, `test/brain-ask.test.js`, `test/away.test.js`, `test/queue-deliver.test.js`
- **מסמכים:**
  - הוספה בלבד: `05-open-questions.md`, `02-build-plan.md`
  - עדכוני סטטוס ושורה אחת חדשה: `docs/10-team/problem-log.md`
  - חדש: `docs/10-team/phone-check-2026-11-25.md`
- **לא נגעתי:** `db/schema.sql`, `package.json`, `vercel.json`, `public/index.html`, `אפיון.md`, `03-permissions-rules.md`, Notion, Google.

</div>
