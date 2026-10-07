// בדיקות ל-api/google-webhook.js: קליטת התראות watch מ-Google (בלי גוף, הכול בכותרות).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { handle } from '../api/google-webhook.js';
import { deriveChannelToken } from '../lib/google.js';
import { fakeSql, captureConsole, req } from './helpers.js';
import { KEY, KEY_B64, assertNoSecrets } from './google-fixtures.js';

const CH = 'channel-uuid-1111-2222';
const goodToken = (id = CH, key = KEY) => deriveChannelToken(id, key);

function hook({ channel = CH, token = goodToken(), state = 'exists', num = '5', method = 'POST', body } = {}) {
  const headers = {};
  if (channel !== null) headers['x-goog-channel-id'] = channel;
  if (token !== null) headers['x-goog-channel-token'] = token;
  if (state !== null) headers['x-goog-resource-state'] = state;
  if (num !== null) headers['x-goog-message-number'] = num;
  return req('https://x.test/api/google-webhook', { method, headers, body });
}
// ערוץ קיים כברירת מחדל (last_resource_state ניתן לשינוי)
function mkSql({ row = { id: 42, last_resource_state: null }, onQuery } = {}) {
  return fakeSql((text, values, i) => {
    if (onQuery) { const r = onQuery(text, values, i); if (r !== undefined) return r; }
    if (text.includes('FROM google_watch_channels')) return row ? [row] : [];
    return [];
  });
}
const run = (r, deps = {}) => handle(r, { sql: mkSql(), encKeyRaw: KEY_B64, ...deps });
const updates = (sql) => sql.find('UPDATE google_watch_channels');
const probes = (sql) => sql.find('INSERT INTO probe_log');

describe('google-webhook: שיטה והגדרות', () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    test(`${method} - 405`, async () => assert.equal((await run(hook({ method }))).status, 405));
  }
  test('מפתח הצפנה חסר או פגום - 500 ובלי גישה למסד', async (t) => {
    const cap = captureConsole(t);
    for (const encKeyRaw of [undefined, '', 'short', randomBytes(16).toString('base64')]) {
      const sql = mkSql();
      const res = await run(hook(), { sql, encKeyRaw });
      assert.equal(res.status, 500);
      assert.equal(sql.calls.length, 0);
    }
    assert.ok(cap.lines.length >= 4);
  });
});

describe('google-webhook: זיהוי ערוץ', () => {
  test('בלי כותרת channel-id / ריקה / ארוכה מ-200 - 404 בלי מסד', async () => {
    for (const channel of [null, '', 'c'.repeat(201)]) {
      const sql = mkSql();
      assert.equal((await run(hook({ channel }), { sql })).status, 404);
      assert.equal(sql.calls.length, 0);
    }
  });
  test('channel-id באורך 200 בדיוק נבדק מול המסד', async () => {
    const id = 'c'.repeat(200);
    const sql = mkSql();
    const res = await run(hook({ channel: id, token: goodToken(id) }), { sql });
    assert.equal(res.status, 200);
  });
  test('ערוץ לא מוכר - 404 ובלי פירוט', async () => {
    const res = await run(hook(), { sql: mkSql({ row: null }) });
    assert.equal(res.status, 404);
    assert.equal(await res.text(), 'Not Found');
  });
  test('השאילתה מסננת ערוצים שנעצרו', async () => {
    const sql = mkSql();
    await run(hook(), { sql });
    const q = sql.calls[0].text;
    assert.match(q, /stopped_at IS NULL/);
    assert.deepEqual(sql.calls[0].values, [CH]);
  });
  test('כשל במסד בחיפוש הערוץ - 500 (Google ינסה שוב)', async (t) => {
    captureConsole(t);
    assert.equal((await run(hook(), { sql: fakeSql(() => { throw new Error('x'); }) })).status, 500);
  });
});

