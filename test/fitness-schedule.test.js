// בדיקות בלוק 5 חלק א': לוז 4fitness (lib/fitness-schedule.js), החיבור בצינור הקליטה (lib/intake-process.js), הכתיבה ליומן "אימונים" (lib/event-sync.js),
// מקור האימונים לסגירה (lib/training-source.js) ומועמד לזיהוי (lib/event-match.js). המפרט המחייב: docs/02-rules/03-4fitness-rules.md.
// בלי רשת ובלי מסד אמיתי: sql ו-fetch מזויפים. כל ההודעות מומצאות, בלי שמות אנשים וטלפונים. ה-SQL לא הורץ מול Postgres.
// 21.11.2026 הוא שבת, 22.11 ראשון, 23.11 שני, 25.11 רביעי. שעון ישראל בנובמבר: UTC+2.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseFitnessSchedule, planFitnessWeek, FITNESS_TITLE_PREFIX, PREP_TITLE } from '../lib/fitness-schedule.js';
import { processSource } from '../lib/intake-process.js';
import { CALENDAR_BY_DOMAIN, eventBody, patchBody, syncEventsByMatchKeys } from '../lib/event-sync.js';
import { loadTrainingsForDate } from '../lib/training-source.js';
import { loadEventPool } from '../lib/event-match.js';
import { loadTomorrowEvents } from '../lib/closing-tomorrow.js';
import { handle as intakeHandle } from '../api/intake.js';
import { TOKEN_ENDPOINT, CALENDAR_LIST_ENDPOINT } from '../lib/google.js';
import { fakeSql, fakeFetch, jsonResponse, formRequest, FAKE_SECRET, captureConsole } from './helpers.js';
import { CONFIG, ACCESS_TOKEN, encRefresh } from './google-fixtures.js';

const SATURDAY_EVENING = new Date('2026-11-21T18:30:00Z'); // שבת 21.11 20:30 בישראל
const MONDAY_MORNING = new Date('2026-11-23T06:00:00Z'); // שני 23.11 08:00
const THURSDAY = new Date('2026-11-26T10:00:00Z'); // חמישי 26.11
const SRC_ID = '11111111-1111-4111-8111-111111111111';
const OLD_SRC = '99999999-9999-4999-8999-999999999999';
const RUN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PREP_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

// ---------------------------------------------------------------------------
// fixtures: לוחות בצורות שונות
// ---------------------------------------------------------------------------
const CLASSIC = [
  'לוז אימונים לשבוע הקרוב 🏃',
  'יום שני – משתלה 18:00 ריצה לשדות + כוח',
  'יום רביעי – משתלה 18:00 + כוח',
  'שבוע טוב לכולם!',
].join('\n');
const REST_WED = ['שבוע טוב!', 'שני - משתלת ביאליק בשעה 18:30', 'רביעי מנוחה'].join('\n');
const UNKNOWN_PLACE = ['*יום שני* פארק הכרמל ב-17:30', '*יום רביעי* אורט ביאליק 18.00-19.30'].join('\n');
const HEADER_BLOCKS = ['אימונים השבוע:', '', 'יום שני:', 'חוף הים קריית ים 18', '', 'יום רביעי:', 'אצטדיון רודמן קרית ים 18:00–19:30'].join('\n');
const LETTER_DAYS = ["יום ב' משתלה 18:00", "יום ד' מנוחה"].join('\n');

