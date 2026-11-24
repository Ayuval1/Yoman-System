// יום "מחוץ לבית" (אירוע אישי של כמה ימים, כמו "חופשה בווינה"): שלב 2 של אירוע כללי (הכרעת יובל, 24.11.2026).
// א: בזמן אירוע כזה יובל מחוץ לבית. הימים תפוסים (אין תוכנית למידה, אין הצעת שעה למשימה, אין הצעת האזנה), וכל מה שנפל לתוכו מוצג בכרטיס אחד.
// "יש לי מועד ב' אז המבחנים עוברים למועד ב' הכי קרוב": לכל מבחן בטווח מוצע מועד ב' הקרוב אחרי האירוע (שורות makeup=true בלוח, data/school-exams.json).
// [הנחה, לא אומת] שני מבחנים יכולים לשבת באותו מועד ב': לא נקבע בשום מסמך. יובל מאשר בכרטיס.
//
// החלוקה (CLAUDE.md): הכול בקוד, בלי מוח. הכרטיס הוא שורת messages (entity_type='away_conflict') והעובדות שלו ב-facts, בלי טבלה חדשה.
// "כן": כל מבחן עובר למועד ב' באותו מנגנון שבו הזזת מבחן נקלטת מהודעה (lib/event-match.js, lib/exam-ask.js loadExamChanges): שורת sources עם עובדות
//   match = 'exam:<תאריך מקורי>:<מקצוע>', type = 'move', new_date. מקור אחד לכל מבחן (loadExamChanges מצמיד את העובדות לפי המקור).
//   אירועי הלמידה שבטווח מבוטלים (status='cancelled', כמו "לא לומד היום"), והמפתחות חוזרים לכתיבה ליומן Google. אימונים לא נוגעים.
// "לא": לא משתנה כלום. כרטיס שהאירוע שלו הוזז או בוטל אחרי שנוצר: "כן" לא כותב כלום (נאמר בבועה).
// כרטיס פתוח אחד לכל אירוע (מפתח key = אירוע וטווח). תיקון תאריכים יוצר כרטיס חדש וסוגר את הישן (גם חזרה לטווח קודם: כרטיס שנסגר בלי תשובה לא חוסם).
// כרטיס שיובל ענה עליו לא נוצר שוב. הכרטיס פג בסוף האירוע (ends_at), ולכן גם אירוע שכבר התחיל מקבל כרטיס; מוצג רק מה שמהיום והלאה.
// אין מה לפעול עליו (אין מבחן ואין למידה בטווח): אין כרטיס (אימון בלבד הוא מידע ולא החלטה).
import { randomUUID } from 'node:crypto';
import { allDayDates } from './event-sync.js';
import { EXAMS, applyExamChanges } from './exam-line.js';
import { loadExamChanges } from './exam-ask.js';
import { addDays, daysBetween, formatDayMonth, localDateIso } from './intake-dates.js';
import { zonedToUtc } from './schedule-time.js';

const TIME_ZONE = 'Asia/Jerusalem';
const rowsOf = (result) => (Array.isArray(result) ? result : []);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXAM_LINK = /^exam:\d{4}-\d{2}-\d{2}:.+$/;

export const AWAY_ENTITY = 'away_conflict';
export const YES = 'כן';
export const NO = 'לא';
export const AWAY_BUTTONS = Object.freeze([YES, NO]);
export const STUDY_DOMAIN = 'study';
const RUNNING_DOMAIN = 'running';

// הטווח של אירוע אישי של כמה ימים: { id, title, start, last } (last = היום האחרון, כולל), או null. יום אחד או אירוע עם שעות: null.
export function awayRange(row) {
  const days = allDayDates(row);
  if (!days || daysBetween(days.start, days.end) < 2) return null;
  const title = typeof row?.title === 'string' && row.title.trim() !== '' ? row.title.trim() : 'אירוע';
  return { id: typeof row?.id === 'string' ? row.id : null, title, start: days.start, last: addDays(days.end, -1) };
}

