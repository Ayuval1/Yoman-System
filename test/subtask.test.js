// תתי-משימות (הכרעת יובל 22.11.2026; lib/subtask.js): המוח מציע ושואלים, קישור מפורש בצ'אט, כפתור ידני, רשימת "פתוחות", ועמודה חסרה במסד.
// כל הטקסטים מומצאים. 21.11.2026 הוא שבת; שעון ישראל בחורף = UTC+2. בלי רשת ובלי מסד אמיתי: sql מזויף מ-helpers.js.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql, captureConsole, jsonRequest, req, FAKE_SECRET } from './helpers.js';
import {
  decideParent, questionFor, subtaskButtons, parseSubtaskAnswer, parsePending, linkedReply, notLinkedReply, openSubtasksSuffix, brainTaskCandidates,
  loadParentPool, countOpenSubtasks, writeLink, writeSubtaskQuestion, answerSubtaskLink, linkSubtask, unlinkSubtask, closeSubtaskQuestions,
  suggestParentAfterRecord, isMissingColumn, resetMissingColumnNote,
  SUBTASK_YES, SUBTASK_NO, SUBTASK_ENTITY, MAX_OPTIONS, ASK_DAYS,
} from '../lib/subtask.js';
import { buildPrompt, isValidUnderstanding, understandSource } from '../lib/intake-brain.js';
import { processSource } from '../lib/intake-process.js';
import { orderOpenTasks, pendingFromRows, parseChatAction } from '../lib/chat-view.js';
import { loadOpenTasks, openTaskFromRow } from '../lib/homework-view.js';
import { answerTaskCheck, CHECK_ENTITY, CHECK_DONE } from '../lib/personal-task.js';
import { handle as chatHandle } from '../api/chat.js';

const SATURDAY_NOON = new Date('2026-11-21T12:00:00Z');
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NEW_TASK = uuid(1);
const PRESENTATION = { id: uuid(2), title: 'להכין מצגת בהיסטוריה' };
const ESSAY = { id: uuid(3), title: 'לכתוב חיבור באנגלית' };
const PRESENTATION_MATH = { id: uuid(4), title: 'להכין מצגת במתמטיקה' };
const SRC_ID = uuid(10);
const MSG_ID = uuid(11);
const H = { 'x-intake-secret': FAKE_SECRET };
const URL_CHAT = 'https://x.test/api/chat';
const missingColumn = () => Object.assign(new Error('column "parent_task_id" does not exist'), { name: 'NeonDbError', code: '42703' });

beforeEach(() => resetMissingColumnNote());

// ---------------------------------------------------------------------------
// ההכרעה
// ---------------------------------------------------------------------------

describe('decideParent: מפורש לפי שורש, הצעת המוח, ובלי ניחוש', () => {
  const pool = [PRESENTATION, ESSAY];
  test('מפורש ("למצגת בהיסטוריה"): התאמה חזקה אחת = קישור מיד', () => {
    const out = decideParent({ pool, taskId: NEW_TASK, parentText: 'למצגת בהיסטוריה' });
    assert.equal(out.kind, 'link');
    assert.equal(out.candidate, PRESENTATION);
    assert.equal(out.by, 'explicit');
  });
  test('מפורש לפי שורש, לא מחרוזת: "המצגת" מתאים ל"מצגת"', () => {
    assert.equal(decideParent({ pool, taskId: NEW_TASK, parentText: 'המצגת' }).kind, 'link');
  });
  test('מפורש ועמום ("המצגת" כששתי מצגות פתוחות): כרטיס עם שתיהן', () => {
    const out = decideParent({ pool: [PRESENTATION, ESSAY, PRESENTATION_MATH], taskId: NEW_TASK, parentText: 'המצגת' });
    assert.equal(out.kind, 'ask');
    assert.deepEqual(out.options, [PRESENTATION, PRESENTATION_MATH]);
  });
  test('מפורש עם שם מלא ("מצגת בהיסטוריה") כשגם מצגת במתמטיקה פתוחה: חזקה אחת = קישור (השנייה רק אפורה)', () => {
    const out = decideParent({ pool: [PRESENTATION_MATH, PRESENTATION], taskId: NEW_TASK, parentText: 'מצגת בהיסטוריה' });
    assert.equal(out.kind, 'link');
    assert.equal(out.candidate, PRESENTATION);
  });
  test('מפורש עם חצי התאמה בלבד ("מצגת בגאוגרפיה"): כרטיס, לא קישור', () => {
    const out = decideParent({ pool: [PRESENTATION, ESSAY], taskId: NEW_TASK, parentText: 'מצגת בגאוגרפיה' });
    assert.deepEqual(out, { kind: 'ask', options: [PRESENTATION], by: 'explicit', considered: 2 });
  });
  test('מפורש בלי התאמה, והמוח הציע t2: הכרטיס על ההצעה', () => {
    const out = decideParent({ pool, taskId: NEW_TASK, parentText: 'הפרויקט בביולוגיה', parentKey: 't2' });
    assert.deepEqual(out, { kind: 'ask', options: [ESSAY], by: 'brain', considered: 2 });
  });
  test('המוח הציע t1 בלי ביטוי מפורש: כרטיס (לא קישור מיד)', () => {
    assert.deepEqual(decideParent({ pool, taskId: NEW_TASK, parentKey: 't1' }), { kind: 'ask', options: [PRESENTATION], by: 'brain', considered: 2 });
  });
  test('מפתח שאינו במאגר, או המשימה עצמה: כלום', () => {
    assert.equal(decideParent({ pool, taskId: NEW_TASK, parentKey: 't9' }).kind, 'none');
    assert.equal(decideParent({ pool: [{ id: NEW_TASK, title: 'להכין שקופיות' }], taskId: NEW_TASK, parentKey: 't1' }).kind, 'none');
    assert.equal(decideParent({ pool, taskId: NEW_TASK }).kind, 'none');
    assert.equal(decideParent({ pool, taskId: NEW_TASK }).considered, 2);
  });
  test('כותרות זהות: כפתור אחד; ולא יותר מ-MAX_OPTIONS', () => {
    const twins = [PRESENTATION, { id: uuid(5), title: PRESENTATION.title }, PRESENTATION_MATH, { id: uuid(6), title: 'להכין מצגת בגאוגרפיה' }, { id: uuid(7), title: 'להכין מצגת בתנ"ך' }];
    const out = decideParent({ pool: twins, taskId: NEW_TASK, parentText: 'המצגת' });
    assert.equal(out.kind, 'ask');
    assert.equal(out.options.length, MAX_OPTIONS);
    assert.equal(new Set(out.options.map((o) => o.title)).size, MAX_OPTIONS);
  });
});