describe('parseFitnessSchedule: זיהוי וחילוץ', () => {
  test('לוז קלאסי: שני ורביעי, שעה, מיקום, שדות וכוח; שורות כותרת וברכה לא מפריעות', () => {
    const parsed = parseFitnessSchedule(CLASSIC);
    assert.ok(parsed);
    assert.deepEqual(parsed.uncertain, []);
    assert.deepEqual(parsed.days.map((d) => [d.weekday, d.rest, d.start, d.end, d.strength, d.fieldsRun]), [
      [1, false, '18:00', null, true, true],
      [3, false, '18:00', null, true, false],
    ]);
    assert.equal(parsed.days[0].locationRaw, 'משתלה');
  });
  test('"בשעה 18:30" מנורמל, "רביעי מנוחה" = מנוחה בלי שעה', () => {
    const parsed = parseFitnessSchedule(REST_WED);
    assert.deepEqual(parsed.days.map((d) => [d.weekday, d.rest, d.start]), [[1, false, '18:30'], [3, true, null]]);
    assert.equal(parsed.days[0].locationRaw, 'משתלת ביאליק');
  });
  test('טווח "18.00-19.30" עם נקודות, "ב-17:30", הדגשת וואטסאפ, ומיקום לא מוכר', () => {
    const parsed = parseFitnessSchedule(UNKNOWN_PLACE);
    assert.deepEqual(parsed.uncertain, []);
    assert.deepEqual(parsed.days.map((d) => [d.weekday, d.start, d.end, d.locationRaw]), [
      [1, '17:30', null, 'פארק הכרמל'],
      [3, '18:00', '19:30', 'אורט ביאליק'],
    ]);
  });
  test('יום בשורה נפרדת והפרטים בשורה שאחריו; "18" בלבד; טווח עם קו ארוך "–"', () => {
    const parsed = parseFitnessSchedule(HEADER_BLOCKS);
    assert.deepEqual(parsed.uncertain, []);
    assert.deepEqual(parsed.days.map((d) => [d.weekday, d.start, d.end]), [[1, '18:00', null], [3, '18:00', '19:30']]);
  });
  test("יום ב' / יום ד' (אות במקום שם)", () => {
    const parsed = parseFitnessSchedule(LETTER_DAYS);
    assert.deepEqual(parsed.days.map((d) => [d.weekday, d.rest, d.start]), [[1, false, '18:00'], [3, true, null]]);
  });
  test('ימים אחרים (שלישי, חמישי) לא נכנסים', () => {
    const parsed = parseFitnessSchedule('שני משתלה 18:00\nשלישי ריצה עצמאית 18:30\nרביעי משתלה 18:00\nחמישי מנוחה');
    assert.deepEqual(parsed.days.map((d) => d.weekday), [1, 3]);
  });
  test('תאריך בשורה ("23.11", "25/11") אינו שעה', () => {
    const parsed = parseFitnessSchedule('שני 23.11 משתלה 18:00\nרביעי 25/11 משתלה 18:30');
    assert.deepEqual(parsed.uncertain, []);
    assert.deepEqual(parsed.days.map((d) => d.start), ['18:00', '18:30']);
  });
  test('לא לוז = null: הודעות תיקון, משימות, טקסט רגיל', () => {
    for (const text of [
      'מחר מנוחה', 'האימון של רביעי בוטל', 'מבחן במתמטיקה ביום שני', 'יום שני אני הולך לרופא שיניים ב-17:00', 'שני 18:00',
      'להתקשר לסבתא', '', '   ', 'יום שני – משתלה', null, undefined, 42,
      // מקרי הבודק (22.11.2026): נקלטו כלוז ונכתבו לבד. מילים לא מוכרות בלי אות חזקה, או מילת שינוי בכל מקום בהודעה = null.
      'שני 18:00 מבחן באורט', 'שני 18:00 אימון כדורגל', 'רביעי 17:00 אימון כושר עם חברים', 'ביום שני 18:00 רופא שיניים, אימון בוטל', 'שני 20:00 משתלה\nמחר מנוחה',
      'שימו לב: האימון של שני נדחה\nשני משתלה 18:00\nרביעי משתלה 18:00', 'שני משתלה 18:00\nרביעי משתלה 18:00 במקום בשלישי', 'שני משתלה 18:00 ריצה\nהיום מנוחה',
      'שני פארק הכרמל 18:00\nרביעי מנוחה', // מיקום לא מוכר בלי אות חזקה
    ]) assert.equal(parseFitnessSchedule(text), null, String(text));
  });
  test('ספק: יום בלי שעה ובלי מנוחה, שתי שעות שונות, יום כפול, טווח הפוך', () => {
    const cases = [
      ['שני משתלה 18:00\nרביעי משתלה', 'no_time'],
      ['שני משתלה 18:00 או 18:30 ריצה\nרביעי מנוחה', 'times'], // "או" לא באוצר, ומתקבלת רק כי יש "ריצה"
      ['שני משתלה 18:00\nשני משתלה 18:30', 'duplicate_day'],
      ['שני משתלה 19:30-18:00', 'range'],
    ];
    for (const [text, reason] of cases) {
      const parsed = parseFitnessSchedule(text);
      assert.ok(parsed, text);
      assert.ok(parsed.uncertain.some((u) => u.reason === reason), `${text} -> ${JSON.stringify(parsed.uncertain)}`);
    }
  });
});

