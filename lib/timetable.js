// מערכת השעות של יובל (שלב 8.2): פענוח הקובץ data/school-timetable-taf-shin-pe-zayin.md לטעינה חד-פעמית למסד,
// בניית פקודת SQL אחת לטעינה, וקריאת הטעינה האחרונה מהמסד. הקובץ הוא המקור; הטבלאות הן עותק טעון (06-db-schema.md:176).
//
// שלושת החלקים:
//  1. parseTimetableMarkdown(md): טהור, בלי מסד. מפענח את הטבלה ל-{ slots }. period נגזר משעת ההתחלה לפי data/school-day-structure.md.
//  2. timetableLoadSql(parsed, meta): טהור, בלי מסד. מחזיר מחרוזת SQL אחת שיוצרת שורת static_loads חדשה ואת כל שורות timetable_slots
//     שלה (WITH ... INSERT, פקודה אחת: עורך ה-Query של Neon מריץ פקודה אחת בכל הרצה). רק INSERT: בלי DELETE / UPDATE / TRUNCATE.
//     טעינה חדשה יוצרת שורה חדשה ולא דורסת (06-db-schema.md:214). הרצה חוזרת של אותה פקודה יוצרת טעינה נוספת (לא idempotent).
//  3. loadTimetable(sql): קורא מהמסד את הטעינה האחרונה. sql מוזרק (תבנית מתויגת, כמו ב-api/intake.js). לעולם לא זורק.
//
// מה שלא ידוע נשאר NULL (build-rules 31): "לא ידוע" במורה או בחדר, וגם תא ריק, נשמרים כ-null ולא כטקסט.
// פרטיות: ה-SQL והלוגים לא מכילים סוד, כתובת מסד או שם משתמש. הלוגים של loadTimetable מכילים הודעה קבועה או שם שגיאה בלבד, בלי תוכן שורות.
import { createHash } from 'node:crypto';

// מבנה היום, מ-data/school-day-structure.md (מבנה קבוע, זהה בכל יום לימודים, ללא שחרית וללא שיעור 10).
// הנחה, לא אומת: הטבלה מועתקת לכאן ולא נקראת מהקובץ בזמן ריצה, כי data/ אינו מובטח להיות בחבילת הפריסה. בדיקה ב-test/timetable.test.js
// קוראת את הקובץ ומוודאת שהטבלה כאן זהה לו, כך ששינוי במבנה היום ייתפס.
export const LESSON_PERIODS = Object.freeze([
  Object.freeze({ period: 1, startsAt: '08:15', endsAt: '09:00' }),
  Object.freeze({ period: 2, startsAt: '09:05', endsAt: '09:50' }),
  Object.freeze({ period: 3, startsAt: '10:05', endsAt: '10:50' }),
  Object.freeze({ period: 4, startsAt: '10:55', endsAt: '11:40' }),
  Object.freeze({ period: 5, startsAt: '11:50', endsAt: '12:35' }),
  Object.freeze({ period: 6, startsAt: '12:40', endsAt: '13:25' }),
  Object.freeze({ period: 7, startsAt: '13:30', endsAt: '14:15' }),
  Object.freeze({ period: 8, startsAt: '14:30', endsAt: '15:05' }), // שיעור 8 חריג באורכו: 35 דקות
  Object.freeze({ period: 9, startsAt: '15:05', endsAt: '15:45' }), // אין הפסקה בין 8 ל-9
]);
const LESSON_BY_START = new Map(LESSON_PERIODS.map((lesson) => [lesson.startsAt, lesson]));

// 1=ראשון (06-db-schema.md:193). שבוע הלימודים של ט6 הוא ראשון עד חמישי; יום אחר בקובץ נחשב קלט לא תקין.
const WEEKDAY_BY_NAME = new Map([['ראשון', 1], ['שני', 2], ['שלישי', 3], ['רביעי', 4], ['חמישי', 5]]);
const HEADER_CELLS = ['יום', 'שעה', 'מקצוע', 'מורה', 'חדר'];
const UNKNOWN_TEXT = 'לא ידוע';
const INVISIBLE_MARKS = /[‎‏‪-‮﻿]/g; // סימני כיווניות ו-BOM שמגיעים מהעתקה של טקסט עברי
const TIME_RANGE = /^(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})$/; // מקף, מקף ארוך או קו מפריד
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const cleanCell = (text) => text.replace(INVISIBLE_MARKS, '').trim();
const pad2 = (text) => text.padStart(2, '0');

