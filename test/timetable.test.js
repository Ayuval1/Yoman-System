// בדיקות ל-lib/timetable.js (פענוח מערכת השעות, פקודת SQL אחת לטעינה, קריאה מהמסד). בלי מסד אמיתי ובלי רשת: sql מזויף מ-helpers.js.
// הקובץ האמיתי data/school-timetable-taf-shin-pe-zayin.md נקרא מהדיסק. שמות המורים לא מועתקים לכאן: הבדיקות משוות מול הקובץ עצמו,
// ובבדיקות עם קלט מלאכותי משתמשים בשמות בדויים.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseTimetableMarkdown, timetableLoadSql, loadTimetable, sha256Hex, LESSON_PERIODS } from '../lib/timetable.js';
import { fakeSql, captureConsole } from './helpers.js';

const TIMETABLE_URL = new URL('../data/school-timetable-taf-shin-pe-zayin.md', import.meta.url);
const STRUCTURE_URL = new URL('../data/school-day-structure.md', import.meta.url);
const timetableMd = readFileSync(TIMETABLE_URL, 'utf8');
const structureMd = readFileSync(STRUCTURE_URL, 'utf8');
const parsed = parseTimetableMarkdown(timetableMd);
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי'];

const META = { fileName: 'school-timetable-taf-shin-pe-zayin.md', versionLabel: 'תשפ״ז', checksum: sha256Hex(timetableMd) };

const slotsOfDay = (weekday) => parsed.slots.filter((slot) => slot.weekday === weekday);
// השיעורים (period) שבהם מקצוע מסוים מופיע ביום מסוים
const periodsOf = (weekday, subject) => slotsOfDay(weekday).filter((slot) => slot.subject === subject).map((slot) => slot.period);

// טבלה מלאכותית קטנה. rows = מערכי תאים. שמות המורים בדויים.
function table(rows, { header = '| יום | שעה | מקצוע | מורה | חדר |', separator = '|---|---|---|---|---|' } = {}) {
  return [header, separator, ...rows.map((cells) => `| ${cells.join(' | ')} |`)].join('\n');
}
const OK_ROW = ['ראשון', '08:15–09:00', 'מקצוע בדיקה', 'מורה בדיקה', '101'];

// מפענח את שורות הערכים של ה-SQL חזרה לערכים: מחרוזת (עם '' כגרש), מחרוזת::time, NULL או מספר.
function valueRowsOf(sqlText) {
  const rows = [];
  for (const line of sqlText.split('\n')) {
    if (!/^ {2}\(\d/.test(line)) continue;
    const values = [];
    for (const match of line.matchAll(/'((?:[^']|'')*)'(::time)?|NULL|\d+/g)) {
      if (match[0] === 'NULL') values.push(null);
      else if (match[1] !== undefined) values.push(match[1].replace(/''/g, "'"));
      else values.push(Number(match[0]));
    }
    rows.push(values);
  }
  return rows;
}
// ה-SQL בלי תוכן הליטרלים (כדי לבדוק רק את מבנה הפקודה)
const withoutLiterals = (sqlText) => sqlText.replace(/'(?:[^']|'')*'/g, "''");

// שורות מסד כפי שהדרייבר מחזיר אותן (snake_case, time כ-HH:MM:SS)
const dbRowsOf = (slots) => slots.map((s) => ({
  weekday: s.weekday, period: s.period, starts_at: `${s.startsAt}:00`, ends_at: `${s.endsAt}:00`, subject: s.subject, teacher: s.teacher, room: s.room,
}));

