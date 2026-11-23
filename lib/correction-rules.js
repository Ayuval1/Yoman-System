// תיקון שחוזר -> "לקבוע שמעכשיו ש-X = Y?" (בלוק 6 חלק ב', docs/01-foundation/אפיון-מורחב.md ח-7; עיקרון-על שני ב-CLAUDE.md: מה שחוזר הופך לכלל כתוב אחרי אישור יובל).
// הכרעת יובל ש1 (23.11.2026, docs/01-foundation/01-system-overview.md, "הכרעות יובל על 8 השאלות של פתק 103"): לומדים גם ממילים בהודעה, לא רק משדות,
// ושם נשמר ONLY בתוך כלל שיובל אישר בכרטיס. בכל מקום אחר "שמות לא נשמרים" נשאר.
//
// מה נחשב "תיקון": שורת facts field='fix_time' (נשמרת רק אחרי confirm=no, lib/intake-process.js answerQuestion) על הודעה שיובל הקליד באפליקציה (channel='app').
// "אותו תיקון שחוזר": שתי הודעות מוקלדות או יותר עם אותה שעה מתוקנת, שחולקות לפחות שורש תוכן אחד (fellThroughRoots: מה שהמילון לא תפס, בלי מקצוע, תאריך ושעה).
// הדפוס המוצע הוא המשותף הגדול ביותר. תיקון ראשון לא עושה כלום מלבד לתקן את המקרה (זה המצב הקיים; נבדק ב-test/correction-rules.test.js).
// הספירה נגזרת מנתונים שכבר קיימים (facts + sources), בלי טבלה חדשה ובלי עמודה חדשה.
//
// פרטיות, תכנון (בטבלה candidate_rules הקיימת, בלי שינוי סכמה):
//  - לפני אישור השורה נושאת רק מפתח מגובב: pattern = 'corr:<32 תווי sha256>' של "שדה|ערך|שורשים", ו-evidence = { kind, field, value, key, source_ids } (בלי מילים).
//  - המילים עצמן נמצאות רק בגוף הכרטיס הממתין (messages.body), כי בלעדיהן אי אפשר להציג את השאלה. אין להן עותק אחר.
//  - "כן": ה-pattern הופך לשורשים ו-evidence מקבל roots (השם נשמר בכלל שאושר, החריג של יובל), גוף הכרטיס ובועת התשובה נמחקים/כלליים.
//  - "לא": status='rejected', ה-pattern נשאר מגובב, גוף הכרטיס נמחק. המפתח (evidence.key) נשאר בשתי התשובות, ולכן אותו כלל לא מוצע שוב.
//  - [הנחה, לא אומת] גיבוב בלי מלח של מילה קצרה ניתן לניחוש בכוח גס; הוא מונע קריאה מקרית ולוג של שם, לא תקיפה ממוקדת של מי שיש לו גישה למסד.
//  - הלמידה רצה רק על ערוץ app (המילים של יובל). הודעה מהקיצור (טקסט של אחרים) לא נקראת ולא נלמדת.
// הכלל המאושר מופעל בקוד דטרמיניסטי בקליטה (applyCorrectionRules), לפני ובלי AI. RECORD_CANDIDATE_RULES (רישום דפוסי המילון, lib/intake-process.js) נשאר כבוי: נתיב אחר, בלי סינון שמות.
//
// הנחות, כולן [הנחה, לא אומת]: סף 2 מקורות; עד 50 תיקונים קודמים נבדקים; עד 6 שורשים בדפוס; רק שדה השעה (fix_time) נלמד: תאריך מתוקן הוא ערך חד-פעמי ולא כלל,
// ובמסד אין היום שדה מיקום בקליטה (הדוגמה "אצל דני = חולון" דורשת שדה כזה).
import { createHash } from 'node:crypto';
import { fellThroughRoots } from './intake-dictionary.js';
import { isTimedType, plusOneHour, FIX_TIME_FIELD } from './intake-facts.js';

