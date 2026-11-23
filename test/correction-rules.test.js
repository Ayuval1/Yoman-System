// בדיקות ל-lib/correction-rules.js (בלוק 6 חלק ב': תיקון שחוזר -> "לקבוע שמעכשיו ש-X = Y?", הכרעת יובל ש1, 23.11.2026).
// בלי רשת ובלי מסד: sql מזויף. כל השמות והמשפטים מומצאים.
// חשוב: ה-SQL לא הורץ מול Postgres. הבדיקות מוודאות את הלוגיקה בקוד, את מבנה הפקודה האטומית ואת הפרמטרים שנשלחים אליה.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fakeSql, captureConsole, jsonRequest, FAKE_SECRET } from './helpers.js';
import {
  CORRECTION_ENTITY, CORRECTION_BUTTONS, CORRECTION_YES, CORRECTION_NO, CORRECTION_REPEAT_THRESHOLD, CORRECTION_CLOSED_TEXT,
  ruleRootsOf, ruleKey, cardText, parseCardRoots, findRepeat, applyCorrectionRules, loadApprovedCorrectionRules, recordCorrection, answerCorrectionRule,
} from '../lib/correction-rules.js';
import { pendingFromRows } from '../lib/chat-view.js';
import { answerQuestion, processSource, TYPE_FIELD } from '../lib/intake-process.js';
import { handle as chatHandle } from '../api/chat.js';

const NAME = 'דני';
const SRC = '11111111-1111-4111-8111-111111111111';
const PRIOR = '22222222-2222-4222-8222-222222222222';
const MSG = '33333333-3333-4333-8333-333333333333';
const CAND = '44444444-4444-4444-8444-444444444444';
const TEXT_A = 'בדיקה רפואית אצל דני היום ב-16:00';
const TEXT_B = 'פגישה אצל דני מחר ב-16:00';
const source = (over = {}) => ({ id: SRC, channel: 'app', raw_content: TEXT_A, ...over });
const priorRow = (id, text, read_time = '16:00') => ({ id, raw_content: text, read_time });
const sha = (value) => createHash('sha256').update(value).digest('hex');
const allValues = (sql) => sql.calls.flatMap((call) => call.values.map(String));

describe('correction-rules: שורשים, מפתח וכרטיס', () => {
  test('ruleRootsOf: שורשי תוכן שהמילון לא תפס, ממוינים וללא כפילות', () => {
    assert.deepEqual(ruleRootsOf('אצל דני'), ['אצל', 'דני']);
    assert.deepEqual(ruleRootsOf('דני אצל אצל'), ['אצל', 'דני'], 'סדר קבוע וללא כפילות');
    assert.deepEqual(ruleRootsOf(''), []);
    assert.deepEqual(ruleRootsOf(null), []);
  });

  test('ruleKey: גיבוב יציב, תלוי בשדה, בערך ובשורשים, ואינו מכיל את המילים', () => {
    const key = ruleKey({ field: 'time', value: '17:00', roots: ['אצל', 'דני'] });
    assert.match(key, /^corr:[0-9a-f]{32}$/);
    assert.equal(key, ruleKey({ field: 'time', value: '17:00', roots: ['אצל', 'דני'] }));
    assert.notEqual(key, ruleKey({ field: 'time', value: '17:30', roots: ['אצל', 'דני'] }));
    assert.notEqual(key, ruleKey({ field: 'time', value: '17:00', roots: ['אצל'] }));
    assert.ok(!key.includes('דני'));
    assert.equal(key, `corr:${sha('time|17:00|אצל דני').slice(0, 32)}`);
  });

  test('cardText + parseCardRoots: הנוסח של יובל והחזרה של השורשים מהכרטיס', () => {
    const text = cardText({ roots: ['אצל', 'דני'], value: '17:00' });
    assert.match(text, /^לקבוע שמעכשיו ש-אצל דני = .*17:00.*\?$/);
    assert.deepEqual(parseCardRoots(text), ['אצל', 'דני']);
    assert.equal(parseCardRoots('משהו אחר'), null);
    assert.equal(parseCardRoots(CORRECTION_CLOSED_TEXT), null);
  });

  test('כפתורים: כן / לא, וסף החזרה = 2', () => {
    assert.deepEqual([...CORRECTION_BUTTONS], [CORRECTION_YES, CORRECTION_NO]);
    assert.equal(CORRECTION_REPEAT_THRESHOLD, 2);
  });
});

