// תתי-משימות (הכרעת יובל 22.11.2026): משימה שהיא חלק ממשימה אחרת. "להכין מצגת בהיסטוריה עד שלישי" (א), ואחר כך "להכין שקופיות" (ב): ב היא תת-משימה של א.
// רמה אחת בלבד: הורה אינו תת-משימה בעצמו, ולתת-משימה אין תתי-משימות. תת-משימה היא משימה רגילה לכל דבר ("בוצע?", המספר על האייקון, "פתוחות").
//
// שלוש דרכים לקשר:
//  1. המוח מציע ושואלים (המסלול הראשי): בקליטת הודעה מוקלדת המוח מקבל את המשימות הפתוחות שיכולות להיות הורה (מפתחות t1, t2...) ומחזיר parent (מפתח או null).
//     הקוד בודק שהמפתח ברשימה (lib/intake-brain.js isValidUnderstanding), ואחרי שהמשימה נרשמה נפתח כרטיס "זה חלק מ'<הורה>'?" (entity_type 'subtask_link').
//     "כן, תת-משימה" = קישור; "לא, נפרד" = כלום.
//  2. מפורש בצ'אט ("להכין שקופיות למצגת בהיסטוריה", "תת-משימה של המצגת: ..."): המוח מעתיק מילה במילה את שם המשימה האחרת (parent_text),
//     והקוד מתאים אותו למשימות הפתוחות לפי שורש מקורב (titleOverlap מ-lib/event-match.js; CLAUDE.md: התאמה לפי שורש, לא לפי מחרוזת).
//     התאמה ודאית אחת = קישור מיד ובועת "נרשם · תת-משימה של '<הורה>'". עמום = אותו כרטיס, עם כפתור לכל מועמד ו"לא, נפרד".
//  3. כפתור ידני (API בלבד, המסך בהמשך): פעולות subtask_link ו-subtask_unlink ב-api/chat.js.
// בלי מוח (מכסה, תקלה, בלי מפתח): אין הצעה. לא מנחשים בקוד: "שקופיות" ו"מצגת" לא חולקות שורש. ההכרעה נרשמת ב-probe_log 'subtask-suggest' (קודים בלבד).
//
// העמודה tasks.parent_task_id נוספת במסד החי בפקודה שיובל מריץ ב-Neon. עד אז כל שאילתה שנוגעת בה נכשלת בקוד 42703 (undefined_column),
// והקוד הזה לא נשבר: התכונה כבויה (מאגר ריק, פעולה ידנית 'disabled', רשימת הפתוחות בשאילתה הישנה), והודעה אחת בלוג לכל הרצה.
// [הנחה, לא אומת] שגיאת הדרייבר של Neon נושאת את קוד ה-SQLSTATE בשדה code (NeonDbError). לא נבדק מול מסד אמיתי.
//
// פרטיות: כותרות המשימות מוצגות רק באפליקציה (גוף השאלה והבועה) ונשלחות למוח כמו טקסט ההודעה עצמה. בלוג ובמדידה: קודים בלבד.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי (אין מסד בסשן הבנייה). הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה.
import { titleOverlap } from './event-match.js';

const rowsOf = (result) => (Array.isArray(result) ? result : []);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SUBTASK_ENTITY = 'subtask_link';
export const PENDING_FIELD = 'subtask_pending';
export const SUBTASK_YES = 'כן, תת-משימה';
export const SUBTASK_NO = 'לא, נפרד';
export const SUBTASK_PROBE = 'subtask-suggest';
// [הנחה, לא אומת] הכרעות טכניות של הבנייה: כמה משימות נשלחות למוח, כמה מועמדים בכרטיס, ומתי הכרטיס פג (כמו RELEVANCE_DAYS ב-lib/personal-task.js).
export const PARENT_POOL_LIMIT = 20;
export const MAX_OPTIONS = 3;
export const ASK_DAYS = 3;
const FALLBACK_TITLE = 'משימה';
const DAY_MS = 24 * 60 * 60 * 1000;

const titleOf = (title) => (typeof title === 'string' && title.trim() !== '' ? title.trim() : FALLBACK_TITLE);

