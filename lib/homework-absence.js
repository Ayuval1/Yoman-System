// היעדרות מרצף שיעורים (שלב 8.3-2): ביטול ויציאה מוקדמת משפיעים על שאלת "היו שיעורי בית?" (api/queues/deliver.js, deliverHomework).
//  - רצף שכל שיעוריו בוטלו באותו תאריך (עובדות type=cancel, lesson="7,8,9"): אין שאלה בכלל.
//  - ביטול חלקי: השאלה נוצרת כרגיל.
//  - יציאה מוקדמת (type=early_leave, time=HH:MM): רצף שנגמר אחרי שעת היציאה בהחלט מסומן "פוספס" (lesson_asks.missed). אותו כלל כמו missedLessons ב-lib/intake-facts.js (שיעור שנגמר בדיוק בשעת היציאה אינו מפוספס).
//  - confirm=no (תשובת "לא נכון" בכרטיס האישור) לא מסמן. confirm=yes או בלי עובדת confirm: מסמן. [הנחה, לא אומת] אם יש גם yes וגם no באותו מקור, "no" גובר (בטוח יותר: לא מסמנים).
//  - עובדות מתאריך אחר לא משפיעות. ערך 'unknown' (או כל ערך לא תקין) בתאריך, בשיעור או בשעה אינו נחשב.
// הפונקציות כאן טהורות, חוץ מהשאילתה אחת (loadAbsenceRows) שהיא קריאה בלבד. פרטיות: שום לוג כאן, ושם מקצוע או תוכן הודעה אינם נקראים בכלל (רק סוג, תאריך, שיעור, שעה, אישור).
// [הנחה, לא אומת] ביטול נקבע לפי מספרי השיעורים (lesson) בלבד. ביטול בלי עובדת שיעור (למשל מקצוע בלבד, כשהיו כמה רצפים) אינו מבטל רצף: עדיף לשאול מאשר להשתיק שאלה בטעות.
// [הנחה, לא אומת] עובדות ביטול מכמה הודעות מתאחדות: רצף 7-9 שבוטל בהודעה אחת בשיעור 7 ובאחרת בשיעורים 8-9 נחשב מבוטל כולו.
// שלב 8.3-3 (סבב התיקון אחרי "לא נכון", lib/intake-process.js): ביציאה מוקדמת התאריך בפועל = fix_date ?? date והשעה בפועל = fix_time ?? time.
//  - fix=cancel ("לא קורה"): לא מסמן. confirm=no בלי תיקון תקין (לא נענה, או "לא יודע"): לא מסמן, כמו לפני השלב.
//  - confirm=no עם fix_time או fix_date תקינים: מסמן לפי הערכים בפועל (התיקון הוא האמת). מקור שתאריכו תוקן נספר לתאריך החדש בלבד, לא למקורי.
import { missedLessons } from './intake-facts.js';

const rowsOf = (result) => (Array.isArray(result) ? result : []);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// קריאה בלבד, בלי מחיקה: כל העובדות של כל מקור שיש לו type=cancel או type=early_leave, ו-date או fix_date (שלב 8.3-3) ששווים ל-lessonDate (YYYY-MM-DD).
// מחזיר שורות { source_id, field, value }. כשל מסד נזרק (המטפל ב-deliverHomework תופס ומשאיר את השאלה כרגיל). ההכרעה איזה תאריך נספר: decideAbsence.
export async function loadAbsenceRows(sql, lessonDate) {
  return rowsOf(await sql`
    SELECT f.source_id, f.field, f.value
    FROM facts f
    WHERE f.source_id IN (
      SELECT t.source_id
      FROM facts t
      JOIN facts d ON d.source_id = t.source_id AND d.field IN ('date', 'fix_date') AND d.value = ${lessonDate}::text
      WHERE t.field = 'type' AND t.value IN ('cancel', 'early_leave')
    )
  `);
}