// האם שורת אירוע היא אירוע כזה (אישי, מתוכנן, כמה ימים) שמכסה את היום dateIso. טהור (loadBusy ב-lib/free-check.js).
export function awayCovers(row, dateIso) {
  if (row?.domain !== 'personal' || (row.status !== undefined && row.status !== 'planned')) return false;
  const range = awayRange(row);
  return range !== null && range.start <= dateIso && dateIso <= range.last;
}

const dayStart = (dateIso) => zonedToUtc(dateIso, '00:00', TIME_ZONE);

// כותרת האירוע שמכסה את היום, או null. לבריף ולהצעת האזנה. לא זורק: כשל = null (בלי השורה, כמו אין אירוע).
export async function awayOn(sql, dateIso) {
  try {
    const rows = rowsOf(await sql`
      SELECT /* away-on */ id, title, domain, status, starts_at, ends_at FROM events
      WHERE domain = 'personal' AND status = 'planned'
        AND starts_at < ${dayStart(addDays(dateIso, 1)).toISOString()}::timestamptz AND ends_at > ${dayStart(dateIso).toISOString()}::timestamptz
      ORDER BY starts_at ASC, id ASC
    `);
    const found = rows.find((row) => awayCovers(row, dateIso));
    return found ? awayRange(found).title : null;
  } catch (error) {
    console.error('away: בדיקת יום מחוץ לבית נכשלה:', error?.name);
    return null;
  }
}

// ---------------------------------------------------------------------------
// התכנון והנוסח (פונקציות טהורות)
// ---------------------------------------------------------------------------

// מועד ב' הקרוב אחרי היום after (YYYY-MM-DD), מתוך שורות makeup=true, או null.
export function nearestMakeup(after, exams = EXAMS) {
  const dates = (Array.isArray(exams) ? exams : []).filter((e) => e?.makeup === true && ISO_DAY.test(e.date ?? '') && e.date > after).map((e) => e.date).sort();
  return dates[0] ?? null;
}

const label = (exam) => `${exam.type ?? 'מבחן'} ב${exam.subject}`;
const hoursText = (n) => (n === 1 ? 'שעה אחת' : n === 2 ? 'שעתיים' : `${n} שעות`);
const rangeText = (range) => `${formatDayMonth(range.start)}–${formatDayMonth(range.last)}`;

