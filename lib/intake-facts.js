// חילוץ עובדות מהודעה (שלב 8.2, קוד בלבד): סוג, שדות חיוניים, השלמה ממערכת השעות, ורמת וודאות.
// מקור: docs/08-chapter8/35-chapter8-plan.md סעיף 3.8.0 ("שדות חיוניים"), docs/02-rules/03-intake-rules.md:68-108 ("רמת הוודאות", "השיעור המדויק הוא שדה חיוני").
// פונקציות טהורות: בלי מסד, בלי רשת, בלי מודל. מערכת השעות מוזרקת (timetable), כמו sql ב-api/intake.js.
//
// מבנה התוצאה של extractFacts:
//   type       סוג (lib/intake-dictionary.js) או null כשההודעה לא סווגה
//   facts      [{ field, value (טקסט), origin: 'read' | 'inferred', extracted_by: 'script' }]
//   missing    שדות חיוניים שאין להם ערך (גם כשיש להם מועמדים: אז הם גם ב-ambiguous)
//   certainty  'certain' | 'probable' | 'uncertain' (הקוד בלבד קובע, לפי 03-intake-rules.md:72-82)
//   ambiguous  [{ field, candidates }]: שדה שהקוד מצא לו יותר ממועמד אחד. מועמדים: מקצועות (טקסט), שיעורים (מספר השיעור כטקסט), תאריכים (YYYY-MM-DD)
//   understood האם אפשר לענות "נרשם" (סוג + תאריך מפוענח + מקצוע; ליום מקוצר: סוג + תאריך)
//
// שמות השדות: subject (מקצוע), date (תאריך; לשיעורי בית: תאריך הגשה), topic (נושא או חומר), lesson (השיעור המדויק: מספר השיעור, או "8,9"),
// new_room (החדר החדש), new_date (המועד החדש בהזזה). "לא יודע" נשמר כערך 'unknown' (תשובה תקפה, לא שדה חסר), ראה lib/intake-questions.js.
//
// הנחות שהמסמכים לא קובעים, כולן [הנחה, לא אומת] ושקל להפוך:
//  - בהזזה, "מה זז" נקרא כמקצוע (subject), ו-date (המועד המקורי, אם נאמר: "מיום ראשון") אינו שדה חיוני.
//  - שדה חיוני שחסר (בלי מועמדים) = probable (לא certain, כי לא כל השדות נקראו; ו-"אין כלל פעולה לתת לה רמה", 03-intake-rules.md:95, כך שהשאלה באה לפני).
//  - אין שדות לא-חיוניים מוגדרים, ולכן "שדה לא-חיוני חסר" אינו מתרחש כאן.
//  - כמה מקצועות בהודעה אחת, או כמה תאריכים שונים, נחשבים עמימות (ambiguous) ולא נבחר ביניהם.
//  - מקצוע שנקרא כאב ("מתמטיקה", "מדעים") מתאים גם לבניו במערכת השעות (גיאומטריה, מתמטיקה (תרגול); פיזיקה, כימיה), לפי data/school-timetable-taf-shin-pe-zayin.md, "הערות".
//  - סתירה (certainty uncertain): מקצוע ושיעור שנקראו מההודעה ואינם מתאימים למערכת השעות באותו יום.
//  - הערוץ (channel) לא משנה את החילוץ: "מחר" מחושב מחותמת הקליטה בשני הערוצים (03-intake-rules.md:60).
import { tokenize, fin, isNumberWord } from './intake-text.js';
import { classifyAll, findSubjectsInWords, findRoomsInWords } from './intake-dictionary.js';
import { analyzeDates, addDays, weekdayOf } from './intake-dates.js';

export const UNKNOWN_VALUE = 'unknown';

