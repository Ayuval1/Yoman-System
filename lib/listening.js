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

// ההצעה של 17:00 (api/queues/deliver.js, משבצת listen-<תאריך>). רק ביום אימון ורק כשיש רשימה. הודעה אחת ליום (entity_id דטרמיניסטי, NOT EXISTS).
// { created: boolean, reason }. כשל מסד נזרק (התור ינסה שוב).
export async function createListenSuggestion({ sql, dateIso }) {
  if (!(await isTrainingEvening(sql, dateIso))) return { created: false, reason: 'not-training' };
  const item = pickForDay(await loadListening(sql), dateIso);
  if (!item) return { created: false, reason: 'empty' };
  const rows = rowsOf(await sql`
    /* listen-suggest */ INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
    SELECT 'out', ${suggestText(item)}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, ${LISTEN_SUGGEST_ENTITY}::text, ${suggestEntityId(dateIso)}::uuid, NULL::integer
    WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.entity_type = ${LISTEN_SUGGEST_ENTITY}::text AND x.entity_id = ${suggestEntityId(dateIso)}::uuid)
    RETURNING id
  `);
  return { created: rows.length > 0, reason: rows.length > 0 ? 'created' : 'exists' };
}