export const CORRECTION_ENTITY = 'correction_rule';
export const CORRECTION_KIND = 'correction';
export const CORRECTION_YES = 'כן';
export const CORRECTION_NO = 'לא';
export const CORRECTION_BUTTONS = Object.freeze([CORRECTION_YES, CORRECTION_NO]);
export const CORRECTION_REPEAT_THRESHOLD = 2;
export const CORRECTION_PRIORS_LIMIT = 50;
export const CORRECTION_MAX_ROOTS = 6;
export const CORRECTION_CLOSED_TEXT = 'הצעת כלל מתיקונים · נסגרה';
export const CORRECTION_YES_REPLY = 'נקבע. מעכשיו זה נרשם לבד';
export const CORRECTION_NO_REPLY = 'בסדר, לא אקבע כלל';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const LRI = '⁦';
const PDI = '⁩';
const CARD = /^לקבוע שמעכשיו ש-([א-ת]+(?: [א-ת]+)*) = /;
const rowsOf = (result) => (Array.isArray(result) ? result : []);

// שורשי התוכן של הודעה, ממוינים וללא כפילות (סדר קבוע, כדי שהמפתח יהיה יציב).
export function ruleRootsOf(text) {
  return [...new Set(fellThroughRoots(typeof text === 'string' ? text : ''))].sort();
}

export function ruleKey({ field, value, roots }) {
  return `corr:${createHash('sha256').update(`${field}|${value}|${roots.join(' ')}`).digest('hex').slice(0, 32)}`;
}

export const cardText = ({ roots, value }) => `לקבוע שמעכשיו ש-${roots.join(' ')} = ${LRI}${value}${PDI}?`;

// השורשים מתוך גוף הכרטיס (המקום היחיד שבו הם יושבים לפני אישור), או null כשהגוף אינו כרטיס (למשל אחרי שנמחק).
export function parseCardRoots(body) {
  const match = typeof body === 'string' ? CARD.exec(body) : null;
  return match ? match[1].split(' ') : null;
}

const isSubset = (small, big) => small.every((root) => big.includes(root));

// text: ההודעה המתוקנת. priors: [{ id, raw_content }] של תיקונים קודמים באותה שעה. מחזיר { roots, sourceIds (הקודמים התומכים) } או null.
// נבחר המשותף הגדול ביותר בין ההודעה לבין קודם כלשהו, ובשוויון לפי הסדר האלפביתי (דטרמיניסטי).
export function findRepeat({ text, priors }) {
  const mine = ruleRootsOf(text);
  if (mine.length === 0) return null;
  const parsed = rowsOf(priors).map((prior) => ({ id: prior.id, roots: ruleRootsOf(prior.raw_content) }));
  let best = null;
  for (const prior of parsed) {
    const common = mine.filter((root) => prior.roots.includes(root));
    if (common.length === 0 || common.length > CORRECTION_MAX_ROOTS) continue;
    if (best === null || common.length > best.length || (common.length === best.length && common.join(' ') < best.join(' '))) best = common;
  }
  if (best === null) return null;
  return { roots: best, sourceIds: parsed.filter((prior) => isSubset(best, prior.roots)).map((prior) => prior.id) };
}

// כללים מאושרים: [{ roots, field: 'time', value: 'HH:MM' }]. כשל מסד: [] (נכשל פתוח: ההודעה נקלטת כרגיל), ורק שם השגיאה בלוג.
export async function loadApprovedCorrectionRules(sql) {
  try {
    const rules = [];
    for (const row of rowsOf(await sql`
      SELECT pattern, evidence FROM candidate_rules WHERE status = 'approved' AND evidence ->> 'kind' = 'correction'
    `)) {
      const evidence = row?.evidence;
      if (evidence?.kind !== CORRECTION_KIND || evidence.field !== 'time' || !HHMM.test(String(evidence.value))) continue;
      const roots = Array.isArray(evidence.roots) ? evidence.roots.filter((root) => typeof root === 'string' && root !== '') : [];
      if (roots.length === 0) continue;
      rules.push({ roots, field: 'time', value: evidence.value });
    }
    return rules;
  } catch (error) {
    console.error('correction-rules: טעינת הכללים נכשלה:', error?.name);
    return [];
  }
}

