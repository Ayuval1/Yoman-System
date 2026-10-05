# דוח אימות לפני פרק 7

הביקורת העצמאית (critic) דולגה, ולכן הסעיף על מה שחסר מבוסס רק על הסוקרים ועל מה שהחוקרים סימנו כפספוס. תוויות בסוגריים: **מאומת** (יש מקור), **סתירה פנימית** (שני קבצי תוכנית), **הסקה שלי**.

## 1. מה חוסם את פרק 7 או מחייב שינוי בתוכנית

| # | פער | בסיס | מקור |
|---|---|---|---|
| 1 | איפוס המספר באייקון ב"שליחת 0" הוא דחיפה שקטה, ואפל לא תומכת בדחיפה שקטה. ב-`sw.js` זו תוצג כהודעה ריקה. | מאומת | https://webkit.org/blog/16535/meet-declarative-web-push/ ; `03-app-channel-rules.md` |
| 2 | `03-app-channel-rules` קובע דחיפה הצהרתית בלי שירות-עובד. `07-design-assets` (`sw.js`) בנוי על דחיפה קלאסית עם שדות שטוחים, ואין בו `pushsubscriptionchange`. מבנה ה-payload ההצהרתי המלא לא אומת. | סתירה פנימית | שני הקבצים; https://webkit.org/blog/16535/meet-declarative-web-push/ |
| 3 | השער (Haiku עם טוקן מנוי) חסר קריטריון עבר/נכשל ועץ החלטה. לא הוכרע בין `claude -p` (בינארי לא ערוך) ל-Agent SDK. אין פנייה ל-Anthropic. התיעוד אוסר להציע התחברות claude.ai למוצרי SDK. דף התנאים מתיר למשתמש קצה להתחבר לבינארי לא ערוך עם המנוי שלו, גם בפלטפורמה מארחת. מקרה של משתמש יחיד על תשתית מארחת לא מוסדר: לא אומת. | מאומת + סתירה פנימית | https://code.claude.com/docs/en/agent-sdk/overview ; https://code.claude.com/docs/en/legal-and-compliance ; `02-build-plan.md`, `05-open-questions.md` |
| 4 | היקף ההרשאה של Google לא הוכרע, וההסכמה מתבצעת פעם אחת בפרק 7. במצב Testing הטוקן פג אחרי 7 ימים. `03-google-calendar-rules` כותב "אומת" על In production, אבל אין הצהרה מפורשת שאפליקציה לא מאומתת שומרת טוקן מעבר ל-7 ימים. | מאומת (7 ימים) ; לא אומת (In production) | https://developers.google.com/identity/protocols/oauth2 ; https://support.google.com/cloud/answer/15549945 |
| 5 | Garmin: לא נקבע איפה הספרייה (Python) רצה, בעוד שאר הערימה ב-Node. ההתחברות הראשונה עם MFA דורשת אדם, וזה סותר "שום דבר לא רץ על המחשב". הטוקנים מתרעננים והדיסק ב-Vercel זמני, ולכן שמירה מוצפנת ב-Neon היא כנראה ברירת המחדל ולא "חריג מותנה". דווח 403 מ-Cloudflare גם על טוקן תקף. | מאומת (403, MFA) + הסקה שלי (שמירה ב-Neon) | https://github.com/cyberjunky/python-garminconnect/issues/444 ; https://github.com/matin/garth |
| 6 | זיהוי שינויים ביומן: לא אומת ש-Google מקבלת webhook על `*.vercel.app`. משך חיי ערוץ ה-watch לא מתועד ואין חידוש אוטומטי. ב-`06-db-schema` אין שדות ל-channel, syncToken ושמירת מה שהמערכת כתבה. | מאומת (אין חידוש, לא מובטח) ; לא אומת (הדומיין) | https://developers.google.com/calendar/api/guides/push ; `06-db-schema.md` |
| 7 | שעון ההמתנה (בריף 07:30 תלוי בו): אין הבטחת דיוק, וגם נתיב היציאה (Queues) בטא. ה-Cron המתכנן הוא best-effort ואין לו retry. | מאומת | https://workflow-sdk.dev/docs/configuration/runtime-tuning ; https://vercel.com/docs/cron-jobs/manage-cron-jobs |
| 8 | בדיקת הקיצור היא התנאי היחיד שיכול להפיל את בחירת הערוץ, אבל היא חמישית במפה. אפל לא מתעדת כותרות מותאמות ב-Get Contents of URL, וסוד הקיצור יושב בכותרת. | סתירה פנימית + מאומת (חוסר תיעוד) | `03-app-channel-rules.md` ; https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios |
| 9 | אין תרגול התקנה על דומיין זרוק. הדומיין והשם ("היומן" לעומת "מערכת יומן") לא סגורים, וההתקנה הראשונה נועלת. | הסקה שלי | `02-build-plan.md`, `07-design-assets.md` |

