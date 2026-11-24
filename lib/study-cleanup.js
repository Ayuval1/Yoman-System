// שעות למידה של מבחן שזז או בוטל (05-open-questions.md, עדכון 24.11: "מבחן שהוזז או בוטל אחרי שאישרת תוכנית למידה משאיר את שעות הלמידה הישנות ביומן.
// אין להן ניקוי אוטומטי"). כאן: כרטיס אחד לכל מבחן ישן, בבריף של 07:30: "לבטל אותן?" (כן / לא). בלי ביטול אוטומטי, ובלי תכנון מחדש
// (תכנון מחדש למועד החדש קורה ממילא: offerStudyPlans מציע לכל מבחן שנכנס לטווח ההכנה, לפי המפתח שלו עם התאריך החדש).
//
// "יתום" = אירוע study מתוכנן בעתיד עם match_key 'source:study:<תאריך מבחן>:<מקצוע>:...' (lib/study-plan.js studyKey), שהמבחן שלו
// (<תאריך>:<מקצוע>) כבר לא בלוח אחרי שינויים (applyExamChanges): הוזז (התאריך השתנה), בוטל, או נדחה בלי מועד (postponed).
// "כן": UPDATE status = 'cancelled' לאירועים האלה (כמו "לא לומד היום" ו"בזמן החופשה"), והמפתחות חוזרים למחיקה מיומן "לימוד".
// "לא": השעות נשארות. הכרטיס לא חוזר על אותו מבחן (מפתח בעובדות, גם אחרי תשובה).
import { randomUUID } from 'node:crypto';
import { EXAMS, applyExamChanges } from './exam-line.js';
import { loadExamChanges } from './exam-ask.js';
import { formatDayMonth } from './intake-dates.js';
import { STUDY_DOMAIN } from './study-plan.js';

export const STUDY_ORPHAN_ENTITY = 'study_orphan';
export const YES = 'כן';
export const NO = 'לא';
export const STUDY_ORPHAN_BUTTONS = Object.freeze([YES, NO]);
const rowsOf = (result) => (Array.isArray(result) ? result : []);
const STUDY_KEY = /^source:study:(\d{4}-\d{2}-\d{2}):([^:]+):/;
const hoursText = (n) => (n === 1 ? 'שעה אחת' : n === 2 ? 'שעתיים' : `${n} שעות`);

// הקבוצות היתומות מתוך שורות אירועים ולוח מבחנים. טהור. [{ exam: '<תאריך>:<מקצוע>', date, subject, count, minutes, lastEnd }]
export function orphanGroups(rows, board) {
  const valid = new Set((Array.isArray(board) ? board : []).filter((e) => e && e.makeup !== true && e.postponed !== true && typeof e.subject === 'string').map((e) => `${e.date}:${e.subject}`));
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const m = STUDY_KEY.exec(String(row?.match_key ?? ''));
    if (!m) continue;
    const exam = `${m[1]}:${m[2]}`;
    if (valid.has(exam)) continue;
    const group = groups.get(exam) ?? { exam, date: m[1], subject: m[2], count: 0, minutes: 0, lastEnd: null };
    group.count += 1;
    group.minutes += Math.max(0, Math.round((Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60000));
    const end = new Date(row.ends_at).toISOString();
    if (!group.lastEnd || end > group.lastEnd) group.lastEnd = end;
    groups.set(exam, group);
  }
  return [...groups.values()].sort((a, b) => (a.exam < b.exam ? -1 : 1));
}

export function orphanText(group) {
  const hours = hoursText(Math.max(1, Math.round(group.minutes / 60)));
  return `המבחן ב${group.subject} מ-${formatDayMonth(group.date)} זז או בוטל, ו${hours} למידה שתוכננו לו עדיין ביומן "לימוד".\nלבטל אותן?`;
}

const orphanKey = (group) => `study-orphan:${group.exam}`;

