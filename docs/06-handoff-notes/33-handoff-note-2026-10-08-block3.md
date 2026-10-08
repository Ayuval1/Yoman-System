# 33 — פתק מעבר: בלוק 3 (תזמון הודעות) מוזג, השער נתן תוצאה ראשונה, הפרויקט ב-12 פונקציות (8.10.2026, ערב)

קרא קודם: `CLAUDE.md` (כולל "מוטו הבנייה"), ואז מסמך זה. בא אחרי `32` ומחליף את "הצעד הבא" שם. מצב עבודה: Plan. הפתק בנוי בחמשת השדות הקבועים של `seder-usgira`. לשון פנייה: זכר.

## 📍 איפה עצרנו

| מה | מצב | מה הוכח, ומאיפה |
|---|---|---|
| בלוק 3: משבצות 07:30 ו-21:00 דרך תור מושהה (PR 56) | ✅ מוזג ונפרס (`56fe343`, READY) | `/api/vapid-public-key` החזיר 200 בפרודקשן, `/api/cron-plan` ו-`/api/push-subscribe` (POST) בלי סוד החזירו 401. 579 בדיקות עוברות |
| דיוק התור | ✅ נמדד פעם אחת | בענף ניסוי (`claude/queue-experiment`, לא ממוזג): `@vercel/queue@0.8.0` מקובץ `api` פשוט, השהיה 120 שניות, הגיע 0.8 שניות אחרי היעד, `deliveryCount=1` (לוגי Vercel). **לא נמדד על השהיות של שעות** |
| בלוק 3 סגור? | ❌ **לא עד שתהיה ראיה אמיתית** | שורת `message-slot` ב-`probe_log` אחרי הריצה של `cron-plan` ב-9.10 (בריף: Cron בין 01:00 ל-01:59 UTC, יעד 04:30 UTC; סגירה: Cron בין 14:00 ל-14:59 UTC, יעד 18:00 UTC) |
| השער (שלב 3) | ❌ לא עבר, **יש תוצאת איכות ראשונה** | `gemini-3.5-flash-lite`, s11-s20: `6/10 ran=7; failed: s15; not-run: s18,s19,s20; retries=3; time_budget; elapsed=258s`. s15 צפוי `query_schedule/today` והמודל החזיר `today_afternoon` (הפעולה נכונה). `gemini-3.8-flash` בשתי הריצות של 8.10 נעצר ב-503 (s11, s12). **אין ציון על 20 משפטים** |
| `gate-probe` (PR 52, 53) | ✅ מוזג | ניסיון חוזר על 5xx (20 ו-40 שניות), תקציב 280 שניות, תקרת 30 שניות לקריאה, `elapsed` בסיכום, `model` ברשימה סגורה. **נמצא בלוגי Vercel: `maxDuration: 300` נקרא בפועל** |
| השער כ-Cron יומי (PR 42) | ✅ מוזג | `/api/gate-probe?from=0` ב-04:50 UTC (בפועל: בכל רגע בשעה 04:00-04:59). **ריצה ראשונה בפועל לא אומתה** |
| תיקונים קטנים | ✅ מוזגו | PR 44 (`nosniff` על `/api/*`, נבדק חי), PR 49 (`intake`: תקרת 100,000 תווים, 413), PR 50 (6 מצביעים), PR 45/46/51/55 (תיעוד) |
| `full-open` ו-`full-close` | ✅ עודכנו (PR 43, 47, 48) | סינון החלטות טכניות, קריאת `24` בפתיחה, סריקת פתוחים עם צ'קבוקסים בכל פתיחה (שלושה סוכני Explore, בשיחה בלבד), מוטו ב-`CLAUDE.md` |
| **הגבלת Hobby: 12 פונקציות** | ⚠️ **הפרויקט בדיוק ב-12** | `api/` מכיל 12 קבצים (11 + צרכן התור). כל נקודת API חדשה דורשת איחוד קודם (ראה `05-open-questions.md`) |

## ✅ מה הוכרע (לא פותחים מחדש)
פירוט ונימוקים ב-`01-system-overview.md`, "הכרעות 8.10.2026 (ערב)". בקצרה: שער כ-Cron יומי (יובל); ניסיון חוזר ב-`gate-probe`; `nosniff` רק על `/api/*`; תקרת `intake`; ack נדחה; ההודעות ב-07:30 ו-21:00 והCron הוא הפעלה בלבד (יובל); תור מושהה ולא Workflows; איחוד `vapid-public-key` ל-`push-subscribe`; לא `UNIQUE` על `calendar_id`; "סטיית שעון" נקראת כבדיקת מעבר שעון חורף ב-25.10 ומצורפת לשלב 7. **נפסל:** Vercel Workflows (דורש Nitro ובנייה מחדש של `api/`), שירות Cron חיצוני.

