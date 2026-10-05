# נתוני אימונים — Garmin. חוקים תפעוליים

סטטוס: **הוכרע 28.9.2026 — פרק 5, שלב 1. באישור יובל.** ✅ הוכרע ואושר · ⏸ ממתין · ⚠️ לא אומת · 🔬 בדיקה חיה.

המקור המחייב: אפיון, סעיף 5 (*"TrainingPeaks מתוכנן לשמש מקור חיצוני לנתוני אימונים שבוצעו בפועל"*) וסעיף 9 (*"כאשר TrainingPeaks מספק נתון אמין על ביצוע, אין צורך לשאול שוב את יובל"*). **הכוונה של האפיון נשמרת — מקור חיצוני לאימון שבוצע. המקור עצמו הוחלף**, כי ל-TrainingPeaks אין דרך מותרת להתחבר אליו (ראה "מה נפסל").

---

## ✅ ההכרעה

> **נתוני האימונים נקראים מ-Garmin Connect, דרך הספרייה הלא-רשמית `python-garminconnect`, ישירות מהשרת. בלי שירות צד שלישי באמצע.**

**מה נקרא:**

| מה | מאיפה ב-Garmin | הערה |
|---|---|---|
| **אימונים שבוצעו** | רשימת הפעילויות | כל מה שהשעון הקליט |
| **אימונים מתוכננים** | לוח השנה של Garmin Connect (`get_scheduled_workouts`) | **מה שהמאמן תכנן ב-TrainingPeaks** עובר לשם אוטומטית. **אומת על ידי יובל 28.9:** האימונים של המאמן מופיעים בלוח של Garmin |

**איך אימון מתוכנן מגיע ל-Garmin — לפי מרכז העזרה של TrainingPeaks:** אימון **מובנה** מתוכנן נשלח אוטומטית ללוח של Garmin Connect, **15 ימים קדימה**, על בסיס מתגלגל. **אינם נשלחים:** אימוני כוח, יום מנוחה, Brick. ⚠️ **על אימון שאינו מובנה המסמך אינו אומר דבר.**

**המכשיר:** שעון Garmin, ואפליקציה בטלפון (תשובת יובל, 28.9).

## ✅ הגיבוי — שבירה אינה שקטה

1. **לא הגיע אימון שהיה מתוכנן** עד סגירת 21:00 → המערכת **שואלת "התאמנת?"**. זה מה שהאפיון קובע (סעיף 8): *"אם קיים מקור חיצוני אמין שמדווח על ביצוע בפועל, אפשר להשתמש בו במקום לשאול את יובל"* — ואם אין, שואלים.
2. **החיבור ל-Garmin נכשל** → המערכת **מודיעה במפורש** שהחיבור נפל. לא ממשיכה בשקט.

**הנימוק:** הספרייה לא רשמית, ושיטת ההתחברות של Garmin כבר השתנתה פעם אחת (27.3.2026). **שני הגיבויים הופכים שבירה מתקלה שקטה לתקלה גלויה** — בדיוק מה שהמערכת נועדה למנוע.

## ✅ עקרון-העל נשמר

**קוד בלבד. בלי Claude.** הקריאה ל-Garmin, ההשוואה בין מתוכנן לבוצע, וההחלטה אם לשאול — כולם קוד. **MCP נפסל גם מהסיבה הזאת:** הוא חיבור בשביל Claude, וכל בדיקה יומית הייתה עולה קריאה ממכסת ה-Pro — על משהו שחוזר כל יום.

## ✅ הרשאה

**פעולה 22** בטבלת המיפוי (`03-permissions-rules.md`) — *"לפנות למקור חיצוני"* — **אוטונומי**, כי זו קריאה בלבד ואינה משנה דבר בחוץ. **שם המקור עודכן ל-Garmin; הרמה והנימוק לא השתנו.**

**הפרטים של Garmin — סוד:** משתני סביבה בלבד, כמו כל הסודות במערכת. ⚠️ **הספרייה שומרת מפתח שנותן גישה מלאה לחשבון** — לשון ה-README: *"Treat the token file like a password: the refresh token can provide persistent account access."*

---

## ❌ מה נפסל, ולמה

| מה | למה | מקור |
|---|---|---|
| **Strava — API** | **מנוי בתשלום** כתנאי לפתיחת אפליקציה (*"A Strava subscription is a prerequisite for creating an app"*) · **סעיף 5.3 אוסר שימוש בנתונים** *"in connection with the … operation of any AI Application"* | Strava Getting Started · API Policy 2026 |
| **Strava — MCP רשמי** | מנויים בלבד · עובד רק מתוך claude.ai, Cowork ו-Claude Code, לא ממערכת שבנינו | Strava Help Center |
| **Strava — ספריות לא רשמיות** | `stravaweblib` דורשת *"API token and email/password"* — אותו מחסום | GitHub |
| **TrainingPeaks — API רשמי** | *"access to the API is not available for personal use"* (עודכן 12.9.2026) | TrainingPeaks blog |
| **TrainingPeaks — עוגיית דפדפן** (`trainingpeaks-mcp`) | **תנאי השימוש אוסרים במפורש** (עודכנו 28.7.2026): סעיף 18(c) *"use automated scripts to collect information"* · סעיף 23 *"automated process, spiders, bots"* · איסור *"reverse engineer"*. **ובנוסף:** העוגייה פגה *"typically after several weeks"* ודורשת העתקה ידנית. **יובל העדיף אותו בתחילה** כדי לראות אימונים מתוכננים — **הצורך נענה דרך Garmin** | TrainingPeaks Terms of Use · README של הפרויקט |
| **TrainingPeaks — לוח שנה מפורסם** | *"premium-only feature"*, ומראה אימונים **מתוכננים** בלבד | TrainingPeaks Help |
| **TrainingPeaks — מיילים** | נשלחים **למאמן** בלבד | TrainingPeaks Help |
| **Garmin — API רשמי** | *"only for business use"* | Garmin Developer Program FAQ |
| **MCP לכל אחת מהשלוש** | אותן מגבלות, ובנוסף כל בדיקה = קריאה ל-Claude | — |
| **Intervals.icu** | יובל: **"אני לא רוצה צד שלישי"** | — |
| **Apple Health דרך קיצור** | אפל: *"the device encrypts the HealthKit store when the user locks the device"* — קיצור שרץ לבד בערב כנראה לא יקרא. **דורש לחיצה של יובל כל ערב.** **נשמר כחלופה** אם Garmin ייכשל בפרק 7 | Apple — HealthKit privacy |
| **אפליקציה על השעון (Connect IQ)** | בנייה כבדה · השליחה עוברת בבלוטות' דרך הטלפון ומדווחת כלא אמינה באייפון · דגם השעון לא ידוע | Garmin Connect IQ docs · פורום המפתחים |
| **ייצוא ידני** (Strava / TrainingPeaks / Garmin) | לא אוטומטי | — |

