// תוכנית למידה למבחן (בלוק 7, docs/01-foundation/אפיון-מורחב.md סעיף 6; פרק 10 ב-02-build-plan.md:151).
// מקורות:
//  - docs/02-rules/03-analysis-rules.md:386 "היקף ההצעה — שלוש שעות, ושורת הרחבה (הכרעת יובל, 28.9.2026)": "15:00–16:00 · 16:15–17:00 · 17:45–18:45. אפשר להוסיף עוד — להוסיף?".
//  - 03-analysis-rules.md "פרטים שנקבעו": אישור אחד מכסה את כל התוכנית; expires_at = תחילת החלון הראשון; שתיקה לא מחליטה כלום.
//  - docs/02-rules/03-boundaries-rules.md "עיקרון השיבוץ": למידה למבחן רק בתוך טווח ההכנה שלו (03-personal-weights-rules.md 3.1:
//    מבחן שבוע וחצי עד שבועיים, מבדק עד שבוע, מבדק בתנ"ך שלושה ימים). כלל 9: לא יותר משעה רצוף, ואחריה הפסקה של רבע שעה לפחות.
//  - 01-system-overview.md, הכרעות יובל על 8 השאלות (23.11.2026), ש6 = א': שלוש שעות לכל המקצועות.
//  - הטריגר "לכל מבחן, כשהוא נכנס לחלון ההכנה": הכרעה תחת האישור המלא של יובל (23.11.2026 לילה), ההמלצה שלו. רשום ב-01-system-overview.md.
//
// החלוקה (CLAUDE.md): הכול בקוד, בלי מוח. הזמן הפנוי נגזר מאותם כללים כמו הצעת השעה למשימה (lib/time-suggest.js: openWindows, freeSlots,
// loadBusyDays), כולל "יום אימון: רק 16:00–17:00". הכרטיס הוא שורת messages (entity_type='study_plan') והעובדות שלו ב-facts, בלי טבלה חדשה.
// אחרי "כן" נכתבים אירועים (domain 'study', יומן Google "לימוד") בדרך הקיימת (lib/event-sync.js, syncEventsByMatchKeys).
//
// הכרעות טכניות, כולן [הנחה, לא אומת] וקל להפוך (קבועים למטה):
//  - פתיחת טווח ההכנה: מבחן (וגם אנסין) 10 ימים לפני ("שבוע וחצי", הקצה הקרוב), מבדק 7, מבדק בתנ"ך 3. קצה ההשוואה פתוח לפרק 8 (03-analysis-rules.md:399).
//  - בלוק = 60 דקות (כלל 9). בין שני בלוקים באותו יום לפחות 15 דקות (כלל 9; ברשת של חצי שעה זה יוצא 30).
//  - הפיזור: מהיום שלפני המבחן אחורה, בלוק אחד לכל יום בסבב הראשון, ורק אז בלוק שני באותו יום. כך שלוש השעות קרובות למבחן ומפוזרות.
//  - "עוד זמן": מוסיף בלוק אחד מהרזרבה (עד SPARE_MAX), ונשאל שוב באותו כרטיס.
//  - פעם אחת לכל מבחן (מפתח exam:<תאריך>:<מקצוע>, התאריך הנוכחי אחרי הזזה). מבחן שהוזז לתאריך אחר מקבל הצעה חדשה כשייכנס לטווח.
//  - Google לא נבדק (כשל, חסר הגדרות, חריגת זמן): לא מציעים היום; מנסים שוב בבריף של מחר.
//  - אין אף חלון פנוי בטווח: הודעה אחת (בלי כפתורים) שאומרת זאת, כדי שהמקרה לא ייפול בין הכיסאות (עקרון-העל השני).
// פרטיות: אין כאן טקסט של הודעה. רק סוג המבחן, המקצוע והתאריך מהלוח.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי. הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה.
import { randomUUID } from 'node:crypto';
import { openWindows, freeSlots, loadBusyDays, BUSY_TIMEOUT_MS } from './time-suggest.js';
import { loadTimetable } from './timetable.js';
import { EXAMS } from './exam-line.js';
import { addDays, weekdayOf, formatDayMonth, localDateIso, WEEKDAY_NAMES } from './intake-dates.js';
import { localParts, zonedToUtc } from './schedule-time.js';