## ⚠️ פתוח / ממתין להכרעה
1. **הוכחה לבלוק 3:** שורת `message-slot` ב-`probe_log` של 9.10 (בריף וסגירה). לבדוק `late_s` ו-`delivery_count`.
2. **לא אומת בתור:** דיוק אחרי שעות; פריסה חדשה בין שליחה למסירה (לפי התיעוד נמסר לפריסה שיצרה את ההודעה); חיוב אחרי מיליון פעולות; שינוי אפשרי של `queue/v2beta` (בטא).
3. **השער:** s18-s20 על flash-lite לא נבדקו; `gemini-3.8-flash` לא נבדק מול אף משפט תקין בשתי הריצות של 8.10. **אין ציון על 20 משפטים.** שיעור הכשל האמיתי (`call_log`) לא נקרא; לא אומת אם 503 נספר במכסה.
4. **ענף הניסוי `claude/queue-experiment`** (לא ממוזג) ו-`.vercelignore` בו: למחוק רק באישור יובל, אחרי שבלוק 3 סגור.
5. **חידוש אוטומטי (5ג):** צפוי ב-14.10 (04:43 UTC בערך); ראיות טוקן: 15.10 ו-22.10; פקיעת הערוצים המקוריים 15.10 09:14 UTC.
6. **25.10:** מעבר שעון. לבדוק ששורת `message-slot` של 26.10 מגיעה ב-05:30 UTC (07:30 בישראל), ושורת הסגירה ב-19:00 UTC.
7. **שלב 7 (התקנה על מסך הבית) לא התחיל.** כולל דומיין סופי, בדיקות במכשיר, וגם "סטיית שעון" (מעבר שעון).
8. **אין dedupe ב-`intake`**; `scrub()` ב-`gate-probe` מכסה גם תאריכים; `google-auth-start` לא בודק פורמט `TOKEN_ENC_KEY`; אין `UNIQUE` על `google_watch_channels.calendar_id` (התראות כפולות בלבד).
9. **החלטות של יובל שנשארו:** ספי הבדיקות ב-`10`; מחיקת 36 ענפים מקומיים ו-44 ענפי `claude/` ב-GitHub; חפיפת `full-close` מול `session-manager` הגלובלי; אימות `session-manager` הגלובלי; אימות Google על `calendar.events`; גיל 18+ של Gemini; הסוד בדף האפליקציה; הרשאה לכתיבה ליומן.
10. **18 מצביעים שבורים** (`check-pointers.py`) נשארו בכוונה: קבצים שלא נבנו (`tools/build-day-icons.py`, `tools/render-mockups.py`, `public/sw.js`), קובץ זיכרון מחוץ לריפו, וקובץ מפרויקט ישן; 3 נוספים הם הפניות היסטוריות לשם הקובץ הישן ב-`28`.

## ▶️ הצעד הבא (מצב Plan)
**ליובל:**
1. **להריץ את שלושת המשפטים האחרונים של flash-lite** (`from=17&count=3`), עם **`CRON_SECRET`** (לא `INTAKE_SECRET`):
```powershell
$secret = Read-Host "CRON_SECRET"
Invoke-WebRequest -UseBasicParsing -Uri "https://yoman-system.vercel.app/api/gate-probe?from=17&count=3&model=gemini-3.5-flash-lite" -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 320 | Select-Object -ExpandProperty Content
```
   אם יוצא 429: המכסה היומית נגמרה, לנסות מחר.
2. **בפתיחה הבאה: להדביק את תוצאת השאילתה** על `probe_log` (`ORDER BY at DESC`, עשר השורות האחרונות), כדי שאקרא `message-slot`, `cron-plan` ו-`gate-gemini`. סוד: אין.
3. סודות: `INTAKE_SECRET` = כפתור "חבר Google", `google-calendars`, `google-watch-start`, קליטה. `CRON_SECRET` = `gate-probe`, `daily-check`. בלי סודות בצ'אט.

**לסשן הבא (לפי המוטו: בלוק נסגר לפני שנפתח הבא):**
1. **לסגור את בלוק 3:** לקרוא `message-slot` של 9.10 (בריף וסגירה). אם הגיע בזמן: לרשום כ"אומת", ואז לשקול למחוק את ענף הניסוי (באישור).
2. **לסגור את בלוק 1 (השער):** להשלים 20 משפטים (s18-s20 של flash-lite, ואז לחזור ל-`gemini-3.8-flash` בקבוצות של `count=5`), ולחשב ציון מול סף 90%.
3. **תאריכים:** 14.10 חידוש ערוץ (`google-watch-renew-daily`), 15.10 ו-22.10 ראיות טוקן, 25.10 מעבר שעון.
4. **בלוק 5 (שלב 7, התקנה על מסך הבית):** רק אחרי 1 עד 3; כולל איחוד פונקציות אם צריך נקודה חדשה.

## 📁 קבצים
**נוצר בסגירה:** פתק זה. **נוצרו בסשן:** `lib/schedule-time.js`, `lib/message-slots.js`, `api/queues/deliver.js`, `test/schedule-time.test.js`, `test/queue-deliver.test.js`. **הועבר:** `api/vapid-public-key.js` ל-`lib/vapid-public-key.js`. **שונו (קוד):** `api/cron-plan.js`, `api/gate-probe.js`, `api/intake.js`, `api/push-subscribe.js`, `vercel.json` (Cron, `functions`, `rewrites`, `headers`), `package.json` (+`@vercel/queue@0.8.0`, תלות חדשה, בטא). **שונו (תיעוד, בהוספה בלבד):** `01-system-overview.md`, `02-build-plan.md`, `05-open-questions.md`, `15-gate-success-criteria.md`, `24-working-with-yuval.md`, `CLAUDE.md` (מוטו וסריקת פתוחים), `.claude/skills/full-open/*`, `.claude/skills/full-close/template/close-report.md`, `.claude/skills/yoman-builder/reference/ops-commands.md`, `.claude/hooks/session-start.js`. **לא שונו:** `אפיון.md`, `03-permissions-rules.md`.