describe('נוסחים וכפתורים', () => {
  test('מועמד אחד: "זה חלק מ\'...\'?" עם "כן, תת-משימה" / "לא, נפרד"', () => {
    assert.deepEqual(questionFor([PRESENTATION]), { text: "זה חלק מ'להכין מצגת בהיסטוריה'?", buttons: [SUBTASK_YES, SUBTASK_NO] });
  });
  test('כמה מועמדים: כפתור לכל כותרת ו"לא, נפרד"', () => {
    assert.deepEqual(questionFor([PRESENTATION, PRESENTATION_MATH]).buttons, [PRESENTATION.title, PRESENTATION_MATH.title, SUBTASK_NO]);
  });
  test('פענוח תשובה', () => {
    const one = { options: [PRESENTATION] };
    const two = { options: [PRESENTATION, PRESENTATION_MATH] };
    assert.equal(parseSubtaskAnswer(one, SUBTASK_YES), 0);
    assert.equal(parseSubtaskAnswer(one, SUBTASK_NO), -1);
    assert.equal(parseSubtaskAnswer(one, 'אולי'), null);
    assert.equal(parseSubtaskAnswer(two, PRESENTATION_MATH.title), 1);
    assert.equal(parseSubtaskAnswer(two, SUBTASK_YES), null);
    assert.equal(parseSubtaskAnswer(null, SUBTASK_NO), -1, 'בלי מועמדים שמורים אפשר לסגור ב"לא, נפרד"');
    assert.equal(parseSubtaskAnswer(null, SUBTASK_YES), null);
  });
  test('parsePending וכפתורים מתוכו: JSON שבור = רק "לא, נפרד"', () => {
    assert.deepEqual(subtaskButtons(parsePending('{')), [SUBTASK_NO]);
    assert.deepEqual(subtaskButtons(parsePending(JSON.stringify({ options: [PRESENTATION] }))), [SUBTASK_YES, SUBTASK_NO]);
    assert.equal(parsePending(JSON.stringify({ options: [{ id: 'not-uuid', title: 'x' }] })), null);
  });
  test('בועות', () => {
    assert.equal(linkedReply('להכין מצגת'), "נרשם · תת-משימה של 'להכין מצגת'");
    assert.equal(notLinkedReply('להכין שקופיות'), "לא קושר · 'להכין שקופיות' נשארת נפרדת");
    assert.equal(openSubtasksSuffix(1), 'נשארה תת-משימה פתוחה אחת');
    assert.equal(openSubtasksSuffix(3), 'נשארו 3 תת-משימות פתוחות');
    assert.deepEqual(brainTaskCandidates([PRESENTATION, { id: uuid(9), title: '' }]), [{ key: 't1', label: PRESENTATION.title }, { key: 't2', label: 'משימה' }]);
  });
});

// ---------------------------------------------------------------------------
// המוח: הפרומפט והבדיקה
// ---------------------------------------------------------------------------

describe('המוח: משימות פתוחות בפרומפט ובבדיקת הפורמט', () => {
  const tasks = [{ key: 't1', label: PRESENTATION.title }];
  test('בלי משימות הפרומפט זהה למה שהיה; עם משימות נוספות השורות והשדות', () => {
    assert.equal(buildPrompt({ text: 'להכין שקופיות' }), buildPrompt({ text: 'להכין שקופיות', tasks: [] }));
    const prompt = buildPrompt({ text: 'להכין שקופיות', tasks });
    assert.match(prompt, /t1: להכין מצגת בהיסטוריה/);
    assert.match(prompt, /"parent" ו-"parent_text"/);
  });
  const base = { kind: 'task', subject: null, topic: 'להכין שקופיות', date_text: null, new_date_text: null, time_text: null, new_room: null, uncertain: [] };
  test('parent: רק מפתח שנשלח; parent_text: רק ביטוי שמופיע בהודעה', () => {
    const text = 'להכין שקופיות למצגת בהיסטוריה';
    assert.equal(isValidUnderstanding({ ...base, parent: 't1', parent_text: 'מצגת בהיסטוריה' }, text, null, ['t1']), true);
    assert.equal(isValidUnderstanding({ ...base, parent: 't2' }, text, null, ['t1']), false);
    assert.equal(isValidUnderstanding({ ...base, parent_text: 'מצגת בגאוגרפיה' }, text, null, ['t1']), false);
    assert.equal(isValidUnderstanding({ ...base, parent_text: 5 }, text, null, ['t1']), false);
    assert.equal(isValidUnderstanding({ ...base, parent: 't7' }, text), true, 'בלי משימות שנשלחו: לא נבדק');
  });
  test('understandSource: טוען המשימות נקרא רק כשיש מפתח, ו-parent נשמר מנורמל', async () => {
    let loaded = 0;
    const loadTaskCandidates = async () => { loaded += 1; return tasks; };
    const source = { raw_content: 'להכין שקופיות למצגת בהיסטוריה' };
    assert.deepEqual(await understandSource({ sql: fakeSql(), source, apiKey: '', loadTaskCandidates }), { ok: false, reason: 'no-key' });
    assert.equal(loaded, 0);
    let prompt = null;
    const ask = async ({ prompt: p, schema }) => {
      prompt = p;
      const data = { ...base, parent: 't1', parent_text: ' מצגת בהיסטוריה ' };
      assert.equal(schema(data), true);
      return { ok: true, model: 'm', data };
    };
    const out = await understandSource({ sql: fakeSql(), source, apiKey: 'k', ask, loadTaskCandidates });
    assert.equal(loaded, 1);
    assert.match(prompt, /t1: להכין מצגת בהיסטוריה/);
    assert.equal(out.understanding.parent, 't1');
    assert.equal(out.understanding.parent_text, 'מצגת בהיסטוריה');
  });
  test('understandSource בלי משימות: אין שדות parent בתשובה', async () => {
    const ask = async () => ({ ok: true, model: 'm', data: { ...base, parent: 't1' } });
    const out = await understandSource({ sql: fakeSql(), source: { raw_content: 'להכין שקופיות' }, apiKey: 'k', ask });
    assert.equal(Object.hasOwn(out.understanding, 'parent'), false);
  });
});

