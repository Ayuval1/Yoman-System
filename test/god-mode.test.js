// בדיקות ל-lib/god-mode.js (בלוק 8, פריט 14; ש4 = א': מבחן שהוקדם ושבוע עם יותר משני מבחנים). בלי רשת ובלי מסד.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql } from './helpers.js';
import { movedEarlier, busyWeeks, cardText, validExtra, runGodMode, GOD_MODE_ENTITY } from '../lib/god-mode.js';

const TODAY = '2026-11-23'; // שני
const EXAMS = [
  { date: '2026-11-26', type: 'מבחן', subject: 'מתמטיקה' },
  { date: '2026-12-01', type: 'מבחן', subject: 'מדעים' },
  { date: '2026-12-02', type: 'מבדק', subject: 'ערבית' },
  { date: '2026-12-03', type: 'מבחן', subject: 'ספרות' },
  { date: '2026-12-02', type: 'מועד ב\'', subject: null, makeup: true },
  { date: '2027-01-10', type: 'מבחן', subject: 'אנגלית' },
];

describe('god-mode: ממצאים (טהור)', () => {
  test('מבחן שהוקדם: רק הזזה למועד מוקדם יותר ועתידי; השינוי האחרון גובר', () => {
    const changes = [
      { link: 'exam:2026-12-03:ספרות', type: 'move', newDate: '2026-11-25' },
      { link: 'exam:2026-11-26:מתמטיקה', type: 'move', newDate: '2026-11-30' }, // נדחה, לא הוקדם
      { link: 'exam:2027-01-10:אנגלית', type: 'move', newDate: '2026-12-20' },
      { link: 'exam:2027-01-10:אנגלית', type: 'move', newDate: null }, // האחרון: בלי מועד
    ];
    const found = movedEarlier({ todayIso: TODAY, changes, exams: EXAMS });
    assert.deepEqual(found.map((f) => f.key), ['moved:exam:2026-12-03:ספרות:2026-11-25']);
    assert.equal(found[0].from, '2026-12-03');
  });
  test('הקדמה ליום שכבר עבר או להיום: לא ממצא', () => {
    assert.equal(movedEarlier({ todayIso: TODAY, changes: [{ link: 'exam:2026-12-03:ספרות', type: 'move', newDate: TODAY }], exams: EXAMS }).length, 0);
  });
  test('שבוע עם שלושה מבחנים ומעלה (בלי מועד ב\'), בטווח 14 יום', () => {
    const found = busyWeeks({ todayIso: TODAY, exams: EXAMS });
    assert.deepEqual(found.map((f) => f.key), ['busy-week:2026-11-29:3']);
    assert.deepEqual(found[0].exams.map((e) => e.subject), ['מדעים', 'ערבית', 'ספרות']);
  });
  test('שבוע עם שני מבחנים, או רחוק מ-14 יום: לא ממצא', () => {
    assert.equal(busyWeeks({ todayIso: TODAY, exams: EXAMS.slice(0, 3) }).length, 0);
    assert.equal(busyWeeks({ todayIso: '2026-11-01', exams: EXAMS }).length, 0);
  });
  test('הכרטיס: ממצאים, אפשרויות, ו"לא שיניתי כלום"', () => {
    const [week] = busyWeeks({ todayIso: TODAY, exams: EXAMS });
    const text = cardText(week, { todayIso: TODAY });
    assert.match(text, /^סקירה: 3 מבחנים בשבוע של 29\.11/);
    assert.match(text, /· שלישי 1\.12: מבחן במדעים/);
    assert.match(text, /אפשרויות:/);
    assert.match(text, /לא שיניתי כלום ביומן\.$/);
    const [moved] = movedEarlier({ todayIso: TODAY, changes: [{ link: 'exam:2026-12-03:ספרות', type: 'move', newDate: '2026-11-25' }], exams: EXAMS });
    assert.match(cardText(moved, { todayIso: TODAY }), /מבחן בספרות הוקדם מחמישי 3\.12 לרביעי 25\.11 \(עוד 2 ימים\)/);
  });
  test('validExtra: מחרוזת קצרה בעברית או null; בלי קישור, שורה חדשה או אורך יתר', () => {
    assert.ok(validExtra({ extra_option: 'לבקש מהמורה דף חזרה' }));
    assert.ok(validExtra({ extra_option: null }));
    assert.ok(!validExtra({}));
    assert.ok(!validExtra({ extra_option: 'see https://x.y' }));
    assert.ok(!validExtra({ extra_option: 'שורה\nשנייה' }));
    assert.ok(!validExtra({ extra_option: 'א'.repeat(141) }));
    assert.ok(!validExtra({ extra_option: 'english only' }));
  });
});