describe('google-webhook: אימות טוקן', () => {
  test('בלי טוקן - 401 ושום כתיבה', async () => {
    const sql = mkSql();
    assert.equal((await run(hook({ token: null }), { sql })).status, 401);
    assert.equal(updates(sql).length, 0);
  });
  test('טוקן ריק / שגוי / באורך שונה / ארוך מ-256 - 401', async () => {
    for (const token of ['', 'wrong', goodToken().slice(1), `${goodToken()}0`, 'x'.repeat(257), 'x'.repeat(5000)]) {
      const sql = mkSql();
      assert.equal((await run(hook({ token }), { sql })).status, 401, token.slice(0, 10));
      assert.equal(updates(sql).length, 0);
    }
  });
  test('טוקן של ערוץ אחר - 401 (אי אפשר להשתמש בטוקן מערוץ אחר)', async () => {
    assert.equal((await run(hook({ token: goodToken('another-channel') }))).status, 401);
  });
  test('טוקן שנגזר ממפתח אחר - 401', async () => {
    assert.equal((await run(hook({ token: goodToken(CH, randomBytes(32)) }))).status, 401);
  });
  test('המפתח בשרת הוחלף - הטוקנים הישנים נדחים', async () => {
    const res = await run(hook(), { encKeyRaw: randomBytes(32).toString('base64') });
    assert.equal(res.status, 401);
  });
  test('טוקן באותיות גדולות - 401', async () => {
    assert.equal((await run(hook({ token: goodToken().toUpperCase() }))).status, 401);
  });
  test('תשובת 401 ו-404 לא מבדילות בין "ערוץ לא קיים" ל"טוקן שגוי" בתוכן (רק בקוד)', async () => {
    const a = await (await run(hook({ token: 'bad' }))).text();
    const b = await (await run(hook(), { sql: mkSql({ row: null }) })).text();
    assert.ok(a.length < 20 && b.length < 20);
  });
});