// טקסט אופציונלי (מורה, חדר): null / ריק / "לא ידוע" = null (מה שלא ידוע נשאר NULL). ערך שאינו טקסט או null זורק.
function optionalText(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new TypeError(`${label} חייב להיות טקסט או null`);
  const text = value.trim();
  return text === '' || text === UNKNOWN_TEXT ? null : text;
}

// בודק ומנרמל שורה אחת במבנה { weekday, period, startsAt, endsAt, subject, teacher, room }. מחזיר אובייקט חדש; זורק אם לא תקין.
// משמש גם לפני בניית ה-SQL (הערכים נכנסים למחרוזת, אז רק מספרים שלמים ושעות בפורמט קבוע) וגם על שורות שחזרו מהמסד.
function validateSlot(slot) {
  if (slot === null || typeof slot !== 'object') throw new TypeError('שורת מערכת שעות חייבת להיות אובייקט');
  const { weekday, period, startsAt, endsAt, subject } = slot;
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new RangeError('weekday חייב להיות מספר שלם בין 1 ל-7');
  if (!Number.isInteger(period) || period < 1) throw new RangeError('period חייב להיות מספר שלם חיובי');
  if (typeof startsAt !== 'string' || !HHMM.test(startsAt)) throw new RangeError('startsAt חייב להיות בפורמט HH:MM');
  if (typeof endsAt !== 'string' || !HHMM.test(endsAt)) throw new RangeError('endsAt חייב להיות בפורמט HH:MM');
  if (endsAt <= startsAt) throw new RangeError('endsAt חייב להיות אחרי startsAt'); // HH:MM באורך קבוע, השוואת מחרוזות נכונה
  if (typeof subject !== 'string' || subject.trim() === '') throw new TypeError('subject חייב להיות טקסט לא ריק');
  return {
    weekday, period, startsAt, endsAt, subject: subject.trim(), teacher: optionalText(slot.teacher, 'teacher'), room: optionalText(slot.room, 'room'),
  };
}

// ---------------------------------------------------------------------------
// 1. פענוח הקובץ
// ---------------------------------------------------------------------------

// מפענח את טבלת מערכת השעות (עמודות: יום | שעה | מקצוע | מורה | חדר). מחזיר { slots } לפי סדר הקובץ.
// period נגזר משעת ההתחלה לפי מבנה היום. זורק Error בעברית עם מספר שורה על קלט לא תקין, ולא מדלג בשקט על שורה.
// הנחה, לא אומת: שעת סיום שונה ממבנה היום לאותו שיעור נחשבת קלט לא תקין (עדיף שגיאה ברורה מאירוע שגוי ביומן בשלב 8.4).
// הנחה, לא אומת: שתי שורות עם אותו יום ואותו שיעור נחשבות כפילות וזורקות (אין דרך לדעת איזו נכונה).
export function parseTimetableMarkdown(md) {
  if (typeof md !== 'string' || md.trim() === '') throw new TypeError('parseTimetableMarkdown: חסר טקסט של הקובץ');
  const lines = md.replace(/^﻿/, '').split(/\r?\n/);

  const headerIndex = lines.findIndex((line) => line.trim().startsWith('|'));
  if (headerIndex === -1) throw new Error('מערכת שעות: לא נמצאה טבלה בקובץ');
  const header = splitRow(lines[headerIndex]);
  if (header === null || header.join('|') !== HEADER_CELLS.join('|')) {
    throw new Error(`מערכת שעות: שורה ${headerIndex + 1}: כותרת הטבלה צריכה להיות ${HEADER_CELLS.join(' | ')}`);
  }
  if (!/^\|[\s:|-]+\|$/.test((lines[headerIndex + 1] ?? '').trim())) {
    throw new Error(`מערכת שעות: שורה ${headerIndex + 2}: חסרה שורת המפריד שמתחת לכותרת`);
  }

  const slots = [];
  const seen = new Set();
  for (let index = headerIndex + 2; index < lines.length && lines[index].trim().startsWith('|'); index += 1) {
    const lineNumber = index + 1;
    const cells = splitRow(lines[index]);
    if (cells === null || cells.length !== HEADER_CELLS.length) {
      throw new Error(`מערכת שעות: שורה ${lineNumber}: צריכות להיות ${HEADER_CELLS.length} עמודות`);
    }
    const [dayName, timeRange, subject, teacher, room] = cells;

    const weekday = WEEKDAY_BY_NAME.get(dayName);
    if (weekday === undefined) throw new Error(`מערכת שעות: שורה ${lineNumber}: יום לא מוכר "${dayName}"`);

    const time = TIME_RANGE.exec(timeRange);
    if (time === null) throw new Error(`מערכת שעות: שורה ${lineNumber}: שעה לא תקינה "${timeRange}" (צריך HH:MM–HH:MM)`);
    const startsAt = `${pad2(time[1])}:${time[2]}`;
    const endsAt = `${pad2(time[3])}:${time[4]}`;
    const lesson = LESSON_BY_START.get(startsAt);
    if (lesson === undefined) throw new Error(`מערכת שעות: שורה ${lineNumber}: ${startsAt} אינה שעת התחלה של שיעור במבנה היום`);
    if (endsAt !== lesson.endsAt) {
      throw new Error(`מערכת שעות: שורה ${lineNumber}: שעת סיום ${endsAt} שונה ממבנה היום (${lesson.endsAt}) לשיעור ${lesson.period}`);
    }

    if (subject === '') throw new Error(`מערכת שעות: שורה ${lineNumber}: חסר מקצוע`);
    const key = `${weekday}:${lesson.period}`;
    if (seen.has(key)) throw new Error(`מערכת שעות: שורה ${lineNumber}: כפילות, כבר יש שיעור ${lesson.period} ביום ${dayName}`);
    seen.add(key);

    slots.push(validateSlot({ weekday, period: lesson.period, startsAt, endsAt, subject, teacher, room }));
  }
  if (slots.length === 0) throw new Error('מערכת שעות: הטבלה ריקה, אין אף שיעור');
  return { slots };
}

