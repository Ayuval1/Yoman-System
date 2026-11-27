// למידה ממה שיובל עושה בפועל, לא ממה שהוא כותב (את המילים המוח כבר מבין).
// מקורות: docs/02-rules/03-analysis-rules.md, '"לומדת לבד" — דרך המסלול הקיים, לא בתום זמן': "אחרי שני סבבים, מה שיובל עשה בפועל עולה בסקירה
// ('בשבוע עמוס העברת ש"ב מראשון לשני, 3 מתוך 3'); יובל מאשר; זה הופך לכלל (פעולה 18); מאותו רגע המערכת פועלת לבד — רק בסוג הזה."
// ו"אחרי השבועיים — סבבים מתגלגלים": סבב של 14 יום, הסקירה בתוך סגירת 21:00. docs/02-rules/03-app-channel-rules.md, "חריג אחד — פעולה 18 נאספת לסקירה":
// הכרטיס הוא פריט בתוך הסגירה פעם בשבועיים, לא קצב חדש. docs/01-foundation/אפיון-מורחב.md ח-7 (האיחוד: "כל 14 יום הכרטיס כולל גם סיכום של מה שנלמד").
// עיקרון-על שני ב-CLAUDE.md: מה שחוזר הופך לכלל כתוב אחרי אישור יובל, דרך candidate_rules. אותו מסלול כמו lib/correction-rules.js.
//
// מה נלמד (הכרעת Claude, 27.11, קל לשנות). רק מנתונים שהמערכת כבר שומרת, בלי כתיבה חדשה בזמן ההתנהגות:
//  1. study_skip:<יום>: "לא לומד היום" שוב ושוב באותו יום בשבוע. המכנה: ימים בחלון שהיה בהם אירוע למידה (events, domain 'study', מפתח source:study:,
//     כל סטטוס), לפי יום בשבוע של starts_at בשעון ישראל. המונה: מאותם ימים, אלה שבהם נשלחה בועת "בוטלה הלמידה של היום" (lib/study-plan.js answerNotStudying,
//     נכתבת רק כשבוטלה למידה בפועל). הכלל: הצעת תוכנית למידה לא משבצת ביום הזה, אלא אם אין יום אחר.
//  2. study_more: "עוד זמן" בתוכנית למידה שאושרה. המכנה: מבחנים שתוכנית הלמידה שלהם נענתה "כן" בחלון; המונה: מתוכם, אלה שנלחץ בהם "עוד זמן" לפני כן
//     (תשובות הכרטיסים: sources שמקושרים ב-messages.reply_source_id, ועובדת 'exam' של הכרטיס). הכלל: ההצעה מתחילה מ-4 שעות במקום 3.
//  לא נבנה, והסיבה: (א) "העברת מראשון לשני": אין נתון. המערכת לא קוראת הזזות של יובל ב-Google (api/google-webhook.js כותב מונים בלבד), ואין באפליקציה
//  פעולת "הזז" לשעה שהמערכת שיבצה; שורות changes נכתבות רק על ידי המערכת (changed_by 'system'). (ב) "שעה אחרת" בהצעת שעה למשימה (lib/time-suggest.js):
//  הכפתור דוחה שעה, לא יום, ואי אפשר להפריד ביניהם בלי לנחש. (ג) אורך למידה לפי מקצוע: אין נתון על כמה למד בפועל; "איך היה?" (exam_feel) הוא תחושה,
//  נשאל רק אחרי "אני מוכן", ונדיר מכדי לעבור סף של 3 למקצוע ב-28 יום.
//
// ספים (הכרעת Claude, 27.11, קל לשנות; [הנחה, לא אומת] שהם נכונים ליובל): לפחות 3 פעמים, ולפחות 2 מתוך 3, בשני הסבבים האחרונים (28 הימים שמסתיימים
// בערב הסקירה, כולל). הקצב: סגירת 21:00 של שבת דו-שבועית, מאותו עוגן של הבריף הדו-שבועי (lib/weekly-brief.js BIWEEKLY_ANCHOR, 28.11.2026). הראשונה 28.11.2026.
// כרטיס אחד לכל מועמד (כמו lib/correction-rules.js), כן / לא. מועמד שהוצע, אושר או נדחה לא מוצע שוב (המפתח ב-evidence.key). שתיקה לא מחליטה כלום:
// הכרטיס נשאר ממתין, בלי תפוגה.
// פרטיות: אין כאן טקסט של הודעה. המפתח והראיות הם יום בשבוע, תאריכים, ספירות ומפתחות מבחן (תאריך ומקצוע מהלוח). אין שמות.
// ההפעלה: קוד דטרמיניסטי, בלי AI, רק במה שהמערכת מציעה (offerStudyPlans). לא מזיז ולא מבטל אירוע קיים.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי. הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה.
import { addDays, daysBetween, weekdayOf, localDateIso, WEEKDAY_NAMES } from './intake-dates.js';
import { zonedToUtc } from './schedule-time.js';