// ---------------------------------------------------------------------------
// הצינור: אחרי שמשימה נרשמה
// ---------------------------------------------------------------------------

const typed = (text) => ({ id: SRC_ID, channel: 'app', raw_content: text, content_hash: 'h', received_at: SATURDAY_NOON });
const isPoolQuery = (text) => text.includes('AND t.parent_task_id IS NULL ORDER BY');
function pipelineDb({ pool = [PRESENTATION, ESSAY], poolError = null, linked = 1, questions = 1 } = {}) {
  return fakeSql((text) => {
    if (isPoolQuery(text)) {
      if (poolError) throw poolError;
      return pool.map((p) => ({ ...p }));
    }
    if (text.startsWith('WITH claim AS') && text.includes('INSERT INTO tasks')) return [{ claimed: 1, task_id: NEW_TASK }];
    if (text.startsWith('WITH u AS ( UPDATE tasks c SET parent_task_id')) return [{ linked, bubble_id: linked ? 'b' : null }];
    if (text.startsWith("WITH q AS ( INSERT INTO messages") && text.includes("'subtask_link'")) return [{ questions_written: questions }];
    return [];
  });
}
const brainSaying = (over = {}) => async (extra) => {
  await extra.loadTaskCandidates();
  return { ok: true, model: 'm', understanding: { kind: 'task', subject: null, topic: 'להכין שקופיות', date_text: null, new_date_text: null, time_text: null, new_room: null, uncertain: [], parent: null, parent_text: null, ...over } };
};
const probeDetails = (sql) => sql.find("VALUES ('subtask-suggest'").map((c) => c.values.join(' '));

describe('הצינור: המוח מציע ושואלים (המסלול הראשי)', () => {
  test('"להכין שקופיות", המוח הציע t1: כרטיס "זה חלק מ\'להכין מצגת בהיסטוריה\'?" עם המועמד השמור', async () => {
    const sql = pipelineDb();
    const out = await processSource({ sql, source: typed('להכין שקופיות'), timetable: null, understand: brainSaying({ parent: 't1' }) });
    assert.equal(out.status, 'recorded');
    assert.deepEqual(out.subtask, { kind: 'ask' });
    const [card] = sql.find("'subtask_link', t.id, 1");
    assert.ok(card.values.includes("זה חלק מ'להכין מצגת בהיסטוריה'?"));
    assert.ok(card.values.includes(NEW_TASK));
    assert.ok(card.values.includes(SRC_ID));
    assert.ok(card.values.includes(JSON.stringify({ options: [PRESENTATION] })));
    assert.match(card.text, /NOT EXISTS \(SELECT 1 FROM messages x WHERE x\.kind = 'question' AND x\.entity_type = 'subtask_link' AND x\.entity_id = t\.id\)/);
    assert.match(card.text, /WHERE t\.id = \?::uuid AND t\.status = 'open'/);
    assert.equal(sql.find('UPDATE tasks c SET parent_task_id').length, 0, 'הצעה של המוח לא מקשרת בלי "כן"');
    assert.match(probeDetails(sql)[0], /kind=ask; by=brain; options=1; considered=2/);
  });
  test('המוח לא קשר (parent null): בלי כרטיס, ורק שורת מדידה', async () => {
    const sql = pipelineDb();
    const out = await processSource({ sql, source: typed('להכין שקופיות'), timetable: null, understand: brainSaying() });
    assert.equal(out.subtask, undefined);
    assert.equal(sql.find("'subtask_link', t.id, 1").length, 0);
    assert.match(probeDetails(sql)[0], /kind=none/);
  });
  test('אין משימות פתוחות: המוח לא קיבל רשימה, parent שלו לא נחשב', async () => {
    const sql = pipelineDb({ pool: [] });
    const out = await processSource({ sql, source: typed('להכין שקופיות'), timetable: null, understand: brainSaying({ parent: 't1' }) });
    assert.equal(out.subtask, undefined);
    assert.match(probeDetails(sql)[0], /reason=no-pool/);
  });
  test('הודעה מועברת (קיצור): המשימות לא נשלחות למוח', async () => {
    let extra = null;
    const understand = async (e) => { extra = e; return { ok: true, model: 'm', understanding: { kind: 'other', subject: null, topic: null, date_text: null, new_date_text: null, time_text: null, new_room: null, uncertain: [] } }; };
    await processSource({ sql: pipelineDb(), source: { ...typed('להכין שקופיות'), channel: 'shortcut' }, timetable: null, understand });
    assert.equal(typeof extra.loadTaskCandidates, 'undefined');
    assert.equal(typeof extra.loadCandidates, 'function');
  });
});