פערים בינוניים:
- ב-`06-db-schema` חסרות טבלאות שפרקים 6 ו-7 דורשים: alarms, push_subscriptions, watch/sync, call_log (סתירה פנימית).
- שינוי השעון בישראל, כנראה ב-25.10.2026, לא נכלל באף בדיקה (הסקה שלי, התאריך לא אומת).
- לא נבחר מנגנון להתאמת שורשים בעברית בסביבת serverless (הסקה שלי).
- ב-`sw.js` נשמר במטמון כל GET, ו-`/index.html` נמצא ב-SHELL למרות ש-cleanUrls מפנה אותו (הסקה שלי, לבדוק).
- אין כפתור שקורא ל-`enablePush`, ו-iOS דורש לחיצה.
- שדות `rate_limits` בתוכנית שונים משדות `rate_limit_event` ב-SDK, והצורה המדויקת לא אומתה.
- אין יומן מדידות, ולוגי Vercel ב-Hobby נשמרים שעה אחת בלבד: https://vercel.com/docs/logs/runtime

## 2. מה אומת ואפשר להישען עליו

| נושא | מה אומת | URL |
|---|---|---|
| דחיפה ב-iOS | עובדת באפליקציית מסך בית, והבקשה חייבת לבוא מלחיצה | https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ |
| דחיפה הצהרתית | iOS 18.4+, בלי שירות-עובד, ו-`app_badge` נתמך | https://webkit.org/blog/16535/meet-declarative-web-push/ |
| דרישות שרת | VAPID, הצפנה, `*.push.apple.com`, מגבלת 4KB, 410 פירושו שהמנוי פג | https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers.md |
| iOS 26 | כל אתר שנוסף למסך הבית נפתח כאפליקציה כברירת מחדל | https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ |
| אחסון | אפליקציית מסך בית פטורה ממחיקת 7 הימים | https://webkit.org/tracking-prevention/ |
| טוקן מנוי | `setup-token` נותן טוקן לשנה, בלי `--bare`, ו-`ANTHROPIC_API_KEY` גובר עליו | https://code.claude.com/docs/en/authentication |
| שינוי SDK מושהה | השינוי של 15.6 הושהה בלי תאריך חדש | https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan |
| Vercel Sandbox | מכסות Hobby (5 שעות CPU, 5,000 יצירות, 45 דקות לסשן) | https://vercel.com/docs/vercel-sandbox/pricing |
| Cron | פעם ביום לכל היותר, דיוק של שעה, best-effort | https://vercel.com/docs/cron-jobs/usage-and-pricing |
| Workflow | 50,000 אירועים בחודש ב-Hobby, ללא תקרת המתנה | https://vercel.com/docs/workflows/pricing |
| Functions | 300 שניות, 4.5MB לבקשה ולתשובה | https://vercel.com/docs/functions/limitations |
| Blob | מכסות Hobby, ועבור חריגה: חסימה ל-30 יום | https://vercel.com/docs/vercel-blob/usage-and-pricing |
| Neon | 1GB לפרויקט (מ-2.10.2026), 100 CU-hours, scale-to-zero אחרי 5 דקות | https://neon.com/docs/changelog/2026-10-02 ; https://neon.com/faqs/free-plan-limits-and-quotas |
| Google | שמות ההרשאות, מכסות (10,000 לדקה) והתראות לא מובטחות | https://developers.google.com/workspace/calendar/api/guides/quota |
| TrainingPeaks | סנכרון 15 יום קדימה בלבד | https://help.trainingpeaks.com/hc/en-us/articles/115000325647-Structured-Workout-sync-and-Manual-Export |
| Hobby | לשימוש לא מסחרי בלבד | https://vercel.com/docs/limits/fair-use-guidelines |
| Garmin רשמי | תוכנית המפתחים לעסקים בלבד | https://developer.garmin.com/gc-developer-program/program-faq/ |

