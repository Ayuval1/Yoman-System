// זיהוי שהודעה שייכת לאירוע קיים (בלוק 4; lib/event-match.js; docs/01-foundation/אפיון.md "בלוק 2 — זיהוי האובייקט"; 35 סעיף 8.3).
// כל הטקסטים מומצאים, בלי שמות. 22.11.2026 הוא יום ראשון; שעון ישראל בחורף = UTC+2.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql, formRequest, jsonRequest, captureConsole, FAKE_SECRET } from './helpers.js';
import {
  titleOverlap, readChange, targetFor, decideMatch, examLinkFor, eventLabel, questionFor, parseMatchAnswer, matchButtons, answerEventMatch,
  brainCandidates, updateReply, duplicateReply, keepsEnd, MATCH_YES, MATCH_NO, MATCH_ENTITY,
} from '../lib/event-match.js';
import { processSource } from '../lib/intake-process.js';
import { buildPrompt, isValidUnderstanding, understandSource } from '../lib/intake-brain.js';
import { pendingFromRows } from '../lib/chat-view.js';
import { handle as intakeHandle } from '../api/intake.js';
import { handle as chatHandle } from '../api/chat.js';

const SUNDAY_MORNING = new Date('2026-11-22T08:00:00Z'); // ראשון 10:00 בישראל
const TODAY = '2026-11-22';
const SRC_ID = '33333333-3333-4333-8333-333333333333';
const MSG_ID = '22222222-2222-4222-8222-222222222222';
const EV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SRC_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const SRC_B = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';

const candidate = (id, title, date, time, sourceId = SRC_A) => ({ id, title, date, time, domain: 'personal', sourceId });
const BARBER = candidate(EV_A, 'תור לספר', TODAY, '17:00');
const TEACHER_TODAY = candidate(EV_A, 'פגישה עם המורה', TODAY, '16:00', SRC_A);
const TEACHER_TOMORROW = candidate(EV_B, 'פגישה עם המורה', '2026-11-23', '16:00', SRC_B);
const row = (c) => ({ id: c.id, title: c.title, domain: c.domain, match_key: `source:${c.sourceId}`, start_date: c.date, start_time: c.time });
const isPoolQuery = (text) => text.includes("FROM events WHERE status = 'planned' AND match_key LIKE 'source:%'");

const changeOf = (type, text, facts = [], understanding = null) => readChange({ type, facts, text, receivedAt: SUNDAY_MORNING, understanding });

describe('התאמת כותרת לפי שורש מקורב', () => {
  test('"התור לספר עבר ל-18:00" מול "תור לספר": שתי המילים (ה וּל הן אותיות שימוש)', () => {
    assert.deepEqual(titleOverlap('תור לספר', 'התור לספר עבר ל-18:00'), { matched: 2, total: 2 });
  });
  test('"הפגישה עם המורה" מול "פגישה עם המורה למתמטיקה": 2 מתוך 3 ("עם" היא מילת פונקציה)', () => {
    assert.deepEqual(titleOverlap('פגישה עם המורה למתמטיקה', 'הפגישה עם המורה נדחתה'), { matched: 2, total: 3 });
  });
  test('כותרת שאין לה שום מילה בהודעה: 0', () => {
    assert.deepEqual(titleOverlap('אימון ריצה', 'התור לספר בוטל'), { matched: 0, total: 2 });
  });
});

describe('מה ההודעה משנה', () => {
  test('הזזה עם שעה: השעה החדשה, בלי תאריך חדש ובלי תאריך מקורי', () => {
    assert.deepEqual(changeOf('move', 'התור לספר עבר ל-18:00'), { cancel: false, date: null, times: ['18:00'], unclear: false, refDate: null });
  });
  test('ביטול', () => {
    assert.equal(changeOf('cancel', 'הפגישה עם המורה בוטלה').cancel, true);
  });
  test('השעה הישנה מוזכרת: היעד הוא השעה האחרת', () => {
    const change = changeOf('move', 'התור של 17:00 עבר ל-18:00');
    assert.deepEqual(targetFor(BARBER, change), { cancel: false, date: TODAY, time: '18:00', same: false });
  });
  test('שעה עמומה ("לחמש" לא נקראת) או שתי שעות חדשות: אין יעד ברור', () => {
    assert.equal(targetFor(BARBER, { cancel: false, date: null, times: ['18:00', '19:00'], unclear: false }), null);
    assert.equal(targetFor(BARBER, { cancel: false, date: null, times: [], unclear: true }), null);
  });
  test('אירוע אישי בלי תאריך כתוב: התאריך שהוסק ("היום") אינו שינוי תאריך', () => {
    const facts = [{ field: 'date', value: TODAY, origin: 'inferred' }, { field: 'time', value: '17:00', origin: 'read' }];
    assert.deepEqual(changeOf('personal_event', 'פגישה עם המורה ב-17:00', facts), { cancel: false, date: null, times: ['17:00'], unclear: false, refDate: null });
  });
});

