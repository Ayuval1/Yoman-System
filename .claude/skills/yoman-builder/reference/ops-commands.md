<div dir="rtl">

# ספר פקודות בדיקה — לאימות שלב

> נאסף ב-6.10.2026 מפקודות שרצו בפועל בשלבים 1 ו-2. **אם `docs/` או `CLAUDE.md` שונים מהקובץ הזה, הם גוברים** (ראה `precedence.md`).
> כל פקודה מסומנת: **אומת** = רצה בפועל והחזירה את התוצאה שכתובה, **לא אומת** = לא הורצה בנוסח הזה.
> **שימוש:** שלב 5 של `SKILL.md` ("הוכח שזה עובד"). מצטטים את הפלט האמיתי; מה שלא הורץ נכתב "לא נבדק".

## איך מדווחים (תבנית קבועה)

| מה נבדק | איך | תוצאה | מצב |
|---|---|---|---|
| ... | פקודה / לוג / שאילתה | הפלט המצוטט | הוכח / לא נבדק / הנחה |

הכלל: מסקנה רק ממה שנראה. **היעדר שורה בלוג אינו הוכחה שבקשה לא הגיעה** (ראה "לוגים של Vercel").

## 1. נקודת הקליטה בלי סוד (בטוח להרצה, אין צורך בסוד)

```bash
curl -s -o /dev/null -w "GET intake: %{http_code}\n" https://yoman-system.vercel.app/api/intake
curl -s -o /dev/null -w "POST בלי סוד: %{http_code}\n" -X POST -F "text=x" https://yoman-system.vercel.app/api/intake
```

- **צפוי:** `405` ל-GET, `401` ל-POST בלי סוד. **אומת** (6.10.2026).
- **מה זה מוכיח:** הפונקציה חיה ודוחה נכון. **מה זה לא מוכיח:** שהסוד נכון. בלי הסוד אני רואה 401 גם כשהכול תקין.
- שים לב: ה-POST הזה לא נשמר במסד, כי נדחה לפני השמירה.

## 2. קליטה אמיתית עם הסוד (יובל מריץ, לא אני)

אני לא מכיר את `INTAKE_SECRET` ואסור לי לדעת אותו (`CLAUDE.md:118`). יובל מריץ ב-PowerShell; הפקודה מבקשת את הסוד בהקלדה מוסתרת:

```powershell
$p=[Net.NetworkCredential]::new('',(Read-Host -AsSecureString 'secret')).Password; curl.exe -s -w " [%{http_code}]" -X POST https://yoman-system.vercel.app/api/intake -H "x-intake-secret: $p" -F "text=step1 test"
```

- **צפוי:** `[200]` והמילה "התקבל" (בעברית במסוף היא עלולה להיראות כסימנים משונים). `[401]`: הסוד שגוי. `[500]`: לבדוק את הלוגים. **אומת** (5.10.2026, יובל החזיר 200).
- אחרי זה מאמתים במסד (סעיף 4) שהשורה נשמרה.

## 3. לוגים של Vercel (דרך כלי ה-MCP של Vercel)

פרמטרים שעבדו: `teamId = team_TjS0apQAUn0U3rB7Dx3BCEFL`, `projectId = prj_6p1Bbg0tdnWGRNCTuxB1TWVAzVTx` (מזהים, לא סודות; אם משתנים: `list_teams`, `list_projects`).

- **תמיד לציין `environment: "production"`** ו-`since` קצר (`30m`, `1h`). **אומת:** עם הסינון הופיעו כל הבקשות (`POST /api/intake 200` ו-`401`).
- **אזהרה:** שאילתה בלי סינון `environment` לא הראתה בקשות ששלחתי. **לא ברור אם הסינון הוא הסיבה.** לכן: קיום שורה = הוכחה; **היעדר שורה = לא הוכחה.**
- פריסה: `list_deployments` ואחריו `get_deployment` מראים אם הפריסה `READY` ובאיזו סביבה. **אומת** בשלב 1.
- לוגי Vercel ב-Hobby נשמרים **שעה בלבד** (`open-items.md`). לכן `probe_log` ו-`call_log` במסד.
- **תיקון (10.10.2026): `get_runtime_logs` של ה-MCP קורא פלט `console` בלבד, בלי קודי סטטוס.** `api/intake.js` מדפיס רק שגיאות, ולכן קליטה תקינה לא נראית בו (ריק אינו עדות). **הכלי הנכון לשאלה "הגיעה בקשה?":** `vercel logs --project yoman-system --scope yuval-amars-projects --environment production --no-branch --since 1h`. **אומת 10.10.2026:** `POST /api/intake 200`. השעה בשעון ישראל. פירוט: `.claude/skills/vercel-fast-check/`.

