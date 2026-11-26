// שאלות הבהרה, תשובות, דפוסי כללים ותשובת "נרשם" (שלב 8.2, קוד בלבד).
// מקור: docs/08-chapter8/35-chapter8-plan.md סעיף 3.8.0 ("שדות חיוניים", "הודעה שהקלדת בצ'אט"), docs/02-rules/03-messaging-rules.md:258-275 ("מה הקיצור אומר"),
// docs/02-rules/03-intake-rules.md:60 ("נרשם · בוחן במתמטיקה · שלישי 6.10"). פונקציות טהורות: בלי מסד, בלי רשת, בלי מודל.
//
// איך זה עובד בלולאה: extractFacts (lib/intake-facts.js) מחזיר מה חסר -> buildQuestion בונה שאלה עם כפתורים -> יובל לוחץ או כותב
// -> applyAnswer מחזיר את העובדות מעודכנות -> assessFacts (lib/intake-facts.js) בודק מה עוד חסר. "לא יודע" הוא תשובה תקפה ונשמר כ-'unknown'.
//
// הנחות שהמסמכים לא קובעים, כולן [הנחה, לא אומת]:
//  - ניסוח השאלות ("איזה מקצוע?", "על איזה נושא?", "לאיזה תאריך?", "איזה שיעור?", "לאיזה חדר?", "מה המועד החדש?") הוא מהמשימה של שלב 8.2; "ניסוח בפועל - תבנית, בפרק 8" (03-messaging-rules.md:254,297).
//    "מה זה?" (שאלת הסוג) נוספה בשלב 8.2א-1 לפי docs/08-chapter8/47, תרחיש ג.
//  - כל שאלה מציעה גם תיבת כתיבה (allowFreeText: true), לפי 35 סעיף 3.8.0 "כפתור 'לא יודע' לצד תיבת כתיבה". אין בורר תאריך (פרק 10).
//  - תשובת כפתור או טקסט נשמרת עם origin 'read' ו-extracted_by 'script': 06 מגדיר רק script/claude, והתשובה היא מיובל, לא של מודל.
//  - תווית כפתור של תאריך היא "יום ד.מ.שנה" (שלישי 13.10.2026) כדי ש-applyAnswer יוכל להמיר אותה בחזרה בלי מידע נוסף; תווית שיעור היא "שיעור N · מקצוע".
//  - תשובה שאי אפשר לפענח (תאריך לא תקין, שיעור בלי מספר) משאירה את העובדות כמו שהן, והשדה נשאר חסר (השאלה תישאל שוב).
//
// שלב 8.3-1: שתי שאלות חדשות. 'time' ("באיזו שעה?"): בסוגים early_leave ו-personal_event כשהשעה חסרה (למשל אחרי בחירה ב"מה זה?"); כפתור "לא יודע" ותיבת כתיבה, כמו שאר השאלות.
// 'confirm' (כרטיס האישור): טקסט שנגזר בכל קריאה מהעובדות השמורות (הוא לא נשמר כעמודה), עם שני כפתורים בלבד, "נכון" ו"לא נכון".
//  - [הנחה, לא אומת] allowFreeText=false וגם בלי "לא יודע": זה חריג מהכלל שלמעלה, והוא הכרעה של יובל לכרטיס הזה. שני כפתורים מספיקים וסוגרים את השאלה תמיד;
//    תיבת כתיבה הייתה מזמינה תשובה לא ברורה. הצרכן (public/index.html, קריאה בלבד) מציג תיבת כתיבה רק כש-allowFreeText אינו false.
//  - תשובה: "נכון" = 'yes', "לא נכון" = 'no', כל דבר אחר (גם "לא יודע") = לא מפוענח והשאלה נשארת פתוחה. אחרי "לא נכון" נפתח סבב התיקון של שלב 8.3-3 (למטה).
//  - [הנחה, לא אומת] ביציאה מוקדמת, כשהיום אינו היום של ההודעה, הכרטיס פותח ביום ("מחר יוצא ב-13:15, ..."); בלי today הוא פותח בשם היום והתאריך. כשהיום הוא היום: בדיוק הנוסח שיובל קבע.
//  - [הנחה, לא אומת] שיעור מפוספס אחד נכתב "שיעור 6" (יחיד) ולא "שיעורים 6".
//
// שעה במילים (אחרי 8.3-1, הכרעת יובל "א"): כש"בארבע" עמומה (04:00 או 16:00) ולא הוכרעה, שאלת 'time' מקבלת את שתי הקריאות (candidates) ושואלת "בבוקר או בערב?"
// עם כפתור לכל קריאה ("בבוקר · 04:00", "בערב · 16:00"), ו"לא יודע" ותיבת כתיבה כמו שאר השאלות. התווית נושאת את השעה, ולכן תשובה בלחיצה מפוענחת בלי מידע נוסף.
//  - [הנחה, לא אומת] "שני כפתורים" פורש כשני כפתורי תשובה (בבוקר, בערב) לצד "לא יודע" הרגיל; הנוסח הקבוע של שאר השאלות, בלי שינוי במסך.
//  - שתים עשרה (00:xx או 12:xx): "בלילה או בצהריים?", כדי לא לקרוא לחצות "בוקר".
//  - תשובה חופשית "בבוקר" / "בערב" / "בלילה" / "בצהריים" / "אחה"צ" נפתרת מול המועמדים (applyAnswer, candidates). [הנחה, לא אומת] כאן, אחרי ששתי הקריאות הוצעו,
//    המילה בוחרת ביניהן גם כשהיא לא "מתאימה" לשעה בדיבור רגיל ("בערב" ל-4 = 16:00); "בלילה" = הקריאה הלילית (00 עד 05), אחרת הערבית.
import { tokenize, fin, unfin } from './intake-text.js';
import { subjectLabel } from './timetable.js';
import { findSubjects, isFunctionWord, findClockTime, findEndTime, HALF_RULES } from './intake-dictionary.js';
import { resolveDates, formatDayMonth, formatFullDate, parseIso, weekdayOf, addDays, WEEKDAY_NAMES } from './intake-dates.js';
//
// שלב 8.3-3: סבב תיקון אחד אחרי "לא נכון" בכרטיס האישור.
//  - 'fix' ("מה לא נכון?"): שלושה כפתורים בלבד, "השעה" / "התאריך" / "לא קורה", בלי "לא יודע" ובלי תיבת כתיבה (כמו כרטיס האישור). נשמר כ-'time' / 'date' / 'cancel'.
//  - 'fix_time' ו-'fix_date': אותו טקסט, אותם כפתורים ואותו פענוח בדיוק כמו 'time' ו-'date' (כולל "לא יודע", תיבת כתיבה, "היום" / "מחר"); רק שם השדה שונה.
//  - formatReply מקבל verb (ברירת מחדל "נרשם"): הבועות "עודכן · ..." ו"בוטל · ..." באותו מבנה בדיוק.
import { UNKNOWN_VALUE, CONFIRM_FIELD, FIX_FIELD, FIX_TIME_FIELD, FIX_DATE_FIELD, isTimedType, readLessonNumbers, validRangeEnd, unknownEndAllDay, FIX_END_DATE_FIELD, FIX_END_TIME_FIELD } from './intake-facts.js';