// ---------------------------------------------------------------------------
// עמודה חסרה (לפני שיובל הריץ את הפקודה ב-Neon)
// ---------------------------------------------------------------------------

export const MISSING_COLUMN_CODE = '42703';
export const isMissingColumn = (error) => error?.code === MISSING_COLUMN_CODE;
let missingNoted = false;
// הודעה אחת לכל הרצה, בלי פרטים מהמסד.
export function noteMissingColumn() {
  if (missingNoted) return;
  missingNoted = true;
  console.error('subtask: העמודה tasks.parent_task_id חסרה במסד; תתי-משימות כבויות עד שהפקודה תורץ');
}
// לבדיקות בלבד: מאפס את "כבר נרשם בלוג".
export function resetMissingColumnNote() {
  missingNoted = false;
}

// ---------------------------------------------------------------------------
// נוסחים (פונקציות טהורות)
// ---------------------------------------------------------------------------

// [הנחה, לא אומת] נוסחי השאלה, הכפתורים והבועות: בחירה של Claude בבנייה, לפי ההחלטה של יובל ("זה חלק מ'<הורה>'?", "כן, תת-משימה" / "לא, נפרד").
export function questionFor(options) {
  if (options.length === 1) return { text: `זה חלק מ'${titleOf(options[0].title)}'?`, buttons: [SUBTASK_YES, SUBTASK_NO] };
  return { text: 'זה חלק מאחת מאלה?', buttons: [...options.map((option) => titleOf(option.title)), SUBTASK_NO] };
}
export const linkedReply = (parentTitle) => `נרשם · תת-משימה של '${titleOf(parentTitle)}'`;
export const notLinkedReply = (childTitle) => `לא קושר · '${titleOf(childTitle)}' נשארת נפרדת`;
// סיומת לבועת "בוצע" של הורה שנשארו לו תתי-משימות פתוחות.
export const openSubtasksSuffix = (count) => (count === 1 ? 'נשארה תת-משימה פתוחה אחת' : `נשארו ${count} תת-משימות פתוחות`);

// הרשימה למוח: t1, t2... לפי סדר המאגר.
export const brainTaskCandidates = (pool) => pool.map((candidate, index) => ({ key: `t${index + 1}`, label: titleOf(candidate.title) }));

// ---------------------------------------------------------------------------
// ההכרעה (פונקציה טהורה)
// ---------------------------------------------------------------------------

// pool: [{ id, title }] בסדר שנשלח למוח. taskId: המשימה החדשה (לא מועמדת לעצמה). parentKey: המפתח שהמוח בחר (או null). parentText: שם המשימה האחרת
// כפי שהמוח העתיק מההודעה (או null). מחזיר { kind: 'link', candidate, by, considered } · { kind: 'ask', options, by, considered } · { kind: 'none', considered, by }.
// ספים [הנחה, לא אומת; הספים של decideMatch ב-lib/event-match.js]: "חזק" = כל מילות התוכן של parent_text נמצאות בכותרת; "אפור" = לפחות חצי מהן.
// קישור ודאי כשיש חזק אחד בדיוק: יובל קרא למשימה בשמה, וכל מילה שכתב נמצאת בה ("מצגת בהיסטוריה" גובר על "מצגת במתמטיקה", שהיא רק אפורה).
// כמה חזקות, או רק אפורות: כרטיס. התאמה מפורשת גוברת על ההצעה של המוח; אין התאמה מפורשת = ההצעה של המוח נשאלת.
export function decideParent({ pool = [], taskId = null, parentKey = null, parentText = null }) {
  const list = (Array.isArray(pool) ? pool : []).filter((candidate) => candidate && UUID.test(String(candidate.id)) && candidate.id !== taskId);
  const none = (by) => ({ kind: 'none', considered: list.length, by });
  if (typeof parentText === 'string' && parentText.trim() !== '') {
    const scored = list.map((candidate) => ({ candidate, overlap: titleOverlap(parentText, candidate.title) }));
    const strong = scored.filter(({ overlap }) => overlap.total > 0 && overlap.matched === overlap.total).map((s) => s.candidate);
    const grey = scored.filter(({ overlap }) => overlap.matched > 0 && overlap.matched * 2 >= overlap.total).map((s) => s.candidate);
    if (strong.length === 1) return { kind: 'link', candidate: strong[0], by: 'explicit', considered: list.length };
    if (grey.length > 0) {
      const ordered = [...strong, ...grey.filter((candidate) => !strong.includes(candidate))];
      return { kind: 'ask', options: uniqueTitles(ordered).slice(0, MAX_OPTIONS), by: 'explicit', considered: list.length };
    }
  }
  const index = typeof parentKey === 'string' ? /^t(\d+)$/.exec(parentKey) : null;
  const picked = index ? pool[Number(index[1]) - 1] : undefined;
  if (picked && list.includes(picked)) return { kind: 'ask', options: [picked], by: 'brain', considered: list.length };
  return none(parentKey || parentText ? 'brain' : 'none');
}

