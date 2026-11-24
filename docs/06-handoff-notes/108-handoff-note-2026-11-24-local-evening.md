<div dir="rtl">

# פתק מעבר 108: 24.11.2026, ערב (סשן מקומי, יובל מהטלפון דרך Remote Control)

## 📍 מה נבנה ומוזג ל-`main`

| PR | מה |
|---|---|
| [267](https://github.com/Ayuval1/Yoman-System/pull/267) | **המוח:** מודלי הפיילוט הם גיבוי אחרי המודל שעבר את השער. בבוקר, השהיה אחת של `gemini-3.1-flash-lite` שלחה "פגישה עם המורה מחר ב-4" ל"מה זה?" |
| [268](https://github.com/Ayuval1/Yoman-System/pull/268) | **יומן שבוע:** קיצור מקצוע (מתמ׳, אנג׳, היסט׳, אזרח׳, פיז׳), בלי שבירה באמצע מילה. אומת באייפון |
| [269](https://github.com/Ayuval1/Yoman-System/pull/269) | **המוח:** מודל שנכשל ב-30 הדקות האחרונות עובר לסוף התור. בערב הראשי נכשל 4/4, והגיבוי ענה תוך פחות משנייה |
| [270](https://github.com/Ayuval1/Yoman-System/pull/270) | **אירוע כללי (שלב 1):** אירוע של כמה ימים, לכל היום ("חופשה בווינה מ30.11-3.12"). נכתב ליומן "אישי" בצבע 9, עם תזכורות של שבוע, יומיים ויום לפני |
| [271](https://github.com/Ayuval1/Yoman-System/pull/271) | **שלב 2:** ימים תפוסים בזמן אירוע כזה. כרטיס התנגשויות: מבחן עובר למועד ב' הקרוב, שעות למידה מבוטלות, אימון רק מוצג. בבריף: "היום: <כותרת>" |
| [272](https://github.com/Ayuval1/Yoman-System/pull/272) | **שלב 3:** האירוע מוצג בכל הימים ביומן, בשורת "כל היום" |

כל PR מ-267 עבר בודק עצמאי. ממצא חוסם לא נמצא. ממצאי "כדאי לתקן" תוקנו, חוץ מכרטיס כפול בקריאות מקבילות, שנרשם ב-problem-log.

**נעשה גם (לא קוד):**
- **יומן "לימוד" נוצר ב-Google.** Claude יצר אותו דרך Chrome, באישור של יובל. אומת ב-`list_calendars`.
- **Vercel:** מסך ה-2FA נדחה ל"תזכיר בעוד יום", באישור של יובל. יופיע שוב.

## 🧪 בדיקות

- `node --test "test/*.test.js"` מקומית, אחרי PR 272: `tests 3333`, `pass 3331`, `fail 2`.
- **שתי הבדיקות שנכשלות נכשלות רק במחשב של יובל**, ונכשלות גם בלי השינויים (רשום ב-problem-log):
  - `week-strip-tails`: הקבצים נשמרים ב-CRLF.
  - `time-suggest:355`: הבדיקה תלויה בתאריך האמיתי.
- **מה לא נבדק:**
  - PR 270–272 לא נבדקו מול Postgres, Google והמוח החיים, ולא באייפון.
  - הפריסה של PR 272 לא נבדקה.

**בדיקת אייפון (`docs/10-team/phone-check-2026-11-24-night.md`):**
- **עברו:** 1–4, 6 ו-14.
- **נדחתה ל-29.11:** 5.
- **לא נבדקו:** 7–13 ו-15–20.

## ⏳ מה מחכה ליובל

- **מהטלפון:**
  - לבדוק "חופשה בווינה מ30.11-3.12". ⚠️ "כן" בכרטיס ההתנגשויות מזיז מבחנים באמת.
  - להמשיך את רשימת הבדיקה מבדיקה 7.
  - לסגור את כרטיס "מה זה?" מהבוקר.
- **שיחה (רק יובל):** הבריפים (יומי, שבועי, דו-שבועי וחודשי) ו"איך היה?". `05-open-questions.md`, "לשיחה המקומית הבאה".
- **ליד המחשב (`CRON_SECRET`):** `brain-status` ו-`lesson-backfill` (הפקודות בפתק 105). בסשן הזה לא הורצו, כי יובל היה בטלפון.
- **סוד חדש:** אין. **פקודת מסד:** אין.

## ❓ פתוח (פירוט ב-`docs/10-team/problem-log.md`)

- **בועת "כן" של תוכנית הלמידה** לא נראתה בצ'אט, אף שבמסד היא נוצרה ונקראה. החשד: היא מוסתרת מתחת לערימת הכרטיסים. לא אומת.
- **Gemma** נכשל בשער: "JSON mode is not enabled".
- **אירוע כללי:** "לא יודע" בשאלת "עד איזה תאריך?" מחזיר שאלת שעה. כרטיס התנגשויות כפול בקריאות מקבילות.
- **תוכנית למידה:** שעה שנתפסה לא מוחלפת בשעה אחרת.
- **פתוח, לא אומת:** אם מותר לגשת לשני מבחנים באותו מועד ב'.

## 📁 קבצים

- **קוד:**
  - `lib/brain/ask.js`
  - `lib/away.js` (חדש)
  - `lib/intake-brain.js`, `lib/intake-dictionary.js`, `lib/intake-facts.js`, `lib/intake-process.js`, `lib/intake-questions.js`
  - `lib/event-sync.js`, `lib/event-match.js`
  - `lib/time-suggest.js`, `lib/free-check.js`, `lib/listening.js`
  - `lib/brief-view.js`, `lib/chat-view.js`, `lib/calendar-view.js`, `lib/show-request.js`
  - `api/chat.js`, `api/intake.js`, `api/queues/deliver.js`
  - `public/index.html`
- **בדיקות:** `test/brain-ask.test.js`, `test/calendar-week.test.js`, `test/multi-day-event.test.js`, `test/away.test.js`, `test/calendar-view.test.js`, `test/calendar-allday.test.js`, `test/show-request.test.js`.
- **מסמכים (הוספה בלבד):** `05-open-questions.md`, `02-build-plan.md`, `docs/10-team/problem-log.md`, `docs/10-team/phone-check-2026-11-24-night.md`.
- **לא נגעתי:** `db/schema.sql`, `package.json`, `vercel.json`, `אפיון.md`, `03-permissions-rules.md`, Notion.

</div>