describe('הצינור: קישור מפורש בצ\'אט', () => {
  test('"להכין שקופיות למצגת בהיסטוריה": התאמה ודאית = קישור מיד ובועת "נרשם · תת-משימה של ..."', async () => {
    const sql = pipelineDb();
    const out = await processSource({ sql, source: typed('להכין שקופיות למצגת בהיסטוריה'), timetable: null, understand: brainSaying({ parent_text: 'מצגת בהיסטוריה' }) });
    assert.deepEqual(out.subtask, { kind: 'link', parentId: PRESENTATION.id, bubbleId: 'b' });
    const [link] = sql.find('UPDATE tasks c SET parent_task_id');
    assert.deepEqual(link.values.slice(0, 2), [NEW_TASK, PRESENTATION.id]);
    assert.match(link.text, /c\.id <> p\.id AND c\.status = 'open' AND p\.status = 'open' AND p\.parent_task_id IS NULL AND NOT EXISTS \(SELECT 1 FROM tasks k WHERE k\.parent_task_id = c\.id\)/);
    assert.ok(link.values.includes("נרשם · תת-משימה של 'להכין מצגת בהיסטוריה'"));
    assert.match(link.text, /'task', u\.id, NULL::integer FROM u WHERE NOT EXISTS/);
    assert.equal(sql.find("'subtask_link', t.id, 1").length, 0);
    assert.match(probeDetails(sql)[0], /kind=link; by=explicit/);
  });
  test('מפורש ועמום: כרטיס עם כפתור לכל מועמד ו"לא, נפרד"', async () => {
    const sql = pipelineDb({ pool: [PRESENTATION, PRESENTATION_MATH] });
    const out = await processSource({ sql, source: typed('להכין שקופיות למצגת'), timetable: null, understand: brainSaying({ parent_text: 'למצגת' }) });
    assert.deepEqual(out.subtask, { kind: 'ask' });
    const [card] = sql.find("'subtask_link', t.id, 1");
    assert.ok(card.values.includes('זה חלק מאחת מאלה?'));
    assert.ok(card.values.includes(JSON.stringify({ options: [PRESENTATION, PRESENTATION_MATH] })));
  });
  test('הקישור לא נכתב (ההורה נסגר בינתיים): בלי subtask, המשימה נשארת רשומה', async () => {
    const out = await processSource({ sql: pipelineDb({ linked: 0 }), source: typed('להכין שקופיות למצגת בהיסטוריה'), timetable: null, understand: brainSaying({ parent_text: 'מצגת בהיסטוריה' }) });
    assert.equal(out.status, 'recorded');
    assert.equal(out.subtask, undefined);
  });
});

describe('הצינור: בלי מוח (נפילה לקוד)', () => {
  test('בלי understand: אין הצעה, אין שאילתת מאגר, ורק שורת מדידה עם קודים', async () => {
    const sql = pipelineDb();
    const out = await processSource({ sql, source: typed('להכין שקופיות עד שלישי'), timetable: null });
    assert.equal(out.status, 'recorded');
    assert.equal(out.subtask, undefined);
    assert.equal(sql.calls.filter((c) => isPoolQuery(c.text)).length, 0);
    assert.equal(sql.find('UPDATE tasks c SET parent_task_id').length, 0);
    const [detail] = probeDetails(sql);
    assert.equal(detail, 'false kind=none; by=code; options=0; considered=; reason=no-brain');
    assert.doesNotMatch(detail, /שקופיות/);
  });
  test('המוח נכשל (exhausted): אותו דבר', async () => {
    const sql = pipelineDb();
    const out = await processSource({ sql, source: typed('להכין שקופיות עד שלישי'), timetable: null, understand: async () => ({ ok: false, reason: 'exhausted' }) });
    assert.equal(out.brain, 'exhausted');
    assert.match(probeDetails(sql)[0], /reason=no-brain/);
  });
  test('כשל ברישום המדידה לא שובר את הרישום', async (t) => {
    captureConsole(t);
    const sql = fakeSql((text) => {
      if (text.includes("VALUES ('subtask-suggest'")) throw new Error('db down');
      if (text.startsWith('WITH claim AS') && text.includes('INSERT INTO tasks')) return [{ claimed: 1, task_id: NEW_TASK }];
      return [];
    });
    assert.equal((await processSource({ sql, source: typed('להכין שקופיות עד שלישי'), timetable: null })).status, 'recorded');
  });
});

describe('עמודה חסרה במסד (לפני שיובל מריץ את הפקודה)', () => {
  test('isMissingColumn: רק קוד 42703', () => {
    assert.equal(isMissingColumn(missingColumn()), true);
    assert.equal(isMissingColumn(new Error('x')), false);
    assert.equal(isMissingColumn(null), false);
  });
  test('isMissingColumn: גם בלי code, לפי ההודעה על parent_task_id (דרייבר שלא מעביר את הקוד)', () => {
    assert.equal(isMissingColumn(new Error('column "parent_task_id" does not exist')), true);
    assert.equal(isMissingColumn(new Error('column t.parent_task_id does not exist')), true);
    assert.equal(isMissingColumn(new Error('column "other_col" does not exist')), false);
    assert.equal(isMissingColumn(new Error('relation "tasks" does not exist')), false);
  });
  test('הקליטה: מאגר ריק, בלי כרטיס, המשימה נרשמת, ושורת לוג אחת בלבד גם אחרי שתי הודעות', async (t) => {
    const logs = captureConsole(t);
    for (let i = 0; i < 2; i += 1) {
      const sql = pipelineDb({ poolError: missingColumn() });
      const out = await processSource({ sql, source: typed('להכין שקופיות'), timetable: null, understand: brainSaying({ parent: 't1' }) });
      assert.equal(out.status, 'recorded');
      assert.equal(sql.find("'subtask_link', t.id, 1").length, 0);
    }
    assert.equal(logs.lines.filter((l) => l.includes('parent_task_id חסרה')).length, 1);
    assert.doesNotMatch(logs.text(), /does not exist/);
  });
  test('loadParentPool: כשל אחר = [] ושם השגיאה בלבד', async (t) => {
    const logs = captureConsole(t);
    assert.deepEqual(await loadParentPool(fakeSql(() => { throw Object.assign(new Error('סודי'), { name: 'NeonDbError' }); })), []);
    assert.doesNotMatch(logs.text(), /סודי/);
  });
  test('countOpenSubtasks: עמודה חסרה = 0', async (t) => {
    captureConsole(t);
    assert.equal(await countOpenSubtasks(fakeSql(() => { throw missingColumn(); }), PRESENTATION.id), 0);
    assert.equal(await countOpenSubtasks(fakeSql(() => [{ open_subtasks: 2 }]), PRESENTATION.id), 2);
  });
  test('loadOpenTasks: 42703 = השאילתה הישנה (בלי parent_task_id); כשל אחר נזרק כמו קודם', async (t) => {
    captureConsole(t);
    const sql = fakeSql((text) => {
      if (text.includes('t.parent_task_id')) throw missingColumn();
      if (text.includes("FROM tasks t WHERE t.status = 'open'")) return [{ id: PRESENTATION.id, title: PRESENTATION.title, media_count: 0 }];
      return [];
    });
    assert.deepEqual(await loadOpenTasks(sql), [{ id: PRESENTATION.id, title: PRESENTATION.title, media_count: 0 }]);
    assert.equal(sql.find("FROM tasks t WHERE t.status = 'open'").length, 2);
    await assert.rejects(loadOpenTasks(fakeSql(() => { throw new Error('db down'); })), /db down/);
  });
  test('suggestParentAfterRecord לא זורק גם כשהכתיבה נכשלת', async (t) => {
    captureConsole(t);
    const sql = fakeSql((text) => { if (text.startsWith('WITH q AS')) throw new Error('db down'); return []; });
    const out = await suggestParentAfterRecord({ sql, source: { id: SRC_ID }, task: { id: NEW_TASK }, understanding: { parent: 't1' }, parents: { pool: [PRESENTATION], shown: true } });
    assert.equal(out, null);
  });
});