// כפתור לכל מועמד הוא הכותרת שלו, ולכן שתי משימות באותה כותרת לא נכנסות יחד (הראשונה נשארת).
function uniqueTitles(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const title = titleOf(candidate.title);
    if (seen.has(title)) return false;
    seen.add(title);
    return true;
  });
}

// ---------------------------------------------------------------------------
// שליפה
// ---------------------------------------------------------------------------

// המשימות שיכולות להיות הורה: פתוחות, ולא תתי-משימות בעצמן (רמה אחת). הקרובות קודם, עד PARENT_POOL_LIMIT. לא זורק: עמודה חסרה או כשל = [].
export async function loadParentPool(sql) {
  try {
    const rows = rowsOf(await sql`
      SELECT t.id, t.title FROM tasks t
      WHERE t.status = 'open' AND t.parent_task_id IS NULL
      ORDER BY t.due_at ASC NULLS LAST, t.created_at ASC NULLS LAST, t.id ASC
      LIMIT ${PARENT_POOL_LIMIT}::int
    `);
    return rows.filter((row) => row && UUID.test(String(row.id))).map((row) => ({ id: String(row.id), title: typeof row.title === 'string' ? row.title : '' }));
  } catch (error) {
    if (isMissingColumn(error)) noteMissingColumn();
    else console.error('subtask: שליפת המשימות הפתוחות נכשלה:', error?.name);
    return [];
  }
}

// כמה תתי-משימות פתוחות יש למשימה. לא זורק: עמודה חסרה או כשל = 0.
export async function countOpenSubtasks(sql, taskId) {
  try {
    const [row] = rowsOf(await sql`SELECT count(*)::int AS open_subtasks FROM tasks WHERE parent_task_id = ${taskId}::uuid AND status = 'open'`);
    const count = Number(row?.open_subtasks);
    return Number.isInteger(count) && count > 0 ? count : 0;
  } catch (error) {
    if (isMissingColumn(error)) noteMissingColumn();
    else console.error('subtask: ספירת תתי-המשימות נכשלה:', error?.name);
    return 0;
  }
}