describe('parseTimetableMarkdown: הקובץ האמיתי', () => {
  test('בדיוק 41 שיעורים, ו-7/9/7/9/9 לפי ימים (ראשון עד חמישי)', () => {
    assert.equal(parsed.slots.length, 41);
    assert.deepEqual([1, 2, 3, 4, 5].map((day) => slotsOfDay(day).length), [7, 9, 7, 9, 9]);
  });

  test('לכל שורה בדיוק שבעת השדות במבנה המוסכם', () => {
    for (const slot of parsed.slots) {
      assert.deepEqual(Object.keys(slot), ['weekday', 'period', 'startsAt', 'endsAt', 'subject', 'teacher', 'room']);
      assert.match(slot.startsAt, /^\d{2}:\d{2}$/);
      assert.match(slot.endsAt, /^\d{2}:\d{2}$/);
    }
  });

  test('בכל יום השיעורים רצופים 1..N (בלי חור ובלי כפילות)', () => {
    for (const day of [1, 2, 3, 4, 5]) {
      const periods = slotsOfDay(day).map((slot) => slot.period);
      assert.deepEqual(periods, periods.map((_, i) => i + 1), `יום ${day}`);
    }
  });

  test('"תחומי בחירה" ביום חמישי (שיעורים 3-4): מורה וחדר null, ואלה השורות היחידות עם null', () => {
    assert.deepEqual(periodsOf(5, 'תחומי בחירה'), [3, 4]);
    for (const slot of slotsOfDay(5).filter((s) => s.subject === 'תחומי בחירה')) {
      assert.equal(slot.teacher, null);
      assert.equal(slot.room, null);
    }
    assert.equal(parsed.slots.filter((s) => s.teacher === null || s.room === null).length, 2);
  });

  test('"לא ידוע" לא נשמר כטקסט באף שדה', () => {
    for (const slot of parsed.slots) {
      for (const value of Object.values(slot)) assert.notEqual(value, 'לא ידוע');
    }
  });

  test('מספרי השיעור תואמים לדוגמאות שבקובץ החוקים (03-intake-rules.md, תזמון שאלת שיעורי הבית)', () => {
    assert.deepEqual(periodsOf(1, 'אנגלית'), [5, 6]); // ראשון
    assert.deepEqual(periodsOf(2, 'מתמטיקה'), [3, 4]); // שני
    assert.deepEqual(periodsOf(2, 'פיזיקה'), [7, 8, 9]);
    assert.deepEqual(periodsOf(3, 'אזרחות'), [1, 2]); // שלישי
    assert.deepEqual(periodsOf(4, 'כימיה'), [1, 2]); // רביעי
    assert.deepEqual(periodsOf(4, 'עברית'), [6, 7]);
    assert.deepEqual(periodsOf(4, 'מתמטיקה (תרגול)'), [8, 9]);
    assert.deepEqual(periodsOf(5, 'גיאומטריה'), [1, 2]); // חמישי
    assert.deepEqual(periodsOf(5, 'כימיה'), [8, 9]);
  });

  test('רצפים של אותו מקצוע: 6 בכל יום, 30 בשבוע; אחרי ארבעת הפטורים (שיח אישי, כישורי חיים, חנ"ג x2) 26 (כמו בקובץ החוקים)', () => {
    const runsOfDay = (day) => slotsOfDay(day).filter((slot, i, all) => i === 0 || all[i - 1].subject !== slot.subject);
    assert.deepEqual([1, 2, 3, 4, 5].map((day) => runsOfDay(day).length), [6, 6, 6, 6, 6]);
    const runs = [1, 2, 3, 4, 5].flatMap(runsOfDay);
    assert.equal(runs.length, 30);
    const exempt = new Set(['שיח אישי', 'כישורי חיים', 'חנ"ג']);
    assert.equal(runs.filter((slot) => !exempt.has(slot.subject)).length, 26);
  });

  test('מבנה היום: LESSON_PERIODS זהה לטבלה ב-data/school-day-structure.md, וכל שיעור בקובץ תואם לו (שעות ומספר)', () => {
    const fromFile = [...structureMd.matchAll(/^\|\s*שיעור (\d+)\s*\|\s*(\d{2}:\d{2})[\u2013-](\d{2}:\d{2})\s*\|/gm)]
      .map((m) => ({ period: Number(m[1]), startsAt: m[2], endsAt: m[3] }));
    assert.equal(fromFile.length, 9);
    assert.deepEqual(LESSON_PERIODS.map((l) => ({ ...l })), fromFile);
    for (const slot of parsed.slots) {
      const lesson = fromFile.find((l) => l.period === slot.period);
      assert.equal(slot.startsAt, lesson.startsAt);
      assert.equal(slot.endsAt, lesson.endsAt);
    }
  });

  test('השוואה עצמאית לשורות הגולמיות של הקובץ: יום, שעות, מקצוע, מורה וחדר', () => {
    const rawRows = timetableMd.split(/\r?\n/)
      .filter((line) => DAY_NAMES.some((day) => line.startsWith(`| ${day} |`)))
      .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
    assert.equal(rawRows.length, 41);
    rawRows.forEach(([day, time, subject, teacher, room], i) => {
      const slot = parsed.slots[i];
      assert.equal(slot.weekday, DAY_NAMES.indexOf(day) + 1);
      assert.equal(`${slot.startsAt}\u2013${slot.endsAt}`, time);
      assert.equal(slot.subject, subject);
      assert.equal(slot.teacher, teacher === 'לא ידוע' ? null : teacher);
      assert.equal(slot.room, room === 'לא ידוע' ? null : room);
    });
  });

  test('שורות מסתיימות ב-LF בלבד, או BOM בתחילת הקובץ, מתפענחות באותה תוצאה כמו CRLF', () => {
    const lf = parseTimetableMarkdown(timetableMd.replace(/\r\n/g, '\n'));
    const bom = parseTimetableMarkdown(`\ufeff${timetableMd}`);
    assert.deepEqual(lf, parsed);
    assert.deepEqual(bom, parsed);
  });
});