---

## ⚠️ לא אומת

| מה | למה חשוב |
|---|---|
| **תנאי השימוש של Garmin** | האתר החזיר הפניה חוזרת ולא נקרא. **אין באפשרותי לאשר אם הם אוסרים חיבור כזה.** הספרייה מצהירה על עצמה: *"This is an unofficial client for Garmin's web services"* |
| **אימון מתוכנן שאינו מובנה** | אם המאמן כותב אימון כהערה חופשית ב-TrainingPeaks — **לא ידוע אם הוא עובר ל-Garmin** |
| **אימוני כוח** | לפי TrainingPeaks **אינם** עוברים ל-Garmin. **הכוח שאחרי 4fitness בשני ורביעי** — ייתכן שלא ייראה כמתוכנן |

## 🔬 לבדיקה חיה — פרק 7

1. **כניסה משרת של Vercel.** הספרייה משתמשת בטכניקות כדי לעבור את Cloudflare; **לא ידוע אם זה עובד מכתובת של שרת בענן.**
2. **אימות דו-שלבי** — הספרייה תומכת (`prompt_mfa`). איך זה עובד כשאין אדם מול המסך — לבדוק.
3. **חסימה אחרי ניסיונות כושלים.** מדווח: חסימת כניסה של 48–72 שעות לחשבון (לא לכתובת). **פוגעת בכניסה בלבד, לא בקריאת נתונים** (issue #344). **המשמעות לבנייה:** לא לנסות להתחבר שוב ושוב בכישלון.
4. **כמה זמן עובר** עד שריצה מהשעון מופיעה ב-Garmin Connect.

**אם 1 נכשל:** החלופה מוכנה — Apple Health עם לחיצה בסגירה.

## ✅ ~~תלות יוצאת — שלב 2 (סמכות מקורות)~~ — נסגרה 28.9.2026

**אימוני 4fitness מגיעים משני מקורות.** ההכרעה: **וואטסאפ קובע יום, שעה, מיקום ו"מנוחה"; Garmin קובע את התוכן בלבד — בשני וגם ברביעי.** העיתוי (יובל): וואטסאפ בשבת בערב, Garmin רק בשני אחר הצהריים — ולכן לשבוע הקרוב הלוח ב-Garmin ריק עד אז. **המקור המחייב: `03-sources-rules.md`.**

---

## מקורות

- [cyberjunky/python-garminconnect](https://github.com/cyberjunky/python-garminconnect) — גרסה 0.3.16, 18.9.2026
- [matin/garth — Deprecating Garth (27.3.2026)](https://github.com/matin/garth/discussions/222)
- [python-garminconnect — issue #344 (429)](https://github.com/cyberjunky/python-garminconnect/issues/344)
- [Garmin Forums — חסימה 48+ שעות](https://forums.garmin.com/developer/fit-sdk/f/discussion/435087/persistent-429-on-api-login-account-blocked-for-48-hours)
- [Garmin Connect Developer Program — FAQ](https://developer.garmin.com/gc-developer-program/program-faq/)
- [TrainingPeaks — Structured Workout sync](https://help.trainingpeaks.com/hc/en-us/articles/115000325647-Structured-Workout-sync-and-Manual-Export)
- [TrainingPeaks — Garmin Connect AutoSync FAQ](https://help.trainingpeaks.com/hc/en-us/articles/204070864-Garmin-Connect-AutoSync-FAQ-and-tips-activities-workouts-and-daily-health-metrics)
- [TrainingPeaks — Terms of Use (28.7.2026)](https://www.trainingpeaks.com/terms-of-use/)
- [TrainingPeaks — An Update on Partner API](https://www.trainingpeaks.com/blog/an-update-on-trainingpeaks-partner-api/)
- [TrainingPeaks — Sync your calendar](https://help.trainingpeaks.com/hc/en-us/articles/204072184-Sync-your-calendar)
- [JamsusMaximus/trainingpeaks-mcp](https://github.com/JamsusMaximus/trainingpeaks-mcp)
- [Strava — Getting Started](https://developers.strava.com/docs/getting-started/)
- [Strava — API Policy 2026](https://www.strava.com/legal/api_policy)
- [Strava Help — MCP Connector](https://support.strava.com/hc/en-us/articles/46190267796237-Strava-MCP-Connector)
- [pR0Ps/stravaweblib](https://github.com/pR0Ps/stravaweblib)
- [Apple — HealthKit: Protecting user privacy](https://developer.apple.com/documentation/healthkit/protecting-user-privacy)