describe('google-webhook: קליטה וכתיבה', () => {
  test('התראה תקינה - 200 OK, עם cache-control no-store', async () => {
    const res = await run(hook());
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'OK');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
  test('העדכון: מונה, מצב ומספר הודעה על שורת הערוץ הנכונה', async () => {
    const sql = mkSql();
    await run(hook({ state: 'exists', num: '17' }), { sql });
    assert.equal(updates(sql).length, 1);
    assert.deepEqual(updates(sql)[0].values, ['exists', 17, 42]);
    assert.match(updates(sql)[0].text, /notification_count = notification_count \+ 1/);
  });
  test('מצב לא מוכר / חסר - נשמר NULL', async () => {
    for (const state of ['hacked', '', null, 'EXISTS']) {
      const sql = mkSql();
      await run(hook({ state }), { sql });
      assert.equal(updates(sql)[0].values[0], null, String(state));
    }
  });
  test('מספר הודעה: חוקי ולא חוקי', async () => {
    const cases = [['0', 0], ['2147483647', 2147483647], ['2147483648', null], ['-1', null], ['abc', null], ['', null], [null, null], ['1.9', 1], ['99999999999999999999', null]];
    for (const [num, expected] of cases) {
      const sql = mkSql();
      await run(hook({ num }), { sql });
      assert.equal(updates(sql)[0].values[1], expected, String(num));
    }
  });
  test('גוף בבקשה (לא אמור להיות) מתעלמים ממנו', async () => {
    const res = await run(hook({ body: '{"evil":true}' }));
    assert.equal(res.status, 200);
  });
  test('כשל בעדכון - 500 כדי ש-Google ינסה שוב', async (t) => {
    captureConsole(t);
    const sql = mkSql({ onQuery: (text) => { if (text.startsWith('UPDATE')) throw new Error('x'); } });
    assert.equal((await run(hook(), { sql })).status, 500);
  });
  test('התראה כפולה (אותו מספר הודעה פעמיים) נספרת פעמיים - אין dedupe (תיעוד)', async () => {
    const sql = mkSql();
    await run(hook({ num: '3' }), { sql });
    await run(hook({ num: '3' }), { sql });
    assert.equal(updates(sql).length, 2);
  });
});

describe('google-webhook: רישום ב-probe_log (בלי ספאם)', () => {
  test('sync נרשם', async () => {
    const sql = mkSql();
    await run(hook({ state: 'sync', num: '1' }), { sql });
    assert.equal(probes(sql).length, 1);
    assert.equal(probes(sql)[0].values[0], 'state=sync msg=1 channel_row=42');
  });
  test('exists ראשון בערוץ נרשם; exists אחרי exists לא', async () => {
    for (const [previous, expected] of [[null, 1], ['sync', 1], ['not_exists', 1], ['exists', 0]]) {
      const sql = mkSql({ row: { id: 42, last_resource_state: previous } });
      await run(hook({ state: 'exists' }), { sql });
      assert.equal(probes(sql).length, expected, String(previous));
    }
  });
  test('not_exists נרשם גם אחרי exists', async () => {
    const sql = mkSql({ row: { id: 42, last_resource_state: 'exists' } });
    await run(hook({ state: 'not_exists' }), { sql });
    assert.equal(probes(sql).length, 1);
  });
  test('מצב לא מוכר - לא נרשם', async () => {
    const sql = mkSql();
    await run(hook({ state: 'weird' }), { sql });
    assert.equal(probes(sql).length, 0);
  });
  test('מספר הודעה לא תקין - נרשם כ-?', async () => {
    const sql = mkSql();
    await run(hook({ state: 'sync', num: 'zzz' }), { sql });
    assert.match(probes(sql)[0].values[0], /msg=\?/);
  });
  test('כשל ב-probe_log לא משנה את התשובה (200)', async (t) => {
    captureConsole(t);
    const sql = mkSql({ onQuery: (text) => { if (text.includes('probe_log')) throw new Error('x'); } });
    assert.equal((await run(hook({ state: 'sync' }), { sql })).status, 200);
  });
  test('שורת ה-probe_log לא מכילה מזהה יומן, מזהה ערוץ או טוקן', async () => {
    const sql = mkSql();
    await run(hook({ state: 'sync' }), { sql });
    const detail = probes(sql)[0].values[0];
    assert.ok(!detail.includes(CH));
    assert.ok(!detail.includes(goodToken()));
  });
});

describe('google-webhook: פרטיות', () => {
  test('אין דליפה של טוקן, ערוץ או מפתח בתשובה או בלוג, בכל מסלולי הכשל', async (t) => {
    const cap = captureConsole(t);
    const bodies = [];
    const fail = fakeSql(() => { throw new Error(`${CH} ${goodToken()} ${KEY_B64}`); });
    bodies.push(await (await run(hook(), { sql: fail })).text());
    bodies.push(await (await run(hook({ token: 'bad' }))).text());
    bodies.push(await (await run(hook(), { sql: mkSql({ onQuery: (t2) => { if (t2.startsWith('UPDATE')) throw new Error(`${CH} ${KEY_B64}`); } }) })).text());
    bodies.push(await (await run(hook(), { encKeyRaw: 'bad-key-value-xyz' })).text());
    const all = bodies.join('\n') + cap.text();
    assertNoSecrets(assert, all, [CH, goodToken(), 'bad-key-value-xyz']);
  });
  test('הודעות השגיאה אחידות וקצרות (בלי פרטים)', async (t) => {
    captureConsole(t);
    const texts = [
      await (await run(hook({ method: 'GET' }))).text(),
      await (await run(hook({ token: 'x' }))).text(),
      await (await run(hook({ channel: '' }))).text(),
      await (await run(hook(), { encKeyRaw: '' })).text(),
    ];
    assert.deepEqual(texts, ['Method Not Allowed', 'Unauthorized', 'Not Found', 'Internal Server Error']);
  });
});