describe('correction-rules: findRepeat (מה נחשב "אותו תיקון שחוזר")', () => {
  test('שתי הודעות עם אותן מילים משותפות ואותה שעה מתוקנת: הדפוס הוא המשותף, והתמיכה 2', () => {
    const found = findRepeat({ text: TEXT_A, priors: [priorRow(PRIOR, TEXT_B)] });
    assert.deepEqual(found.roots, ['אצל', 'דני']);
    assert.deepEqual(found.sourceIds, [PRIOR]);
  });
  test('אין מילה משותפת: אין חזרה', () => {
    assert.equal(findRepeat({ text: TEXT_A, priors: [priorRow(PRIOR, 'תור לרופא שיניים היום ב-16:00')] }), null);
  });
  test('בלי קודמים: אין חזרה (תיקון ראשון מתקן רק את המקרה)', () => {
    assert.equal(findRepeat({ text: TEXT_A, priors: [] }), null);
  });
  test('כמה קודמים: נבחר המשותף הגדול ביותר, ומקורות התמיכה כוללים את כל מי שמכיל אותו', () => {
    const found = findRepeat({ text: TEXT_A, priors: [priorRow(PRIOR, 'מחר אצל דני'), priorRow('p3', 'פגישה אצל דני מחר'), priorRow('p4', 'פגישה אצל סבתא')] });
    assert.deepEqual(found.roots, ['אצל', 'דני']);
    assert.deepEqual(found.sourceIds.sort(), [PRIOR, 'p3'].sort());
  });
});

