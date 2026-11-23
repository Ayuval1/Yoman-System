// זיהוי שהודעה שייכת לאירוע קיים (בלוק 4; docs/01-foundation/אפיון.md "בלוק 2 — זיהוי האובייקט"; docs/08-chapter8/35-chapter8-plan.md סעיף 8.3;
// docs/01-foundation/01-system-overview.md, "זיהוי אובייקט" ו"ניקוד ההתאמה"; אפיון-מורחב סעיף 6, בלוק 4).
// מידע ששייך לאירוע קיים מעדכן אותו במקום ליצור כפילות. אין התאמה: המסלול הקיים בלי שינוי. עמום: שאלה אחת, "זה אותו דבר כמו ...?".
//
// מי עושה מה (CLAUDE.md, עקרון-העל 21.11.2026):
//  - הקוד שולף את המועמדים: אירועים מתוכננים שנולדו מהודעה (match_key 'source:'), מאתמול ועד POOL_DAYS_AHEAD ימים קדימה. אירועים אחרים
//    (שיעורים, יומן Google) אינם מועמדים: אין להם שורה ב-events שהמערכת כותבת בה.
//  - המוח (כשהוא זמין) מקבל את רשימת המועמדים (מפתח e1, e2..., כותרת, יום ושעה) ומחזיר match (אחד המפתחות או null) ו-match_sure.
//    הקוד בודק שהמפתח ברשימה (lib/intake-brain.js isValidUnderstanding) ושהניקוד שלו לא סותר: תאריך מקורי שנאמר רחוק מיותר מיום, או אפס מילים משותפות
//    בין הכותרת להודעה = שאלה, לא עדכון.
//  - בלי מוח: ניקוד בקוד. מילות הכותרת לפי שורש מקורב (הסרת אות-שימוש אחת או שתיים, כמו fellThroughRoots ב-lib/intake-dictionary.js), ותאריך.
//    הניקוד לא נשען על שדות שעשויים להיות ריקים (מורה, חדר): רק כותרת ותאריך, שיש לכל אירוע.
//  - "הגב" על הודעה שקשורה לאירוע (ההודעה שיצרה אותו, הבועה שלה, או בועת "עודכן" שלו): האירוע הזה הוא ההתאמה, בלי שאלה.
//
// ספים [הנחה, לא אומת; H13 ב-35: "אין בשום קובץ סף"]: "חזק" = כל מילות הכותרת נמצאות בהודעה; "אפור" = לפחות חצי מהן. התאמה ודאית רק כשיש מועמד חזק
// אחד ואין אף מועמד אפור נוסף. כל השאר באפור נשאל (35, Plan B: "תחום האפור רחב, והמערכת שואלת"). כל הכרעה נרשמת ב-probe_log 'event-match'
// (קודים בלבד) כדי שאפשר יהיה למדוד ולכייל.
//
// מה זה עדכון (טבלת ההרשאות docs/02-rules/03-permissions-rules.md, לא שונתה): הזזה (2, אוטונומי) = התחלה חדשה, והמשך נשמר; ביטול אירוע בודד (7, אוטונומי
// עם הודעה, מנגנון 1) = status 'cancelled' בלי מחיקה, ובועת "בוטל" היא ההודעה. עובדות ההודעה נשמרות מקושרות לאירוע (9: entity_type 'event').
// כלל הוודאות (פעולת יומן על עובדה לא ודאית יורדת רמה): התאמה לא ודאית לא מעדכנת, היא נשאלת.
//
// מבחן (לוח המבחנים data/school-exams.json הוא קובץ שרק יובל משנה, ולכן לא מתעדכן): הזזה או ביטול שמזכירים מבחן במקצוע שיש לו מבחן אחד בחלון
// מקבלים עובדת קישור match = 'exam:<תאריך>:<מקצוע>' ושורת "המבחן מ..." בבועה. זה זיהוי, לא עדכון של הלוח.
//
// פרטיות: כותרות אירועים מוצגות רק באפליקציה (גוף השאלה והבועה) ונשלחות למוח כמו טקסט ההודעה עצמה. בלוג: קודים בלבד.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי (אין מסד בסשן הבנייה). הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה.
import { tokenize } from './intake-text.js';
import { readingAt, isFunctionWord, classifyAll } from './intake-dictionary.js';
import { resolveDates, localDateIso, addDays, daysBetween, formatDayMonth, weekdayOf, parseIso, WEEKDAY_NAMES } from './intake-dates.js';
import { zonedToUtc } from './schedule-time.js';
import { slotMatchesSubject, UNKNOWN_VALUE } from './intake-facts.js';
import { EXAMS } from './exam-line.js';