const created = (text) => (text.includes('god-mode-create') ? [{ message_id: 'm1' }] : []);

describe('god-mode: runGodMode', () => {
  test('בלי מוח: כרטיס בקוד, פעם אחת לממצא (NOT EXISTS על העובדה), הודעת עדכון בלי כפתורים', async () => {
    const sql = fakeSql(created);
    const out = await runGodMode({ sql, todayIso: TODAY, exams: EXAMS, examsRaw: EXAMS });
    assert.deepEqual(out, { created: ['busy-week:2026-11-29:3'] });
    const [call] = sql.find('god-mode-create');
    assert.ok(call.values.includes(GOD_MODE_ENTITY));
    assert.ok(call.values.includes('busy-week:2026-11-29:3'));
    assert.match(call.text, /'update', now\(\), false/);
    assert.match(call.text, /NOT EXISTS \(SELECT 1 FROM facts p/);
  });
  test('כבר הוצג: אין כרטיס', async () => {
    const sql = fakeSql((text) => (text.includes('god-mode-shown') ? [{ value: 'busy-week:2026-11-29:3' }] : []));
    assert.deepEqual(await runGodMode({ sql, todayIso: TODAY, exams: EXAMS, examsRaw: EXAMS }), { created: [] });
  });
  test('עם מוח: רק מודל שעבר את השער (env BRAIN_PILOT=off), תשובה תקינה נוספת כשורת אפשרות', async () => {
    const sql = fakeSql(created);
    const calls = [];
    const ask = async (args) => { calls.push(args); return { ok: true, model: 'm', data: { extra_option: 'לבקש דף חזרה מהמורה' } }; };
    await runGodMode({ sql, todayIso: TODAY, exams: EXAMS, examsRaw: EXAMS, ask });
    assert.equal(calls[0].env.BRAIN_PILOT, 'off');
    assert.equal(typeof calls[0].schema, 'function');
    assert.ok(!calls[0].prompt.includes('undefined'));
    const body = sql.find('god-mode-create')[0].values.find((v) => typeof v === 'string' && v.startsWith('סקירה'));
    assert.match(body, /· לבקש דף חזרה מהמורה\nלא שיניתי כלום ביומן\.$/);
  });
  test('מוח לא זמין / תשובה לא בפורמט / זורק: הכרטיס יוצא בלי תוספת', async () => {
    for (const ask of [async () => ({ ok: false, reason: 'no-pool' }), async () => ({ ok: true, data: { extra_option: 'https://x' } }), async () => { throw new Error('x'); }]) {
      const sql = fakeSql(created);
      const out = await runGodMode({ sql, todayIso: TODAY, exams: EXAMS, examsRaw: EXAMS, ask });
      assert.equal(out.created.length, 1);
    }
  });
  test('כשל מסד לא זורק (הבריף ממשיך)', async () => {
    const sql = fakeSql(() => { throw new Error('db'); });
    assert.deepEqual(await runGodMode({ sql, todayIso: TODAY, exams: EXAMS, examsRaw: EXAMS }), { created: [] });
  });
});
