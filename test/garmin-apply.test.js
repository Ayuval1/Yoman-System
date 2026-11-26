// בדיקות ל-lib/garmin-apply.js (בלוק 5: Garmin מול אימוני 4fitness) ולחיבור שלו בסוף lib/ops/garmin-sync.js.
// בלי רשת ובלי מסד: sql מזויף ו-syncEvents מוזרק. כל הכותרות והמזהים מומצאים.
// ה-SQL לא רץ מול Postgres: הבדיקות מוודאות את התוכנית (טהורה), את הפרמטרים של פקודת הכתיבה ואת הזרימה.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { captureConsole, fakeSql } from './helpers.js';
import {
  applyGarminItems, planGarminApply, isRunningItem, pushNow, MONDAY_CONTENT_TEXT, STRENGTH_TITLE, CONTENT_ENTITY,
} from '../lib/garmin-apply.js';
import { eventBody } from '../lib/event-sync.js';

// שני 23.11.2026, 13:00 בישראל (UTC+2). 18:00 בישראל = 16:00Z.
const MON = '2026-11-23';
const WED = '2026-11-25';
const NOW = new Date('2026-11-23T11:00:00.000Z');
const FETCHED = NOW.toISOString();
const OLD_FETCH = '2026-11-22T13:00:00.000Z';
const RUN_KEY_MON = `source:s1:fitness:${MON}:run`;
const RUN_KEY_WED = `source:s1:fitness:${WED}:run`;
const ID_MON = '11111111-1111-4111-8111-111111111111';
const ID_WED = '22222222-2222-4222-8222-222222222222';
const ID_STR = '33333333-3333-4333-8333-333333333333';

const run = (over = {}) => ({
  id: ID_MON, title: 'אימון ריצה - משתלה', starts_at: `${MON}T16:00:00.000Z`, ends_at: `${MON}T18:00:00.000Z`,
  location: 'כתובת', description: 'ריצה לשדות + כוח', status: 'planned', match_key: RUN_KEY_MON, external_id: 'ext1', ...over,
});
const wedRun = (over = {}) => run({ id: ID_WED, starts_at: `${WED}T16:00:00.000Z`, ends_at: `${WED}T18:00:00.000Z`, description: 'כוח אחרי הריצה', match_key: RUN_KEY_WED, ...over });
const strength = (over = {}) => ({
  id: ID_STR, title: STRENGTH_TITLE, starts_at: `${MON}T16:50:00.000Z`, ends_at: `${MON}T18:00:00.000Z`, location: null, description: null,
  status: 'planned', match_key: `${RUN_KEY_MON}:strength`, external_id: 'ext2', ...over,
});
const planned = (over = {}) => ({
  garmin_id: 'cal:1', kind: 'planned', item_date: MON, title: 'אינטרוולים 6×800', sport: 'running', duration_sec: 3000, starts_at: null, fetched_at: FETCHED, ...over,
});
const doneItem = (over = {}) => ({
  garmin_id: 'act:1', kind: 'done', item_date: MON, title: 'ריצה', sport: 'running', duration_sec: 3100, starts_at: `${MON}T16:05:00.000Z`, fetched_at: FETCHED, ...over,
});
const plan = (items, events, now = NOW, fetchedAt = FETCHED) => planGarminApply({ items, events, now, fetchedAt });
const nothing = (work) => work.updates.length === 0 && work.creates.length === 0 && work.statuses.length === 0 && work.changes.length === 0;

describe('garmin-apply: זיהוי ריצה', () => {
  test('ענף ספורט עם run = ריצה; ענף אחר = לא, גם כשבכותרת "ריצה"; בלי ענף = לפי הכותרת', () => {
    assert.equal(isRunningItem({ sport: 'running', title: null }), true);
    assert.equal(isRunningItem({ sport: 'trail_running', title: 'x' }), true);
    assert.equal(isRunningItem({ sport: 'cycling', title: 'ריצה' }), false);
    assert.equal(isRunningItem({ sport: 'strength_training', title: 'כוח' }), false);
    assert.equal(isRunningItem({ sport: null, title: 'ריצה קלה' }), true);
    assert.equal(isRunningItem({ sport: null, title: 'אינטרוולים' }), false);
  });
});