const TIME_ZONE = 'Asia/Jerusalem';
const rowsOf = (result) => (Array.isArray(result) ? result : []);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const BEHAVIOR_ENTITY = 'behavior_rule';
export const BEHAVIOR_KIND = 'behavior';
export const BEHAVIOR_YES = 'כן';
export const BEHAVIOR_NO = 'לא';
export const BEHAVIOR_BUTTONS = Object.freeze([BEHAVIOR_YES, BEHAVIOR_NO]);
export const STUDY_SKIP = 'study_skip';
export const STUDY_MORE = 'study_more';
export const BEHAVIOR_MIN_COUNT = 3;
const RATIO_NUM = 2; // לפחות 2 מתוך 3
const RATIO_DEN = 3;
export const BEHAVIOR_WINDOW_DAYS = 28; // שני סבבים של 14 יום
// אותו עוגן כמו BIWEEKLY_ANCHOR ב-lib/weekly-brief.js (בדיקה מוודאת שהם שווים). לא מיובא משם כדי לא ליצור מעגל ייבוא דרך lib/study-plan.js.
export const REVIEW_ANCHOR = '2026-11-28';
const REVIEW_EVERY_DAYS = 14;
// כמו PLAN_BLOCKS ו-YES / MORE ב-lib/study-plan.js (בדיקה מוודאת). לא מיובא, מאותה סיבה.
export const BASE_BLOCKS = 3;
const PLAN_YES = 'כן';
const PLAN_MORE = 'עוד זמן';
// הכותרת של תשובת "לא לומד היום" כשבוטלה למידה (lib/study-plan.js notStudyingReply; בדיקה מוודאת).
export const NOT_STUDYING_HEAD = 'בוטלה הלמידה של היום';
export const EMPTY_BEHAVIOR = Object.freeze({ skipWeekdays: Object.freeze([]), extraBlocks: 0 });
// נוסחים (הכרעת Claude, 27.11, קל לשנות).
export const BEHAVIOR_YES_REPLY = 'נקבע. מעכשיו כך אציע';
export const BEHAVIOR_NO_REPLY = 'בסדר, לא אקבע כלל';

// ---------------------------------------------------------------------------
// קצב וחלון (טהור)
// ---------------------------------------------------------------------------

// ערב סקירה: שבת במרחק כפולה של 14 יום מהעוגן, מהעוגן והלאה.
export function isReviewEvening(dateIso) {
  if (typeof dateIso !== 'string' || !ISO_DAY.test(dateIso) || dateIso < REVIEW_ANCHOR) return false;
  try {
    return weekdayOf(dateIso) === 6 && daysBetween(REVIEW_ANCHOR, dateIso) % REVIEW_EVERY_DAYS === 0;
  } catch {
    return false;
  }
}

