// רשימת האזנה (בלוק 9; docs/01-foundation/אפיון-מורחב.md פרק 13; 02-build-plan.md, בדיקת ביניים 3.10 סעיף 11; 03-boundaries-rules.md 2ב/2ג).
// הכרעת יובל (01-system-overview.md, ש8 = ב' + א', 23.11.2026): שורה בבריף של 07:30 עם מה לשמוע היום, ובימי אימון גם הצעה ב-17:00 עם תחילת ההתארגנות.
// "ההצעה בצ'אט בלבד, אירוע ביומן רק אחרי 'כן'" (בדיקת ביניים 3.10): כאן אין אירוע ביומן בכלל, רק הודעה. האזנה לא נספרת בתקרת שלוש השעות.
//
// איך פריט נכנס לרשימה לא הוגדר. נבנתה הדרך הפשוטה והבטוחה ביותר (הנחה, לא אומת; קל להרחיב): יובל מקליד בצ'אט
//   "להאזנה: <שם>"  או  "תוסיף לרשימת האזנה <שם>"
// והקוד (לפני המוח, בלי מכסה) שומר שורה ב-tasks עם domain='listening' ו-status='listen'. בלי טבלה חדשה ובלי שינוי סכמה.
// status='listen' (ולא 'open') כדי שהפריט לא ייכנס לרשימת המשימות הפתוחות, לבריף, לסגירה ולמספר על האייקון (כולם מסננים status='open').
// בחירת הפריט ליום: סבב לפי סדר ההוספה (מספר הימים מאז 1.1.1970 מודולו מספר הפריטים). דטרמיניסטי: הבריף וההצעה של 17:00 מציעים את אותו פריט.
// לא נבנה: "שמעתי" / הסרה מהרשימה, "סירוב → הצעה אחרת" ולמידה מהתשובות. רשום כשאלה בפתק 105.
// פרטיות: שם הפודקאסט או הקורס נשמר רק ב-tasks ומוצג באפליקציה. לא בלוג.
import { createHash } from 'node:crypto';
import { zonedToUtc } from './schedule-time.js';
import { awayOn } from './away.js';

export const LISTEN_DOMAIN = 'listening';
export const LISTEN_STATUS = 'listen';
export const LISTEN_SUGGEST_ENTITY = 'listen_suggest';
export const MAX_TITLE = 120;
const TIME_ZONE = 'Asia/Jerusalem';
const rowsOf = (result) => (Array.isArray(result) ? result : []);

const ADD_PATTERNS = [
  /^\s*להאזנה\s*[:：\-–]\s*(.+?)\s*$/s,
  /^\s*(?:תוסיף|תוסיפי|הוסף|להוסיף|תכניס)\s+(?:את\s+)?(?:ל|אל\s+)?רשימת\s+(?:ה)?האזנה\s*[:：\-–]?\s*(.+?)\s*$/s,
];

// השם מתוך ההודעה, או null.
export function detectListenAdd(text) {
  if (typeof text !== 'string') return null;
  for (const pattern of ADD_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const title = match[1].replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
      return title === '' ? null : title;
    }
  }
  return null;
}