describe('garmin-apply: אורך הריצה ותוכן (שני ורביעי)', () => {
  test('שני עם אימון ב-Garmin: הריצה מסתיימת לפי המשך, התוכן מתווסף לתיאור, "כוח" מסוף הריצה עד 20:00, ובועה', () => {
    const work = plan([planned()], [run()]);
    assert.deepEqual(work.updates, [{
      id: ID_MON, starts_at: `${MON}T16:00:00.000Z`, ends_at: `${MON}T16:50:00.000Z`, description: 'ריצה לשדות + כוח · אינטרוולים 6×800',
      old_starts_at: `${MON}T16:00:00.000Z`, old_ends_at: `${MON}T18:00:00.000Z`, old_description: 'ריצה לשדות + כוח',
    }]);
    assert.deepEqual(work.creates, [{ title: STRENGTH_TITLE, starts_at: `${MON}T16:50:00.000Z`, ends_at: `${MON}T18:00:00.000Z`, match_key: `${RUN_KEY_MON}:strength` }]);
    assert.deepEqual(work.changes, [
      { entity_id: ID_MON, field: 'ends_at', old_value: `${MON} 20:00`, new_value: `${MON} 18:50` },
      { entity_id: ID_MON, field: 'description', old_value: 'ריצה לשדות + כוח', new_value: 'ריצה לשדות + כוח · אינטרוולים 6×800' },
    ]);
    assert.deepEqual(work.bubbles, [{ entity_id: ID_MON, body: 'נוסף תוכן לאימון היום: אינטרוולים 6×800. לסנכרן את השעון.' }]);
    assert.equal(MONDAY_CONTENT_TEXT('X'), 'נוסף תוכן לאימון היום: X. לסנכרן את השעון.');
    assert.deepEqual(work.keys.sort(), [RUN_KEY_MON, `${RUN_KEY_MON}:strength`].sort());
    assert.deepEqual(work.patchKeys, [RUN_KEY_MON]);
  });

  test('אין אימון ב-Garmin: לא משתנה כלום (18:00–20:00, בלי שאלה), בלי בועה', () => {
    const work = plan([], [run(), wedRun()]);
    assert.ok(nothing(work));
    assert.deepEqual(work.bubbles, []);
    assert.deepEqual(work.keys, []);
  });

  test('אימון באותו תאריך שאינו ריצה (כוח): לא משתנה כלום', () => {
    const work = plan([planned({ sport: 'strength_training', title: 'כוח' })], [run()]);
    assert.ok(nothing(work));
    assert.deepEqual(work.bubbles, []);
  });

  test('משך חסר (null): השעות לא משתנות ואין "כוח" נפרד; התוכן עדיין נכנס לתיאור', () => {
    const work = plan([planned({ duration_sec: null })], [run()]);
    assert.equal(work.updates.length, 1);
    assert.equal(work.updates[0].ends_at, `${MON}T18:00:00.000Z`);
    assert.equal(work.updates[0].description, 'ריצה לשדות + כוח · אינטרוולים 6×800');
    assert.deepEqual(work.creates, []);
    assert.deepEqual(work.changes.map((c) => c.field), ['description']);
  });

  test('משך חסר ובלי כותרת: אין מה להוסיף, לא משתנה כלום ואין בועה', () => {
    const work = plan([planned({ duration_sec: null, title: null, sport: 'running' })], [run()]);
    assert.ok(nothing(work));
    assert.deepEqual(work.bubbles, []);
  });

  test('כבר הוחל (אותו תוכן, אותו משך, "כוח" קיים): אין עדכון, אין יצירה ואין שורות changes', () => {
    const work = plan([planned()], [run({ ends_at: `${MON}T16:50:00.000Z`, description: 'ריצה לשדות + כוח · אינטרוולים 6×800' }), strength()]);
    assert.ok(nothing(work));
    assert.deepEqual(work.keys, []);
  });

  test('התוכן ב-Garmin השתנה: התוכן הישן (פריט שלא נמשך בריצה הזאת) מוחלף, לא מתווסף פעמיים', () => {
    const items = [planned({ garmin_id: 'cal:0', title: 'ישן', fetched_at: OLD_FETCH }), planned({ title: 'חדש' })];
    const work = plan(items, [run({ ends_at: `${MON}T16:50:00.000Z`, description: 'ריצה לשדות + כוח · ישן' }), strength()]);
    assert.equal(work.updates.length, 1);
    assert.equal(work.updates[0].description, 'ריצה לשדות + כוח · חדש');
  });

  test('פריט ישן (fetched_at לפני המשיכה הזאת) לבד = נמחק אצל המאמן: לא נחשב, לא משתנה כלום', () => {
    const work = plan([planned({ fetched_at: OLD_FETCH })], [run()]);
    assert.ok(nothing(work));
  });

  test('כפילות בין ריצות (אותו תאריך ואותה כותרת, מזהים שונים) = אימון אחד', () => {
    const items = [planned({ garmin_id: 'cal:1' }), planned({ garmin_id: 'sched:1' })];
    const work = plan(items, [run()]);
    assert.equal(work.updates.length, 1);
    assert.equal(work.updates[0].description, 'ריצה לשדות + כוח · אינטרוולים 6×800');
  });

  test('שתי ריצות שונות באותו תאריך: לא ברור איזו, לא משתנה כלום', () => {
    const items = [planned(), planned({ garmin_id: 'cal:2', title: 'אחר' })];
    const work = plan(items, [run()]);
    assert.ok(nothing(work));
    assert.equal(work.skipped.ambiguous, 1);
  });

  test('בלי "כוח" בלוז: הריצה מתקצרת ואין אירוע כוח; אירוע כוח קיים מבוטל', () => {
    const plain = plan([planned()], [run({ description: null })]);
    assert.equal(plain.updates[0].ends_at, `${MON}T16:50:00.000Z`);
    assert.equal(plain.updates[0].description, 'אינטרוולים 6×800');
    assert.deepEqual(plain.creates, []);
    const withOld = plan([planned()], [run({ description: null }), strength()]);
    assert.deepEqual(withOld.statuses, [{ id: ID_STR, status: 'cancelled' }]);
    assert.ok(withOld.changes.some((c) => c.entity_id === ID_STR && c.field === 'status' && c.new_value === 'cancelled'));
    assert.ok(withOld.keys.includes(`${RUN_KEY_MON}:strength`));
  });

  test('שעת סיום מפורשת בלוז (19:30) עם "כוח": הכוח עד 19:30', () => {
    const work = plan([planned()], [run({ ends_at: `${MON}T17:30:00.000Z` })]);
    assert.equal(work.creates[0].ends_at, `${MON}T17:30:00.000Z`);
  });

  test('הכוח קיים ומשך הריצה השתנה: עדכון שעת ההתחלה של הכוח בלבד (patch)', () => {
    const work = plan([planned({ duration_sec: 3600 })], [run({ ends_at: `${MON}T16:50:00.000Z`, description: 'ריצה לשדות + כוח · אינטרוולים 6×800' }), strength()]);
    const str = work.updates.find((u) => u.id === ID_STR);
    assert.equal(str.starts_at, `${MON}T17:00:00.000Z`);
    assert.equal(str.ends_at, `${MON}T18:00:00.000Z`);
    assert.ok(work.patchKeys.includes(`${RUN_KEY_MON}:strength`));
  });

  test('ריצה שמסתיימת אחרי 20:00: אין אירוע כוח', () => {
    const work = plan([planned({ duration_sec: 9000 })], [run()]);
    assert.equal(work.updates[0].ends_at, `${MON}T18:30:00.000Z`);
    assert.deepEqual(work.creates, []);
  });

  test('אימון שבוטל: לא נוגעים בו, ואירוע כוח שנשאר מתוכנן מבוטל איתו', () => {
    const work = plan([planned()], [run({ status: 'cancelled' }), strength()]);
    assert.deepEqual(work.updates, []);
    assert.deepEqual(work.creates, []);
    assert.deepEqual(work.bubbles, []);
    assert.deepEqual(work.statuses, [{ id: ID_STR, status: 'cancelled' }]);
  });

  test('אימון שכבר התחיל: לא משתנה ואין בועה', () => {
    const work = plan([planned()], [run()], new Date(`${MON}T16:30:00.000Z`));
    assert.ok(nothing(work));
    assert.deepEqual(work.bubbles, []);
  });

  test('רביעי: אותו עדכון (כוח אחרי הריצה), בלי בועה (נכנס לסגירה)', () => {
    const work = plan([planned({ item_date: WED, title: 'טמפו' })], [wedRun()]);
    assert.equal(work.updates[0].ends_at, `${WED}T16:50:00.000Z`);
    assert.equal(work.updates[0].description, 'כוח אחרי הריצה · טמפו');
    assert.equal(work.creates[0].match_key, `${RUN_KEY_WED}:strength`);
    assert.deepEqual(work.bubbles, []);
  });

  test('בועת שני רק לאימון של היום: תוכן לשני הבא (שבוע אחר) לא שולח בועה', () => {
    const work = plan([planned()], [run()], new Date('2026-11-16T11:00:00.000Z'), FETCHED);
    assert.equal(work.updates.length, 1);
    assert.deepEqual(work.bubbles, []);
  });

  test('בלי כותרת אבל עם משך: הבועה אומרת את האורך', () => {
    const work = plan([planned({ title: null })], [run()]);
    assert.equal(work.bubbles[0].body, "נוסף תוכן לאימון היום: ריצה 50 דק'. לסנכרן את השעון.");
    assert.equal(work.updates[0].description, 'ריצה לשדות + כוח');
  });

  test('אירוע שאינו אימון 4fitness (מפתח אחר) לא נוגעים בו', () => {
    const work = plan([planned()], [run({ match_key: 'source:s9' })]);
    assert.ok(nothing(work));
  });
});

