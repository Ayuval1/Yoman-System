# דוח בדיקות מכניות — מערכת יומן (נשמר 4.10.2026)

> **מספרי השורות נכונים ל-4.10.2026 ויתיישנו אחרי תיקון הקבצים — להריץ מחדש את `12-check-project.py`.** זו רשימת העבודה לתיקוני המצביעים הממתינים (ראה פתק המעבר ב-`02`). הבדיקה מכנית בלבד, בלי מודל.

נסרקו 15 קבצים מתוך 33: 01-system-overview.md, 02-build-plan.md, 03-app-channel-rules.md, 03-boundaries-rules.md, 03-brain-module-rules.md, 03-garmin-rules.md, 03-google-calendar-rules.md, 03-intake-rules.md, 03-permissions-rules.md, 03-personal-weights-rules.md, 03-scheduling-rules.md, 05-open-questions.md, 06-db-schema.md, 07-design-assets.md, 10-chapter7-research-report.md
**לא נסרקו:** 00-project-instructions.md, 03-4fitness-rules.md, 03-analysis-rules.md, 03-design-rules.md, 03-homework-rules.md, 03-messaging-rules.md, 03-sources-rules.md, 03-telegram-rules.md, 04-working-method.md, 08-design-mockups.md, 09-design-mockups-layer4.md, README.md, school-day-structure.md, school-events-taf-shin-pe-zayin.md, school-exams-taf-shin-pe-zayin.md, school-subjects-teachers.md, school-timetable-taf-shin-pe-zayin.md, school-vacations-taf-shin-pe-zayin.md

## 1. מצביעים לקבצים שאינם קיימים בפרויקט
- אין

## 2. חיפוש ניסוחים מוכרים לבעיה (מיקום מדויק)
- **Neon — 0.5GB (המחקר: 1GB מ-2.10.2026)** — 4 מופעים: 02-build-plan.md:179, 03-intake-rules.md:362, 06-db-schema.md:230, 10-chapter7-research-report.md:85
- **איפוס באדג' ב'שליחת 0' (המחקר: מציג התראה ריקה)** — 6 מופעים: 02-build-plan.md:170, 02-build-plan.md:179, 03-app-channel-rules.md:278, 10-chapter7-research-report.md:9, 10-chapter7-research-report.md:86, 10-chapter7-research-report.md:107
- **showNotification (מול דחיפה הצהרתית)** — 2 מופעים: 02-build-plan.md:469, 07-design-assets.md:715
- **מיליון פעולות/אירועים (Workflow = 50,000)** — 2 מופעים: 01-system-overview.md:242, 03-scheduling-rules.md:24
- **תנאי שימוש Hobby / שימוש אישי** — 7 מופעים: 01-system-overview.md:255, 02-build-plan.md:175, 03-garmin-rules.md:50, 03-google-calendar-rules.md:244, 05-open-questions.md:479, 10-chapter7-research-report.md:47, 10-chapter7-research-report.md:87
- **יומן 'עסק' (הוסר 3.10)** — 8 מופעים: 01-system-overview.md:80, 01-system-overview.md:81, 02-build-plan.md:471, 03-google-calendar-rules.md:3, 03-google-calendar-rules.md:29, 03-google-calendar-rules.md:35, 05-open-questions.md:21, 06-db-schema.md:69

## 3. יום שבוע מול תאריך (שנת 2026)
- נבדקו 4 צירופים; חריגים: 0. ⚠️ ייתכנו תאריכים משנים אחרות — לבדוק ידנית כל חריג.

## 4. מעבר שעון בישראל — מחושב מנתוני אזורי הזמן
- שינוי offset בין 2026-03-26 ל-2026-03-27: 2:00:00 → 3:00:00 (Friday)
- שינוי offset בין 2026-10-24 ל-2026-10-25: 3:00:00 → 2:00:00 (Sunday)
- הערה: מחושב מ-tzdata של סביבת הריצה. אינו מאמת את החוק הרשמי; מצביע רק על מה שהמאגר מכיר.

## 5. בדיקות על 07-design-assets.md
- נמצאו 16 בלוקי קוד
- manifest.json: JSON תקין
- vercel.json: JSON תקין
- sw.js: תחביר תקין
- index.html (סקריפט module): תחביר תקין
- שמות: manifest.name=«היומן», short_name=«היומן», title=«היומן», apple title=«היומן» — אחידים
- הכרעה 2.10: השם 'מערכת יומן'. ב-07 מופיע: **'היומן' — לא עודכן**
- קבצים שמוזכרים בקוד אך אינם במבנה הריפו המתועד: אין
- enablePush: קריאות בקוד = 0 — **אין כפתור/אירוע שקורא לה (ב-iOS דרוש לחיצה)**
- .env.example — סוד הקיצור: **חסר**
- .env.example — VAPID: קיים
- .env.example — Google OAuth: **חסר**
- .env.example — Blob: **חסר**
- .env.example — Garmin: **חסר**
- .env.example — טוקן Claude: **חסר**
- .env.example — Gemini: **חסר**
- .env.example — מסד: קיים
- 03-app-channel-rules: 'אין צורך בשירות-עובד' = כן; sw.js קורא showNotification בנתיב push = כן
- sw.js: שדות מטען שנקראים: app_badge, body, json, navigate, tag, title
- tokens.css: public/ ו-src/ הם 'עותק זהה' לפי הטקסט — לא ניתן לבדוק כאן (שני הקבצים אינם מוצגים בנפרד)

## 6. עקביות מספור קבצים
- מספרי קבצים בפרויקט: 00, 01, 02, 03, 04, 05, 06, 07, 08, 09, 10 (06 ואילך רק למסמך שאינו חוקים תפעוליים — לפי 00)
