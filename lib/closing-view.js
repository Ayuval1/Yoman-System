// תוכן הודעת הסגירה של 21:00 (שלב C-1, docs/08-chapter8/90-chapter8-evening-closing-prd.md: E1-E11 ותבנית ההודעה בסעיף 6; שורת "בוצע היום" נוספה בשלב C-2, E6).
// פונקציות טהורות (חלון, הרכבה, נוסח התראה) ושתי פונקציות טעינה (loadReceived, loadDone) עם sql מוזרק, כמו בשאר הקבצים. בלי AI, בלי רשת, בלי שעון: הזמן הוא targetAt של המשבצת (E8).
// הטקסט, לערב עם תוכן:
//   סגירה · יום שלישי 27.10
//   נקלט היום (2):
//   · אירוע אישי · תור לספר · רביעי 28.10
//   · מבחן · מתמטיקה · ראשון 1.11
//   לא הובנו: 1
//   בוצע היום: חוברת בהיסטוריה · ענית על שיעורי בית בפיזיקה
//   מחר: מבחן במתמטיקה ב-10:05
//   להגשה מחר: חוברת באנגלית
//   משימות פתוחות (2):
//   · חוברת באנגלית — עד רביעי 28.10
//   · דף תרגילים — בלי תאריך
//   שאלות שממתינות: שיעורי בית בפיזיקה
// פרטיות (E2, סעיף 5): "נקלט" בנוי מעובדות בלבד (resultText), אף פעם לא מהטקסט המקורי; raw_content לא נבחר בשאילתה בכלל. "לא הובנו" הוא מספר בלבד (לוג פערים 28.10).
// כותרות משימה מופיעות בהודעה עצמה כמו בבריף; בהתראה רק מספרים (closingPushText).
import { previousBoundary, resultText } from './review-view.js';
import { taskLine, sortedTasks, pendingLine } from './brief-view.js';
import { WEEKDAY_NAMES, formatDayMonth, localDateIso, weekdayOf, addDays } from './intake-dates.js';

const TIME_ZONE = 'Asia/Jerusalem';
export const QUIET_RECEIVED_LINE = 'לא נקלטו הודעות היום';
export const QUIET_EVENING_LINE = 'לא נקלטו הודעות היום. אין משימות פתוחות ואין שאלות.';
export const QUIET_PUSH = 'יום שקט';
export const REVIEW_DUE_PUSH = 'סיכום היום מחכה לסימון'; // אותו נוסח כמו REVIEW_PUSH_BODY ב-lib/chat-notify.js (M.2), כל עוד יש הודעות לסימון (E10)

const dayLabel = (dateIso) => `${WEEKDAY_NAMES[weekdayOf(dateIso)]} ${formatDayMonth(dateIso)}`;
const toDate = (value) => (value instanceof Date ? value : new Date(value));

// ---------------------------------------------------------------------------
// חלון ותאריכים (E8, E11)
// ---------------------------------------------------------------------------

// חלון "נקלט היום" (E8): מ-21:00 הקודם (בלעדי) עד targetAt של המשבצת (כולל). לפי targetAt בלבד, לא לפי השעון ולא לפי רגע ההגעה,
// ולכן משבצת שמגיעה באיחור או בניסיון חוזר מחשבת אותו חלון. previousBoundary מתחשב במעבר שעון (חלון של 23 או 25 שעות ביום המעבר).
export function closingWindow(targetAt) {
  const upper = toDate(targetAt);
  return { lower: previousBoundary(upper), upper };
}

// התאריכים של המשבצת (E11): dateIso = היום הישראלי של targetAt, tomorrowIso = היום שאחריו. לפי targetAt, ולכן נכון גם כשהמסירה בפועל אחרי חצות.
export function closingDates(targetAt) {
  const dateIso = localDateIso(toDate(targetAt), TIME_ZONE);
  return { dateIso, tomorrowIso: addDays(dateIso, 1) };
}

// ---------------------------------------------------------------------------
// "נקלט היום" (E2, E8, E11; H1)
// ---------------------------------------------------------------------------

const rowsOf = (result) => (Array.isArray(result) ? result : []);

