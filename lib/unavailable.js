// "לא זמין" (בלוק 3ב-2, docs/01-foundation/אפיון-מורחב.md ח-2). דוגמה של יובל: "אני לא זמין ב-5", וב-17:00 יש אימון.
//  - המערכת בודקת מה יש בשעה הזו (loadBusy ב-lib/free-check.js: מערכת השעות, events, Google). יש אירוע: שאלת משמעות אחת
//    ("יש לך אימון ב-17:00. אתה לא מגיע לאימון, או שאתה לא זמין בגלל זה?").
//  - "אני עסוק": שורת events עם domain='unavailable' (בלי שינוי סכמה). lib/quiet.js בודק אותה לפני כל התראה: בחלון אין התראות, ובסופו נשלחת אחת.
//  - "ב-5" = 17:00; כשלא ברור, שואלים (readTimes ב-lib/free-check.js).
//  - בלי שעת סיום: "עד מתי?" ואחריה "מה הסיבה?". הסיבה לא חובה: החלון נקבע ברגע שיש סוף, והשאלה על הסיבה נשארת פתוחה.
// הסוג משתלב בצינור הקליטה (lib/intake-process.js) כמו שאר הסוגים: עובדות ב-facts, שאלה אחת בכל פעם ב-messages, שורת אירוע באותה פקודה אטומית.
// פונקציות טהורות, חוץ מ-addConflict (קריאה בלבד מהמסד ומ-Google דרך loadBusy).
//
// הכרעות טכניות (בלוק 3ב-2), כולן [הנחה, לא אומת] ושקל להפוך:
//  - רק הודעה שיובל הקליד (ערוץ app). "אני לא זמין" בהודעה מועברת הוא של מישהו אחר, ולכן לא נקבע חלון.
//  - בלי שעת התחלה והתאריך הוא היום: מעכשיו ("לא זמין עד 20:00"). יום אחר בלי שעה: "באיזו שעה?".
//  - "לא מגיע": נרשם, בלי חלון ובלי שינוי באירוע עצמו (ח-2 לא קובע מה עושים באירוע).
//  - "לא זמין בגלל זה" בלי סוף: הסוף = סוף האירוע, ובלי שאלת סיבה (הסיבה ידועה).
//  - ההתנגשות נבדקת ברגע שידועים תאריך ושעה: בקליטה, או בתשובה שהשלימה אותם. חלון "לא זמין" קודם אינו התנגשות.
//  - הכותרת: "לא זמין", או "לא זמין · <סיבה>" כשהסיבה ידועה כשהחלון נכתב. סיבה שנענתה אחרי שהחלון נכתב לא משנה את הכותרת.
import { applyAnswer, buildQuestion, UNKNOWN_BUTTON } from './intake-questions.js';
import { assessFacts, UNKNOWN_VALUE } from './intake-facts.js';
import { resolveDates, localDateIso, parseIso, weekdayOf, formatDayMonth, WEEKDAY_NAMES } from './intake-dates.js';
import { localParts } from './schedule-time.js';
import { tokenize } from './intake-text.js';
import { readTimes, readEndTime, loadBusy, overlapping } from './free-check.js';
import { UNAVAILABLE_DOMAIN } from './quiet.js';

export const UNAVAILABLE_TYPE = 'unavailable';
export { UNAVAILABLE_DOMAIN };
export const CONFLICT_FIELD = 'conflict';
export const MEANING_FIELD = 'meaning';
export const REASON_FIELD = 'reason';
export const MEANING_BUTTONS = Object.freeze({ skip: 'לא מגיע', busy: 'לא זמין בגלל זה' });
const TITLE = 'לא זמין';
const TIME_ZONE = 'Asia/Jerusalem';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_REASON_LENGTH = 200;
const pad2 = (n) => String(n).padStart(2, '0');
const fact = (field, value, origin) => ({ field, value: String(value), origin, extracted_by: 'script' });
const validTime = (value) => (typeof value === 'string' && HHMM.test(value) ? value : null);
function validDate(value) {
  if (typeof value !== 'string') return null;
  try {
    parseIso(value);
    return value;
  } catch {
    return null;
  }
}
const normalized = (text) => tokenize(String(text ?? '')).tokens.map((token) => token.w).join(' ');

// ---------------------------------------------------------------------------
// חילוץ
// ---------------------------------------------------------------------------