// יציאה מוקדמת: { dates, times } בפועל, או null כשהמקור לא נספר (לא קורה, או "לא נכון" בלי תיקון תקין).
function effectiveLeave(fields) {
  if ((fields.get('fix') ?? []).includes('cancel')) return null;
  const dates = fields.get('date') ?? [];
  const times = fields.get('time') ?? [];
  if (!(fields.get('confirm') ?? []).includes('no')) return { dates, times };
  const fixDate = (fields.get('fix_date') ?? []).find((value) => typeof value === 'string' && ISO_DATE.test(value));
  const fixTime = (fields.get('fix_time') ?? []).find((value) => typeof value === 'string' && HHMM.test(value));
  if (!fixDate && !fixTime) return null;
  return { dates: fixDate ? [fixDate] : dates, times: fixTime ? [fixTime] : times };
}

// שורות -> [{ type, fields: Map(field -> [values]) }] לפי source_id (מקור אחד = הודעה אחת).
function groupBySource(rows) {
  const bySource = new Map();
  for (const row of rowsOf(rows)) {
    if (!row || row.source_id === null || row.source_id === undefined || typeof row.field !== 'string') continue;
    if (!bySource.has(row.source_id)) bySource.set(row.source_id, new Map());
    const fields = bySource.get(row.source_id);
    if (!fields.has(row.field)) fields.set(row.field, []);
    fields.get(row.field).push(typeof row.value === 'string' ? row.value.trim() : row.value);
  }
  return [...bySource.values()];
}

// "7,8,9" -> [7, 8, 9]; כל איבר שאינו מספר שלם חיובי (למשל 'unknown') מתעלמים ממנו.
const periodsOf = (value) => String(value ?? '').split(',').map((part) => part.trim()).filter((part) => /^\d{1,2}$/.test(part)).map(Number).filter((n) => n >= 1);

// sequence: פריט מ-sequencesForDate (lessonDate, startPeriod, endPeriod, endsAt). timetable: { slots } (לכלל "שיעור מפוספס" המשותף).
// rows: מ-loadAbsenceRows. מחזיר { cancelled, missed }; cancelled=true מבטל את missed.
export function decideAbsence({ rows, sequence, timetable }) {
  const sources = groupBySource(rows);
  // ביטול: לפי date בלבד (לביטול אין סבב תיקון).
  const onDate = sources.filter((fields) => (fields.get('date') ?? []).some((value) => value === sequence.lessonDate));

  // ביטול: איחוד השיעורים המבוטלים באותו תאריך; הרצף מבוטל כשכל מספרי השיעור שלו בתוכם.
  const cancelled = new Set();
  for (const fields of onDate) {
    if (!(fields.get('type') ?? []).includes('cancel')) continue;
    for (const value of fields.get('lesson') ?? []) for (const period of periodsOf(value)) cancelled.add(period);
  }
  let allCancelled = sequence.endPeriod >= sequence.startPeriod;
  for (let period = sequence.startPeriod; period <= sequence.endPeriod; period += 1) {
    if (!cancelled.has(period)) allCancelled = false;
  }
  if (allCancelled) return { cancelled: true, missed: false };

  // יציאה מוקדמת: מקור שנספר (effectiveLeave), שהתאריך בפועל שלו הוא תאריך הרצף ושעתו בפועל תקינה. שיעור אחרון ברצף שנגמר אחרי השעה = הרצף מפוספס
  // (missedLessons: endsAt > שעת היציאה).
  let missed = false;
  for (const fields of sources) {
    if (!(fields.get('type') ?? []).includes('early_leave')) continue;
    const leave = effectiveLeave(fields);
    if (!leave || !leave.dates.includes(sequence.lessonDate)) continue;
    for (const time of leave.times) {
      if (typeof time === 'string' && HHMM.test(time) && missedLessons(timetable, sequence.lessonDate, time).includes(sequence.endPeriod)) missed = true;
    }
  }
  return { cancelled: false, missed };
}
