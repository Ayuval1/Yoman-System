// God Mode מחוץ לבריף של 07:30 (אפיון-מורחב ה-14, יובל 21.11.2026: "רץ כשקורה משהו חריג (שינוי משמעותי, התנגשות, מצב מורכב), ובנוסף סקירה יזומה
// פעם בשבועיים. מביא כרטיס עם ממצאים ואפשרויות; לא מחליט ולא מבצע"; אפיון.md סעיף 4). אותה בדיקה בדיוק (lib/god-mode.js runGodMode), אותם מפתחות:
// ממצא שהוצג כאן לא יוצג שוב בבריף של מחר, ולהפך.
//
// 1. godModeAfterChange: מיד אחרי כתיבה שנגעה במבחן מהלוח (הזזה מקושרת, תשובה למועד החדש, מועד ב' מכרטיס "בזמן החופשה").
//    רק ממצאים שהשינוי יצר (onlyChanged): מבחן שהוקדם, ושבוע שנהיה עמוס כי מבחן זז אליו. שבוע עמוס בלי מבחן שזז מחכה לבריף.
//    בלי מוח (ask = null): הקריאה נמצאת בדרך לתשובה ליובל, וקריאה למודל הייתה מעכבת אותה עד 8 שניות לממצא. הכרטיס נבנה בקוד בכל מקרה;
//    המוח מוסיף לכל היותר שורת אפשרות אחת (lib/god-mode.js). הכרעה טכנית (27.11.2026): אין קריאה חדשה למודל.
//    ההתראה: הכרטיס הוא הודעת עדכון שלא נקראה, ולכן נכלל בהתראה המאוגדת של אותה הודעה מהקיצור (api/intake.js, planNotify).
//    בצ'אט (הודעה מוקלדת או תשובה לכרטיס) יובל כבר באפליקציה, והדף טוען מחדש אחרי השליחה.
// 2. godModeBiweekly: בשבת הדו-שבועית (lib/weekly-brief.js isBiweeklySaturday), לפני הבריף השבועי של 20:00, עם טווח רחב (BIWEEKLY_HORIZON_DAYS).
//    כרטיס רק כשיש ממצא שעוד לא הוצג. המוח באותו שער כמו בבריף (ask מוזרק, BRAIN_PILOT=off, עד שני ממצאים).
//
// הלוח נטען עם strict: כשל בטעינת השינויים = בלי בדיקה בכלל, כי לוח בלי ההזזות היה מראה שבוע "עמוס" שכבר לא קיים.
// לא זורק לעולם: כשל כאן לא מפיל את הכתיבה ולא את התשובה ליובל.
// "התנגשות": אין כאן בדיקה חדשה. התנגשויות כבר מטופלות במקום שבו הן נוצרות, וכל אחת מביאה שאלה, כרטיס או שורה משלה: לוז 4fitness מול למידה
// (lib/study-plan.js takenByTraining / replaceTakenStudy, test/fitness-vs-study.test.js), "לא זמין" (lib/unavailable.js), אירוע של כמה ימים מול מבחן
// ולמידה (lib/away.js), ריצת שלישי/שישי (lib/weekly-runs.js).
import { runGodMode } from './god-mode.js';
import { loadExamChanges } from './exam-ask.js';
import { EXAMS, applyExamChanges } from './exam-line.js';
import { localDateIso } from './intake-dates.js';

// [הנחה, לא אומת] פי שניים מהבריף היומי: הסקירה רצה פעם בשבועיים, ולכן מסתכלת על שני מחזורים קדימה.
export const BIWEEKLY_HORIZON_DAYS = 28;

async function loadBoard(sql, examsRaw) {
  const changes = await loadExamChanges(sql, { strict: true });
  return { changes, exams: applyExamChanges(examsRaw, changes) };
}

// מחזיר { created: [מפתחות] }. now: רגע הכתיבה; "היום" לפי שעון ישראל.
export async function godModeAfterChange({ sql, now = new Date(), examsRaw = EXAMS }) {
  try {
    const { changes, exams } = await loadBoard(sql, examsRaw);
    if (changes.length === 0) return { created: [] };
    return await runGodMode({ sql, todayIso: localDateIso(now), changes, examsRaw, exams, ask: null, now, onlyChanged: true });
  } catch (error) {
    console.error('god-mode: הבדיקה אחרי השינוי נכשלה:', error?.name);
    return { created: [] };
  }
}

// todayIso: תאריך השבת (ממפתח המשבצת). ask: askBrain (מוזרק), כמו בבריף.
export async function godModeBiweekly({ sql, todayIso, now = new Date(), ask = null, examsRaw = EXAMS }) {
  try {
    const { changes, exams } = await loadBoard(sql, examsRaw);
    return await runGodMode({ sql, todayIso, changes, examsRaw, exams, ask, now, horizonDays: BIWEEKLY_HORIZON_DAYS });
  } catch (error) {
    console.error('god-mode: הסקירה הדו-שבועית נכשלה:', error?.name);
    return { created: [] };
  }
}