// ---------------------------------------------------------------------------
// הכרטיס: כתיבה ותשובה
// ---------------------------------------------------------------------------

describe('writeSubtaskQuestion ו-writeLink', () => {
  test('הכרטיס פג אחרי ASK_DAYS ימים; כבר קיים = false', async () => {
    const sql = fakeSql(() => [{ questions_written: 0 }]);
    assert.equal(await writeSubtaskQuestion({ sql, sourceId: SRC_ID, taskId: NEW_TASK, options: [PRESENTATION], now: SATURDAY_NOON }), false);
    const expires = new Date(SATURDAY_NOON.getTime() + ASK_DAYS * 86400000).toISOString();
    assert.ok(sql.calls[0].values.includes(expires));
    assert.match(sql.calls[0].text, /'subtask_pending', \?::text, 'probable', 'script', 'task', q\.entity_id, 'inferred'/);
  });
  test('writeLink: linked לפי מספר השורות', async () => {
    assert.deepEqual(await writeLink({ sql: fakeSql(() => [{ linked: 1, bubble_id: 'b' }]), taskId: NEW_TASK, parent: PRESENTATION }), { linked: true, bubbleId: 'b' });
    assert.deepEqual(await writeLink({ sql: fakeSql(() => [{ linked: 0, bubble_id: null }]), taskId: NEW_TASK, parent: PRESENTATION }), { linked: false, bubbleId: null });
  });
});

function answerDb({ options = [PRESENTATION], awaiting = true, closed = 1, linked = 1, pending } = {}) {
  return fakeSql((text) => {
    if (text.includes("m.entity_type = 'subtask_link' AND (m.expires_at")) {
      return [{ id: MSG_ID, awaiting_reply: awaiting, task_id: NEW_TASK, title: 'להכין שקופיות', pending: pending === undefined ? JSON.stringify({ options }) : pending }];
    }
    if (text.startsWith('WITH closed AS') && text.includes('parent_task_id')) return [{ closed, linked: closed ? linked : 0, answer_source_id: closed ? 'ans' : null, bubble_id: closed ? 'b' : null }];
    return [];
  });
}