// "| א | ב |" -> ['א', 'ב'] (מנוקה). null אם השורה לא נראית כשורת טבלה.
function splitRow(line) {
  const text = line.trim();
  if (!text.startsWith('|') || !text.endsWith('|') || text.length < 2) return null;
  return text.slice(1, -1).split('|').map(cleanCell);
}

// ---------------------------------------------------------------------------
// 2. פקודת SQL אחת לטעינה
// ---------------------------------------------------------------------------

// sha256 (hex) של תוכן הקובץ, לשדה static_loads.checksum. מקבל טקסט או Buffer.
export function sha256Hex(content) {
  return createHash('sha256').update(content).digest('hex');
}

// ליטרל טקסט ל-SQL: גרש בודד מוכפל. בלי backslash מיוחד (standard_conforming_strings פעיל כברירת מחדל ב-Postgres ו-Neon).
// NUL אסור בטקסט של Postgres, אז הוא נדחה ולא נחתך בשקט.
function sqlText(value) {
  if (value === null) return 'NULL';
  if (value.includes('\0')) throw new RangeError('טקסט עם תו NUL לא נכנס למסד');
  return `'${value.replace(/'/g, "''")}'`;
}

const sqlTime = (hhmm) => `'${hhmm}'::time`; // hhmm אומת מראש בפורמט HH:MM