// { type, facts, missing, certainty, ambiguous, understood }, באותו מבנה כמו extractFacts. understanding (אופציונלי): מה שהמוח העתיק (date_text, time_text, topic).
export function extractUnavailable({ text, receivedAt, understanding = null }) {
  const message = typeof text === 'string' ? text : '';
  const today = localDateIso(receivedAt, TIME_ZONE);
  const facts = [];
  const ambiguous = [];
  const mentions = resolveDates(understanding?.date_text ?? message, receivedAt);
  const dates = [...new Set(mentions.flatMap((m) => (m.ambiguous ? m.candidates : [m.date])))];
  let date = null;
  if (dates.length === 1) {
    date = dates[0];
    facts.push(fact('date', date, mentions[0].origin ?? 'read'));
  } else if (dates.length > 1) {
    ambiguous.push({ field: 'date', candidates: dates });
  } else {
    date = today;
    facts.push(fact('date', today, 'inferred'));
  }
  const times = readTimes(understanding?.time_text ?? message);
  let time = null;
  if (times.length === 1) {
    time = times[0];
    facts.push(fact('time', time, 'read'));
  } else if (times.length > 1) {
    ambiguous.push({ field: 'time', candidates: times });
  } else if (date === today) {
    const parts = localParts(new Date(receivedAt), TIME_ZONE);
    time = `${pad2(parts.hour)}:${pad2(parts.minute)}`;
    facts.push(fact('time', time, 'inferred'));
  }
  const end = readEndTime(message, time);
  if (end) facts.push(fact('end_time', end, 'read'));
  const reason = typeof understanding?.topic === 'string' ? understanding.topic.trim().slice(0, MAX_REASON_LENGTH) : '';
  if (reason !== '') facts.push(fact(REASON_FIELD, reason, message.includes(reason) ? 'read' : 'inferred'));
  const { missing, certainty } = assessFacts({ type: UNAVAILABLE_TYPE, facts, ambiguous });
  return { type: UNAVAILABLE_TYPE, facts, missing, certainty, ambiguous, understood: false };
}

// ---------------------------------------------------------------------------
// התנגשות
// ---------------------------------------------------------------------------

// עובדת conflict (JSON של { title, start, end }) לפריט הראשון שחופף לשעה, או null.
export function conflictFact(busy, time) {
  const [item] = overlapping(Array.isArray(busy?.items) ? busy.items : [], time);
  return item ? fact(CONFLICT_FIELD, JSON.stringify({ title: item.title, start: item.start, end: item.end }), 'inferred') : null;
}

// facts (מערך) בתוספת עובדת conflict, כשתאריך ושעה ידועים ועוד לא נבדקה התנגשות. קריאה בלבד. כשל = בלי התנגשות (נרשם בשם השגיאה).
export async function addConflict({ sql, facts, timetable, googleDay }) {
  const value = (field) => facts.find((f) => f.field === field)?.value;
  const date = validDate(value('date'));
  const time = validTime(value('time'));
  if (!date || !time || facts.some((f) => f.field === CONFLICT_FIELD)) return facts;
  try {
    const busy = await loadBusy({ sql, dateIso: date, timetable, googleDay, excludeDomains: [UNAVAILABLE_DOMAIN] });
    const found = conflictFact(busy, time);
    return found ? [...facts, found] : facts;
  } catch (error) {
    console.error('unavailable: בדיקת ההתנגשות נכשלה:', error?.name);
    return facts;
  }
}

