// לוז 4fitness: הודעת הלוז מהוואטסאפ (מועברת בקיצור, או מוקלדת) -> אימוני שני ורביעי. קוד בלבד, בלי מודל (בלוק 5 חלק א').
// המפרט המחייב: docs/02-rules/03-4fitness-rules.md ("מה הסקריפט עושה", "טבלת מיקומים", "מה נשאר ל-AI"); הסמכות: docs/02-rules/03-sources-rules.md,
// "4fitness" (וואטסאפ קובע יום, שעת התחלה, מיקום, "מנוחה" ו"כוח").
//
// שתי פונקציות טהורות:
//   parseFitnessSchedule(text)            -> null (לא לוז) או { days: [{ weekday, rest, start, end, locationRaw, strength, fieldsRun }], uncertain: [{ weekday?, reason }] }
//   planFitnessWeek(parsed, receivedAt)   -> [{ weekday, date, rest, run, prep, label, needsAddress }] בתאריכים ישראליים
//
// הזיהוי שמרני בכוונה (03-4fitness, "מה נשאר ל-AI": המוח נקרא רק כשהתבנית נכשלת): לפחות שורת שני או רביעי שמתחילה בשם היום ויש בה שעה או "מנוחה",
// וגם מיקום מהטבלה או המילה "אימון" / "מנוחה" בהודעה. כל השאר: null, והצינור הרגיל (המוח) ממשיך כמו היום.
// הודעת תיקון ("מחר מנוחה", "האימון של רביעי בוטל") לא מתחילה בשם היום ולכן אינה לוז (03-4fitness: "לא מכסה: הודעת תיקון").
// uncertain לא ריק = הקוד לא בטוח (שתי שעות, יום בלי שעה, יום כפול, טווח הפוך). הקורא לא מטפל בקוד אלא מעביר לצינור הרגיל:
// כלל הוודאות (03-permissions-rules.md) מוריד פעולה על חילוץ uncertain לרמת "דורש אישור", ומנגנון האישור לאימונים לא נבנה כאן.
import { localDateIso, addDays, weekdayOf } from './intake-dates.js';

export const FITNESS_TITLE_PREFIX = 'אימון ריצה';
export const PREP_TITLE = 'התארגנות';
const MONDAY = 1; // Date.getUTCDay: 0 = ראשון
const WEDNESDAY = 3;
const RUN_MINUTES = 120; // "שעתיים משעת ההתחלה, תמיד" (יובל, 30.9.2026)
// התארגנות: הטבלה ב-03-4fitness ("כל הריצות בשבוע") קובעת 17:00–17:30 לאימון של 18:00. המימוש: משעה לפני ההתחלה עד חצי שעה לפניה.
// [הנחה, לא אומת] להתחלה שאינה 18:00 (למשל 18:30 -> 17:30–18:00): הטבלה לא אומרת אם ההתארגנות זזה עם האימון.
const PREP_FROM_MINUTES = 60;
const PREP_TO_MINUTES = 30;
const NEEDS_ADDRESS = 'לוודא כתובת';

// טבלת המיקומים (03-4fitness, "טבלת מיקומים"). הסדר חשוב: "חוף הים קריית ים" נבדק לפני "קרית ים".
// label = מה שנכנס לכותרת. [הנחה, לא אומת] הכותרת משתמשת בשם הראשון בשורת הטבלה ולא במה שנכתב בלוז, כדי ש"משתלה" / "משתלת ביאליק" לא ייראו כשינוי.
// "טיילת ביאליק" לבדה אינה משתלה (הערה בטבלה): אין בה "משתל", ולכן היא מיקום לא מוכר.
const LOCATIONS = Object.freeze([
  { test: /חוף\s+(?:ה)?ים\s+(?:ב)?קרי{1,2}ת\s+ים/, label: 'חוף הים קריית ים', address: 'חוף זבולון, ישראל' },
  { test: /אורט/, label: 'אורט ביאליק', address: 'אצטדיון אורט ביאליק, ההגנה 22, קרית ביאליק' },
  { test: /משתל[הת]/, label: 'משתלה', address: "ג'ורג' לנדאור 24, קריית ביאליק" },
  { test: /רודמן|קרי{1,2}ת\s+ים/, label: 'קרית ים', address: 'אצטדיון רודמן, שדרות משה שרת 16, קרית ים' },
]);
const knownLocation = (text) => LOCATIONS.find((location) => location.test.test(text)) ?? null;