export const UNKNOWN_BUTTON = 'לא יודע';
// התשובות הקבועות לקיצור: 03-messaging-rules.md:267 ("התקבל") ו-269 ("כבר קיבלתי").
export const RECEIVED_REPLY = 'התקבל';
export const DUPLICATE_REPLY = 'כבר קיבלתי';

// סוג -> תווית בעברית בתשובת "נרשם". 35, שלב 8.2.
export const TYPE_LABELS = Object.freeze({
  homework: 'שיעורי בית',
  exam: 'מבחן',
  cancel: 'ביטול',
  room: 'חדר',
  move: 'הזזה',
  short_day: 'יום מקוצר',
  early_leave: 'יציאה מוקדמת',
  personal_event: 'אירוע אישי',
});

// type ("מה זה?"): שאלת הסוג להודעה מוקלדת שהקוד לא הבין (שלב 8.2א-1; docs/08-chapter8/47 "מה נכנס" סעיף 7 ותרחיש ג; 35 D10).
// הכפתורים: תוויות הסוגים בסדר TYPE_LABELS ו"לא יודע" אחרון. השדה type הוא שם עובדת הסוג (TYPE_FIELD ב-lib/intake-process.js).
const QUESTION_TEXT = Object.freeze({
  subject: 'איזה מקצוע?',
  topic: 'על איזה נושא?',
  date: 'לאיזה תאריך?',
  lesson: 'איזה שיעור?',
  new_room: 'לאיזה חדר?',
  new_date: 'מה המועד החדש?',
  end_date: 'עד איזה תאריך?', // אירוע אישי של כמה ימים (24.11.2026): הסוף לא נקרא או לא תקין
  time: 'באיזו שעה?',
  type: 'מה זה?',
  // confirm: הטקסט נבנה בכל קריאה מהעובדות (confirmText); זו רק הכותרת כשאין עובדות.
  confirm: 'נכון?',
  fix: 'מה לא נכון?',
  fix_time: 'באיזו שעה?',
  fix_date: 'לאיזה תאריך?',
  fix_end_date: 'עד איזה תאריך?',
  fix_end_time: 'כמה זמן?',
});

export const CONFIRM_YES = 'נכון';
export const CONFIRM_NO = 'לא נכון';
// שלב 8.3-3: ערך שנשמר -> תווית הכפתור בשאלת "מה לא נכון?" (הסדר הוא סדר הכפתורים).
export const FIX_BUTTONS = Object.freeze({ time: 'השעה', date: 'התאריך', cancel: 'לא קורה' });
// אירוע של כמה ימים: אין "השעה" (כל היום); "תאריך ההתחלה" מזיז את כל הטווח, "תאריך הסיום" משנה רק את הסוף.
export const FIX_BUTTONS_MULTI = Object.freeze({ date: 'תאריך ההתחלה', end: 'תאריך הסיום', cancel: 'לא קורה' });
const isMultiDay = (facts) => validRangeEnd(valueOfFact(facts, 'date'), valueOfFact(facts, 'end_date')) !== null;
// אירוע ביום אחד עם שעה ושעת סיום (personal_event; ליציאה מוקדמת אין end_time): גם "כמה זמן" (יובל, 25.11.2026).
export const FIX_BUTTONS_TIMED = Object.freeze({ time: 'השעה', length: 'כמה זמן', date: 'התאריך', cancel: 'לא קורה' });
// יום שלם אחד (סוף "לא יודע", בלי שעה; 25.11.2026): בלי "השעה". מעבר מיום שלם לשעות ב-Google היה משאיר צבע ותזכורות של חופשה (patchBody שולח רק זמנים).
export const FIX_BUTTONS_ONE_DAY = Object.freeze({ date: 'התאריך', cancel: 'לא קורה' });
const fixButtonsFor = (facts) => (isMultiDay(facts) ? FIX_BUTTONS_MULTI
  : unknownEndAllDay(valueOfFact(facts, 'end_date'), valueOfFact(facts, 'time')) ? FIX_BUTTONS_ONE_DAY
    : HHMM.test(valueOfFact(facts, 'end_time') ?? '') ? FIX_BUTTONS_TIMED : FIX_BUTTONS);
export const LENGTH_BUTTONS = Object.freeze(['חצי שעה', 'שעה', 'שעה וחצי', 'שעתיים']);