## 4. שאילתות במסד (עורך ה-Query של Neon, בתוך Vercel)

הדרך: Vercel ← הפרויקט `yoman-system` ← Storage ← `neon-orange-anchor` ← Query. הקישור הישיר: `https://vercel.com/yuval-amars-projects/yoman-system/stores`.
**קישור ישיר לעורך עצמו** (נצפה ב-10.10.2026, חוסך ארבעה קליקים): `https://vercel.com/yuval-amars-projects/yoman-system/integrations/neon/icfg_vFBDxKJVJmI11gZs4OoewHCU/resources/storage/store_vD2YGYvK5bTxtwo2/query`. מסלול מלא ב-`.claude/skills/vercel-fast-check/reference/chrome-neon-playbook.md`.

**כללי העורך (אומתו בשלב 1):** פקודה אחת בכל הרצה (כמה פקודות נכשלות עם `cannot insert multiple commands into a prepared statement`). מצב "Read-only" נשאר דלוק בשאילתות קריאה. מכבים אותו רק להרצת סכמה, באישור, ומחזירים אחר כך.

| מטרה | שאילתה | מצב |
|---|---|---|
| 5 השורות האחרונות שנקלטו | `select channel, sender, raw_content, length(raw_content) as len, received_at from sources order by received_at desc limit 5;` | **אומת** (6.10.2026) |
| האם בטקסט יש `\r` (שורות חדשות) | `select raw_content like E'%\r%' as has_cr, length(raw_content) as len, length(replace(raw_content, E'\r', '')) as len_without_cr from sources order by received_at desc limit 1;` | **אומת** (`has_cr=t`, 33 מול 31) |
| האם ה-Cron רץ | `select * from probe_log limit 5;` | **לא אומת** (לא הורצה; Cron ראשון היה אמור לרוץ 05:00 UTC ב-6.10) |
| מספר עמודות בכל טבלה | `select table_name, count(*) from information_schema.columns where table_schema='public' group by 1 order by 1;` | **לא אומת** בנוסח הזה (בשלב 1 הורצה שאילתה דומה; הנוסח המדויק לא נשמר) |

**איך מציגים תוצאה:** צילום מסך (תוצאה מופיעה בצילום, לא תמיד בטקסט הדף). בהודעות בדיקה של יובל עצמו אין בעיית פרטיות; בהודעות של אנשים אחרים: דפוסים בלבד (`CLAUDE.md:119-120`).

## 5. בדיקת מצביעים (קבצים והפניות שורה)

```bash
python .claude/skills/yoman-builder/scripts/check-pointers.py            # סיכום ורשימת שבורים
python .claude/skills/yoman-builder/scripts/check-pointers.py --lines    # גם תחילת כל שורה מוצבעת
```

- קורא בלבד; פלט זהה בכל הרצה (**אומת**). קוד יציאה 1 אם יש שבורים.
- **מצב מוכר (6.10.2026, אחרי סידור `docs/`):** 9 שבורים: 3 קבצים שאינם בריפו (נתוני בית הספר ופתק 22), ו-6 הערות בקבצי האפליקציה (`api/intake.js`, `db/schema.sql`) שמפנות לנתיבים הישנים של `docs/`. קבצי האפליקציה לא שונו בכוונה.
- **גבול:** הוא מדלג בכוונה על הפניות לא ברורות (דיוק על חשבון כיסוי). הפניה לקובץ הלא נכון בשם תקף נתפסת רק בעין.

## 6. מה לבדוק בכל שלב (קיצור)

| שלב | בדיקה | סעיף כאן |
|---|---|---|
| קליטה | 401 בלי סוד, 200 עם סוד, שורה במסד | 1, 2, 4 |
| Cron | שורה ב-`probe_log` | 4 |
| פריסה | `READY` ב-Production | 3 |
| אחרי כל שינוי קבצים | מצביעים | 5 |

## 7. Vercel: שמות משתני סביבה ו-Redeploy (7.10.2026)

