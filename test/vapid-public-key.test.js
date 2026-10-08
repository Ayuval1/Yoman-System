// בדיקות ל-lib/vapid-public-key.js (הועבר מ-api/; הנקודה מוגשת דרך GET ב-api/push-subscribe.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleVapidKey as handle } from '../lib/vapid-public-key.js';
import { captureConsole, req } from './helpers.js';

const PUB = 'BPublicKeyForTestsOnly_abc-123';

describe('vapid-public-key', () => {
  test('GET עם מפתח - 200 והמפתח בדיוק', async () => {
    const res = await handle(req('https://x.test/'), { env: { VAPID_PUBLIC_KEY: PUB } });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), PUB);
  });
  test('ירידת שורה ורווחים נחתכים', async () => {
    const res = await handle(req('https://x.test/'), { env: { VAPID_PUBLIC_KEY: `  ${PUB}\r\n` } });
    assert.equal(await res.text(), PUB);
  });
  for (const method of ['POST', 'PUT', 'DELETE']) {
    test(`${method} - 405`, async () => {
      const res = await handle(req('https://x.test/', { method }), { env: { VAPID_PUBLIC_KEY: PUB } });
      assert.equal(res.status, 405);
    });
  }
  test('מפתח חסר / ריק / רווחים בלבד - 500 והודעה בעברית', async (t) => {
    const cap = captureConsole(t);
    for (const value of [undefined, '', '   \n', null]) {
      const res = await handle(req('https://x.test/'), { env: { VAPID_PUBLIC_KEY: value } });
      assert.equal(res.status, 500, String(value));
      assert.match(await res.text(), /לא מוגדר/);
    }
    assert.ok(cap.lines.length >= 4);
  });
  test('המפתח הפרטי לעולם לא מוחזר, גם כשהוא בסביבה', async () => {
    const res = await handle(req('https://x.test/'), { env: { VAPID_PUBLIC_KEY: PUB, VAPID_PRIVATE_KEY: 'PRIVATE-SECRET-VALUE' } });
    assert.ok(!(await res.text()).includes('PRIVATE'));
  });
  test('מפתח פרטי בלי ציבורי - 500 ושום דליפה בתשובה או בלוג', async (t) => {
    const cap = captureConsole(t);
    const res = await handle(req('https://x.test/'), { env: { VAPID_PRIVATE_KEY: 'PRIVATE-SECRET-VALUE' } });
    assert.equal(res.status, 500);
    assert.ok(!(await res.text()).includes('PRIVATE-SECRET-VALUE'));
    assert.ok(!cap.text().includes('PRIVATE-SECRET-VALUE'));
  });
  test('סוג תוכן text/plain', async () => {
    const res = await handle(req('https://x.test/'), { env: { VAPID_PUBLIC_KEY: PUB } });
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  });
});
