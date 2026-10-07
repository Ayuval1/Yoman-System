# 30 — פתק מעבר: שלב 5א נסגר ואומת (חיבור Google Calendar, קריאה בלבד) (7.10.2026)

קרא קודם: `CLAUDE.md`, ואז מסמך זה. בא אחרי `29` ומחליף את "הצעד הבא" שם. מצב עבודה: Plan. הפתק בנוי בחמשת השדות הקבועים של `seder-usgira`. לשון פנייה: זכר.

## 📍 איפה עצרנו

| מה | מצב | מה הוכח, ומאיפה |
|---|---|---|
| Google Cloud, דף Branding | ✅ | חסרו שלושה שדות: App home page, Privacy policy link, Authorised domain (לא היו מסומנים בכוכבית). מולאו: `https://yoman-system.vercel.app`, `https://yoman-system.vercel.app/privacy.html`, ודומיין מורשה `yoman-system.vercel.app`. נשמר, ואחרי טעינה מחדש של הדף הערכים נשארו (צילום מסך) |
| Google Cloud, Audience | ✅ **In production** | "Publish app" ואז Confirm. הניסיון הראשון החזיר "An error updating your app has occurred"; **Retry אחד עבר**. הדף מציג "In production" (צילום מסך) |
| Google Cloud, Data access | ✅ | נשמרו שני סקופים והופיעו בטעינה מחדש: `calendar.calendarlist.readonly` (לא רגיש) ו-`calendar.events` (**רגיש**, "Approval required"). הדף מציג "Your app requires verification". **לא הוגשה בקשת אימות** |
| Google Cloud, OAuth client | ✅ | נוצר "Web client 1", סוג Web application, נראה ברשימת ה-Clients (תאריך יצירה 7.10.2026). כתובת חזרה מורשית: `https://yoman-system.vercel.app/api/google-auth-callback`. בלי JavaScript origins |
| Vercel, משתני סביבה | ✅ | שלושה משתנים קיימים ב-Production, מסוג Sensitive: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENC_KEY` (נבדקו שמות וסוגים בלבד; **הערכים לא נקראו**) |
| Vercel, פריסה | ✅ | Redeploy של פריסת Production האחרונה (`24ec47b`). `dpl_9ySVEPxbEiAWcqCXXbT9Lgc3qZjY`, מצב READY, מופנה ל-`yoman-system.vercel.app`. נעשה דרך `vercel redeploy` ואומת ב-`list_deployments` |
| API חי, בלי סוד | ✅ | `GET /api/google-calendars` מחזיר `{"reason":"unauthorized"}`. `GET /api/google-auth-start` מחזיר `{"reason":"method_not_allowed"}` (הוא מקבל POST בלבד, לפי הקוד). נבדק בדפדפן של Claude, לא ב-`curl` |
| החיבור עצמו | ✅ **לפי דיווח יובל** | יובל לחץ "חבר Google" (הכפתור ביקש את סוד הקליטה), ראה **שני** אישורים במסך ההסכמה, אישר, והריץ ב-PowerShell את `GET /api/google-calendars` עם הסוד. **דיווח: "עובד".** ⚠️ **אני לא ראיתי את התוצאה ולא את מספר היומנים** (ביקשתי שלא יעתיק את השמות) |

**מה זה מוכיח, כהסקה מהקוד (`api/google-calendars.js`, שורות 1-6):** הנקודה מרעננת access token מתוך `google_credentials`, מפענחת אותו, וקוראת את `calendarList`. אם היא החזירה רשימה, אז גם שתי הטבלאות החדשות קיימות ב-Neon, ה-refresh token נשמר מוצפן ומתפענח עם `TOKEN_ENC_KEY`, והסקופים מספיקים לקריאת רשימת היומנים. **ההסקה תלויה בכך שהתוצאה שיובל ראה הייתה רשימה ולא הודעת שגיאה בעברית.** לא אימתתי את הטבלאות ישירות מול Neon (אין לי גישה למסד).

## ✅ מה הוכרע (לא פותחים מחדש)
- **פרסום ל-In production** בלי אימות, לשימוש אישי (יובל אישר בצ'אט: "כן, תלחץ על Publish app", 7.10). זה ממשיך את ההכרעה מ-29.9.
- **הסקופים `calendar.events` + `calendar.calendarlist.readonly`:** הוחלט בהאצלה (Claude, 7.10, פתק 29), ואישור יובל לסימונם בקונסולה ניתן בצ'אט ב-7.10. **ההסקה שהם מספיקים לקריאה אומתה** (ראה למעלה, בהסתייגות). **לא אומת** שהם מספיקים לכתיבה, כי כתיבה לא נבנתה.
- **הצפנת ה-refresh token:** AES-256-GCM, מפתח `TOKEN_ENC_KEY` (מ-29).
- **Terms of Service נשאר ריק.** Google לא דרשה אותו בשמירה. לא נבנה דף.
- **כל כתיבה ל-Google רק באישור יובל** (ממשיך מ-`02`). **לא נבנה:** כתיבת אירועים, `watch`, סטיית שעון.

## ⚠️ פתוח / ממתין להכרעה
1. **אימות של Google על `calendar.events`.** הקונסולה אומרת "Your app requires verification" ו"otherwise users will see an unverified app screen". **לא ידוע:** האם Google תכפה אימות בהמשך על אפליקציה שכבר ב-Production, ומה יקרה לטוקן אם כן. נכון לעכשיו יובל מקבל מסך "Google hasn't verified this app" ועובר עם Advanced ו-Continue. תקרה: 100 משתמשים לכל חיי הפרויקט (`0 users / 100` בדף Audience). ההכרעה ב-`01` (29.9) הסתמכה על "שימוש אישי פטור מאימות" ([Google](https://support.google.com/cloud/answer/13464323?hl=en)); **לא אומת מחדש שהפטור חל גם על סקופ רגיש.**
2. **האם ה-refresh token נשאר תקף מעבר ל-7 ימים.** In production אמור לפתור זאת, אבל אין לכך הצהרה מפורשת בתיעוד שנקרא (`open-items.md`, "Google In production"). **ייכתב "אומת" רק אחרי בדיקה ביום 8 וביום 15** (`02`, פרק 7 שלב 5): להריץ שוב `GET /api/google-calendars`.
3. **התוצאה של הקריאה לא נראתה לי** (ראה למעלה). לבקש מיובל מספר יומנים בלבד, או לבדוק את `google_credentials.last_error`.
4. **G3a לא נבדקה כפי שהוגדרה:** שלוש בקשות `curl` בלי סוד. נבדקו שתיים בדפדפן. `google-auth-callback` לא נבדק בלי חיבור מוקדם (בקשה בלי `state` תקין).
5. **הטבלאות ב-Neon** לא אומתו ישירות; יובל אמר שהריץ. שאילתת אימות מוצעת: `select table_name from information_schema.tables where table_schema='public' and table_name like 'google_%';` (צפויות שתיים: `google_oauth_states`, `google_credentials`).
6. **הסוד בדף:** `window.prompt` ו-`localStorage` (הנחה, ממתינה לאישור, מ-`28`). **הכפתור "חבר Google" משתמש באותו מנגנון**, ולכן ההכרעה חלה גם עליו.
7. **`vercel` CLI במחשב של יובל התחבר לחשבון בזמן הסשן** (נפתח חלון התחברות בדפדפן, והוא הסתיים בהצלחה). אם זה לא רצוי: `vercel logout`.
8. **מייל איש הקשר בדף הפרטיות** (`public/privacy.html`) הוא של יובל. נשאר כפי שהוא.
9. פתוחים מ-`28` ו-`29` שעדיין תקפים: השער של Gemini (קבוצה 1 לא רצה), ack, בדיקת מצביעים (21 שבורים), `maxDuration`, הנחות `lib/google.js` שלא אומתו (פורמט שדה `scope`, עימוד `calendarList`, שאר ה-endpoints).

## ▶️ הצעד הבא (מצב Plan)
1. **להחליט עם יובל מה הבא:** (א) חזרה לשער של Gemini (קבוצה 1 בהרצה, `28`); (ב) המשך שלב 5: `watch` וסטיית שעון, ואז כתיבה באישור; (ג) לפתור את `ack`. אין לי המלצה אמיתית: אין נתון שמכריע בין השלושה.
2. **בדיקת ימים 8 ו-15:** `GET /api/google-calendars` ביום 8 (15.10.2026) וביום 15 (22.10.2026), כשההסכמה ב-7.10 היא יום 0. **אם נכשל ב-`invalid_grant`**, ה-refresh token פג וההסקה שבסעיף 2 למעלה שגויה.
3. **לפני כתיבה ל-Google:** להכריע אם להגיש אימות על `calendar.events` או להישאר לא מאומתים.

## 📁 קבצים
**נוצר בסגירה:** פתק זה. **שונו:** `docs/01-foundation/01-system-overview.md` (סעיף 7.10), `02-build-plan.md` (שורות 0 ו-5 במפת פרק 7), `05-open-questions.md` (שורה חדשה ועדכון "החלטה 1"), `docs/02-rules/03-google-calendar-rules.md` (סימון ההסקה כמאומתת בחלקה), `docs/03-working-method/24-working-with-yuval.md` (סעיף 7.10), `.claude/skills/yoman-builder/reference/open-items.md`, `ops-commands.md`, `stage-order.md`. **לא שונו:** קוד האפליקציה (`api/`, `lib/`, `public/`, `db/`), `vercel.json`, `אפיון.md`, `03-permissions-rules.md`.

**שינויים בחשבונות של יובל, בלי שינוי בקוד (באישורו בצ'אט):** Google Cloud: שדות Branding, פרסום ל-In production, שני סקופים, OAuth client. Vercel: שלושה משתנים (יובל הכניס), Redeploy של Production (בוצע על ידי Claude באישור "נסה עכשיו").

**איך עבדתי:** Claude in Chrome (הדפדפן של יובל, מחובר ל-Google) לקונסולה; הדפדפן המובנה לא היה מחובר. מצב הדף אומת בצילומי מסך אחרי כל שמירה. **לא צילמתי את המסך אחרי יצירת ה-client**, כדי לא לראות את ה-Client Secret.