// מחיל כלל מאושר על עובדות שחולצו (קוד דטרמיניסטי, בלי AI). רק לסוגים עם שעה (isTimedType) ורק כשכבר נקראה שעה: לא ממציא שעה.
// כמה כללים מתאימים (כל השורשים שלהם בהודעה): הכי הרבה שורשים, ובשוויון הערך הקטן. שעת סיום שהוסקה מחושבת מחדש; שנקראה נשמרת אלא אם אינה אחרי ההתחלה החדשה.
export function applyCorrectionRules({ rules, text, facts, type }) {
  const list = facts.map((fact) => ({ ...fact }));
  if (!isTimedType(type) || rowsOf(rules).length === 0) return list;
  const timeIndex = list.findIndex((fact) => fact.field === 'time');
  if (timeIndex === -1) return list;
  const mine = ruleRootsOf(text);
  const matching = rules
    .filter((rule) => rule.field === 'time' && rule.roots.length > 0 && isSubset(rule.roots, mine))
    .sort((a, b) => b.roots.length - a.roots.length || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  if (matching.length === 0) return list;
  const value = matching[0].value;
  list[timeIndex] = { ...list[timeIndex], value, origin: 'inferred', extracted_by: 'script' };
  const endIndex = list.findIndex((fact) => fact.field === 'end_time');
  if (endIndex !== -1) {
    const end = list[endIndex];
    if (end.origin === 'inferred' || !(String(end.value) > value)) list[endIndex] = { ...end, value: plusOneHour(value), origin: 'inferred', extracted_by: 'script' };
  }
  return list;
}

// נקרא אחרי שתשובת fix_time נכתבה (answerQuestion). מחזיר { status }: 'skipped' (לא ערוץ app, לא שעה תקינה, אין שורשים), 'first' (אין תיקון קודם דומה),
// 'proposed' (נוצרו מועמד וכרטיס), 'exists' (כבר הוצע / אושר / נדחה). כשל מסד נזרק (הקורא תופס: למידה לא מפילה תשובה).
export async function recordCorrection({ sql, source, field, value }) {
  const skipped = { status: 'skipped' };
  if (source?.channel !== 'app' || field !== FIX_TIME_FIELD || !HHMM.test(String(value))) return skipped;
  if (ruleRootsOf(source.raw_content).length === 0) return skipped;
  const priors = rowsOf(await sql`
    SELECT /* correction-priors */ s.id, s.raw_content
    FROM facts f JOIN sources s ON s.id = f.source_id
    WHERE f.field = 'fix_time' AND f.value = ${value}::text AND s.channel = 'app' AND s.id <> ${source.id}::uuid
    ORDER BY s.received_at DESC NULLS LAST, s.id ASC
    LIMIT ${CORRECTION_PRIORS_LIMIT}::integer
  `);
  const found = findRepeat({ text: source.raw_content, priors });
  if (!found || found.sourceIds.length + 1 < CORRECTION_REPEAT_THRESHOLD) return { status: 'first' };
  const key = ruleKey({ field: 'time', value, roots: found.roots });
  const sourceIds = [...found.sourceIds, source.id];
  const evidence = JSON.stringify({ kind: CORRECTION_KIND, field: 'time', value, key, source_ids: sourceIds });
  const body = cardText({ roots: found.roots, value });
  // פקודה אחת אטומית: המועמד נוצר רק אם אין עוד אחד עם אותו מפתח (הוצע, נדחה או אושר), והכרטיס נוצר רק עם המועמד החדש.
  const [row] = rowsOf(await sql`
    WITH ins AS (
      INSERT INTO candidate_rules (pattern, occurrences, first_seen, last_seen, evidence, status)
      SELECT /* correction-propose */ ${key}::text, ${sourceIds.length}::integer, now(), now(), ${evidence}::jsonb, 'candidate'
      WHERE NOT EXISTS (SELECT 1 FROM candidate_rules x WHERE x.evidence ->> 'key' = ${key}::text)
      RETURNING id
    ), q AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${body}::text, 'question', now(), true, NULL::uuid, NULL::timestamptz, ${CORRECTION_ENTITY}::text, ins.id, 1
      FROM ins
      RETURNING id
    )
    SELECT (SELECT id FROM ins) AS candidate_id, (SELECT id FROM q) AS question_id
  `);
  return { status: row?.candidate_id ? 'proposed' : 'exists' };
}

// תשובה לכרטיס (api/chat.js, אחרי שאר השאלות שמחזירות closed). מחזיר { status: 'answered' | 'closed' | 'unclear', created: { answerSourceId, bubbleId } }.
//  - closed: השאלה לא קיימת, אינה כרטיס כלל, כבר נסגרה, המועמד כבר לא 'candidate', גוף הכרטיס לא תואם למפתח, או נסגרה במקביל. לא נכתב כלום.
//  - unclear: תשובה שאינה "כן" / "לא". לא נכתב כלום.
//  - answered: פקודה אחת: סגירת השאלה (compare-and-set) + שורת התשובה + עדכון המועמד (approved / rejected) + בועה כללית (בלי שם).
export async function answerCorrectionRule({ sql, messageId, answer, now = new Date() }) {
  void now;
  const closed = { status: 'closed', created: {} };
  const [ask] = rowsOf(await sql`
    SELECT /* correction-ask */ m.id, m.entity_type, m.awaiting_reply, m.body, c.id AS candidate_id, c.status, c.evidence
    FROM messages m JOIN candidate_rules c ON c.id = m.entity_id
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type = ${CORRECTION_ENTITY}::text
  `);
  if (!ask || ask.awaiting_reply !== true || ask.status !== 'candidate') return closed;
  const evidence = ask.evidence;
  const roots = parseCardRoots(ask.body);
  if (!roots || evidence?.kind !== CORRECTION_KIND || ruleKey({ field: evidence.field, value: evidence.value, roots }) !== evidence.key) return closed;
  const text = typeof answer === 'string' ? answer.trim() : '';
  if (text !== CORRECTION_YES && text !== CORRECTION_NO) return { status: 'unclear', created: {} };
  const yes = text === CORRECTION_YES;
  const status = yes ? 'approved' : 'rejected';
  const pattern = yes ? roots.join(' ') : null; // null = ה-pattern נשאר מגובב
  const nextEvidence = JSON.stringify(yes ? { ...evidence, roots } : evidence);
  const reply = yes ? CORRECTION_YES_REPLY : CORRECTION_NO_REPLY;
  const [written] = rowsOf(await sql`
    WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid(), body = ${CORRECTION_CLOSED_TEXT}::text
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = ${CORRECTION_ENTITY}::text
      RETURNING id, reply_source_id, entity_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${text}::text, NULL::text, now(), now()
      FROM closed
      RETURNING id
    ), r AS (
      UPDATE candidate_rules SET status = ${status}::text, last_seen = now(), pattern = coalesce(${pattern}::text, pattern), evidence = ${nextEvidence}::jsonb
      WHERE id = (SELECT entity_id FROM closed) AND status = 'candidate'
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT /* correction-write */ 'out', ${reply}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, ${CORRECTION_ENTITY}::text, closed.entity_id, NULL::integer
      FROM closed
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id, (SELECT id FROM b) AS bubble_id
  `);
  if (Number(written?.closed) === 0) return closed;
  return { status: 'answered', created: { answerSourceId: written?.answer_source_id ?? null, bubbleId: written?.bubble_id ?? null } };
}