// הוספה מהצ'אט (lib/intake-process.js, הודעה מוקלדת). פקודה אחת: סימון המקור כמטופל, שורת tasks, ובועה. כפילות (אותו שם ברשימה) = לא נוסף שוב.
// { status: 'recorded' | 'skipped', reply }. כשל מסד נזרק (הצינור מטפל).
export async function addListening({ sql, source, title }) {
  const [row] = rowsOf(await sql`
    /* listen-add */ WITH claim AS (
      UPDATE sources SET processed_at = now() WHERE id = ${source.id}::uuid AND processed_at IS NULL RETURNING id
    ), t AS (
      INSERT INTO tasks (title, domain, status)
      SELECT ${title}::text, ${LISTEN_DOMAIN}::text, ${LISTEN_STATUS}::text FROM claim
      WHERE NOT EXISTS (SELECT 1 FROM tasks x WHERE x.domain = ${LISTEN_DOMAIN}::text AND x.status = ${LISTEN_STATUS}::text AND lower(x.title) = lower(${title}::text))
      RETURNING id
    )
    SELECT (SELECT count(*) FROM claim)::int AS claimed, (SELECT count(*) FROM t)::int AS added,
      (SELECT count(*) FROM tasks x WHERE x.domain = ${LISTEN_DOMAIN}::text AND x.status = ${LISTEN_STATUS}::text)::int AS before
  `);
  if (!row || Number(row.claimed) === 0) return { status: 'skipped', reply: 'התקבל' };
  const added = Number(row.added) > 0;
  const count = Number(row.before) + (added ? 1 : 0);
  const reply = added ? `נוסף לרשימת ההאזנה · ${title} (${count} ברשימה)` : `כבר ברשימת ההאזנה · ${title}`;
  await sql`
    /* listen-add-bubble */ INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
    SELECT 'out', ${reply}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', ${source.id}::uuid, NULL::integer
    WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source' AND x.entity_id = ${source.id}::uuid)
  `;
  return { status: 'recorded', reply };
}

// הרשימה, לפי סדר ההוספה. לא זורק: כשל = [] (הבריף בלי השורה).
export async function loadListening(sql) {
  try {
    return rowsOf(await sql`
      SELECT /* listen-load */ id, title FROM tasks
      WHERE domain = ${LISTEN_DOMAIN}::text AND status = ${LISTEN_STATUS}::text
      ORDER BY created_at ASC NULLS LAST, id ASC
    `).filter((row) => typeof row?.title === 'string' && row.title.trim() !== '');
  } catch (error) {
    console.error('listening: טעינת הרשימה נכשלה:', error?.name);
    return [];
  }
}

export function pickForDay(items, dateIso) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return null;
  const day = Math.floor(Date.parse(`${dateIso}T00:00:00Z`) / 86400000);
  return list[((day % list.length) + list.length) % list.length];
}

export const briefLine = (item) => (item ? `להאזנה היום: ${item.title.trim()}` : null);
export const suggestText = (item) => `יוצא לאימון? להאזנה בדרך: ${item.title.trim()}`;

// יום אימון: אירוע running מתוכנן היום שמתחיל בין 17:00 ל-20:00 (אימוני 4fitness בשני וברביעי וריצת שלישי; לא ריצת שישי ב-05:30, כמו "לא שישי" ב-3.10).
// הנחה, לא אומת: הטווח. [מקור] אורך האימון והתחלתו: 03-4fitness-rules.md.
export async function isTrainingEvening(sql, dateIso) {
  const from = zonedToUtc(dateIso, '17:00', TIME_ZONE).toISOString();
  const to = zonedToUtc(dateIso, '20:00', TIME_ZONE).toISOString();
  const rows = rowsOf(await sql`
    SELECT /* listen-training */ 1 AS found FROM events
    WHERE domain = 'running' AND status = 'planned' AND starts_at >= ${from}::timestamptz AND starts_at < ${to}::timestamptz
    LIMIT 1
  `);
  return rows.length > 0;
}

