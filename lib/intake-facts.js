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
//  - הערוץ (channel) לא משנה את החילוץ: "מחר" מחושב מחותמת הקליטה בשני הערוצים (03-intake-rules.md:60). חריג יחיד (שלב 8.3-1): הערוץ מועבר למילון,
//    ושני הסוגים החדשים (early_leave, personal_event) נתפסים רק בערוץ 'app' (lib/intake-dictionary.js).
//
// שלב 8.3-1 ("זיהוי והבנה"): שני סוגים חדשים.
//  - early_leave (יציאה מוקדמת): date, time (HH:MM, נקרא), lesson (השיעורים שמפוספסים: "6,7,8,9", מוסק ממערכת השעות; חסר כשאין מערכת שעות או שאין שיעורים מפוספסים),
//    confirm ('yes' | 'no': התשובה לכרטיס האישור; לעולם לא חולצה מההודעה, ולכן אינה נספרת בוודאות ואינה ב-missing של extractFacts).
//  - personal_event (אירוע אישי): date, time, end_time (HH:MM; נקרא אחרי "עד", אחרת שעה אחרי ההתחלה, מוסק), topic (הכותרת כפי שהוקלדה, למשל "בדיקה רפואית"), confirm.
//  - [הנחה H6, לא אומת] בלי אזכור תאריך בהודעה, שני הסוגים מניחים "היום" (תאריך ההודעה בשעון ישראל), origin='inferred'.
//  - [הנחה, לא אומת] שעת סיום שאינה אחרי ההתחלה ("מ-16:00 עד 15:00") מתעלמים ממנה ומסיקים שעה אחרי ההתחלה; התחלה ב-23:xx נותנת סיום 23:59 (בלי חציית חצות).
//  - [הנחה, לא אומת] שיעור "מפוספס" = שיעור שנגמר (endsAt) אחרי שעת היציאה בהחלט. קראתי את "לא הסתיים לפני שעת היציאה" כ"עד שעת היציאה": שיעור שנגמר בדיוק בשעת היציאה אינו מפוספס.
//  - שעה במילים (אחרי 8.3-1, הכרעת יובל "א"): "בארבע וחצי", "ברבע לחמש" (lib/intake-dictionary.js, findTimeReading) היא עמומה (04:30 או 16:30), ואסור לנחש.
//    מילת הכרעה מתאימה ("אחה"צ", "בשמונה בערב") = שעה אחת, origin='read'. בלעדיה, ביציאה מוקדמת: אם רק קריאה אחת נופלת בשעות הלימודים (SCHOOL_DAY_START עד SCHOOL_DAY_END) היא נבחרת,
//    origin='inferred' (כרטיס האישור מציג אותה). אם שתיהן או אף אחת: עמימות (ambiguous: time), ונשאלת "בבוקר או בערב?" (lib/intake-questions.js). באירוע אישי: תמיד שואלים כשיש ספק, בלי להסיק משעות הלימודים.
//    [הנחה, לא אומת] שעות הלימודים כאן הן אותן 08:15 עד 15:45 של צורת "הביתה מוקדם" (למטה), כולל הקצוות, בלי תלות ביום בשבוע.
//  - ביטול בשיעורים אחרונים (cancel בלבד, הכרעת יובל "א"): "שני השיעורים האחרונים" / "שלושת..." / "N השיעורים האחרונים" / "השיעור האחרון" = השיעורים האחרונים ביום
//    לפי מערכת השעות של התאריך, origin='inferred'. בלי מספר ("השיעורים האחרונים בוטלו") לא ממציאים מספר. "שני" שם הוא מספר ולא יום, ולכן אזכור היום נזרק.
import { tokenize, fin, isNumberWord } from './intake-text.js';
import { classifyAll, findSubjectsInWords, findRoomsInWords, findTimeReading, findEndTime, findPersonalEvent, findEarlyLeave, findBareNoLessons, eventPrefixLength, HOME_ROOT } from './intake-dictionary.js';
import { analyzeDates, addDays, weekdayOf } from './intake-dates.js';

export const UNKNOWN_VALUE = 'unknown';