// יצירה (הבריף של 07:30). לא זורק. { created: [מפתחות] }.
export async function offerStudyCleanup({ sql, now = new Date(), exams }) {
  try {
    const rows = rowsOf(await sql`
      SELECT /* study-orphan-events */ match_key, starts_at, ends_at FROM events
      WHERE domain = ${STUDY_DOMAIN}::text AND status = 'planned' AND match_key LIKE 'source:study:%' AND ends_at > ${now.toISOString()}::timestamptz
      ORDER BY starts_at ASC, id ASC
    `);
    if (rows.length === 0) return { created: [] };
    // הלוח נטען כאן בטעינה קפדנית: כשל בשינויים = אין כרטיס היום (לוח בלי ההזזות היה מסמן כל מבחן שהוזז כ"יתום"). exams: לבדיקות בלבד.
    const board = exams ?? applyExamChanges(EXAMS, await loadExamChanges(sql, { strict: true }));
    const created = [];
    for (const group of orphanGroups(rows, board)) {
      const cardId = randomUUID();
      const facts = [
        { field: 'key', value: orphanKey(group) },
        { field: 'exam', value: group.exam },
        { field: 'subject', value: group.subject },
      ];
      const [made] = rowsOf(await sql`
        /* study-orphan-create */ WITH m AS (
          INSERT INTO messages (id, direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
          SELECT md5(${orphanKey(group)}::text)::uuid, 'out', ${orphanText(group)}::text, 'question', now(), true, NULL::uuid, ${group.lastEnd}::timestamptz, ${STUDY_ORPHAN_ENTITY}::text, ${cardId}::uuid, 1
          WHERE NOT EXISTS (SELECT 1 FROM facts p WHERE p.entity_type = ${STUDY_ORPHAN_ENTITY}::text AND p.field = 'key' AND p.value = ${orphanKey(group)}::text)
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        ), f AS (
          INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin)
          SELECT NULL::uuid, x.field, x.value, 'certain', 'script', ${STUDY_ORPHAN_ENTITY}::text, ${cardId}::uuid, 'read'
          FROM jsonb_to_recordset(${JSON.stringify(facts)}::jsonb) AS x(field text, value text)
          WHERE EXISTS (SELECT 1 FROM m)
          RETURNING id
        )
        SELECT (SELECT id FROM m) AS message_id
      `);
      if (made?.message_id) created.push(orphanKey(group));
    }
    return { created };
  } catch (error) {
    console.error('study-cleanup: יצירת הכרטיס נכשלה:', error?.name);
    return { created: [] };
  }
}

// תשובה (api/chat.js). { status: 'answered' | 'closed' | 'unclear', created, keys, patchKeys }. כשל מסד נזרק (api/chat.js מחזיר 500).
const CLOSED = Object.freeze({ status: 'closed', created: {}, keys: [], patchKeys: [] });
const EXAM_FACT = /^\d{4}-\d{2}-\d{2}:[^:%_]+$/;

export async function answerStudyCleanup({ sql, messageId, answer, now = new Date() }) {
  const nowIso = now.toISOString();
  const [ask] = rowsOf(await sql`
    SELECT /* study-orphan-ask */ m.id, m.awaiting_reply,
      (SELECT jsonb_object_agg(f.field, f.value) FROM facts f WHERE f.entity_type = ${STUDY_ORPHAN_ENTITY}::text AND f.entity_id = m.entity_id) AS facts
    FROM messages m
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type = ${STUDY_ORPHAN_ENTITY}::text
      AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
  `);
  if (!ask || ask.awaiting_reply !== true) return CLOSED;
  const text = typeof answer === 'string' ? answer.trim() : '';
  if (!STUDY_ORPHAN_BUTTONS.includes(text)) return { status: 'unclear', created: {}, keys: [], patchKeys: [] };
  const facts = ask.facts && typeof ask.facts === 'object' ? ask.facts : {};
  const exam = typeof facts.exam === 'string' && EXAM_FACT.test(facts.exam) ? facts.exam : null;
  const subject = typeof facts.subject === 'string' ? facts.subject : '';
  const apply = text === YES && exam !== null;
  const prefix = apply ? `source:study:${exam}:%` : null;
  const [row] = rowsOf(await sql`
    /* study-orphan-write */ WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = ${STUDY_ORPHAN_ENTITY}::text
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING id, reply_source_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${text}::text, NULL::text, now(), now() FROM closed
      RETURNING id
    ), st AS (
      UPDATE events SET status = 'cancelled'
      WHERE ${apply}::boolean AND domain = ${STUDY_DOMAIN}::text AND status = 'planned' AND match_key LIKE ${prefix}::text
        AND ends_at > ${nowIso}::timestamptz AND EXISTS (SELECT 1 FROM closed)
      RETURNING match_key
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', CASE WHEN ${apply}::boolean THEN 'שעות הלמידה בוטלו (' || (SELECT count(*) FROM st)::text || ') · ' || ${subject}::text ELSE 'שעות הלמידה נשארות ביומן · ' || ${subject}::text END,
        'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', closed.reply_source_id, NULL::integer
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