describe('answerSubtaskLink: "כן" / "לא" / עמום / סגור', () => {
  test('"כן, תת-משימה": פקודה אחת: סגירה, שורת תשובה, קישור מותנה, בועה', async () => {
    const sql = answerDb();
    const out = await answerSubtaskLink({ sql, messageId: MSG_ID, answer: SUBTASK_YES, now: SATURDAY_NOON });
    assert.deepEqual(out, { status: 'answered', created: { answerSourceId: 'ans', bubbleId: 'b' }, linked: true });
    const [write] = sql.find('WITH closed AS');
    assert.match(write.text, /AND awaiting_reply = true AND entity_type = 'subtask_link'/);
    assert.match(write.text, /INSERT INTO sources .* 'app', 'answer'/);
    assert.match(write.text, /p\.parent_task_id IS NULL AND NOT EXISTS \(SELECT 1 FROM tasks k WHERE k\.parent_task_id = c\.id\)/);
    assert.ok(write.values.includes(PRESENTATION.id));
    assert.ok(write.values.includes(true));
    assert.ok(write.values.includes("נרשם · תת-משימה של 'להכין מצגת בהיסטוריה'"));
    assert.ok(write.values.includes("לא קושר · 'להכין שקופיות' נשארת נפרדת"), 'נוסח למקרה שההורה כבר לא פתוח');
  });
  test('"לא, נפרד": סגירה ושורת תשובה, בלי קישור ובלי בועה', async () => {
    const sql = answerDb({ linked: 0 });
    const out = await answerSubtaskLink({ sql, messageId: MSG_ID, answer: SUBTASK_NO, now: SATURDAY_NOON });
    assert.equal(out.status, 'answered');
    assert.equal(out.linked, false);
    const [write] = sql.find('WITH closed AS');
    assert.ok(write.values.includes(false));
    assert.equal(write.values.filter((v) => v === PRESENTATION.id).length, 0);
  });
  test('כמה מועמדים: הכפתור של המועמד השני מקשר אליו', async () => {
    const sql = answerDb({ options: [PRESENTATION, PRESENTATION_MATH] });
    await answerSubtaskLink({ sql, messageId: MSG_ID, answer: PRESENTATION_MATH.title, now: SATURDAY_NOON });
    assert.ok(sql.find('WITH closed AS')[0].values.includes(PRESENTATION_MATH.id));
  });
  test('תשובה אחרת: unclear בלי כתיבה (הכרטיס נשאר)', async () => {
    const sql = answerDb();
    assert.deepEqual(await answerSubtaskLink({ sql, messageId: MSG_ID, answer: 'אולי', now: SATURDAY_NOON }), { status: 'unclear', created: {} });
    assert.equal(sql.find('WITH closed AS').length, 0);
  });
  test('שאלה סגורה, פגה, לא קיימת או לחיצה מקבילה: closed', async () => {
    assert.equal((await answerSubtaskLink({ sql: answerDb({ awaiting: false }), messageId: MSG_ID, answer: SUBTASK_YES, now: SATURDAY_NOON })).status, 'closed');
    assert.equal((await answerSubtaskLink({ sql: fakeSql(() => []), messageId: MSG_ID, answer: SUBTASK_YES, now: SATURDAY_NOON })).status, 'closed');
    assert.equal((await answerSubtaskLink({ sql: answerDb({ closed: 0 }), messageId: MSG_ID, answer: SUBTASK_YES, now: SATURDAY_NOON })).status, 'closed');
  });
  test('בלי מועמדים שמורים: רק "לא, נפרד" סוגר', async () => {
    assert.equal((await answerSubtaskLink({ sql: answerDb({ pending: null }), messageId: MSG_ID, answer: SUBTASK_YES, now: SATURDAY_NOON })).status, 'unclear');
    assert.equal((await answerSubtaskLink({ sql: answerDb({ pending: null }), messageId: MSG_ID, answer: SUBTASK_NO, now: SATURDAY_NOON })).status, 'answered');
  });
  test('כשל מסד בפקודה נזרק (הכרטיס נשאר פתוח, כי הפקודה אטומית)', async () => {
    const sql = fakeSql((text) => {
      if (text.includes("m.entity_type = 'subtask_link' AND (m.expires_at")) return [{ id: MSG_ID, awaiting_reply: true, task_id: NEW_TASK, title: 'x', pending: JSON.stringify({ options: [PRESENTATION] }) }];
      if (text.startsWith('WITH closed AS')) throw new Error('db down');
      return [];
    });
    await assert.rejects(answerSubtaskLink({ sql, messageId: MSG_ID, answer: SUBTASK_YES, now: SATURDAY_NOON }), /db down/);
    assert.equal(sql.find('awaiting_reply = true, read_at = NULL').length, 0);
  });
  test('closeSubtaskQuestions: רק כרטיסי subtask_link של המשימה', async () => {
    const sql = fakeSql();
    await closeSubtaskQuestions(sql, NEW_TASK);
    assert.match(sql.calls[0].text, /entity_type = 'subtask_link' AND entity_id = \?::uuid/);
  });
});

describe('הכרטיס בצ\'אט (pendingFromRows)', () => {
  test('שורת subtask_link = kind subtask_link עם כפתורים מהמועמדים, בלי תיבת כתיבה', () => {
    const [item] = pendingFromRows({ questions: [{ id: MSG_ID, body: "זה חלק מ'להכין מצגת בהיסטוריה'?", sent_at: SATURDAY_NOON, entity_type: SUBTASK_ENTITY, subtask_pending: JSON.stringify({ options: [PRESENTATION] }) }] });
    assert.deepEqual(item, { id: MSG_ID, kind: 'subtask_link', at: SATURDAY_NOON.toISOString(), text: "זה חלק מ'להכין מצגת בהיסטוריה'?", buttons: [SUBTASK_YES, SUBTASK_NO], allowFreeText: false });
  });
});

// ---------------------------------------------------------------------------
// כפתור ידני
// ---------------------------------------------------------------------------

function linkDb(rows, { updated = 1, error = null } = {}) {
  return fakeSql((text) => {
    if (error) throw error;
    if (text.includes('AS has_subtasks FROM tasks t WHERE t.id IN')) return rows;
    if (text.startsWith('UPDATE tasks c SET parent_task_id')) return updated ? [{ id: NEW_TASK }] : [];
    return [];
  });
}
const row = (id, over = {}) => ({ id, status: 'open', parent_task_id: null, has_subtasks: false, ...over });

describe('linkSubtask / unlinkSubtask: הבדיקות', () => {
  test('תקין: linked, והעדכון מותנה באותם תנאים', async () => {
    const sql = linkDb([row(NEW_TASK), row(PRESENTATION.id)]);
    assert.deepEqual(await linkSubtask({ sql, taskId: NEW_TASK, parentId: PRESENTATION.id }), { status: 'linked' });
    assert.match(sql.find('UPDATE tasks c')[0].text, /p\.parent_task_id IS NULL AND NOT EXISTS/);
  });
  test('מקרי קצה', async () => {
    const check = async (rows, reason, over = {}) => assert.deepEqual(await linkSubtask({ sql: linkDb(rows, over), taskId: NEW_TASK, parentId: PRESENTATION.id }), { status: 'invalid', reason });
    assert.deepEqual(await linkSubtask({ sql: fakeSql(), taskId: NEW_TASK, parentId: NEW_TASK }), { status: 'invalid', reason: 'self' });
    await check([row(NEW_TASK)], 'not_found');
    await check([], 'not_found');
    await check([row(NEW_TASK, { status: 'done' }), row(PRESENTATION.id)], 'not_open');
    await check([row(NEW_TASK), row(PRESENTATION.id, { status: 'done' })], 'not_open');
    await check([row(NEW_TASK), row(PRESENTATION.id, { parent_task_id: ESSAY.id })], 'parent_is_subtask');
    await check([row(NEW_TASK, { has_subtasks: true }), row(PRESENTATION.id)], 'has_subtasks');
    await check([row(NEW_TASK), row(PRESENTATION.id)], 'changed', { updated: 0 });
  });
  test('עמודה חסרה: disabled; כשל אחר נזרק', async (t) => {
    captureConsole(t);
    assert.deepEqual(await linkSubtask({ sql: linkDb([], { error: missingColumn() }), taskId: NEW_TASK, parentId: PRESENTATION.id }), { status: 'disabled' });
    await assert.rejects(linkSubtask({ sql: linkDb([], { error: new Error('db down') }), taskId: NEW_TASK, parentId: PRESENTATION.id }), /db down/);
    assert.deepEqual(await unlinkSubtask({ sql: fakeSql(() => { throw missingColumn(); }), taskId: NEW_TASK }), { status: 'disabled' });
  });
  test('unlink: unlinked כשהייתה הורה; closed כשלא', async () => {
    const sql = fakeSql(() => [{ id: NEW_TASK }]);
    assert.deepEqual(await unlinkSubtask({ sql, taskId: NEW_TASK }), { status: 'unlinked' });
    assert.match(sql.calls[0].text, /UPDATE tasks SET parent_task_id = NULL WHERE id = \?::uuid AND parent_task_id IS NOT NULL/);
    assert.deepEqual(await unlinkSubtask({ sql: fakeSql(() => []), taskId: NEW_TASK }), { status: 'closed' });
  });
  test('parseChatAction: מזהים חייבים להיות uuid', () => {
    assert.deepEqual(parseChatAction({ action: 'subtask_link', task_id: NEW_TASK, parent_id: PRESENTATION.id }), { ok: true, action: 'subtask_link', taskId: NEW_TASK, parentId: PRESENTATION.id });
    assert.deepEqual(parseChatAction({ action: 'subtask_link', task_id: NEW_TASK }), { ok: false });
    assert.deepEqual(parseChatAction({ action: 'subtask_link', task_id: 'x', parent_id: PRESENTATION.id }), { ok: false });
    assert.deepEqual(parseChatAction({ action: 'subtask_unlink', task_id: NEW_TASK }), { ok: true, action: 'subtask_unlink', taskId: NEW_TASK });
    assert.deepEqual(parseChatAction({ action: 'subtask_unlink' }), { ok: false });
  });
});