function parseConflict(value) {
  try {
    const data = JSON.parse(value);
    return data && typeof data.title === 'string' && validTime(data.start) ? data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// מצב ושאלה הבאה
// ---------------------------------------------------------------------------

// known: Map שדה -> עובדה (מה שנשמר). ambiguous: Map שדה -> מועמדים. fresh: החילוץ מחדש מהטקסט ({ facts, ambiguous }). today: יום ההודעה.
// מחזיר { all, ambiguous, missing, next, certainty, understood }, באותו מבנה כמו resolveState ב-lib/intake-process.js.
export function resolveUnavailable({ known, ambiguous = new Map(), fresh = { facts: [], ambiguous: [] }, today = null }) {
  const all = new Map(known);
  const open = new Map(ambiguous);
  for (const entry of fresh.ambiguous ?? []) if (!all.has(entry.field) && !open.has(entry.field)) open.set(entry.field, entry.candidates);
  const value = (field) => all.get(field)?.value;
  const conflict = value(CONFLICT_FIELD) ? parseConflict(value(CONFLICT_FIELD)) : null;
  const meaning = value(MEANING_FIELD);
  const time = validTime(value('time'));
  // "לא זמין בגלל זה" בלי סוף: עד סוף האירוע.
  if (meaning === 'busy' && conflict && !all.has('end_time') && validTime(conflict.end) && time && conflict.end > time) {
    all.set('end_time', fact('end_time', conflict.end, 'inferred'));
  }
  const endInMessage = (fresh.facts ?? []).some((f) => f.field === 'end_time');
  let next = null;
  if (!all.has('date')) next = buildQuestion({ field: 'date', candidates: open.get('date'), today: today ?? undefined });
  else if (!all.has('time')) next = buildQuestion({ field: 'time', candidates: open.get('time') });
  else if (conflict && !meaning) {
    next = {
      field: MEANING_FIELD,
      text: `יש לך ${conflict.title} ב-${conflict.start}. אתה לא מגיע ל${conflict.title}, או שאתה לא זמין בגלל זה?`,
      buttons: [MEANING_BUTTONS.skip, MEANING_BUTTONS.busy],
      allowFreeText: false,
    };
  } else if (meaning !== 'skip' && !all.has('end_time')) {
    next = { field: 'end_time', text: 'עד מתי?', buttons: [UNKNOWN_BUTTON], allowFreeText: true };
  } else if (meaning !== 'skip' && !conflict && !endInMessage && !all.has(REASON_FIELD) && validTime(value('end_time'))) {
    next = { field: REASON_FIELD, text: 'מה הסיבה?', buttons: [UNKNOWN_BUTTON], allowFreeText: true };
  }
  const facts = [...all.values()];
  const ambiguousList = [...open].filter(([field]) => !all.has(field)).map(([field, candidates]) => ({ field, candidates }));
  const { missing, certainty } = assessFacts({ type: UNAVAILABLE_TYPE, facts, ambiguous: ambiguousList });
  const dated = Boolean(validDate(value('date')) && time);
  const understood = dated && (meaning === 'skip' || (Boolean(validTime(value('end_time'))) && (!conflict || meaning === 'busy')));
  return { all, ambiguous: open, missing, next, certainty, understood };
}

// ---------------------------------------------------------------------------
// תשובה
// ---------------------------------------------------------------------------

// עובדות מעודכנות אחרי תשובה לשאלה field (כמו applyAnswer). all: Map של המצב לפני התשובה (לשעת ההתחלה). תשובה לא מפוענחת: העובדות כמו שהן.
export function applyUnavailableAnswer({ facts, field, answer, now, candidates, all }) {
  const text = String(answer ?? '').replace(/\s+/g, ' ').trim();
  const copy = facts.map((f) => ({ ...f }));
  const put = (value) => [...copy.filter((f) => f.field !== field), fact(field, value, 'read')];
  if (text === '') return copy;
  const unknown = normalized(text) === normalized(UNKNOWN_BUTTON);
  if (field === MEANING_FIELD) {
    const words = normalized(text);
    const match = Object.entries(MEANING_BUTTONS).find(([, label]) => normalized(label) === words);
    return match ? put(match[0]) : copy;
  }
  if (field === REASON_FIELD) return put(unknown ? UNKNOWN_VALUE : text.slice(0, MAX_REASON_LENGTH));
  if (field === 'end_time') {
    if (unknown) return put(UNKNOWN_VALUE);
    const start = validTime(all?.get('time')?.value);
    const read = /^עד\s/.test(text) ? readEndTime(text, start) : null;
    const parsed = read ?? applyAnswer({ facts: [], field: 'time', answer: text.replace(/^עד\s+/, ''), receivedAt: now }).find((f) => f.field === 'time')?.value;
    if (!validTime(parsed)) return copy;
    let end = parsed;
    if (start && end <= start && Number(end.slice(0, 2)) < 12) end = `${pad2(Number(end.slice(0, 2)) + 12)}${end.slice(2)}`;
    return start && end <= start ? copy : put(end);
  }
  return applyAnswer({ facts: copy, field, answer: text, receivedAt: now, candidates });
}

// ---------------------------------------------------------------------------
// החלון והבועה
// ---------------------------------------------------------------------------

// שורת events (לפרמטר ה-JSON של הצינור) או null: רק כשיש תאריך, התחלה וסוף אחרי ההתחלה, ולא "לא מגיע", ולא כשההתנגשות עוד לא נענתה.
export function unavailableEventRow(all, sourceId) {
  const value = (field) => all.get(field)?.value;
  const date = validDate(value('date'));
  const start = validTime(value('time'));
  const end = validTime(value('end_time'));
  const meaning = value(MEANING_FIELD);
  if (!date || !start || !end || end <= start || meaning === 'skip') return null;
  if (value(CONFLICT_FIELD) && meaning !== 'busy') return null;
  const reason = value(REASON_FIELD);
  const title = typeof reason === 'string' && reason.trim() !== '' && reason !== UNKNOWN_VALUE ? `${TITLE} · ${reason.trim()}` : TITLE;
  return { title, domain: UNAVAILABLE_DOMAIN, start_date: date, start_time: start, end_date: date, end_time: end, movable: false, match_key: `source:${sourceId}` };
}

// "נרשם · לא זמין · 17:00–19:00 · שני 23.11 · בלי התראות עד 19:00", או "נרשם · לא מגיע · אימון · שני 23.11". null כשאין מה לרשום.
export function unavailableReply(all) {
  const value = (field) => all.get(field)?.value;
  const date = validDate(value('date'));
  if (!date) return null;
  const day = `${WEEKDAY_NAMES[weekdayOf(date)]} ${formatDayMonth(date)}`;
  const conflict = value(CONFLICT_FIELD) ? parseConflict(value(CONFLICT_FIELD)) : null;
  if (value(MEANING_FIELD) === 'skip' && conflict) return `נרשם · לא מגיע · ${conflict.title} · ${day}`;
  const start = validTime(value('time'));
  const end = validTime(value('end_time'));
  if (!start || !end) return null;
  return `נרשם · ${TITLE} · ${start}–${end} · ${day} · בלי התראות עד ${end}`;
}