describe('planFitnessWeek: תאריכים, שעות, כותרת, מיקום ותיאור (03-4fitness-rules.md)', () => {
  test('שבת בערב -> שני 23.11 ורביעי 25.11; שעתיים; כותרת; כתובת מהטבלה; תיאור לפי יום', () => {
    const plan = planFitnessWeek(parseFitnessSchedule(CLASSIC), SATURDAY_EVENING);
    assert.equal(plan.length, 2);
    const [mon, wed] = plan;
    assert.equal(mon.date, '2026-11-23');
    assert.deepEqual(mon.run, {
      title: 'אימון ריצה - משתלה', start: { date: '2026-11-23', time: '18:00' }, end: { date: '2026-11-23', time: '20:00' },
      location: "ג'ורג' לנדאור 24, קריית ביאליק", description: 'ריצה לשדות + כוח',
    });
    assert.deepEqual(mon.prep, { title: PREP_TITLE, start: { date: '2026-11-23', time: '17:00' }, end: { date: '2026-11-23', time: '17:30' } });
    assert.equal(wed.date, '2026-11-25');
    assert.equal(wed.run.description, 'כוח אחרי הריצה');
    assert.ok(mon.run.title.startsWith(FITNESS_TITLE_PREFIX));
  });
  test('"כולל היום": הודעה ביום שני בבוקר -> שני של היום; ביום חמישי -> השבוע הבא', () => {
    assert.deepEqual(planFitnessWeek(parseFitnessSchedule(CLASSIC), MONDAY_MORNING).map((d) => d.date), ['2026-11-23', '2026-11-25']);
    assert.deepEqual(planFitnessWeek(parseFitnessSchedule(CLASSIC), THURSDAY).map((d) => d.date), ['2026-11-30', '2026-12-02']);
  });
  test('שעת סיום מפורשת גוברת; אחרת שעתיים (18:30 -> 20:30); התארגנות שעה עד חצי שעה לפני', () => {
    const plan = planFitnessWeek(parseFitnessSchedule(UNKNOWN_PLACE), SATURDAY_EVENING);
    assert.deepEqual([plan[0].run.start.time, plan[0].run.end.time], ['17:30', '19:30']);
    assert.deepEqual([plan[0].prep.start.time, plan[0].prep.end.time], ['16:30', '17:00']);
    assert.deepEqual([plan[1].run.start.time, plan[1].run.end.time], ['18:00', '19:30']);
    const rest = planFitnessWeek(parseFitnessSchedule(REST_WED), SATURDAY_EVENING);
    assert.equal(rest[0].run.end.time, '20:30');
  });
  test('מיקום לא מוכר: location ריק ו"לוודא כתובת" בתיאור; אורט ביאליק מהטבלה', () => {
    const [mon, wed] = planFitnessWeek(parseFitnessSchedule(UNKNOWN_PLACE), SATURDAY_EVENING);
    assert.equal(mon.run.title, 'אימון ריצה - פארק הכרמל');
    assert.equal(mon.run.location, null);
    assert.equal(mon.run.description, 'לוודא כתובת');
    assert.equal(mon.needsAddress, true);
    assert.equal(wed.run.location, 'אצטדיון אורט ביאליק, ההגנה 22, קרית ביאליק');
    assert.equal(wed.run.description, null);
  });
  test('טבלת המיקומים: חוף הים קריית ים, רודמן / קרית ים; "טיילת ביאליק" אינה משתלה', () => {
    const [mon, wed] = planFitnessWeek(parseFitnessSchedule(HEADER_BLOCKS), SATURDAY_EVENING);
    assert.equal(mon.run.location, 'חוף זבולון, ישראל');
    assert.equal(wed.run.location, 'אצטדיון רודמן, שדרות משה שרת 16, קרית ים');
    const [promenade] = planFitnessWeek(parseFitnessSchedule('שני טיילת ביאליק 18:00 ריצה\nרביעי מנוחה'), SATURDAY_EVENING);
    assert.equal(promenade.run.location, null);
    assert.equal(promenade.run.title, 'אימון ריצה - טיילת ביאליק');
  });
  test('מנוחה: בלי אירוע ובלי התארגנות', () => {
    const [, wed] = planFitnessWeek(parseFitnessSchedule(REST_WED), SATURDAY_EVENING);
    assert.deepEqual([wed.rest, wed.run, wed.prep], [true, null, null]);
  });
  test('חותמת לא תקינה זורקת RangeError', () => {
    assert.throws(() => planFitnessWeek(parseFitnessSchedule(CLASSIC), 'not a date'), RangeError);
  });
});

// ---------------------------------------------------------------------------
// הצינור: processSource
// ---------------------------------------------------------------------------
const source = (text, over = {}) => ({ id: SRC_ID, channel: 'shortcut', raw_content: text, content_hash: 'h', received_at: SATURDAY_EVENING, ...over });
const existingRow = (over = {}) => ({
  id: RUN_ID, title: 'אימון ריצה - משתלה', location: "ג'ורג' לנדאור 24, קריית ביאליק", description: 'כוח אחרי הריצה', match_key: `source:${OLD_SRC}:fitness:2026-11-25:run`,
  start_date: '2026-11-25', start_time: '18:00', end_date: '2026-11-25', end_time: '20:00', ...over,
});
const existingPrep = (over = {}) => ({
  id: PREP_ID, title: PREP_TITLE, location: null, description: null, match_key: `source:${OLD_SRC}:fitness:2026-11-25:prep`,
  start_date: '2026-11-25', start_time: '17:00', end_date: '2026-11-25', end_time: '17:30', ...over,
});
function pipeSql({ existing = [], duplicate = false, claimed = 1 } = {}) {
  return fakeSql((text) => {
    if (text.includes('FROM sources s JOIN sources p')) return duplicate ? [{ found: 1 }] : [];
    if (text.includes('fitness-existing')) return existing;
    if (text.includes('fitness-write')) return [{ claimed, created: 0, updated: 0, cancelled: 0, changes_written: 0, bubbles_written: 1 }];
    return [];
  });
}
const writeOf = (sql) => {
  const calls = sql.find('fitness-write');
  assert.equal(calls.length, 1, 'פקודת כתיבה אחת');
  return calls[0];
};
const jsonParams = (call) => call.values.filter((v) => typeof v === 'string' && v.startsWith('[')).map((v) => JSON.parse(v));