// 28 הימים שמסתיימים ביום הסקירה (כולל). from / to: חצות שעון ישראל, to בלעדי.
export function reviewRange(dateIso) {
  const fromDay = addDays(dateIso, -(BEHAVIOR_WINDOW_DAYS - 1));
  return { fromDay, toDay: dateIso, from: zonedToUtc(fromDay, '00:00', TIME_ZONE), to: zonedToUtc(addDays(dateIso, 1), '00:00', TIME_ZONE) };
}

export const passes = (n, m) => Number.isInteger(n) && Number.isInteger(m) && m > 0 && n >= BEHAVIOR_MIN_COUNT && n * RATIO_DEN >= m * RATIO_NUM;

// ---------------------------------------------------------------------------
// זיהוי (טהור)
// ---------------------------------------------------------------------------

// studyDays: ימים (YYYY-MM-DD) שהיה בהם אירוע למידה. skipDays: ימים עם בועת "בוטלה הלמידה של היום". ממצא לכל יום בשבוע שעובר את הסף.
export function studySkipFindings({ studyDays = [], skipDays = [] } = {}) {
  const study = [...new Set(rowsOf(studyDays).filter((d) => ISO_DAY.test(String(d))))].sort();
  const skipped = new Set(rowsOf(skipDays).filter((d) => ISO_DAY.test(String(d))));
  const byWeekday = new Map();
  for (const day of study) {
    const weekday = weekdayOf(day);
    const entry = byWeekday.get(weekday) ?? { m: 0, days: [] };
    entry.m += 1;
    if (skipped.has(day)) entry.days.push(day);
    byWeekday.set(weekday, entry);
  }
  return [...byWeekday.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, entry]) => passes(entry.days.length, entry.m))
    .map(([weekday, entry]) => ({ behavior: STUDY_SKIP, weekday, n: entry.days.length, m: entry.m, days: entry.days }));
}

// rows: [{ exam, answer }] תשובות לכרטיסי תוכנית הלמידה בחלון. תוכנית שאושרה ("כן") נספרת במכנה; אם נלחץ בה "עוד זמן", גם במונה.
export function studyMoreFinding(rows) {
  const byExam = new Map();
  for (const row of rowsOf(rows)) {
    if (typeof row?.exam !== 'string' || row.exam === '') continue;
    const answers = byExam.get(row.exam) ?? new Set();
    answers.add(typeof row.answer === 'string' ? row.answer.trim() : '');
    byExam.set(row.exam, answers);
  }
  const accepted = [...byExam.entries()].filter(([, answers]) => answers.has(PLAN_YES)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const more = accepted.filter(([, answers]) => answers.has(PLAN_MORE)).map(([exam]) => exam);
  if (!passes(more.length, accepted.length)) return null;
  return { behavior: STUDY_MORE, n: more.length, m: accepted.length, exams: more };
}

export function behaviorKey(finding) {
  if (finding?.behavior === STUDY_SKIP) return `beh:${STUDY_SKIP}:${finding.weekday}`;
  if (finding?.behavior === STUDY_MORE) return `beh:${STUDY_MORE}:1`;
  return null;
}

const hoursText = (n) => (n === 1 ? 'שעה אחת' : n === 2 ? 'שעתיים' : `${n} שעות`);

export function behaviorCardText(finding) {
  if (finding.behavior === STUDY_SKIP) {
    const day = WEEKDAY_NAMES[finding.weekday];
    return `בשבועות האחרונים ביטלת את הלמידה ביום ${day}, ${finding.n} מתוך ${finding.m}. לקבוע שמעכשיו לא אציע למידה ביום ${day}, אלא אם אין יום אחר?`;
  }
  return `בשבועות האחרונים ביקשת עוד זמן בתוכנית למידה, ${finding.n} מתוך ${finding.m}. לקבוע שמעכשיו אציע ${hoursText(BASE_BLOCKS + 1)} למידה למבחן במקום ${BASE_BLOCKS}?`;
}

// ---------------------------------------------------------------------------
// הצעה (סגירת 21:00 של ערב הסקירה, api/queues/deliver.js)
// ---------------------------------------------------------------------------

async function loadFindings(sql, range) {
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  const studyRows = rowsOf(await sql`
    SELECT /* behavior-study-days */ starts_at FROM events
    WHERE domain = 'study' AND match_key LIKE 'source:study:%' AND starts_at >= ${from}::timestamptz AND starts_at < ${to}::timestamptz
  `);
  const skipRows = rowsOf(await sql`
    SELECT /* behavior-skip-days */ sent_at FROM messages
    WHERE direction = 'out' AND kind = 'update' AND entity_type = 'source' AND body LIKE ${`${NOT_STUDYING_HEAD}%`}::text
      AND sent_at >= ${from}::timestamptz AND sent_at < ${to}::timestamptz
  `);
  const planRows = rowsOf(await sql`
    SELECT /* behavior-plan-answers */ f.value AS exam, s.raw_content AS answer
    FROM messages m
      JOIN facts f ON f.entity_type = 'study_plan' AND f.entity_id = m.entity_id AND f.field = 'exam'
      JOIN sources s ON s.id = m.reply_source_id
    WHERE m.entity_type = 'study_plan' AND m.kind = 'question' AND s.sender = 'answer'
      AND s.received_at >= ${from}::timestamptz AND s.received_at < ${to}::timestamptz
  `);
  const dayOf = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : localDateIso(date, TIME_ZONE);
  };
  const findings = studySkipFindings({
    studyDays: studyRows.map((row) => dayOf(row?.starts_at)).filter(Boolean),
    skipDays: skipRows.map((row) => dayOf(row?.sent_at)).filter(Boolean),
  });
  const more = studyMoreFinding(planRows);
  return more ? [...findings, more] : findings;
}