// שעות היום של בית הספר (שיעור 1 עד סוף שיעור 9, data/school-day-structure.md). [הנחה, לא אומת] ראה הערה בראש הקובץ.
const SCHOOL_DAY_START = '08:15';
const SCHOOL_DAY_END = '15:45';
const inSchoolHours = (hhmm) => hhmm >= SCHOOL_DAY_START && hhmm <= SCHOOL_DAY_END;
// ביציאה מוקדמת: מבין הקריאות של שעה במילים, זו שבשעות הלימודים אם יש רק אחת; אחרת null (שואלים).
const schoolHoursReading = (candidates) => {
  const inside = candidates.filter(inSchoolHours);
  return inside.length === 1 ? inside[0] : null;
};

// שדות חיוניים לפי סוג: docs/08-chapter8/35-chapter8-plan.md סעיף 3.8.0. "השיעור המדויק" (lesson) בכולם חוץ מיום מקוצר (03-intake-rules.md:99-108).
export const ESSENTIAL_FIELDS = Object.freeze({
  exam: Object.freeze(['subject', 'date', 'topic', 'lesson']),
  homework: Object.freeze(['subject', 'date', 'topic', 'lesson']),
  cancel: Object.freeze(['subject', 'date', 'lesson']),
  room: Object.freeze(['subject', 'date', 'new_room', 'lesson']),
  move: Object.freeze(['subject', 'new_date', 'lesson']),
  short_day: Object.freeze(['date']),
  early_leave: Object.freeze(['date', 'time', 'confirm']),
  personal_event: Object.freeze(['date', 'time', 'confirm']),
});

// שדה האישור: התשובה לכרטיס "נכון / לא נכון" (שלב 8.3-1). שדה חיוני לשני הסוגים החדשים, אבל לא עובדה שחולצה מההודעה.
export const CONFIRM_FIELD = 'confirm';
const TIMED_TYPES = Object.freeze(['early_leave', 'personal_event']);
export const isTimedType = (type) => TIMED_TYPES.includes(type);

// סדר השדות בפלט.
const FIELD_ORDER = Object.freeze({
  exam: ['subject', 'date', 'topic', 'lesson'],
  homework: ['subject', 'date', 'topic', 'lesson'],
  cancel: ['subject', 'date', 'lesson'],
  room: ['subject', 'date', 'new_room', 'lesson'],
  move: ['subject', 'date', 'new_date', 'lesson'],
  short_day: ['date'],
  early_leave: ['date', 'time', 'lesson', 'confirm'],
  personal_event: ['date', 'time', 'end_time', 'topic', 'confirm'],
});