// מחזיר מחרוזת SQL אחת (פקודה אחת, ';' אחד בסוף) שמכניסה שורת static_loads חדשה ואת כל שורות timetable_slots עם ה-load_id שלה.
// WITH l AS (INSERT ... RETURNING id) INSERT ... SELECT ... FROM l, (VALUES ...): CTE שכותב, כך ששתי הטבלאות נכתבות באותה פקודה
// ובאותה טרנזקציה (או הכול או כלום). loaded_at = now(). לא מריץ כלום ולא מתחבר למסד.
// meta: fileName (שם קובץ בלי נתיב, כדי שלא ידלוף שם משתמש), versionLabel (למשל "תשפ״ז"), checksum (sha256 hex, ראו sha256Hex).
export function timetableLoadSql(parsed, { fileName, versionLabel, checksum } = {}) {
  if (!parsed || !Array.isArray(parsed.slots) || parsed.slots.length === 0) throw new TypeError('timetableLoadSql: חסרות שורות (parsed.slots)');
  if (typeof fileName !== 'string' || fileName.trim() === '' || /[\\/]/.test(fileName)) {
    throw new TypeError('timetableLoadSql: fileName חייב להיות שם קובץ בלי נתיב');
  }
  if (typeof versionLabel !== 'string' || versionLabel.trim() === '') throw new TypeError('timetableLoadSql: חסר versionLabel');
  if (typeof checksum !== 'string' || !/^[0-9a-f]{64}$/.test(checksum)) throw new TypeError('timetableLoadSql: checksum חייב להיות sha256 בהקסה (64 תווים)');

  const rows = parsed.slots.map((raw) => {
    const slot = validateSlot(raw);
    return `  (${slot.weekday}, ${slot.period}, ${sqlTime(slot.startsAt)}, ${sqlTime(slot.endsAt)}, ${sqlText(slot.subject)}, ${sqlText(slot.teacher)}, ${sqlText(slot.room)})`;
  });

  return [
    'WITH l AS (',
    '  INSERT INTO static_loads (file_name, version_label, loaded_at, checksum)',
    `  VALUES (${sqlText(fileName.trim())}, ${sqlText(versionLabel.trim())}, now(), ${sqlText(checksum)})`,
    '  RETURNING id',
    ')',
    'INSERT INTO timetable_slots (load_id, weekday, period, starts_at, ends_at, subject, teacher, room)',
    'SELECT l.id, v.weekday, v.period, v.starts_at, v.ends_at, v.subject, v.teacher, v.room',
    'FROM l, (VALUES',
    rows.join(',\n'),
    ') AS v(weekday, period, starts_at, ends_at, subject, teacher, room);',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 3. קריאה מהמסד
// ---------------------------------------------------------------------------

// "08:15:00" (כך מחזיר הדרייבר עמודת time) או "08:15" -> "08:15". כל דבר אחר זורק.
function timeFromDb(value) {
  const match = typeof value === 'string' ? /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value) : null;
  if (match === null) throw new TypeError('שעה לא תקינה מהמסד');
  return `${match[1]}:${match[2]}`;
}

function slotFromDbRow(row) {
  if (row === null || typeof row !== 'object') throw new TypeError('שורה לא תקינה מהמסד');
  return validateSlot({
    weekday: Number(row.weekday),
    period: Number(row.period),
    startsAt: timeFromDb(row.starts_at),
    endsAt: timeFromDb(row.ends_at),
    subject: row.subject,
    teacher: row.teacher,
    room: row.room,
  });
}

// קורא את הטעינה האחרונה של מערכת השעות ומחזיר { slots } באותו מבנה של parseTimetableMarkdown, או null. לעולם לא זורק.
// "הטעינה האחרונה" = הטעינה עם loaded_at המאוחר ביותר מבין הטעינות שיש להן שורות ב-timetable_slots.
// הנחה, לא אומת: static_loads משמש גם טעינות של חופשות (calendar_exceptions.load_id, 06-db-schema.md:202), ולכן לא לוקחים סתם את
// הטעינה האחרונה בטבלה (היא עלולה להיות של חופשות ובלי שורות מערכת שעות) אלא את האחרונה שיש לה שורות.
// כשל (מסד זורק, טבלה ריקה, תוצאה תקולה) = null + console.error של שם השגיאה או הודעה קבועה בלבד, בלי תוכן שורות.
// הנחה, לא אומת: שורה תקולה אחת פוסלת את כל התוצאה (null), כי חצי מערכת שעות עלולה להוביל להחלטה שגויה על חלון פנוי.
export async function loadTimetable(sql) {
  let rows;
  try {
    rows = await sql`
      SELECT s.weekday, s.period, s.starts_at, s.ends_at, s.subject, s.teacher, s.room
      FROM timetable_slots s
      WHERE s.load_id = (
        SELECT l.id FROM static_loads l
        WHERE EXISTS (SELECT 1 FROM timetable_slots t WHERE t.load_id = l.id)
        ORDER BY l.loaded_at DESC NULLS LAST
        LIMIT 1
      )
      ORDER BY s.weekday, s.period
    `;
  } catch (error) {
    console.error('timetable: קריאת מערכת השעות מהמסד נכשלה', error?.name);
    return null;
  }
  if (!Array.isArray(rows)) {
    console.error('timetable: תוצאה לא תקינה מהמסד');
    return null;
  }
  if (rows.length === 0) {
    console.error('timetable: לא נמצאה טעינה של מערכת שעות במסד');
    return null;
  }
  try {
    return { slots: rows.map(slotFromDbRow) };
  } catch {
    console.error('timetable: שורה לא תקינה בתוצאה מהמסד');
    return null;
  }
}