describe('correction-rules: applyCorrectionRules (קוד דטרמיניסטי, בלי AI)', () => {
  const rule = (over = {}) => ({ roots: ['אצל', 'דני'], field: 'time', value: '17:00', from: ['16:00'], ...over });
  const facts = [
    { field: 'date', value: '2026-10-19', origin: 'inferred', extracted_by: 'script' },
    { field: 'time', value: '16:00', origin: 'read', extracted_by: 'script' },
    { field: 'end_time', value: '17:00', origin: 'inferred', extracted_by: 'script' },
  ];
  test('כלל שכל השורשים שלו בהודעה: השעה מוחלפת (origin=inferred) ושעת הסיום שהוסקה מחושבת מחדש', () => {
    const out = applyCorrectionRules({ rules: [rule()], text: TEXT_A, facts, type: 'personal_event' });
    assert.deepEqual(out.find((f) => f.field === 'time'), { field: 'time', value: '17:00', origin: 'inferred', extracted_by: 'script' });
    assert.equal(out.find((f) => f.field === 'end_time').value, '18:00');
  });
  test('שעת סיום שנקראה מההודעה לא נדרסת, אלא אם היא לא אחרי ההתחלה החדשה', () => {
    const read = facts.map((f) => (f.field === 'end_time' ? { ...f, value: '19:00', origin: 'read' } : f));
    assert.equal(applyCorrectionRules({ rules: [rule()], text: TEXT_A, facts: read, type: 'personal_event' }).find((f) => f.field === 'end_time').value, '19:00');
    const early = facts.map((f) => (f.field === 'end_time' ? { ...f, value: '16:30', origin: 'read' } : f));
    assert.equal(applyCorrectionRules({ rules: [rule()], text: TEXT_A, facts: early, type: 'personal_event' }).find((f) => f.field === 'end_time').value, '18:00');
  });
  test('שעה מפורשת (origin=read): נשמרת אם אינה מהשעות השגויות; מוסקת: מוחלפת; מפורשת ששווה לשגויה: מוחלפת; כלל בלי from לא דורס מפורשת', () => {
    const withTime = (value, origin) => facts.map((f) => (f.field === 'time' ? { ...f, value, origin } : f));
    const timeOf = (list, r = rule()) => applyCorrectionRules({ rules: [r], text: TEXT_A, facts: list, type: 'personal_event' }).find((f) => f.field === 'time').value;
    assert.equal(timeOf(withTime('18:30', 'read')), '18:30');
    assert.equal(timeOf(withTime('18:30', 'inferred')), '17:00');
    assert.equal(timeOf(withTime('16:00', 'read')), '17:00');
    assert.equal(timeOf(withTime('16:00', 'read'), rule({ from: [] })), '16:00');
  });
  test('שורש חסר בהודעה: לא מופעל', () => {
    assert.deepEqual(applyCorrectionRules({ rules: [rule({ roots: ['אצל', 'סבתא'] })], text: TEXT_A, facts, type: 'personal_event' }), facts);
  });
  test('סוג בלי שעה מתוקנת (מבחן): לא מופעל', () => {
    assert.deepEqual(applyCorrectionRules({ rules: [rule()], text: TEXT_A, facts, type: 'test' }), facts);
  });
  test('כמה כללים מתאימים: זה עם הכי הרבה שורשים, ובשוויון הערך הקטן (דטרמיניסטי)', () => {
    const out = applyCorrectionRules({ rules: [rule({ roots: ['דני'], value: '15:00' }), rule({ value: '17:00' }), rule({ value: '16:45' })], text: TEXT_A, facts, type: 'personal_event' });
    assert.equal(out.find((f) => f.field === 'time').value, '16:45');
  });
  test('בלי כללים או בלי עובדת שעה: אותו מערך, לא מוסיף שעה מהאוויר', () => {
    assert.deepEqual(applyCorrectionRules({ rules: [], text: TEXT_A, facts, type: 'personal_event' }), facts);
    const noTime = facts.filter((f) => f.field !== 'time');
    assert.equal(applyCorrectionRules({ rules: [rule()], text: TEXT_A, facts: noTime, type: 'personal_event' }).some((f) => f.field === 'time'), false, 'לא ממציא שעה שלא נקראה');
  });
  test('לא משנה את הקלט', () => {
    const copy = JSON.stringify(facts);
    applyCorrectionRules({ rules: [rule()], text: TEXT_A, facts, type: 'personal_event' });
    assert.equal(JSON.stringify(facts), copy);
  });
});

describe('correction-rules: loadApprovedCorrectionRules', () => {
  test('רק מאושרים מסוג correction, מפוענחים; שורה פגומה מדולגת', async () => {
    const sql = fakeSql(() => [
      { pattern: 'אצל דני', evidence: { kind: 'correction', field: 'time', value: '17:00', roots: ['אצל', 'דני'] } },
      { pattern: 'x', evidence: { kind: 'other' } },
      { pattern: 'y', evidence: { kind: 'correction', field: 'time', value: 'לא שעה', roots: ['אצל'] } },
      { pattern: 'z', evidence: { kind: 'correction', field: 'time', value: '09:00', roots: [] } },
    ]);
    assert.deepEqual(await loadApprovedCorrectionRules(sql), [{ roots: ['אצל', 'דני'], field: 'time', value: '17:00', from: [] }]);
    assert.match(sql.calls[0].text, /status = 'approved'/);
  });
  test('כשל מסד: [] ושם השגיאה בלבד בלוג (נכשל פתוח)', async (t) => {
    const cap = captureConsole(t);
    const sql = fakeSql(() => { throw new Error(`secret ${NAME}`); });
    assert.deepEqual(await loadApprovedCorrectionRules(sql), []);
    assert.doesNotMatch(cap.text(), /secret|דני/);
  });
});

