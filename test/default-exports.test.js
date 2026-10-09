// בדיקות לעטיפת ה-export default { fetch } של כל נקודה: בקשה שנדחית מוקדם (405) לא נוגעת במסד ולא ברשת.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// נתיב הקובץ ביחס לתיקיית test. שלוש משימות ה-Cron יושבות ב-lib/ops ומוגשות דרך api/ops.js.
const MODULES = [
  'api/intake', 'lib/ops/cron-plan', 'api/push-send', 'api/push-subscribe', 'lib/ops/gate-probe',
  'api/google-calendars', 'api/google-auth-start', 'api/google-auth-callback', 'api/google-webhook', 'api/google-watch-start',
];

describe('export default { fetch }', () => {
  for (const name of MODULES) {
    test(`${name}: יש fetch, ו-PATCH נדחה ב-405 בלי DATABASE_URL`, async () => {
      const saved = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;
      try {
        const mod = await import(`../${name}.js`);
        assert.equal(typeof mod.default.fetch, 'function');
        assert.equal(typeof mod.handle, 'function');
        const res = await mod.default.fetch(new Request(`https://x.test/api/${name}`, { method: 'PATCH' }));
        assert.equal(res.status, 405);
      } finally {
        if (saved !== undefined) process.env.DATABASE_URL = saved;
      }
    });
  }
});
