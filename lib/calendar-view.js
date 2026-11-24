// בלוק 7 חלק א'-1: נתוני היומן לאפליקציה, קריאה בלבד (docs/02-rules/03-design-rules.md, שכבה 4: "יומן מלא, מסך משני", לצפייה בלבד).
// loadCalendar מחזיר { from, days: [{ date, weekday, noSchool?, items }], unknownExams }. weekday: 0 = ראשון (כמו weekdayOf ב-lib/intake-dates.js).
// noSchool: true רק ליום שבדרך כלל יש בו שיעורים (לפי יום בשבוע במערכת השעות) וקובץ החופשות אומר שאין לימודים בו; אחרת השדה חסר (isNoSchoolDay ב-lib/school-calendar.js).
// פריט: { kind: 'lesson' | 'break' | 'exam' | 'event' | 'training', title, start, end (ISO או null), subject?, level?, room?, domain?, pending, quiz? }.
//  - שיעורים והפסקות: ממערכת השעות (lessonsOnDate). חופשה (vacationOn) = בלי שיעורים והפסקות. הפסקה = רווח בין שיעור לשיעור הבא (אין הפסקה בין 8 ל-9).
//  - level: אין שדה רמה במערכת השעות ובטבלת events, ולכן לא מוחזר [הנחה, לא אומת: הרמה תיגזר בצד התצוגה אם תידרש].
//  - מבחנים: examsOnDate מעל applyExamChanges (מבחן שנדחה מופיע במועד החדש) ותשובות "איזה מקצוע במדעים". quiz = true למבדק (מתאר = בוחן, מלא = מבחן). מבחן בלי שעה: start = null (יום שלם).
//  - אירועים: events עם status='planned', בלי domain='unavailable'. domain='running' = 'training'. האירוע משויך ליום הישראלי של ההתחלה.
//  - pending: [הנחה, לא אומת] אירוע ש-match_key שלו הוא 'source:<id>' ויש שאלה פתוחה (messages kind='question', awaiting_reply, לא פגה) על אותו מקור.
//    אירוע Google שיובל הוסיף ועוד לא נשאל עליו אינו בטבלת events ולכן אינו כאן.
//  - unknownExams: חודש בטווח שמתחיל אחרי התאריך האחרון בלוח המבחנים (מועד ב' לא נחשב) = [{ month: 'YYYY-MM', text: 'מבחנים ב<חודש> — לא ידוע', coverageEnd }].
//    [הנחה, לא אומת: "כיסוי הלוח" = התאריך האחרון בקובץ data/school-exams.json; אין בדאטא שדה כיסוי מפורש.]
//  - פרטיות: אין raw_content; רק כותרות מטבלת events ונתוני מערכת השעות והמבחנים.
// ממוין: פריטי יום שלם (start null) ראשונים, אחר כך לפי שעה. כשל מסד נזרק (api/chat.js מחזיר 500).
import { addDays, parseIso, weekdayOf, localDateIso, formatDayMonth } from './intake-dates.js';
import { zonedToUtc } from './schedule-time.js';
import { dayRange, cleanTitle } from './closing-tomorrow.js';
import { lessonsOnDate, vacationOn, isNoSchoolDay, VACATIONS } from './school-calendar.js';
import { applyExamChanges, examsOnDate, EXAMS } from './exam-line.js';
import { loadExamAnswers, loadExamChanges } from './exam-ask.js';
import { loadTimetable } from './timetable.js';

export const MAX_CALENDAR_DAYS = 42;
const TIME_ZONE = 'Asia/Jerusalem';
// רק המזהה (uuid) שאחרי "source:": מפתחות כמו source:<id>:fitness:<date> (lib/garmin-apply.js) שייכים לאותו מקור (תיקון אחרי הבודק).
const SOURCE_KEY = /^source:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::|$)/i;
const MONTH_NAMES = Object.freeze(['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']);
const rowsOf = (result) => (Array.isArray(result) ? result : []);
const iso = (dateIso, time) => zonedToUtc(dateIso, time, TIME_ZONE).toISOString();

function lessonItems(dateIso, timetable, vacations) {
  if (vacationOn(dateIso, vacations) !== null) return [];
  const slots = [...lessonsOnDate(dateIso, timetable)].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const items = [];
  slots.forEach((slot, index) => {
    items.push({ kind: 'lesson', title: slot.subject, start: iso(dateIso, slot.startsAt), end: iso(dateIso, slot.endsAt), subject: slot.subject, room: slot.room ?? null, pending: false });
    const next = slots[index + 1];
    if (next && next.startsAt > slot.endsAt) items.push({ kind: 'break', title: 'הפסקה', start: iso(dateIso, slot.endsAt), end: iso(dateIso, next.startsAt), pending: false });
  });
  return items;
}