const suggestEntityId = (dateIso) => {
  const hex = createHash('sha256').update(`listen-${dateIso}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

// ההצעה של 17:00 (api/queues/deliver.js, משבצת listen-<תאריך>). רק ביום אימון ורק כשיש רשימה. כרטיס אחד ליום (entity_id דטרמיניסטי, NOT EXISTS)
// עם הכפתורים "שמעתי" / "אחר כך" (הכרעת יובל 24.11.2026: "כפתור שאני לוחץ עליו"; "שמעתי" מוציא את הפריט מהרשימה). הכרטיס פג בסוף היום.
// הפריט נשמר בעובדה 'task' של הכרטיס. { created: boolean, reason }. כשל מסד נזרק (התור ינסה שוב).
export const HEARD = 'שמעתי';
export const LATER = 'אחר כך';
export const LISTEN_BUTTONS = Object.freeze([HEARD, LATER]);
export const HEARD_STATUS = 'heard'; // לא 'done': "בוצע היום" בסגירה סופר done, והאזנה אינה משימה
export async function createListenSuggestion({ sql, dateIso }) {
  if (await awayOn(sql, dateIso)) return { created: false, reason: 'away' }; // יום בתוך חופשה או טיול (lib/away.js): בלי הצעה
  if (!(await isTrainingEvening(sql, dateIso))) return { created: false, reason: 'not-training' };
  const item = pickForDay(await loadListening(sql), dateIso);
  if (!item) return { created: false, reason: 'empty' };
  const cardId = suggestEntityId(dateIso);
  const expiresAt = zonedToUtc(dateIso, '23:59', TIME_ZONE).toISOString();
  const rows = rowsOf(await sql`
    /* listen-suggest */ WITH m AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${suggestText(item)}::text, 'question', now(), true, NULL::uuid, ${expiresAt}::timestamptz, ${LISTEN_SUGGEST_ENTITY}::text, ${cardId}::uuid, 1
      WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.entity_type = ${LISTEN_SUGGEST_ENTITY}::text AND x.entity_id = ${cardId}::uuid)
      RETURNING id
    ), f AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin)
      SELECT NULL::uuid, 'task', ${String(item.id)}::text, 'certain', 'script', ${LISTEN_SUGGEST_ENTITY}::text, ${cardId}::uuid, 'read'
      WHERE EXISTS (SELECT 1 FROM m)
      RETURNING id
    )
    SELECT id FROM m
  `);
  return { created: rows.length > 0, reason: rows.length > 0 ? 'created' : 'exists' };
}

// תשובה לכרטיס (api/chat.js). "שמעתי": הפריט יוצא מהרשימה (status='heard') ובועה. "אחר כך": נסגר בלי שינוי.
// { status: 'answered' | 'closed' | 'unclear', created, keys: [], patchKeys: [] }. פקודה אחת מותנית בסגירת הכרטיס. כשל מסד נזרק.
export async function answerListen({ sql, messageId, answer, now = new Date() }) {
  const nowIso = now.toISOString();
  const closed = { status: 'closed', created: {}, keys: [], patchKeys: [] };
  const [ask] = rowsOf(await sql`
    SELECT /* listen-ask */ m.id, m.awaiting_reply,
      (SELECT f.value FROM facts f WHERE f.entity_type = ${LISTEN_SUGGEST_ENTITY}::text AND f.entity_id = m.entity_id AND f.field = 'task' LIMIT 1) AS task_id
    FROM messages m
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type = ${LISTEN_SUGGEST_ENTITY}::text
      AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
  `);
  if (!ask || ask.awaiting_reply !== true) return closed;
  const text = typeof answer === 'string' ? answer.trim() : '';
  if (!LISTEN_BUTTONS.includes(text)) return { status: 'unclear', created: {}, keys: [], patchKeys: [] };
  const heard = text === HEARD;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const taskId = typeof ask.task_id === 'string' && UUID.test(ask.task_id) ? ask.task_id : null;
  const [row] = rowsOf(await sql`
    /* listen-answer */ WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = ${LISTEN_SUGGEST_ENTITY}::text
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING id, reply_source_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${text}::text, NULL::text, now(), now() FROM closed
      RETURNING id
    ), t AS (
      UPDATE tasks SET status = ${HEARD_STATUS}::text
      WHERE ${heard}::boolean AND id = ${taskId}::uuid AND domain = ${LISTEN_DOMAIN}::text AND status = ${LISTEN_STATUS}::text AND EXISTS (SELECT 1 FROM closed)
      RETURNING title
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', 'יצא מרשימת ההאזנה · ' || t.title, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', closed.reply_source_id, NULL::integer
      FROM t, closed
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id, (SELECT id FROM b) AS bubble_id
  `);
  if (!row || Number(row.closed) === 0) return closed;
  return { status: 'answered', created: { answerSourceId: row.answer_source_id ?? null, bubbleId: row.bubble_id ?? null }, keys: [], patchKeys: [] };
}
