// בדיקות ל-lib/ops/brain-duration-check.js: אימות, ו-pass/fail עם understand מדומה.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../lib/ops/brain-duration-check.js';

const FAKE = 'fake-cron-secret';
const req = (method = 'GET', headers = {}) => new Request('https://x.test/api/ops?task=brain-duration-check', { method, headers });
const auth = { authorization: `Bearer ${FAKE}` };

describe('brain-duration-check', () => {
  test('401 בלי סוד, 405 ב-POST', async () => {
    assert.equal((await handle(req('GET'), { secret: FAKE, sql: () => [] })).status, 401);
    assert.equal((await handle(req('POST', auth), { secret: FAKE, sql: () => [] })).status, 405);
  });

  test('חישוב pass/fail', async () => {
    const answers = [null, null, '40 דקות', 'חצי שעה', 'שעה וחצי', null];
    let i = 0;
    const understand = async () => ({ ok: true, model: 'm', understanding: { duration_text: answers[i++] } });
    const res = await handle(req('GET', auth), { secret: FAKE, sql: () => [], understand });
    const body = await res.json();
    assert.equal(body.total, 6);
    assert.equal(body.passed, 5);
    assert.equal(body.cases[2].pass, false);
    assert.equal(body.cases[2].minutes, 40);
    assert.equal(body.cases[3].pass, true);
    assert.equal(body.cases[3].minutes, 30);
  });

  test('התאמה לפי דקות, וכשל המוח', async () => {
    const answers = [null, null, null, '30 דקות', null, null];
    let i = 0;
    const understand = async () => { const a = answers[i++]; return i === 5 ? { ok: false, reason: 'timeout' } : { ok: true, model: 'm', understanding: { duration_text: a } }; };
    const body = await (await handle(req('GET', auth), { secret: FAKE, sql: () => [], understand })).json();
    assert.equal(body.cases[3].pass, true);
    assert.equal(body.cases[4].pass, false);
    assert.equal(body.cases[4].reason, 'timeout');
  });
});