function examItems(dateIso, timetable, exams, answers) {
  return examsOnDate(dateIso, { timetable, exams, answers, includeMakeup: true }).map((exam) => {
    const slot = exam.time ? lessonsOnDate(dateIso, timetable).find((lesson) => lesson.startsAt === exam.time) : null;
    return {
      kind: 'exam', title: exam.text, start: exam.time ? iso(dateIso, exam.time) : null, end: slot ? iso(dateIso, slot.endsAt) : null,
      subject: exam.subject, quiz: exam.type === 'מבדק', pending: false, ...(exam.postponed === true ? { postponed: true } : {}), ...(exam.makeup === true ? { makeup: true } : {}),
    };
  });
}

// חודשים בטווח (YYYY-MM) שמתחילים אחרי סוף הלוח.
function unknownExamMonths(fromIso, lastIso, exams) {
  const dates = exams.filter((exam) => exam?.makeup !== true && typeof exam?.date === 'string').map((exam) => exam.date).sort();
  const coverageEnd = dates.at(-1);
  if (!coverageEnd) return [];
  const out = [];
  const seen = new Set();
  for (let date = fromIso; date <= lastIso; date = addDays(date, 1)) {
    const month = date.slice(0, 7);
    if (seen.has(month)) continue;
    seen.add(month);
    // [הנחה, לא אומת] נוסח של Claude: החודש שהלוח מכסה חלקית (coverageEnd לפני היום האחרון בו) = "מבחנים מ-<יום אחרי>".
    if (month === coverageEnd.slice(0, 7) && lastIso > coverageEnd && addDays(coverageEnd, 1).slice(0, 7) === month) out.push({ month, text: `מבחנים מ-${formatDayMonth(addDays(coverageEnd, 1))} — לא ידוע`, coverageEnd });
    else if (`${month}-01` > coverageEnd) out.push({ month, text: `מבחנים ב${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} — לא ידוע`, coverageEnd });
  }
  return out;
}

// from: YYYY-MM-DD קיים; days: מספר שלם 1..42. אחרת RangeError. api/chat.js קורא לזה לפני המסד (400).
export function validateCalendarRange(from, days) {
  if (typeof from !== 'string') throw new RangeError('loadCalendar: from חייב להיות YYYY-MM-DD');
  parseIso(from); // RangeError על תאריך פגום
  if (!Number.isInteger(days) || days < 1 || days > MAX_CALENDAR_DAYS) throw new RangeError(`loadCalendar: days חייב להיות מספר שלם בין 1 ל-${MAX_CALENDAR_DAYS}`);
}