// range: מ-awayRange. board: הלוח אחרי שינויים (applyExamChanges). examsRaw: הלוח כמו שהוא (שורות מועד ב'). inside: אירועי למידה ואימון בטווח ({ title, domain, starts_at, ends_at, match_key }).
// מחזיר { exams: [{ link, label, from, to (מועד ב' או null) }], study: { count, minutes }, trainings: [{ title, date }] }.
// today (אופציונלי): רק מבחנים אחרי היום (כמו examsToPlan ב-lib/study-plan.js), כדי שמבחן שכבר היה לא יוצג.
export function planAway({ range, board = EXAMS, examsRaw = EXAMS, inside = [], today = null }) {
  const exams = (Array.isArray(board) ? board : [])
    .filter((e) => e && e.makeup !== true && e.postponed !== true && typeof e.subject === 'string' && e.subject !== '' && ISO_DAY.test(e.date ?? '') && e.date >= range.start && e.date <= range.last && (!today || e.date > today))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((e) => ({ link: `exam:${e.answerDate ?? e.date}:${e.subject}`, label: label(e), from: e.date, to: nearestMakeup(range.last, examsRaw) }));
  const study = inside.filter((row) => row.domain === STUDY_DOMAIN);
  const minutes = study.reduce((sum, row) => sum + Math.max(0, Math.round((Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60000)), 0);
  const trainings = inside.filter((row) => row.domain === RUNNING_DOMAIN).map((row) => ({ title: String(row.title ?? 'אימון').trim(), date: localDateIso(new Date(row.starts_at), TIME_ZONE) }));
  return { exams, study: { count: study.length, minutes }, trainings };
}

export const actionable = (plan) => plan.exams.length > 0 || plan.study.count > 0;

export function awayText(range, plan) {
  const parts = [
    ...plan.exams.map((e) => (e.to ? `${e.label} ${formatDayMonth(e.from)} → מועד ב' ${formatDayMonth(e.to)}` : `${e.label} ${formatDayMonth(e.from)} (אין מועד ב' ידוע, לא זז)`)),
    ...(plan.study.count > 0 ? [`${hoursText(Math.max(1, Math.round(plan.study.minutes / 60)))} למידה יבוטלו`] : []),
    ...plan.trainings.map((t) => `${t.title} ${formatDayMonth(t.date)} (לא זז)`),
  ];
  return `בזמן ${range.title} (${rangeText(range)}): ${parts.join(' · ')}\nלעדכן?`;
}

export const awayKey = (range) => `away:${range.id}:${range.start}:${range.last}`;

const cardFacts = ({ range, plan, row }) => [
  { field: 'key', value: awayKey(range) },
  { field: 'event', value: range.id },
  { field: 'title', value: range.title },
  { field: 'start', value: range.start },
  { field: 'last', value: range.last },
  { field: 'event_starts', value: new Date(row.starts_at).toISOString() },
  { field: 'event_ends', value: new Date(row.ends_at).toISOString() },
  { field: 'exams', value: JSON.stringify(plan.exams) },
  { field: 'study_count', value: String(plan.study.count) },
];

// ---------------------------------------------------------------------------
// יצירה: אחרי רישום אירוע, אחרי תיקון תאריכים, ובבריף (רשת ביטחון). לא זורק לעולם. { created: [מפתחות] }.
// ---------------------------------------------------------------------------
export async function offerAwayCards({ sql, now = new Date(), exams, examsRaw = EXAMS }) {
  try {
    const rows = rowsOf(await sql`
      SELECT /* away-events */ id, title, domain, status, starts_at, ends_at FROM events
      WHERE domain = 'personal' AND status = 'planned' AND ends_at > ${now.toISOString()}::timestamptz
      ORDER BY starts_at ASC, id ASC
    `);
    const found = rows.map((row) => ({ row, range: awayRange(row) })).filter((x) => x.range && x.range.id && UUID.test(x.range.id));
    if (found.length === 0) return { created: [] };
    const board = exams ?? applyExamChanges(undefined, await loadExamChanges(sql));
    const created = [];
    for (const { row, range } of found) {
      const inside = rowsOf(await sql`
        SELECT /* away-inside */ title, domain, starts_at, ends_at, match_key FROM events
        WHERE domain IN ('study', 'running') AND status = 'planned'
          AND starts_at >= ${dayStart(range.start).toISOString()}::timestamptz AND starts_at < ${dayStart(addDays(range.last, 1)).toISOString()}::timestamptz
          AND ends_at > ${now.toISOString()}::timestamptz
        ORDER BY starts_at ASC, id ASC
      `);
      const plan = planAway({ range, board, examsRaw, inside, today: localDateIso(now, TIME_ZONE) });
      if (!actionable(plan)) continue;
      const cardId = randomUUID();
      const facts = cardFacts({ range, plan, row });
      const [made] = rowsOf(await sql`
        /* away-create */ WITH m AS (
          INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
          SELECT 'out', ${awayText(range, plan)}::text, 'question', now(), true, NULL::uuid, ${new Date(row.ends_at).toISOString()}::timestamptz, ${AWAY_ENTITY}::text, ${cardId}::uuid, 1
          WHERE NOT EXISTS (
            SELECT 1 FROM facts p JOIN messages x ON x.entity_type = ${AWAY_ENTITY}::text AND x.entity_id = p.entity_id AND x.kind = 'question'
            WHERE p.entity_type = ${AWAY_ENTITY}::text AND p.field = 'key' AND p.value = ${awayKey(range)}::text AND (x.awaiting_reply = true OR x.reply_source_id IS NOT NULL)
          )
          RETURNING id
        ), old AS (
          UPDATE messages SET awaiting_reply = false, read_at = now()
          WHERE entity_type = ${AWAY_ENTITY}::text AND kind = 'question' AND awaiting_reply = true
            AND entity_id IN (SELECT f.entity_id FROM facts f WHERE f.entity_type = ${AWAY_ENTITY}::text AND f.field = 'event' AND f.value = ${range.id}::text)
            AND EXISTS (SELECT 1 FROM m)
          RETURNING id
        ), f AS (
          INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin)
          SELECT NULL::uuid, x.field, x.value, 'certain', 'script', ${AWAY_ENTITY}::text, ${cardId}::uuid, 'read'
          FROM jsonb_to_recordset(${JSON.stringify(facts)}::jsonb) AS x(field text, value text)
          WHERE EXISTS (SELECT 1 FROM m)
          RETURNING id
        )
        SELECT (SELECT id FROM m) AS message_id
      `);
      if (made?.message_id) created.push(awayKey(range));
    }
    return { created };
  } catch (error) {
    console.error('away: יצירת הכרטיס נכשלה:', error?.name);
    return { created: [] };
  }
}

// ---------------------------------------------------------------------------
// תשובה (api/chat.js). { status: 'answered' | 'closed' | 'unclear', created, keys, patchKeys }. כשל מסד נזרק (api/chat.js מחזיר 500).
// ---------------------------------------------------------------------------
const CLOSED = Object.freeze({ status: 'closed', created: {}, keys: [], patchKeys: [] });

function parseExams(value) {
  try {
    const list = JSON.parse(value);
    return (Array.isArray(list) ? list : []).filter((e) => EXAM_LINK.test(e?.link ?? '') && typeof e?.label === 'string' && ISO_DAY.test(e?.from ?? '') && (e.to === null || ISO_DAY.test(e?.to ?? '')));
  } catch {
    return [];
  }
}

export async function answerAway({ sql, messageId, answer, now = new Date() }) {
  const nowIso = now.toISOString();
  const [ask] = rowsOf(await sql`
    SELECT /* away-ask */ m.id, m.awaiting_reply, m.sent_at,
      (SELECT jsonb_object_agg(f.field, f.value) FROM facts f WHERE f.entity_type = ${AWAY_ENTITY}::text AND f.entity_id = m.entity_id) AS facts
    FROM messages m
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type = ${AWAY_ENTITY}::text
      AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
  `);
  if (!ask || ask.awaiting_reply !== true) return CLOSED;
  const text = typeof answer === 'string' ? answer.trim() : '';
  if (!AWAY_BUTTONS.includes(text)) return { status: 'unclear', created: {}, keys: [], patchKeys: [] };
  const facts = ask.facts && typeof ask.facts === 'object' ? ask.facts : {};
  const title = typeof facts.title === 'string' ? facts.title : 'האירוע';
  let apply = text === YES;
  let bubble = `בלי שינוי · ${title}`;
  if (apply) {
    // האירוע חייב להיות עדיין מתוכנן באותם תאריכים, אחרת לא כותבים כלום (הוזז, בוטל או תוקן אחרי שהכרטיס נוצר).
    const [event] = UUID.test(facts.event ?? '') ? rowsOf(await sql`
      SELECT /* away-event */ status, starts_at, ends_at FROM events WHERE id = ${facts.event}::uuid
    `) : [];
    const same = event && event.status === 'planned' && Date.parse(event.starts_at) === Date.parse(facts.event_starts) && Date.parse(event.ends_at) === Date.parse(facts.event_ends);
    if (!same || !ISO_DAY.test(facts.start ?? '') || !ISO_DAY.test(facts.last ?? '')) {
      apply = false;
      bubble = `האירוע השתנה בינתיים, לא שיניתי כלום · ${title}`;
    }
  }
  const today = localDateIso(now, TIME_ZONE);
  const moves = apply ? parseExams(facts.exams).filter((e) => e.to !== null && e.from > today).map((e) => ({ ...e, source: randomUUID() })) : [];
  if (apply) {
    const lines = moves.map((e) => `${e.label} ${formatDayMonth(e.from)} → מועד ב' ${formatDayMonth(e.to)}`);
    if (Number(facts.study_count) > 0) lines.push('הלמידה שבטווח בוטלה');
    bubble = lines.length > 0 ? `עודכן בזמן ${title}:\n${lines.join('\n')}` : `בלי שינוי · ${title}`;
  }
  const sourcesJson = JSON.stringify(moves.map((e) => ({ id: e.source, raw: `מועד ב' · ${e.label}` })));
  const factsJson = JSON.stringify(moves.flatMap((e) => [
    { source_id: e.source, field: 'match', value: e.link },
    { source_id: e.source, field: 'type', value: 'move' },
    { source_id: e.source, field: 'new_date', value: e.to },
  ]));
  const studyFrom = apply ? dayStart(facts.start).toISOString() : null;
  const studyTo = apply ? dayStart(addDays(facts.last, 1)).toISOString() : null;
  const [row] = rowsOf(await sql`
    /* away-write */ WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = ${AWAY_ENTITY}::text
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING id, reply_source_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${text}::text, NULL::text, now(), now() FROM closed
      RETURNING id
    ), other AS (
      UPDATE messages SET awaiting_reply = false, read_at = now()
      WHERE entity_type = ${AWAY_ENTITY}::text AND kind = 'question' AND awaiting_reply = true AND id <> ${messageId}::uuid
        AND entity_id IN (SELECT f.entity_id FROM facts f WHERE f.entity_type = ${AWAY_ENTITY}::text AND f.field = 'event' AND f.value = ${typeof facts.event === 'string' ? facts.event : null}::text)
        AND EXISTS (SELECT 1 FROM closed)
      RETURNING id
    ), mv AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT x.id::uuid, 'system', 'away-card', x.raw, NULL::text, now(), now()
      FROM closed, jsonb_to_recordset(${sourcesJson}::jsonb) AS x(id text, raw text)
      WHERE ${apply}::boolean
      RETURNING id
    ), mf AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin)
      SELECT x.source_id::uuid, x.field, x.value, 'certain', 'script', NULL::text, NULL::uuid, 'read'
      FROM jsonb_to_recordset(${factsJson}::jsonb) AS x(source_id text, field text, value text)
      WHERE EXISTS (SELECT 1 FROM mv)
        AND NOT EXISTS (
          SELECT 1 FROM facts p JOIN sources ps ON ps.id = p.source_id
          WHERE p.field = 'match' AND x.field = 'match' AND p.value = x.value AND ps.received_at > ${ask.sent_at}::timestamptz AND ps.id <> x.source_id::uuid
        )
      RETURNING id
    ), st AS (
      UPDATE events SET status = 'cancelled'
      WHERE ${apply}::boolean AND domain = ${STUDY_DOMAIN}::text AND status = 'planned' AND match_key LIKE 'source:study:%'
        AND starts_at >= ${studyFrom}::timestamptz AND starts_at < ${studyTo}::timestamptz AND ends_at > ${nowIso}::timestamptz
        AND EXISTS (SELECT 1 FROM closed)
      RETURNING match_key
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${bubble}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', closed.reply_source_id, NULL::integer
      FROM closed
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id, (SELECT id FROM b) AS bubble_id,
      (SELECT coalesce(jsonb_agg(match_key), '[]'::jsonb) FROM st) AS keys
  `);
  if (!row || Number(row.closed) === 0) return CLOSED;
  const keys = Array.isArray(row.keys) ? row.keys.filter((k) => typeof k === 'string') : [];
  return { status: 'answered', created: { answerSourceId: row.answer_source_id ?? null, bubbleId: row.bubble_id ?? null }, keys, patchKeys: [] };
}