## 3. מה אי אפשר לאמת ורק בדיקה חיה בפרק 7 תכריע

הספים המסומנים (מוצע) הם הצעה שלי וצריכים אישור שלך.

| בדיקה | עבר | נכשל |
|---|---|---|
| G1 הסכמה In production עם ההרשאה הסופית | הטוקן עובד ביום 8 וביום 15 | `invalid_grant` |
| G2 קריאת יומנים | מוצגים primary, "בית ספר", "ריצה", "חגים", וכתיבה רק ליומן זרוק | ההרשאה לא רואה אותם |
| G3 watch על ה-URL האמיתי | הודעת sync מגיעה, ועריכה מייצרת POST תוך 60 שניות (מוצע), והתפוגה נרשמת | ההרשמה נדחית, ואז רק קריאת ערב |
| G4 חידוש וסנכרון | ערוץ חדש לפני תפוגה, ו-410 גורר סנכרון מלא | שינוי אבד |
| G5 סימון מקור | 10 מתוך 10 סיווגים נכונים (מוצע) | טעות כלשהי |
| G6 חיתוך סדרה | עבר נשמר, עתיד נמחק, בלי כפילויות | כפילות או אובדן |
| G7 יציבות id של יומן אחרי שינוי שם | ה-id ללא שינוי | ה-id השתנה |
| G8 Garmin כניסה אחת | הצלחה בניסיון אחד והטוקן נשמר | כל 403/429: עוצרים ועוברים ל-Apple Health |
| G9 סיבוב טוקן Garmin | אפס כניסות חדשות אחרי 3 ימים ומופע קר | כניסה חוזרת |
| G10 קריאת אימונים מתוכננים מ-Garmin | רשום מה קיים: ריצות המאמן, כוח, משך | לא ניתן לקרוא |
| G12 כותרת מותאמת בקיצור | הסוד מגיע | מעבר לשדה Form |
| G13 תוכן שוואטסאפ מעביר (View Content Graph) | נרשם: טקסט, שולח, שעה, כמה הודעות, סוג תמונה | לא ניתן לפענח |
| G14 העלאת 3 תמונות, זמן המתנה ותצוגת כשל | מתחת ל-4.5MB וכל כשל נראה | כשל שקט |
| G15 Blob פרטי | put ו-get דרך הפונקציה, וה-URL לא קריא | חשיפה ציבורית |
| S1 30 שעונים (10 שניות עד 48 שעות, כולל המשך שרשור) | שגיאה ב-p95 עד 60 שניות (מוצע), בלי כפילויות | סחיפה או כפילות |
| S2 אירועים לשעון | התחזית החודשית פי 3 מתחת ל-50,000 | חריגה |
| S3 דילוג מכוון על ה-Cron | הסגירה או מתכנן שני משחזרים את מחר | אין בריף |
| S4 מעבר שעון | שעון 07:30 מקומי ב-26.10 נורה נכון | סטייה |
| S5 Neon | התעוררות קרה ב-p95 מתחת לשנייה (מוצע) והתחזית מתחת ל-50% מהמכסה | חריגה |
| H1 התאמת שורשים בפונקציה | ארבעת זוגות הדוגמה נפתרים לאותה פגיעה, וגודל וזמן עלייה סבירים | בחירת מילון אחר |
| P1 דחיפה: שני פורמטים | נרשם מה iOS 26 מציג ואם `app_badge` מתעדכן | לא מתעדכן |
| P2 סמל במצב Dark ב-iOS 26 | נבדק על דומיין זרוק | הסמל נראה רע |
| P3 Sandbox בסיסי | הרצה בלי `--bare` ובלי API key עם טוקן כ-env, ואחר כך ניסיון brokering | לא עובד |

## 4. מה נסתר או התיישן לעומת מה שהתוכנית מניחה

