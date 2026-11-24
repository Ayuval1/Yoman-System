// בדיקות ל-lib/ops/brain-status.js: קריאה בלבד, מספרים בלבד, מצב ברור.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql, req, FAKE_CRON } from './helpers.js';
import { handle, summarize } from '../lib/ops/brain-status.js';

const NOW = Date.parse('2026-11-24T08:00:00.000Z');
const at = (h) => new Date(NOW - h * 3600000).toISOString();
const row = (ok, detail, h) => ({ ok, detail, at: at(h) });

describe('brain-status', () => {
  test('אף מודל לא עבר: מצב פיילוט, וההסבר אומר את זה; ספירת הפיילוט לפי מודל', () => {
    const out = summarize({
      gateRows: [row(false, 'range=s01-s20; 16/20 ran=17; failed: s15; not-run: s18,s19,s20; model=gemini-3.1-flash-lite; time_budget; elapsed=262s', 20)],
      quotaRows: [], intakeRows: [{ ok: true }, { ok: false }],
      pilotRows: [{ detail: 'model=gemini-3.5-flash-lite; outcome=ok' }, { detail: 'model=gemini-3.5-flash-lite; outcome=ok' }, { detail: 'model=gemini-3.5-flash-lite; outcome=format' }],
      nowMs: NOW, env: {},
    });
    assert.equal(out.mode, 'pilot');
    assert.match(out.why, /אף מודל עוד לא עבר/);
    assert.deepEqual(out.pilot_24h, { 'gemini-3.5-flash-lite': { ok: 2, format: 1 } });
    assert.equal(out.models[0].state, 'בבדיקה');
    assert.equal(out.models[0].score, '16/20');
    assert.deepEqual(out.brain_24h, { understood: 2, agreed_with_code: 1, disagreements: {} });
  });
  test('מודל שעבר: מצב passed, והוא ראשון ברשימה', () => {
    const out = summarize({
      gateRows: [row(true, 'range=s01-s20; 19/20 ran=20; failed: s15; model=gemini-3.1-flash-lite; new=3; elapsed=40s', 2), row(false, 'range=s01-s20; 0/20 ran=0; failed: none; tech: s01; not-run: s02; model=gemini-x; new=0; elapsed=1s', 3)],
      quotaRows: [], pilotRows: [], intakeRows: [], nowMs: NOW, env: {},
    });
    assert.equal(out.mode, 'passed');
    assert.equal(out.models[0].state, 'עבר');
  });
  test('פיילוט כבוי ואין מודל: off; בלי מפתח: ההסבר אומר שהמוח לא רץ', () => {
    assert.equal(summarize({ gateRows: [], quotaRows: [], pilotRows: [], intakeRows: [], nowMs: NOW, env: { BRAIN_PILOT: 'off' } }).mode, 'off');
    assert.match(summarize({ gateRows: [], quotaRows: [], pilotRows: [], intakeRows: [], nowMs: NOW, env: {}, hasKey: false }).why, /אין GEMINI_API_KEY/);
  });
  test('handle: סוד נדרש; GET בלבד; ארבע שאילתות קריאה בלבד', async () => {
    const sql = fakeSql(() => []);
    assert.equal((await handle(req('https://x.test/api/ops?task=brain-status'), { sql, secret: FAKE_CRON })).status, 401);
    const res = await handle(req('https://x.test/api/ops?task=brain-status', { headers: { authorization: `Bearer ${FAKE_CRON}` } }), { sql, secret: FAKE_CRON, env: {}, now: () => NOW });
    assert.equal(res.status, 200);
    assert.equal(sql.calls.length, 4);
    assert.ok(sql.calls.every((c) => c.text.startsWith('SELECT')));
  });
});

test('brain-status: זוגות אי-הסכמה, והבעיה הראשונה של מודל שנכשל', () => {
  const out = summarize({
    gateRows: [{ ok: false, at: new Date(NOW - 3600000).toISOString(), detail: 'range=s01-s20; 0/20 ran=20; failed: s01,s02; model=gemini-2.5-flash; elapsed=200s | s01 [200] wrong answer: action=undefined when=undefined ; s02 [200] x' }],
    quotaRows: [], pilotRows: [], nowMs: NOW, env: {},
    intakeRows: [{ ok: false, detail: 'ai=event; code=other; channel=app; model=m' }, { ok: false, detail: 'ai=event; code=other; channel=app; model=m' }, { ok: true, detail: 'ai=task; code=task' }],
  });
  assert.deepEqual(out.brain_24h.disagreements, { 'event→other': 2 });
  assert.equal(out.models[0].first_problem, 's01 [200] wrong answer: action=undefined when=undefined');
});