// שורות המקורות (id, duplicate) ושורות העובדות -> { lines, notUnderstood }. טהורה, כדי שאפשר לבדוק בלי מסד.
// H1 (הכרעה, תוכנית C-1): שדה כפול לאותו מקור (רק במרוץ) מוכרע דטרמיניסטית: העובדות מגיעות ממוינות (source_id, field, value), והערך הראשון לשדה גובר.
// מקור בלי עובדת type אינו ב"נקלט" (E11), ונספר ב"לא הובנו", חוץ מכפילות.
// [הצעה] כפילות (intake_outcomes.status='duplicate', "כבר קיבלתי") אינה "לא הובנה": המערכת הבינה שזו אותה הודעה, ולכן לא נספרת בכלל.
// [הצעה] מגבלה: intake_outcomes נכתבת רק לקיצור (outcomeFor ב-api/intake.js), ולכן כפילות מוקלדת באפליקציה כן נספרת ב"לא הובנו". נדיר (אותו טקסט פעמיים באותו יום).
export function receivedFromRows({ sources, facts }) {
  const bySource = new Map();
  for (const fact of rowsOf(facts)) {
    if (!bySource.has(fact.source_id)) bySource.set(fact.source_id, new Map());
    const fields = bySource.get(fact.source_id);
    if (!fields.has(fact.field)) fields.set(fact.field, fact.value); // הראשון גובר (H1)
  }
  const lines = [];
  let notUnderstood = 0;
  for (const source of rowsOf(sources)) {
    const fields = bySource.get(source.id);
    if (fields?.has('type')) {
      const text = resultText(fields);
      if (text) lines.push(text);
    } else if (source.duplicate !== true) {
      notUnderstood += 1;
    }
  }
  return { lines, notUnderstood };
}

// טעינת "נקלט היום" מהמסד (E8, H1): מקורות משני הערוצים (shortcut, app) לפי sources.received_at בחלון, בלי שורות התשובה של האפליקציה (sender='answer'),
// לפי received_at עולה ובשוויון id (E11). ואחר כך העובדות שלהם, ממוינות. לא בוחרים raw_content (פרטיות, E2). כשל מסד נזרק (הצרכן מחליט: ניסיון חוזר או הודעה חלקית).
// window: מ-closingWindow. מחזיר { lines, notUnderstood }.
export async function loadReceived(sql, window) {
  const lower = window.lower.toISOString();
  const upper = window.upper.toISOString();
  const sources = rowsOf(await sql`
    SELECT s.id, EXISTS (SELECT 1 FROM intake_outcomes o WHERE o.source_id = s.id AND o.status = 'duplicate') AS duplicate
    FROM sources s
    WHERE s.channel IN ('shortcut', 'app') AND s.sender IS DISTINCT FROM 'answer'
      AND s.received_at > ${lower}::timestamptz AND s.received_at <= ${upper}::timestamptz
    ORDER BY s.received_at ASC, s.id ASC
  `);
  if (sources.length === 0) return { lines: [], notUnderstood: 0 };
  const ids = JSON.stringify(sources.map((row) => row.id));
  const facts = rowsOf(await sql`
    SELECT f.source_id, f.field, f.value
    FROM jsonb_array_elements_text(${ids}::jsonb) AS t(id) JOIN facts f ON f.source_id = t.id::uuid
    ORDER BY f.source_id, f.field, f.value
  `);
  return receivedFromRows({ sources, facts });
}

// ---------------------------------------------------------------------------
// "בוצע היום" (שלב C-2: E6, H2, H3)
// ---------------------------------------------------------------------------

const isHomeworkAnswer = (item) => (item?.kind === 'homework' || item?.entity_type === 'lesson_ask') && typeof item.subject === 'string' && item.subject.trim() !== '';

// שורות המשימות שסומנו "בוצע" והשאלות שנענו בחלון -> שורה אחת, או null כשאין כלום. טהורה.
// משימות בשם (titleOf), לפי done_at עולה (המיון יציב). שאלות כמו pendingLine של הבוקר: שיעורי בית בשם המקצוע, כל השאר רק כמספר (D17 של 68).
export function doneTodayLine({ tasks = [], answered = [] } = {}) {
  const key = (task) => { const ms = task.done_at ? Date.parse(task.done_at) : NaN; return Number.isNaN(ms) ? Infinity : ms; };
  const taskList = [...rowsOf(tasks)].sort((a, b) => { const ka = key(a); const kb = key(b); return ka === kb ? 0 : ka < kb ? -1 : 1; });
  const answerList = rowsOf(answered);
  const homework = answerList.filter(isHomeworkAnswer);
  const others = answerList.length - homework.length;
  const parts = taskList.map(titleOf);
  for (const item of homework) parts.push(`ענית על שיעורי בית ב${item.subject.trim()}`);
  if (others > 0) {
    const base = others === 1 ? 'שאלה אחת' : `${others} שאלות`;
    parts.push(homework.length > 0 ? `ועוד ${base}` : `ענית על ${base}`);
  }
  return parts.length > 0 ? `בוצע היום: ${parts.join(' · ')}` : null;
}