// --- הערכת שלמות ווודאות (גם לשימוש אחרי תשובות יובל) ---
// certain: כל השדות החיוניים נקראו מההודעה. probable: שדה חיוני הושלם בהסקה, או חסר. uncertain: סתירה, או השלמה עם יותר ממועמד אחד.
export function assessFacts({ type, facts, ambiguous = [], contradiction = false }) {
  const allEssential = ESSENTIAL_FIELDS[type];
  if (!allEssential) throw new RangeError(`assessFacts: סוג לא מוכר: ${type}`);
  const essential = allEssential.filter((field) => field !== CONFIRM_FIELD); // confirm אינו עובדה שחולצה: לא נספר בחוסר ובוודאות
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
  if (isTimedType(type)) return Boolean(value('time')); // סוגי 8.3-1: תאריך ושעה, בלי מקצוע
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

const HHMM_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
// שיעורי היום לפי מערכת השעות, או [] כשהתאריך לא תקין (לא זורק).
function daySlots(timetable, iso) {
  if (typeof iso !== 'string' || !ISO_FORMAT.test(iso)) return [];
  try {
    return slotsOnDate(timetable, iso);
  } catch (error) {
    if (error instanceof RangeError) return [];
    throw error;
  }
}

// השיעורים שיובל מפספס כשהוא יוצא בשעה hhmm (HH:MM) בתאריך iso: מספרי שיעור ממוינים, בלי כפילויות. [] כשאין מערכת שעות, אין שיעורים ביום (שישי, שבת), או הקלט לא תקין.
// [הנחה, לא אומת] שיעור מפוספס = endsAt גדול בהחלט משעת היציאה (ראה הערה בראש הקובץ). השוואת HH:MM כמחרוזות נכונה כי הפורמט קבוע.
export function missedLessons(timetable, iso, hhmm) {
  if (typeof hhmm !== 'string' || !HHMM_FORMAT.test(hhmm)) return [];
  return sortedPeriods(daySlots(timetable, iso).filter((slot) => slot.endsAt > hhmm));
}

// סוף יום הלימודים (endsAt של השיעור האחרון) בתאריך iso כ-HH:MM, או null כשאין שיעורים ביום או אין מערכת שעות.
export function schoolDayEnd(timetable, iso) {
  const ends = daySlots(timetable, iso).map((slot) => slot.endsAt).sort();
  return ends.length > 0 ? ends.at(-1) : null;
}

// שעה אחרי hhmm (שעת סיום מוסקת לאירוע אישי). [הנחה, לא אומת] מ-23:00 ואילך: 23:59, בלי חציית חצות.
export function plusOneHour(hhmm) {
  const hour = Number(hhmm.slice(0, 2));
  return hour >= 23 ? '23:59' : `${String(hour + 1).padStart(2, '0')}${hhmm.slice(2)}`;
}

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

// --- "שני השיעורים האחרונים" (ביטול בלבד, שלב 8.3-1) ---
// מספר + "השיעורים" + "האחרונים" ("שני", "שלושת", "ארבעת", או ספרה 1 עד 9), או "השיעור האחרון" (= 1). בלי מספר ("השיעורים האחרונים") לא נתפס: לא ממציאים מספר.
// מחזיר { count, index, length } (אינדקסי מילים, כדי לזרוק אזכור יום שנוצר מהמילה "שני") או null.
const LAST_COUNT_WORDS = [[/^[ובל]?(?:שני|שתי)$/, 2], [/^[ובל]?(?:שלושת|שלושה)$/, 3], [/^[ובל]?(?:ארבעת|ארבעה)$/, 4]];
const LESSONS_DEFINITE = new RegExp(`^ה?${fin('שיעורים')}$`);
const LAST_PLURAL = new RegExp(`^ה?${fin('אחרונים')}$`);
const LAST_SINGULAR = new RegExp(`^ה?${fin('אחרון')}$`);
export function findLastLessons(words) {
  for (let i = 0; i < words.length; i += 1) {
    if (/^ה?שיעור$/.test(words[i]) && LAST_SINGULAR.test(words[i + 1] ?? '')) return { count: 1, index: i, length: 2 };
    if (i === 0 || !LESSONS_DEFINITE.test(words[i]) || !LAST_PLURAL.test(words[i + 1] ?? '')) continue;
    const named = LAST_COUNT_WORDS.find(([re]) => re.test(words[i - 1]));
    if (named) return { count: named[1], index: i - 1, length: 3 };
    if (/^[1-9]$/.test(words[i - 1])) return { count: Number(words[i - 1]), index: i - 1, length: 3 };
  }
  return null;
}

// מספרי השיעורים האחרונים ביום iso לפי מערכת השעות: count האחרונים, ממוינים. [] כשאין מערכת שעות, או שביום פחות שיעורים מהמספר (לא ממציאים).
export function lastLessonPeriods(timetable, iso, count) {
  const periods = sortedPeriods(daySlots(timetable, iso));
  return Number.isInteger(count) && count >= 1 && periods.length >= count ? periods.slice(-count) : [];
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

// early_leave ו-personal_event (שלב 8.3-1): חילוץ נפרד, בלי מקצוע ובלי שיעור נקרא. date (אם לא נאמר: היום, inferred), time, ועוד לפי הסוג (ראה הערה בראש הקובץ).
function extractTimedEvent({ type, words, clean, tokens, mentions, todayIso, timetable, allowHome = true }) {
  const found = new Map(); // field -> { value, origin }
  const ambiguous = [];
  const picked = pickDate(mentions, todayIso);
  if (picked?.ambiguous) ambiguous.push({ field: 'date', candidates: [...picked.ambiguous] });
  else if (picked) found.set('date', { value: picked.date, origin: picked.origin });
  else found.set('date', { value: todayIso, origin: 'inferred' }); // הנחה H6: בלי תאריך בהודעה = היום
  // השעה הצמודה לפועל / לביטוי האירוע (ביקורת, סעיף 3); רק כשהסוג נבחר ידנית ואין התאמה במילון: השעה הראשונה בהודעה (ודאית קודמת לעמומה).
  const ctx = { words, clean, tokens };
  const event = type === 'personal_event' ? findPersonalEvent(ctx) : null;
  const adjacent = type === 'early_leave' ? findEarlyLeave(ctx, { allowHome }) : event;
  const fallback = adjacent?.candidates?.length > 0 ? null : findTimeReading(words, ctx);
  const candidates = fallback ? fallback.candidates : (adjacent?.candidates ?? []);
  const contested = Boolean(fallback ? fallback.contested : adjacent?.contested); // מילת חלק-יום שלא הכריעה: לא מסיקים משעות הלימודים
  let time = null;
  if (candidates.length === 1) {
    time = candidates[0];
    found.set('time', { value: time, origin: 'read' });
  } else if (candidates.length > 1) {
    // שעה במילים עמומה: ביציאה מוקדמת נבחרת הקריאה היחידה שבשעות הלימודים (הסקה); בכל מקרה אחר שואלים ולא מנחשים.
    time = type === 'early_leave' && !contested ? schoolHoursReading(candidates) : null;
    if (time) found.set('time', { value: time, origin: 'inferred' });
    else ambiguous.push({ field: 'time', candidates: [...candidates] });
  }
  if (type === 'personal_event') {
    if (time) {
      const readEnd = findEndTime(words);
      if (readEnd && readEnd > time) found.set('end_time', { value: readEnd, origin: 'read' });
      else found.set('end_time', { value: plusOneHour(time), origin: 'inferred' });
    }
    if (event) found.set('topic', { value: clean.slice(tokens[event.index].start + eventPrefixLength(words, event.index), tokens[event.index + event.len - 1].end).trim(), origin: 'read' });
  }
  const date = found.get('date')?.value;
  if (type === 'early_leave' && date && time) {
    const missed = missedLessons(timetable, date, time);
    if (missed.length > 0) found.set('lesson', { value: missed.join(','), origin: 'inferred' });
  }
  const facts = FIELD_ORDER[type]
    .filter((field) => found.has(field))
    .map((field) => ({ field, value: found.get(field).value, origin: found.get(field).origin, extracted_by: 'script' }));
  const { missing, certainty } = assessFacts({ type, facts, ambiguous });
  return { type, facts, missing, certainty, ambiguous, understood: isUnderstood(type, facts) };
}

// channel מועבר למילון בלבד (שלב 8.3-1: early_leave ו-personal_event רק בערוץ 'app'); בשאר החילוץ הוא אינו משנה דבר (ראה הנחות למעלה).
// forcedType (אופציונלי, שלב 8.2א-1): הסוג שיובל בחר בשאלת "מה זה?" (docs/08-chapter8/47, תרחיש ג; 35 D10). החילוץ רץ עם הסוג הזה גם כשהמילון לא מצא סוג.
// סוג לא מוכר זורק RangeError. [הנחה, לא אומת] כשהמילון מצא את אותו סוג, הנושא נקרא אחרי מילת הסוג כרגיל; אחרת מחפשים "על/בנושא/בפרק/בחומר" מתחילת הטקסט.
export function extractFacts({ text, receivedAt, channel, timetable, timezone, forcedType } = {}) {
  if (forcedType !== undefined && forcedType !== null && !Object.hasOwn(ESSENTIAL_FIELDS, forcedType)) throw new RangeError(`extractFacts: סוג כפוי לא מוכר: ${forcedType}`);
  // receivedAt לא תקין זורק RangeError גם כשההודעה לא מסווגת (כשל חזק ולא שקט).
  const { todayIso, mentions, weekShift } = analyzeDates(text, receivedAt, { timezone });
  let classified = classifyAll(text, { channel });
  // "הולך הביתה מוקדם ב-12:00" (בלי ביטוי בית ספר) נתפס רק ביום לימודים (ראשון עד חמישי) ובשעות היום (08:15 עד 15:45); אחרת מתעלמים ממנו, והמילון רץ שוב בלעדיו (סבב 3).
  // [הנחה, לא אומת] "שעות היום" = מתחילת שיעור 1 (08:15) עד סוף שיעור 9 (15:45), לפי data/school-day-structure.md; תאריך עמום או שעה שלא נמצאה = לא מתקבל.
  let allowHome = true;
  if (classified && !forcedType && classified.type === 'early_leave' && classified.roots.every((root) => root === HOME_ROOT)) {
    const homeTokens = tokenize(typeof text === 'string' ? text : '');
    const homeWords = homeTokens.tokens.map((token) => token.w);
    const homeReading = findEarlyLeave({ words: homeWords, ...homeTokens }, { allowHome: true });
    const homeTime = homeReading && (homeReading.time ?? (homeReading.contested ? null : schoolHoursReading(homeReading.candidates)));
    const homeDate = pickDate(mentions, todayIso);
    const date = homeDate ? (homeDate.ambiguous ? null : homeDate.date) : todayIso;
    allowHome = Boolean(date && homeTime && weekdayOf(date) <= 4 && inSchoolHours(homeTime));
    if (!allowHome) classified = classifyAll(text, { channel, allowHome: false });
  }
  if (!classified && !forcedType) return { ...EMPTY_RESULT, facts: [], missing: [], ambiguous: [] };
  const type = forcedType || classified.type;
  const typeEnd = classified && classified.type === type ? classified.typeEnd : -1;

  const { clean, tokens } = tokenize(typeof text === 'string' ? text : '');
  const words = tokens.map((token) => token.w);
  if (isTimedType(type)) return extractTimedEvent({ type, words, clean, tokens, mentions, todayIso, timetable, allowHome });
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

  const lastLessons = type === 'cancel' ? findLastLessons(words) : null;

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
    // ביטול בשיעורים אחרונים: "שני" ב"שני השיעורים האחרונים" הוא מספר ולא יום, ולכן אזכור היום שנוצר ממנו נזרק.
    const dateMentions = type === 'cancel' && lastLessons ? mentions.filter((m) => m.end < lastLessons.index || m.start >= lastLessons.index + lastLessons.length) : mentions;
    const picked = pickDate(dateMentions, todayIso, { preferTo: type === 'homework' });
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
  let readLessons = type === 'short_day' ? [] : extractLessons(words, clean, tokens);
  if (type === 'cancel' && readLessons.length === 0) {
    // "מחר אין 8 ו-9" / "אין 5 ו-6 היום": רצף מספרים אחרי "אין", בלי המילה "שיעור" (סבב 3; התנאים בדיקה במילון).
    const start = findBareNoLessons({ words, clean, tokens });
    if (start >= 0) {
      const bare = new Set();
      readPeriodRun(words, clean, tokens, start, bare);
      readLessons = [...bare].sort((a, b) => a - b);
    }
  }

  if (readLessons.length > 0) set('lesson', readLessons.join(','), 'read');
  // שיעורים אחרונים (cancel, שיעורים שלא נקראו במפורש): לפי מערכת השעות של התאריך. הם משמשים להסקת המקצוע ולבדיקת סתירה כמו שיעורים שנקראו.
  let lessonList = readLessons;
  if (lastLessons && readLessons.length === 0 && found.has('date')) {
    const lastPeriods = lastLessonPeriods(timetable, found.get('date').value, lastLessons.count);
    if (lastPeriods.length > 0) {
      set('lesson', lastPeriods.join(','), 'inferred');
      lessonList = lastPeriods;
    }
  }

  // השלמה ממערכת השעות: רק אחרי שהתאריך ידוע ללא עמימות. בהזזה: המקצוע והשיעורים שנקראו נבדקים מול המועד המקורי (date, אם נאמר),
  // והשיעור המדויק של האירוע אחרי ההזזה נשלף מהמועד החדש (new_date). [הנחה, לא אומת]
  const slotsFor = (field) => (found.has(field) && type !== 'short_day' ? slotsOnDate(timetable, found.get(field).value) : []);
  const subjectDay = slotsFor('date');
  const lessonDay = slotsFor(type === 'move' ? 'new_date' : 'date');
  if (subjectDay.length > 0) {
    const subjectAmbiguous = ambiguous.some((entry) => entry.field === 'subject');
    if (!found.has('subject') && !subjectAmbiguous) {
      // מקצוע חסר: לפי השיעורים שנקראו, ואם אין, לפי כל מקצועות היום (המערכת שואלת עם כפתורי אותו יום)
      const pool = lessonList.length > 0 ? subjectDay.filter((slot) => lessonList.includes(slot.period)) : subjectDay;
      const subjects = [...new Set([...pool].sort((a, b) => a.period - b.period).map((slot) => slot.subject))];
      if (subjects.length === 1) set('subject', subjects[0], 'inferred');
      else if (subjects.length > 1) markAmbiguous('subject', subjects);
    }
    if (found.has('subject') && found.get('subject').origin === 'read' && lessonList.length > 0) {
      // מקצוע ושיעור שנקראו (או שיעורים אחרונים שהוסקו): האם מערכת השעות מסכימה
      const atLessons = subjectDay.filter((slot) => lessonList.includes(slot.period));
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
