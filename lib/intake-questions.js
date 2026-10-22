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
//  - תשובה: "נכון" = 'yes', "לא נכון" = 'no', כל דבר אחר (גם "לא יודע") = לא מפוענח והשאלה נשארת פתוחה. "לא נכון" לא עושה דבר נוסף (שלב 8.3-3).
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
import { findSubjects, isFunctionWord, findClockTime } from './intake-dictionary.js';
import { resolveDates, formatDayMonth, formatFullDate, parseIso, weekdayOf, addDays, WEEKDAY_NAMES } from './intake-dates.js';
import { UNKNOWN_VALUE, CONFIRM_FIELD, isTimedType, readLessonNumbers } from './intake-facts.js';

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
  time: 'באיזו שעה?',
  type: 'מה זה?',
  // confirm: הטקסט נבנה בכל קריאה מהעובדות (confirmText); זו רק הכותרת כשאין עובדות.
  confirm: 'נכון?',
});

export const CONFIRM_YES = 'נכון';
export const CONFIRM_NO = 'לא נכון';

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
//  personal_event: "בדיקה רפואית, היום 16:00 עד 17:00. נכון?"
function confirmText({ type, facts, timetable, today }) {
  const date = knownValue(facts, 'date');
  const time = knownValue(facts, 'time');
  const day = date ? dayWords(date, today) : null;
  if (type === 'personal_event') {
    const title = knownValue(facts, 'topic') ?? TYPE_LABELS.personal_event;
    const end = knownValue(facts, 'end_time');
    const when = [day, time].filter(Boolean).join(' ');
    return `${[title, when ? `${when}${time && end ? ` עד ${end}` : ''}` : null].filter(Boolean).join(', ')}. נכון?`;
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
    } else {
      buttons = day.map((slot) => `שיעור ${slot.period} · ${slot.subject}`);
    }
  } else if (field === 'date' || field === 'new_date') {
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
const PM_ANSWER = /^(?:ב?ערב|ב?ה?צהר(?:יי|י)מ|אחהצ)$/;
function halfFromWord(answerWords, candidates) {
  if (!Array.isArray(candidates) || candidates.length !== 2 || !candidates.every((candidate) => HHMM.test(candidate)) || answerWords.length < 1 || answerWords.length > 2) return null;
  const [morning, evening] = candidates;
  if (answerWords.length === 2) return /^(?:אחרי|אחר)$/.test(answerWords[0]) && /^ה?צהר(?:יי|י)מ$/.test(answerWords[1]) ? evening : null; // אחרי הצהריים
  const word = answerWords[0];
  if (MORNING_ANSWER.test(word)) return morning.startsWith('00') ? null : morning; // 00:xx אינו בוקר
  if (PM_ANSWER.test(word)) return evening;
  if (NIGHT_ANSWER.test(word)) return Number(morning.slice(0, 2)) <= 5 ? morning : evening;
  return null;
}

// הופך תשובה (טקסט כפתור או טקסט חופשי) לערך שנשמר, או null אם אי אפשר לפענח.
function parseAnswer(field, text, { receivedAt, timezone, candidates }) {
  if (field === 'type') return parseTypeAnswer(text);
  if (field === CONFIRM_FIELD) {
    // רק שתי התשובות, ו"לא יודע" אינו אחת מהן: בלי זה היה נשמר 'unknown' ומאבד את משמעות האישור.
    const answerWords = normalized(text);
    if (answerWords === fin(CONFIRM_YES)) return 'yes';
    return answerWords === fin(CONFIRM_NO) ? 'no' : null;
  }
  const words = normalized(text);
  if (words === fin('לא יודע') || text.toLowerCase() === UNKNOWN_VALUE) return UNKNOWN_VALUE;

  if (field === 'date' || field === 'new_date') {
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
    const answerWords = tokenize(text).tokens.map((token) => token.w);
    const hour = answerWords.length === 1 && /^\d{1,2}$/.test(answerWords[0]) && Number(answerWords[0]) <= 23 ? `${answerWords[0].padStart(2, '0')}:00` : null;
    return findClockTime(answerWords) ?? hour ?? halfFromWord(answerWords, candidates);
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
    value = parseAnswer(field, text, { receivedAt, timezone, candidates });
  } catch (error) {
    if (error instanceof RangeError) return facts.map((fact) => ({ ...fact })); // תאריך שלא קיים
    throw error;
  }
  if (value === null) return facts.map((fact) => ({ ...fact }));

  const updated = { field, value: String(value), origin: 'read', extracted_by: 'script' };
  const existing = facts.findIndex((fact) => fact.field === field);
  const next = facts.map((fact) => ({ ...fact }));
  if (existing === -1) next.push(updated);
  else next[existing] = updated;
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
export function formatReply({ type, subject, title, date, weekday } = {}) {
  if (!Object.hasOwn(TYPE_LABELS, type)) throw new RangeError(`formatReply: סוג לא מוכר: ${type}`);
  parseIso(date); // זורק RangeError על תאריך חסר או לא תקין
  const parts = ['נרשם', TYPE_LABELS[type]];
  const readable = (value) => typeof value === 'string' && value.trim() !== '' && value !== UNKNOWN_VALUE;
  if (type === 'personal_event') {
    if (readable(title)) parts.push(title.trim());
  } else if (type !== 'short_day' && type !== 'early_leave' && readable(subject)) {
    parts.push(subject.trim());
  }
  parts.push(`${weekdayNameFor(weekday, date)} ${formatDayMonth(date)}`);
  return parts.join(' · ');
}
