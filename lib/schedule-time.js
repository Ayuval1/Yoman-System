// חישוב "הפעם הבאה ש-HH:MM בשעון המקומי קורה", כרגע UTC, נכון גם סביב מעבר שעון קיץ/חורף. פונקציות טהורות: השעון מוזרק (from).
// בלי חבילות: רק Intl.DateTimeFormat. משמש לתזמון הבריף (07:30) והסגירה (21:00) לפי שעון ישראל.
//
// כללי הכרעה (מוגדרים כאן במפורש):
//  - "חור" (השעה המקומית לא קיימת, למשל 02:30 ביום מעבר לשעון קיץ בישראל: 02:00 קופץ ל-03:00):
//    משתמשים ברגע התקין הראשון אחרי החור, כלומר רגע המעבר עצמו (03:00 מקומי).
//  - "חפיפה" (השעה המקומית קורית פעמיים בסוף הקיץ: 02:00 חוזר ל-01:00): משתמשים במופע הראשון (עם ההיסט של הקיץ).
//    בכל יום מקומי יש מועמד אחד בלבד. אם המופע הראשון כבר עבר (from אחריו, גם אם לפני המופע השני) - עוברים ליום המקומי הבא,
//    כדי שמשימה יומית לא תרוץ פעמיים באותו יום.
//  - התוצאה תמיד אחרי from בהחלט (from שווה בדיוק לרגע היעד - מחזירים את היום הבא).
const MINUTE_MS = 60000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// מחזיר { year, month, day, hour, minute, second, offsetMinutes } של הרגע date בשעון timeZone. month 1-12.
// offsetMinutes = כמה דקות השעון המקומי לפני UTC (ישראל בקיץ: 180). זורק RangeError על אזור זמן או תאריך לא תקינים.
export function localParts(date, timeZone) {
  const ms = date instanceof Date ? date.getTime() : NaN;
  if (Number.isNaN(ms)) throw new RangeError('localParts: date לא תקין');
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }); // timeZone לא תקין זורק RangeError כאן
  const values = {};
  for (const part of formatter.formatToParts(date)) if (part.type !== 'literal') values[part.type] = Number(part.value);
  const hour = values.hour === 24 ? 0 : values.hour; // הגנה מפני "24" בחלק מהסביבות
  const wallAsUtc = Date.UTC(values.year, values.month - 1, values.day, hour, values.minute, values.second);
  const offsetMinutes = Math.round((wallAsUtc - Math.floor(ms / 1000) * 1000) / MINUTE_MS);
  return { year: values.year, month: values.month, day: values.day, hour, minute: values.minute, second: values.second, offsetMinutes };
}

const offsetAt = (ms, timeZone) => localParts(new Date(ms), timeZone).offsetMinutes;

// הרגע (ms) של שעת קיר wallMs (שעה מקומית מקודדת כאילו UTC) באזור timeZone: המופע הראשון, או רגע המעבר אם יש חור.
function resolveWallTime(wallMs, timeZone) {
  const offsets = new Set([offsetAt(wallMs - DAY_MS, timeZone), offsetAt(wallMs, timeZone), offsetAt(wallMs + DAY_MS, timeZone)]);
  const valid = [];
  for (const offset of offsets) {
    const candidate = wallMs - offset * MINUTE_MS;
    if (offsetAt(candidate, timeZone) === offset) valid.push(candidate); // ההיסט באמת תקף ברגע הזה = השעה קיימת
  }
  if (valid.length > 0) return Math.min(...valid); // חפיפה: הראשון
  // חור: שני ההיסטים נותנים רגע שגוי. המעבר נמצא בין הרגע עם ההיסט החדש למוקדם, מחפשים אותו בחיפוש בינרי.
  const candidates = [...offsets].map((offset) => wallMs - offset * MINUTE_MS);
  let low = Math.min(...candidates); // לפני המעבר
  let high = Math.max(...candidates); // אחרי המעבר
  const before = offsetAt(low, timeZone);
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (offsetAt(mid, timeZone) === before) low = mid;
    else high = mid;
  }
  return high;
}

export function nextRunUtc({ hour, minute, timeZone = 'Asia/Jerusalem', from = new Date() } = {}) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new RangeError('nextRunUtc: hour חייב להיות מספר שלם בין 0 ל-23');
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new RangeError('nextRunUtc: minute חייב להיות מספר שלם בין 0 ל-59');
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) throw new RangeError('nextRunUtc: from חייב להיות Date תקין');
  const today = localParts(from, timeZone);
  for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
    const wallMs = Date.UTC(today.year, today.month - 1, today.day + dayOffset, hour, minute);
    const instant = resolveWallTime(wallMs, timeZone);
    if (instant > from.getTime()) return new Date(instant);
  }
  throw new RangeError('nextRunUtc: לא נמצא מועד הבא'); // לא אמור לקרות
}
