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
import { tokenize, fin, unfin } from './intake-text.js';
import { findSubjects, isFunctionWord } from './intake-dictionary.js';
import { resolveDates, formatDayMonth, formatFullDate, parseIso, weekdayOf, WEEKDAY_NAMES } from './intake-dates.js';
import { UNKNOWN_VALUE, readLessonNumbers } from './intake-facts.js';

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
  type: 'מה זה?',
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const unique = (list) => [...new Set(list)];

const slotsOnDate = (timetable, iso) => {
  if (!Array.isArray(timetable?.slots) || typeof iso !== 'string' || !ISO_DATE.test(iso)) return [];
  const weekday = weekdayOf(iso) + 1; // במערכת השעות 1 = ראשון
  return timetable.slots.filter((slot) => slot.weekday === weekday).sort((a, b) => a.period - b.period);
};

const dateLabel = (iso) => `${WEEKDAY_NAMES[weekdayOf(iso)]} ${formatFullDate(iso)}`;

// שאלת הבהרה על שדה חסר. תמיד כוללת כפתור "לא יודע" (אחרון). type מתקבל לפי החוזה, ואינו משנה את הניסוח.
// candidates: מועמדים מ-extractFacts (ambiguous): מקצועות כטקסט, שיעורים כמספר, תאריכים כ-YYYY-MM-DD. date: תאריך היום (YYYY-MM-DD) לכפתורי מערכת השעות.
export function buildQuestion({ field, type, candidates, timetable, date } = {}) {
  if (!Object.hasOwn(QUESTION_TEXT, field)) throw new RangeError(`buildQuestion: שדה לא נתמך: ${field}`);
  const given = Array.isArray(candidates) ? candidates.map(String).filter((c) => c !== '') : [];
  const day = slotsOnDate(timetable, date);
  let buttons = [];

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

// הופך תשובה (טקסט כפתור או טקסט חופשי) לערך שנשמר, או null אם אי אפשר לפענח.
function parseAnswer(field, text, { receivedAt, timezone }) {
  if (field === 'type') return parseTypeAnswer(text);
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
export function applyAnswer({ facts, field, answer, receivedAt, timezone } = {}) {
  if (!Array.isArray(facts)) throw new TypeError('applyAnswer: facts חייב להיות מערך');
  if (typeof field !== 'string' || field === '') throw new TypeError('applyAnswer: field חייב להיות טקסט');
  const text = String(answer ?? '').replace(/\s+/g, ' ').trim();
  if (text === '') return facts.map((fact) => ({ ...fact }));

  let value;
  try {
    value = parseAnswer(field, text, { receivedAt, timezone });
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
// weekday: שם יום ("שלישי"), או 1 עד 7 (1 = ראשון). בלעדיו או כשאינו תקין: מחושב מהתאריך. ליום מקוצר אין מקצוע.
export function formatReply({ type, subject, date, weekday } = {}) {
  if (!Object.hasOwn(TYPE_LABELS, type)) throw new RangeError(`formatReply: סוג לא מוכר: ${type}`);
  parseIso(date); // זורק RangeError על תאריך חסר או לא תקין
  const parts = ['נרשם', TYPE_LABELS[type]];
  if (type !== 'short_day' && typeof subject === 'string' && subject.trim() !== '' && subject !== UNKNOWN_VALUE) parts.push(subject.trim());
  parts.push(`${weekdayNameFor(weekday, date)} ${formatDayMonth(date)}`);
  return parts.join(' · ');
}