| הנחה בתוכנית | מה נמצא | מקור |
|---|---|---|
| "אומת: In production מחזיק טוקן" | אין הצהרה מפורשת, ופטור לשימוש אישי הוא "overstated" | https://support.google.com/cloud/answer/13464323 |
| Neon בחינם 0.5GB (`03-intake-rules`, `06`) | 1GB מ-2.10.2026 | https://neon.com/docs/changelog/2026-10-02 |
| "שליחת 0" מאפסת | דחיפה שקטה, לא נתמכת | https://webkit.org/blog/16535/meet-declarative-web-push/ |
| "אין עסק" (`02`) לעומת תג עסק ב-`03-google-calendar-rules` | Hobby לשימוש לא מסחרי | https://vercel.com/docs/limits/fair-use-guidelines |
| Garmin דרך garth | deprecated, ו-python-garminconnect כבר לא משתמשת בו | https://github.com/matin/garth |
| שעון בריף 07:30 מדויק | ב-Hobby ה-Cron יורה בטווח של שעה | https://vercel.com/docs/cron-jobs/usage-and-pricing |
| סנכרון כל סוגי האימונים מ-TrainingPeaks | כוח, יום חופש ו-Brick לא מסונכרנים | https://help.trainingpeaks.com/hc/en-us/articles/204070864-Garmin-Connect-AutoSync-FAQ-and-tips-activities-workouts-and-daily-health-metrics |

## 5. מה עדיין חסר

- הביקורת העצמאית לא רצה.
- **VAPID:** ה-JWT לא יתחדש יותר מפעם בשעה ופג תוך יום. HTTP 429 חל על בקשות רצופות לאותו מכשיר. מקור: דף אפל בסעיף 2.
- **Cron:** חסרה הגנת `CRON_SECRET`, והוא לא עוקב אחרי redirect. מקור: https://vercel.com/docs/cron-jobs/manage-cron-jobs
- **מקורות נוספים:** לא נבדקו Scriptable ב-iOS 26 וגם לא Widget Web 26 (לא אומת). מדיניות Anthropic לשימוש אישי בודד נותרה בלי תשובה סופית, ורק Anthropic יכולה לתת אותה.
- **הסכמה:** תנאי הפרטיות של Gemini החינמי חלים כנראה גם על ישראל. זו הסקה שלי, לא נאמר במפורש.
- **מילון עברי:** Hspell תחת AGPL v3, ושאלת ההטמעה לא נבדקה.

## מה אני ממליץ לשנות במפה של פרק 7

כל הסעיפים הם המלצות שלי.

1. לפני בניית השער לכתוב חצי עמוד: מדדי הצלחה, שלוש תוצאות (עבר / עבר בהגבלה / נכשל) והחלטה לכל אחת. להכריע `claude -p` ולא Agent SDK, ולשלוח פנייה כתובה ל-Anthropic. לסמן את פרק 6 כזמני עד שהשער עובר.
2. להזיז את בדיקת הקיצור מיד אחרי נקודת הקצה המינימלית, לפני Google ו-Garmin, עם חלופת Form ללא כותרת מוכנה.
3. להכריע דחיפה הצהרתית או קלאסית לפני כתיבת `sw.js`. למחוק את "שליחת 0", ולבדוק בפועל את שני הפורמטים.
4. להתחיל כבר בצעד התשתית את השעונים הארוכים: Google In production עם הסכמה אחת, ה-watch, וסחיפת שעון. להחליט על ההרשאה הסופית לפני ההסכמה, ולסמן את "אומת" כ"יוכח ביום 8 וביום 15". כל כתיבה ל-Google מחייבת אישור שלך.
5. להוסיף טבלאות תשתית מינימליות ל-`06` (alarms, push_subscriptions, watch/sync, call_log, probe_log), ובכל שעון claim אטומי ומתכנן Cron שני.
6. Garmin רק אחרי השער: להגדיר איפה הקוד רץ, כניסה אחת ידנית ושמירה מוצפנת ב-Neon, עד ניסיון כניסה אחד ביום וללא retry על 403/429, ונקודת מעבר ל-Apple Health.
7. לפני ההתקנה הנועלת: תרגול על דומיין זרוק, סגירת דומיין ושם, והוספת בדיקת DST ל-26.10. בנוסף לשאול אותך: האם יש פעילות עסקית במערכת, כי זה משפיע על Hobby.