describe('ההכרעה (בלי מוח: ניקוד בקוד)', () => {
  const decide = (type, text, pool, extra = {}) => decideMatch({ pool, text, type, change: changeOf(type, text, extra.facts ?? []), today: TODAY, ...extra });

  test('"התור לספר עבר ל-18:00" מול "תור לספר" היום 17:00: עדכון ל-18:00', () => {
    const decision = decide('move', 'התור לספר עבר ל-18:00', [BARBER]);
    assert.equal(decision.kind, 'update');
    assert.equal(decision.candidate.id, EV_A);
    assert.deepEqual(decision.target, { cancel: false, date: TODAY, time: '18:00', same: false });
    assert.equal(updateReply(decision.candidate, decision.target), 'עודכן · תור לספר · ראשון 22.11 · 18:00');
  });
  test('"הפגישה עם המורה נדחתה ל-17:00" עם שתי פגישות: שאלה עם שתי אפשרויות', () => {
    const decision = decide('move', 'הפגישה עם המורה נדחתה ל-17:00', [TEACHER_TOMORROW, TEACHER_TODAY]);
    assert.equal(decision.kind, 'ask');
    assert.deepEqual(decision.options.map((o) => o.candidate.id), [EV_A, EV_B], 'לפי סדר המועד');
    assert.deepEqual(questionFor(decision.options), {
      text: 'זה אותו דבר כמו אחד מאלה?',
      buttons: ['פגישה עם המורה · ראשון 22.11 · 16:00', 'פגישה עם המורה · שני 23.11 · 16:00', MATCH_NO],
    });
  });
  test('התאמה חלקית אחת (חצי מהמילים): שאלה "זה אותו דבר כמו ...?" עם כן / לא', () => {
    const decision = decide('cancel', 'הפגישה בוטלה', [candidate(EV_A, 'פגישה עם המורה', TODAY, '16:00')]);
    assert.equal(decision.kind, 'ask');
    assert.deepEqual(questionFor(decision.options), { text: 'זה אותו דבר כמו פגישה עם המורה · ראשון 22.11 · 16:00?', buttons: [MATCH_YES, MATCH_NO] });
  });
  test('אין מילה משותפת: אין התאמה (המסלול הקיים)', () => {
    assert.equal(decide('move', 'האימון עבר ל-19:00', [BARBER]).kind, 'none');
  });
  test('מחוץ לחלון: תאריך מקורי שנאמר רחוק מהאירוע', () => {
    const facts = [{ field: 'date', value: '2026-11-26', origin: 'inferred' }];
    assert.equal(decide('cancel', 'התור לספר ביום חמישי בוטל', [BARBER], { facts }).kind, 'none');
  });
  test('אירוע אישי זהה (אותו יום ואותה שעה): כפילות, "כבר רשום"', () => {
    const facts = [{ field: 'date', value: TODAY, origin: 'inferred' }, { field: 'time', value: '17:00', origin: 'read' }];
    const decision = decide('personal_event', 'תור לספר היום ב-17:00', [BARBER], { facts });
    assert.equal(decision.kind, 'duplicate');
    assert.equal(duplicateReply(decision.candidate), 'כבר רשום · תור לספר · ראשון 22.11 · 17:00');
  });
  test('אירוע אישי באותו שם ושעה אחרת: שאלה (אולי הזזה, אולי אירוע שני)', () => {
    const facts = [{ field: 'date', value: TODAY, origin: 'inferred' }, { field: 'time', value: '18:00', origin: 'read' }];
    assert.equal(decide('personal_event', 'תור לספר היום ב-18:00', [BARBER], { facts }).kind, 'ask');
  });
  test('"הגב" על הודעה של אירוע: האירוע הוא ההתאמה, בלי מאגר ובלי שאלה', () => {
    const decision = decideMatch({ pool: [], replyEvent: BARBER, text: 'עבר ל-18:00', type: 'move', change: changeOf('move', 'עבר ל-18:00'), today: TODAY });
    assert.equal(decision.kind, 'update');
    assert.equal(decision.by, 'reply');
  });
});

