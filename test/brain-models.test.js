// בדיקות ל-lib/brain/models.js (בלוק 3א, אפיון-מורחב סעיף 4 "המוח שנבחר"): רשימת המודלים שעברו, סדר, מכסה ושעת החזרה. פונקציות טהורות, בלי רשת ובלי מסד.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parsePool, parseQuotaRow, quotaDetail, resetAt, classifyQuota, nextAvailable, poolExhaustion, POOL_WINDOW_DAYS } from '../lib/brain/models.js';

const NOW = new Date('2026-11-21T12:00:00.000Z'); // 14:00 בישראל, 04:00 בפסיפיק (PST)
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000);
const passRow = (model, passed = 19, at = daysAgo(1), ok = true, total = 20) => ({
  ok, at, detail: `range=s01-s20; ${passed}/${total} ran=${total}; failed: s10; model=${model}; pool=7; slot=0/4; elapsed=120s | s10 [200] wrong answer`,
});

describe('brain/models: parsePool', () => {
  test('מודל שעבר נכנס, עם הציון', () => {
    assert.deepEqual(parsePool([passRow('gemini-3.5-flash-lite')], NOW), [{ model: 'gemini-3.5-flash-lite', passed: 19, total: 20 }]);
  });
  test('השורה האחרונה של כל מודל קובעת: כישלון אחרון מוציא, הצלחה אחרונה מכניסה', () => {
    const rows = [
      passRow('gemini-a', 19, daysAgo(5)), passRow('gemini-a', 3, daysAgo(1), false),
      passRow('gemini-b', 2, daysAgo(5), false), passRow('gemini-b', 18, daysAgo(2)),
    ];
    assert.deepEqual(parsePool(rows, NOW).map((p) => p.model), ['gemini-b']);
  });
  test(`מעבר שישן מ-${POOL_WINDOW_DAYS} יום לא נחשב`, () => {
    assert.deepEqual(parsePool([passRow('gemini-a', 20, daysAgo(POOL_WINDOW_DAYS + 0.01))], NOW), []);
    assert.equal(parsePool([passRow('gemini-a', 20, daysAgo(POOL_WINDOW_DAYS - 0.01))], NOW).length, 1);
  });
  test('סדר: ציון יורד, ובשוויון לפי שם', () => {
    const rows = [passRow('gemini-c', 18), passRow('gemini-b', 20), passRow('gemini-a', 18)];
    assert.deepEqual(parsePool(rows, NOW).map((p) => p.model), ['gemini-b', 'gemini-a', 'gemini-c']);
  });
  test('מתחת ל-18 מתוך 20, או פחות מ-20 משפטים, לא נכנס גם כש-ok=true', () => {
    assert.deepEqual(parsePool([passRow('gemini-a', 17)], NOW), []);
    assert.deepEqual(parsePool([passRow('gemini-a', 10, daysAgo(1), true, 10)], NOW), []);
  });
  test('שורות פגומות מתעלמים מהן (בלי מודל, שם שאינו בתבנית, ניסיון הזרקה, זמן לא תקין, detail לא טקסט)', () => {
    const rows = [
      { ok: true, at: daysAgo(1), detail: 'range=s01-s20; 20/20 ran=20' },
      { ok: true, at: daysAgo(1), detail: 'range=s01-s20; 20/20 ran=20; model=gpt-4' },
      { ok: true, at: daysAgo(1), detail: 'range=s01-s20; 20/20 ran=20; model=gemini-x/../y' },
      { ok: true, at: daysAgo(1), detail: 'range=s01-s20; 20/20 ran=20; model=gemini-x:z' },
      { ok: true, at: 'not-a-date', detail: passRow('gemini-a').detail },
      { ok: true, at: daysAgo(1), detail: null },
      null,
      { ok: 'true', at: daysAgo(1), detail: passRow('gemini-b').detail },
    ];
    assert.deepEqual(parsePool(rows, NOW), []);
  });
  test('קלט שאינו מערך = רשימה ריקה', () => {
    assert.deepEqual(parsePool(undefined, NOW), []);
  });
});

describe('brain/models: שעת החזרה (resetAt)', () => {
  test('יומית: חצות בפסיפיק = 10:00 בישראל בחורף', () => {
    assert.equal(resetAt('daily', NOW).toISOString(), '2026-11-22T08:00:00.000Z');
  });
  test('יומית בקיץ: 10:00 בישראל (PDT מול IDT)', () => {
    assert.equal(resetAt('daily', new Date('2026-07-01T12:00:00.000Z')).toISOString(), '2026-07-02T07:00:00.000Z');
  });
  test('בין מעברי השעון (ישראל כבר בחורף, ארה"ב עוד בקיץ): 09:00 בישראל, מחושב ולא קבוע', () => {
    assert.equal(resetAt('daily', new Date('2026-10-28T12:00:00.000Z')).toISOString(), '2026-10-29T07:00:00.000Z');
  });
  test('לדקה: עוד 60 שניות', () => {
    assert.equal(resetAt('minute', NOW).toISOString(), '2026-11-21T12:01:00.000Z');
  });
  test('לא ידוע: כמו יומית (חצות פסיפיק הבאה)', () => {
    assert.equal(resetAt('unknown', NOW).toISOString(), '2026-11-22T08:00:00.000Z');
  });
});

