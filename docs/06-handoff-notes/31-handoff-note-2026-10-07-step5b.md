# 31 — פתק מעבר: שלב 5ב (watch) נבנה ונפרס; בדיקות קבועות ו-daily-check (7.10.2026, סשן שני)

קרא קודם: `CLAUDE.md`, ואז מסמך זה. בא אחרי `30` ומחליף את "הצעד הבא" שם. מצב עבודה: Plan. הפתק בנוי בחמשת השדות הקבועים של `seder-usgira`. לשון פנייה: זכר.

## 📍 איפה עצרנו

| מה | מצב | מה הוכח, ומאיפה |
|---|---|---|
| שלב 5ב: `api/google-webhook.js`, `api/google-watch-start.js`, פונקציות watch ב-`lib/google.js`, טבלת `google_watch_channels` | ✅ נבנה ונפרס | PR 27 מוזג; פריסת Production במצב READY ב-`main` (`a38699f`) |
| הטבלה והאינדקס ב-Neon | ✅ | נוצרו ב-7.10 דרך Vercel ← Storage ← Query (מתג Read-only כובה לשתי פקודות CREATE וחזר). אימות: `information_schema`, 12 עמודות |
| טוקן הערוץ | ✅ בקוד | HMAC-SHA256 על `channel_id` עם תת-מפתח מ-`TOKEN_ENC_KEY`; אין משתנה סביבה חדש. נמדד רק בבדיקות הקוד |
| G3: התראה תוך כ-60 שניות מעריכת אירוע | ❌ **לא נעשה** | `google-watch-start` לא הורץ: הוא דורש `INTAKE_SECRET` ורק יובל מקליד אותו |
| Google מקבלת webhook על `*.vercel.app` | **לא אומת** | במדריך (developers.google.com/workspace/calendar/api/guides/push, נקרא 7.10) אין הגבלת דומיין, אבל זו לא בדיקה חיה |
| בדיקות חיות בלי סוד | ✅ | 17 בדיקות על הפרודקשן, כולן כצפוי: 405/404/401/200; `sw.js` 404 בכוונה; ה-webhook לא מדליף. בתשובות קיימת רק `Strict-Transport-Security`; `X-Content-Type-Options` חסרה |
| חבילת בדיקות קבועה (PR 28) | ✅ | `test/`, `node:test`, 502 בדיקות. `node --test "test/*.test.js"` (`node --test test/` נכשל ב-Node 24) |
| `api/daily-check.js` + Cron שלישי `30 4 * * *` UTC (PR 29) | ✅ נפרס | יובל אישר בצ'אט. כותב ל-`probe_log` שתי שורות ביום: `google-token-daily` ו-`google-watch-daily`. רישום בלבד, בלי חידוש. דורש `CRON_SECRET` ב-Vercel (אחרת 401) |
| האם ה-Cron רץ בפרודקשן | **לא אומת** | קריאת `probe_log` בדפדפן נחסמה בסיווג; `vercel link` ו-`vercel env ls` נחסמו. Neon לא נגיש בדפדפן של Claude |
| `authTagLength: 16` ב-`lib/google.js` (ענף `claude/fix-authtag-crontest`) | ✅ בענף | יובל אישר. אומת שטוקנים ישנים וחדשים תואמים הדדית; בדיקת ה-cron עודכנה. המיזוג ב-`main` בסגירה זו |
| השער (שלב 3), קבוצה 1 | ❌ לא רץ | ניסיון של יובל החזיר 401: `gate-probe` דורש `CRON_SECRET`, סוד אחר מ-`INTAKE_SECRET`. יובל אמר שיש לו `CRON_SECRET` |
| מכסת Gemini | ✅ נסגר לפי מקור | RPD מתאפס בחצות שעון פסיפיק, לפי פרויקט (ai.google.dev/gemini-api/docs/rate-limits). קבוצה 1 (10 קריאות) נכנסת |
| Refresh token מעבר ל-7 ימים | **לא אומת** | דף התמיכה support.google.com/cloud/answer/15549945 לא מצהיר על In production (רק Testing = 7 ימים) |

## ✅ מה הוכרע (לא פותחים מחדש)
- **טוקן הערוץ נגזר מ-`TOKEN_ENC_KEY`**, בלי משתנה סביבה חדש.
- **watch רק ליומנים owner או writer.**
- **`daily-check` רישום בלבד, בלי חידוש אוטומטי** עד שנמדד אורך חיי ערוץ.
- **בדיקות קבועות עם `node:test`**, בלי חבילות.
- **`authTagLength: 16`** (יובל אישר). פירוט ונימוקים: `01`, סעיף "הכרעות שלב 5ב".
- **נפסל:** משתנה סביבה חדש ל-HMAC; חידוש אוטומטי עכשיו; watch ליומנים מנויים לקריאה בלבד.