const TIME_ZONE = 'Asia/Jerusalem';
const rowsOf = (result) => (Array.isArray(result) ? result : []);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// הסוגים שעוברים זיהוי: אירוע אישי (אותו אירוע שוב, או בשעה אחרת), הזזה וביטול. כל סוג אחר: המסלול הקיים בלי שינוי.
export const MATCH_TYPES = Object.freeze(['personal_event', 'move', 'cancel']);
export const MATCH_ENTITY = 'event_match';
export const MATCH_FACT = 'match';
export const PENDING_FACT = 'match_pending';
export const MATCH_YES = 'כן, אותו דבר';
export const MATCH_NO = 'לא, חדש';
export const MATCH_PROBE = 'event-match';
// [הנחה, לא אומת] הכרעות טכניות של הבנייה: חלון המועמדים, התקרות, והחלון כשההודעה לא אומרת מתי האירוע המקורי.
export const POOL_DAYS_AHEAD = 31;
export const POOL_LIMIT = 20;
export const OPEN_WINDOW_DAYS = 14;
export const MAX_OPTIONS = 3;
export const EXAM_WINDOW_DAYS = 14;

const validIso = (value) => {
  if (typeof value !== 'string') return null;
  try {
    parseIso(value);
    return value;
  } catch {
    return null;
  }
};
const validTime = (value) => (typeof value === 'string' && HHMM.test(value) ? value : null);
const dayLabel = (iso) => `${WEEKDAY_NAMES[weekdayOf(iso)]} ${formatDayMonth(iso)}`;

