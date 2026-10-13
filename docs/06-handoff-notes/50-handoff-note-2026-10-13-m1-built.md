# 50 — פתק מעבר: שלב M.1 של `46` נבנה ועבר בהוכחה חיה (13.10.2026, סשן בנייה מקומי)

קרא קודם: `CLAUDE.md`, מסמך זה, `docs/08-chapter8/47-chapter8-step-8-2a-spec.md` (המפרט של השלב הבא), `docs/08-chapter8/35-chapter8-plan.md` (סעיפים 3.8.0, 9, 10, 12, 13, 14), ו-`docs/09-security/46-prd-code-only-measurement.md` (טבלת "סטטוס" ו"לוג פערים"). הפתק בחמשת השדות של `seder-usgira`. לשון פנייה: זכר. מצב עבודה: Plan.

## 📍 איפה עצרנו

| מה | מצב | מה הוכח, ומאיפה |
|---|---|---|
| סוג הסשן | בנייה: שלב M.1 של `46` | השיחה |
| M.1 | **עבר** | טבלת "סטטוס" ב-`46`; PR 90 (קוד), PR 91 (סטטוס) |
| מה נבנה | טבלה `intake_outcomes`; רישום תוצאה אחת לכל הודעה מהקיצור ב-`api/intake.js`; שורה רביעית `intake-daily` ב-`lib/ops/daily-check.js` | `git show abb4baa` |
| בדיקות | 1,072 מתוך 1,072 (היו 1,025) | `node --test "test/*.test.js"` |
| ביקורת סוכן נקי | אין ממצא חוסם; תיקון אחד (סדר הספירה); ה-SQL הורץ על PGlite, כולל "אתמול" סביב 25.10 | דוח הסוכן, אומת מול `git diff` והרצת הבדיקות |
| הטבלה במסד החי | נוצרה בידי יובל; 5 עמודות, PRIMARY KEY, UNIQUE על `source_id`, FOREIGN KEY | SELECT על `information_schema` ו-`pg_constraint` |
| המסד מול הקובץ (H9) | שורה אחת `table_count`, 24 טבלאות, 197 עמודות | השאילתה של `schema-compare.mjs`, בעורך Neon |
| הוכחה חיה (D15) | `recorded` ואחריה `duplicate`; 276 ו-44 אלפיות שנייה מהשמירה עד שורת התוצאה; יובל: "לא הרגיש איטי בכלל" (H5) | SELECT על `intake_outcomes`, בלי טקסט הודעות |
| `daily-check` ידני (H6) | `StatusCode 200`; `intake-daily`: `ok=true`, `no_outcome=1` (יום 12.10) | הפלט שיובל הדביק, ו-`probe_log` |
| חידוש watch ראשון מול Google | **אומת:** `renewed=3 failed=0`, שלושה ערוצים עד 20.10 18:11 UTC, כל אחד קיבל `sync` | `probe_log`, `google_watch_channels` |
| פריסה | READY על `5f8d673` (המיזוג של PR 91); אחרי PR הסגירה: ראו דוח הסגירה | `list_deployments` |
| מצביעים שבורים | 63 לפני הפתק הזה | `check-pointers.py` |

## ✅ מה הוכרע (לא פותחים מחדש)

הבית של ההכרעות: `docs/01-foundation/01-system-overview.md`, "נוסף ב-13.10.2026 (סשן בנייה: M.1)", ו"לוג פערים" ב-`46`.

- **יובל:** סוג הסשן (בנייה או תכנון) הוא השורה הראשונה בדוח הפתיחה. נכנס ל-`full-open` (התבנית והסקיל).
- **יובל, ב"כן" לסיכום השלב:** הודעה שייכת בספירה ליום שבו הגיעה · `source_id`, `status`, `recorded_at` חובה, בלי CHECK · `intake-daily` היא `ok=true` כשהספירה הצליחה.
- **Claude (טכני, יובל רשאי לבטל):** `status` לא מוכר נרשם `failed` + `error` · הספירה רצה אחרי שלוש שורות Google · אין timeout נפרד לכתיבת התוצאה · פרמטר `processTimeoutMs` לבדיקות.

## ⚠️ פתוח / ממתין

**אין פעולה שמחכה ליובל עם סוד.** (שמות הסודות: `INTAKE_SECRET` לקליטה, חיבור Google ו-`google-watch-start`; `CRON_SECRET` ל-`daily-check`, `gate-probe`, `cron-plan`.)