// ---------------------------------------------------------------------------
// רשימת "פתוחות"
// ---------------------------------------------------------------------------

describe('רשימת "פתוחות": parent_task_id ותת-משימה מיד אחרי ההורה', () => {
  const A = { id: uuid(21), title: 'א' };
  const B = { id: uuid(22), title: 'ב' };
  const A1 = { id: uuid(23), title: 'א1', parent_task_id: A.id };
  const A2 = { id: uuid(24), title: 'א2', parent_task_id: A.id };
  const ORPHAN = { id: uuid(25), title: 'יתומה', parent_task_id: uuid(99) };
  test('ילדים אחרי ההורה, בסדר שלהם; יתומה במקומה; בלי הורים = אותו סדר', () => {
    assert.deepEqual(orderOpenTasks([A2, B, ORPHAN, A, A1]).map((t) => t.title), ['ב', 'יתומה', 'א', 'א2', 'א1']);
    assert.deepEqual(orderOpenTasks([B, A]), [B, A]);
    assert.deepEqual(orderOpenTasks(null), []);
  });
  test('openTaskFromRow: parent_task_id רק כשקיים', () => {
    assert.equal(Object.hasOwn(openTaskFromRow({ id: 'a', title: 't', parent_task_id: null }), 'parent_task_id'), false);
    assert.equal(openTaskFromRow({ id: 'a', title: 't', parent_task_id: A.id }).parent_task_id, A.id);
  });
  test('loadOpenTasks: בוחר parent_task_id ומסדר', async () => {
    const sql = fakeSql((text) => (text.includes("FROM tasks t WHERE t.status = 'open'") ? [{ ...A1, media_count: 0 }, { ...B, media_count: 0 }, { ...A, media_count: 0 }] : []));
    assert.deepEqual((await loadOpenTasks(sql)).map((t) => t.title), ['ב', 'א', 'א1']);
    assert.match(sql.calls[0].text, /SELECT t\.id, t\.title, t\.subject, t\.due_at, t\.parent_task_id,/);
  });
});

// ---------------------------------------------------------------------------
// הורה שבוצע ונשארו לו תתי-משימות פתוחות
// ---------------------------------------------------------------------------

describe('הורה "בוצע" עם תתי-משימות פתוחות: הן נשארות פתוחות, והבועה אומרת כמה', () => {
  const checkSql = (openSubtasks) => fakeSql((text) => {
    if (text.startsWith('SELECT m.id')) return [{ id: MSG_ID, awaiting_reply: true, entity_type: CHECK_ENTITY, task_id: PRESENTATION.id, title: PRESENTATION.title, status: 'open' }];
    if (text.includes('AS open_subtasks')) return [{ open_subtasks: openSubtasks }];
    if (text.startsWith('WITH closed AS')) return [{ closed: 1, answer_source_id: 'a', bubble_id: 'b' }];
    return [];
  });
  test('"בוצע?" -> "בוצע" עם 2 פתוחות: "בוצע · ... · נשארו 2 תת-משימות פתוחות", ותתי-המשימות לא נסגרות', async () => {
    const sql = checkSql(2);
    await answerTaskCheck({ sql, messageId: MSG_ID, answer: CHECK_DONE, now: SATURDAY_NOON });
    const [write] = sql.find('WITH closed AS');
    assert.ok(write.values.includes('בוצע · להכין מצגת בהיסטוריה · נשארו 2 תת-משימות פתוחות'));
    assert.doesNotMatch(write.text, /parent_task_id/);
  });
  test('בלי תתי-משימות: הבועה הרגילה', async () => {
    const sql = checkSql(0);
    await answerTaskCheck({ sql, messageId: MSG_ID, answer: CHECK_DONE, now: SATURDAY_NOON });
    assert.ok(sql.find('WITH closed AS')[0].values.includes('בוצע · להכין מצגת בהיסטוריה'));
  });
});

// ---------------------------------------------------------------------------
// api/chat.js
// ---------------------------------------------------------------------------