// אורך במילים או בספרות -> דקות, או null. "רבע שעה", "חצי שעה", "שעה", "שעה ורבע", "שעה וחצי", "שעתיים", "שעתיים וחצי", "3 שעות", "שלוש שעות", "45 דקות", "1.5 שעות".
const WORD_HOURS = Object.freeze({ שלוש: 3, ארבע: 4, חמש: 5, שש: 6 });
// מילות מספר בעברית (1-99, זכר ונקבה, עם ו' חיבור) -> ספרות, רק כשאחריהן "דקות/דקה/שעות" (26.11.2026). כך כל הלוגיקה של הספרות חלה גם על מילים.
const NUM_UNITS = Object.freeze({ אחד: 1, אחת: 1, שניים: 2, שנים: 2, שתיים: 2, שתים: 2, שתי: 2, שני: 2, שלושה: 3, שלוש: 3, ארבעה: 4, ארבע: 4, חמישה: 5, חמש: 5, שישה: 6, שש: 6, שבעה: 7, שבע: 7, שמונה: 8, תשעה: 9, תשע: 9 });
const NUM_TENS = Object.freeze({ עשרים: 20, שלושים: 30, ארבעים: 40, חמישים: 50, שישים: 60, שבעים: 70, שמונים: 80, תשעים: 90 });
const isTenWord = (w) => w === 'עשר' || w === 'עשרה';
const bareWord = (tok) => String(tok ?? '').replace(/[.,!?;:"]+$/, '');
function numWord(tok) {
  const w = bareWord(tok);
  for (const cand of [w, w.startsWith('ו') ? w.slice(1) : null]) {
    if (cand === null) continue;
    if (Object.hasOwn(NUM_UNITS, cand)) return { v: NUM_UNITS[cand], kind: 'unit', vav: cand !== w };
    if (Object.hasOwn(NUM_TENS, cand)) return { v: NUM_TENS[cand], kind: 'tens', vav: cand !== w };
    if (isTenWord(cand)) return { v: 10, kind: 'ten', vav: cand !== w };
  }
  return null;
}
function numberAt(tokens, i) {
  const first = numWord(tokens[i]);
  if (!first) return null;
  const next = numWord(tokens[i + 1]);
  if (first.kind === 'unit' && next && next.kind === 'ten' && !next.vav) return { v: first.v + 10, len: 2, vav: first.vav };
  if (first.kind === 'tens' && next && next.kind === 'unit' && next.vav) return { v: first.v + next.v, len: 2, vav: first.vav };
  return { v: first.v, len: 1, vav: first.vav };
}
function numberWordsToDigits(text) {
  const t = text.replace(/שלושת רבעי שעה/g, '45 דקות');
  const tokens = t.split(' ');
  const out = [];
  for (let i = 0; i < tokens.length;) {
    const n = numberAt(tokens, i);
    const after = n ? bareWord(tokens[i + n.len] ?? '') : '';
    if (n && (/^דק(?:ות|ה)$/.test(after) || after === 'שעות')) {
      const lastPunct = /[.,!?;:"]+$/.exec(tokens[i + n.len - 1])?.[0] ?? '';
      out.push(`${n.vav ? 'ו-' : ''}${n.v}${lastPunct}`);
      i += n.len;
    } else { out.push(tokens[i]); i += 1; }
  }
  return out.join(' ');
}
// שעות + דקות יחד: "שעה ו-20 דקות", "2 שעות ו-15 דקות", "שעתיים ו-5 דקות" -> סכום, או null.
const COMPOUND = /(?:(\d{1,2})\s*שעות|(?:^|\s)(שעתיים)|(?:^|\s)שעה(?: אחת)?)\s+ו-?(\d{1,3})\s*דק(?:ות|ה|')?/;
function compoundMinutes(t) {
  const m = COMPOUND.exec(t);
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 60 : m[2] ? 120 : 60) + Number(m[3]);
}
const hoursTail = (t, m) => { const rest = t.slice(m.index + m[0].length); return /^ ו-?חצי(?:\s|$|[.,!?])/.test(rest) ? 30 : /^ ו-?רבע(?:\s|$|[.,!?])/.test(rest) ? 15 : 0; };
export function durationMinutes(text) {
  const t = numberWordsToDigits(String(text ?? '').replace(/\s+/g, ' ').trim());
  const sum = compoundMinutes(t);
  if (sum !== null) return sum;
  const minutes = /(\d{1,3})\s*(?:דק(?:ות|ה|')?)/.exec(t);
  if (minutes) return Number(minutes[1]);
  const hours = /(\d{1,2}(?:\.\d)?)\s*שעות/.exec(t);
  if (hours) return Math.round(Number(hours[1]) * 60) + hoursTail(t, hours);
  const words = /(שלוש|ארבע|חמש|שש)\s+שעות/.exec(t);
  if (words) return WORD_HOURS[words[1]] * 60;
  const half = /ו(?:חצי)$/.test(t) ? 30 : /ורבע$/.test(t) ? 15 : 0;
  if (/^(?:כ-?)?דקה(?: אחת)?$/.test(t)) return 1;
  if (/^(?:כ-?)?רבע שעה$/.test(t)) return 15;
  if (/^(?:כ-?)?חצי שעה$/.test(t)) return 30;
  if (/^(?:כ-?)?שעתיים(?: ו(?:חצי|רבע))?$/.test(t)) return 120 + half;
  if (/^(?:כ-?)?שעה(?: אחת)?(?: ו(?:חצי|רבע))?$/.test(t)) return 60 + half;
  return null;
}
// אורך בתוך משפט ("השיננית זה חצי שעה", "לוקח שעה וחצי", "45 דקות"), או null. "שעה" לבד רק אחרי מילת אורך (זה, לוקח, נמשך, למשך, בערך),
// כדי ש"בשעה 12:30" או "יש לי שעה פנויה" לא ייקראו כאורך. שינוי אורך של אירוע קיים (25.11.2026, lib/event-match.js readChange).
export function findDuration(text) {
  const raw = numberWordsToDigits(String(text ?? '').replace(/\s+/g, ' ').trim());
  // זמן יחסי, לא אורך: "עוד חצי שעה", "בעוד שעה", "תוך רבע שעה", "לפני/אחרי שעה"; ו"שעה פנויה" (ממצא הבודק, 25.11.2026).
  const t = raw.replace(/(?:^|\s)(?:ב?עוד|תוך|לפני|אחרי)\s+(?:כ-?)?(?:\d{1,3}\s*(?:דקות|דקה)|\d{1,2}(?:\.\d)?\s*שעות|רבע שעה|חצי שעה|שעתיים|שעה)(?: ו(?:חצי|רבע))?/g, ' ').replace(/(?:רבע שעה|חצי שעה|שעתיים|שעה)\s+פנוי(?:ה|ות)?/g, ' ');
  const sum = compoundMinutes(t);
  if (sum !== null) return sum;
  const minutes = /(\d{1,3})\s*דקות/.exec(t);
  if (minutes) return Number(minutes[1]);
  const hours = /(\d{1,2}(?:\.\d)?)\s*שעות/.exec(t);
  if (hours) return Math.round(Number(hours[1]) * 60) + hoursTail(t, hours);
  const words = /(?:^|\s)(שלוש|ארבע|חמש|שש)\s+שעות/.exec(t);
  if (words) return WORD_HOURS[words[1]] * 60;
  const oneMin = /(?:^|\s)(?:זה|זו|לוקח|לוקחת|נמשך|נמשכת|למשך|בערך|רק|של)\s+(?:כ-?)?דקה(?:\s|$|[.,!?])/.test(t);
  if (oneMin) return 1;
  const tail = (m) => (/^ ?ו?חצי/.test(m ?? '') ? 30 : /^ ?ו?רבע/.test(m ?? '') ? 15 : 0);
  if (/(?:^|\s)רבע שעה(?:\s|$|[.,!?])/.test(t)) return 15;
  if (/(?:^|\s)חצי שעה(?:\s|$|[.,!?])/.test(t)) return 30;
  const two = /(?:^|\s)שעתיים( ו(?:חצי|רבע))?(?:\s|$|[.,!?])/.exec(t);
  if (two) return 120 + tail(two[1]?.trim());
  const one = /(?:^|\s)(?:זה|זו|לוקח|לוקחת|נמשך|נמשכת|למשך|בערך|רק|של)\s+(?:כ-?)?שעה( ו(?:חצי|רבע))?(?:\s|$|[.,!?])/.exec(t);
  if (one) return 60 + tail(one[1]?.trim());
  return null;
}
const minutesOfClock = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const clockOfMinutes = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// שעת סוף מטקסט: "עד 13:00", "12:30-13:00" (המספר השני), או null.
function endClockIn(text) {
  const { tokens } = tokenize(text);
  const viaUntil = findEndTime(tokens.map((token) => token.w));
  if (viaUntil) return viaUntil;
  const dash = /\d{1,2}:\d{2}\s*[-–]\s*(\d{1,2})(?::(\d{2}))?/.exec(text);
  if (!dash || Number(dash[1]) > 23) return null;
  return `${dash[1].padStart(2, '0')}:${dash[2] ?? '00'}`;
}
// שעת הסיום מתשובת "כמה זמן?": אורך (מההתחלה בפועל), "עד HH:MM", או שעה לבד. חייבת להיות אחרי ההתחלה ובאותו יום. אחרת null.
function readEndAnswer(text, start) {
  if (!HHMM.test(start ?? '')) return null;
  const length = durationMinutes(text);
  let end = null;
  if (length !== null && length > 0) end = minutesOfClock(start) + length <= 23 * 60 + 59 ? clockOfMinutes(minutesOfClock(start) + length) : null;
  else {
    const { tokens } = tokenize(text);
    const words = tokens.map((token) => token.w);
    end = endClockIn(text) ?? findClockTime(words, { tokens, clean: text });
  }
  return end && HHMM.test(end) && end > start ? end : null;
}
// שדה התיקון -> השדה שאת השאלה והפענוח שלו הוא משתמש.
const FIX_AS = Object.freeze({ [FIX_TIME_FIELD]: 'time', [FIX_DATE_FIELD]: 'date', [FIX_END_DATE_FIELD]: 'end_date' });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// תווית שתי הקריאות של שעה במילים: הקריאה הראשונה (00 עד 11) "בבוקר", או "בלילה" לשעה 00; השנייה (12 עד 23) "בערב", או "בצהריים" לשעה 12.
const halfLabel = (hhmm) => (hhmm.startsWith('00') ? 'בלילה' : hhmm.startsWith('12') ? 'בצהריים' : Number(hhmm.slice(0, 2)) < 12 ? 'בבוקר' : 'בערב');
const unique = (list) => [...new Set(list)];

const slotsOnDate = (timetable, iso) => {
  if (!Array.isArray(timetable?.slots) || typeof iso !== 'string' || !ISO_DATE.test(iso)) return [];
  const weekday = weekdayOf(iso) + 1; // במערכת השעות 1 = ראשון
  return timetable.slots.filter((slot) => slot.weekday === weekday).sort((a, b) => a.period - b.period);
};

const validIsoDate = (value) => {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  try {
    parseIso(value);
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
};

const dateLabel = (iso) => `${WEEKDAY_NAMES[weekdayOf(iso)]} ${formatFullDate(iso)}`;

const hasSlots = (timetable) => Array.isArray(timetable?.slots) && timetable.slots.length > 0;
const valueOfFact = (facts, field) => (Array.isArray(facts) ? facts.find((fact) => fact?.field === field)?.value : undefined);
const knownValue = (facts, field) => {
  const value = valueOfFact(facts, field);
  return typeof value === 'string' && value !== '' && value !== UNKNOWN_VALUE ? value : null;
};
// "היום" / "מחר" לפי today (YYYY-MM-DD, יום ההודעה בישראל), אחרת "שלישי 20.10".
function dayWords(iso, today) {
  if (validIsoDate(today) && validIsoDate(iso)) {
    if (iso === today) return 'היום';
    if (iso === addDays(today, 1)) return 'מחר';
  }
  return validIsoDate(iso) ? `${WEEKDAY_NAMES[weekdayOf(iso)]} ${formatDayMonth(iso)}` : null;
}

// כרטיס האישור (שלב 8.3-1), נגזר מהעובדות השמורות (שדות date, time, end_time, topic, lesson).
//  early_leave: "יוצא ב-13:15, מפספס שיעורים 6, 7, 8, 9. נכון?" · יום עם שיעורים ויציאה אחריהם: "יוצא ב-13:15, לא מפספס שיעורים. נכון?" · יום בלי שיעורים (שישי): "..., אין לימודים באותו יום. נכון?" · בלי מערכת שעות: "יוצא ב-13:15. נכון?"
//  personal_event: "בדיקה רפואית, היום 16:00 עד 17:00. נכון?" · כמה ימים: "חופשה בווינה, 30.11–3.12, כל היום. נכון?"
function confirmText({ type, facts, timetable, today }) {
  const date = knownValue(facts, 'date');
  const time = knownValue(facts, 'time');
  const day = date ? dayWords(date, today) : null;
  if (type === 'personal_event') {
    const title = knownValue(facts, 'topic') ?? TYPE_LABELS.personal_event;
    const lastDay = validRangeEnd(date, knownValue(facts, 'end_date'));
    if (lastDay) return `${title}, ${formatDayMonth(date)}–${formatDayMonth(lastDay)}, כל היום. נכון?`;
    // "לא יודע" בסוף ובלי שעה (25.11.2026): יום שלם אחד
    if (day && unknownEndAllDay(valueOfFact(facts, 'end_date'), time)) return `${title}, ${day}, כל היום. נכון?`;
    const end = knownValue(facts, 'end_time');
    const when = [day, time].filter(Boolean).join(' ');
    // אירוע בשעת שיעור (25.11.2026, הכרעת יובל "ב'"): האירוע מחליף את השיעורים, ונאמר במה: "במקום ערבית".
    const lessons = String(knownValue(facts, 'lesson') ?? '').split(',').map(Number).filter((n) => n >= 1);
    const replaced = date && lessons.length > 0 ? [...new Set(slotsOnDate(timetable, date).filter((slot) => lessons.includes(slot.period)).sort((a, b) => a.period - b.period).map((slot) => slot.subject))] : [];
    const instead = replaced.length > 0 ? `במקום ${replaced.map(subjectLabel).join(' ו')}` : lessons.length > 0 ? `במקום ${lessons.length === 1 ? `שיעור ${lessons[0]}` : `שיעורים ${lessons.join(', ')}`}` : null;
    return `${[title, when ? `${when}${time && end ? ` עד ${end}` : ''}` : null, instead].filter(Boolean).join(', ')}. נכון?`;
  }
  const prefix = day && day !== 'היום' ? `${day} ` : '';
  const lessons = knownValue(facts, 'lesson');
  const left = `${prefix}יוצא${time ? ` ב-${time}` : ''}`;
  if (lessons) {
    const list = lessons.split(',').filter(Boolean);
    return `${left}, מפספס ${list.length === 1 ? 'שיעור' : 'שיעורים'} ${list.join(', ')}. נכון?`;
  }
  if (hasSlots(timetable) && time && date) {
    // יש מערכת שעות: ביום בלי שיעורים (שישי, שבת) אין לימודים; ביום עם שיעורים והיציאה אחריהם, לא מפספס שיעורים (ביקורת, סעיף 5).
    return slotsOnDate(timetable, date).length === 0 ? `${left}, אין לימודים באותו יום. נכון?` : `${left}, לא מפספס שיעורים. נכון?`;
  }
  return `${left}. נכון?`;
}

// שאלת הבהרה על שדה חסר. תמיד כוללת כפתור "לא יודע" (אחרון). type מתקבל לפי החוזה, ואינו משנה את הניסוח.
// חריג (שלב 8.3-1): field='confirm' (כרטיס האישור): type חובה (early_leave או personal_event), facts = עובדות המקור, כפתורים "נכון" ו"לא נכון" בלבד, בלי "לא יודע" ובלי תיבת כתיבה.
// candidates: מועמדים מ-extractFacts (ambiguous): מקצועות כטקסט, שיעורים כמספר, תאריכים כ-YYYY-MM-DD, שעות כ-HH:MM (שעה במילים עמומה: שתי קריאות, בוקר קודם). date: תאריך האירוע (YYYY-MM-DD) לכפתורי מערכת השעות.
// today (אופציונלי, רק בשאלת 'date'): תאריך ההודעה בישראל (YYYY-MM-DD); מוסיף כפתורי "היום" ו"מחר". בלעדיו או כשאינו תקין: ההתנהגות הישנה.
export function buildQuestion({ field, type, candidates, timetable, date, today, facts } = {}) {
  if (!Object.hasOwn(QUESTION_TEXT, field)) throw new RangeError(`buildQuestion: שדה לא נתמך: ${field}`);
  if (field === CONFIRM_FIELD) {
    if (!isTimedType(type)) throw new RangeError(`buildQuestion: כרטיס אישור רק ליציאה מוקדמת או לאירוע אישי: ${type}`);
    return { field, text: confirmText({ type, facts, timetable, today }), buttons: [CONFIRM_YES, CONFIRM_NO], allowFreeText: false };
  }
  if (field === FIX_FIELD) return { field, text: QUESTION_TEXT.fix, buttons: Object.values(fixButtonsFor(facts)), allowFreeText: false };
  if (field === FIX_END_TIME_FIELD) return { field, text: QUESTION_TEXT.fix_end_time, buttons: [...LENGTH_BUTTONS, UNKNOWN_BUTTON], allowFreeText: true };
  if (Object.hasOwn(FIX_AS, field)) return { ...buildQuestion({ field: FIX_AS[field], type, candidates, timetable, date, today, facts }), field };
  const given = Array.isArray(candidates) ? candidates.map(String).filter((c) => c !== '') : [];
  const day = slotsOnDate(timetable, date);
  let buttons = [];

  if (field === 'time' && given.length === 2 && given.every((candidate) => HHMM.test(candidate))) {
    // שעה במילים עמומה: "בבוקר או בערב?" (או "בלילה או בצהריים?" לשתים עשרה). שתי הקריאות, בוקר קודם.
    const [morning, evening] = given.map((candidate) => ({ time: candidate, label: halfLabel(candidate) }));
    return {
      field,
      text: `${morning.label} או ${evening.label}?`,
      buttons: [`${morning.label} · ${morning.time}`, `${evening.label} · ${evening.time}`, UNKNOWN_BUTTON],
      allowFreeText: true,
    };
  }
  if (field === 'subject') {
    buttons = given.length > 0 ? given : day.map((slot) => slot.subject);
  } else if (field === 'lesson') {
    if (given.length > 0) {
      buttons = given.map((candidate) => {
        if (!/^\d+$/.test(candidate)) return candidate;
        const slot = day.find((s) => String(s.period) === candidate);
        return slot ? `שיעור ${candidate} · ${slot.subject}` : `שיעור ${candidate}`;
      });
      // ביטול של כמה שיעורים באותו מקצוע: כפתור אחד לכולם ("שיעורים 7,8,9 מבוטלים" לא נשבר לשלוש בחירות). התשובה נקראת ב-parseAnswer כמו "5, 6".
      if (type === 'cancel' && given.length > 1 && given.every((candidate) => /^\d+$/.test(candidate))) buttons.unshift(`כל השיעורים · ${given.join(', ')}`);
    } else {
      buttons = day.map((slot) => `שיעור ${slot.period} · ${slot.subject}`);
    }
  } else if (field === 'date' || field === 'new_date' || field === 'end_date') {
    buttons = given.map((candidate) => (ISO_DATE.test(candidate) ? dateLabel(candidate) : candidate));
    if (field === 'date' && validIsoDate(today)) {
      // כפתורי היום ומחר (יום ההודעה בישראל), ראשונים; מועמד שזהה להם לא מופיע פעמיים. התווית נושאת תאריך מלא, כדי שתיפענח נכון גם אם נענתה ביום אחר.
      const tomorrow = addDays(today, 1); // חשבון ימי לוח על תאריך, לא 24 שעות: בטוח בסוף חודש, סוף שנה ושינוי שעון
      const quick = [`היום · ${dateLabel(today)}`, `מחר · ${dateLabel(tomorrow)}`];
      buttons = [...quick, ...buttons.filter((label) => label !== dateLabel(today) && label !== dateLabel(tomorrow))];
    }
  } else if (field === 'type') {
    buttons = Object.values(TYPE_LABELS); // שיעורי בית, מבחן, ביטול, חדר, הזזה, יום מקוצר (47, תרחיש ג)
  }
  // topic, new_room: חופשי בלבד (יחד עם "לא יודע")

  return {
    field,
    text: QUESTION_TEXT[field],
    buttons: [...unique(buttons).filter((label) => label !== UNKNOWN_BUTTON), UNKNOWN_BUTTON],
    allowFreeText: true,
  };
}

const normalized = (text) => tokenize(String(text ?? '')).tokens.map((token) => token.w).join(' ');

// תשובה לשאלת "מה זה?": מפתח הסוג (exam, cancel...), 'unknown' על "לא יודע", או null כשאי אפשר לפענח.
// ההשוואה לתווית אחרי הנרמול של tokenize (בלי פיסוק ורווחים כפולים, אותיות סופיות מנורמלות). [הנחה, לא אומת] רק תווית מלאה מתקבלת:
// "זה מבחן" או "exam" אינם מפוענחים, והשאלה נשארת פתוחה (47 "מה נכנס" סעיף 11: "לא הבנתי. נסה שוב או בחר 'לא יודע'").
export function parseTypeAnswer(answer) {
  const text = String(answer ?? '').replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  const words = normalized(text);
  if (words === fin('לא יודע') || text.toLowerCase() === UNKNOWN_VALUE) return UNKNOWN_VALUE;
  const match = Object.entries(TYPE_LABELS).find(([, label]) => normalized(label) === words);
  return match ? match[0] : null;
}

// מילה בודדת שבוחרת בין שתי קריאות של שעה במילים: בבוקר / בלילה (הקריאה הלילית 00 עד 05, אחרת הערבית) / בצהריים / אחה"צ / בערב. null: לא מילת הכרעה, או אין זוג מועמדים.
const MORNING_ANSWER = /^ב?בוקר$/;
const NIGHT_ANSWER = /^ב?לילה$/;
// [הנחה, לא אומת] המילה חייבת להתאים לשעה (אותן HALF_RULES של הזיהוי), חוץ מ"בערב" שמתאים גם ל-4 (הכפתור שהוצע הוא "בערב · 16:00"). לא מתאימה = לא מפוענח, והשאלה נשארת.
const ANSWER_RULES = { ...HALF_RULES, evening: (hour) => (hour >= 4 && hour <= 11 ? 'pm' : null) };
function halfFromWord(answerWords, candidates) {
  if (!Array.isArray(candidates) || candidates.length !== 2 || !candidates.every((candidate) => HHMM.test(candidate)) || answerWords.length < 1 || answerWords.length > 2) return null;
  const [morning, evening] = candidates;
  const hour = Number(morning.slice(0, 2)) || 12;
  let kind = null;
  if (answerWords.length === 2) kind = /^(?:אחרי|אחר)$/.test(answerWords[0]) && /^ה?צהר(?:יי|י)מ$/.test(answerWords[1]) ? 'afternoon' : null;
  else if (MORNING_ANSWER.test(answerWords[0])) kind = 'morning';
  else if (NIGHT_ANSWER.test(answerWords[0])) kind = 'night';
  else if (/^ב?ערב$/.test(answerWords[0])) kind = 'evening';
  else if (/^ב?ה?צהר(?:יי|י)מ$/.test(answerWords[0])) kind = 'noon';
  else if (answerWords[0] === 'אחהצ') kind = 'afternoon';
  const half = kind ? ANSWER_RULES[kind](hour) : null;
  return half === 'am' ? morning : half === 'pm' ? evening : null;
}

// הופך תשובה (טקסט כפתור או טקסט חופשי) לערך שנשמר, או null אם אי אפשר לפענח.
function parseAnswer(field, text, { receivedAt, timezone, candidates, facts }) {
  if (field === 'type') return parseTypeAnswer(text);
  if (field === CONFIRM_FIELD) {
    // רק שתי התשובות, ו"לא יודע" אינו אחת מהן: בלי זה היה נשמר 'unknown' ומאבד את משמעות האישור.
    const answerWords = normalized(text);
    if (answerWords === fin(CONFIRM_YES)) return 'yes';
    return answerWords === fin(CONFIRM_NO) ? 'no' : null;
  }
  if (field === FIX_FIELD) {
    // רק אחת משלוש התוויות; "לא יודע" ושאר הטקסט = לא מפוענח, והשאלה נשארת פתוחה.
    const answerWords = normalized(text);
    const match = Object.entries(fixButtonsFor(facts)).find(([, label]) => normalized(label) === answerWords);
    return match ? match[0] : null;
  }
  if (Object.hasOwn(FIX_AS, field)) return parseAnswer(FIX_AS[field], text, { receivedAt, timezone, candidates, facts });
  if (field === FIX_END_TIME_FIELD) {
    if (normalized(text) === fin('לא יודע')) return UNKNOWN_VALUE;
    return readEndAnswer(text, valueOfFact(facts, FIX_TIME_FIELD) ?? valueOfFact(facts, 'time'));
  }
  const words = normalized(text);
  if (words === fin('לא יודע') || text.toLowerCase() === UNKNOWN_VALUE) return UNKNOWN_VALUE;

  if (field === 'date' || field === 'new_date' || field === 'end_date') {
    if (ISO_DATE.test(text)) {
      parseIso(text); // זורק RangeError על תאריך שלא קיים; נתפס למטה
      return text;
    }
    const full = /(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(text); // תווית כפתור: "שלישי 13.10.2026"
    if (full) {
      const iso = `${full[3]}-${full[2].padStart(2, '0')}-${full[1].padStart(2, '0')}`;
      parseIso(iso);
      return iso;
    }
    if (receivedAt === undefined) return null; // בלי חותמת קליטה אי אפשר לפענח תאריך יחסי או בלי שנה
    const mentions = resolveDates(text, receivedAt, { timezone });
    return mentions.length > 0 && !mentions[0].ambiguous ? mentions[0].date : null;
  }
  if (field === 'time') {
    // "13:15", "ב-13:15", "ב-13", "בשעה 13", או מספר חשוף "13" (תשובה לשאלה "באיזו שעה?"). לא תקין = null.
    // גם תווית כפתור של שעה במילים ("בערב · 16:00"), שעה במילים עם מילת הכרעה ("בשמונה בערב"), ומילת הכרעה בלבד כשיש מועמדים ("בערב" מול 04:00 ו-16:00).
    const answerTokens = tokenize(text);
    const answerWords = answerTokens.tokens.map((token) => token.w);
    const hour = answerWords.length === 1 && /^\d{1,2}$/.test(answerWords[0]) && Number(answerWords[0]) <= 23 ? `${answerWords[0].padStart(2, '0')}:00` : null;
    return findClockTime(answerWords, answerTokens) ?? hour ?? halfFromWord(answerWords, candidates);
  }
  if (field === 'lesson') {
    const periods = readLessonNumbers(text); // כולל הרחבת טווחים: "שיעורים 1-3" = 1,2,3 (ביקורת 12.10, סעיף 11)
    return periods.length > 0 ? periods.join(',') : null;
  }
  if (field === 'subject') {
    const hits = findSubjects(text);
    return hits.length > 0 ? hits[0].subject : text;
  }
  if (field === 'new_room') {
    const digits = /\d{1,4}/.exec(text);
    return digits ? digits[0] : text;
  }
  return text;
}

// מחזיר עובדות מעודכנות (מערך חדש; לא משנה את הקלט). השדה נשמר עם origin 'read' ו-extracted_by 'script'. "לא יודע" נשמר כ-'unknown'.
// receivedAt (אופציונלי): נחוץ רק לתשובת תאריך חופשית יחסית ("מחר", "12.10"); תווית כפתור תאריך מלאה לא צריכה אותו.
// candidates (אופציונלי, רק לשאלת time): שתי הקריאות של שעה במילים עמומה, כדי שמילה בלבד ("בערב") תפוענח.
export function applyAnswer({ facts, field, answer, receivedAt, timezone, candidates } = {}) {
  if (!Array.isArray(facts)) throw new TypeError('applyAnswer: facts חייב להיות מערך');
  if (typeof field !== 'string' || field === '') throw new TypeError('applyAnswer: field חייב להיות טקסט');
  const text = String(answer ?? '').replace(/\s+/g, ' ').trim();
  if (text === '') return facts.map((fact) => ({ ...fact }));

  let value;
  try {
    value = parseAnswer(field, text, { receivedAt, timezone, candidates, facts });
  } catch (error) {
    if (error instanceof RangeError) return facts.map((fact) => ({ ...fact })); // תאריך שלא קיים
    throw error;
  }
  if (value === null) return facts.map((fact) => ({ ...fact }));

  const next = facts.map((fact) => ({ ...fact }));
  const put = (f, v) => {
    const row = { field: f, value: String(v), origin: 'read', extracted_by: 'script' };
    const existing = next.findIndex((fact) => fact.field === f);
    if (existing === -1) next.push(row);
    else next[existing] = row;
  };
  put(field, value);
  // תיקון "השעה" עם סוף ("12:30 עד 13:00", "12:30-13:00"; יובל, 25.11.2026): גם שעת הסיום נשמרת, אם היא אחרי ההתחלה החדשה.
  if (field === FIX_TIME_FIELD && HHMM.test(String(value))) {
    const end = endClockIn(text);
    if (end && HHMM.test(end) && end > String(value)) put(FIX_END_TIME_FIELD, end);
  }
  return next;
}

// דפוס לרישום ב-candidate_rules (06-db-schema.md; 35 סעיף 3.8.0): pattern = שורשי מילים בלבד (טקסט, מופרדים ברווח), בלי טקסט ההודעה ובלי שמות.
// evidence = לאיזה סוג ושדה התשובה שייכת. מחזיר null כשאין שורשים (אין דפוס לרשום).
// [הנחה, לא אומת] הפונקציה לא יכולה לזהות שמות אנשים בתוך rootsThatFellThrough. שורשים צריכים להגיע מ-fellThroughRoots (lib/intake-dictionary.js)
// ורק על טקסט שיובל הקליד בעצמו. אותיות עבריות בלבד (ספרות, טלפונים ולטינית נזרקים), 2 עד 12 אותיות, עד 8 שורשים.
const MAX_ROOTS = 8;
export function answerPattern({ type, field, rootsThatFellThrough } = {}) {
  if (!Object.hasOwn(TYPE_LABELS, type)) throw new RangeError(`answerPattern: סוג לא מוכר: ${type}`);
  if (typeof field !== 'string' || field === '') throw new TypeError('answerPattern: field חייב להיות טקסט');
  const roots = unique(
    (Array.isArray(rootsThatFellThrough) ? rootsThatFellThrough : [])
      .map((root) => fin(String(root)).replace(/[^א-ת]/g, ''))
      .filter((root) => root.length >= 2 && root.length <= 12 && !isFunctionWord(root))
      .map(unfin),
  ).slice(0, MAX_ROOTS);
  if (roots.length === 0) return null;
  return { pattern: roots.join(' '), evidence: { type, field, roots } };
}

function weekdayNameFor(weekday, date) {
  if (typeof weekday === 'string') {
    const name = weekday.replace(/^\s*יום\s+/, '').trim();
    if (WEEKDAY_NAMES.includes(name)) return name;
  }
  if (Number.isInteger(weekday) && weekday >= 1 && weekday <= 7) return WEEKDAY_NAMES[weekday - 1]; // 1 = ראשון, כמו במערכת השעות
  return WEEKDAY_NAMES[weekdayOf(date)];
}

// "נרשם · בוחן במתמטיקה · שלישי 6.10": תמיד תאריך מלא (יום.חודש) ויום בשבוע, כדי שטעות ב"מחר" תהיה גלויה (03-intake-rules.md:60).
// weekday: שם יום ("שלישי"), או 1 עד 7 (1 = ראשון). בלעדיו או כשאינו תקין: מחושב מהתאריך. ליום מקוצר וליציאה מוקדמת אין מקצוע.
// אירוע אישי (שלב 8.3-1): הכותרת (title, למשל "בדיקה רפואית") באה במקום המקצוע: "נרשם · אירוע אישי · בדיקה רפואית · שני 19.10".
// verb (שלב 8.3-3): המילה הראשונה. "עודכן" אחרי תיקון שעה או תאריך, "בוטל" אחרי "לא קורה". ברירת מחדל: "נרשם".
const REPLY_VERBS = Object.freeze(['נרשם', 'עודכן', 'בוטל']);
// endDate (אופציונלי, אירוע אישי של כמה ימים): היום האחרון; הטווח במקום היום בשבוע: "נרשם · אירוע אישי · חופשה בווינה · 30.11–3.12". לא תקין: כמו יום אחד.
export function formatReply({ type, subject, title, lesson, date, weekday, verb = 'נרשם', endDate } = {}) {
  if (!Object.hasOwn(TYPE_LABELS, type)) throw new RangeError(`formatReply: סוג לא מוכר: ${type}`);
  if (!REPLY_VERBS.includes(verb)) throw new RangeError(`formatReply: פועל לא מוכר: ${verb}`);
  parseIso(date); // זורק RangeError על תאריך חסר או לא תקין
  const parts = [verb, TYPE_LABELS[type]];
  const readable = (value) => typeof value === 'string' && value.trim() !== '' && value !== UNKNOWN_VALUE;
  if (type === 'personal_event') {
    if (readable(title)) parts.push(title.trim());
  } else if (type !== 'short_day' && type !== 'early_leave' && readable(subject)) {
    parts.push(subjectLabel(subject.trim()));
  }
  // ביטול: אילו שיעורים בוטלו, כדי שיובל יראה אם נקלטו כולם ("שיעורים 7, 8, 9"), לא רק המקצוע
  if (type === 'cancel' && readable(lesson)) {
    const periods = String(lesson).split(',').map((period) => period.trim()).filter(Boolean);
    if (periods.length > 0) parts.push(`${periods.length > 1 ? 'שיעורים' : 'שיעור'} ${periods.join(', ')}`);
  }
  const lastDay = type === 'personal_event' ? validRangeEnd(date, endDate) : null;
  parts.push(lastDay ? `${formatDayMonth(date)}–${formatDayMonth(lastDay)}` : `${weekdayNameFor(weekday, date)} ${formatDayMonth(date)}`);
  return parts.join(' · ');
}