export async function loadCalendar({ sql, timetable, from, days, now = new Date(), vacations = VACATIONS, exams } = {}) {
  validateCalendarRange(from, days);
  const lastIso = addDays(from, days - 1);
  const table = timetable === undefined ? await loadTimetable(sql) : timetable;
  const answers = await loadExamAnswers(sql); // לא זורק
  const examList = applyExamChanges(exams ?? EXAMS, await loadExamChanges(sql)); // לא זורק
  const base = exams ?? EXAMS;

  const rows = rowsOf(await sql`
    SELECT e.id, e.title, e.starts_at, e.ends_at, e.domain, e.match_key
    FROM events e
    WHERE e.status = 'planned' AND e.domain IS DISTINCT FROM 'unavailable'
      AND e.starts_at < ${dayRange(lastIso).to.toISOString()}::timestamptz
      AND (COALESCE(e.ends_at, e.starts_at) > ${dayRange(from).from.toISOString()}::timestamptz OR e.starts_at >= ${dayRange(from).from.toISOString()}::timestamptz)
    ORDER BY e.starts_at ASC, e.id ASC
  `);
  const nowIso = (now instanceof Date ? now : new Date()).toISOString();
  const openSources = new Set(rowsOf(await sql`
    SELECT m.entity_id FROM messages m
    WHERE m.kind = 'question' AND m.awaiting_reply = true AND m.entity_type = 'source' AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
  `).map((row) => String(row.entity_id)));

  const byDate = new Map();
  for (const row of rows) {
    const ms = row.starts_at ? Date.parse(row.starts_at) : NaN;
    if (Number.isNaN(ms) || row.domain === 'unavailable') continue;
    const endMs = row.ends_at ? Date.parse(row.ends_at) : NaN;
    const key = SOURCE_KEY.exec(typeof row.match_key === 'string' ? row.match_key : '');
    const item = {
      kind: row.domain === 'running' ? 'training' : 'event', title: cleanTitle(row.title), start: new Date(ms).toISOString(), end: Number.isNaN(endMs) ? null : new Date(endMs).toISOString(),
      domain: row.domain ?? null, pending: key !== null && openSources.has(key[1]),
    };
    // [הנחה, לא אומת] אירוע רב-יומי מופיע בכל יום ישראלי שהוא מכסה בטווח; סיום בדיוק ב-00:00 לא נספר ליום הבא; בלי סיום או סיום <= התחלה = יום ההתחלה בלבד.
    const startDate = localDateIso(new Date(ms), TIME_ZONE);
    const lastMs = !Number.isNaN(endMs) && endMs > ms ? endMs - 1 : ms;
    const endDate = localDateIso(new Date(lastMs), TIME_ZONE);
    for (let date = startDate < from ? from : startDate; date <= endDate && date <= lastIso; date = addDays(date, 1)) {
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(item);
    }
  }

  const outDays = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(from, i);
    const items = [...lessonItems(date, table, vacations), ...examItems(date, table, examList, answers), ...(byDate.get(date) ?? [])];
    items.sort((a, b) => (b.start === null) - (a.start === null) || (a.start ?? '').localeCompare(b.start ?? ''));
    outDays.push({ date, weekday: weekdayOf(date), ...(isNoSchoolDay(date, table, vacations) ? { noSchool: true } : {}), items });
  }
  return { from, days: outDays, unknownExams: unknownExamMonths(from, lastIso, base) };
}

// בלוק 9: תצוגת שנה (docs/02-rules/03-design-rules.md:428 "נוף הלחץ — בתצוגת השנה: עמודה לכל יום; הגובה = כמה מבחנים", :436 "בתצוגת השנה הקווקו נשאר — שם הריבוע מייצג רק מבחנים").
// לכן השנה מחזירה מבחנים בלבד: 12 חודשים מ-fromMonth (YYYY-MM). [הנחה, לא אומת] 12 חודשים מחודש שבוחר המסך (שנת לימודים: מספטמבר).
// { from, to, coverageEnd, exams: [{ date, subject, type, quiz, makeup? }] }. מבחן שנדחה מופיע במועד החדש (applyExamChanges); מועד ב' בלי מקצוע מסומן makeup.
// loadExamChanges ו-loadExamAnswers לא זורקים (כשל = הלוח כמו שהוא). בלי טקסט הודעות.
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
export function validateYearFrom(fromMonth) {
  if (typeof fromMonth !== 'string' || !MONTH.test(fromMonth)) throw new RangeError('loadYear: from חייב להיות YYYY-MM');
}
export async function loadYear({ sql, fromMonth, exams } = {}) {
  validateYearFrom(fromMonth);
  const [y, m] = fromMonth.split('-').map(Number);
  const from = `${fromMonth}-01`;
  const endY = m === 1 ? y : y + 1;
  const endM = m === 1 ? 12 : m - 1;
  const to = addDays(`${endY + (endM === 12 ? 1 : 0)}-${String(endM === 12 ? 1 : endM + 1).padStart(2, '0')}-01`, -1);
  const board = exams ?? applyExamChanges(EXAMS, await loadExamChanges(sql));
  const answers = await loadExamAnswers(sql);
  const out = [];
  for (const exam of board) {
    if (typeof exam?.date !== 'string' || exam.date < from || exam.date > to) continue;
    if (exam.makeup === true) { out.push({ date: exam.date, subject: null, type: exam.type, quiz: false, makeup: true }); continue; }
    const [item] = examsOnDate(exam.date, { exams: [exam], answers });
    if (item) out.push({ date: exam.date, subject: item.subject, type: exam.type, quiz: exam.type === 'מבדק', ...(item.postponed ? { postponed: true } : {}) });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const coverageEnd = board.filter((e) => e?.makeup !== true && typeof e?.date === 'string').map((e) => e.date).sort().at(-1) ?? null;
  return { from, to, coverageEnd, exams: out };
}