describe('parseTimetableMarkdown: קלט לא תקין (שגיאה ברורה, בלי לדלג בשקט)', () => {
  test('קלט מלאכותי תקין מתפענח (בסיס להשוואה בבדיקות הבאות)', () => {
    const result = parseTimetableMarkdown(table([OK_ROW, ['שני', '14:30–15:05', 'מקצוע ב', 'לא ידוע', '']]));
    assert.deepEqual(result.slots, [
      { weekday: 1, period: 1, startsAt: '08:15', endsAt: '09:00', subject: 'מקצוע בדיקה', teacher: 'מורה בדיקה', room: '101' },
      { weekday: 2, period: 8, startsAt: '14:30', endsAt: '15:05', subject: 'מקצוע ב', teacher: null, room: null }, // "לא ידוע" ותא ריק = null
    ]);
  });

  test('לא טקסט, טקסט ריק, או בלי טבלה', () => {
    for (const bad of [undefined, null, 42, {}, '', '   \n  ', '# רק כותרת\nבלי טבלה']) {
      assert.throws(() => parseTimetableMarkdown(bad), Error, String(bad));
    }
  });

  test('כותרת שגויה או שורת מפריד חסרה', () => {
    assert.throws(() => parseTimetableMarkdown(table([OK_ROW], { header: '| יום | שעה | מקצוע | חדר | מורה |' })), /כותרת הטבלה/);
    assert.throws(() => parseTimetableMarkdown(`| יום | שעה | מקצוע | מורה | חדר |\n| ${OK_ROW.join(' | ')} |`), /מפריד/);
  });

  test('טבלה בלי שורות', () => {
    assert.throws(() => parseTimetableMarkdown(table([])), /ריקה/);
  });

  test('יום לא מוכר (כולל שישי ושמות שהם מאפייני אובייקט)', () => {
    for (const day of ['שישי', 'Sunday', 'constructor', '']) {
      assert.throws(() => parseTimetableMarkdown(table([[day, ...OK_ROW.slice(1)]])), /יום לא מוכר/, day);
    }
  });

  test('שעה בפורמט שגוי', () => {
    for (const time of ['08:15', '08:15-', 'אחר הצהריים', '25:00–26:00']) {
      assert.throws(() => parseTimetableMarkdown(table([['ראשון', time, 'מקצוע', 'מורה', '1']])), /שעה|התחלה/, time);
    }
  });

  test('שעת התחלה שאינה תחילת שיעור במבנה היום', () => {
    assert.throws(() => parseTimetableMarkdown(table([['ראשון', '08:20–09:05', 'מקצוע', 'מורה', '1']])), /אינה שעת התחלה/);
  });

  test('שעת סיום שונה ממבנה היום', () => {
    assert.throws(() => parseTimetableMarkdown(table([['ראשון', '08:15–09:05', 'מקצוע', 'מורה', '1']])), /שעת סיום/);
  });

  test('מספר עמודות שגוי', () => {
    assert.throws(() => parseTimetableMarkdown(table([['ראשון', '08:15–09:00', 'מקצוע', 'מורה']])), /5 עמודות/);
    assert.throws(() => parseTimetableMarkdown(table([[...OK_ROW, 'עוד']])), /5 עמודות/);
  });

  test('חסר מקצוע', () => {
    assert.throws(() => parseTimetableMarkdown(table([['ראשון', '08:15–09:00', '', 'מורה', '1']])), /חסר מקצוע/);
  });

  test('כפילות: אותו יום ואותו שיעור פעמיים', () => {
    assert.throws(() => parseTimetableMarkdown(table([OK_ROW, OK_ROW])), /כפילות/);
  });

  test('השגיאה כוללת מספר שורה', () => {
    assert.throws(() => parseTimetableMarkdown(table([OK_ROW, ['שישי', ...OK_ROW.slice(1)]])), /שורה 4/);
  });
});