// שם יום בתחילת שורה: "יום שני", "ביום שני", "שני", "בשני", "יום ב'" / "יום ד'". כל ימות השבוע מזוהים, כדי שבלוק של יום אחר יסתיים בו.
const ANY_DAY_AT_START = /^(?:ב?יום\s+)?ב?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(?![א-ת])|^ב?יום\s+([אבגדהו])['׳](?![א-ת])/;
const DAY_BY_NAME = Object.freeze({ ראשון: 0, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4, שישי: 5, שבת: 6 });
const DAY_BY_LETTER = Object.freeze({ א: 0, ב: 1, ג: 2, ד: 3, ה: 4, ו: 5 });

// מילת שינוי בכל מקום בהודעה (גם בתוך שורת יום) = הודעת תיקון או הערה שמשנה אימון: תפקיד המוח (03-4fitness, "מה נשאר ל-AI"), ולכן null.
// תיקון אחרי בדיקת הבודק (22.11.2026): "שני 20:00 משתלה\nמחר מנוחה" ו"ביום שני 18:00 רופא שיניים, אימון בוטל" נקלטו כלוז ונכתבו לבד.
// מילה שלמה, עם אות-שימוש אחת אופציונלית ("מהיום", "למחר", "ובוטל").
const CHANGE_WORD = /(?<![א-ת])[ושהבלמ]?(?:בוטל|בוטלה|מבוטל|מבוטלת|ביטול|עבר|עברה|עוברת|עובר|הוזז|הוזזה|זז|זזה|נדחה|נדחית|נדחו|במקום|מחר|היום|שינוי|שינויים|מוקדם|מאוחר)(?![א-ת])/;
const HAS_TRAINING_WORD = /אימון|מנוחה/;
// אות חזקה ל-4fitness בהודעה, שמתירה מילים לא מוכרות בשורת יום כ"מיקום לא מוכר" (עם "לוודא כתובת"). בלעדיה: null (המוח).
const STRONG_SIGNAL = /ריצ|כוח|שדות|4fitness/i;
// אוצר המילים של שורת יום (אחרי הסרת היום והשעות): מילות המיקומים שבטבלה, מילות האימון ומילות קישור. מילה עם עד שתי אותיות-שימוש ("במשתלה", "וכוח") נחשבת מוכרת.
// [הנחה, לא אומת] "אצטדיון" ו"אחרי" / "הריצה" ("כוח אחרי הריצה") נוספו לרשימה של המנהל כי הם חלק מניסוחי הטבלה והתיאור.
const KNOWN_WORDS = new Set([
  'משתלה', 'משתלת', 'ביאליק', 'חוף', 'הים', 'ים', 'קריית', 'קרית', 'אורט', 'רודמן', 'אצטדיון',
  'ריצה', 'ריצת', 'לשדות', 'שדות', 'כוח', 'אימון', 'אימוני', 'מנוחה', 'אחרי', 'הריצה',
  'ב', 'בשעה', 'שעה', 'עד', 'ו',
]);
const isKnownWord = (word) => {
  let rest = word;
  for (let k = 0; k <= 2; k += 1) {
    if (KNOWN_WORDS.has(rest)) return true;
    if (rest.length < 3 || !/^[ובלה]/.test(rest)) return false;
    rest = rest.slice(1);
  }
  return false;
};
// המילים בשורת יום שאינן באוצר: אחרי הסרת שעות, מילים עבריות בלבד (מספרים, תאריכים ואימוג'י אינם מילים; "4fitness" מותר).
function unknownWords(content) {
  return content.replace(RANGE, ' ').replace(SINGLE, ' ').split(/[^א-ת0-9a-zA-Z]+/)
    .filter((word) => /[א-ת]/.test(word) && !isKnownWord(word));
}
const REST = /מנוחה/;
const STRENGTH = /כוח/;
const FIELDS_RUN = /שדות/;
const UNIT_AFTER = /^\s*(?:דק|דקות|ק"מ|ק״מ|קמ|קילומטר|מטר|מ'|x|×|פעמים|חזרות|סטים|סט)(?![א-ת])/;

const pad = (n) => String(n).padStart(2, '0');

// שעה תקינה או null. נקודה כמפריד ("18.30") רק עם דקות 00 / 15 / 30 / 45, כדי שתאריך ("23.11") לא ייקרא כשעה.
// מספר בלי דקות: עם "ב" / "בשעה" לפניו בין 5 ל-23, ובלעדיהם רק 12–22 (שעות אחר הצהריים). [הנחה, לא אומת] הספים נבחרו כדי ש"חימום 15 דק'" לא ייקרא כשעה.
function toTime({ hour, sep, minute, prefixed, inRange }) {
  const h = Number(hour);
  if (!Number.isInteger(h) || h > 23) return null;
  if (minute === undefined) {
    const min = inRange || prefixed ? 5 : 12;
    const max = inRange || prefixed ? 23 : 22;
    return h >= min && h <= max ? `${pad(h)}:00` : null;
  }
  const m = Number(minute);
  if (m > 59) return null;
  if (sep === '.' && ![0, 15, 30, 45].includes(m)) return null;
  return `${pad(h)}:${pad(m)}`;
}

const T = String.raw`(\d{1,2})(?:([:.])(\d{2}))?`;
const RANGE = new RegExp(String.raw`(?<![\d.:/])${T}\s*(?:[-–—]|עד)\s*(?:ב-?)?${T}(?![\d:/]|\.\d)`, 'g');
const SINGLE = new RegExp(String.raw`(?<![\d.:/])(בשעה\s*|ב-?\s*)?${T}(?![\d:/]|\.\d)`, 'g');

// השעות בשורה: { start, end, issue } — issue: 'times' (שתי שעות התחלה שונות) או 'range' (סוף לפני התחלה). end = סוף מפורש או null.
function readTimes(content) {
  let rest = content;
  let start = null;
  let end = null;
  let issue = null;
  const starts = new Set();
  for (const match of content.matchAll(RANGE)) {
    const from = toTime({ hour: match[1], sep: match[2], minute: match[3], inRange: true });
    const to = toTime({ hour: match[4], sep: match[5], minute: match[6], inRange: true });
    if (!from || !to) continue;
    if (to <= from) issue = 'range';
    starts.add(from);
    start = from;
    end = to;
    rest = rest.replace(match[0], ' ');
  }
  for (const match of rest.matchAll(SINGLE)) {
    const after = rest.slice(match.index + match[0].length);
    if (match[3] === undefined && UNIT_AFTER.test(after)) continue;
    const time = toTime({ hour: match[2], sep: match[3], minute: match[4], prefixed: Boolean(match[1]) });
    if (!time) continue;
    starts.add(time);
    start ??= time;
  }
  if (starts.size > 1) issue = 'times';
  return { start, end, issue };
}

// המיקום כפי שנכתב: השורה בלי שעות, בלי מילות האימון ובלי סימנים. משמש לכותרת כשהמיקום לא בטבלה.
function rawLocationOf(content) {
  return content
    .replace(RANGE, ' ')
    .replace(SINGLE, ' ')
    .replace(/בשעה/g, ' ')
    .replace(/ריצ[הת]\s+(?:ל)?שדות/g, ' ')
    .replace(/(?:ו)?(?:אימון|אימוני)\s+(?:ה)?כוח/g, ' ')
    .replace(/(?:ו)?כוח(?:\s+אחרי\s+(?:ה)?ריצה)?/g, ' ')
    .replace(/אימון(?:\s+ריצה)?/g, ' ')
    .replace(/מנוחה/g, ' ')
    .replace(/(?<![א-ת])ריצה(?![א-ת])/g, ' ')
    .replace(/[+*_~:,()!.\-–—|/]+/g, ' ')
    .replace(/(?<![א-ת])ב(?![א-ת])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// שורה אחרי ניקוי סימנים בתחילתה (תבליטים, הדגשת וואטסאפ, אימוג'י, מספור).
const cleanLine = (line) => line.replace(/^[^א-ת0-9]+/u, '').trim();

// מחזיר null או { days, uncertain }. ראו הכותרת.
export function parseFitnessSchedule(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const lines = text.split(/\r?\n/);
  const blocks = []; // { weekday, content }
  let open = null; // יום בשורה משלו: הפרטים בשורות שאחריו, עד שורה ריקה או יום אחר
  for (const raw of lines) {
    const line = cleanLine(raw);
    if (line === '') {
      open = null;
      continue;
    }
    const day = ANY_DAY_AT_START.exec(line);
    if (day) {
      const weekday = day[1] ? DAY_BY_NAME[day[1]] : DAY_BY_LETTER[day[2]];
      const content = line.slice(day[0].length).replace(/^[\s:,\-–—*_]+/, '').trim();
      const block = { weekday, content };
      blocks.push(block);
      open = content === '' ? block : null;
      continue;
    }
    if (open) {
      open.content = `${open.content} ${line}`.trim();
      continue;
    }
    // שורה שאינה שורת יום (כותרת, ברכה): לא נכנסת. מילת שינוי בה נתפסת בבדיקה על ההודעה כולה.
  }

  const uncertain = [];
  const days = [];
  for (const block of blocks) {
    if (block.weekday !== MONDAY && block.weekday !== WEDNESDAY) continue; // רק שני ורביעי (03-4fitness, "ימים")
    if (days.some((d) => d.weekday === block.weekday)) {
      uncertain.push({ weekday: block.weekday, reason: 'duplicate_day' });
      continue;
    }
    const rest = REST.test(block.content);
    const { start, end, issue } = readTimes(block.content);
    if (issue) uncertain.push({ weekday: block.weekday, reason: issue });
    if (rest && start) uncertain.push({ weekday: block.weekday, reason: 'rest_and_time' });
    if (!rest && !start) uncertain.push({ weekday: block.weekday, reason: 'no_time' });
    days.push({
      weekday: block.weekday, rest, start: rest ? null : start, end: rest ? null : end,
      locationRaw: rawLocationOf(block.content), strength: STRENGTH.test(block.content), fieldsRun: FIELDS_RUN.test(block.content),
      content: block.content, unknown: unknownWords(block.content), // לבדיקה למטה בלבד; לא מוחזרים
    });
  }
  const usable = days.some((d) => d.rest || d.start);
  if (!usable) return null;
  if (!knownLocation(text) && !HAS_TRAINING_WORD.test(text)) return null;
  if (CHANGE_WORD.test(text)) return null; // מילת שינוי בכל מקום בהודעה: המוח
  // מילים לא מוכרות בשורת יום ("מבחן", "כדורגל", "כושר עם חברים"): מתקבלות כמיקום לא מוכר רק כשיש בהודעה אות חזקה ל-4fitness —
  // מילה מ-STRONG_SIGNAL, או שורת שני / רביעי אחרת עם מיקום מהטבלה. אחרת null.
  for (const day of days) {
    if (day.unknown.length === 0) continue;
    const otherKnown = days.some((other) => other !== day && knownLocation(other.content));
    if (!STRONG_SIGNAL.test(text) && !otherKnown) return null;
  }
  days.sort((a, b) => a.weekday - b.weekday);
  return { days: days.map(({ content, unknown, ...day }) => day), uncertain }; // eslint-disable-line no-unused-vars
}

// { date, time } + דקות (גם מעבר חצות). בלי אזור זמן: ההמרה לשעון ישראל נעשית ב-SQL, כמו בשאר הצינור.
function shift({ date, time }, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const dayShift = Math.floor(total / 1440);
  const inDay = ((total % 1440) + 1440) % 1440;
  return { date: addDays(date, dayShift), time: `${pad(Math.floor(inDay / 60))}:${pad(inDay % 60)}` };
}

// התיאור (03-4fitness, "תיאור"): שני — "ריצה לשדות + כוח"; רביעי — "כוח אחרי הריצה"; אין תוספת — ריק. מיקום לא מוכר: "לוודא כתובת" בשורה נפרדת.
// [הנחה, לא אומת] צירופים שהקובץ לא מכסה (שני עם כוח בלבד = "כוח", שני עם שדות בלבד = "ריצה לשדות", רביעי עם שדות) מורכבים מאותם חלקים עם " + ".
function descriptionFor(day, needsAddress) {
  const parts = [];
  if (day.fieldsRun) parts.push('ריצה לשדות');
  if (day.strength) parts.push(day.weekday === WEDNESDAY ? 'כוח אחרי הריצה' : 'כוח');
  const lines = [];
  if (parts.length > 0) lines.push(parts.join(' + '));
  if (needsAddress) lines.push(NEEDS_ADDRESS);
  return lines.length > 0 ? lines.join('\n') : null;
}

// התאריך: השני / הרביעי הראשון מיום ההודעה והלאה, כולל היום עצמו, בשעון ישראל (03-4fitness, "חישוב תאריכי שני ורביעי", יובל 30.9.2026).
// receivedAt לא תקין: RangeError (מ-localDateIso).
export function planFitnessWeek(parsed, receivedAt) {
  const today = localDateIso(receivedAt);
  const todayWeekday = weekdayOf(today);
  return (parsed?.days ?? []).map((day) => {
    const date = addDays(today, (day.weekday - todayWeekday + 7) % 7);
    const known = knownLocation(day.locationRaw);
    const needsAddress = !known;
    const label = known ? known.label : day.locationRaw;
    if (day.rest) return { weekday: day.weekday, date, rest: true, run: null, prep: null, label, needsAddress };
    const start = { date, time: day.start };
    // שעת סיום מפורשת גוברת; אחרת שעתיים (03-4fitness, "שעות"). "כוח" לא משנה את הסיום.
    const end = day.end ? { date, time: day.end } : shift(start, RUN_MINUTES);
    const title = label ? `${FITNESS_TITLE_PREFIX} - ${label}` : FITNESS_TITLE_PREFIX;
    return {
      weekday: day.weekday, date, rest: false, label, needsAddress,
      run: { title, start, end, location: known ? known.address : null, description: descriptionFor(day, needsAddress) },
      prep: { title: PREP_TITLE, start: shift(start, -PREP_FROM_MINUTES), end: shift(start, -PREP_TO_MINUTES) },
    };
  });
}
