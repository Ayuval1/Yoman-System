// "תביא לי": חיבור לצינור הקליטה (lib/intake-process.js), למוח (lib/intake-brain.js) ולצ'אט (api/chat.js).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql, req, FAKE_SECRET, REVIEW_NOW } from './helpers.js';

const NOW = new Date('2026-11-23T10:00:00Z'); // יום שני
const TIMETABLE = { slots: [{ weekday: 3, period: 3, startsAt: '10:05', endsAt: '10:50', subject: 'היסטוריה' }] };
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MEDIA_ROW = { id: uuid(1), received_at: '2026-11-17T08:20:00Z', subject: null, lesson_date: '2026-11-17', lesson_period: 3, task_title: null };

describe('bring-me: בצינור הקליטה ובמוח', () => {
  const SRC_ID = uuid(91);
  const src = (text, channel = 'app') => ({ id: SRC_ID, channel, raw_content: text, content_hash: 'h', received_at: NOW.toISOString() });
  const intakeSql = ({ duplicate = false } = {}) => fakeSql((text) => {
    if (text.includes('JOIN sources p')) return duplicate ? [{ found: 1 }] : [];
    if (text.includes('FROM media')) return [MEDIA_ROW];
    if (text.includes('WITH claim AS')) return [{ claimed: 1, bubbles_written: 1 }];
    return [];
  });
  test('מוקלד בלי מוח: נענה מהמאגר בבועה', async () => {
    const { processSource } = await import('../lib/intake-process.js');
    const out = await processSource({ sql: intakeSql(), source: src('תביא לי את הלוח מהשיעור בהיסטוריה'), timetable: TIMETABLE });
    assert.equal(out.status, 'recorded');
    assert.match(out.reply, /^מצאתי תמונה אחת מהשיעור בהיסטוריה:/);
  });
  test('אותה בקשה פעמיים באותו יום: נענית שוב, לא "כבר קיבלתי"', async () => {
    const { processSource } = await import('../lib/intake-process.js');
    const out = await processSource({ sql: intakeSql({ duplicate: true }), source: src('תביא לי את הלוח מהשיעור בהיסטוריה'), timetable: TIMETABLE });
    assert.equal(out.status, 'recorded');
  });
  test('"תשלח לי" לא הופך למשימה (שלח הוא פועל משימה), ו"תביא לי מים" אינו בקשה למאגר', async () => {
    const { processSource } = await import('../lib/intake-process.js');
    const out = await processSource({ sql: intakeSql(), source: src('תשלח לי את הלוח של המתמטיקה'), timetable: TIMETABLE });
    assert.equal(out.status, 'recorded');
    assert.match(out.reply, /^אין לי תמונות שמורות מהשיעור במתמטיקה|^לא מצאתי|^מצאתי/);
    const other = intakeSql();
    await processSource({ sql: other, source: src('תביא לי מים'), timetable: TIMETABLE });
    assert.equal(other.find('FROM media').length, 0);
  });
  test('עם המוח: kind bring_me, ביטויים מהמוח, החישוב בקוד', async () => {
    const { processSource } = await import('../lib/intake-process.js');
    const understanding = { kind: 'bring_me', subject: 'היסטוריה', topic: null, date_text: 'ביום שלישי', new_date_text: null, time_text: null, new_room: null, uncertain: [] };
    const out = await processSource({ sql: intakeSql(), source: src('תביא לי את מה שצילמתי בהיסטוריה ביום שלישי'), timetable: TIMETABLE, understand: async () => ({ ok: true, model: 'm', understanding }) });
    assert.equal(out.brain, 'ok');
    assert.equal(out.status, 'recorded');
    assert.match(out.reply, /^מצאתי תמונה אחת/);
  });
  test('המוח אמר bring_me על הודעה מועברת (קיצור): לא מסווג, לא נוגעים במאגר', async () => {
    const { processSource } = await import('../lib/intake-process.js');
    const sql = intakeSql();
    const understanding = { kind: 'bring_me', subject: null, topic: null, date_text: null, new_date_text: null, time_text: null, new_room: null, uncertain: [] };
    const out = await processSource({ sql, source: src('תביא לי את הלוח', 'shortcut'), timetable: TIMETABLE, understand: async () => ({ ok: true, model: 'm', understanding }) });
    assert.equal(out.status, 'unclassified');
    assert.equal(sql.find('FROM media').length, 0);
  });
  test('המוח: bring_me ברשימה הסגורה ובפרומפט', async () => {
    const { BRAIN_KINDS, buildPrompt, isValidUnderstanding } = await import('../lib/intake-brain.js');
    assert.ok(BRAIN_KINDS.includes('bring_me'));
    assert.match(buildPrompt({ text: 'x' }), /- bring_me: /);
    const base = { subject: 'היסטוריה', topic: null, new_date_text: null, time_text: null, new_room: null, uncertain: [] };
    assert.equal(isValidUnderstanding({ ...base, kind: 'bring_me', date_text: 'אתמול' }, 'תביא לי את הלוח מאתמול'), true);
    assert.equal(isValidUnderstanding({ ...base, kind: 'bring_me', date_text: 'מחר' }, 'תביא לי את הלוח מאתמול'), false);
  });
});