describe('processSource: לוז 4fitness מטופל בקוד, בלי מוח', () => {
  test('לוז חדש: שני אירועי אימון ושתי התארגנויות, פקודה אטומית אחת, בועה, תשובה, והמוח לא נקרא', async () => {
    const sql = pipeSql();
    let brainCalls = 0;
    const result = await processSource({ sql, source: source(CLASSIC), timetable: null, understand: async () => { brainCalls += 1; return { ok: false, reason: 'no_key' }; } });
    assert.equal(brainCalls, 0, 'המוח לא נקרא');
    assert.equal(result.status, 'recorded');
    assert.equal(result.reply, 'נרשמו האימונים: שני 23.11 18:00–20:00 משתלה · רביעי 25.11 18:00–20:00 משתלה');
    const call = writeOf(sql);
    assert.match(call.text, /WITH claim AS \( UPDATE sources SET processed_at = now\(\)/);
    assert.match(call.text, /INSERT INTO events \(title, starts_at, ends_at, location, description, domain, movable, status, external_id, commitment_id, match_key\)/);
    assert.match(call.text, /'running', false, 'planned'/);
    assert.match(call.text, /WHERE NOT EXISTS \(SELECT 1 FROM events x WHERE x\.match_key = ev\.match_key\)/);
    assert.match(call.text, /INSERT INTO messages/);
    assert.ok(!/\bDELETE\b/.test(call.text));
    const [creates, updates, cancels, changes] = jsonParams(call);
    assert.equal(creates.length, 4);
    assert.deepEqual(creates.map((c) => c.match_key), [
      `source:${SRC_ID}:fitness:2026-11-23:run`, `source:${SRC_ID}:fitness:2026-11-23:prep`,
      `source:${SRC_ID}:fitness:2026-11-25:run`, `source:${SRC_ID}:fitness:2026-11-25:prep`,
    ]);
    assert.deepEqual(creates[0], {
      title: 'אימון ריצה - משתלה', start_date: '2026-11-23', start_time: '18:00', end_date: '2026-11-23', end_time: '20:00',
      location: "ג'ורג' לנדאור 24, קריית ביאליק", description: 'ריצה לשדות + כוח', match_key: `source:${SRC_ID}:fitness:2026-11-23:run`,
    });
    assert.deepEqual([updates, cancels, changes], [[], [], []]);
    assert.ok(call.values.includes(result.reply), 'הבועה = התשובה');
    assert.deepEqual(result.fitness, { keys: creates.map((c) => c.match_key), patchKeys: [] });
  });
  test('גם בלי understand (נתיב הקוד) וגם בהודעה מוקלדת (app)', async () => {
    const a = await processSource({ sql: pipeSql(), source: source(CLASSIC), timetable: null });
    assert.equal(a.status, 'recorded');
    const sql = pipeSql();
    const b = await processSource({ sql, source: source(CLASSIC, { channel: 'app' }), timetable: null });
    assert.equal(b.status, 'recorded');
    assert.equal(sql.find('INTO tasks').length, 0, 'לא נרשם כמשימה');
  });
  test('שאילתת הקיים: running, planned, source:, כותרת אימון או התארגנות, בתאריכים של הלוז', async () => {
    const sql = pipeSql();
    await processSource({ sql, source: source(CLASSIC), timetable: null });
    const [query] = sql.find('fitness-existing');
    assert.match(query.text, /domain = 'running' AND status = 'planned' AND match_key LIKE 'source:%'/);
    assert.match(query.text, /title LIKE 'אימון ריצה%' OR title = 'התארגנות'/);
    assert.ok(query.values.includes(JSON.stringify(['2026-11-23', '2026-11-25'])));
  });
  test('קיים וזהה: לא נוגעים (אין יצירה, אין עדכון), "כבר רשום" בתשובה', async () => {
    const sql = pipeSql({ existing: [existingRow(), existingPrep()] });
    const result = await processSource({ sql, source: source('רביעי משתלה 18:00 + כוח'), timetable: null });
    const [creates, updates, cancels, changes] = jsonParams(writeOf(sql));
    assert.deepEqual([creates, updates, cancels, changes], [[], [], [], []]);
    assert.equal(result.reply, 'נרשמו האימונים: רביעי 25.11 18:00–20:00 משתלה · כבר רשום');
    assert.deepEqual(result.fitness, { keys: [], patchKeys: [] });
  });
  test('קיים ושונה (שעה ומיקום): עדכון השורה הקיימת + התארגנות, רישום ב-changes, PATCH מותר', async () => {
    const sql = pipeSql({ existing: [existingRow(), existingPrep()] });
    const result = await processSource({ sql, source: source('רביעי אורט ביאליק 18:30 + כוח'), timetable: null });
    const call = writeOf(sql);
    assert.match(call.text, /UPDATE events SET title = u\.title/);
    assert.match(call.text, /INSERT INTO changes \(entity_type, entity_id, field, old_value, new_value, source_id, changed_at, changed_by\)/);
    assert.match(call.text, /'event', x\.entity_id::uuid, x\.field, x\.old_value, x\.new_value, claim\.id, now\(\), 'system'/);
    const [creates, updates, cancels, changes] = jsonParams(call);
    assert.deepEqual(creates, []);
    assert.deepEqual(cancels, []);
    assert.deepEqual(updates.map((u) => [u.id, u.start_time, u.end_time]), [[RUN_ID, '18:30', '20:30'], [PREP_ID, '17:30', '18:00']]);
    assert.equal(updates[0].location, 'אצטדיון אורט ביאליק, ההגנה 22, קרית ביאליק');
    assert.equal(updates[0].title, 'אימון ריצה - אורט ביאליק');
    const runChanges = changes.filter((c) => c.entity_id === RUN_ID).map((c) => c.field);
    assert.deepEqual(runChanges, ['title', 'starts_at', 'ends_at', 'location']);
    assert.deepEqual(changes.find((c) => c.field === 'starts_at' && c.entity_id === RUN_ID), {
      entity_id: RUN_ID, field: 'starts_at', old_value: '2026-11-25 18:00', new_value: '2026-11-25 18:30',
    });
    assert.equal(result.reply, 'נרשמו האימונים: רביעי 25.11 18:30–20:30 אורט ביאליק · עודכן');
    assert.deepEqual(result.fitness.patchKeys, [existingRow().match_key, existingPrep().match_key]);
  });
  test('"מנוחה" וקיים אימון: ביטול (status cancelled, בלי מחיקה) של האימון וההתארגנות, changes, והודעת ביטול בבועה ובתשובה', async () => {
    const sql = pipeSql({ existing: [existingRow(), existingPrep()] });
    const result = await processSource({ sql, source: source('שני משתלה 18:00 ריצה לשדות + כוח\nרביעי מנוחה'), timetable: null });
    const call = writeOf(sql);
    assert.match(call.text, /UPDATE events SET status = 'cancelled'/);
    const [creates, , cancels, changes] = jsonParams(call);
    assert.equal(creates.length, 2, 'שני: אימון והתארגנות');
    assert.deepEqual(cancels.map((c) => c.id), [RUN_ID, PREP_ID]);
    assert.deepEqual(changes.filter((c) => c.field === 'status').map((c) => [c.entity_id, c.old_value, c.new_value]), [[RUN_ID, 'planned', 'cancelled'], [PREP_ID, 'planned', 'cancelled']]);
    assert.equal(result.reply, 'נרשמו האימונים: שני 23.11 18:00–20:00 משתלה · רביעי 25.11 מנוחה\nבוטל האימון של רביעי 25.11.');
    assert.ok(call.values.includes(result.reply), 'ההודעה המיידית נכתבת באותה פקודה של הביטול (מנגנון 1)');
    assert.ok(result.fitness.keys.includes(existingRow().match_key));
    assert.ok(result.fitness.keys.includes(existingPrep().match_key));
  });
  test('"מנוחה" בלי אימון קיים: לא עושים כלום חוץ מהרישום', async () => {
    const sql = pipeSql();
    const result = await processSource({ sql, source: source('רביעי מנוחה'), timetable: null });
    const [creates, updates, cancels, changes] = jsonParams(writeOf(sql));
    assert.deepEqual([creates, updates, cancels, changes], [[], [], [], []]);
    assert.equal(result.reply, 'נרשמו האימונים: רביעי 25.11 מנוחה (אין אימון לבטל)');
  });
  test('מיקום לא מוכר: "לוודא כתובת" בתשובה', async () => {
    const result = await processSource({ sql: pipeSql(), source: source('שני פארק הכרמל 18:00 ריצה\nרביעי מנוחה'), timetable: null });
    assert.equal(result.reply, 'נרשמו האימונים: שני 23.11 18:00–20:00 פארק הכרמל (לוודא כתובת) · רביעי 25.11 מנוחה (אין אימון לבטל)');
  });
  test('כפילות נבדקת קודם: "כבר קיבלתי", בלי שאילתת לוז', async () => {
    const sql = pipeSql({ duplicate: true });
    const result = await processSource({ sql, source: source(CLASSIC), timetable: null });
    assert.equal(result.status, 'duplicate');
    assert.equal(sql.find('fitness-').length, 0);
  });
  test('המקור כבר נתפס (claimed 0): skipped, בלי fitness', async () => {
    const result = await processSource({ sql: pipeSql({ claimed: 0 }), source: source(CLASSIC), timetable: null });
    assert.equal(result.status, 'skipped');
    assert.equal(result.fitness, undefined);
  });
  test('ספק בלוז: לא מטופל בקוד, עובר לצינור הרגיל (המוח נקרא)', async () => {
    const sql = pipeSql();
    let brainCalls = 0;
    await processSource({ sql, source: source('שני משתלה 18:00\nרביעי משתלה'), timetable: null, understand: async () => { brainCalls += 1; return { ok: false, reason: 'no_key' }; } });
    assert.equal(brainCalls, 1);
    assert.equal(sql.find('fitness-').length, 0);
  });
  test('הודעת תיקון ("מחר מנוחה", "האימון של רביעי בוטל") אינה לוז: עוברת למוח כמו היום', async () => {
    for (const text of ['מחר מנוחה', 'האימון של רביעי בוטל']) {
      const sql = pipeSql();
      let brainCalls = 0;
      await processSource({ sql, source: source(text), timetable: null, understand: async () => { brainCalls += 1; return { ok: false, reason: 'no_key' }; } });
      assert.equal(brainCalls, 1, text);
      assert.equal(sql.find('fitness-').length, 0, text);
    }
  });
  test('עובדת type = fitness_schedule נשמרת (סיכום היום מציג "נרשם", הסגירה לא סופרת "לא הובן")', async () => {
    const sql = pipeSql();
    await processSource({ sql, source: source(CLASSIC), timetable: null });
    const call = writeOf(sql);
    assert.match(call.text, /INSERT INTO facts/);
    assert.ok(call.values.includes('fitness_schedule'));
  });
});

// ---------------------------------------------------------------------------
// api/intake.js: הכתיבה ליומן אחרי לוז
// ---------------------------------------------------------------------------
describe('api/intake.js: לוז -> כתיבה ליומן לפי המפתחות שנגעו', () => {
  test('result.fitness -> fitnessSync עם keys ו-patchKeys; eventSync של המקור לא נקרא', async () => {
    const sql = fakeSql((text) => (text.includes('INSERT INTO sources') ? [{ id: SRC_ID, received_at: SATURDAY_EVENING }] : []));
    const calls = { fitness: [], event: [] };
    const fitness = { keys: ['source:x:fitness:2026-11-23:run'], patchKeys: [] };
    const response = await intakeHandle(formRequest({ text: CLASSIC }, { headers: { 'x-intake-secret': FAKE_SECRET } }), {
      sql, secret: FAKE_SECRET, sendQueue: async () => {}, processor: async () => ({ status: 'recorded', reply: 'נרשמו האימונים: ...', fitness }),
      eventSync: async (args) => { calls.event.push(args); return {}; }, fitnessSync: async (args) => { calls.fitness.push(args); return {}; },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'נרשמו האימונים: ...');
    assert.equal(calls.event.length, 0);
    assert.equal(calls.fitness.length, 1);
    assert.deepEqual(calls.fitness[0].keys, fitness.keys);
    assert.deepEqual(calls.fitness[0].patchKeys, []);
  });
  test('כשל בכתיבה ליומן לא משנה את התשובה', async (t) => {
    captureConsole(t);
    const sql = fakeSql((text) => (text.includes('INSERT INTO sources') ? [{ id: SRC_ID, received_at: SATURDAY_EVENING }] : []));
    const response = await intakeHandle(formRequest({ text: CLASSIC }, { headers: { 'x-intake-secret': FAKE_SECRET } }), {
      sql, secret: FAKE_SECRET, sendQueue: async () => {}, processor: async () => ({ status: 'recorded', reply: 'נרשמו', fitness: { keys: ['k'], patchKeys: [] } }),
      fitnessSync: async () => { throw new Error('boom'); },
    });
    assert.equal(await response.text(), 'נרשמו');
  });
});

// ---------------------------------------------------------------------------
// lib/event-sync.js: יומן "אימונים", גוף האירוע, PATCH וסנכרון לפי מפתחות
// ---------------------------------------------------------------------------
const RUNNING_CAL = 'running-cal-id-DO-NOT-LEAK@group.calendar.google.com';
const CALENDARS = [{ id: 'p', summary: 'אישי', accessRole: 'owner' }, { id: RUNNING_CAL, summary: 'ריצה', accessRole: 'owner' }];
const NOW = new Date('2026-11-22T08:00:00Z');
const runRow = (over = {}) => ({
  id: RUN_ID, title: 'אימון ריצה - משתלה', starts_at: new Date('2026-11-23T16:00:00Z'), ends_at: new Date('2026-11-23T18:00:00Z'),
  location: "ג'ורג' לנדאור 24, קריית ביאליק", description: 'ריצה לשדות + כוח', domain: 'running', status: 'planned', external_id: null,
  match_key: `source:${SRC_ID}:fitness:2026-11-23:run`, ...over,
});
const prepRow = (over = {}) => runRow({
  id: PREP_ID, title: PREP_TITLE, starts_at: new Date('2026-11-23T15:00:00Z'), ends_at: new Date('2026-11-23T15:30:00Z'), location: null, description: null,
  match_key: `source:${SRC_ID}:fitness:2026-11-23:prep`, ...over,
});
function gFetch() {
  return fakeFetch((url, options) => {
    if (url === TOKEN_ENDPOINT) return jsonResponse({ access_token: ACCESS_TOKEN });
    if (url.startsWith(CALENDAR_LIST_ENDPOINT)) return jsonResponse({ items: CALENDARS });
    if (url.includes('/events')) {
      if (options.method === 'POST') return jsonResponse({ id: 'x' });
      if (options.method === 'PATCH') return jsonResponse({ id: 'x' });
      if (options.method === 'DELETE') return new Response(null, { status: 204 });
    }
    throw new Error(`fetch לא צפוי: ${url}`);
  });
}
const keysSql = (rows) => fakeSql((text) => {
  if (text.includes('WHERE match_key IN')) return rows;
  if (text.includes('FROM google_credentials')) return [{ refresh_token_enc: encRefresh() }];
  return [];
});
const eventCalls = (f) => f.calls.filter((c) => c.url.includes('/events'));

describe('event-sync: אימונים', () => {
  test('running -> "ריצה" בטבלה', () => {
    assert.equal(CALENDAR_BY_DOMAIN.running, 'ריצה');
  });
  test('גוף אימון: מיקום, תיאור, צבע 11, תזכורות 1440 ו-60', () => {
    const body = eventBody(runRow());
    assert.deepEqual(body, {
      summary: 'אימון ריצה - משתלה',
      start: { dateTime: '2026-11-23T16:00:00.000Z', timeZone: 'Asia/Jerusalem' },
      end: { dateTime: '2026-11-23T18:00:00.000Z', timeZone: 'Asia/Jerusalem' },
      location: "ג'ורג' לנדאור 24, קריית ביאליק", description: 'ריצה לשדות + כוח', colorId: '11',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 60 }] },
    });
  });
  test('גוף התארגנות: כותרת ושעות בלבד (צבע ותזכורות של היומן)', () => {
    assert.deepEqual(Object.keys(eventBody(prepRow())), ['summary', 'start', 'end']);
  });
  test('גוף אימון בלי מיקום ותיאור: בלי השדות האלה', () => {
    const body = eventBody(runRow({ location: null, description: null }));
    assert.ok(!('location' in body));
    assert.ok(!('description' in body));
  });
  test('PATCH של אימון: כותרת, מיקום, תיאור ושעות; בלי תזכורות (03-4fitness: "בתזכורות לא נוגעים"); תחום אחר: שעות בלבד', () => {
    assert.deepEqual(Object.keys(patchBody(runRow())).sort(), ['description', 'end', 'location', 'start', 'summary']);
    assert.deepEqual(patchBody(runRow({ location: null })).location, '');
    assert.deepEqual(Object.keys(patchBody(runRow({ domain: 'personal' }))), ['start', 'end']);
  });
  test('syncEventsByMatchKeys: חיבור אחד, יצירה ביומן "אימונים", PATCH רק למפתחות שהותרו, מחיקה לבוטל', async () => {
    const rows = [
      runRow(),
      prepRow({ external_id: 'bbbbbbbbcccc4ddd8eeeffffffffffff' }),
      runRow({ id: 'cccccccc-dddd-4eee-8fff-000000000000', status: 'cancelled', external_id: 'g', match_key: 'source:z:fitness:2026-11-25:run' }),
    ];
    const sql = keysSql(rows);
    const f = gFetch();
    const result = await syncEventsByMatchKeys({ sql, keys: rows.map((r) => r.match_key), patchKeys: [rows[1].match_key], now: NOW, fetchFn: f, config: CONFIG });
    assert.deepEqual(result, { created: 1, patched: 1, deleted: 1, failed: 0, skipped: 0 });
    assert.equal(f.calls.filter((c) => c.url === TOKEN_ENDPOINT).length, 1, 'חיבור אחד');
    const calls = eventCalls(f);
    assert.deepEqual(calls.map((c) => c.options.method), ['POST', 'PATCH', 'DELETE']);
    for (const c of calls) assert.ok(c.url.includes(encodeURIComponent(RUNNING_CAL)));
    const patch = JSON.parse(calls[1].options.body);
    assert.deepEqual(Object.keys(patch).sort(), ['description', 'end', 'location', 'start', 'summary']);
    const [query] = sql.find('WHERE match_key IN');
    assert.ok(query.values.includes(JSON.stringify(rows.map((r) => r.match_key))));
  });
  test('syncEventsByMatchKeys: בלי הגדרות / בלי מפתחות: אפס קריאות', async () => {
    const f = gFetch();
    assert.deepEqual(await syncEventsByMatchKeys({ sql: keysSql([]), keys: ['source:a'], now: NOW, fetchFn: f, config: {} }), { created: 0, patched: 0, deleted: 0, failed: 0, skipped: 0, reason: 'config_missing' });
    assert.deepEqual(await syncEventsByMatchKeys({ sql: keysSql([]), keys: [], now: NOW, fetchFn: f, config: CONFIG }), { created: 0, patched: 0, deleted: 0, failed: 0, skipped: 0 });
    assert.equal(f.calls.length, 0);
  });
  test('syncEventsByMatchKeys: אימון קיים בלי היתר PATCH = skipped, בלי קריאה ל-Google', async () => {
    const f = gFetch();
    const rows = [runRow({ external_id: 'x' })];
    const result = await syncEventsByMatchKeys({ sql: keysSql(rows), keys: [rows[0].match_key], now: NOW, fetchFn: f, config: CONFIG });
    assert.deepEqual(result, { created: 0, patched: 0, deleted: 0, failed: 0, skipped: 1 });
    assert.equal(f.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// lib/training-source.js, הסגירה, ומועמד לזיהוי
// ---------------------------------------------------------------------------
describe('training-source: אימוני היום מ-events', () => {
  test('בלי sql: [] (החוזה הישן נשמר)', async () => {
    assert.deepEqual(await loadTrainingsForDate('2026-11-23'), []);
  });
  test('עם sql: אימוני ריצה מתוכננים של התאריך הישראלי, { title, startsAt }', async () => {
    const sql = fakeSql(() => [{ title: 'אימון ריצה - משתלה', starts_at: new Date('2026-11-23T16:00:00Z') }]);
    const list = await loadTrainingsForDate('2026-11-23', { sql });
    assert.deepEqual(list, [{ title: 'אימון ריצה - משתלה', startsAt: '2026-11-23T16:00:00.000Z' }]);
    const [call] = sql.calls;
    assert.match(call.text, /domain = 'running' AND status = 'planned' AND \(title LIKE 'אימון ריצה%' OR title = 'ריצה'\)/);
    assert.deepEqual(call.values, ['2026-11-22T22:00:00.000Z', '2026-11-23T22:00:00.000Z']);
  });
  test('ריצת שלישי / שישי (lib/weekly-runs.js, כותרת "ריצה") נכנסת לאימונים; "כוח" ו"התארגנות" לא', async () => {
    const sql = fakeSql(() => [{ title: 'ריצה', starts_at: new Date('2026-11-24T16:30:00Z') }]);
    assert.deepEqual(await loadTrainingsForDate('2026-11-24', { sql }), [{ title: 'ריצה', startsAt: '2026-11-24T16:30:00.000Z' }]);
    assert.ok(!/כוח|התארגנות/.test(sql.calls[0].text));
  });
  test('הסגירה: ריצת שלישי לא מופיעה פעמיים (לא באירועים), ההתארגנות שלה כן', async () => {
    const sql = fakeSql(() => [
      { title: 'התארגנות', starts_at: '2026-11-24T16:00:00Z', domain: 'running', external_id: 'p2' },
      { title: 'ריצה', starts_at: '2026-11-24T16:30:00Z', domain: 'running', external_id: 'r2' },
      { title: 'ריצה', starts_at: '2026-11-24T10:00:00Z', domain: 'personal', external_id: null },
    ]);
    const { events, externalIds } = await loadTomorrowEvents(sql, '2026-11-24');
    assert.deepEqual(events.map((e) => [e.title, e.domain]), [['התארגנות', 'running'], ['ריצה', 'personal']]);
    assert.ok(externalIds.has('r2'));
  });
  test('הסגירה: אימון ריצה לא מופיע פעמיים (לא באירועים), התארגנות כן', async () => {
    const sql = fakeSql(() => [
      { title: 'התארגנות', starts_at: '2026-11-23T15:00:00Z', domain: 'running', external_id: 'p1' },
      { title: 'אימון ריצה - משתלה', starts_at: '2026-11-23T16:00:00Z', domain: 'running', external_id: 'r1' },
    ]);
    const { events, externalIds } = await loadTomorrowEvents(sql, '2026-11-23');
    assert.deepEqual(events.map((e) => e.title), ['התארגנות']);
    assert.ok(externalIds.has('r1'), 'העותק ב-Google עדיין מסונן');
  });
});

describe('בלוק 4: אימון ריצה הוא מועמד לזיהוי (תיקון "האימון של רביעי בוטל")', () => {
  test('loadEventPool מחזיר אירוע running עם מפתח source:...:fitness', async () => {
    const sql = fakeSql(() => [{
      id: RUN_ID, title: 'אימון ריצה - משתלה', domain: 'running', match_key: `source:${SRC_ID}:fitness:2026-11-25:run`, start_date: '2026-11-25', start_time: '18:00',
    }]);
    const pool = await loadEventPool(sql, new Date('2026-11-24T10:00:00Z'));
    assert.equal(pool.length, 1);
    assert.equal(pool[0].domain, 'running');
    assert.equal(pool[0].sourceId, `${SRC_ID}:fitness:2026-11-25:run`, 'הכתיבה ליומן אחרי זיהוי מוצאת את המפתח המלא');
  });
});