1. **הריצה האוטומטית הראשונה של `intake-daily`:** 14.10 04:30 UTC. לקרוא ב-`probe_log` בפתיחה הבאה.
2. **תאריכי בדיקת הטוקן של Google זזו:** `days_since_connected=3` ב-13.10, כלומר "יום 8" ו"יום 15" הם 18.10 ו-25.10 בקירוב. `obtained_at` עצמו לא נקרא.
3. **ערוצי ה-watch הישנים פגים 15.10 09:14 UTC:** לבדוק שסומנו `stopped_at`.
4. **"יום X הבא" דו-משמעי:** ההודעה נרשמת, נפתחת שאלה "לאיזה תאריך?", והקיצור עונה "התקבל". יובל לא רואה את השאלה עד 8.2א-2. לא נשאל אם זו ההתנהגות הרצויה.
5. **שתי שאלות ממתינות במסד על הודעות מומצאות** (12.10 ו-13.10). בצ'אט: "לא יודע". שני מזהי המקור של 13.10 מוחרגים מדוח M.3 ולא נרשמו בקובץ; לשלוף לפי 13.10 18:03 ו-18:04 UTC.
6. **כתיבה למסד נחסמת אצלי** (מסווג auto mode), גם אחרי "תעשה בעצמך אתה". יובל מריץ לפי כרטיס. הוצע לו הסבר על הגדרות ההרשאה במחשב שלו; לא נעשה.
7. **H5 ו-H6 חלקיים:** מסד תקוע לא נבדק; משך הריצה של `daily-check` לא נמדד.
8. **חוב תיעוד:** `06-db-schema.md` בלי `intake_outcomes`; שורות חסרות ב-`test/README.md` `[מדווח]`.
9. **עדיין פתוח מפתק 49:** הצעות א עד ח לשיטה (`38` סעיף 9); אורך הקטע ב"לא נתפס" והודעה ארוכה מאוד (נשאל ב-8.2א-2); H20 עד H25; "בנינו 8.3 אתמול" (לא אומת); מסמכים שהתיישנו; ענפים ו-worktrees (ממתין לאישור מחיקה).

הרשימה המלאה: `docs/01-foundation/05-open-questions.md`, "נוסף ב-13.10.2026 (סשן בנייה: M.1 של `46`)".

## ▶️ הצעד הבא (מצב Plan)

1. **סשן בנייה: שלב 8.2א-1** (נתונים ושרת של הצ'אט), לפי `47`. לקרוא את `47` במלואו ואת `api/intake.js` מחדש מהדיסק (M.1 שינה אותו: `outcomeFor`, `CHANNEL_SHORTCUT`, והרישום ל-`intake_outcomes`). הודעות מערוץ `app` לא נרשמות ב-`intake_outcomes`.
2. **לפני:** לקרוא ב-`probe_log` את שורות 14.10 (כולל `intake-daily` ו-`google-watch-renew-daily`), עם `vercel-fast-check`, SELECT בלבד.
3. **ב-8.2א-1 יש שינוי סכמה** (עמודה `read_at`, לפי D4 ב-`35`): יובל מריץ, בכרטיס פעולה. לא להבטיח שאעשה לבד.

## 📁 קבצים

**נוצרו:** `test/intake-outcomes.test.js`; פתק זה.
**שונו (קוד):** `api/intake.js`, `lib/ops/daily-check.js`, `db/schema.sql`.
**שונו (בדיקות):** `test/daily-check.test.js`, `test/schema.test.js`, `test/watch-renew.test.js`, `test/intake-process.test.js`, `test/README.md`.
**שונו (מסמכים וסקילים):** `docs/09-security/46-prd-code-only-measurement.md` ("סטטוס" ו"לוג פערים" בלבד), `.claude/skills/full-open/SKILL.md`, `.claude/skills/full-open/template/open-report.md`, `.claude/skills/full-open/reference/full-open-protocol.md`, `.claude/skills/yoman-builder/reference/ops-commands.md`, `.claude/skills/vercel-fast-check/reference/failure-log.md`, ובסגירה: `docs/01-foundation/01-system-overview.md`, `02-build-plan.md`, `05-open-questions.md`, `docs/03-working-method/24-working-with-yuval.md`. **מחוץ לריפו (זיכרון):** קובץ הפרויקט ושורת האינדקס.
**במסד החי:** טבלה חדשה `intake_outcomes` (יובל הריץ); שתי שורות בה; שני מקורות, שתי עובדות ושאלה אחת מהודעת הבדיקה; שלושה ערוצי watch חדשים; שורות `probe_log` של ההרצה הידנית.
**נקראו בלבד:** `CLAUDE.md`, פתק 49, `47` (סעיף "תלויות"), `38` (כלל הפערים), `24`, `lib/intake-process.js`, `lib/watch-renew.js`, `vercel.json`, `stage-order.md`, `build-rules.md`, הפלייבוק של Neon.
**לא שונו:** `אפיון.md`, `03-permissions-rules.md`, `vercel.json`, `package.json`, `lib/intake-process.js`, `35`, `47`, `06-db-schema.md`.