| מה | פקודה | מצב |
|---|---|---|
| רשימת שמות וסוגים של משתני סביבה (בלי ערכים) | `MSYS_NO_PATHCONV=1 vercel api "/v10/projects/yoman-system/env"` ואז לסנן `key`, `type`, `target` | **אומת 7.10.2026** (הכלי `filter_project_envs` ב-Claude החזיר 403). ב-Git Bash בלי `MSYS_NO_PATHCONV=1` הנתיב מתעוות ("Endpoint must start with /") |
| Redeploy של Production אחרי הוספת משתנה | `vercel redeploy <כתובת הפריסה האחרונה> --target production` | **אומת 7.10.2026** (הבנייה אורכת כ-20 שניות). לאמת אחר כך ב-`list_deployments` (`READY`, `target: production`). פעולה שפורסמת ל-Production: באישור יובל |
| בדיקת Google בלי סוד | `GET /api/google-calendars` מחזיר `unauthorized`; `GET /api/google-auth-start` מחזיר `method_not_allowed` | **אומת 7.10.2026** בדפדפן. עם הסוד: רק יובל מריץ, ב-PowerShell |

## 8. בדיקות קבועות ושאילתות במסד דרך Vercel (7.10.2026, סשן שני)

| מה | איך | מצב |
|---|---|---|
| חבילת הבדיקות | `node --test "test/*.test.js"` (502 בדיקות). `node --test test/` נכשל ב-Node 24 | **אומת 7.10.2026** |
| שאילתה או סכמה במסד | Vercel ← Storage ← Query. כיבוי מתג Read-only רק לפקודות CREATE (פקודה אחת בכל הרצה), והחזרתו אחר כך | **אומת** ליצירת `google_watch_channels` |
| אימות טבלה | `select count(*) from information_schema.columns where table_name='google_watch_channels';` צפוי 12 | **אומת** |
| קריאת `probe_log` מהדפדפן של Claude | נחסמה בסיווג | **לא אומת**; יובל קורא |
| `gate-probe` ו-`daily-check` | דורשים `CRON_SECRET` (לא `INTAKE_SECRET`); בכל פקודה לכתוב את שם הסוד | **אומת** (401 בלעדיו) |

## 9. בדיקות אחרי שלב 5ג (8.10.2026)

| מה | איך | מצב |
|---|---|---|
| קריאת `probe_log` לפי זמן | `select * from probe_log order by at desc limit 10;` **לא `ORDER BY 1`**: העמודה הראשונה היא `id` (uuid אקראי), והמיון לא לפי זמן | **אומת** (8.10.2026, טעות בפועל) |
| שורת החידוש היומית | `google-watch-renew-daily` ב-`probe_log`, פורמט `renewed=N failed=N skipped=N [reason=code]`. שורה שלישית לצד `google-token-daily` ו-`google-watch-daily` | נבנה בקוד, **לא נראה בפרודקשן**; ראשון צפוי 14.10 |
| קריאת ערוצים | `select expiration, created_at, notification_count, last_resource_state, stopped_at from google_watch_channels order by created_at desc;` (בלי `calendar_id`, כדי לא להציג מזהי יומנים) | שמות העמודות לפי `db/schema.sql`; השאילתה בנוסח הזה **לא הורצה** |
| POST ל-endpoint מה-iPad | לשכפל את הקיצור הקיים `יומן-בדיקה` (כבר מחזיק את הכותרת `x-intake-secret`), לשנות כתובת (למשל `/api/google-watch-start`), שיטה POST. בדיקת "התקבל" המובנית תציג "לא נשלח" כוזב: צפוי | **אומת** ל-`google-watch-start` ב-8.10.2026 |
| GET עם `CRON_SECRET` מה-iPad (למשל `gate-probe?from=0`) | קיצור משוכפל, כותרת `Authorization: Bearer <CRON_SECRET>` | **לא נוסה** |
| `gate-probe`: ניסיון חוזר ובחירת דגם (8.10.2026) | על 5xx: עד שני ניסיונות חוזרים אחרי 20 ו-40 שניות. `?model=gemini-3.5-flash-lite` מריץ דגם אחר (רשימה סגורה; ברירת מחדל `gemini-3.8-flash`). הריצה ארוכה יותר, עד 300 שניות | **לא נוסה בפרודקשן** |
| חבילת הבדיקות | `node --test "test/*.test.js"` | 528 עוברות בענף 5ג (8.10.2026) |

</div>