// שדות חיוניים לפי סוג: docs/08-chapter8/35-chapter8-plan.md סעיף 3.8.0. "השיעור המדויק" (lesson) בכולם חוץ מיום מקוצר (03-intake-rules.md:99-108).
export const ESSENTIAL_FIELDS = Object.freeze({
  exam: Object.freeze(['subject', 'date', 'topic', 'lesson']),
  homework: Object.freeze(['subject', 'date', 'topic', 'lesson']),
  cancel: Object.freeze(['subject', 'date', 'lesson']),
  room: Object.freeze(['subject', 'date', 'new_room', 'lesson']),
  move: Object.freeze(['subject', 'new_date', 'lesson']),
  short_day: Object.freeze(['date']),
});

// סדר השדות בפלט.
const FIELD_ORDER = Object.freeze({
  exam: ['subject', 'date', 'topic', 'lesson'],
  homework: ['subject', 'date', 'topic', 'lesson'],
  cancel: ['subject', 'date', 'lesson'],
  room: ['subject', 'date', 'new_room', 'lesson'],
  move: ['subject', 'date', 'new_date', 'lesson'],
  short_day: ['date'],
});

// --- הערכת שלמות ווודאות (גם לשימוש אחרי תשובות יובל) ---
// certain: כל השדות החיוניים נקראו מההודעה. probable: שדה חיוני הושלם בהסקה, או חסר. uncertain: סתירה, או השלמה עם יותר ממועמד אחד.
export function assessFacts({ type, facts, ambiguous = [], contradiction = false }) {
  const essential = ESSENTIAL_FIELDS[type];
  if (!essential) throw new RangeError(`assessFacts: סוג לא מוכר: ${type}`);
  const byField = new Map(facts.map((fact) => [fact.field, fact]));
  const missing = essential.filter((field) => !byField.has(field)); // "unknown" נחשב ערך (ידוע-שאינו-ידוע), לא חסר
  const inferredEssential = essential.some((field) => byField.get(field)?.origin === 'inferred');
  let certainty = 'certain';
  if (ambiguous.length > 0 || contradiction) certainty = 'uncertain';
  else if (missing.length > 0 || inferredEssential) certainty = 'probable';
  return { missing, certainty };
}

// האם אפשר לענות "נרשם": סוג + תאריך מפוענח + מקצוע (ליום מקוצר: סוג + תאריך). 'unknown' אינו ערך מפוענח.
export function isUnderstood(type, facts) {
  const value = (field) => facts.find((fact) => fact.field === field && fact.value !== UNKNOWN_VALUE)?.value;
  const date = type === 'move' ? value('new_date') : value('date');
  if (!date) return false;
  return type === 'short_day' ? true : Boolean(value('subject'));
}

// --- מערכת השעות ---
const slotsOf = (timetable) => (Array.isArray(timetable?.slots) ? timetable.slots : []);
const slotsOnDate = (timetable, iso) => slotsOf(timetable).filter((slot) => slot.weekday === weekdayOf(iso) + 1); // timetable: 1 = ראשון; weekdayOf: 0 = ראשון
const keyOf = (subject) => tokenize(String(subject)).tokens.map((token) => token.w).join(' '); // בלי גרשיים, סוגריים וסופיות

const SUBJECT_CHILDREN = { מתמטיקה: ['גיאומטריה'], מדעים: ['פיזיקה', 'כימיה'] };
// האם שורת מערכת השעות (slotSubject) היא המקצוע שנקרא מההודעה (readSubject).
export function slotMatchesSubject(slotSubject, readSubject) {
  const slotKey = keyOf(slotSubject);
  const readKey = keyOf(readSubject);
  return slotKey === readKey || slotKey.startsWith(`${readKey} `) || (SUBJECT_CHILDREN[readSubject] ?? []).some((child) => keyOf(child) === slotKey);
}

const sortedPeriods = (slots) => [...new Set(slots.map((slot) => slot.period))].sort((a, b) => a - b);