describe('garmin-apply: אימון שבוצע', () => {
  const TUE = new Date('2026-11-24T10:00:00.000Z');
  const tueFetched = TUE.toISOString();

  test('ריצה שבוצעה באותו יום, אחרי שעה לפני ההתחלה: האימון מסומן done עם שורת changes', () => {
    const work = plan([doneItem({ fetched_at: tueFetched })], [run()], TUE, tueFetched);
    assert.deepEqual(work.statuses, [{ id: ID_MON, status: 'done' }]);
    assert.deepEqual(work.changes, [{ entity_id: ID_MON, field: 'status', old_value: 'planned', new_value: 'done' }]);
    assert.deepEqual(work.keys, []);
  });

  test('אימון שבוטל לא מסומן done', () => {
    const work = plan([doneItem({ fetched_at: tueFetched })], [run({ status: 'cancelled' })], TUE, tueFetched);
    assert.deepEqual(work.statuses, []);
  });

  test('ריצת בוקר (יותר משעה לפני האימון), פעילות שאינה ריצה, או בלי שעה: לא מסומן', () => {
    for (const item of [
      doneItem({ starts_at: `${MON}T04:00:00.000Z`, fetched_at: tueFetched }),
      doneItem({ sport: 'strength_training', fetched_at: tueFetched }),
      doneItem({ starts_at: null, fetched_at: tueFetched }),
    ]) {
      assert.deepEqual(plan([item], [run()], TUE, tueFetched).statuses, []);
    }
  });

  test('כבר done: לא נוגעים', () => {
    const work = plan([doneItem({ fetched_at: tueFetched })], [run({ status: 'done' })], TUE, tueFetched);
    assert.ok(nothing(work));
  });
});