// בערב סקירה בלבד: לכל ממצא שעובר את הסף ועוד לא הוצע, מועמד ב-candidate_rules וכרטיס כן / לא, בפקודה אטומית אחת.
// לא זורק לעולם (הסגירה ממשיכה). מחזיר { created: [מפתחות] }.
export async function proposeBehaviorRules({ sql, dateIso, now = new Date() }) {
  void now;
  if (!isReviewEvening(dateIso)) return { created: [] };
  try {
    const range = reviewRange(dateIso);
    const created = [];
    for (const finding of await loadFindings(sql, range)) {
      const key = behaviorKey(finding);
      const evidence = JSON.stringify({ kind: BEHAVIOR_KIND, ...finding, key, window: { from: range.fromDay, to: range.toDay } });
      const body = behaviorCardText(finding);
      // [הנחה, לא אומת] כמו ב-lib/correction-rules.js: NOT EXISTS לא מונע כפילות במירוץ נדיר (אין אינדקס ייחודי, שינוי סכמה לא נעשה).
      const [row] = rowsOf(await sql`
        WITH ins AS (
          INSERT INTO candidate_rules (pattern, occurrences, first_seen, last_seen, evidence, status)
          SELECT /* behavior-propose */ ${key}::text, ${finding.n}::integer, now(), now(), ${evidence}::jsonb, 'candidate'
          WHERE NOT EXISTS (SELECT 1 FROM candidate_rules x WHERE x.evidence ->> 'key' = ${key}::text)
          RETURNING id
        ), q AS (
          INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
          SELECT 'out', ${body}::text, 'question', now(), true, NULL::uuid, NULL::timestamptz, ${BEHAVIOR_ENTITY}::text, ins.id, 1
          FROM ins
          RETURNING id
        )
        SELECT (SELECT id FROM ins) AS candidate_id, (SELECT id FROM q) AS question_id
      `);
      if (row?.candidate_id) created.push(key);
    }
    return { created };
  } catch (error) {
    console.error('behavior-rules: הצעת הכללים נכשלה:', error?.name);
    return { created: [] };
  }
}