describe('brain/models: סיווג 429 (classifyQuota)', () => {
  test('PerDay = יומית, PerMinute = לדקה, אחרת לא ידוע', () => {
    assert.equal(classifyQuota('{"error":{"details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}'), 'daily');
    assert.equal(classifyQuota('{"error":{"details":[{"violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]}}'), 'minute');
    assert.equal(classifyQuota('{"error":{"status":"RESOURCE_EXHAUSTED"}}'), 'unknown');
    assert.equal(classifyQuota(''), 'unknown');
    assert.equal(classifyQuota(undefined), 'unknown');
  });
  test('גם יומית וגם לדקה: יומית (הארוכה מבין השתיים)', () => {
    assert.equal(classifyQuota('PerMinute ... PerDay'), 'daily');
  });
});

describe('brain/models: שורת מכסה (quotaDetail / parseQuotaRow)', () => {
  test('הלוך ושוב', () => {
    const until = new Date('2026-11-22T08:00:00.000Z');
    const detail = quotaDetail({ model: 'gemini-a', kind: 'daily', until });
    assert.equal(detail, 'model=gemini-a; kind=daily; until=2026-11-22T08:00:00.000Z');
    assert.deepEqual(parseQuotaRow({ detail }), { model: 'gemini-a', kind: 'daily', until });
  });
  test('פגומות = null', () => {
    for (const detail of [null, '', 'model=gemini-a; kind=weekly; until=2026-11-22T08:00:00.000Z', 'model=gpt; kind=daily; until=2026-11-22T08:00:00.000Z', 'model=gemini-a; kind=daily; until=xyz', 'garbage']) {
      assert.equal(parseQuotaRow({ detail }), null, String(detail));
    }
    assert.equal(parseQuotaRow(null), null);
  });
});

describe('brain/models: nextAvailable ו-poolExhaustion', () => {
  const pool = [{ model: 'gemini-a', passed: 20, total: 20 }, { model: 'gemini-b', passed: 19, total: 20 }];
  const quota = (model, kind, until) => ({ detail: quotaDetail({ model, kind, until: new Date(until) }) });

  test('אין מכסה שנגמרה: הראשון', () => {
    assert.equal(nextAvailable(pool, [], NOW).model, 'gemini-a');
    assert.equal(poolExhaustion(pool, [], NOW), null);
  });
  test('הראשון נגמר: השני', () => {
    assert.equal(nextAvailable(pool, [quota('gemini-a', 'daily', '2026-11-22T08:00:00Z')], NOW).model, 'gemini-b');
  });
  test('מכסה שכבר חזרה (until עבר) לא חוסמת', () => {
    assert.equal(nextAvailable(pool, [quota('gemini-a', 'minute', '2026-11-21T11:59:00Z')], NOW).model, 'gemini-a');
  });
  test('כולם נגמרו: null, והחזרה המוקדמת עם סוג המגבלה שלה', () => {
    const rows = [quota('gemini-a', 'daily', '2026-11-22T08:00:00Z'), quota('gemini-b', 'minute', '2026-11-21T12:01:00Z')];
    assert.equal(nextAvailable(pool, rows, NOW), null);
    assert.deepEqual(poolExhaustion(pool, rows, NOW), { until: new Date('2026-11-21T12:01:00Z'), kind: 'minute', model: 'gemini-b' });
  });
  test('שתי שורות לאותו מודל: הקובעת היא המאוחרת (until הגדול)', () => {
    const rows = [quota('gemini-a', 'minute', '2026-11-21T12:01:00Z'), quota('gemini-a', 'daily', '2026-11-22T08:00:00Z'), quota('gemini-b', 'daily', '2026-11-22T08:00:00Z')];
    assert.deepEqual(poolExhaustion(pool, rows, NOW), { until: new Date('2026-11-22T08:00:00Z'), kind: 'daily', model: 'gemini-a' });
  });
  test('רשימה ריקה: אין מודל, ואין "נגמרה מכסה" (זה מצב אחר: no-pool)', () => {
    assert.equal(nextAvailable([], [], NOW), null);
    assert.equal(poolExhaustion([], [], NOW), null);
  });
  test('שורות מכסה פגומות לא חוסמות', () => {
    assert.equal(nextAvailable(pool, [{ detail: 'garbage' }, null], NOW).model, 'gemini-a');
  });
});
