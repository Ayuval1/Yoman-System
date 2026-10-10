<div dir="rtl">

# ממשקים: מה כל כלי רואה ומה לא

> נאסף ב-10.10.2026. כל שורה מסומנת: **אומת** (רץ בפועל בסשן הזה או בסשן מתועד), **תיעוד** (נכתב בתיעוד של Vercel, לא הורץ), **לא נבדק**. אם `docs/` או `ops-commands.md` שונים מכאן, הם גוברים.

## טבלה

| ממשק | רואה | לא רואה | מגבלות ומלכודות | מצב |
|---|---|---|---|---|
| `vercel logs` (CLI) | **רשומות בקשה**: זמן, נתיב, שיטה, סטטוס | מה נשמר במסד; פלט `console` מלא (מקוצר, `--expand` מציג) | שעון מקומי (ישראל), לא UTC. ב-Hobby הלוגים נשמרים שעה. ללא קישור פרויקט צריך `--project` ו-`--scope` | **אומת 10.10.2026**: `21:31:04 POST /api/intake 200` ו-`21:00:00 POST /api/queues/deliver 200` |
| `get_runtime_logs` (MCP של Vercel) | אירועי תצפית: מה שהקוד מדפיס (`console`) | **קודי סטטוס**, בקשות תקינות שלא הדפיסו כלום | `api/intake.js` מדפיס רק שגיאות (שורות 47, 85, 92), לכן קליטה שהצליחה לא נראית. חלון מעל שעה מחזיר 400 ב-Hobby. הסכמה בפועל חסרה `statusCode` שמופיע בתיעוד | **אומת** שהוא מטעה לשאלה "הגיעה בקשה" |
| Neon Query (Vercel, Storage) | מה שנשמר: כל טבלה | בקשות שנדחו לפני השמירה (401, 405) | פקודה אחת בכל הרצה. מתג Read-only. הזמנים ב-UTC | **אומת** |
| `list_deployments` (MCP) | פריסות, מצב `READY`, קומיט | | `target: production`, `limit: 3` מספיק | **אומת** |
| `vercel crons run <נתיב>` | מפעיל Cron שכבר פרוס בפרודקשן | | קורא הגדרות מהפריסה, לא מ-`vercel.json` המקומי. לא ידוע איך הנתיב עם `?task=...` מותאם. תופעות לוואי אמיתיות | **תיעוד**, לא נבדק |
| `vercel curl <נתיב>` | בקשה לפריסה (גם מוגנת) | | הסוד עדיין נדרש בכותרת | **תיעוד**, לא נבדק |
| `vercel api <נתיב>` | כל ה-REST API של Vercel | | ב-Git Bash צריך `MSYS_NO_PATHCONV=1` | **אומת** (`ops-commands.md` סעיף 7) |
| `vercel env pull` | | | כותב סודות לקובץ מקומי, נוגד את ברזלי הפרויקט | **לא להריץ** |

## כללי קריאה

- **שעות:** `vercel logs` מציג שעון ישראל. המסד מציג UTC. 21:31 מקומי הוא 18:31 UTC. ההפרש בחורף ובקיץ שונה, ולכן בודקים את התאריך לפני שמשווים.
- **ריק:** שני סוגי "אין תוצאה" נראים שונה בכלי ה-MCP. "No logs found" פירושו שהשאילתה עברה ולא נמצא כלום. "query failed ... this is an error, not an absence" פירושו שהשאילתה לא רצה. לא מבלבלים ביניהם.
- **מי עונה על מה:** הגיעה בקשה = `vercel logs`. מה נשמר = Neon. פריסה = `list_deployments`.
- **מזהים** (לא סודות): `teamId = team_TjS0apQAUn0U3rB7Dx3BCEFL`, `projectId = prj_6p1Bbg0tdnWGRNCTuxB1TWVAzVTx`. אם משתנים: `list_teams`, `list_projects`.

## מקורות

- תיעוד `vercel logs`, `vercel crons run`, `vercel curl`, `vercel api`: https://vercel.com/docs/cli (נקרא דרך `search_vercel_documentation`, 10.10.2026).
- שמירת לוגים ב-Hobby: הודעת השגיאה של `get_runtime_logs` ("Hobby retains 1 hour"), ו-`ops-commands.md` סעיף 3.

</div>