const TIME_ZONE = 'Asia/Jerusalem';
const rowsOf = (result) => (Array.isArray(result) ? result : []);

export const STUDY_PLAN_ENTITY = 'study_plan';
export const STUDY_DOMAIN = 'study';
export const YES = 'כן';
export const MORE = 'עוד זמן';
export const NO = 'לא';
export const STUDY_PLAN_BUTTONS = Object.freeze([YES, MORE, NO]);
export const PLAN_BLOCKS = 3; // ש6 = א': שלוש שעות
export const SPARE_MAX = 3; // הנחה, לא אומת: כמה בלוקים "עוד זמן" יכול להוסיף
export const BREAK_MINUTES = 15; // כלל 9
const NOW_BUFFER_MINUTES = 30; // הנחה, לא אומת (כמו lib/time-suggest.js)
const GRID_MINUTES = 30;
// טווח ההכנה בימים (03-personal-weights-rules.md 3.1). הנחה, לא אומת: מבחן = 10 ("שבוע וחצי"), אנסין כמו מבחן.
export const PREP_DAYS = Object.freeze({ 'מבחן': 10, 'אנסין': 10, 'מבדק': 7 });
const BIBLE_QUIZ_DAYS = 3;
const DEFAULT_PREP_DAYS = 10;

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const examKey = (exam) => `exam:${exam.date}:${exam.subject}`;
export const studyKey = (exam, block) => `source:study:${exam.date}:${exam.subject}:${block.date}T${block.start}`;
export const examLabel = (exam) => `${exam.type} ב${exam.subject}`;

export function prepDays(exam) {
  if (exam?.type === 'מבדק' && exam?.subject === 'תנ"ך') return BIBLE_QUIZ_DAYS;
  return PREP_DAYS[exam?.type] ?? DEFAULT_PREP_DAYS;
}