// טעינת "בוצע היום" מהמסד, באותו חלון של "נקלט" (closingWindow: מ-21:00 הקודם בלעדי עד targetAt כולל, E8), כדי שאירוע ברגע הגבול ייספר בערב אחד בלבד.
// משימות: status='done' ו-done_at בחלון (H2: משימה שנסגרה לפני העמודה, done_at ריק, לא נכנסת). שאלות: kind='question' שנסגרה (awaiting_reply=false) ו-read_at בחלון (E6, H3):
// תשובת כפתור לא ממלאת reply_source_id, ולכן read_at הוא הזמן האחיד. שאלה שפגה בלי תשובה נשארת awaiting_reply=true ולא נכנסת.
// המקצוע של שאלת שיעורי בית מ-lesson_asks (כמו loadPending). לא בוחרים body או raw_content (פרטיות, E2). כשל מסד נזרק (הצרכן מחליט).
// מחזיר { tasks: [{ title, done_at }], answered: [{ entity_type, subject }] }.
export async function loadDone(sql, window) {
  const lower = window.lower.toISOString();
  const upper = window.upper.toISOString();
  const tasks = rowsOf(await sql`
    SELECT d.title, d.done_at
    FROM tasks d
    WHERE d.status = 'done' AND d.done_at > ${lower}::timestamptz AND d.done_at <= ${upper}::timestamptz
    ORDER BY d.done_at ASC, d.id ASC
  `);
  const answered = rowsOf(await sql`
    SELECT m.entity_type, la.subject AS subject
    FROM messages m LEFT JOIN lesson_asks la ON m.entity_type = 'lesson_ask' AND la.id = m.entity_id
    WHERE m.kind = 'question' AND m.awaiting_reply = false
      AND m.read_at > ${lower}::timestamptz AND m.read_at <= ${upper}::timestamptz
    ORDER BY m.read_at ASC, m.id ASC
  `);
  return { tasks, answered };
}

// ---------------------------------------------------------------------------
// ההודעה (סעיף 6)
// ---------------------------------------------------------------------------

// משימות פתוחות שתאריך היעד הישראלי שלהן הוא מחר (E3, E11). משימה בלי due_at לא נכנסת (H4: הקוד לא מנחש תאריך).
export function dueTomorrow(tasks, tomorrowIso) {
  return sortedTasks(rowsOf(tasks)).filter((task) => {
    const ms = task.due_at ? Date.parse(task.due_at) : NaN;
    return !Number.isNaN(ms) && localDateIso(new Date(ms), TIME_ZONE) === tomorrowIso;
  });
}
const titleOf = (task) => (typeof task.title === 'string' && task.title.trim() !== '' ? task.title.trim() : 'משימה'); // כמו taskLine

// מרכיב את הודעת הסגירה. dateIso: תאריך המשבצת. received: מערך שורות resultText (מ-loadReceived), או null כשלא נטען. notUnderstood: מספר.
// examLine: מ-examLineAt(targetAt) (כבר מתחיל ב-"מחר: ") או null. tasks: מ-loadOpenTasks או null. pending: מ-loadPending או null. tomorrowIso: ברירת מחדל dateIso + 1.
// done (C-2): { tasks, answered } מ-loadDone, או null כשלא נטען. השורה "בוצע היום" אחרי "נקלט"/"לא הובנו" ולפני "מחר" (תבנית סעיף 6), ומושמטת כשאין.
// null = החלק לא נטען (ניסיון אחרון בתור, E9): החלק מושמט, ואסור לטעון ריקנות (partial). partial=true מוסיף את האיסור גם בלי null.
// כללי התבנית [הצעה, סעיף 6]: "נקלט היום" מוצג תמיד כשנטען; ריק = "לא נקלטו הודעות היום". "לא הובנו", "בוצע היום", "מחר" ו"להגשה מחר" מושמטות כשאין.
// משימות ושאלות כמו בבוקר (E4): כל המשימות, בלי תקרה, עם "באיחור"; שאלות שיעורי בית בשם המקצוע והשאר כמספר. משימה שמועדה מחר מופיעה בשני המקומות (E4).
// ערב שאין בו כלום (גם לא "בוצע היום"): שורה אחת "לא נקלטו הודעות היום. אין משימות פתוחות ואין שאלות." (סעיף 6).
// [הצעה] אין הודעות שזוהו אבל יש שלא הובנו: לא כותבים "לא נקלטו הודעות היום" (זה לא נכון), רק "לא הובנו: N".
// מחזיר { text, received, notUnderstood, done, tasks, pending, dueTomorrow, exam }: מספרים בלבד חוץ מ-text, לנוסח ההתראה וללוג. done = משימות + שאלות שנענו (null כשלא נטען).
export function composeClosing({ dateIso, received = [], notUnderstood = 0, done = { tasks: [], answered: [] }, examLine = null, tasks = [], pending = [], tomorrowIso, partial = false } = {}) {
  const tomorrow = tomorrowIso ?? addDays(dateIso, 1);
  const receivedList = Array.isArray(received) ? received : null;
  const taskList = Array.isArray(tasks) ? sortedTasks(tasks) : null;
  const pendingList = Array.isArray(pending) ? pending : null;
  const missingCount = receivedList && Number.isInteger(notUnderstood) && notUnderstood > 0 ? notUnderstood : 0;
  const exam = typeof examLine === 'string' && examLine !== '' ? examLine : null;
  const dueList = taskList ? dueTomorrow(taskList, tomorrow) : [];
  const questions = pendingList ? pendingLine(pendingList) : null;
  const doneLoaded = done !== null && typeof done === 'object';
  const doneLine = doneLoaded ? doneTodayLine(done) : null;
  const doneCount = doneLoaded ? rowsOf(done.tasks).length + rowsOf(done.answered).length : null;
  const isPartial = partial || !receivedList || !taskList || !pendingList || !doneLoaded;

  const lines = [`סגירה · יום ${dayLabel(dateIso)}`];
  const nothing = !isPartial && receivedList.length === 0 && missingCount === 0 && !doneLine && !exam && taskList.length === 0 && !questions;
  if (nothing) {
    lines.push(QUIET_EVENING_LINE);
  } else {
    if (receivedList) {
      if (receivedList.length > 0) {
        lines.push(`נקלט היום (${receivedList.length}):`);
        for (const line of receivedList) lines.push(`· ${line}`);
      } else if (missingCount === 0) {
        lines.push(QUIET_RECEIVED_LINE);
      }
      if (missingCount > 0) lines.push(`לא הובנו: ${missingCount}`);
    }
    if (doneLine) lines.push(doneLine);
    if (exam) lines.push(exam);
    if (dueList.length > 0) lines.push(`להגשה מחר: ${dueList.map(titleOf).join(' · ')}`);
    if (taskList && taskList.length > 0) {
      lines.push(`משימות פתוחות (${taskList.length}):`);
      for (const task of taskList) lines.push(taskLine(task, dateIso));
    }
    if (questions) lines.push(questions);
  }
  return {
    text: lines.join('\n'),
    received: receivedList ? receivedList.length : null,
    notUnderstood: missingCount,
    done: doneCount,
    tasks: taskList ? taskList.length : null,
    pending: pendingList ? pendingList.length : null,
    dueTomorrow: dueList.length,
    exam: exam !== null,
    partial: isPartial,
  };
}

