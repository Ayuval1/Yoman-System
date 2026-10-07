# 29 — פתק מעבר: שלב 5א (חיבור Google Calendar, קריאה בלבד) (7.10.2026)

קרא קודם: `CLAUDE.md`, ואז מסמך זה. בא אחרי `28`. מצב עבודה: Plan. לשון פנייה: זכר.

## 📍 איפה עצרנו
| מה | מצב |
|---|---|
| קוד החיבור (PR 23): `lib/google.js`, `api/google-auth-start.js`, `api/google-auth-callback.js`, `api/google-calendars.js`, כפתור "חבר Google" ב-`public/index.html`, שתי טבלאות ב-`db/schema.sql` | ✅ מוזג ונפרס ל-Production (READY, נבדק ב-Vercel) |
| דף מדיניות פרטיות `public/privacy.html` (PR 24) | ✅ נפרס; `/privacy.html` החזיר 200 |
| בדיקות מקומיות | 24 עברו, עם דמה למסד ול-fetch. **לא נוסה מול Google או Neon אמיתיים** |
| Google Cloud | פרויקט `Yoman-System` נוצר, "OAuth configuration created". **פרסום ל-In production נחסם:** "To publish your app, you must complete your configuration on the Branding page". יובל דיווח שהשדות שנראו לו חובה כבר מולאו; לא ברור מה חסר. צילום של דף Branding טרם התקבל |

## ✅ הוכרע
- **סקופים:** `calendar.events` + `calendar.calendarlist.readonly` (Claude, בהאצלה מיובל, 7.10). **ההסקה שהם מספיקים לא אומתה** (הגישה ל-`developers.google.com` חסומה); ההוכחה היא קריאת `/api/google-calendars` אחרי ההסכמה, ומספר האישורים במסך ההסכמה (צפוי שניים).
- **הצפנת ה-refresh token:** AES-256-GCM, מפתח `TOKEN_ENC_KEY` במשתנה סביבה. נוסף משתנה סביבה חדש מעבר לתכנון הקודם.
- כל כתיבה ל-Google תהיה רק באישור יובל (נשאר מ-`02`). **לא נבנה:** כתיבת אירועים, `watch`, סטיית שעון.

## ⚠️ פתוח
1. **Branding:** מה חסר כדי לפרסם. אפשרות לא מאומתת: קישורי App home page / Privacy policy / Terms, Authorized domains. אם `vercel.app` לא מתקבל כדומיין מורשה, החלופה היא Testing עם חידוש כל 7 ימים (סותר את "מינימום פעולות", ומחייב הכרעה של יובל).
2. **טבלאות ב-Neon:** יובל ניסה להריץ את שתיהן בהרצה אחת וקיבל "cannot insert multiple commands". נשלחו שתי הרצות נפרדות. **לא אושר שהורצו.**
3. **משתני סביבה ב-Vercel (Sensitive):** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENC_KEY` (`[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`). `GOOGLE_REDIRECT_URI` אופציונלי. כתובת החזרה שחייבת להירשם ב-Google: `https://yoman-system.vercel.app/api/google-auth-callback`. **לא אושר שהוכנסו.** אחריהם Redeploy.
4. **G3a לא נבדקה:** בקשה בלי סוד ל-`google-auth-start` ול-`google-calendars` צפויה להחזיר 401. הסביבה של Claude חסומה מול `yoman-system.vercel.app`, והכלי של Vercel קיבל 401 של Vercel Authentication (לא של הקוד). נדרשות שלוש פקודות `curl` מהמחשב של יובל (בלי סוד).
5. **הנחות לא מאומתות בקוד** (מסומנות בהערות `lib/google.js`): כל ה-endpoints, פורמט שדה `scope`, `prompt=consent` + `offline` מחזיר refresh token, פורמט שגיאות, עימוד calendarList.
6. פתוחים מ-`28` שעדיין תקפים: השער של Gemini (קבוצה 1 לא רצה), ack, בדיקת מצביעים, ועוד.
7. הדף `privacy.html` כולל את האימייל של יובל כאיש קשר. אם הוא מעדיף אחר, לשנות.

## ▶️ הצעד הבא (מצב Plan)
1. יובל שולח צילום של `https://console.cloud.google.com/auth/branding`; מזהים מה חסר ופותרים.
2. פרסום ל-In production, הוספת הסקופים ב-Data access, יצירת OAuth client (Web), רישום כתובת החזרה.
3. הרצת הטבלאות (שתי הרצות), הכנסת משתני הסביבה, Redeploy.
4. G3a (שלוש פקודות), לחיצה על "חבר Google", בדיקת מספר האישורים, ואז `GET /api/google-calendars` עם `x-intake-secret`. התוצאה היא ההוכחה לסקופ.
5. רק אחר כך: `watch`, סטיית שעון, כתיבה באישור. ובמקביל נשאר שער Gemini פתוח.

## 📁 קבצים
**נוצרו (ב-`main`):** `lib/google.js`, `api/google-auth-start.js`, `api/google-auth-callback.js`, `api/google-calendars.js`, `public/privacy.html`. **שונו:** `db/schema.sql`, `public/index.html`. **נוצר בסגירה:** פתק זה.
**לא שונו בכוונה:** `אפיון.md`, `03-permissions-rules.md`, `api/intake.js`, `api/cron-plan.js`, `vercel.json`, `02-build-plan.md` ו-`05-open-questions.md` (העדכון שלהם נשאר לסגירת השלב, אחרי אישור יובל).