describe('bring-me: הצ\'אט מציג את התמונות', () => {
  const H = { 'x-intake-secret': FAKE_SECRET };
  const BUBBLE = uuid(50);
  test('itemsFromRows + attachMedia: בועת מערכת מקבלת media = מזהים לפי הקישורים; בועה בלי קישורים: בלי השדה', async () => {
    const { attachMedia } = await import('../lib/chat-view.js');
    const items = [{ id: BUBBLE, role: 'system', text: 'x' }, { id: uuid(51), role: 'system', text: 'y' }, { id: uuid(52), role: 'user', text: 'z' }];
    const out = attachMedia(items, [{ from_id: BUBBLE, to_id: uuid(1) }, { from_id: BUBBLE, to_id: uuid(2) }]);
    assert.deepEqual(out[0].media, [uuid(1), uuid(2)]);
    assert.equal('media' in out[1], false, 'בועה בלי קישורים: בלי השדה');
    assert.equal('media' in out[2], false);
  });
  test('GET מחזיר items עם media; כשל בשליפת הקישורים לא שובר את ה-GET', async () => {
    const { handle } = await import('../api/chat.js');
    const make = (failLinks) => fakeSql((text) => {
      if (text.includes('FROM links')) { if (failLinks) throw new Error('db'); return [{ from_id: BUBBLE, to_id: uuid(1) }]; }
      if (text.includes('FROM sources s') && text.includes('UNION ALL')) return [{ role: 'system', id: BUBBLE, text: 'מצאתי', at: '2026-11-23T10:00:00Z', channel: null, read_at: null }];
      if (text.includes('AS unread')) return [{ pending: 0, unread: 0, open_tasks: 0 }];
      return [];
    });
    const ok = await (await handle(req('https://x.test/api/chat', { headers: H }), { sql: make(false), secret: FAKE_SECRET, timetable: { slots: [] }, now: () => REVIEW_NOW })).json();
    assert.deepEqual(ok.items[0].media, [uuid(1)]);
    const broken = await handle(req('https://x.test/api/chat', { headers: H }), { sql: make(true), secret: FAKE_SECRET, timetable: { slots: [] }, now: () => REVIEW_NOW });
    assert.equal(broken.status, 200);
    assert.equal('media' in (await broken.json()).items[0], false);
  });
  test('GET ?view=media&id=: מחזיר את הקובץ מה-Blob הפרטי עם content-type, בלי cache ציבורי', async () => {
    const { handle } = await import('../api/chat.js');
    const sql = fakeSql((text) => (text.includes('FROM media') ? [{ blob_path: 'https://store.private.blob.example/homework/a.jpg', content_type: 'image/jpeg' }] : []));
    const seen = [];
    const readBlob = async (location) => { seen.push(location); return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1]), { status: 200 }); };
    const res = await handle(req(`https://x.test/api/chat?view=media&id=${uuid(1)}`, { headers: H }), { sql, secret: FAKE_SECRET, blobToken: 'fake-token', readBlob });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.match(res.headers.get('cache-control'), /private/);
    assert.deepEqual(seen, ['https://store.private.blob.example/homework/a.jpg']);
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0xff, 0xd8, 0xff, 1]);
  });
  test('view=media: מזהה לא תקין 400; בלי סוד 401; לא נמצא או נמחק 404; בלי טוקן 404; כשל קריאה 404', async () => {
    const { handle } = await import('../api/chat.js');
    const found = fakeSql((text) => (text.includes('FROM media') ? [{ blob_path: 'p', content_type: 'image/jpeg' }] : []));
    const url = (id) => `https://x.test/api/chat?view=media&id=${id}`;
    const ok = async () => new Response('x');
    assert.equal((await handle(req(url('nope'), { headers: H }), { sql: found, secret: FAKE_SECRET, blobToken: 't', readBlob: ok })).status, 400);
    assert.equal((await handle(req(url(uuid(1))), { sql: found, secret: FAKE_SECRET, blobToken: 't', readBlob: ok })).status, 401);
    assert.equal((await handle(req(url(uuid(1)), { headers: H }), { sql: fakeSql(() => []), secret: FAKE_SECRET, blobToken: 't', readBlob: ok })).status, 404);
    assert.equal((await handle(req(url(uuid(1)), { headers: H }), { sql: found, secret: FAKE_SECRET, blobToken: '', readBlob: ok })).status, 404);
    assert.equal((await handle(req(url(uuid(1)), { headers: H }), { sql: found, secret: FAKE_SECRET, blobToken: 't', readBlob: async () => { throw new Error('blob'); } })).status, 404);
    assert.equal((await handle(req(url(uuid(1)), { headers: H }), { sql: found, secret: FAKE_SECRET, blobToken: 't', readBlob: async () => null })).status, 404);
  });
});
