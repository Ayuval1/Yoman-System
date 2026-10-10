# 34 — פתק מעבר: בלוק 3 נסגר, משימות ה-Cron מאוחדות (10 פונקציות), פרומפט v2 לשער (10.10.2026)

קרא קודם: `CLAUDE.md` (כולל "מוטו הבנייה"), ואז מסמך זה. בא אחרי `33` ומחליף את "הצעד הבא" שם. מצב עבודה: Plan. הפתק בנוי בחמשת השדות הקבועים של `seder-usgira`. לשון פנייה: זכר.

## 📍 איפה עצרנו

| מה | מצב | מה הוכח, ומאיפה |
|---|---|---|
| בלוק 3: משבצות 07:30 ו-21:00 דרך תור | ✅ **אומת** | `probe_log` (שאילתת SELECT ב-Neon, 10.10): `message-slot` בריף 9.10 `late_s=1.6`, סגירה 9.10 (יעד 18:00 UTC) `late_s=1.3`, בריף 10.10 `late_s=1.3`; בכולן `delivery_count=1`. שורת `cron-plan` של 9.10: `delay_s=12287` (כ-3 שעות ו-24 דקות), נמסר באיחור 1.6 שניות. **דגימה אחת לכל סוג** |
| איחוד משימות ה-Cron (PR 59) | ✅ מוזג ונפרס (`82ae606`, READY) | `cron-plan`, `daily-check`, `gate-probe` ב-`lib/ops/`, מוגשים דרך `api/ops.js` (`task` ברשימה סגורה). בפרודקשן בלי סוד: `/api/gate-probe`, `/api/daily-check`, `/api/cron-plan?slot=1` החזירו 401; `/api/ops?task=nope` 404; `/api/vapid-public-key` 200. 589 בדיקות עוברות |
| פרומפט v2 לשער (PR 58) | ✅ מוזג ונפרס | הוראות action, כלל "when רק ממילת זמן", 4 דוגמאות שאינן ב-20 המשפטים (נבדק ב-grep) |
| השער (שלב 3) | ❌ **לא הוכרע** | `gemini-3.5-flash-lite`, פרומפט ישן: s18-s20 3/3; s01-s05 4/5; s06-s10 2/5; עם s11-s17 מ-8.10 ו-s15 שנספר כעובר (הכרעת יובל): **16 מתוך 20 (80%)**, מתחת ל-90%. **פרומפט v2: רק s01-s05 נבדקו, 5/5.** s06-s20 על v2 לא נבדקו, אין ציון על 20. ה-Cron של השער (9.10 05:00 ו-10.10 04:59 UTC) נעצר בשתיהן ב-s01 (`0/10`) |
| תיעוד (PR 60) | ✅ מוזג | `01-system-overview.md`, `02-build-plan.md`, `05-open-questions.md` עודכנו בהוספה |
| חידוש ערוצים ו-token | ✅ תקין ב-10.10 | `google-watch-daily`: `active=3 minutes_to_expiry=7470`; `google-watch-renew-daily`: `renewed=0 failed=0 skipped=0`; `google-token-daily`: `days_since_connected=2 calendars=4` |
| קריאת `probe_log` | ✅ עבדה ב-10.10 | דרך Chrome (Vercel, Storage, Query), SELECT בלבד, ביקשת במפורש. הנחסמה בעבר דרך הדפדפן המובנה |

**מה נחסם ולא עקפתי:** בתחילת העבודה על האיחוד Bash נחסם על ידי ה-classifier (פקודת `git mv` עם `sed -i`, ואז גם `git status`). עצרתי; יובל הוסיף בעצמו כללי הרשאה ב-`.claude/settings.local.json` (קובץ מקומי, לא בריפו). לא נגעתי בהרשאות.

## ✅ מה הוכרע (לא פותחים מחדש)