function chatDb({ linkRows = [row(NEW_TASK), row(PRESENTATION.id)], openTasks = [], openSubtasks = 0, done = true, subtaskAsk = null } = {}) {
  return fakeSql((text) => {
    if (text.includes('AS has_subtasks FROM tasks t WHERE t.id IN')) return linkRows;
    if (text.startsWith('UPDATE tasks c SET parent_task_id')) return [{ id: NEW_TASK }];
    if (text.includes("FROM tasks t WHERE t.status = 'open'")) return openTasks.map((x) => ({ ...x }));
    if (text.startsWith("UPDATE tasks SET status = 'done'")) return done ? [{ id: PRESENTATION.id }] : [];
    if (text.includes('AS open_subtasks')) return [{ open_subtasks: openSubtasks }];
    if (text.includes("m.entity_type = 'subtask_link' AND (m.expires_at") && subtaskAsk) return [subtaskAsk];
    if (text.startsWith('WITH closed AS') && text.includes('parent_task_id')) return [{ closed: 1, linked: 1, answer_source_id: uuid(30), bubble_id: uuid(31) }];
    if (text.includes('AS open_tasks') && text.includes('AS unread')) return [{ pending: 0, unread: 0, open_tasks: openTasks.length }];
    return [];
  });
}
const post = (sql, body) => chatHandle(jsonRequest(body, { headers: H, url: URL_CHAT }), { sql, secret: FAKE_SECRET, timetable: null, now: () => SATURDAY_NOON, googleDay: undefined });

describe('api/chat.js: subtask_link, subtask_unlink, task_done, answer', () => {
  test('subtask_link: linked, והפריט המעודכן ברשימה, מיד אחרי ההורה', async () => {
    const openTasks = [{ id: NEW_TASK, title: 'להכין שקופיות', parent_task_id: PRESENTATION.id, media_count: 0 }, { ...PRESENTATION, media_count: 0 }];
    const res = await post(chatDb({ openTasks }), { action: 'subtask_link', task_id: NEW_TASK, parent_id: PRESENTATION.id });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'linked');
    assert.deepEqual(body.open_tasks.map((t) => t.id), [PRESENTATION.id, NEW_TASK]);
    assert.deepEqual(body.task, { id: NEW_TASK, title: 'להכין שקופיות', media_count: 0, parent_task_id: PRESENTATION.id });
    assert.equal(typeof body.badge, 'number');
  });
  test('subtask_link לא תקין: invalid עם reason; מזהה לא תקף = 400; בלי סוד = 401', async () => {
    const body = await (await post(chatDb({ linkRows: [row(NEW_TASK), row(PRESENTATION.id, { parent_task_id: ESSAY.id })] }), { action: 'subtask_link', task_id: NEW_TASK, parent_id: PRESENTATION.id })).json();
    assert.equal(body.status, 'invalid');
    assert.equal(body.reason, 'parent_is_subtask');
    assert.equal((await post(chatDb(), { action: 'subtask_link', task_id: 'x', parent_id: PRESENTATION.id })).status, 400);
    const noSecret = await chatHandle(jsonRequest({ action: 'subtask_unlink', task_id: NEW_TASK }, { url: URL_CHAT }), { sql: chatDb(), secret: FAKE_SECRET });
    assert.equal(noSecret.status, 401);
  });
  test('subtask_unlink ועמודה חסרה: disabled, ו-open_tasks עדיין מוחזרת', async (t) => {
    captureConsole(t);
    const sql = fakeSql((text) => {
      if (text.includes('parent_task_id')) throw missingColumn();
      if (text.includes("FROM tasks t WHERE t.status = 'open'")) return [{ ...PRESENTATION, media_count: 0 }];
      return [];
    });
    const body = await (await post(sql, { action: 'subtask_unlink', task_id: NEW_TASK })).json();
    assert.equal(body.status, 'disabled');
    assert.deepEqual(body.open_tasks, [{ ...PRESENTATION, media_count: 0 }]);
  });
  test('task_done על הורה עם תתי-משימות פתוחות: open_subtasks, וכרטיסי "זה חלק מ...?" של המשימה נסגרים', async () => {
    const sql = chatDb({ openSubtasks: 2 });
    const body = await (await post(sql, { action: 'task_done', task_id: PRESENTATION.id })).json();
    assert.equal(body.status, 'done');
    assert.equal(body.open_subtasks, 2);
    assert.equal(sql.find("entity_type = 'subtask_link' AND entity_id = ?::uuid").length, 1);
  });
  test('task_done בלי תתי-משימות: התשובה בלי open_subtasks (כמו קודם)', async () => {
    const body = await (await post(chatDb(), { action: 'task_done', task_id: PRESENTATION.id })).json();
    assert.equal(Object.hasOwn(body, 'open_subtasks'), false);
  });
  test('answer על כרטיס תת-משימה: עובר ל-answerSubtaskLink אחרי שאר השאלות', async () => {
    const subtaskAsk = { id: MSG_ID, awaiting_reply: true, task_id: NEW_TASK, title: 'להכין שקופיות', pending: JSON.stringify({ options: [PRESENTATION] }) };
    const sql = chatDb({ subtaskAsk });
    const res = await post(sql, { action: 'answer', message_id: MSG_ID, answer: SUBTASK_YES });
    const body = await res.json();
    assert.equal(body.status, 'answered');
    assert.equal(sql.find('UPDATE tasks c SET parent_task_id').length, 1);
  });
  test('GET: כרטיס תת-משימה פתוח מוצג עם הכפתורים השמורים', async () => {
    const sql = fakeSql((text) => {
      if (text.includes('FROM messages m LEFT JOIN sources s')) return [{ id: MSG_ID, body: "זה חלק מ'להכין מצגת בהיסטוריה'?", sent_at: SATURDAY_NOON, entity_type: SUBTASK_ENTITY }];
      if (text.includes("JOIN facts f ON f.entity_type = 'task'")) return [{ id: MSG_ID, pending: JSON.stringify({ options: [PRESENTATION] }) }];
      return [];
    });
    const res = await chatHandle(req(URL_CHAT, { method: 'GET', headers: H }), { sql, secret: FAKE_SECRET, timetable: null, now: () => SATURDAY_NOON });
    const body = await res.json();
    assert.deepEqual(body.pending.find((p) => p.id === MSG_ID).buttons, [SUBTASK_YES, SUBTASK_NO]);
  });
});
