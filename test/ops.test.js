// בדיקות ל-api/ops.js: נקודה אחת לשלוש משימות ה-Cron (מגבלת 12 הפונקציות של Hobby). בלי מסד ובלי רשת.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ops, { TASKS, pickTask, config } from '../api/ops.js';

const get = (path, init) => new Request(`https://x.test${path}`, init);

describe('ops: בחירת משימה', () => {
  test('task חסר או לא מוכר - 404', async () => {
    for (const path of ['/api/ops', '/api/ops?task=nope', '/api/ops?task=']) {
      assert.equal((await ops.fetch(get(path))).status, 404, path);
    }
  });

  test('שמות מהאב-טיפוס של אובייקט (constructor, toString, __proto__) - 404, לא קריסה', async () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.equal(pickTask(get(`/api/ops?task=${name}`)), null, name);
      assert.equal((await ops.fetch(get(`/api/ops?task=${name}`))).status, 404, name);
    }
  });

  test('בדיוק שלוש משימות, ולכל אחת fetch', () => {
    assert.deepEqual(Object.keys(TASKS).sort(), ['cron-plan', 'daily-check', 'gate-probe']);
    for (const task of Object.values(TASKS)) assert.equal(typeof task.fetch, 'function');
  });

  test('maxDuration של 300 נשמר (gate-probe צריך אותו)', () => {
    assert.equal(config.maxDuration, 300);
  });
});

describe('ops: ההגנה של כל משימה נשארת', () => {
  for (const name of Object.keys(TASKS)) {
    test(`${name}: בלי Authorization - 401, ו-PATCH - 405, בלי DATABASE_URL`, async () => {
      const saved = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;
      try {
        assert.equal((await ops.fetch(get(`/api/ops?task=${name}`))).status, 401);
        assert.equal((await ops.fetch(get(`/api/ops?task=${name}`, { method: 'PATCH' }))).status, 405);
      } finally {
        if (saved !== undefined) process.env.DATABASE_URL = saved;
      }
    });
  }
});

describe('ops: vercel.json והמגבלה', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

  test('כל Cron וכל rewrite של משימה מצביעים על task מוכר', () => {
    const targets = [
      ...cfg.crons.map((c) => c.path),
      ...cfg.rewrites.filter((r) => r.destination.startsWith('/api/ops')).map((r) => r.destination),
    ];
    assert.ok(targets.length >= 7);
    for (const target of targets) {
      const url = new URL(`https://x.test${target}`);
      assert.equal(url.pathname, '/api/ops', target);
      assert.ok(Object.hasOwn(TASKS, url.searchParams.get('task')), target);
    }
  });

  test('הכתובות הישנות שיובל מריץ ידנית עדיין קיימות כ-rewrite', () => {
    const sources = cfg.rewrites.map((r) => r.source);
    for (const name of Object.keys(TASKS)) assert.ok(sources.includes(`/api/${name}`), name);
  });

  test('לא יותר מ-12 פונקציות: קבצי js תחת api/ (כולל תתי-תיקיות)', () => {
    const files = readdirSync(new URL('../api/', import.meta.url), { recursive: true }).filter((f) => String(f).endsWith('.js'));
    assert.ok(files.length <= 12, `נמצאו ${files.length}: ${files.join(', ')}`);
  });
});