describe('ההכרעה עם המוח', () => {
  const text = 'התור לספר עבר ל-18:00';
  const change = changeOf('move', text);
  const decide = (brain, pool = [BARBER]) => decideMatch({ pool, text, type: 'move', change, today: TODAY, brain });
  test('המוח בטוח והקוד לא סותר: עדכון', () => {
    assert.equal(decide({ key: 'e1', sure: true }).kind, 'update');
  });
  test('המוח לא בטוח: שאלה', () => {
    assert.equal(decide({ key: 'e1', sure: false }).kind, 'ask');
  });
  test('המוח בטוח אבל אין אף מילה משותפת: שאלה, לא עדכון', () => {
    const decision = decideMatch({ pool: [candidate(EV_A, 'אימון', TODAY, '17:00')], text, type: 'move', change, today: TODAY, brain: { key: 'e1', sure: true } });
    assert.equal(decision.kind, 'ask');
  });
  test('המוח אמר "חדש" והקוד רואה התאמה מלאה: שאלה. התאמה חלקית: חדש', () => {
    assert.equal(decide({ key: null, sure: false }).kind, 'ask');
    assert.equal(decideMatch({ pool: [candidate(EV_A, 'פגישה עם המורה', TODAY, '16:00')], text: 'הפגישה נדחתה ל-17:00', type: 'move', change: changeOf('move', 'הפגישה נדחתה ל-17:00'), today: TODAY, brain: { key: null, sure: false } }).kind, 'none');
  });
  test('הפרומפט: המועמדים עם מפתחות; בלי מועמדים הפרומפט לא השתנה', () => {
    const prompt = buildPrompt({ text, candidates: brainCandidates([BARBER]) });
    assert.match(prompt, /e1: תור לספר · ראשון 22\.11 · 17:00/);
    assert.match(prompt, /match_sure/);
    assert.equal(buildPrompt({ text }), buildPrompt({ text, candidates: [] }));
    assert.doesNotMatch(buildPrompt({ text }), /match/);
  });
  test('בדיקת הפורמט: match חייב להיות אחד המפתחות', () => {
    const base = { kind: 'move', subject: null, topic: null, date_text: null, new_date_text: null, time_text: 'ל-18:00', new_room: null, uncertain: [] };
    assert.equal(isValidUnderstanding({ ...base, match: 'e1', match_sure: true }, text, ['e1']), true);
    assert.equal(isValidUnderstanding({ ...base, match: 'e9', match_sure: true }, text, ['e1']), false);
    assert.equal(isValidUnderstanding({ ...base, match: null }, text, ['e1']), true);
    assert.equal(isValidUnderstanding({ ...base, match: 'e1', match_sure: 'yes' }, text, ['e1']), false);
  });
  test('understandSource: טוען המועמדים נקרא רק כשיש מפתח, ו-match נשמר', async () => {
    let loaded = 0;
    const loadCandidates = async () => { loaded += 1; return brainCandidates([BARBER]); };
    const none = await understandSource({ sql: fakeSql(), source: { raw_content: text }, apiKey: '', loadCandidates });
    assert.deepEqual(none, { ok: false, reason: 'no-key' });
    assert.equal(loaded, 0);
    let prompt = '';
    const ask = async (options) => {
      prompt = options.prompt;
      const data = { kind: 'move', subject: null, topic: 'התור לספר', date_text: null, new_date_text: null, time_text: 'ל-18:00', new_room: null, uncertain: [], match: 'e1', match_sure: true };
      return options.schema(data) ? { ok: true, model: 'm', data } : { ok: false, reason: 'failed' };
    };
    const out = await understandSource({ sql: fakeSql(), source: { raw_content: text }, apiKey: 'k', ask, loadCandidates });
    assert.equal(loaded, 1);
    assert.match(prompt, /e1: תור לספר/);
    assert.equal(out.understanding.match, 'e1');
    assert.equal(out.understanding.match_sure, true);
  });
});

describe('מבחן מהלוח: זיהוי בלבד', () => {
  const EXAMS = [{ date: '2026-11-25', type: 'מבחן', subject: 'היסטוריה', makeup: false }, { date: '2026-11-25', type: 'מבחן', subject: 'היסטוריה', makeup: true }];
  test('"המבחן בהיסטוריה נדחה ליום ראשון": המבחן היחיד בהיסטוריה בחלון', () => {
    const facts = [{ field: 'subject', value: 'היסטוריה', origin: 'read' }, { field: 'new_date', value: '2026-11-29', origin: 'inferred' }];
    assert.deepEqual(examLinkFor({ text: 'המבחן בהיסטוריה נדחה ליום ראשון', type: 'move', facts, today: TODAY, exams: EXAMS }), { date: '2026-11-25', subject: 'היסטוריה', type: 'מבחן' });
  });
  test('בלי מילת מבחן ("השיעור בהיסטוריה נדחה"): אין קישור', () => {
    const facts = [{ field: 'subject', value: 'היסטוריה', origin: 'read' }];
    assert.equal(examLinkFor({ text: 'השיעור בהיסטוריה נדחה ליום ראשון', type: 'move', facts, today: TODAY, exams: EXAMS }), null);
  });
  test('שני מבחנים במקצוע בחלון: אין קישור (לא מנחשים)', () => {
    const two = [...EXAMS, { date: '2026-12-01', type: 'מבחן', subject: 'היסטוריה', makeup: false }];
    const facts = [{ field: 'subject', value: 'היסטוריה', origin: 'read' }];
    assert.equal(examLinkFor({ text: 'המבחן בהיסטוריה נדחה', type: 'move', facts, today: TODAY, exams: two }), null);
  });
  test('דרך הצינור (הלוח האמיתי, מבדק היסטוריה 15.10): "נרשם" עם שורת המבחן ועובדת קישור', async () => {
    const sql = fakeSql(() => []);
    const source = { id: SRC_ID, channel: 'app', raw_content: 'המבחן בהיסטוריה נדחה ליום ראשון', content_hash: 'h', received_at: new Date('2026-10-11T08:00:00Z') };
    const result = await processSource({ sql, source, timetable: null });
    assert.equal(result.status, 'recorded');
    assert.equal(result.reply, 'נרשם · הזזה · היסטוריה · ראשון 18.10 · מבדק מחמישי 15.10');
    const [write] = sql.find('INSERT INTO facts');
    const facts = JSON.parse(write.values.find((v) => typeof v === 'string' && v.startsWith('[{')));
    assert.ok(facts.some((f) => f.field === 'match' && f.value === 'exam:2026-10-15:היסטוריה'));
    assert.ok(facts.some((f) => f.field === 'date' && f.value === '2026-10-15' && f.origin === 'inferred'));
  });
});

