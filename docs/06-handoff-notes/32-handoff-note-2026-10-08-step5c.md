# 32 — פתק מעבר: G3 עבר, ערוצי watch נמשכים 7 ימים, שלב 5ג (חידוש אוטומטי) נבנה (8.10.2026)

קרא קודם: `CLAUDE.md`, ואז מסמך זה. בא אחרי `31` ומחליף את "הצעד הבא" שם. מצב עבודה: Plan. הפתק בנוי בחמשת השדות הקבועים של `seder-usgira`. לשון פנייה: זכר.

## 📍 איפה עצרנו

| מה | מצב | מה הוכח, ומאיפה |
|---|---|---|
| תיקון שני באגי ה-watch (PR 34) | ✅ מוזג ונפרס | `google-watch-start`: `expiration` ענק כבר לא זורק אחרי שהערוץ נפתח; נשמר NULL ו-`expiration_unusable`. `google-webhook`: מספר הודעה זהה למספר השמור מתעלמים ממנו. בדיקות 502 ל-506. פריסת Production במצב READY על הקומיט (`list_deployments`) |
| G3 (התראה מעריכת אירוע) | ✅ עבר, השהיה כ-60 שניות או פחות (הערכה, ראה שורה הבאה) | יובל הריץ מה-iPad (Remote Control) שכפול של הקיצור `יומן-בדיקה` עם כתובת `/api/google-watch-start`, כותרת `x-intake-secret`, POST. תשובת השרת: `created 3`, `total_calendars 4`, `skipped_read_only 1`, `already_active 0`, `failed 0` (שורת ה-failed נחתכה בצילום). אחרי עריכת אירוע, בטבלה `google_watch_channels` אצל ערוץ אחד משלושה: `last_resource_state=exists`, `notification_count=3` (09:17:09 UTC; הערוץ נוצר 09:14:19 UTC). ב-`probe_log` שורת `google-watch` עם `state=exists` ב-09:16:59 UTC. שני הערוצים האחרים קיבלו רק `sync` ראשוני |
| זמן ההתראה (כ-60 שניות) | ✅ **בקירוב, לא מדויק** | בבדיקה חוזרת יובל ערך אירוע "בסביבות 12:25-26" (UTC+3 = 09:25-26 UTC) וה-`last_notification_at` של הערוץ התעדכן ל-09:26:08 UTC (`notification_count` 3 ל-4). ההשהיה היא בין כמה שניות לכ-70 שניות לכל היותר, לפי הדקה שיובל נתן. הבדיקה הראשונה (09:16:59 UTC) לא שימשה: ההערכה של יובל לה (12:20) הייתה מאוחרת ממנה |
| אזעקת "לא נשלח" בקיצור | צפוי | בדיקת "התקבל" המובנית בקיצור נכשלת בכוונה על נקודת הקצה הזאת |
| לוגי Vercel כראיה | לא שימשו | 30 דקות בלי בקשות בלוג (שמירה קצרה); הראיה היא הטבלה ו-`probe_log` |
| אורך חיי ערוץ watch | ✅ **נמדד: 7 ימים** | `expiration` = יצירה + 7 ימים, 15.10.2026 09:14 UTC, בשלושת הערוצים. מקור: הטבלה |
| ה-Cron בפרודקשן | ✅ רץ | `probe_log`: `google-token-daily` (`ok=t`, `days_since_connected=0`, `calendars=4`) ו-`google-watch-daily` (`ok=t`, `active=0`, לפני שנוצרו ערוצים), שניהם 8.10 ב-04:43 UTC. משבצות `cron-plan` רצו ב-6, 7, 8.10. מכאן ש-`CRON_SECRET` מוגדר |
| ראיית טוקן ביום 8 ו-15 | **לא אומת** | צפויה בריצה של 15.10 ושל 22.10 |
| השער (שלב 3) | ❌ **לא עבר** | `probe_log` `gate-gemini`: 6.10 (0/20; 503 ואז 429), 7.10 04:49 UTC (טווח s01-s10, "1/10 ran=2", s02 נכשל ב-503 ונעצר). זה Gemini "high demand", לא תוצאת שער. השורה נכתבה אחרי אימות, כלומר `CRON_SECRET` התקבל לפחות ב-7.10 |
| שלב 5ג: חידוש אוטומטי (קומיט `9fb4c4e`) | ✅ נבנה בענף | `lib/watch-renew.js`, `api/daily-check.js` (שורה שלישית), `lib/google.js` מייצא `WATCHABLE_ROLES`, `test/watch-renew.test.js` (22). בדיקות 506 ל-528, כולן עוברות. **לא נבדק מול Google ו-Neon אמיתיים** |

## ✅ מה הוכרע (לא פותחים מחדש)
- **חידוש אוטומטי של ערוצי watch נכנס**, כי אורך החיים נמדד (7 ימים). זה מחליף את "בלי חידוש אוטומטי עד שנמדד" מ-`31`.
- **חידוש = פתיחת ערוץ חדש.** יומן עם ערוץ פעיל שפג תוך 48 שעות, ובלי ערוץ פעיל אחר שפג מאוחר יותר, מקבל ערוץ חדש. הערוץ הישן נשאר פעיל עד שפג, ואז מסומן `stopped_at`.
- **ה-webhook קורא רק ערוצים עם `stopped_at IS NULL`** ומחזיר 404 לאחרים.
- **אפס קריאות ל-Google כשאין מה לחדש.** רק יומנים owner או writer.
- **נפסל:** עצירת הערוץ הישן מיד (ה-webhook היה מחזיר 404 בזמן החפיפה); חידוש מתוך ה-webhook או מ-Cron אחר; משתנה סביבה חדש.
- **מגבלה ידועה:** ערוץ עם `expiration` NULL נחשב מכוסה ולא מתחדש. פירוט ב-`01`, סעיף 5ג.
- הערוצים הישנים (של הבדיקה) לא נמחקים. שעות ה-Cron נסחפות אחרי 25.10, ללא שינוי.