- **איחוד ל-`api/ops.js`** (יובל אישר כתוכנית; פירוט ב-`01-system-overview.md`, "הכרעות 10.10.2026"). ה-Cron פונה ישירות ל-`/api/ops?task=...`; הכתובות הישנות נשארות כ-`rewrites` לשימוש ידני.
- **מיזוג PR 59 רק אחרי הוכחה של בלוק 3** (יובל בחר באפשרות א).
- **s15 נספר כעובר:** `today_afternoon` על "אחרי בית ספר" מקובל (יובל, 9.10). **הקובץ `data/gate-test-sentences.json` לא שונה** (החלטת Claude, יובל: "אני לא יודע"): שינוי באמצע בדיקה מקשה על השוואה. אפשר לתקן אחרי שהשער נסגר, באישור.
- **אם Gemini לא יעבור:** Claude דרך מנוי Pro (Haiku/Sonnet ב-Sandbox) עם הסיכון הפתוח מול Anthropic; **אם גם הוא לא עובד:** "נכשל" לפי `docs/15`, קוד בלבד. לא בדקתי חלופות אחרות (אין תקציב לשירות בתשלום). זו תשובה לשאלה, לא הכרעה חדשה.

## ⚠️ פתוח / ממתין

1. **השער (הצעד המיידי):** s06-s20 על v2 ב-`gemini-3.5-flash-lite`, שלוש קבוצות של 5 (`from=5`, `from=10`, `from=15`), הפרש דקה לפחות. מכסה: 20 ביום (אפס ב-07:00 UTC, חצות Pacific; נמדד ב-7.10, לא נראה ב-10.10). 9.10 נצרכו לפחות 18 קריאות. סף: 18 מתוך 20. **יובל היה אמור להריץ ב-10:00 בישראל ב-10.10; התוצאה לא נקראה לפני סגירת סשן זה.**
2. **אימות האיחוד בפרודקשן (לא אומת):** שה-`rewrite` מעביר `from`/`count`/`model` (אם הריצה הידנית מחזירה `range=s06-s10`, כן); שקובץ המשפטים נקרא מהנתיב החדש; שהפרויקט על 10 פונקציות (הפריסה הצליחה, לא נספרו). הראיה האמיתית: ריצות 11.10 ב-01:05 (`cron-plan` slot=1), 04:30 (`message-slot`), 04:43 (שלוש שורות `daily-check`), 04:50 (`gate-probe`).
3. **ענף הניסוי `claude/queue-experiment`:** בלוק 3 נסגר, ולכן עכשיו אפשר לשאול על מחיקה. **לא נשאל אישור סופי ולא נמחק.**
4. **תאריכים:** 14.10 חידוש ערוץ (04:43 UTC); 15.10 ו-22.10 ראיות טוקן (`days_since_connected` ב-10.10 הוא 2, ולכן 15.10 ב-04:43 יראה 7; הערוצים המקוריים פוקעים 15.10 09:14 UTC); 25.10 מעבר שעון חורף (לבדוק `message-slot` של 26.10 ב-05:30 UTC ושורת הסגירה ב-19:00 UTC).
5. **מצביעים שבורים: 46** לפי `check-pointers.py` (38 בלי הפתק הזה, ו-8 נוספים הם ההסברים בפתק עצמו שמזכירים את השמות הישנים; בפתק 33 היו כ-21). הוספה: ההעברה ל-`lib/ops/` שברה הפניות ל-`api/cron-plan.js`, `api/daily-check.js`, `api/gate-probe.js`. תוקנו במסמכים החיים (`02-build-plan.md`, `05-open-questions.md`); נשארו **בכוונה** בפתקי מעבר 20 עד 33 ובציטוט הצעה מ-20:19 ב-`stage-order.md` וב-`precedence.md` (רישום היסטורי; המיפוי: `api/X.js` הוא עכשיו `lib/ops/X.js`).
6. **Cron השער על הדגם הלא נכון?** הוא רץ יומית על הדגם שבקוד (נראה `gemini-3.8-flash` ב-9.10) ונעצר ב-503 ב-s01. לא ידוע אם 503 נספר במכסה. הצעה טכנית (דורשת אישור): לשנות את ברירת המחדל של ה-Cron ל-`gemini-3.5-flash-lite`. **לא נעשה.**
7. **נשארו מפתק 33 (בלי שינוי):** אין dedupe ב-`intake`; `scrub()` מכסה גם תאריכים; `google-auth-start` לא בודק פורמט `TOKEN_ENC_KEY`; ערוץ עם `expiration` NULL לא מתחדש; שלב 7 לא התחיל; החלטות יובל (ספי `10`, מחיקת ענפים, חפיפת `full-close` מול `session-manager`, אימות Google על `calendar.events`, 18+ של Gemini, הסוד בדף האפליקציה, הרשאה לכתיבה ליומן).
8. **ענפים:** ב-GitHub וגם מקומית עדיין עשרות ענפי `claude/`; מחיקה רק באישור יובל. בתיקיית `.claude/worktrees/` שני worktrees של סוכנים (`agent-a7660ed49fd1a3b2e`, `agent-a836dbbef58252ac0`) שלא נוקו.