// --- שיעורים (מספרי שיעור מהטקסט) ---
// הקבוצה הראשונה: מ' ("משיעור 6" = מהשיעור הזה והלאה, לא השיעור המושפע).
const PERIOD_WORD = new RegExp(`^(?:וכש|וש|כש|ו|ש)?([בלמ])?(?:${['שיעור', 'שיעורים'].map(fin).join('|')})$`);
// "אחרי שיעור 6", "לפני שיעור 3", "עד שיעור 6": המספר הוא גבול ולא השיעור המושפע (ביקורת 12.10, סעיף 6). אי אפשר לדעת איזה שיעור הושפע, ולכן השדה נשאר חסר ונשאלת שאלה.
// [הנחה, לא אומת] "לפני" ו"עד" נוספו כמו "אחרי" (אותו מבנה), בכיוון הבטוח.
const BOUNDARY_BEFORE_PERIOD = /^(?:אחרי|לפני|עד)$/;
const isLessonNumber = (w) => isNumberWord(w) && Number(w) >= 1 && Number(w) <= 9; // 1 עד 9 (מבנה היום: lib/timetable.js LESSON_PERIODS)

// קורא רצף מספרי שיעור שמתחיל במילה from: "3", "8 ו-9", "5-6", "1 עד 3". מוסיף ל-periods ומחזיר את האינדקס שאחרי הרצף.
function readPeriodRun(words, clean, tokens, from, periods) {
  let j = from;
  let previous = null; // { n, index }
  let rangePending = false;
  while (j < words.length) {
    const w = words[j];
    if (isLessonNumber(w)) {
      const n = Number(w);
      const joinedByHyphen = previous?.index === j - 1 && /[-–־]/.test(clean.slice(tokens[j - 1].end, tokens[j].start));
      if (previous && (rangePending || joinedByHyphen)) for (let k = previous.n + 1; k < n; k += 1) periods.add(k);
      periods.add(n);
      previous = { n, index: j };
      rangePending = false;
      j += 1;
    } else if (w === 'ו') {
      j += 1;
    } else if (w === 'עד' && previous) {
      rangePending = true;
      j += 1;
    } else {
      break;
    }
  }
  return j;
}

// "שיעור 3", "שיעורים 8 ו-9", "שיעורים 5-6", "שיעורים 1 עד 3".
function extractLessons(words, clean, tokens) {
  const periods = new Set();
  for (let i = 0; i < words.length; i += 1) {
    const period = PERIOD_WORD.exec(words[i]);
    if (!period || period[1] === 'מ' || BOUNDARY_BEFORE_PERIOD.test(words[i - 1] ?? '')) continue;
    let j = i + 1;
    if (words[j] === 'מספר') j += 1;
    readPeriodRun(words, clean, tokens, j, periods);
  }
  return [...periods].sort((a, b) => a - b);
}

// מספרי שיעור מתשובה חופשית של יובל ("שיעורים 1-3", "8 ו-9", "שיעור 5 · אנגלית"): אותה הרחבת טווחים כמו extractLessons, בלי לדרוש מילת "שיעור" לפניהם.
export function readLessonNumbers(text) {
  const { clean, tokens } = tokenize(text);
  const words = tokens.map((token) => token.w);
  const periods = new Set();
  for (let j = 0; j < words.length;) j = isLessonNumber(words[j]) ? readPeriodRun(words, clean, tokens, j, periods) : j + 1;
  return [...periods].sort((a, b) => a - b);
}