// מדידה: הכרעה אחת לכל משימה שנרשמה, בלי טקסט ובלי כותרות. לא זורק.
export async function logSuggest(sql, decision, reason = null) {
  try {
    const options = decision.kind === 'ask' ? decision.options.length : decision.kind === 'link' ? 1 : 0;
    const detail = `kind=${decision.kind}; by=${decision.by}; options=${options}; considered=${decision.considered ?? ''}${reason ? `; reason=${reason}` : ''}`;
    await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('subtask-suggest', ${decision.kind !== 'none'}, ${detail})`;
  } catch (error) {
    console.error('subtask: רישום ההכרעה נכשל:', error?.name);
  }
}

// ---------------------------------------------------------------------------
// כתיבה
// ---------------------------------------------------------------------------

// קישור מיד (התאמה מפורשת ודאית): פקודה אחת. הקישור רק אם שתי המשימות פתוחות, שונות, ההורה אינו תת-משימה, ולילד אין תתי-משימות; ובועת "נרשם · תת-משימה של ..."
// (entity_type 'task', כמו הבועה של "עד מתי?"), פעם אחת לכל משימה ונוסח. מחזיר { linked, bubbleId }.
export async function writeLink({ sql, taskId, parent }) {
  const bubble = linkedReply(parent.title);
  const [written] = rowsOf(await sql`
    WITH u AS (
      UPDATE tasks c SET parent_task_id = p.id
      FROM tasks p
      WHERE c.id = ${taskId}::uuid AND p.id = ${parent.id}::uuid AND c.id <> p.id AND c.status = 'open' AND p.status = 'open'
        AND p.parent_task_id IS NULL AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.parent_task_id = c.id)
      RETURNING c.id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${bubble}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'task', u.id, NULL::integer FROM u
      WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'task' AND x.entity_id = u.id AND x.body = ${bubble}::text)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM u)::int AS linked, (SELECT id FROM b) AS bubble_id
  `);
  return { linked: Number(written?.linked ?? 0) > 0, bubbleId: written?.bubble_id ?? null };
}

// הכרטיס: שורת messages (entity_type 'subtask_link', entity_id = המשימה החדשה) + עובדת subtask_pending עם המועמדים (JSON: { options: [{ id, title }] }),
// מקושרת למשימה (facts.entity_type 'task') ולמקור שלה. פעם אחת לכל משימה (NOT EXISTS), ורק כשהמשימה עדיין פתוחה. מחזיר true כשנכתב.
export async function writeSubtaskQuestion({ sql, sourceId, taskId, options, now = new Date() }) {
  const question = questionFor(options);
  const payload = JSON.stringify({ options: options.map((option) => ({ id: option.id, title: titleOf(option.title) })) });
  const expiresAt = new Date(now.getTime() + ASK_DAYS * DAY_MS).toISOString();
  const [written] = rowsOf(await sql`
    WITH q AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${question.text}::text, 'question', now(), true, NULL::uuid, ${expiresAt}::timestamptz, 'subtask_link', t.id, 1
      FROM tasks t
      WHERE t.id = ${taskId}::uuid AND t.status = 'open'
        AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.kind = 'question' AND x.entity_type = 'subtask_link' AND x.entity_id = t.id)
      RETURNING id, entity_id
    ), f AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin, haiku_confidence)
      SELECT ${sourceId}::uuid, 'subtask_pending', ${payload}::text, 'probable', 'script', 'task', q.entity_id, 'inferred', NULL::text FROM q
      RETURNING id
    )
    SELECT (SELECT count(*) FROM q)::int AS questions_written
  `);
  return written === undefined || Number(written.questions_written) > 0;
}

// אחרי שמשימה מוקלדת נרשמה (lib/intake-process.js recordTask). understanding: מה שהמוח הבין (null = נתיב הקוד, בלי מוח). parents: { pool, shown } מהקליטה
// (shown = המוח ראה את הרשימה, ורק אז parent שלו נחשב). מחזיר { kind: 'link', parentId, bubbleId } · { kind: 'ask' } · null.
// לא זורק לעולם: המשימה כבר נרשמה, וכשל כאן לא מבטל אותה (רק שם השגיאה בלוג).
export async function suggestParentAfterRecord({ sql, source, task, understanding = null, parents = null, now = new Date() }) {
  if (!task || typeof task.id !== 'string' || !UUID.test(task.id)) return null;
  try {
    if (!understanding) {
      await logSuggest(sql, { kind: 'none', by: 'code', considered: '' }, 'no-brain');
      return null;
    }
    const shown = Boolean(parents?.shown);
    const pool = shown && Array.isArray(parents.pool) ? parents.pool : [];
    const decision = decideParent({
      pool, taskId: task.id,
      parentKey: shown ? understanding.parent ?? null : null,
      parentText: shown ? understanding.parent_text ?? null : null,
    });
    await logSuggest(sql, decision, shown ? null : 'no-pool');
    if (decision.kind === 'link') {
      const written = await writeLink({ sql, taskId: task.id, parent: decision.candidate });
      return written.linked ? { kind: 'link', parentId: decision.candidate.id, bubbleId: written.bubbleId } : null;
    }
    if (decision.kind === 'ask') {
      const written = await writeSubtaskQuestion({ sql, sourceId: source.id, taskId: task.id, options: decision.options, now });
      return written ? { kind: 'ask' } : null;
    }
    return null;
  } catch (error) {
    if (isMissingColumn(error)) noteMissingColumn();
    else console.error('subtask: הצעת משימת-אב נכשלה:', error?.name);
    return null;
  }
}

// ---------------------------------------------------------------------------
// הכרטיס בצ'אט ותשובה
// ---------------------------------------------------------------------------

export function parsePending(value) {
  try {
    const data = JSON.parse(value);
    if (!data || !Array.isArray(data.options)) return null;
    const options = data.options.filter((option) => option && UUID.test(String(option.id)));
    return options.length > 0 ? { options } : null;
  } catch {
    return null;
  }
}

// הכפתורים של הכרטיס, מתוך מה שנשמר. בלי מועמדים שמורים: "לא, נפרד" בלבד (ואפשר לסגור בו).
export const subtaskButtons = (payload) => (payload ? questionFor(payload.options).buttons : [SUBTASK_NO]);

// איזה מועמד נבחר: אינדקס, -1 ל"לא, נפרד", או null כשהתשובה לא מתפענחת.
export function parseSubtaskAnswer(payload, answer) {
  const text = String(answer ?? '').trim();
  if (text === SUBTASK_NO) return -1;
  if (!payload) return null;
  if (payload.options.length === 1) return text === SUBTASK_YES ? 0 : null;
  const index = payload.options.findIndex((option) => titleOf(option.title) === text);
  return index >= 0 ? index : null;
}

const CLOSED = Object.freeze({ status: 'closed', created: {} });
const UNCLEAR = Object.freeze({ status: 'unclear', created: {} });

// תשובה לכרטיס (api/chat.js, בשרשרת של action 'answer'). שאלה שאינה של תת-משימה: closed בלי כתיבה.
// פקודה אחת אטומית: סגירה מותנית של השאלה + שורת התשובה ב-sources + הקישור (רק ב"כן", ורק אם עדיין תקף: שתיהן פתוחות, ההורה אינו תת-משימה, לילד אין תתי-משימות)
// + בועה ("נרשם · תת-משימה של ..." או "לא קושר ..." כשהקישור כבר לא תקף). "לא, נפרד": בלי קישור ובלי בועה.
// במקום "פתיחה מחדש בכשל" של שאלת הזיהוי (lib/event-match.js reopenQuestion): כאן אין עיבוד אחרי הסגירה, וכשל מסד מבטל את כל הפקודה, ולכן הכרטיס נשאר פתוח.
export async function answerSubtaskLink({ sql, messageId, answer, now = new Date() }) {
  const nowIso = now.toISOString();
  const [ask] = rowsOf(await sql`
    SELECT m.id, m.awaiting_reply, m.entity_id AS task_id, t.title,
      (SELECT f.value FROM facts f WHERE f.entity_type = 'task' AND f.entity_id = m.entity_id AND f.field = 'subtask_pending' LIMIT 1) AS pending
    FROM messages m JOIN tasks t ON t.id = m.entity_id
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type = 'subtask_link'
      AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
  `);
  if (!ask || ask.awaiting_reply !== true) return { ...CLOSED };
  const payload = parsePending(ask.pending);
  const choice = parseSubtaskAnswer(payload, answer);
  if (choice === null) return { ...UNCLEAR };
  const text = String(answer ?? '').trim();
  const link = choice >= 0;
  const parent = link ? payload.options[choice] : null;
  const okBubble = link ? linkedReply(parent.title) : null;
  const failBubble = link ? notLinkedReply(ask.title) : null;
  const [written] = rowsOf(await sql`
    WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = 'subtask_link'
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING id, reply_source_id, entity_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${text}::text, NULL::text, now(), now() FROM closed
      RETURNING id
    ), u AS (
      UPDATE tasks c SET parent_task_id = p.id
      FROM tasks p
      WHERE c.id IN (SELECT entity_id FROM closed) AND p.id = ${parent?.id ?? null}::uuid AND ${link}::boolean AND c.id <> p.id
        AND c.status = 'open' AND p.status = 'open' AND p.parent_task_id IS NULL AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.parent_task_id = c.id)
      RETURNING c.id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', CASE WHEN EXISTS (SELECT 1 FROM u) THEN ${okBubble}::text ELSE ${failBubble}::text END, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'task', closed.entity_id, NULL::integer
      FROM closed
      WHERE ${link}::boolean
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT count(*) FROM u)::int AS linked, (SELECT id FROM ans) AS answer_source_id, (SELECT id FROM b) AS bubble_id
  `);
  if (Number(written?.closed) === 0) return { ...CLOSED };
  return {
    status: 'answered',
    created: { answerSourceId: written?.answer_source_id ?? null, bubbleId: written?.bubble_id ?? null },
    linked: Number(written?.linked ?? 0) > 0,
  };
}

// אחרי "בוצע" מרשימת הפתוחות: כרטיס "זה חלק מ...?" על המשימה שנסגרה כבר לא רלוונטי. בלי read_at (כמו closeQuestionsForTask ב-lib/personal-task.js).
export async function closeSubtaskQuestions(sql, taskId) {
  await sql`
    UPDATE messages SET awaiting_reply = false
    WHERE kind = 'question' AND awaiting_reply = true AND entity_type = 'subtask_link' AND entity_id = ${taskId}::uuid
  `;
}

// ---------------------------------------------------------------------------
// כפתור ידני (api/chat.js: subtask_link, subtask_unlink)
// ---------------------------------------------------------------------------

// קישור ידני. אותה הרשאה כמו שאר פעולות המשימה (task_done, attach): הסוד של הצ'אט, בלי בדיקה נוספת (משתמש אחד).
// מחזיר { status: 'linked' } · { status: 'invalid', reason } · { status: 'disabled' } (העמודה עוד לא קיימת).
// reason: self · not_found · not_open · parent_is_subtask · has_subtasks · changed (השתנה בין הבדיקה לעדכון). כשל מסד אחר נזרק (500).
// בדיקה בקוד קודם (כדי להחזיר סיבה), והעדכון עצמו מותנה באותם תנאים (כדי שלחיצה מקבילה לא תיצור שתי רמות).
export async function linkSubtask({ sql, taskId, parentId }) {
  if (taskId === parentId) return { status: 'invalid', reason: 'self' };
  try {
    const rows = rowsOf(await sql`
      SELECT t.id, t.status, t.parent_task_id, EXISTS (SELECT 1 FROM tasks k WHERE k.parent_task_id = t.id) AS has_subtasks
      FROM tasks t WHERE t.id IN (${taskId}::uuid, ${parentId}::uuid)
    `);
    const child = rows.find((row) => String(row.id) === taskId);
    const parent = rows.find((row) => String(row.id) === parentId);
    if (!child || !parent) return { status: 'invalid', reason: 'not_found' };
    if (child.status !== 'open' || parent.status !== 'open') return { status: 'invalid', reason: 'not_open' };
    if (parent.parent_task_id !== null && parent.parent_task_id !== undefined) return { status: 'invalid', reason: 'parent_is_subtask' };
    if (child.has_subtasks === true) return { status: 'invalid', reason: 'has_subtasks' };
    const updated = rowsOf(await sql`
      UPDATE tasks c SET parent_task_id = p.id
      FROM tasks p
      WHERE c.id = ${taskId}::uuid AND p.id = ${parentId}::uuid AND c.id <> p.id AND c.status = 'open' AND p.status = 'open'
        AND p.parent_task_id IS NULL AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.parent_task_id = c.id)
      RETURNING c.id
    `);
    return updated.length > 0 ? { status: 'linked' } : { status: 'invalid', reason: 'changed' };
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    noteMissingColumn();
    return { status: 'disabled' };
  }
}

// ניתוק ידני: המשימה חוזרת להיות עצמאית. { status: 'unlinked' } · { status: 'closed' } (לא קיימת או לא תת-משימה) · { status: 'disabled' }.
export async function unlinkSubtask({ sql, taskId }) {
  try {
    const rows = rowsOf(await sql`UPDATE tasks SET parent_task_id = NULL WHERE id = ${taskId}::uuid AND parent_task_id IS NOT NULL RETURNING id`);
    return { status: rows.length > 0 ? 'unlinked' : 'closed' };
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    noteMissingColumn();
    return { status: 'disabled' };
  }
}