describe('garmin-apply: applyGarminItems (מסד ויומן)', () => {
  const sqlFor = ({ items = [], events = [], write = [{ updated: 1 }], fail } = {}) => fakeSql((text) => {
    if (fail && text.includes(fail.marker)) throw fail.error;
    if (text.includes('/* garmin-apply-items */')) return items;
    if (text.includes('/* garmin-apply-events */')) return events;
    if (text.includes('/* garmin-apply-write */')) return write;
    return [];
  });
  const spySync = (result = { created: 1, patched: 1, deleted: 0, failed: 0, skipped: 0 }) => {
    const calls = [];
    const fn = async (args) => {
      calls.push(args);
      return result;
    };
    fn.calls = calls;
    return fn;
  };

  test('שני: פקודת כתיבה אחת (עדכון, יצירת כוח, changes, בועה עם NOT EXISTS), ואז סנכרון ליומן לפי המפתחות', async () => {
    const sql = sqlFor({ items: [planned()], events: [run()] });
    const syncEvents = spySync();
    const result = await applyGarminItems({ sql, now: NOW, fetchedAt: FETCHED, syncEvents });
    assert.equal(result.ok, true);
    const [write] = sql.find('/* garmin-apply-write */');
    assert.ok(write.text.includes('UPDATE events'));
    assert.ok(write.text.includes('INSERT INTO events'));
    assert.ok(write.text.includes('WHERE NOT EXISTS (SELECT 1 FROM events x WHERE x.match_key = c.match_key)'));
    assert.ok(write.text.includes('INSERT INTO changes'));
    assert.ok(write.text.includes(`x.entity_type = '${CONTENT_ENTITY}'`));
    assert.ok(write.text.includes("events.status = 'planned'"));
    const json = write.values.filter((v) => typeof v === 'string' && v.startsWith('[')).map((v) => JSON.parse(v));
    assert.ok(json.some((list) => list.some((u) => u.id === ID_MON && u.ends_at === `${MON}T16:50:00.000Z`)));
    assert.ok(json.some((list) => list.some((m) => m.body === MONDAY_CONTENT_TEXT('אינטרוולים 6×800'))));
    assert.equal(syncEvents.calls.length, 1);
    assert.deepEqual(syncEvents.calls[0].patchKeys, [RUN_KEY_MON]);
    assert.ok(syncEvents.calls[0].keys.includes(`${RUN_KEY_MON}:strength`));
    assert.equal(syncEvents.calls[0].sql, sql);
  });

  test('השאילתה על Garmin מביאה את חלון הריצה (היום פחות 2 עד היום פלוס 15); אירועים לפי טווח זמן', async () => {
    const sql = sqlFor();
    await applyGarminItems({ sql, now: NOW, fetchedAt: FETCHED, syncEvents: spySync() });
    const [items] = sql.find('/* garmin-apply-items */');
    assert.ok(items.values.includes('2026-11-21'));
    assert.ok(items.values.includes('2026-12-08'));
    const [events] = sql.find('/* garmin-apply-events */');
    assert.ok(events.text.includes("domain = 'running'"));
  });

  test('אין מה לעשות: בלי פקודת כתיבה ובלי סנכרון', async () => {
    const sql = sqlFor({ items: [], events: [run()] });
    const syncEvents = spySync();
    const result = await applyGarminItems({ sql, now: NOW, fetchedAt: FETCHED, syncEvents });
    assert.equal(result.ok, true);
    assert.equal(sql.find('/* garmin-apply-write */').length, 0);
    assert.equal(syncEvents.calls.length, 0);
  });

  test('done בלבד: נכתב, בלי סנכרון ליומן (אין שינוי ב-Google)', async () => {
    const TUE = new Date('2026-11-24T10:00:00.000Z');
    const sql = sqlFor({ items: [doneItem({ fetched_at: TUE.toISOString() })], events: [run()] });
    const syncEvents = spySync();
    await applyGarminItems({ sql, now: TUE, fetchedAt: TUE.toISOString(), syncEvents });
    assert.equal(sql.find('/* garmin-apply-write */').length, 1);
    assert.equal(syncEvents.calls.length, 0);
  });

  test('טבלה חסרה או כשל מסד: לא זורק, מחזיר קוד', async (t) => {
    captureConsole(t);
    const missing = Object.assign(new Error('relation "garmin_items" does not exist'), { code: '42P01' });
    const a = await applyGarminItems({ sql: sqlFor({ fail: { marker: 'garmin-apply-items', error: missing } }), now: NOW, fetchedAt: FETCHED, syncEvents: spySync() });
    assert.deepEqual(a, { ok: false, reason: 'table_missing' });
    const b = await applyGarminItems({ sql: sqlFor({ items: [planned()], events: [run()], fail: { marker: 'garmin-apply-write', error: new Error('boom') } }), now: NOW, fetchedAt: FETCHED, syncEvents: spySync() });
    assert.deepEqual(b, { ok: false, reason: 'db_error' });
  });

  test('סנכרון ליומן שזורק: לא זורק, הכתיבה למסד נשארת', async (t) => {
    captureConsole(t);
    const sql = sqlFor({ items: [planned()], events: [run()] });
    const result = await applyGarminItems({ sql, now: NOW, fetchedAt: FETCHED, syncEvents: async () => { throw new Error('x'); } });
    assert.equal(result.ok, true);
    assert.equal(result.sync, 'crashed');
  });
});