// ---------------------------------------------------------------------------
// תשובה (api/chat.js)
// ---------------------------------------------------------------------------

// { status: 'answered' | 'closed' | 'unclear', created }. כשל מסד נזרק (api/chat.js מחזיר 500).
export async function answerBehaviorRule({ sql, messageId, answer }) {
  const closed = { status: 'closed', created: {} };
  const [ask] = rowsOf(await sql`
    SELECT /* behavior-ask */ m.id, m.awaiting_reply, c.id AS candidate_id, c.status, c.evidence
    FROM messages m JOIN candidate_rules c ON c.id = m.entity_id
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type = ${BEHAVIOR_ENTITY}::text
  `);
  if (!ask || ask.awaiting_reply !== true || ask.status !== 'candidate' || ask.evidence?.kind !== BEHAVIOR_KIND) return closed;
  const text = typeof answer === 'string' ? answer.trim() : '';
  if (text !== BEHAVIOR_YES && text !== BEHAVIOR_NO) return { status: 'unclear', created: {} };
  const yes = text === BEHAVIOR_YES;
  const [written] = rowsOf(await sql`
    WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = ${BEHAVIOR_ENTITY}::text
      RETURNING id, reply_source_id, entity_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${text}::text, NULL::text, now(), now()
      FROM closed
      RETURNING id
    ), r AS (
      UPDATE candidate_rules SET status = ${yes ? 'approved' : 'rejected'}::text, last_seen = now()
      WHERE id = (SELECT entity_id FROM closed) AND status = 'candidate'
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT /* behavior-write */ 'out', ${yes ? BEHAVIOR_YES_REPLY : BEHAVIOR_NO_REPLY}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, ${BEHAVIOR_ENTITY}::text, closed.entity_id, NULL::integer
      FROM closed
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id, (SELECT id FROM b) AS bubble_id
  `);
  if (Number(written?.closed) === 0) return closed;
  return { status: 'answered', created: { answerSourceId: written?.answer_source_id ?? null, bubbleId: written?.bubble_id ?? null } };
}

// ---------------------------------------------------------------------------
// הפעלה (lib/study-plan.js offerStudyPlans)
// ---------------------------------------------------------------------------

// הכללים שיובל אישר: { skipWeekdays: [0..6], extraBlocks: 0 | 1 }. כשל מסד: אין כללים (נכשל פתוח: ההצעה כמו קודם), ורק שם השגיאה בלוג.
export async function loadBehaviorRules(sql) {
  try {
    const skip = new Set();
    let extraBlocks = 0;
    for (const row of rowsOf(await sql`
      SELECT /* behavior-approved */ evidence FROM candidate_rules WHERE status = 'approved' AND evidence ->> 'kind' = ${BEHAVIOR_KIND}::text
    `)) {
      const evidence = row?.evidence;
      if (evidence?.kind !== BEHAVIOR_KIND) continue;
      if (evidence.behavior === STUDY_SKIP && Number.isInteger(evidence.weekday) && evidence.weekday >= 0 && evidence.weekday <= 6) skip.add(evidence.weekday);
      if (evidence.behavior === STUDY_MORE) extraBlocks = 1;
    }
    return { skipWeekdays: [...skip].sort((a, b) => a - b), extraBlocks };
  } catch (error) {
    console.error('behavior-rules: טעינת הכללים נכשלה:', error?.name);
    return EMPTY_BEHAVIOR;
  }
}

// הימים שמותר להעדיף: בלי הימים שיובל אישר להימנע מהם. days: [{ date, ... }].
export function preferredDays(days, behavior) {
  const skip = Array.isArray(behavior?.skipWeekdays) ? behavior.skipWeekdays : [];
  if (skip.length === 0) return days;
  return days.filter((day) => !skip.includes(weekdayOf(day.date)));
}