describe('הצינור: עדכון, כפילות, שאלה, ובלי התאמה', () => {
  const db = (pool) => fakeSql((text) => {
    if (isPoolQuery(text)) return pool.map(row);
    if (text.includes('UPDATE events SET starts_at = CASE')) return [{ claimed: 1, updated: 1, bubble_id: 'b' }];
    return [];
  });
  const typed = (text) => ({ id: SRC_ID, channel: 'app', raw_content: text, content_hash: 'h', received_at: SUNDAY_MORNING });

  test('"התור לספר עבר ל-18:00": עדכון האירוע הקיים בפקודה אחת, בלי אירוע חדש', async () => {
    const sql = db([BARBER]);
    const result = await processSource({ sql, source: typed('התור לספר עבר ל-18:00'), timetable: null });
    assert.deepEqual(result, { status: 'recorded', reply: 'עודכן · תור לספר · ראשון 22.11 · 18:00', matched: { sourceId: SRC_A } });
    const writes = sql.find('UPDATE events SET starts_at = CASE');
    assert.equal(writes.length, 1);
    const { text, values } = writes[0];
    assert.match(text, /WITH claim AS \( UPDATE sources SET processed_at = now\(\)/);
    assert.match(text, /\+ \(ends_at - starts_at\)/, 'ההמשך נשמר');
    assert.match(text, /SELECT claim\.id, x\.field, x\.value, \?::text, 'script', 'event', \?::uuid/, 'העובדות מקושרות לאירוע');
    assert.ok(values.includes(TODAY) && values.includes('18:00') && values.includes(EV_A));
    const facts = JSON.parse(values.find((v) => typeof v === 'string' && v.startsWith('[{')));
    assert.deepEqual(facts.find((f) => f.field === 'match'), { field: 'match', value: EV_A, origin: 'inferred' });
    assert.equal(sql.find('INSERT INTO events').length, 0);
    assert.equal(sql.find("INSERT INTO probe_log (probe, ok, detail) VALUES ('event-match'").length, 1);
    assert.doesNotMatch(JSON.stringify(sql.find('probe_log')), /תור/, 'בלי כותרת בלוג');
  });
  test('"הפגישה עם המורה בוטלה" עם פגישה אחת: ביטול (status cancelled), בועת "בוטל"', async () => {
    const sql = db([TEACHER_TODAY]);
    const result = await processSource({ sql, source: typed('הפגישה עם המורה בוטלה'), timetable: null });
    assert.equal(result.reply, 'בוטל · פגישה עם המורה · ראשון 22.11 · 16:00');
    assert.match(sql.find('UPDATE events SET starts_at = CASE')[0].text, /status = CASE WHEN \?::boolean THEN 'cancelled' ELSE status END/);
  });
  test('"היציאה המוקדמת הוקדמה ל-12:00": באותו יום הסוף (סוף יום הלימודים) נשאר', async () => {
    const leave = { ...candidate(EV_A, 'יציאה מוקדמת', TODAY, '13:00'), domain: 'school' };
    const sql = db([leave]);
    const result = await processSource({ sql, source: typed('היציאה המוקדמת הוקדמה ל-12:00'), timetable: null });
    assert.equal(result.reply, 'עודכן · יציאה מוקדמת · ראשון 22.11 · 12:00');
    const [write] = sql.find('UPDATE events SET starts_at = CASE');
    assert.match(write.text, /THEN GREATEST\(ends_at,/);
    assert.equal(keepsEnd(leave, { cancel: false, date: TODAY, time: '12:00' }), true);
    assert.equal(keepsEnd(leave, { cancel: false, date: '2026-11-23', time: '12:00' }), false, 'יום אחר: ההמשך נשמר');
    assert.equal(keepsEnd(BARBER, { cancel: false, date: TODAY, time: '18:00' }), false, 'אירוע אישי: ההמשך נשמר');
    assert.equal(keepsEnd({ ...leave, title: 'הרצאה בנושא שוויון' }, { cancel: false, date: TODAY, time: '12:00' }), false, 'הרצאה ב-school (25.11): ההמשך נשמר, לא אורך אפס');
  });
  test('שתי פגישות: שאלת זיהוי (event_match), המקור לא נתפס, בלי אירוע ובלי בועה', async () => {
    const sql = db([TEACHER_TODAY, TEACHER_TOMORROW]);
    const result = await processSource({ sql, source: typed('הפגישה עם המורה נדחתה ל-17:00'), timetable: null });
    assert.deepEqual(result, { status: 'recorded', reply: 'זה אותו דבר כמו אחד מאלה?' });
    const [question] = sql.find("'event_match', s.id, 1");
    assert.ok(question);
    assert.match(question.text, /AND s\.processed_at IS NULL/);
    assert.match(question.text, /NOT EXISTS \(SELECT 1 FROM messages x WHERE x\.kind = 'question' AND x\.entity_type = 'event_match'/);
    const payload = JSON.parse(question.values.find((v) => typeof v === 'string' && v.includes('"options"')));
    assert.deepEqual(payload.options.map((o) => o.id), [EV_A, EV_B]);
    assert.equal(payload.type, 'move');
    assert.equal(sql.find('UPDATE sources SET processed_at').length, 0);
    assert.equal(sql.find('INSERT INTO events').length, 0);
  });
  test('אירוע אישי חדש בלי מועמד דומה: המסלול הקיים (אירוע חדש)', async () => {
    const sql = db([candidate(EV_A, 'אימון ריצה', TODAY, '17:00')]);
    const result = await processSource({ sql, source: typed('תור לספר היום ב-18:00'), timetable: null });
    assert.match(result.reply, /^נרשם · אירוע אישי · תור לספר/);
    assert.equal(sql.find('INSERT INTO events').length, 1);
    assert.equal(sql.find('UPDATE events SET starts_at = CASE').length, 0);
  });
  test('ביטול שיעור (בלי מועמד דומה): בלי שינוי', async () => {
    const sql = db([BARBER]);
    const result = await processSource({ sql, source: typed('מחר בוטל שיעור אנגלית'), timetable: null });
    assert.equal(result.reply, 'נרשם · ביטול · אנגלית · שני 23.11');
    assert.equal(sql.find('UPDATE events SET starts_at = CASE').length, 0);
  });
  test('matchDisabled (אחרי "לא, חדש"): אין שליפת מועמדים', async () => {
    const sql = db([BARBER]);
    await processSource({ sql, source: typed('התור לספר עבר ל-18:00'), timetable: null, matchDisabled: true });
    assert.equal(sql.calls.filter((c) => isPoolQuery(c.text)).length, 0);
  });
  test('"הגב" על הבועה של האירוע: עדכון גם בלי מילה משותפת', async () => {
    const sql = fakeSql((text) => {
      if (text.includes('WITH s AS ( SELECT CASE WHEN')) return [row(BARBER)];
      if (isPoolQuery(text)) return [];
      return [];
    });
    const result = await processSource({ sql, source: typed('עבר ל-18:00'), timetable: null, replyTo: { id: MSG_ID, role: 'system' } });
    assert.equal(result.reply, 'עודכן · תור לספר · ראשון 22.11 · 18:00');
  });
  test('המוח: מקבל את המועמדים ומכריע (match e1, בטוח)', async () => {
    const sql = db([BARBER]);
    let seen = null;
    const understand = async (extra) => {
      seen = await extra.loadCandidates();
      return { ok: true, model: 'm', understanding: { kind: 'move', subject: null, topic: 'התור לספר', date_text: null, new_date_text: null, time_text: 'ל-18:00', new_room: null, uncertain: [], match: 'e1', match_sure: true } };
    };
    const result = await processSource({ sql, source: typed('התור לספר עבר ל-18:00'), timetable: null, understand });
    assert.deepEqual(seen, [{ key: 'e1', label: 'תור לספר · ראשון 22.11 · 17:00' }]);
    assert.equal(result.reply, 'עודכן · תור לספר · ראשון 22.11 · 18:00');
    assert.equal(result.brain, 'ok');
    assert.match(sql.find("VALUES ('event-match'")[0].values.join(' '), /by=brain/);
  });
});

describe('שאלת הזיהוי בצ\'אט', () => {
  const payload = (options) => JSON.stringify({ options, type: 'move', facts: [], certainty: 'probable', understanding: null });
  const ONE = [{ id: EV_A, title: 'תור לספר', date: TODAY, time: '17:00', sourceId: SRC_A, target: { cancel: false, date: TODAY, time: '18:00', same: false } }];
  const TWO = [
    { id: EV_A, title: 'פגישה עם המורה', date: TODAY, time: '16:00', sourceId: SRC_A, target: { cancel: false, date: TODAY, time: '17:00', same: false } },
    { id: EV_B, title: 'פגישה עם המורה', date: '2026-11-23', time: '16:00', sourceId: SRC_B, target: { cancel: false, date: '2026-11-23', time: '17:00', same: false } },
  ];
  const db = (options, { awaiting = true, closed = 1 } = {}) => fakeSql((text) => {
    if (text.includes("m.entity_type = 'event_match' AND (m.expires_at")) {
      return [{ id: MSG_ID, awaiting_reply: awaiting, source_id: SRC_ID, channel: 'app', raw_content: 'x', content_hash: 'h', received_at: SUNDAY_MORNING, pending: payload(options) }];
    }
    if (text.startsWith('WITH closed AS')) return [{ closed, answer_source_id: 'ans' }];
    if (text.includes('UPDATE events SET starts_at = CASE')) return [{ claimed: 1, updated: 1, bubble_id: 'b' }];
    return [];
  });

  test('כפתורים ופענוח: אחד = כן / לא; כמה = תווית לכל מועמד', () => {
    assert.deepEqual(matchButtons({ options: ONE }), [MATCH_YES, MATCH_NO]);
    assert.equal(parseMatchAnswer({ options: ONE }, MATCH_YES), 0);
    assert.equal(parseMatchAnswer({ options: ONE }, MATCH_NO), -1);
    assert.equal(parseMatchAnswer({ options: ONE }, 'אולי'), null);
    assert.equal(parseMatchAnswer({ options: TWO }, eventLabel(TWO[1])), 1);
  });
  test('"כן, אותו דבר": סגירה, ואז עדכון האירוע הקיים ובועת "עודכן"', async () => {
    const sql = db(ONE);
    const out = await answerEventMatch({ sql, messageId: MSG_ID, answer: MATCH_YES, now: SUNDAY_MORNING });
    assert.equal(out.status, 'answered');
    assert.deepEqual(out.matched, { sourceId: SRC_A });
    const [write] = sql.find('UPDATE events SET starts_at = CASE');
    assert.ok(write.values.includes('עודכן · תור לספר · ראשון 22.11 · 18:00'));
    assert.ok(write.values.includes(SRC_ID), 'נתפס המקור של ההודעה');
  });
  test('בחירה באחת משתי פגישות: האירוע שנבחר', async () => {
    const sql = db(TWO);
    const out = await answerEventMatch({ sql, messageId: MSG_ID, answer: eventLabel(TWO[1]), now: SUNDAY_MORNING });
    assert.deepEqual(out.matched, { sourceId: SRC_B });
    assert.ok(sql.find('UPDATE events SET starts_at = CASE')[0].values.includes(EV_B));
  });
  test('"לא, חדש": סגירה ואז המסלול הקיים (replay) עם מה שהמוח הבין, בלי עדכון', async () => {
    const sql = db(ONE);
    const calls = [];
    const out = await answerEventMatch({ sql, messageId: MSG_ID, answer: MATCH_NO, now: SUNDAY_MORNING, replay: async (args) => { calls.push(args); return { status: 'recorded' }; } });
    assert.equal(out.status, 'answered');
    assert.deepEqual(out.replayed, { sourceId: SRC_ID, status: 'recorded' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].source.id, SRC_ID);
    assert.equal(sql.find('UPDATE events SET starts_at = CASE').length, 0);
  });
  test('תשובה לא מוכרת: unclear בלי כתיבה. שאלה סגורה או לחיצה כפולה: closed', async () => {
    const unclear = db(ONE);
    assert.equal((await answerEventMatch({ sql: unclear, messageId: MSG_ID, answer: 'אולי', now: SUNDAY_MORNING })).status, 'unclear');
    assert.equal(unclear.find('WITH closed AS').length, 0);
    assert.equal((await answerEventMatch({ sql: db(ONE, { awaiting: false }), messageId: MSG_ID, answer: MATCH_YES, now: SUNDAY_MORNING })).status, 'closed');
    const race = db(ONE, { closed: 0 });
    assert.equal((await answerEventMatch({ sql: race, messageId: MSG_ID, answer: MATCH_YES, now: SUNDAY_MORNING })).status, 'closed');
    assert.equal(race.find('UPDATE events SET starts_at = CASE').length, 0);
  });
  test('pendingFromRows: כרטיס event_match עם הכפתורים מהשאלה ובלי תיבת כתיבה', () => {
    const [item] = pendingFromRows({ questions: [{ id: MSG_ID, body: 'זה אותו דבר כמו אחד מאלה?', sent_at: SUNDAY_MORNING, entity_type: MATCH_ENTITY, match_pending: payload(TWO) }], facts: [], timetable: null, today: TODAY });
    assert.deepEqual(item, {
      id: MSG_ID, kind: 'event_match', at: SUNDAY_MORNING.toISOString(), text: 'זה אותו דבר כמו אחד מאלה?',
      buttons: [eventLabel(TWO[0]), eventLabel(TWO[1]), MATCH_NO], allowFreeText: false,
    });
  });
  test('api/chat.js: answer על שאלת זיהוי, וכתיבה ליומן של האירוע הקיים עם PATCH', async () => {
    const sql = db(ONE);
    const synced = [];
    const res = await chatHandle(jsonRequest({ action: 'answer', message_id: MSG_ID, answer: MATCH_YES }, { headers: { 'x-intake-secret': FAKE_SECRET } }), {
      sql, secret: FAKE_SECRET, timetable: null, now: () => SUNDAY_MORNING, eventSync: async () => ({}), googleDay: undefined,
      sourceSync: async (args) => { synced.push(args); return {}; },
    });
    assert.equal((await res.json()).status, 'answered');
    assert.equal(synced.length, 1);
    assert.equal(synced[0].sourceId, SRC_A);
    assert.equal(synced[0].allowPatch, true);
  });
});

describe('api/intake.js: כתיבה ליומן אחרי עדכון', () => {
  test('matched: האירוע הקיים (לפי המקור שלו) עם PATCH; אחרת המקור החדש כמו קודם', async (t) => {
    captureConsole(t);
    const run = async (result) => {
      const calls = [];
      const sql = fakeSql((text) => (text.includes('INSERT INTO sources') ? [{ id: SRC_ID, received_at: SUNDAY_MORNING }] : []));
      await intakeHandle(formRequest({ text: 'x', channel: 'app' }, { headers: { 'x-intake-secret': FAKE_SECRET } }), {
        sql, secret: FAKE_SECRET, now: () => SUNDAY_MORNING, understand: async () => ({ ok: false, reason: 'no-key' }), googleDay: undefined,
        processor: async () => result, eventSync: async (args) => { calls.push(args); return {}; }, sendQueue: async () => {},
      });
      return calls;
    };
    const matched = await run({ status: 'recorded', reply: 'עודכן', matched: { sourceId: SRC_A } });
    assert.equal(matched.length, 1);
    assert.equal(matched[0].sourceId, SRC_A);
    assert.equal(matched[0].allowPatch, true);
    const plain = await run({ status: 'recorded', reply: 'נרשם' });
    assert.equal(plain[0].sourceId, SRC_ID);
    assert.equal(plain[0].allowPatch, undefined);
  });
  test('replyTo עובר לצינור', async () => {
    let got = null;
    const sql = fakeSql((text) => (text.includes('INSERT INTO sources') ? [{ id: SRC_ID, received_at: SUNDAY_MORNING }] : []));
    await intakeHandle(formRequest({ text: 'עבר ל-18:00', channel: 'app', reply_to: MSG_ID, reply_to_role: 'system' }, { headers: { 'x-intake-secret': FAKE_SECRET } }), {
      sql, secret: FAKE_SECRET, now: () => SUNDAY_MORNING, understand: async () => ({ ok: false, reason: 'no-key' }), googleDay: undefined,
      processor: async (args) => { got = args.replyTo; return { status: 'skipped' }; }, eventSync: async () => ({}), sendQueue: async () => {},
    });
    assert.deepEqual(got, { id: MSG_ID, role: 'system' });
  });
});

// ---------------------------------------------------------------------------
// המשך 1: מבחן שנדחה או בוטל (עובדת קישור) מוצג כך בבריף, בשורת המבחן של 21:00 ובכרטיס הבריף.
// ---------------------------------------------------------------------------
import { applyExamChanges, examsOnDate, examLineAt } from '../lib/exam-line.js';
import { loadExamChanges } from '../lib/exam-ask.js';
import { composeBrief } from '../lib/brief-view.js';

describe('מבחן שנדחה או בוטל: שכבה על הלוח בזמן קריאה', () => {
  const EXAMS = [{ date: '2026-11-25', type: 'מבחן', subject: 'היסטוריה', makeup: false }, { date: '2026-11-25', type: 'מבחן', subject: 'אנגלית', makeup: false }];
  const key = 'exam:2026-11-25:היסטוריה';
  test('בוטל: המבחן נעלם', () => {
    const list = applyExamChanges(EXAMS, [{ link: key, type: 'cancel', newDate: null }]);
    assert.deepEqual(examsOnDate('2026-11-25', { exams: list }).map((e) => e.subject), ['אנגלית']);
  });
  test('נדחה למועד ידוע: מוצג במועד החדש ולא בישן', () => {
    const list = applyExamChanges(EXAMS, [{ link: key, type: 'move', newDate: '2026-11-29' }]);
    assert.deepEqual(examsOnDate('2026-11-25', { exams: list }).map((e) => e.subject), ['אנגלית']);
    assert.deepEqual(examsOnDate('2026-11-29', { exams: list }).map((e) => e.text), ['מבחן בהיסטוריה']);
  });
  test('נדחה בלי מועד חדש: במועד הישן שורת "נדחה" במקום השורה הרגילה', () => {
    const list = applyExamChanges(EXAMS, [{ link: key, type: 'move', newDate: null }]);
    assert.deepEqual(examsOnDate('2026-11-25', { exams: list }).map((e) => e.text), ['מבחן בהיסטוריה נדחה, מועד חדש לא ידוע', 'מבחן באנגלית']);
  });
  test('כמה שינויים לאותו מבחן: האחרון גובר', () => {
    const list = applyExamChanges(EXAMS, [{ link: key, type: 'move', newDate: null }, { link: key, type: 'move', newDate: '2026-11-30' }]);
    assert.deepEqual(examsOnDate('2026-11-30', { exams: list }).map((e) => e.subject), ['היסטוריה']);
  });
  test('הלוח עצמו לא משתנה', () => {
    applyExamChanges(EXAMS, [{ link: key, type: 'cancel', newDate: null }]);
    assert.equal(EXAMS.length, 2);
    assert.equal(EXAMS[0].date, '2026-11-25');
  });
  test('בריף ושורת 21:00 עם הלוח המעודכן', () => {
    const list = applyExamChanges(EXAMS, [{ link: key, type: 'move', newDate: '2026-11-29' }]);
    assert.match(composeBrief({ dateIso: '2026-11-29', timetable: null, exams: list }).text, /היום: מבחן בהיסטוריה/);
    assert.doesNotMatch(composeBrief({ dateIso: '2026-11-25', timetable: null, exams: list }).text, /היסטוריה/);
    assert.equal(examLineAt(new Date('2026-11-28T19:30:00Z'), { exams: list }), 'מחר: מבחן בהיסטוריה'); // מוצאי שבת 21:30 בישראל
    assert.equal(examLineAt(new Date('2026-11-24T19:30:00Z'), { exams: list }), 'מחר: מבחן באנגלית');
  });
  test('loadExamChanges: שורות מהמסד, בסדר הקליטה; כשל = רשימה ריקה', async (t) => {
    const sql = fakeSql((text) => (text.includes("m.value LIKE 'exam:%'")
      ? [{ link: key, type: 'move', new_date: '2026-11-29' }, { link: 'x', type: 'other', new_date: null }]
      : []));
    assert.deepEqual(await loadExamChanges(sql), [{ link: key, type: 'move', newDate: '2026-11-29' }]);
    assert.match(sql.calls[0].text, /ORDER BY s\.received_at ASC/);
    captureConsole(t);
    assert.deepEqual(await loadExamChanges(fakeSql(() => { throw new Error('db'); })), []);
  });
  test('api/chat.js: שורת המבחן בסיכום משתמשת בשינויים', async () => {
    const sql = fakeSql((text) => {
      if (text.includes("m.value LIKE 'exam:%'")) return [{ link: 'exam:2026-10-15:היסטוריה', type: 'cancel', new_date: null }];
      return [];
    });
    const res = await chatHandle(new Request('https://x.test/api/chat', { headers: { 'x-intake-secret': FAKE_SECRET } }), {
      sql, secret: FAKE_SECRET, timetable: null, now: () => new Date('2026-10-14T19:30:00Z'), googleDay: undefined,
    });
    const body = await res.json();
    assert.equal(body.review.exam_line, null, 'מבדק ההיסטוריה של 15.10 בוטל');
  });
});

// ---------------------------------------------------------------------------
// המשך 2: "לא, חדש" שנכשל לא משאיר את ההודעה בשקט: השאלה נפתחת מחדש והשגיאה עולה (הדף מציג "לא נשלח, נסה שוב").
// ---------------------------------------------------------------------------
describe('"לא, חדש" שהעיבוד שלו נכשל', () => {
  const ONE = [{ id: EV_A, title: 'תור לספר', date: TODAY, time: '17:00', sourceId: SRC_A, target: { cancel: false, date: TODAY, time: '18:00', same: false } }];
  const db = () => fakeSql((text) => {
    if (text.includes("m.entity_type = 'event_match' AND (m.expires_at")) {
      return [{ id: MSG_ID, awaiting_reply: true, source_id: SRC_ID, channel: 'app', raw_content: 'x', content_hash: 'h', received_at: SUNDAY_MORNING, pending: JSON.stringify({ options: ONE, type: 'move', facts: [], certainty: 'probable', understanding: null }) }];
    }
    if (text.startsWith('WITH closed AS')) return [{ closed: 1, answer_source_id: 'ans' }];
    return [];
  });
  test('השאלה נפתחת מחדש (רק אם ההודעה עדיין לא עובדה), והשגיאה נזרקת', async (t) => {
    captureConsole(t);
    const sql = db();
    await assert.rejects(answerEventMatch({ sql, messageId: MSG_ID, answer: MATCH_NO, now: SUNDAY_MORNING, replay: async () => { throw Object.assign(new Error('x'), { name: 'DbError' }); } }), { name: 'DbError' });
    const [reopen] = sql.find('UPDATE messages SET awaiting_reply = true');
    assert.ok(reopen, 'השאלה נפתחה מחדש');
    assert.match(reopen.text, /AND awaiting_reply = false/);
    assert.match(reopen.text, /EXISTS \(SELECT 1 FROM sources s WHERE s\.id = \?::uuid AND s\.processed_at IS NULL\)/);
    assert.ok(reopen.values.includes(MSG_ID) && reopen.values.includes(SRC_ID));
  });
  test('api/chat.js: 500 "לא נשלח, נסה שוב." והשאלה חוזרת לרשימה', async (t) => {
    captureConsole(t);
    const sql = db();
    const failing = fakeSql((text, values, i) => {
      if (text.includes('WITH q AS') || text.includes('WITH claim AS')) throw Object.assign(new Error('x'), { name: 'DbError' });
      return sql(Object.assign([text], { raw: [text] }), ...values);
    });
    const res = await chatHandle(jsonRequest({ action: 'answer', message_id: MSG_ID, answer: MATCH_NO }, { headers: { 'x-intake-secret': FAKE_SECRET } }), {
      sql: failing, secret: FAKE_SECRET, timetable: null, now: () => SUNDAY_MORNING, eventSync: async () => ({}), googleDay: undefined, sourceSync: async () => ({}),
    });
    assert.equal(res.status, 500);
    assert.equal(failing.find('UPDATE messages SET awaiting_reply = true').length, 1);
  });
});

// ---------------------------------------------------------------------------
// המשך 3 (ממצא בודק): "כן, אותו דבר" שהכתיבה שלו נכשלת, או שהאירוע כבר לא מתוכנן.
// ---------------------------------------------------------------------------
describe('"כן, אותו דבר": כשל או אירוע שכבר לא מתוכנן', () => {
  const ONE = [{ id: EV_A, title: 'תור לספר', date: TODAY, time: '17:00', sourceId: SRC_A, target: { cancel: false, date: TODAY, time: '18:00', same: false } }];
  const db = (onWrite) => fakeSql((text) => {
    if (text.includes("m.entity_type = 'event_match' AND (m.expires_at")) {
      return [{ id: MSG_ID, awaiting_reply: true, source_id: SRC_ID, channel: 'app', raw_content: 'התור לספר עבר ל-18:00', content_hash: 'h', received_at: SUNDAY_MORNING, pending: JSON.stringify({ options: ONE, type: 'move', facts: [], certainty: 'probable', understanding: null }) }];
    }
    if (text.startsWith('WITH closed AS')) return [{ closed: 1, answer_source_id: 'ans' }];
    if (text.includes('UPDATE events SET starts_at = CASE')) return onWrite();
    return [];
  });
  test('הכתיבה נזרקת: השאלה נפתחת מחדש והשגיאה עולה', async (t) => {
    captureConsole(t);
    const sql = db(() => { throw Object.assign(new Error('x'), { name: 'DbError' }); });
    await assert.rejects(answerEventMatch({ sql, messageId: MSG_ID, answer: MATCH_YES, now: SUNDAY_MORNING, replay: async () => ({ status: 'recorded' }) }), { name: 'DbError' });
    assert.equal(sql.find('UPDATE messages SET awaiting_reply = true').length, 1);
  });
  test('האירוע כבר לא מתוכנן (claimed 0): ההודעה עוברת לקליטה הרגילה כחדשה, לא נבלעת', async () => {
    const sql = db(() => [{ claimed: 0, updated: 0, bubble_id: null }]);
    const calls = [];
    const out = await answerEventMatch({ sql, messageId: MSG_ID, answer: MATCH_YES, now: SUNDAY_MORNING, replay: async (args) => { calls.push(args); return { status: 'recorded' }; } });
    assert.equal(out.status, 'answered');
    assert.equal(out.matched, null);
    assert.deepEqual(out.replayed, { sourceId: SRC_ID, status: 'recorded' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].source.id, SRC_ID);
  });
  test('האירוע כבר לא מתוכנן והקליטה הרגילה נכשלת: השאלה נפתחת מחדש והשגיאה עולה', async (t) => {
    captureConsole(t);
    const sql = db(() => [{ claimed: 0, updated: 0, bubble_id: null }]);
    await assert.rejects(answerEventMatch({ sql, messageId: MSG_ID, answer: MATCH_YES, now: SUNDAY_MORNING, replay: async () => { throw Object.assign(new Error('y'), { name: 'DbError' }); } }));
    assert.equal(sql.find('UPDATE messages SET awaiting_reply = true').length, 1);
  });
});