// --- נושא או חומר ---
// אחרי "על", "בנושא", "בפרק", "בחומר" (35, סעיף 3.8.0). נעצר בסימן פיסוק, בתאריך/שעה/שיעור, או אחרי 8 מילים.
// [הנחה, לא אומת] "על ידי / על פי / על מנת" אינם נושא. אם כל המילים אחרי "על" הן שם מקצוע, זה המקצוע ולא נושא.
const TOPIC_MARKERS = [
  { re: /^על$/, includeMarker: false },
  { re: new RegExp(`^(?:ו|ש)?${fin('בנושא(?:ים)?')}$`), includeMarker: false },
  { re: new RegExp(`^(?:ו|ש)?${fin('בפרק(?:ים)?')}$`), includeMarker: true }, // "בפרק 3" -> "פרק 3"
  { re: /^(?:ו|ש)?בחומר$/, includeMarker: false },
];
const NOT_A_TOPIC_START = new RegExp(`^(?:${['ידי', 'פי', 'מנת', 'אף', 'פני', 'גבי', 'בסיס'].map(fin).join('|')})$`);
const TOPIC_STOP_WORD = new RegExp(`^(?:וכש|וש|כש|ו|ש)?(?:(?:ב|ל|מ)?(?:${['שיעור', 'שיעורים', 'שעה', 'יום', 'שבוע', 'מחר', 'מחרתיים'].map(fin).join('|')})|היום|[בל](?:${['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map(fin).join('|')}))$`);
const MAX_TOPIC_WORDS = 8;

// typeEnd: אינדקס מילת הסוג בטקסט (מ-classifyAll). רק "על", "בנושא", "בפרק" ו"בחומר" שאחריה הם נושא (ביקורת 12.10, סעיף 3):
// "על כולם להגיע בזמן. מחר מבחן..." אינו נושא. בלי כזה: נושא חסר ונשאלת שאלה.
function extractTopic(words, clean, tokens, mentions, subjectSpans, typeEnd) {
  const inMention = (index) => mentions.some((m) => index >= m.start && index <= m.end);
  for (let i = Math.max(typeEnd + 1, 0); i < words.length; i += 1) {
    const marker = TOPIC_MARKERS.find(({ re }) => re.test(words[i]));
    if (!marker) continue;
    let from = i + 1;
    if (!marker.includeMarker && words[from] === 'של') from += 1; // "בחומר של פרק 3"
    if (from >= words.length || NOT_A_TOPIC_START.test(words[from])) continue;
    let to = from;
    while (to < words.length && to - from < MAX_TOPIC_WORDS) {
      const gap = clean.slice(tokens[to - 1].end, tokens[to].start);
      const startsDate = inMention(to) || (/^[בלמ]$/.test(words[to]) && inMention(to + 1));
      if ((to > from && /[,;:!?\n]|\.(?:\s|$)/.test(gap)) || TOPIC_STOP_WORD.test(words[to]) || startsDate) break;
      to += 1;
    }
    while (to > from && /^(?:ו|של|את|ב|ל)$/.test(words[to - 1])) to -= 1; // מילות קישור תלויות בסוף
    if (to <= from) continue;
    const indices = Array.from({ length: to - from }, (_, k) => from + k);
    if (indices.every((index) => subjectSpans.has(index))) continue; // "מבחן על מתמטיקה": זה המקצוע
    let value = clean.slice(tokens[from].start, tokens[to - 1].end).trim();
    if (marker.includeMarker) value = `${clean.slice(tokens[i].start, tokens[i].end).replace(/^(?:ו|ש)?ב/, '')} ${value}`;
    return value;
  }
  return null;
}

// --- בחירת תאריך מתוך האזכורים ---
// מחזיר { date, origin } או { ambiguous: [תאריכים] } או null. כש"היום" מופיע לצד תאריך אחר, הוא נזרק (כנראה זמן ההודעה ולא תאריך האירוע).
// preferTo: בשיעורי בית תאריך ההגשה הוא זה שבקידומת ל' ("ליום ראשון"). כמה תאריכים שונים שנשארו = עמימות. [הנחה, לא אומת]
function pickDate(mentions, todayIso, { preferTo = false } = {}) {
  let candidates = mentions;
  if (preferTo && candidates.some((m) => m.dir === 'to')) candidates = candidates.filter((m) => m.dir === 'to');
  const notToday = candidates.filter((m) => !(m.kind === 'rel' && m.date === todayIso));
  if (notToday.length > 0) candidates = notToday;
  if (candidates.length === 0) return null;
  const dates = [...new Set(candidates.flatMap((m) => (m.ambiguous ? m.candidates : [m.date])))];
  if (dates.length > 1) return { ambiguous: dates };
  return { date: dates[0], origin: candidates.find((m) => m.date === dates[0])?.origin ?? candidates[0].origin };
}