## ⚠️ פתוח / ממתין להכרעה
1. **G3 ו-webhook על `*.vercel.app`**: לא אומתו.
2. **אורך חיי ערוץ watch**: Google לא חושפת; אין חידוש אוטומטי; כל יומן צריך מנוי משלו.
3. **האם ה-Cron רץ**: לא אומת. נדרשת שורה ב-`probe_log` ו-`CRON_SECRET` מוגדר.
4. **השער לא רץ.**
5. **ימים 8 ו-15** (15.10, 22.10): `daily-check` אמור לייצר ראיה מ-8.10 בערך 04:30 UTC (דיוק Hobby בתוך השעה, לא אומת).
6. **תצפיות מהבדיקות, לא תוקנו ולא הוכרעו:** ל-`intake` אין הגבלת גודל ואין dedupe, והוא מקבל רווחים בלבד; `scrub()` ב-`gate-probe` מכסה גם תאריכים כמו 10-10-2026; `google-auth-start` לא בודק פורמט `TOKEN_ENC_KEY`; ב-`google-watch-start`, `expiration` ענק זורק ב-`toISOString` והערוץ נפתח אצל Google אבל לא נשמר; `google-webhook` סופר פעמיים מספר הודעה זהה חוזר.
7. **שעות ה-Cron ב-`vercel.json`** (05:00 ו-17:00 UTC) נסחפות אחרי 25.10 (08/20 הופך 07/19) ושונות מ-07:30 ו-21:00.
8. פתוחים מקודם: אימות Google על `calendar.events`, ack, `maxDuration` של `gate-probe`.

## ▶️ הצעד הבא (מצב Plan)
1. **יובל מריץ `google-watch-start`** עם **`INTAKE_SECRET`** (הסוד של כפתור "חבר Google"), ואז עורך אירוע אחד ביומן; בודקים שהגיעה התראה תוך כ-60 שניות (G3). בלי סודות בצ'אט.
2. **יובל מריץ את קבוצה 1 של השער** עם **`CRON_SECRET`** (לא `INTAKE_SECRET`), ב-PowerShell; הפקודה מבקשת את הסוד בהקלדה מוסתרת. הפקודה מ-`28`, בלי שינוי:
```powershell
$s = Read-Host "CRON_SECRET" -AsSecureString; $p = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)); [Console]::OutputEncoding = [Text.Encoding]::UTF8; Invoke-WebRequest -Method GET -Uri "https://yoman-system.vercel.app/api/gate-probe?from=0" -Headers @{Authorization="Bearer $p"} -UseBasicParsing -TimeoutSec 300 | Select-Object StatusCode, Content | Format-List
```
3. **מחר: לבדוק ב-`probe_log`** את שורות `google-token-daily` ו-`google-watch-daily` של `daily-check` (דרך Query ב-Vercel, בקריאה בלבד). שורה = הוכחה שרץ; היעדר שורה אינו הוכחה.
4. **החלטות שממתינות ליובל:** ack; השער כ-Cron יומי (`/api/gate-probe?from=0`, Vercel שולח `CRON_SECRET` לבד, נותן גם את בדיקת 14 הימים של `15`, עולה 10 מתוך 20 קריאות Gemini ביום; דורש שינוי ב-`vercel.json`); כותרת `X-Content-Type-Options` ב-`vercel.json`; שעות ה-Cron מול מעבר השעון. **אין לי המלצה אמיתית בין חלקן: אין נתון שמכריע.**

## 📁 קבצים
**נוצר בסגירה:** פתק זה. **שונו (בהוספה בלבד):** `docs/01-foundation/01-system-overview.md` (סעיף 5ב), `02-build-plan.md` (שורה 5 במפת פרק 7), `05-open-questions.md` (סעיף 7.10 שני), `docs/03-working-method/24-working-with-yuval.md` (סעיף 7.10 שני), `.claude/skills/yoman-builder/reference/open-items.md`, `stage-order.md`, `ops-commands.md`. **לא שונו:** `אפיון.md`, `03-permissions-rules.md`, ובסגירה זו גם לא קוד האפליקציה.

**איך עבדתי:** Claude in Chrome ולוח הבקרה של Vercel לצעדי מסד; בדיקות חיות בלי סוד; סודות לא הוקלדו על ידי. נחסמו ולא עקפתי: `vercel link`, `vercel env ls`, קריאת `probe_log` בדפדפן.