// "תור לספר · ראשון 22.11 · 17:00": התווית של מועמד (בשאלה, בכפתור ובבועה).
export function eventLabel({ title, date, time }) {
  const parts = [typeof title === 'string' && title.trim() !== '' ? title.trim() : 'אירוע'];
  if (validIso(date)) parts.push(dayLabel(date));
  if (validTime(time)) parts.push(time);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// התאמת כותרת לפי שורש מקורב
// ---------------------------------------------------------------------------

const CLITIC_LETTER = /^[והשלבמכ]/;
// הצורות של מילה: היא עצמה, ובלי אות-שימוש אחת או שתיים בתחילתה (כל עוד נשארות לפחות 3 אותיות). "התור" -> תור, "לספר" -> ספר.
function variantsOf(word) {
  const out = new Set([word]);
  let rest = word;
  for (let k = 0; k < 2 && CLITIC_LETTER.test(rest) && rest.length > 3; k += 1) {
    rest = rest.slice(1);
    out.add(rest);
  }
  return out;
}

// מילות התוכן: אותיות עבריות בלבד, לפחות 2, לא מילת פונקציה. הצורה המנורמלת של tokenize (בלי אותיות סופיות).
function contentWords(text) {
  return [...new Set(tokenize(String(text ?? '')).tokens.map((token) => token.w).filter((w) => /^[א-ת]{2,}$/.test(w) && !isFunctionWord(w)))];
}

// כמה ממילות הכותרת נמצאות בהודעה (לפי הצורות). { matched, total }.
export function titleOverlap(title, text) {
  const titleWords = contentWords(title);
  const messageForms = new Set(contentWords(text).flatMap((w) => [...variantsOf(w)]));
  const matched = titleWords.filter((w) => [...variantsOf(w)].some((form) => messageForms.has(form))).length;
  return { matched, total: titleWords.length };
}

const isStrong = (overlap) => overlap.total > 0 && overlap.matched === overlap.total;
const isGrey = (overlap) => overlap.matched > 0 && overlap.matched * 2 >= overlap.total;

// ---------------------------------------------------------------------------
// מה ההודעה משנה
// ---------------------------------------------------------------------------

// כל קריאות השעה בטקסט: { times: ערכים ודאיים שונים, unclear: יש קריאה עמומה ("בחמש") }.
export function readTimes(text) {
  const { clean, tokens } = tokenize(String(text ?? ''));
  const words = tokens.map((token) => token.w);
  const ctx = { words, clean, tokens };
  const times = [];
  let unclear = false;
  for (let i = 0; i < words.length; i += 1) {
    const found = readingAt(words, i, ctx);
    if (!found) continue;
    if (found.candidates.length === 1) {
      if (!times.includes(found.candidates[0])) times.push(found.candidates[0]);
    } else {
      unclear = true;
    }
    i = Math.max(i, found.end);
  }
  return { times, unclear };
}

function statesDate({ text, receivedAt, understanding }) {
  if (understanding) return Boolean(understanding.date_text || understanding.new_date_text);
  try {
    return resolveDates(text, receivedAt).some((mention) => !mention.ambiguous);
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

// השינוי שבהודעה: { cancel, date (תאריך חדש או null), times, unclear }, וגם refDate: מתי האירוע המקורי לפי ההודעה (או null).
//  - ביטול: הסוג cancel. הזזה: new_date הוא התאריך החדש, date (אם נאמר) הוא המקורי. אירוע אישי: התאריך שנאמר (לא "היום" שהוסק כברירת מחדל).
//  - שעה: באירוע אישי, עובדת time; אחרת כל השעות בהודעה (או בביטוי השעה שהמוח העתיק). המבחן של איזו מהן חדשה נעשה מול המועמד (targetFor).
export function readChange({ type, facts = [], text, receivedAt, understanding = null }) {
  const value = (field) => facts.find((fact) => fact.field === field && fact.value !== UNKNOWN_VALUE)?.value;
  const said = statesDate({ text, receivedAt, understanding });
  let date = null;
  let refDate = null;
  if (type === 'move') {
    date = validIso(value('new_date'));
    refDate = validIso(value('date'));
  } else if (type === 'cancel') {
    refDate = validIso(value('date'));
  } else if (type === 'personal_event' && said) {
    date = validIso(value('date'));
    refDate = date;
  }
  let times;
  let unclear = false;
  const eventTime = validTime(value('time'));
  if (type === 'personal_event') {
    times = eventTime ? [eventTime] : [];
  } else {
    const read = readTimes(understanding?.time_text ?? text);
    times = read.times;
    unclear = read.unclear;
  }
  return { cancel: type === 'cancel', date, times, unclear, refDate };
}

// היעד של מועמד אחד: { cancel: true } או { cancel: false, date, time, same }. null = לא ברור לאיזו שעה (שתי שעות חדשות, או קריאה עמומה).
// כשההודעה מזכירה גם את השעה הישנה ("התור של 17:00 עבר ל-18:00"), השעה החדשה היא זו שאינה השעה של המועמד.
export function targetFor(candidate, change) {
  if (change.cancel) return { cancel: true };
  if (change.unclear) return null;
  const others = change.times.filter((time) => time !== candidate.time);
  if (others.length > 1) return null;
  const date = change.date ?? candidate.date;
  const time = others[0] ?? candidate.time;
  return { cancel: false, date, time, same: date === candidate.date && time === candidate.time };
}

// ---------------------------------------------------------------------------
// ההכרעה (פונקציה טהורה)
// ---------------------------------------------------------------------------

// pool: מועמדים [{ id, title, date, time, sourceId }]. replyEvent: האירוע של ההודעה שעליה יובל הגיב (או null). brain: { key, sure } או null (בלי מוח).
// מחזיר { kind: 'update', candidate, target, by } · { kind: 'duplicate', candidate, by } · { kind: 'ask', options: [{ candidate, target }], by } · { kind: 'none', considered, by }.
export function decideMatch({ pool = [], replyEvent = null, text, type, change, today, brain = null }) {
  const none = (by, considered = 0) => ({ kind: 'none', considered, by });
  if (replyEvent) {
    const target = targetFor(replyEvent, change);
    if (!target) return none('reply');
    if (target.cancel || !target.same) return { kind: 'update', candidate: replyEvent, target, by: 'reply' };
    return type === 'personal_event' ? { kind: 'duplicate', candidate: replyEvent, by: 'reply' } : none('reply');
  }
  const inWindow = (candidate) => (change.refDate
    ? Math.abs(daysBetween(change.refDate, candidate.date)) <= 1
    : candidate.date >= today && candidate.date <= addDays(today, OPEN_WINDOW_DAYS));
  const scored = pool.filter((candidate) => validIso(candidate.date) && validTime(candidate.time) && inWindow(candidate))
    .map((candidate) => ({ candidate, overlap: titleOverlap(candidate.title, text) }));
  const strong = scored.filter((s) => isStrong(s.overlap)).map((s) => s.candidate);
  const grey = scored.filter((s) => isGrey(s.overlap)).map((s) => s.candidate);

  const ask = (list, by) => {
    const options = list.map((candidate) => ({ candidate, target: targetFor(candidate, change) }))
      .filter(({ target }) => target && (target.cancel || !target.same || type === 'personal_event'))
      .sort((a, b) => `${a.candidate.date} ${a.candidate.time}`.localeCompare(`${b.candidate.date} ${b.candidate.time}`))
      .slice(0, MAX_OPTIONS);
    return options.length > 0 ? { kind: 'ask', options, by } : none(by, scored.length);
  };
  const settle = (candidate, sure, by) => {
    const target = targetFor(candidate, change);
    if (!target) return none(by, scored.length);
    if (target.cancel) return { kind: 'update', candidate, target, by };
    if (target.same) return type === 'personal_event' ? { kind: 'duplicate', candidate, by } : none(by, scored.length);
    // אירוע אישי בשעה או ביום אחרים: אולי הזזה ואולי אירוע שני. רק המוח שבטוח מכריע; אחרת שואלים.
    if (type === 'personal_event' && !sure) return ask([candidate], by);
    return { kind: 'update', candidate, target, by };
  };

  if (brain) {
    if (brain.key) {
      const index = /^e(\d+)$/.exec(brain.key);
      const candidate = index ? pool[Number(index[1]) - 1] : undefined;
      if (candidate) {
        const overlap = titleOverlap(candidate.title, text);
        const contradicts = (change.refDate && Math.abs(daysBetween(change.refDate, candidate.date)) > 1) || overlap.matched === 0;
        if (brain.sure && !contradicts) return settle(candidate, true, 'brain');
        return ask([candidate], 'brain');
      }
    }
    // המוח אמר "חדש" (או לא החזיר מפתח): רק מועמד שהקוד רואה כחזק נשאל; אחרת חדש.
    return strong.length > 0 ? ask(strong, 'brain') : none('brain', scored.length);
  }
  if (strong.length === 1 && grey.length === 1) return settle(strong[0], false, 'code');
  if (grey.length > 0) return ask(grey, 'code');
  return none('code', scored.length);
}

// ---------------------------------------------------------------------------
// מבחן מהלוח (זיהוי בלבד)
// ---------------------------------------------------------------------------

// { date, subject, type } של המבחן היחיד במקצוע בחלון, או null. רק בהזזה או בביטול שמזכירים מבחן (מילת מבחן בטקסט).
export function examLinkFor({ text, type, facts = [], today, exams = EXAMS }) {
  if (type !== 'move' && type !== 'cancel') return null;
  if (!classifyAll(text)?.matchedTypes?.exam) return null;
  const subject = facts.find((fact) => fact.field === 'subject' && fact.value !== UNKNOWN_VALUE)?.value;
  if (!subject || !validIso(today)) return null;
  const refDate = validIso(facts.find((fact) => fact.field === 'date')?.value);
  // מבחן שכבר נמצא במועד החדש אינו "המבחן שזז": אין ממנו לאן לזוז.
  const newDate = validIso(facts.find((fact) => fact.field === 'new_date')?.value);
  const inWindow = (date) => date !== newDate
    && (refDate ? Math.abs(daysBetween(refDate, date)) <= 1 : date >= today && date <= addDays(today, EXAM_WINDOW_DAYS));
  const found = (Array.isArray(exams) ? exams : []).filter((exam) => exam && !exam.makeup && validIso(exam.date) && typeof exam.subject === 'string'
    && slotMatchesSubject(exam.subject, subject) && inWindow(exam.date));
  return found.length === 1 ? { date: found[0].date, subject: found[0].subject, type: found[0].type ?? 'מבחן' } : null;
}

// העובדות והסיומת לבועה של קישור מבחן.
export function examLinkExtras(link, facts = []) {
  const extra = [{ field: MATCH_FACT, value: `exam:${link.date}:${link.subject}`, origin: 'inferred' }];
  if (!facts.some((fact) => fact.field === 'date')) extra.push({ field: 'date', value: link.date, origin: 'inferred' });
  return { facts: extra, suffix: `${link.type} מ${dayLabel(link.date)}` };
}

// ---------------------------------------------------------------------------
// שליפה
// ---------------------------------------------------------------------------

const dayStart = (iso) => zonedToUtc(iso, '00:00', TIME_ZONE).toISOString();
const SOURCE_PREFIX = 'source:';

function candidateOf(row) {
  if (!row || typeof row.id !== 'string' || !UUID.test(row.id)) return null;
  const date = validIso(row.start_date);
  const time = validTime(row.start_time);
  if (!date || !time || typeof row.match_key !== 'string' || !row.match_key.startsWith(SOURCE_PREFIX)) return null;
  return { id: row.id, title: typeof row.title === 'string' ? row.title : '', date, time, domain: row.domain ?? null, sourceId: row.match_key.slice(SOURCE_PREFIX.length) };
}

// המועמדים: אירועים מתוכננים שנולדו מהודעה, מתחילת אתמול ועד POOL_DAYS_AHEAD ימים קדימה (בשעון ישראל), הקרובים קודם. לא זורק: כשל = [].
export async function loadEventPool(sql, receivedAt) {
  try {
    const today = localDateIso(receivedAt, TIME_ZONE);
    const rows = rowsOf(await sql`
      SELECT id, title, domain, match_key,
        to_char(starts_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS start_date,
        to_char(starts_at AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI') AS start_time
      FROM events
      WHERE status = 'planned' AND match_key LIKE 'source:%' AND match_key NOT LIKE 'source:task:%' AND starts_at IS NOT NULL
        AND starts_at >= ${dayStart(addDays(today, -1))}::timestamptz AND starts_at < ${dayStart(addDays(today, POOL_DAYS_AHEAD + 1))}::timestamptz
      ORDER BY starts_at ASC
      LIMIT ${POOL_LIMIT}::int
    `);
    return rows.map(candidateOf).filter(Boolean);
  } catch (error) {
    if (!(error instanceof RangeError)) console.error('event-match: שליפת המועמדים נכשלה:', error?.name);
    return [];
  }
}

// האירוע של ההודעה שעליה יובל הגיב ("הגב"): user = מקור (sources.id), system = בועה (messages.id, entity_type='source').
// האירוע שנולד מהמקור (match_key), או שהמקור קושר אליו (עובדת match, למשל בועת "עודכן"). רק מתוכנן ורק אחד; אחרת null. לא זורק.
export async function loadReplyEvent(sql, replyTo) {
  if (!replyTo || typeof replyTo.id !== 'string' || !UUID.test(replyTo.id)) return null;
  try {
    const rows = rowsOf(await sql`
      WITH s AS (
        SELECT CASE WHEN ${replyTo.role}::text = 'user' THEN ${replyTo.id}::uuid
          ELSE (SELECT m.entity_id FROM messages m WHERE m.id = ${replyTo.id}::uuid AND m.direction = 'out' AND m.entity_type = 'source') END AS sid
      )
      SELECT e.id, e.title, e.domain, e.match_key,
        to_char(e.starts_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS start_date,
        to_char(e.starts_at AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI') AS start_time
      FROM events e, s
      WHERE s.sid IS NOT NULL AND e.status = 'planned' AND e.match_key LIKE 'source:%' AND e.match_key NOT LIKE 'source:task:%'
        AND (e.match_key = 'source:' || s.sid::text
          OR e.id::text IN (SELECT f.value FROM facts f WHERE f.source_id = s.sid AND f.field = 'match'))
      LIMIT 2
    `);
    const found = rows.map(candidateOf).filter(Boolean);
    return found.length === 1 ? found[0] : null;
  } catch (error) {
    console.error('event-match: שליפת האירוע של התגובה נכשלה:', error?.name);
    return null;
  }
}

// הרשימה למוח: e1, e2... לפי סדר המאגר.
export const brainCandidates = (pool) => pool.map((candidate, index) => ({ key: `e${index + 1}`, label: eventLabel(candidate) }));

// מדידה (H13): הכרעה אחת לכל הודעה שהיו לה מועמדים, בלי טקסט ובלי כותרות. לא זורק.
export async function logMatch(sql, decision) {
  try {
    const options = decision.kind === 'ask' ? decision.options.length : decision.kind === 'none' ? 0 : 1;
    await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('event-match', ${decision.kind !== 'none'}, ${`kind=${decision.kind}; by=${decision.by}; options=${options}; considered=${decision.considered ?? ''}`})`;
  } catch (error) {
    console.error('event-match: רישום ההכרעה נכשל:', error?.name);
  }
}

// ---------------------------------------------------------------------------
// כתיבה
// ---------------------------------------------------------------------------

// הבועה אחרי עדכון: "עודכן · תור לספר · ראשון 22.11 · 18:00" או "בוטל · תור לספר · ראשון 22.11 · 17:00". כפילות: "כבר רשום · ...".
export function updateReply(candidate, target) {
  if (target.cancel) return `בוטל · ${eventLabel(candidate)}`;
  return `עודכן · ${eventLabel({ title: candidate.title, date: target.date, time: target.time })}`;
}
export const duplicateReply = (candidate) => `כבר רשום · ${eventLabel(candidate)}`;

// יציאה מוקדמת (תחום school): הסוף הוא סוף יום הלימודים, ולכן בהזזה באותו יום הוא נשאר (ולא נע עם ההתחלה). אחרת ההמשך נשמר.
export const keepsEnd = (candidate, target) => Boolean(target && !target.cancel && candidate?.domain === 'school' && target.date === candidate.date);

const factsJson = (facts) => JSON.stringify(facts.map(({ field, value, origin }) => ({ field, value: String(value), origin: origin ?? 'read' })));

// פקודה אחת אטומית: תפיסת המקור (רק אם האירוע עדיין מתוכנן) + עובדות ההודעה מקושרות לאירוע + עדכון האירוע (או כלום בכפילות) + הבועה.
// target: { cancel } או { date, time } (ההמשך של האירוע נשמר), או null לכפילות. מחזיר { claimed, updated, bubbleId }.
// גם אחרי "כן" בשאלה: answerEventMatch סוגר את השאלה בפקודה משלו ואז קורא לכאן (המקור עדיין לא נתפס עד אז).
// אירוע שכבר לא מתוכנן (בוטל בינתיים): שום דבר לא נכתב (claimed 0).
export async function writeMatched({ sql, sourceId, candidate, target, facts, certainty, bubble }) {
  const cancel = Boolean(target?.cancel);
  const move = Boolean(target && !target.cancel);
  const keepEnd = keepsEnd(candidate, target);
  const [written] = rowsOf(await sql`
    WITH claim AS (
      UPDATE sources SET processed_at = now()
      WHERE id = ${sourceId}::uuid AND processed_at IS NULL
        AND EXISTS (SELECT 1 FROM events e WHERE e.id = ${candidate.id}::uuid AND e.status = 'planned')
      RETURNING id
    ), f AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin, haiku_confidence)
      SELECT claim.id, x.field, x.value, ${certainty}::text, 'script', 'event', ${candidate.id}::uuid, x.origin, NULL::text
      FROM claim, jsonb_to_recordset(${factsJson(facts)}::jsonb) AS x(field text, value text, origin text)
      RETURNING id
    ), u AS (
      UPDATE events SET
        starts_at = CASE WHEN ${move}::boolean THEN ((${target?.date ?? null}::text || ' ' || ${target?.time ?? null}::text)::timestamp AT TIME ZONE 'Asia/Jerusalem') ELSE starts_at END,
        ends_at = CASE WHEN ${move}::boolean THEN (CASE WHEN ${keepEnd}::boolean
            THEN GREATEST(ends_at, ((${target?.date ?? null}::text || ' ' || ${target?.time ?? null}::text)::timestamp AT TIME ZONE 'Asia/Jerusalem'))
            ELSE ((${target?.date ?? null}::text || ' ' || ${target?.time ?? null}::text)::timestamp AT TIME ZONE 'Asia/Jerusalem') + (ends_at - starts_at) END) ELSE ends_at END,
        status = CASE WHEN ${cancel}::boolean THEN 'cancelled' ELSE status END
      WHERE id = ${candidate.id}::uuid AND status = 'planned' AND (${move}::boolean OR ${cancel}::boolean) AND EXISTS (SELECT 1 FROM claim)
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${bubble}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', claim.id, NULL::integer
      FROM claim
      WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source' AND x.entity_id = claim.id AND x.body = ${bubble}::text)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM claim)::int AS claimed, (SELECT count(*) FROM u)::int AS updated, (SELECT id FROM b) AS bubble_id
  `);
  return { claimed: Number(written?.claimed ?? 1), updated: Number(written?.updated ?? 0), bubbleId: written?.bubble_id ?? null };
}

// השאלה: "זה אותו דבר כמו <תווית>?" (מועמד אחד, "כן, אותו דבר" / "לא, חדש") או "זה אותו דבר כמו אחד מאלה?" (כפתור לכל מועמד, ו"לא, חדש").
export function questionFor(options) {
  if (options.length === 1) return { text: `זה אותו דבר כמו ${eventLabel(options[0].candidate)}?`, buttons: [MATCH_YES, MATCH_NO] };
  return { text: 'זה אותו דבר כמו אחד מאלה?', buttons: [...options.map(({ candidate }) => eventLabel(candidate)), MATCH_NO] };
}

// מה שנשמר לשאלה (עובדת match_pending, JSON): המועמדים והיעד של כל אחד, הסוג והעובדות של ההודעה, ומה שהמוח הבין (כדי ש"לא, חדש" ימשיך בלי קריאה נוספת למוח).
export function pendingPayload({ options, type, facts, certainty, understanding }) {
  return {
    options: options.map(({ candidate, target }) => ({ id: candidate.id, title: candidate.title, date: candidate.date, time: candidate.time, domain: candidate.domain ?? null, sourceId: candidate.sourceId, target })),
    type,
    facts: facts.map(({ field, value, origin }) => ({ field, value: String(value), origin: origin ?? 'read' })),
    certainty,
    understanding: understanding ?? null,
  };
}

// פקודה אחת: עובדת match_pending + השאלה (entity_type 'event_match', entity_id = המקור). המקור לא נתפס (processed_at נשאר ריק) עד התשובה.
// פעם אחת לכל מקור: NOT EXISTS על שאלת זיהוי קיימת. התפוגה: תחילת המועמד המאוחר ביותר (03-permissions-rules.md "משך ההמתנה לאישור":
// פעולת יומן על uncertain פוקעת בתחילת האירוע). מחזיר true כשנכתבה.
export async function writeMatchQuestion({ sql, sourceId, payload, question }) {
  const latest = payload.options.reduce((max, option) => {
    const at = zonedToUtc(option.date, option.time, TIME_ZONE).toISOString();
    return at > max ? at : max;
  }, '');
  const rows = rowsOf(await sql`
    WITH q AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${question.text}::text, 'question', now(), true, NULL::uuid, ${latest}::timestamptz, 'event_match', s.id, 1
      FROM sources s
      WHERE s.id = ${sourceId}::uuid AND s.processed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.kind = 'question' AND x.entity_type = 'event_match' AND x.entity_id = s.id)
      RETURNING id, entity_id
    ), f AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin, haiku_confidence)
      SELECT q.entity_id, 'match_pending', ${JSON.stringify(payload)}::text, ${payload.certainty}::text, 'script', NULL::text, NULL::uuid, 'inferred', NULL::text
      FROM q
      RETURNING id
    )
    SELECT (SELECT count(*) FROM q)::int AS questions_written
  `);
  return rows.length === 0 || Number(rows[0]?.questions_written) > 0;
}

// ---------------------------------------------------------------------------
// השאלה בצ'אט ותשובה
// ---------------------------------------------------------------------------

export function parsePending(value) {
  try {
    const data = JSON.parse(value);
    return data && Array.isArray(data.options) && data.options.length > 0 ? data : null;
  } catch {
    return null;
  }
}

// הכפתורים של שאלת זיהוי, מתוך מה שנשמר.
export function matchButtons(payload) {
  if (!payload) return [MATCH_NO];
  return questionFor(payload.options.map((option) => ({ candidate: option }))).buttons;
}

// איזה מועמד נבחר: אינדקס, -1 ל"לא, חדש", או null כשהתשובה לא מתפענחת.
export function parseMatchAnswer(payload, answer) {
  const text = String(answer ?? '').trim();
  if (text === MATCH_NO) return -1;
  if (payload.options.length === 1) return text === MATCH_YES ? 0 : null;
  const index = payload.options.findIndex((option) => eventLabel(option) === text);
  return index >= 0 ? index : null;
}

// פתיחה מחדש של שאלת זיהוי שנסגרה ב"לא, חדש" שהעיבוד שלו נכשל. רק אם ההודעה עדיין לא עובדה (processed_at ריק). לא זורק: כשל נרשם בשם השגיאה בלבד.
// [הנחה, לא אומת] אם גם הפתיחה נכשלת, ההודעה נשארת שמורה ב-sources בלי שאלה פתוחה; השגיאה עדיין מגיעה לדף ("לא נשלח, נסה שוב").
async function reopenQuestion(sql, messageId, sourceId) {
  try {
    await sql`
      UPDATE messages SET awaiting_reply = true, read_at = NULL, reply_source_id = NULL
      WHERE id = ${messageId}::uuid AND kind = 'question' AND entity_type = 'event_match' AND awaiting_reply = false
        AND EXISTS (SELECT 1 FROM sources s WHERE s.id = ${sourceId}::uuid AND s.processed_at IS NULL)
    `;
  } catch (error) {
    console.error('event-match: פתיחת שאלת הזיהוי מחדש נכשלה:', error?.name);
  }
}

const CLOSED = Object.freeze({ status: 'closed', created: {} });
const UNCLEAR = Object.freeze({ status: 'unclear', created: {} });

// תשובה לשאלת זיהוי (api/chat.js, בשרשרת של action 'answer'). שאלה שאינה של זיהוי: closed בלי כתיבה.
//  - "כן" (או מועמד): פקודה אחת לסגירת השאלה ולשורת התשובה, ואחריה writeMatched (תפיסה + עובדות + עדכון + בועה). matched = { sourceId } לכתיבה ליומן.
//  - "לא, חדש": סגירה ושורת תשובה, ואחריהן replay (processSource עם matchDisabled, ועם מה שהמוח הבין) = המסלול הקיים בדיוק. replayed = { sourceId, status }.
//  הסגירה והעיבוד שאחריה הן שתי פקודות. כשל בעיבוד (בשני המסלולים): השאלה נפתחת מחדש והשגיאה נזרקת (reopenQuestion), כדי שההודעה לא תישאר בשקט.
//  "כן" על אירוע שכבר לא מתוכנן: ההודעה עוברת לקליטה הרגילה כחדשה (replayed).
export async function answerEventMatch({ sql, messageId, answer, now = new Date(), replay }) {
  const nowIso = now.toISOString();
  const [ask] = rowsOf(await sql`
    SELECT m.id, m.awaiting_reply, m.entity_id AS source_id, s.channel, s.raw_content, s.content_hash, s.received_at,
      (SELECT f.value FROM facts f WHERE f.source_id = m.entity_id AND f.field = 'match_pending' LIMIT 1) AS pending
    FROM messages m JOIN sources s ON s.id = m.entity_id
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type = 'event_match'
      AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
  `);
  if (!ask || ask.awaiting_reply !== true) return { ...CLOSED };
  const payload = parsePending(ask.pending);
  if (!payload) return { ...CLOSED };
  const choice = parseMatchAnswer(payload, answer);
  if (choice === null) return { ...UNCLEAR };
  const text = String(answer ?? '').trim();
  const [closed] = rowsOf(await sql`
    WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = 'event_match'
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING id, reply_source_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${text}::text, NULL::text, now(), now() FROM closed
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id
  `);
  if (Number(closed?.closed) === 0) return { ...CLOSED };
  const answerSourceId = closed?.answer_source_id ?? null;
  const sourceId = String(ask.source_id);

  // כל כשל אחרי הסגירה: השאלה נפתחת מחדש (רק אם ההודעה עדיין לא עובדה) והשגיאה עולה ל-api/chat.js ("לא נשלח, נסה שוב."), כדי שההודעה לא תישאר בשקט.
  const failed = async (error, label) => {
    console.error(`event-match: ${label} נכשל:`, error?.name);
    await reopenQuestion(sql, messageId, sourceId);
    throw error;
  };
  // הקליטה הרגילה, בלי זיהוי ועם מה שהמוח הבין ("לא, חדש", או "כן" על אירוע שכבר לא מתוכנן).
  const runReplay = async () => {
    if (typeof replay !== 'function') return null;
    const source = { id: sourceId, channel: ask.channel, raw_content: ask.raw_content, content_hash: ask.content_hash, received_at: ask.received_at };
    try {
      const result = await replay({ source, understanding: payload.understanding });
      return { sourceId, status: result?.status ?? null };
    } catch (error) {
      return failed(error, 'עיבוד ההודעה כחדשה');
    }
  };

  if (choice >= 0) {
    const option = payload.options[choice];
    const candidate = { id: option.id, title: option.title, date: option.date, time: option.time, domain: option.domain ?? null, sourceId: option.sourceId };
    const target = option.target?.cancel || option.target?.same === false ? option.target : null;
    const bubble = target ? updateReply(candidate, target) : duplicateReply(candidate);
    const facts = [{ field: 'type', value: payload.type, origin: 'read' }, ...payload.facts, { field: MATCH_FACT, value: candidate.id, origin: 'inferred' }];
    let written;
    try {
      written = await writeMatched({ sql, sourceId, candidate, target, facts, certainty: payload.certainty ?? 'probable', bubble });
    } catch (error) {
      return failed(error, 'עדכון האירוע אחרי "כן"');
    }
    // לא נתפס: האירוע כבר לא מתוכנן (בוטל או נמחק בינתיים), או שההודעה כבר עובדה. ההודעה עוברת לקליטה הרגילה כחדשה, ושם מקבלת בועה או שאלה משלה
    // (הכרעה טכנית: בטוח יותר מבועה בלבד, כי המידע שבהודעה לא הולך לאיבוד). הודעה שכבר עובדה: הקליטה מחזירה skipped ולא כותבת.
    if (written.claimed === 0) {
      return { status: 'answered', created: { answerSourceId, bubbleId: null }, matched: null, replayed: await runReplay() };
    }
    return {
      status: 'answered',
      created: { answerSourceId, bubbleId: written.bubbleId },
      matched: written.updated > 0 ? { sourceId: candidate.sourceId } : null,
    };
  }
  return { status: 'answered', created: { answerSourceId, bubbleId: null }, replayed: await runReplay() };
}