const EMPTY_RESULT = Object.freeze({ type: null, facts: [], missing: [], certainty: 'uncertain', ambiguous: [], understood: false });

// channel מתקבל לפי החוזה אבל אינו משנה את החילוץ (ראה הנחות למעלה).
// forcedType (אופציונלי, שלב 8.2א-1): הסוג שיובל בחר בשאלת "מה זה?" (docs/08-chapter8/47, תרחיש ג; 35 D10). החילוץ רץ עם הסוג הזה גם כשהמילון לא מצא סוג.
// סוג לא מוכר זורק RangeError. [הנחה, לא אומת] כשהמילון מצא את אותו סוג, הנושא נקרא אחרי מילת הסוג כרגיל; אחרת מחפשים "על/בנושא/בפרק/בחומר" מתחילת הטקסט.
export function extractFacts({ text, receivedAt, channel, timetable, timezone, forcedType } = {}) {
  if (forcedType !== undefined && forcedType !== null && !Object.hasOwn(ESSENTIAL_FIELDS, forcedType)) throw new RangeError(`extractFacts: סוג כפוי לא מוכר: ${forcedType}`);
  // receivedAt לא תקין זורק RangeError גם כשההודעה לא מסווגת (כשל חזק ולא שקט).
  const { todayIso, mentions, weekShift } = analyzeDates(text, receivedAt, { timezone });
  const classified = classifyAll(text);
  if (!classified && !forcedType) return { ...EMPTY_RESULT, facts: [], missing: [], ambiguous: [] };
  const type = forcedType || classified.type;
  const typeEnd = classified && classified.type === type ? classified.typeEnd : -1;

  const { clean, tokens } = tokenize(typeof text === 'string' ? text : '');
  const words = tokens.map((token) => token.w);
  const found = new Map(); // field -> { value, origin }
  const ambiguous = [];
  const set = (field, value, origin) => found.set(field, { value: String(value), origin });
  const markAmbiguous = (field, candidates) => ambiguous.push({ field, candidates: [...candidates] });
  let contradiction = false;

  // מקצוע
  const subjectHits = findSubjectsInWords(words);
  const subjectSpans = new Set(subjectHits.flatMap((hit) => Array.from({ length: hit.len }, (_, k) => hit.index + k)));
  const readSubjects = [...new Set(subjectHits.map((hit) => hit.subject))];
  if (readSubjects.length === 1) set('subject', readSubjects[0], 'read');
  else if (readSubjects.length > 1) markAmbiguous('subject', readSubjects);

  // תאריך (בהזזה: date = המועד המקורי "מיום...", new_date = המועד החדש)
  if (type === 'move') {
    const from = mentions.filter((m) => m.dir === 'from');
    const rest = mentions.filter((m) => m.dir !== 'from');
    if (from.length > 0 && !from[0].ambiguous) set('date', from[0].date, from[0].origin);
    if (weekShift && !rest.some((m) => m.dir === 'to')) {
      // "המבחן ביום שלישי נדחה לשבוע הבא": המועד שנאמר הוא המקורי, והחדש הוא עוד שבוע. בלי מועד מקורי ידוע, אין מה לחשב.
      const original = from[0] ?? (rest.length === 1 ? rest[0] : null);
      if (original && !original.ambiguous) {
        if (!found.has('date')) set('date', original.date, original.origin);
        set('new_date', addDays(original.date, 7), 'inferred');
      } else if (original) {
        markAmbiguous('new_date', original.candidates.map((candidate) => addDays(candidate, 7)));
      }
    } else {
      const picked = pickDate(rest, todayIso);
      if (picked?.ambiguous) markAmbiguous('new_date', picked.ambiguous);
      else if (picked) set('new_date', picked.date, picked.origin);
    }
  } else {
    const picked = pickDate(mentions, todayIso, { preferTo: type === 'homework' });
    if (picked?.ambiguous) markAmbiguous('date', picked.ambiguous);
    else if (picked) set('date', picked.date, picked.origin);
  }

  // נושא, חדר חדש, שיעור
  if (type === 'exam' || type === 'homework') {
    const topic = extractTopic(words, clean, tokens, mentions, subjectSpans, typeEnd);
    if (topic) set('topic', topic, 'read');
  }
  if (type === 'room') {
    const rooms = findRoomsInWords(words);
    const chosen = rooms.filter((room) => room.dir === 'to').at(-1) ?? rooms.filter((room) => room.dir !== 'from').at(-1) ?? rooms.at(-1);
    if (chosen) set('new_room', chosen.value, 'read');
  }
  const readLessons = type === 'short_day' ? [] : extractLessons(words, clean, tokens);
  if (readLessons.length > 0) set('lesson', readLessons.join(','), 'read');

  // השלמה ממערכת השעות: רק אחרי שהתאריך ידוע ללא עמימות. בהזזה: המקצוע והשיעורים שנקראו נבדקים מול המועד המקורי (date, אם נאמר),
  // והשיעור המדויק של האירוע אחרי ההזזה נשלף מהמועד החדש (new_date). [הנחה, לא אומת]
  const slotsFor = (field) => (found.has(field) && type !== 'short_day' ? slotsOnDate(timetable, found.get(field).value) : []);
  const subjectDay = slotsFor('date');
  const lessonDay = slotsFor(type === 'move' ? 'new_date' : 'date');
  if (subjectDay.length > 0) {
    const subjectAmbiguous = ambiguous.some((entry) => entry.field === 'subject');
    if (!found.has('subject') && !subjectAmbiguous) {
      // מקצוע חסר: לפי השיעורים שנקראו, ואם אין, לפי כל מקצועות היום (המערכת שואלת עם כפתורי אותו יום)
      const pool = readLessons.length > 0 ? subjectDay.filter((slot) => readLessons.includes(slot.period)) : subjectDay;
      const subjects = [...new Set([...pool].sort((a, b) => a.period - b.period).map((slot) => slot.subject))];
      if (subjects.length === 1) set('subject', subjects[0], 'inferred');
      else if (subjects.length > 1) markAmbiguous('subject', subjects);
    }
    if (found.has('subject') && found.get('subject').origin === 'read' && readLessons.length > 0) {
      // מקצוע ושיעור שנקראו: האם מערכת השעות מסכימה
      const atLessons = subjectDay.filter((slot) => readLessons.includes(slot.period));
      if (atLessons.length > 0 && !atLessons.some((slot) => slotMatchesSubject(slot.subject, found.get('subject').value))) contradiction = true;
    }
  }
  if (lessonDay.length > 0 && !found.has('lesson') && found.has('subject')) {
    const periods = sortedPeriods(lessonDay.filter((slot) => slotMatchesSubject(slot.subject, found.get('subject').value)));
    if (periods.length === 1) set('lesson', periods[0], 'inferred');
    else if (periods.length > 1) markAmbiguous('lesson', periods.map(String));
  }

  const facts = FIELD_ORDER[type]
    .filter((field) => found.has(field))
    .map((field) => ({ field, value: found.get(field).value, origin: found.get(field).origin, extracted_by: 'script' }));
  const { missing, certainty } = assessFacts({ type, facts, ambiguous, contradiction });
  return { type, facts, missing, certainty, ambiguous, understood: isUnderstood(type, facts) };
}