describe('garmin-apply: אירוע הכוח מתרפא בריצה הבאה', () => {
  test('אימון שכבר קוצר בלי אירוע כוח (נמחק): נוצר כוח מסוף הריצה עד 20:00', () => {
    const work = plan([planned()], [run({ ends_at: `${MON}T16:50:00.000Z`, description: 'ריצה לשדות + כוח · אינטרוולים 6×800' })]);
    assert.deepEqual(work.updates, []);
    assert.deepEqual(work.creates, [{ title: STRENGTH_TITLE, starts_at: `${MON}T16:50:00.000Z`, ends_at: `${MON}T18:00:00.000Z`, match_key: `${RUN_KEY_MON}:strength` }]);
  });

  test('לוז חדש החזיר את האימון לשעות שלו (סוף מפורש 19:30) והכוח הישן עד 20:00: הכוח מתעדכן לפי הלוז', () => {
    const work = plan([planned()], [run({ ends_at: `${MON}T17:30:00.000Z` }), strength()]);
    assert.equal(work.updates.find((u) => u.id === ID_MON).ends_at, `${MON}T16:50:00.000Z`);
    const str = work.updates.find((u) => u.id === ID_STR);
    assert.equal(str.ends_at, `${MON}T17:30:00.000Z`);
  });
});