// המבחנים שהטווח שלהם פתוח היום: לא מועד ב', יש מקצוע, אחרי היום, ותחילת הטווח (תאריך פחות prepDays) כבר הגיעה.
export function examsToPlan(todayIso, { exams = EXAMS } = {}) {
  const seen = new Set();
  return (Array.isArray(exams) ? exams : []).filter((exam) => {
    if (!exam || exam.makeup === true || typeof exam.subject !== 'string' || exam.subject === '' || !ISO_DAY.test(exam.date ?? '')) return false;
    if (exam.postponed === true) return false; // נדחה בלי מועד חדש: אין לאן לתכנן
    if (!(exam.date > todayIso && addDays(exam.date, -prepDays(exam)) <= todayIso)) return false;
    const key = examKey(exam);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// משבצות של שעה ביום עם הפסקה של BREAK_MINUTES לפחות בין שתיים עוקבות (כלל 9).
export function spacedSlots({ windows, items = [], earliest = 0 }) {
  const out = [];
  let cursor = earliest;
  for (;;) {
    const [slot] = freeSlots({ windows, items, earliest: cursor });
    if (!slot) return out;
    out.push(slot);
    cursor = minutesOf(slot.end) + BREAK_MINUTES;
  }
}

// days: [{ date, slots }]. בלוקים: מהיום המאוחר אחורה, סבב לכל יום. מחזיר { blocks (ממוינים), spare (בסדר הבחירה) }.
export function pickBlocks(days, { count = PLAN_BLOCKS, spareMax = SPARE_MAX } = {}) {
  const ordered = [...days].sort((a, b) => (a.date < b.date ? 1 : -1));
  const picked = [];
  const depth = Math.max(0, ...ordered.map((day) => day.slots.length));
  for (let round = 0; round < depth; round += 1) {
    for (const day of ordered) if (day.slots[round]) picked.push({ date: day.date, ...day.slots[round] });
  }
  const sort = (list) => [...list].sort((a, b) => (`${a.date}${a.start}` < `${b.date}${b.start}` ? -1 : 1));
  return { blocks: sort(picked.slice(0, count)), spare: picked.slice(count, count + spareMax) };
}

const dayName = (date) => WEEKDAY_NAMES[weekdayOf(date)];
const blockLine = (block) => `· ${dayName(block.date)} ${formatDayMonth(block.date)} ${block.start}–${block.end}`;
const hoursText = (n) => (n === 1 ? 'שעה אחת' : n === 2 ? 'שעתיים' : `${n} שעות`);

export function planText({ exam, blocks, spare = [] }) {
  return [
    `תוכנית למידה ל${examLabel(exam)} (${dayName(exam.date)} ${formatDayMonth(exam.date)}), ${hoursText(blocks.length)}:`,
    ...blocks.map(blockLine),
    spare.length > 0 ? 'להכניס ליומן? אפשר גם להוסיף עוד זמן.' : 'להכניס ליומן?',
  ].join('\n');
}
const noRoomText = (exam) => `לא מצאתי זמן פנוי ללמידה ל${examLabel(exam)} (${dayName(exam.date)} ${formatDayMonth(exam.date)}) לפי הגבולות. כדאי לבדוק את הימים שלפניו.`;

const instantOf = (date, hhmm) => zonedToUtc(date, hhmm, TIME_ZONE);
const ceilToGrid = (minutes) => Math.ceil(minutes / GRID_MINUTES) * GRID_MINUTES;

const cardFacts = ({ exam, blocks, spare }) => [
  { field: 'exam', value: examKey(exam) },
  { field: 'exam_date', value: exam.date },
  { field: 'exam_type', value: exam.type },
  { field: 'subject', value: exam.subject },
  { field: 'blocks', value: JSON.stringify(blocks) },
  { field: 'spare', value: JSON.stringify(spare) },
];

// ---------------------------------------------------------------------------
// יצירה (הבריף של 07:30, api/queues/deliver.js)
// ---------------------------------------------------------------------------

async function alreadyOffered(sql, keys) {
  if (keys.length === 0) return new Set();
  const rows = rowsOf(await sql`
    SELECT /* study-plan-offered */ DISTINCT f.value FROM facts f
    WHERE f.entity_type = ${STUDY_PLAN_ENTITY}::text AND f.field = 'exam' AND f.value = ANY(${keys}::text[])
  `);
  return new Set(rows.map((row) => row.value));
}

// לכל מבחן שהטווח שלו פתוח ועוד לא הוצע: כרטיס אחד. לא זורק לעולם (הבריף ממשיך); מחזיר { created: [מפתחות], skipped: reason? }.
export async function offerStudyPlans({ sql, todayIso, now = new Date(), exams = EXAMS, timetable, googleDay, timeoutMs = BUSY_TIMEOUT_MS }) {
  // בלי הגדרות Google אין נתונים מלאים, ולכן אין הצעה (וגם לא נוגעים במסד).
  if (typeof googleDay !== 'function') return { created: [], skipped: 'google_skipped' };
  try {
    const candidates = examsToPlan(todayIso, { exams });
    if (candidates.length === 0) return { created: [] };
    const offered = await alreadyOffered(sql, candidates.map(examKey));
    const pending = candidates.filter((exam) => !offered.has(examKey(exam)));
    if (pending.length === 0) return { created: [] };
    const table = timetable === undefined ? await loadTimetable(sql) : timetable;
    const lastExam = pending.map((exam) => exam.date).sort().at(-1);
    const dates = [];
    for (let date = todayIso; date < lastExam; date = addDays(date, 1)) dates.push(date);
    const loaded = await loadBusyDays({ sql, dates, timetable: table, googleDay, timeoutMs });
    if (!loaded.ok) {
      console.error('study-plan: היומן לא נבדק במלואו, אין הצעה היום:', loaded.reason); // קוד בלבד
      return { created: [], skipped: loaded.reason };
    }
    const parts = localParts(now, TIME_ZONE);
    const nowMinutes = localDateIso(now, TIME_ZONE) === todayIso ? parts.hour * 60 + parts.minute : 0;
    const reserved = new Map(); // תאריך -> בלוקים שהוצעו למבחן קודם באותה ריצה
    const created = [];
    for (const exam of [...pending].sort((a, b) => (a.date < b.date ? -1 : 1))) {
      const from = [todayIso, addDays(exam.date, -prepDays(exam))].sort().at(-1);
      const days = dates.filter((date) => date >= from && date < exam.date).map((date) => {
        const busy = loaded.busyByDate.get(date);
        const items = [...busy.items, ...(reserved.get(date) ?? []).map((b) => ({ title: 'למידה', start: b.start, end: b.end, domain: STUDY_DOMAIN }))];
        const earliest = date === todayIso ? ceilToGrid(nowMinutes + NOW_BUFFER_MINUTES) : 0;
        return { date, slots: spacedSlots({ windows: openWindows({ dateIso: date, busy }), items, earliest }) };
      });
      const { blocks, spare } = pickBlocks(days);
      for (const block of [...blocks, ...spare]) reserved.set(block.date, [...(reserved.get(block.date) ?? []), block]);
      const cardId = randomUUID();
      const facts = cardFacts({ exam, blocks, spare });
      const question = blocks.length > 0;
      const body = question ? planText({ exam, blocks, spare }) : noRoomText(exam);
      const expiresAt = question ? instantOf(blocks[0].date, blocks[0].start).toISOString() : null;
      const [row] = rowsOf(await sql`
        /* study-plan-create */ WITH m AS (
          INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
          SELECT 'out', ${body}::text, ${question ? 'question' : 'update'}::text, now(), ${question}::boolean, NULL::uuid, ${expiresAt}::timestamptz, ${STUDY_PLAN_ENTITY}::text, ${cardId}::uuid, ${question ? 1 : null}::integer
          WHERE NOT EXISTS (SELECT 1 FROM facts p WHERE p.entity_type = ${STUDY_PLAN_ENTITY}::text AND p.field = 'exam' AND p.value = ${examKey(exam)}::text)
          RETURNING id
        ), f AS (
          INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin)
          SELECT NULL::uuid, x.field, x.value, 'certain', 'script', ${STUDY_PLAN_ENTITY}::text, ${cardId}::uuid, 'read'
          FROM jsonb_to_recordset(${JSON.stringify(facts)}::jsonb) AS x(field text, value text)
          WHERE EXISTS (SELECT 1 FROM m)
          RETURNING id
        )
        SELECT (SELECT id FROM m) AS message_id
      `);
      if (row?.message_id) created.push(examKey(exam));
    }
    return { created };
  } catch (error) {
    console.error('study-plan: יצירת ההצעה נכשלה:', error?.name);
    return { created: [], skipped: 'error' };
  }
}

// ---------------------------------------------------------------------------
// תשובה (api/chat.js)
// ---------------------------------------------------------------------------

function parseBlocks(value) {
  try {
    const list = JSON.parse(value);
    return (Array.isArray(list) ? list : []).filter((b) => ISO_DAY.test(b?.date ?? '') && HHMM.test(b?.start ?? '') && HHMM.test(b?.end ?? ''));
  } catch {
    return [];
  }
}

async function writeAnswer(sql, work, nowIso) {
  const next = work.next ?? null;
  const rows = rowsOf(await sql`
    /* study-plan-write */ WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${work.messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = ${STUDY_PLAN_ENTITY}::text
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING id, reply_source_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${work.answer}::text, NULL::text, now(), now() FROM closed
      RETURNING id
    ), ev AS (
      INSERT INTO events (title, starts_at, ends_at, location, description, domain, movable, status, external_id, commitment_id, match_key)
      SELECT x.title, x.starts_at::timestamptz, x.ends_at::timestamptz, NULL::text, NULL::text, ${STUDY_DOMAIN}::text, true, 'planned', NULL::text, NULL::uuid, x.match_key
      FROM jsonb_to_recordset(${JSON.stringify(work.events ?? [])}::jsonb) AS x(title text, starts_at text, ends_at text, match_key text)
      WHERE EXISTS (SELECT 1 FROM closed) AND NOT EXISTS (SELECT 1 FROM events e WHERE e.match_key = x.match_key)
      RETURNING match_key
    ), q AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${next?.body ?? null}::text, 'question', now(), true, NULL::uuid, ${next?.expiresAt ?? null}::timestamptz, ${STUDY_PLAN_ENTITY}::text, ${next?.cardId ?? null}::uuid, 1
      FROM closed WHERE ${next?.body ?? null}::text IS NOT NULL
      RETURNING id
    ), qf AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin)
      SELECT NULL::uuid, x.field, x.value, 'certain', 'script', ${STUDY_PLAN_ENTITY}::text, ${next?.cardId ?? null}::uuid, 'read'
      FROM jsonb_to_recordset(${JSON.stringify(next?.facts ?? [])}::jsonb) AS x(field text, value text)
      WHERE EXISTS (SELECT 1 FROM q)
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${work.bubble ?? null}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', closed.reply_source_id, NULL::integer
      FROM closed WHERE ${work.bubble ?? null}::text IS NOT NULL
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id, (SELECT id FROM b) AS bubble_id,
      (SELECT coalesce(jsonb_agg(match_key), '[]'::jsonb) FROM ev) AS keys
  `);
  return rows[0] ?? {};
}

const CLOSED = Object.freeze({ status: 'closed', created: {}, keys: [], patchKeys: [] });

// תשובה לכרטיס. { status: 'answered' | 'closed' | 'unclear', created, keys, patchKeys }. כשל מסד נזרק (api/chat.js מחזיר 500).
//  - "כן": כל בלוק נבדק שוב שהוא פנוי; פנוי נכתב כאירוע ביומן "לימוד", תפוס מדולג ונאמר בבועה. Google לא נבדק: לא נכתב כלום, והכרטיס נשאל שוב.
//  - "עוד זמן": בלוק אחד מהרזרבה נוסף, והכרטיס נשאל שוב. אין רזרבה: נאמר, והכרטיס נשאל שוב כמו שהוא.
//  - "לא": נסגר, בלי אירועים.
export async function answerStudyPlan({ sql, messageId, answer, now = new Date(), timetable, googleDay }) {
  const nowIso = now.toISOString();
  const [ask] = rowsOf(await sql`
    SELECT /* study-plan-ask */ m.id, m.awaiting_reply, m.entity_id AS card_id,
      (SELECT jsonb_object_agg(f.field, f.value) FROM facts f WHERE f.entity_type = ${STUDY_PLAN_ENTITY}::text AND f.entity_id = m.entity_id) AS facts
    FROM messages m
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type = ${STUDY_PLAN_ENTITY}::text
      AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
  `);
  if (!ask || ask.awaiting_reply !== true) return CLOSED;
  const text = typeof answer === 'string' ? answer.trim() : '';
  if (!STUDY_PLAN_BUTTONS.includes(text)) return { status: 'unclear', created: {}, keys: [], patchKeys: [] };
  const facts = ask.facts && typeof ask.facts === 'object' ? ask.facts : {};
  const exam = { date: facts.exam_date, type: facts.exam_type, subject: facts.subject };
  const blocks = parseBlocks(facts.blocks);
  const spare = parseBlocks(facts.spare);
  const work = { messageId, answer: text, events: [], bubble: null, next: null };
  const reask = (newBlocks, newSpare) => {
    const future = newBlocks.filter((b) => instantOf(b.date, b.start).getTime() > now.getTime());
    if (future.length === 0) return null;
    const cardId = randomUUID();
    return {
      cardId, body: planText({ exam, blocks: future, spare: newSpare }), expiresAt: instantOf(future[0].date, future[0].start).toISOString(),
      facts: cardFacts({ exam, blocks: future, spare: newSpare }),
    };
  };
  const validExam = ISO_DAY.test(exam.date ?? '') && typeof exam.subject === 'string' && typeof exam.type === 'string';
  if (!validExam || blocks.length === 0 || text === NO) {
    if (validExam && text === NO) work.bubble = `בלי תוכנית למידה · ${examLabel(exam)}`;
  } else if (text === MORE) {
    const future = spare.filter((b) => instantOf(b.date, b.start).getTime() > now.getTime());
    if (future.length > 0) {
      const [added, ...rest] = future;
      const sorted = [...blocks, added].sort((a, b) => (`${a.date}${a.start}` < `${b.date}${b.start}` ? -1 : 1));
      work.next = reask(sorted, rest);
    } else {
      work.bubble = `אין עוד זמן פנוי לפני ה${examLabel(exam)}`;
      work.next = reask(blocks, []);
    }
  } else {
    const table = timetable === undefined ? await loadTimetable(sql) : timetable;
    const dates = [...new Set(blocks.map((b) => b.date))];
    const loaded = await loadBusyDays({ sql, dates, timetable: table, googleDay, timeoutMs: BUSY_TIMEOUT_MS });
    if (!loaded.ok) {
      work.bubble = 'לא הצלחתי לבדוק את היומן עכשיו, לא נכתב כלום. אפשר ללחוץ שוב בעוד רגע.';
      work.next = reask(blocks, spare);
    } else {
      const free = [];
      const taken = [];
      for (const block of blocks) {
        const busy = loaded.busyByDate.get(block.date);
        const from = minutesOf(block.start);
        const to = minutesOf(block.end);
        const inWindow = openWindows({ dateIso: block.date, busy }).some(([s, e]) => s <= from && to <= e);
        const clash = busy.items.some((item) => {
          const s = minutesOf(item.start);
          const e = minutesOf(item.end);
          return s === e ? s >= from && s < to : s < to && e > from;
        });
        const future = instantOf(block.date, block.start).getTime() > now.getTime();
        (future && inWindow && !clash ? free : taken).push(block);
      }
      work.events = free.map((block) => ({
        title: `למידה ל${examLabel(exam)}`,
        starts_at: instantOf(block.date, block.start).toISOString(),
        ends_at: instantOf(block.date, block.end).toISOString(),
        match_key: studyKey(exam, block),
      }));
      const lines = [];
      if (free.length > 0) lines.push(`נכנס ליומן "לימוד" · ${examLabel(exam)}:`, ...free.map(blockLine));
      if (taken.length > 0) lines.push(`נתפס בינתיים, לא נכנס: ${taken.map((b) => `${dayName(b.date)} ${b.start}`).join(', ')}`);
      work.bubble = lines.join('\n');
    }
  }
  const written = await writeAnswer(sql, work, nowIso);
  if (Number(written?.closed) === 0) return CLOSED;
  const keys = Array.isArray(written?.keys) ? written.keys.filter((k) => typeof k === 'string') : [];
  return { status: 'answered', created: { answerSourceId: written?.answer_source_id ?? null, bubbleId: written?.bubble_id ?? null }, keys, patchKeys: [] };
}

// ---------------------------------------------------------------------------
// "לא לומד היום, אני מוכן" (הכרעת יובל 3.10.2026, ג': ביטול + תשובה בשורה אחת: ימים למבחן וחלונות שנותרו). 02-build-plan.md:499.
// "איך היה?" אחרי המבחן לא נבנה: אין מקום מוגדר לשמירת התוצאה (05-open-questions.md:24, "אין באפשרותי לאשר"). רשום כשאלה.
// ---------------------------------------------------------------------------

const NOT_STUDYING = /(^|[^א-ת])לא\s+(?:אלמד|לומד|לומדת|ללמוד)\s+היום/;
export const detectNotStudying = (text) => typeof text === 'string' && NOT_STUDYING.test(text);

const KEY_PARTS = /^source:study:(\d{4}-\d{2}-\d{2}):(.+):(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

// אירועי הלמידה של היום שעוד לא נגמרו מבוטלים (status='cancelled'; event-sync מוחק אותם מ-Google). התשובה: שורה אחת.
// מחזיר { status: 'recorded' | 'skipped', reply, calendarKeys }. כשל מסד נזרק (הצינור מטפל).
export async function answerNotStudying({ sql, source, now = new Date() }) {
  const today = localDateIso(now, TIME_ZONE);
  const from = zonedToUtc(today, '00:00', TIME_ZONE).toISOString();
  const to = zonedToUtc(addDays(today, 1), '00:00', TIME_ZONE).toISOString();
  const nowIso = now.toISOString();
  const [row] = rowsOf(await sql`
    /* study-not-today */ WITH claim AS (
      UPDATE sources SET processed_at = now() WHERE id = ${source.id}::uuid AND processed_at IS NULL RETURNING id
    ), cancelled AS (
      UPDATE events SET status = 'cancelled'
      WHERE domain = ${STUDY_DOMAIN}::text AND status = 'planned' AND match_key LIKE 'source:study:%'
        AND starts_at >= ${from}::timestamptz AND starts_at < ${to}::timestamptz AND ends_at > ${nowIso}::timestamptz
        AND EXISTS (SELECT 1 FROM claim)
      RETURNING match_key
    ), later AS (
      SELECT e.match_key FROM events e
      WHERE e.domain = ${STUDY_DOMAIN}::text AND e.status = 'planned' AND e.match_key LIKE 'source:study:%' AND e.starts_at >= ${to}::timestamptz
    )
    SELECT (SELECT count(*) FROM claim)::int AS claimed,
      (SELECT coalesce(jsonb_agg(match_key), '[]'::jsonb) FROM cancelled) AS cancelled,
      (SELECT coalesce(jsonb_agg(match_key), '[]'::jsonb) FROM later) AS later
  `);
  if (!row || Number(row.claimed) === 0) return { status: 'skipped', reply: 'התקבל', calendarKeys: [] };
  const cancelled = (Array.isArray(row.cancelled) ? row.cancelled : []).filter((k) => typeof k === 'string');
  const later = (Array.isArray(row.later) ? row.later : []).filter((k) => typeof k === 'string');
  const reply = notStudyingReply({ today, cancelled, later });
  await sql`
    /* study-not-today-bubble */ INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
    SELECT 'out', ${reply}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', ${source.id}::uuid, NULL::integer
    WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source' AND x.entity_id = ${source.id}::uuid)
  `;
  return { status: 'recorded', reply, calendarKeys: cancelled };
}

// השורה האחת: מבחן קרוב (מהאירועים שבוטלו, ואם אין, מהבאים) + ימים עד אליו + כמה בלוקי למידה נשארו לו ביומן.
export function notStudyingReply({ today, cancelled = [], later = [] }) {
  const parse = (key) => {
    const m = KEY_PARTS.exec(key);
    return m ? { examDate: m[1], subject: m[2] } : null;
  };
  const target = [...cancelled, ...later].map(parse).filter(Boolean).sort((a, b) => (a.examDate < b.examDate ? -1 : 1))[0];
  if (cancelled.length === 0) {
    if (!target) return 'אין היום למידה ביומן, אין מה לבטל.';
  }
  if (!target) return `בוטלה הלמידה של היום (${hoursText(cancelled.length)}).`;
  const days = Math.round((Date.parse(`${target.examDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  const left = later.map(parse).filter((p) => p && p.examDate === target.examDate && p.subject === target.subject).length;
  const head = cancelled.length > 0 ? `בוטלה הלמידה של היום (${hoursText(cancelled.length)}).` : 'אין היום למידה ביומן.';
  return `${head} עד ${target.subject} ${days === 1 ? 'נשאר יום אחד' : `נשארו ${days} ימים`}, ו${left === 0 ? 'אין עוד למידה ביומן' : `עוד ${hoursText(left)} למידה ביומן`}.`;
}