describe('timetableLoadSql: פקודה אחת', () => {
  const sqlText = timetableLoadSql(parsed, META);

  test('פקודה אחת בלבד: ";" אחד, בסוף, ומתחילה ב-WITH', () => {
    const skeleton = withoutLiterals(sqlText);
    assert.equal((skeleton.match(/;/g) || []).length, 1);
    assert.ok(skeleton.trimEnd().endsWith(';'));
    assert.ok(sqlText.startsWith('WITH l AS (\n  INSERT INTO static_loads'));
    assert.match(sqlText, /RETURNING id\n\)\nINSERT INTO timetable_slots/);
    assert.match(sqlText, /FROM l, \(VALUES/);
  });

  test('בדיוק 41 שורות ערכים, ו-82 ליטרלים של time (התחלה וסיום)', () => {
    assert.equal(valueRowsOf(sqlText).length, 41);
    assert.equal((sqlText.match(/'\d{2}:\d{2}'::time/g) || []).length, 82);
  });

  test('loaded_at = now(), והמטא של הטעינה נכנס כמו שהוא (כולל checksum = sha256 של תוכן הקובץ)', () => {
    assert.match(sqlText, /VALUES \('school-timetable-taf-shin-pe-zayin\.md', 'תשפ״ז', now\(\), '[0-9a-f]{64}'\)/);
    const bytes = readFileSync(TIMETABLE_URL); // ה-Buffer הגולמי, בלי פענוח טקסט
    assert.equal(META.checksum, createHash('sha256').update(bytes).digest('hex'));
    assert.ok(sqlText.includes(`'${META.checksum}'`));
  });

  test('מעגל שלם: הערכים שב-SQL מפוענחים בחזרה לאותן שורות בדיוק (כולל null)', () => {
    const expected = parsed.slots.map((s) => [s.weekday, s.period, s.startsAt, s.endsAt, s.subject, s.teacher, s.room]);
    assert.deepEqual(valueRowsOf(sqlText), expected);
  });

  test('בריחת גרשיים: אשכול ב\' / אשכול ה\' מוכפלים, ומירכאות כפולות (חנ"ג, תנ"ך) נשארות כמו שהן', () => {
    assert.ok(sqlText.includes("'אשכול ב'''"));
    assert.ok(sqlText.includes("'אשכול ה'''"));
    assert.ok(sqlText.includes(`'חנ"ג'`));
    assert.ok(sqlText.includes(`'תנ"ך'`));
    assert.equal(/'אשכול ב'(?!')/.test(sqlText), false, 'גרש בודד לא מוכפל');
  });

  test('מה שלא ידוע נשאר NULL ולא טקסט: תחומי בחירה עם NULL, NULL', () => {
    const rows = sqlText.split('\n').filter((line) => line.includes("'תחומי בחירה'"));
    assert.equal(rows.length, 2);
    for (const row of rows) assert.match(row, /'תחומי בחירה', NULL, NULL\)/);
    assert.equal(sqlText.includes('לא ידוע'), false);
  });

  test('אין DELETE / UPDATE / TRUNCATE / DROP / ALTER (רק INSERT)', () => {
    for (const word of ['DELETE', 'UPDATE', 'TRUNCATE', 'DROP', 'ALTER', 'CREATE']) {
      assert.equal(new RegExp(`\\b${word}\\b`, 'i').test(sqlText), false, word);
    }
    assert.equal((sqlText.match(/\bINSERT\b/g) || []).length, 2);
  });

  test('אין סוד ואין שם משתמש או כתובת מסד', () => {
    assert.equal(/postgres(ql)?:\/\/|DATABASE_URL|password|secret|token|api[_-]?key|current_user|session_user|neondb_owner|[A-Za-z]:\\|\/Users\//i.test(sqlText), false);
    assert.equal(sqlText.includes('@'), false);
  });

  test('ניסיון הזרקה בשדה טקסט נשאר ליטרל אחד: אין פקודה שנייה', () => {
    const evil = "x'); DROP TABLE static_loads; --";
    const result = timetableLoadSql({ slots: [{ ...parsed.slots[0], subject: evil, teacher: "ה'מורה", room: null }] }, META);
    const skeleton = withoutLiterals(result);
    assert.equal(/DROP/i.test(skeleton), false);
    assert.equal((skeleton.match(/;/g) || []).length, 1);
    assert.deepEqual(valueRowsOf(result)[0].slice(4), [evil, "ה'מורה", null]);
  });

  test('מטא-דאטה לא תקינה נדחית', () => {
    assert.throws(() => timetableLoadSql(parsed, { ...META, checksum: 'abc' }), /checksum/);
    assert.throws(() => timetableLoadSql(parsed, { ...META, checksum: "a'); DROP TABLE x; --" }), /checksum/);
    assert.throws(() => timetableLoadSql(parsed, { ...META, fileName: 'C:\\Users\\someone\\x.md' }), /fileName/);
    assert.throws(() => timetableLoadSql(parsed, { ...META, fileName: 'data/x.md' }), /fileName/);
    assert.throws(() => timetableLoadSql(parsed, { ...META, fileName: '' }), /fileName/);
    assert.throws(() => timetableLoadSql(parsed, { ...META, versionLabel: '' }), /versionLabel/);
    assert.throws(() => timetableLoadSql(parsed, undefined), TypeError);
  });

  test('שורות לא תקינות נדחות לפני שנבנה SQL', () => {
    const base = parsed.slots[0];
    assert.throws(() => timetableLoadSql(undefined, META), /slots/);
    assert.throws(() => timetableLoadSql({ slots: [] }, META), /slots/);
    for (const bad of [
      { ...base, weekday: '1' }, { ...base, weekday: 0 }, { ...base, period: 1.5 }, { ...base, startsAt: "08:15'" },
      { ...base, endsAt: '07:00' }, { ...base, subject: '' }, { ...base, teacher: 5 }, { ...base, room: {} }, { ...base, subject: 'א\0ב' }, null,
    ]) {
      assert.throws(() => timetableLoadSql({ slots: [bad] }, META), Error, JSON.stringify(bad));
    }
  });

  test('"לא ידוע" שהועבר ידנית כמורה הופך ל-NULL גם בבנאי ה-SQL', () => {
    const result = timetableLoadSql({ slots: [{ ...parsed.slots[0], teacher: 'לא ידוע', room: '' }] }, META);
    assert.deepEqual(valueRowsOf(result)[0].slice(5), [null, null]);
  });

  test('sha256Hex: ערך ידוע (מחרוזת ריקה)', () => {
    assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('loadTimetable', () => {
  test('מחזיר { slots } באותו מבנה של הפענוח (time מהמסד כ-HH:MM:SS הופך ל-HH:MM)', async () => {
    const sql = fakeSql(() => dbRowsOf(parsed.slots));
    const result = await loadTimetable(sql);
    assert.deepEqual(result, parsed);
    assert.equal(sql.calls.length, 1); // קריאה אחת
  });

  test('השאילתה: הטעינה האחרונה לפי loaded_at (מבין אלה שיש להן שורות), הגנה על NULL, וקריאה בלבד', async () => {
    const sql = fakeSql(() => dbRowsOf(parsed.slots));
    await loadTimetable(sql);
    const { text } = sql.calls[0];
    assert.match(text, /^SELECT /);
    assert.match(text, /FROM static_loads l WHERE EXISTS \(SELECT 1 FROM timetable_slots t WHERE t\.load_id = l\.id\)/);
    assert.match(text, /ORDER BY l\.loaded_at DESC NULLS LAST LIMIT 1/);
    assert.match(text, /ORDER BY s\.weekday, s\.period$/);
    assert.equal(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i.test(text), false);
  });

  test('שעות בפורמט HH:MM וגם HH:MM:SS.ffffff, ומספרים כמחרוזות (כמו שדרייברים מסוימים מחזירים)', async () => {
    const rows = [{ weekday: '1', period: '1', starts_at: '08:15', ends_at: '09:00:00.000000', subject: 'מקצוע בדיקה', teacher: null, room: '1' }];
    assert.deepEqual(await loadTimetable(fakeSql(() => rows)), {
      slots: [{ weekday: 1, period: 1, startsAt: '08:15', endsAt: '09:00', subject: 'מקצוע בדיקה', teacher: null, room: '1' }],
    });
  });

  test('"לא ידוע" שנשמר כטקסט במסד מוחזר כ-null', async () => {
    const rows = [{ weekday: 1, period: 1, starts_at: '08:15:00', ends_at: '09:00:00', subject: 'מקצוע בדיקה', teacher: 'לא ידוע', room: ' ' }];
    const result = await loadTimetable(fakeSql(() => rows));
    assert.equal(result.slots[0].teacher, null);
    assert.equal(result.slots[0].room, null);
  });

  test('טבלה ריקה: null + console.error עם הודעה קבועה', async (t) => {
    const logs = captureConsole(t);
    assert.equal(await loadTimetable(fakeSql(() => [])), null);
    assert.equal(logs.lines.length, 1);
  });

  test('מסד שזורק: null, וב-console.error רק שם השגיאה (לא ההודעה)', async (t) => {
    const logs = captureConsole(t);
    const failure = Object.assign(new Error('postgres://user:pw-secret-123@host/db connection refused'), { name: 'NeonDbError' });
    const sql = fakeSql(() => { throw failure; });
    assert.equal(await loadTimetable(sql), null);
    assert.equal(logs.lines.length, 1);
    assert.match(logs.text(), /NeonDbError/);
    assert.equal(logs.text().includes('pw-secret-123'), false);
    assert.equal(logs.text().includes('postgres://'), false);
    assert.equal(logs.text().includes('connection refused'), false);
  });

  test('sql שאינו פונקציה, או תוצאה שאינה מערך: null בלי לזרוק', async (t) => {
    captureConsole(t);
    assert.equal(await loadTimetable(undefined), null);
    assert.equal(await loadTimetable(null), null);
    assert.equal(await loadTimetable(fakeSql(() => ({ rows: [] }))), null);
    assert.equal(await loadTimetable(fakeSql(() => null)), null);
  });

  test('שורה תקולה אחת פוסלת את הכול: null, וב-console.error אין תוכן שורות', async (t) => {
    const logs = captureConsole(t);
    const good = dbRowsOf(parsed.slots).slice(0, 3);
    const secretName = 'שם-בדיקה-שלא-אמור-להיכתב-ללוג';
    const badRows = [
      { ...good[0], period: null, teacher: secretName }, // שיעור חסר
      { ...good[0], starts_at: 'לא שעה', teacher: secretName },
      { ...good[0], ends_at: '07:00:00', teacher: secretName }, // סיום לפני התחלה
      { ...good[0], subject: null, teacher: secretName },
      { ...good[0], teacher: 42 },
      { ...good[0], weekday: 9, teacher: secretName },
    ];
    for (const bad of badRows) {
      assert.equal(await loadTimetable(fakeSql(() => [good[1], bad, good[2]])), null, JSON.stringify(bad));
    }
    assert.equal(await loadTimetable(fakeSql(() => [good[0], null])), null);
    assert.equal(logs.lines.length, badRows.length + 1);
    assert.equal(logs.text().includes(secretName), false);
    assert.equal(logs.text().includes(good[0].subject), false);
  });
});