## ⚠️ פתוח / ממתין להכרעה
1. **זמן ההתראה של G3:** נמדד בקירוב (עד כ-70 שניות), לא במדויק, כי שעת העריכה היא הערכה של יובל לדקה. אם יידרש דיוק: לרשום שעה ושנייה לפני העריכה.
2. **חידוש לא נבדק על Google אמיתית.** לא ידוע אם Google תחזיר שוב 7 ימים לערוץ מחודש. חידוש ראשון צפוי בריצה של 14.10 ב-04:43 UTC בערך (28 שעות לפני הפקיעה; ריצת 13.10 רואה 52 שעות, מוקדם מדי).
3. **`maxDuration` ב-Hobby עם Fluid compute: לא אומת.** מקרה גרוע כ-60 שניות של timeout, רגיל כ-6 שניות; ל-`vercel.json` אין `maxDuration`. לבדוק ב-Settings ← Functions ← Fluid compute. אם כבוי: להגדיר `maxDuration` 60 ל-`api/daily-check.js` (שינוי config, דורש אישור יובל).
4. **אין UNIQUE על `google_watch_channels.calendar_id`:** שתי ריצות יומיות במקביל עלולות לפתוח ערוץ כפול. המחיר: התראות כפולות בלבד.
5. **תופעת לוואי:** עד כ-24 שעות אחרי חידוש `expiring_within_24h` עלול להישאר true בגלל השורה הישנה.
6. **השער לא עבר** (503/429 מ-Gemini). קבוצה 1 עם `CRON_SECRET` עוד לא הצליחה.
7. **תצפיות שלא תוקנו:** ל-`intake` אין הגבלת גודל ואין dedupe; `scrub()` ב-`gate-probe` מכסה גם תאריכים; `google-auth-start` לא בודק פורמט `TOKEN_ENC_KEY`. (שני באגי ה-watch מסעיף 6 ב-`31` **תוקנו**.)
8. **החלטות של יובל שממתינות:** ack; השער כ-Cron יומי; כותרת `X-Content-Type-Options`; שעות Cron מול 25.10; ספים ב-`15` וב-`10` ("מוצע"); מחיקת 16 ענפים מקומיים ו-25 ענפי `claude/` ב-GitHub; תכנון `full-open`; חפיפה בין `full-close` ל-`session-manager` הגלובלי על "ביי"/"סיימנו"; אימות שחזור `session-manager` הגלובלי; אימות Google על `calendar.events`.

## ▶️ הצעד הבא (מצב Plan)
**ליובל:**
1. G3 לא דורש עוד פעולה. (אופציונלי: בדיקה עם שעה ושנייה מדויקות, אם רוצים להוכיח את סף ה-60 שניות.)
2. **להריץ את קבוצה 1 של השער עם `CRON_SECRET`** (לא `INTAKE_SECRET`): מ-PowerShell לפי הפקודה ב-`31`, או מה-iPad בקיצור משוכפל: `GET /api/gate-probe?from=0`, כותרת `Authorization: Bearer <CRON_SECRET>`. ההרצה עלולה לקחת עד 5 דקות; מגבלת הזמן של Shortcuts לא ידועה. אם Gemini עדיין עמוס (503), לנסות בשעה אחרת.
3. **לבדוק ב-Vercel ← Settings ← Functions האם Fluid compute פעיל** ולדווח.
4. **להחליט** בנושאי סעיף 8 למעלה (לפי הסדר שנוח).
5. סודות: `INTAKE_SECRET` = כפתור "חבר Google", `google-calendars`, `google-watch-start`, קליטה. `CRON_SECRET` = `gate-probe`, `daily-check`. בלי סודות בצ'אט.

**לסשן הבא:**
1. **מיזוג ענף 5ג ל-`main`** לפי ההוראה הקבועה ב-`CLAUDE.md` (בסוף סשן: ענף + PR + merge רגיל, בלי לשאול).
2. **14.10 ו-15.10:** לקרוא את `probe_log` עם `ORDER BY at DESC` (לא `ORDER BY 1`: זה ממיין לפי מזהה אקראי, לא לפי זמן) ולחפש `google-watch-renew-daily` (`renewed=N failed=N skipped=N`). לבדוק בטבלה `google_watch_channels` שנפתח ערוץ חדש ומה `expiration` שלו.
3. **15.10:** ראיית טוקן ליום 8 (`google-token-daily`). **22.10:** ליום 15.

## 📁 קבצים
**נוצר בסגירה:** פתק זה. **שונו (בהוספה בלבד):** `docs/01-foundation/01-system-overview.md` (סעיף 5ג), `02-build-plan.md` (שורה 5 במפת פרק 7), `05-open-questions.md` (סעיף 8.10), `docs/03-working-method/24-working-with-yuval.md` (סעיף 8.10), `.claude/skills/yoman-builder/reference/open-items.md`, `stage-order.md`, `ops-commands.md`. **קוד שנבנה בסשן (קומיט `9fb4c4e`):** `lib/watch-renew.js`, `api/daily-check.js`, `lib/google.js`, `test/watch-renew.test.js`, `test/daily-check.test.js`. **לא שונו:** `אפיון.md`, `03-permissions-rules.md`.