// problem-log 2026-11-22: כוח שבוטל אוטומטית כי הריצה ב-Garmin התארכה, חוזר כשהריצה מתקצרת שוב.
describe('garmin-apply: כוח שבוטל אוטומטית חוזר כשהריצה מתקצרת', () => {
  const STR_KEY = `${RUN_KEY_MON}:strength`;
  // מסד בזיכרון שמדמה את פקודת הכתיבה (writeWork): כל התנאים נבדקים מול המצב שלפני הפקודה (כמו CTE ב-Postgres), ואז מוחלים.
  // auto_cancelled = שורת ה-status האחרונה ב-changes היא ביטול של המערכת בלי מקור (כמו תת-השאילתה ב-applyGarminItems).
  const makeDb = (events) => ({ events: events.map((e) => ({ ...e })), changes: [], seq: 0 });
  const loadEvents = (db) => db.events.map((row) => {
    const last = db.changes.filter((c) => c.entity_id === row.id && c.field === 'status').at(-1);
    return { ...row, auto_cancelled: row.status === 'cancelled' && Boolean(last) && last.source_id === null && last.changed_by === 'system' && last.new_value === 'cancelled' };
  });
  const write = (db, work) => {
    const before = db.events.map((e) => ({ ...e }));
    const byId = (id) => db.events.find((e) => e.id === id);
    const touched = new Set();
    for (const u of work.updates) {
      const row = before.find((e) => e.id === u.id);
      if (row && row.status === 'planned' && row.starts_at === u.old_starts_at && row.ends_at === u.old_ends_at && (row.description ?? '') === (u.old_description ?? '')) {
        Object.assign(byId(u.id), { starts_at: u.starts_at, ends_at: u.ends_at, description: u.description });
        touched.add(u.id);
      }
    }
    for (const c of work.creates) {
      if (before.some((e) => e.match_key === c.match_key)) continue;
      db.seq += 1;
      db.events.push({ id: `new-${db.seq}`, title: c.title, starts_at: c.starts_at, ends_at: c.ends_at, location: null, description: null, status: 'planned', match_key: c.match_key, external_id: null });
    }
    for (const r of work.restores ?? []) {
      const old = before.find((e) => e.id === r.old_id);
      if (!old || old.status !== 'cancelled' || old.match_key !== r.match_key) continue;
      byId(r.old_id).match_key = r.replaced_key;
      touched.add(r.old_id);
      if (before.some((e) => e.match_key === r.match_key && e.id !== r.old_id)) continue;
      db.seq += 1;
      db.events.push({ id: `new-${db.seq}`, title: r.title, starts_at: r.starts_at, ends_at: r.ends_at, location: null, description: null, status: 'planned', match_key: r.match_key, external_id: null });
    }
    for (const s of work.statuses) {
      if (before.find((e) => e.id === s.id)?.status !== 'planned') continue;
      byId(s.id).status = s.status;
      touched.add(s.id);
    }
    for (const x of work.changes) if (touched.has(x.entity_id)) db.changes.push({ ...x, source_id: null, changed_by: 'system' });
  };
  // Garmin מחזיר אימון אחד באורך minutes; כל משיכה עם חותמת משלה (fetched_at).
  let tick = 0;
  const pull = (db, minutes) => {
    tick += 1;
    const fetchedAt = new Date(NOW.getTime() + tick * 1000).toISOString();
    const work = plan([planned({ duration_sec: minutes * 60, fetched_at: fetchedAt })], loadEvents(db), NOW, fetchedAt);
    write(db, work);
    return work;
  };
  const strengths = (db) => db.events.filter((e) => e.match_key === STR_KEY);
  const runRow = (db) => db.events.find((e) => e.id === ID_MON);

  test('הריצה התארכה עד אחרי 20:00 (כוח בוטל) ואז Garmin קיצר ל-60 דק\': הכוח חוזר 19:00-20:00, פעם אחת', () => {
    const db = makeDb([run()]);
    pull(db, 50);
    assert.equal(strengths(db).length, 1);
    pull(db, 150); // 18:00-20:30: אין מקום לכוח
    assert.equal(runRow(db).ends_at, `${MON}T18:30:00.000Z`);
    assert.equal(strengths(db)[0].status, 'cancelled');

    const work = pull(db, 60);
    assert.equal(runRow(db).ends_at, `${MON}T17:00:00.000Z`);
    const live = strengths(db);
    assert.equal(live.length, 1, 'שורה אחת בלבד במפתח הכוח');
    assert.equal(live[0].status, 'planned');
    assert.equal(live[0].title, STRENGTH_TITLE);
    assert.equal(live[0].starts_at, `${MON}T17:00:00.000Z`);
    assert.equal(live[0].ends_at, `${MON}T18:00:00.000Z`);
    assert.equal(live[0].external_id, null, 'שורה חדשה: event-sync יוצר אותה ב-Google במזהה חדש');
    assert.ok(work.keys.includes(STR_KEY), 'המפתח עובר לכתיבה ליומן');
    assert.ok(!work.patchKeys.includes(STR_KEY));
    // השורה המבוטלת נשארת מבוטלת, עם מפתח אחר (כדי שהמפתח יהיה פנוי לשורה החדשה), ושורת changes על החלפת המפתח.
    const old = db.events.find((e) => e.id !== live[0].id && e.title === STRENGTH_TITLE);
    assert.equal(old.status, 'cancelled');
    assert.notEqual(old.match_key, STR_KEY);
    assert.ok(db.changes.some((c) => c.entity_id === old.id && c.field === 'match_key' && c.old_value === STR_KEY && c.new_value === old.match_key));

    // פעמיים ושלוש: אין עוד שורה, אין היפוך.
    for (let i = 0; i < 2; i += 1) {
      const again = pull(db, 60);
      assert.deepEqual(again.restores, []);
      assert.ok(nothing(again));
    }
    assert.equal(db.events.filter((e) => e.title === STRENGTH_TITLE && e.status === 'planned').length, 1);
  });

  test('סוף מפורש בלוז (19:30) נשמר גם אחרי ביטול והחזרה', () => {
    const db = makeDb([run({ ends_at: `${MON}T17:30:00.000Z` })]);
    pull(db, 50);
    assert.equal(strengths(db)[0].ends_at, `${MON}T17:30:00.000Z`);
    pull(db, 120); // 18:00-20:00: אחרי 19:30
    assert.equal(strengths(db)[0].status, 'cancelled');
    pull(db, 60);
    const [live] = strengths(db);
    assert.equal(live.status, 'planned');
    assert.equal(live.starts_at, `${MON}T17:00:00.000Z`);
    assert.equal(live.ends_at, `${MON}T17:30:00.000Z`);
  });

  test('ביטול שלא נעשה אוטומטית כאן (יובל ביטל, או ביטול עם מקור): הכוח לא חוזר', () => {
    const shortRun = run({ ends_at: `${MON}T18:30:00.000Z`, description: 'ריצה לשדות + כוח · אינטרוולים 6×800' });
    for (const auto of [false, undefined]) {
      const work = plan([planned({ duration_sec: 3600 })], [shortRun, strength({ status: 'cancelled', ends_at: `${MON}T18:00:00.000Z`, auto_cancelled: auto })]);
      assert.deepEqual(work.restores, []);
      assert.deepEqual(work.creates, []);
      assert.equal(work.skipped.strength_closed, 1);
    }
  });

  test('בוטל אוטומטית אבל הלוז כבר בלי "כוח": לא חוזר', () => {
    const work = plan([planned({ duration_sec: 3600 })], [
      run({ ends_at: `${MON}T18:30:00.000Z`, description: 'ריצה לשדות · אינטרוולים 6×800' }),
      strength({ status: 'cancelled', auto_cancelled: true }),
    ]);
    assert.deepEqual(work.restores, []);
  });

  test('אימון שבוטל (מנוחה): כוח שבוטל אוטומטית לא חוזר', () => {
    const work = plan([planned({ duration_sec: 3600 })], [run({ status: 'cancelled' }), strength({ status: 'cancelled', auto_cancelled: true })]);
    assert.deepEqual(work.restores, []);
    assert.deepEqual(work.creates, []);
  });

  test('applyGarminItems: השאילתה מביאה auto_cancelled מ-changes, והפקודה מחליפה מפתח ויוצרת שורה חדשה; המפתח נשלח ליומן', async () => {
    const events = [
      run({ ends_at: `${MON}T18:30:00.000Z`, description: 'ריצה לשדות + כוח · אינטרוולים 6×800' }),
      strength({ status: 'cancelled', starts_at: `${MON}T16:50:00.000Z`, ends_at: `${MON}T18:00:00.000Z`, auto_cancelled: true }),
    ];
    const sql = fakeSql((text) => {
      if (text.includes('/* garmin-apply-items */')) return [planned({ duration_sec: 3600 })];
      if (text.includes('/* garmin-apply-events */')) return events;
      if (text.includes('/* garmin-apply-write */')) return [{ updated: 1, created: 1 }];
      return [];
    });
    const calls = [];
    const result = await applyGarminItems({ sql, now: NOW, fetchedAt: FETCHED, syncEvents: async (args) => { calls.push(args); return { created: 1 }; } });
    assert.equal(result.ok, true);
    const [read] = sql.find('/* garmin-apply-events */');
    assert.ok(read.text.includes('FROM changes'));
    assert.ok(read.text.includes('auto_cancelled'));
    const [w] = sql.find('/* garmin-apply-write */');
    assert.ok(w.text.includes('SET match_key = r.replaced_key'));
    assert.ok(w.text.includes("events.status = 'cancelled'"));
    const json = w.values.filter((v) => typeof v === 'string' && v.startsWith('[')).map((v) => JSON.parse(v));
    assert.ok(json.some((list) => list.some((r) => r.old_id === ID_STR && r.match_key === STR_KEY && r.starts_at === `${MON}T17:00:00.000Z` && r.ends_at === `${MON}T18:00:00.000Z`)));
    assert.ok(calls[0].keys.includes(STR_KEY));
  });
});