// ---------------------------------------------------------------------------
// נוסח ההתראה (סעיף 6, H6: [הצעה] שממתינה לאישור יובל)
// ---------------------------------------------------------------------------

const positive = (value) => (Number.isInteger(value) && value > 0 ? value : 0);

// חלקים מופרדים ב-" · ", כל חלק מושמט כשהוא אפס (או null = לא נטען), בסדר: שורת מבחן מחר · "סיכום היום מחכה לסימון" (רק כש-reviewDue > 0)
// · "נקלטו N" · "N שאלות ממתינות" · "N משימות פתוחות". בלי חלקים: "יום שקט". מספרים בלבד, אף פעם לא כותרת משימה או טקסט הודעה (כמו briefPushText).
// [הצעה] partial=true (חלק מהנתונים לא נטען בניסיון האחרון) ובלי חלקים: "הסגירה של היום מחכה" במקום "יום שקט", כי אי אפשר לטעון שהיום היה שקט (כמו BRIEF_PUSH_WAITING בבוקר).
export const CLOSING_PUSH_WAITING = 'הסגירה של היום מחכה';
// [הצעה, ביקורת C-1] notUnderstoodCount: "לא הובנו N" אחרי "נקלטו N", כדי שערב שבו הגיעו רק הודעות שלא הובנו לא יוצג בטלפון כ"יום שקט" (ההודעה בצ'אט מציגה אותן).
export function closingPushText({ examLine = null, reviewDue = 0, receivedCount = 0, notUnderstoodCount = 0, pendingCount = 0, openTasks = 0, partial = false } = {}) {
  const parts = [];
  if (typeof examLine === 'string' && examLine !== '') parts.push(examLine);
  if (positive(reviewDue) > 0) parts.push(REVIEW_DUE_PUSH);
  const received = positive(receivedCount);
  if (received > 0) parts.push(`נקלטו ${received}`);
  const missed = positive(notUnderstoodCount);
  if (missed > 0) parts.push(`לא הובנו ${missed}`);
  const waiting = positive(pendingCount);
  if (waiting === 1) parts.push('שאלה אחת ממתינה');
  else if (waiting > 1) parts.push(`${waiting} שאלות ממתינות`);
  const open = positive(openTasks);
  if (open === 1) parts.push('משימה אחת פתוחה');
  else if (open > 1) parts.push(`${open} משימות פתוחות`);
  if (parts.length > 0) return parts.join(' · ');
  return partial ? CLOSING_PUSH_WAITING : QUIET_PUSH;
}