## ▶️ הצעד הבא (מצב Plan)

**ליובל (סוד: `CRON_SECRET`, לא `INTAKE_SECRET`):**
```powershell
$secret = Read-Host "CRON_SECRET"
Invoke-WebRequest -UseBasicParsing -Uri "https://yoman-system.vercel.app/api/gate-probe?from=5&count=5&model=gemini-3.5-flash-lite" -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 320 | Select-Object -ExpandProperty Content
```
ואז אותה פקודה עם `from=10`, ואחרי דקה `from=15`. להדביק את השורות. אם יוצא 429: המכסה נגמרה, מחר. אם `range=` בתשובה לא תואם `from`: ה-rewrite לא מעביר פרמטרים, ואז להשתמש ב-`https://yoman-system.vercel.app/api/ops?task=gate-probe&from=5&count=5&model=gemini-3.5-flash-lite`.

**לסשן הבא (לפי המוטו):**
1. לחשב ציון על 20 (s01-s05 מ-9.10 ב-v2 5/5, ועוד התוצאות החדשות) מול 90%. אם עובר: לקבוע "עבר" או "עבר בהגבלה" לפי `docs/15`. אם נכשל: לפתוח כיוון (3.8-flash שוב בשעה שקטה, שיפור פרומפט נוסף עם זהירות מכוונון למבחן, או Haiku, שנוגע בטוקן ושייך ליובל).
2. לקרוא את שורות 11.10 ב-`probe_log` (דרך Chrome אם מחובר) ולאמת את האיחוד.
3. לשאול על מחיקת `claude/queue-experiment`.
4. תאריכים: 14.10, 15.10, 22.10, 25.10.
5. רק אחרי 1 עד 4: שלב 7 (התקנה על מסך הבית), עם איחוד נוסף אם צריך נקודה חדשה (יש עכשיו שני מקומות פנויים).

## 📁 קבצים

**נוצרו:** פתק זה; `api/ops.js`; `test/ops.test.js`. **הועברו (`git mv`):** `api/cron-plan.js`, `api/daily-check.js`, `api/gate-probe.js` ל-`lib/ops/`. **שונו (קוד):** `lib/ops/gate-probe.js` (`INSTRUCTIONS`, פרומפט v2), `lib/ops/*.js` (נתיבי import ונתיב קובץ המשפטים), `vercel.json` (Cron דרך `/api/ops`, שלושה `rewrites`), `lib/google.js`, `lib/watch-renew.js`, `api/push-send.js` (הערות בלבד), `test/cron-plan.test.js`, `test/daily-check.test.js`, `test/gate-probe.test.js`, `test/watch-renew.test.js`, `test/default-exports.test.js`. **שונו (תיעוד, בהוספה בלבד):** `01-system-overview.md`, `02-build-plan.md`, `05-open-questions.md` (גם תיקון מצביעים). **לא שונו:** `אפיון.md`, `03-permissions-rules.md`, `data/gate-test-sentences.json`. **מקומי בלבד, לא בריפו:** `.claude/settings.local.json` (כללי הרשאה שיובל הוסיף).