describe('garmin-apply: דחיפה מיידית אחרי בועה', () => {
  const sqlWrite = (write, items = [planned()], events = [run()]) => fakeSql((text) => {
    if (text.includes('/* garmin-apply-items */')) return items;
    if (text.includes('/* garmin-apply-events */')) return events;
    if (text.includes('/* garmin-apply-write */')) return write;
    return [];
  });
  const spyPush = () => {
    const calls = [];
    const fn = async (args) => {
      calls.push(args);
      return { sent: true };
    };
    fn.calls = calls;
    return fn;
  };
  const noSync = async () => ({ created: 0, patched: 0, deleted: 0, failed: 0, skipped: 0 });

  test('בועה נכתבה בפועל: דחיפה אחת', async () => {
    const sql = sqlWrite([{ updated: 1, bubbles_written: 1 }]);
    const push = spyPush();
    const result = await applyGarminItems({ sql, now: NOW, fetchedAt: FETCHED, syncEvents: noSync, push });
    assert.equal(push.calls.length, 1);
    assert.equal(push.calls[0].sql, sql);
    assert.equal(result.push, 'sent');
  });

  test('הבועה כבר קיימת (NOT EXISTS דילג, 0 נכתבו): בלי דחיפה', async () => {
    const push = spyPush();
    await applyGarminItems({ sql: sqlWrite([{ updated: 0, bubbles_written: 0 }]), now: NOW, fetchedAt: FETCHED, syncEvents: noSync, push });
    assert.equal(push.calls.length, 0);
  });

  test('רביעי: אין בועה ואין דחיפה', async () => {
    const push = spyPush();
    const sql = sqlWrite([{ updated: 1, bubbles_written: 0 }], [planned({ item_date: WED })], [wedRun()]);
    await applyGarminItems({ sql, now: NOW, fetchedAt: FETCHED, syncEvents: noSync, push });
    const [write] = sql.find('/* garmin-apply-write */');
    assert.ok(write.values.includes('[]'), 'רשימת הבועות ריקה');
    assert.equal(push.calls.length, 0);
  });

  test('pushNow: sendChatNotification עם מפתח חלון האגוד והסוד; כשל = קוד בלבד, לא זורק', async (t) => {
    const log = captureConsole(t);
    const seen = [];
    const ok = await pushNow({ sql: fakeSql(), now: NOW, secret: 'cron-x', notify: async (args) => { seen.push(args); return { sent: true }; } });
    assert.deepEqual(ok, { sent: true, reason: null });
    assert.match(seen[0].slotKey, /^notify-\d+$/);
    assert.equal(seen[0].secret, 'cron-x');
    const noSecret = await pushNow({ sql: fakeSql(), now: NOW, secret: undefined, notify: async () => ({ sent: false, reason: 'no-secret' }) });
    assert.equal(noSecret.sent, false);
    const crashed = await pushNow({ sql: fakeSql(), now: NOW, notify: async () => { throw new Error('אינטרוולים'); } });
    assert.deepEqual(crashed, { sent: false, reason: 'error' });
    assert.ok(log.text().includes('no-secret'));
    assert.ok(!log.text().includes('אינטרוולים'));
  });

  test('pushNow: חלון "לא זמין" (unavailable) או אין מה להודיע: לא נרשם ככשל', async (t) => {
    const log = captureConsole(t);
    for (const reason of ['unavailable', 'badge-zero', 'nothing-unseen']) {
      await pushNow({ sql: fakeSql(), now: NOW, secret: 's', notify: async () => ({ sent: false, reason }) });
    }
    assert.equal(log.lines.length, 0);
  });
});

describe('event-sync: אירוע "כוח" בתחום running', () => {
  test('כמו התארגנות: כותרת ושעות בלבד, בלי צבע ותזכורות של האימון', () => {
    const body = eventBody({ ...strength(), domain: 'running' });
    assert.deepEqual(Object.keys(body), ['summary', 'start', 'end']);
  });
});