describe('correction-rules: recordCorrection (זיהוי חזרה והצעת כלל)', () => {
  const run = async ({ src = source(), field = 'fix_time', value = '17:00', priors = [priorRow(PRIOR, TEXT_B)], existing = [] } = {}) => {
    const sql = fakeSql((text) => {
      if (text.includes('correction-priors')) return priors;
      if (text.includes('correction-propose')) return existing.length ? [{ candidate_id: null, question_id: null }] : [{ candidate_id: CAND, question_id: MSG }];
      return [];
    });
    const result = await recordCorrection({ sql, source: src, field, value });
    return { sql, result };
  };

  test('תיקון ראשון (אין קודמים): לא נוצר כלום, לא כלל ולא כרטיס', async () => {
    const { sql, result } = await run({ priors: [] });
    assert.equal(result.status, 'first');
    assert.equal(sql.find('correction-propose').length, 0);
    assert.equal(sql.calls.some((call) => /INSERT|UPDATE/.test(call.text)), false);
  });

  test('תיקון שני זהה: פקודה אחת שיוצרת מועמד (candidate) וכרטיס "כן / לא", והמילים רק בגוף הכרטיס', async () => {
    const { sql, result } = await run();
    assert.equal(result.status, 'proposed');
    const [call] = sql.find('correction-propose');
    assert.match(call.text, /INSERT INTO candidate_rules/);
    assert.match(call.text, /'candidate'/);
    assert.match(call.text, /INSERT INTO messages/);
    assert.match(call.text, /'question'/);
    assert.match(call.text, /WHERE NOT EXISTS \(SELECT 1 FROM candidate_rules/);
    const key = ruleKey({ field: 'time', value: '17:00', roots: ['אצל', 'דני'] });
    assert.ok(call.values.includes(key), 'המפתח המגובב נשלח');
    assert.ok(call.values.includes(CORRECTION_ENTITY));
    const withName = call.values.map(String).filter((v) => v.includes(NAME));
    assert.equal(withName.length, 1, 'השם מופיע בפרמטר אחד בלבד: גוף הכרטיס');
    assert.equal(withName[0], cardText({ roots: ['אצל', 'דני'], value: '17:00' }));
    const evidence = call.values.find((v) => typeof v === 'string' && v.startsWith('{') && v.includes('"kind"'));
    assert.ok(evidence && !evidence.includes(NAME) && !evidence.includes('אצל'), 'ה-evidence בלי מילים');
    assert.deepEqual(JSON.parse(evidence), { kind: 'correction', field: 'time', value: '17:00', key, from: ['16:00'], source_ids: [PRIOR, SRC] });
  });

  test('מועמד קיים (כבר הוצע, נדחה או אושר): הפקודה אטומית ולא יוצרת כפילות (NOT EXISTS על המפתח)', async () => {
    const { sql, result } = await run({ existing: [1] });
    assert.equal(result.status, 'exists');
    assert.match(sql.find('correction-propose')[0].text, /NOT EXISTS \(SELECT 1 FROM candidate_rules x WHERE x\.evidence ->> 'key' = /);
  });

  test('לא ערוץ app (הודעה של אדם אחר): לא נקרא ולא נכתב כלום', async () => {
    const { sql, result } = await run({ src: source({ channel: 'shortcut' }) });
    assert.equal(result.status, 'skipped');
    assert.equal(sql.calls.length, 0);
  });

  test('תיקון תאריך, שעה לא תקינה או "לא יודע": לא לומדים', async () => {
    for (const [field, value] of [['fix_date', '2026-10-20'], ['fix_time', 'unknown'], ['fix_time', '25:99']]) {
      const { sql, result } = await run({ field, value });
      assert.equal(result.status, 'skipped', `${field}=${value}`);
      assert.equal(sql.calls.length, 0);
    }
  });

  test('הודעה בלי שורשי תוכן, או עם יותר מדי: לא לומדים', async () => {
    assert.equal((await run({ src: source({ raw_content: 'היום ב-16:00' }) })).result.status, 'skipped');
  });

  test('השאילתה של הקודמים: רק ערוץ app, אותה שעה מתוקנת, לא המקור עצמו, מוגבלת', async () => {
    const { sql } = await run();
    const [call] = sql.find('correction-priors');
    assert.match(call.text, /s\.channel = 'app'/);
    assert.match(call.text, /f\.field = 'fix_time'/);
    assert.match(call.text, /s\.id <> /);
    assert.match(call.text, /LIMIT/);
    assert.ok(call.values.includes('17:00') && call.values.includes(SRC));
  });
});

describe('correction-rules: answerCorrectionRule (כן / לא)', () => {
  const key = ruleKey({ field: 'time', value: '17:00', roots: ['אצל', 'דני'] });
  const ask = (over = {}) => ({
    id: MSG, entity_type: CORRECTION_ENTITY, awaiting_reply: true, body: cardText({ roots: ['אצל', 'דני'], value: '17:00' }),
    candidate_id: CAND, status: 'candidate', evidence: { kind: 'correction', field: 'time', value: '17:00', key, source_ids: [PRIOR, SRC] }, ...over,
  });
  const db = (row, written = [{ closed: 1, answer_source_id: 'a1', bubble_id: 'b1' }]) => fakeSql((text) => {
    if (text.includes('correction-ask')) return row ? [row] : [];
    if (text.includes('correction-write')) return written;
    return [];
  });
  const NOW = new Date('2026-11-23T15:00:00.000Z');

  test('"כן": הכלל מאושר, ה-pattern הופך לשורשים, ה-evidence נושא את השורשים, והבועה והכרטיס בלי שם', async () => {
    const sql = db(ask());
    const result = await answerCorrectionRule({ sql, messageId: MSG, answer: 'כן', now: NOW });
    assert.equal(result.status, 'answered');
    const [call] = sql.find('correction-write');
    assert.match(call.text, /UPDATE candidate_rules/);
    assert.match(call.text, /status = 'candidate'/, 'מעבר רק ממועמד');
    assert.ok(call.values.includes('approved'));
    assert.ok(call.values.includes('אצל דני'), 'השם נשמר בכלל שאושר');
    const withName = call.values.map(String).filter((v) => v.includes(NAME));
    assert.equal(withName.length, 2, 'pattern ו-evidence של הכלל המאושר בלבד');
    assert.ok(call.values.includes(CORRECTION_CLOSED_TEXT), 'גוף הכרטיס נמחק');
    const evidence = JSON.parse(call.values.find((v) => typeof v === 'string' && v.startsWith('{') && v.includes('"roots"')));
    assert.deepEqual(evidence.roots, ['אצל', 'דני']);
    assert.equal(evidence.key, key);
  });

  test('"לא": נדחה, ה-pattern נשאר מגובב (לא נשמר שם), גוף הכרטיס נמחק, ואין שם באף פרמטר', async () => {
    const sql = db(ask());
    const result = await answerCorrectionRule({ sql, messageId: MSG, answer: 'לא', now: NOW });
    assert.equal(result.status, 'answered');
    const [call] = sql.find('correction-write');
    assert.ok(call.values.includes('rejected'));
    assert.ok(call.values.includes(CORRECTION_CLOSED_TEXT));
    assert.deepEqual(call.values.map(String).filter((v) => v.includes(NAME)), []);
  });

  test('תשובה אחרת: unclear, בלי כתיבה', async () => {
    const sql = db(ask());
    assert.equal((await answerCorrectionRule({ sql, messageId: MSG, answer: 'אולי', now: NOW })).status, 'unclear');
    assert.equal(sql.find('correction-write').length, 0);
  });

  test('שאלה שאינה של כלל, כבר נסגרה, או לא קיימת: closed', async () => {
    for (const row of [null, ask({ awaiting_reply: false }), ask({ status: 'rejected' })]) {
      const sql = db(row);
      assert.equal((await answerCorrectionRule({ sql, messageId: MSG, answer: 'כן', now: NOW })).status, 'closed');
      assert.equal(sql.find('correction-write').length, 0);
    }
  });

  test('גוף הכרטיס לא תואם למפתח (פגום): closed, בלי כתיבה', async () => {
    const sql = db(ask({ body: cardText({ roots: ['אצל', 'סבתא'], value: '17:00' }) }));
    assert.equal((await answerCorrectionRule({ sql, messageId: MSG, answer: 'כן', now: NOW })).status, 'closed');
    assert.equal(sql.find('correction-write').length, 0);
  });

  test('לחיצה כפולה (closed=0 בכתיבה): closed', async () => {
    const sql = db(ask(), [{ closed: 0 }]);
    assert.equal((await answerCorrectionRule({ sql, messageId: MSG, answer: 'כן', now: NOW })).status, 'closed');
  });
});

describe('correction-rules: חיבור לצ\'אט', () => {
  test('pendingFromRows: כרטיס correction_rule עם כן / לא ובלי תיבת כתיבה', () => {
    const [item] = pendingFromRows({ questions: [{ id: MSG, entity_type: CORRECTION_ENTITY, body: cardText({ roots: ['אצל', 'דני'], value: '17:00' }), sent_at: '2026-11-23T10:00:00.000Z' }], facts: [], timetable: null, today: '2026-11-23' });
    assert.equal(item.kind, 'correction_rule');
    assert.deepEqual(item.buttons, [CORRECTION_YES, CORRECTION_NO]);
    assert.equal(item.allowFreeText, false);
    assert.match(item.text, /לקבוע שמעכשיו/);
  });

  test('POST answer: עובר ל-answerCorrectionRule אחרי שאר השאלות', async () => {
    const key = ruleKey({ field: 'time', value: '17:00', roots: ['אצל', 'דני'] });
    const sql = fakeSql((text) => {
      if (text.includes('correction-ask')) return [{ id: MSG, entity_type: CORRECTION_ENTITY, awaiting_reply: true, body: cardText({ roots: ['אצל', 'דני'], value: '17:00' }), candidate_id: CAND, status: 'candidate', evidence: { kind: 'correction', field: 'time', value: '17:00', key, source_ids: [] } }];
      if (text.includes('correction-write')) return [{ closed: 1, answer_source_id: 'a1', bubble_id: 'b1' }];
      return [];
    });
    const res = await chatHandle(jsonRequest({ action: 'answer', message_id: MSG, answer: 'כן' }, { headers: { 'x-intake-secret': FAKE_SECRET }, url: 'https://x.test/api/chat' }), {
      sql, secret: FAKE_SECRET, timetable: null, now: () => new Date('2026-11-23T15:00:00.000Z'), googleDay: undefined,
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'answered');
    assert.equal(sql.find('correction-write').length, 1);
  });
});

describe('correction-rules: חיבור לצינור הקליטה', () => {
  const SAVED = [
    { field: TYPE_FIELD, value: 'personal_event', origin: 'read' }, { field: 'date', value: '2026-10-19', origin: 'inferred' }, { field: 'time', value: '16:00', origin: 'read' },
    { field: 'end_time', value: '17:00', origin: 'inferred' }, { field: 'topic', value: 'בדיקה רפואית אצל דני', origin: 'read' },
    { field: 'confirm', value: 'no', origin: 'read' }, { field: 'fix', value: 'time', origin: 'read' },
  ];
  const answerSql = ({ channel = 'app', priors = [priorRow(PRIOR, TEXT_B)] } = {}) => fakeSql((text) => {
    if (text.includes('FROM messages WHERE id')) return [{ id: MSG, kind: 'question', awaiting_reply: true, entity_type: 'source', entity_id: SRC, attempt: 1 }];
    if (text.includes('FROM sources WHERE id')) return [{ id: SRC, channel, raw_content: TEXT_A, content_hash: 'h', received_at: new Date('2026-10-19T08:30:00+03:00') }];
    if (text.includes('FROM facts WHERE source_id')) return SAVED;
    if (text.includes('INTO facts')) return [{ closed: 1 }];
    if (text.includes('correction-priors')) return priors;
    if (text.includes('correction-propose')) return [{ candidate_id: CAND, question_id: MSG }];
    return [];
  });
  const answerFix = (sql, reply = '17:00') => answerQuestion({ sql, messageId: MSG, answer: reply, now: new Date('2026-10-19T08:30:00+03:00'), timetable: null });

  test('תשובת fix_time בהודעה מוקלדת שנייה: הצעת כלל נכתבת אחרי התשובה', async () => {
    const sql = answerSql();
    const result = await answerFix(sql);
    assert.equal(result.status, 'answered');
    assert.equal(sql.find('correction-propose').length, 1);
  });
  test('תשובת fix_time ראשונה (אין קודמים): התיקון חל על המקרה בלבד, בלי הצעה', async () => {
    const sql = answerSql({ priors: [] });
    assert.equal((await answerFix(sql)).status, 'answered');
    assert.equal(sql.find('correction-propose').length, 0);
  });
  test('הודעה מהקיצור (טקסט של אחרים): לא לומדים', async () => {
    const sql = answerSql({ channel: 'shortcut' });
    assert.equal((await answerFix(sql)).status, 'answered');
    assert.equal(sql.find('correction-priors').length, 0);
  });
  test('כשל בלמידה לא מפיל את התשובה', async (t) => {
    const cap = captureConsole(t);
    const base = answerSql();
    const failing = async (strings, ...values) => {
      if (strings.join('?').includes('correction-priors')) throw new Error('db down דני');
      return base(strings, ...values);
    };
    assert.equal((await answerFix(failing)).status, 'answered');
    assert.doesNotMatch(cap.text(), /דני|db down/);
  });

  const intake = async (rules) => {
    const sql = fakeSql((text) => {
      if (text.includes('candidate_rules')) return rules;
      return [];
    });
    const result = await processSource({
      sql, timetable: null,
      source: { id: SRC, channel: 'app', raw_content: TEXT_A, content_hash: 'h', received_at: new Date('2026-10-19T08:30:00+03:00') },
    });
    const write = sql.calls.find((call) => /INTO facts/.test(call.text));
    const facts = JSON.parse(write.values.find((v) => typeof v === 'string' && v.startsWith('[{"field"')));
    return { sql, result, facts };
  };

  test('כלל מאושר שמתאים: השעה בקליטה היא של הכלל (origin=inferred), בלי קריאת AI', async () => {
    const { facts } = await intake([{ pattern: 'אצל דני', evidence: { kind: 'correction', field: 'time', value: '17:00', from: ['16:00'], roots: ['אצל', 'דני'] } }]);
    assert.equal(facts.find((f) => f.field === 'time').value, '17:00');
    assert.equal(facts.find((f) => f.field === 'time').origin, 'inferred');
  });
  test('בלי כללים מאושרים: השעה כפי שנקראה מההודעה (תיקון ראשון לא משנה כלום)', async () => {
    const { facts } = await intake([]);
    assert.equal(facts.find((f) => f.field === 'time').value, '16:00');
  });
  test('הערוץ של הקיצור: הכללים אפילו לא נטענים', async () => {
    const sql = fakeSql(() => []);
    await processSource({ sql, timetable: null, source: { id: SRC, channel: 'shortcut', raw_content: TEXT_A, content_hash: 'h', received_at: new Date('2026-10-19T08:30:00+03:00') } });
    assert.equal(sql.find('FROM candidate_rules').length, 0);
  });
});
