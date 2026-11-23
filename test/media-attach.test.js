// בדיקות לשלב 8.6-3 (תמונות): פעולת attach ב-api/chat.js ו-lib/media-attach.js. מפרט: docs/08-chapter8/60-chapter8-step-8-6-spec.md, סעיפים 8-10, החוזה וקריטריון 11.
// בלי רשת ובלי מסד אמיתי: ההעלאה ל-Blob מוזרקת (upload), וה-sql מזויף. התמונות הן בתים מומצאים במבנה JPEG, בלי תוכן אמיתי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../api/chat.js';
import { parseChatAction } from '../lib/chat-view.js';
import { MAX_ATTACH_BODY_CHARS, IMAGES_OFF_TEXT, UPLOAD_FAILED_TEXT, decodeJpeg, stripJpegMetadata, attachImage } from '../lib/media-attach.js';
import { fakeSql, captureConsole, jsonRequest, req, FAKE_SECRET, REVIEW_NOW } from './helpers.js';

const H = { 'x-intake-secret': FAKE_SECRET, 'content-type': 'application/json' };
const URL_CHAT = 'https://x.test/api/chat';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TASK_ID = uuid(1);
const MEDIA_ID = uuid(2);
const FAKE_TOKEN = 'fake-blob-token-for-tests';

// JPEG מומצא: SOI, APP0 (JFIF), APP1 (Exif עם "מיקום" מומצא), DQT, SOS עם נתונים, EOI.
const seg = (marker, payload) => Buffer.concat([Buffer.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
const APP0 = seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'));
const APP1 = seg(0xe1, Buffer.from('Exif\0\0GPS-32.0-34.8', 'latin1'));
const DQT = seg(0xdb, Buffer.alloc(5, 7));
const SOS = seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0]));
const SCAN = Buffer.from([0x12, 0xff, 0x00, 0x34, 0x56]);
const EOI = Buffer.from([0xff, 0xd9]);
const SOI = Buffer.from([0xff, 0xd8]);
const JPEG_WITH_GPS = Buffer.concat([SOI, APP0, APP1, DQT, SOS, SCAN, EOI]);
const JPEG_CLEAN = Buffer.concat([SOI, APP0, DQT, SOS, SCAN, EOI]);
const B64 = JPEG_WITH_GPS.toString('base64');

function attachDb({ task = { id: TASK_ID, subject: 'מתמטיקה' }, inserted = [{ id: MEDIA_ID }], fail = null } = {}) {
  return fakeSql((text) => {
    if (fail && fail(text)) throw Object.assign(new Error('db down'), { name: 'NeonDbError' });
    if (text.startsWith('SELECT id, subject FROM tasks')) return task ? [task] : [];
    if (text.startsWith('INSERT INTO media')) return inserted;
    if (text.includes('AS unread')) return [{ pending: 0, unread: 0, open_tasks: 1 }];
    if (text.includes('FROM tasks t')) return task ? [{ id: TASK_ID, title: 'שיעורי בית · מתמטיקה', subject: 'מתמטיקה', due_at: null, media_count: 1 }] : [];
    return [];
  });
}
function fakeUpload({ fail = false } = {}) {
  const calls = [];
  const upload = async (pathname, body) => {
    calls.push({ pathname, body });
    if (fail) throw Object.assign(new Error('store not found'), { name: 'BlobStoreNotFoundError' });
    return { pathname, url: `https://store.private.blob.example/${pathname}` };
  };
  upload.calls = calls;
  return upload;
}
const post = (sql, body, { blobToken = FAKE_TOKEN, upload = fakeUpload() } = {}) =>
  handle(jsonRequest(body, { url: URL_CHAT, headers: H }), { sql, secret: FAKE_SECRET, timetable: { slots: [] }, now: () => REVIEW_NOW, blobToken, upload });
const get = (sql, blobToken) => handle(req(URL_CHAT, { method: 'GET', headers: H }), { sql, secret: FAKE_SECRET, timetable: { slots: [] }, now: () => REVIEW_NOW, blobToken });
const mediaWrites = (sql) => sql.calls.filter((c) => /INSERT INTO media/.test(c.text));

describe('media-attach: פענוח JPEG ומחיקת המיקום', () => {
  test('base64 של JPEG מתפענח לבתים; גם עם קידומת data:image/jpeg;base64,', () => {
    assert.deepEqual(decodeJpeg(B64), JPEG_WITH_GPS);
    assert.deepEqual(decodeJpeg(`data:image/jpeg;base64,${B64}`), JPEG_WITH_GPS);
  });
  test('לא JPEG, base64 פגום, או ריק: null', () => {
    assert.equal(decodeJpeg(Buffer.from('\x89PNG\r\n\x1a\n0000', 'latin1').toString('base64')), null);
    assert.equal(decodeJpeg('לא-base64!!'), null);
    assert.equal(decodeJpeg(''), null);
    assert.equal(decodeJpeg(`data:image/png;base64,${B64}`), null);
  });
  test('קטע APP1 (Exif, שם נמצא המיקום) נמחק, וכל השאר נשאר כמו שהוא', () => {
    const out = stripJpegMetadata(JPEG_WITH_GPS);
    assert.deepEqual(out, JPEG_CLEAN);
    assert.equal(out.includes(Buffer.from('GPS')), false);
  });
  test('JPEG בלי APP1 נשאר זהה; מבנה שבור = null', () => {
    assert.deepEqual(stripJpegMetadata(JPEG_CLEAN), JPEG_CLEAN);
    assert.equal(stripJpegMetadata(Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0x40, 0x00, 1, 2])])), null);
    assert.equal(stripJpegMetadata(Buffer.concat([SOI, Buffer.from([0x12, 0x34])])), null);
  });
});

describe('media-attach: בדיקת גוף הבקשה', () => {
  test('attach תקין: { task_id, image }', () => {
    assert.deepEqual(parseChatAction({ action: 'attach', task_id: TASK_ID, image: B64 }), { ok: true, action: 'attach', taskId: TASK_ID, image: B64 });
  });
  test('task_id לא תקף, image חסר, ריק או לא מחרוזת: נדחה', () => {
    for (const body of [
      { action: 'attach', task_id: 'abc', image: B64 },
      { action: 'attach', image: B64 },
      { action: 'attach', task_id: TASK_ID },
      { action: 'attach', task_id: TASK_ID, image: '' },
      { action: 'attach', task_id: TASK_ID, image: 42 },
    ]) assert.deepEqual(parseChatAction(body), { ok: false });
  });
});

describe('media-attach: attachImage', () => {
  test('נשמרת: העלאה אחת עם השם האקראי, ואחריה שורה אחת ב-media עם task_id, subject, received_at ו-stored', async () => {
    const sql = attachDb();
    const upload = fakeUpload();
    const result = await attachImage({ sql, taskId: TASK_ID, jpeg: JPEG_CLEAN, upload, now: REVIEW_NOW });
    assert.deepEqual(result, { status: 'attached', mediaId: MEDIA_ID });
    assert.equal(upload.calls.length, 1);
    assert.match(upload.calls[0].pathname, /^homework\/[0-9a-f-]{36}\.jpg$/);
    assert.equal(upload.calls[0].pathname.includes(TASK_ID), false, 'שם הקובץ לא נגזר מהמשימה');
    const [insert] = mediaWrites(sql);
    assert.ok(insert.values.includes(TASK_ID));
    assert.ok(insert.values.includes('מתמטיקה'));
    assert.ok(insert.values.includes(REVIEW_NOW.toISOString()));
    assert.ok(insert.values.includes(JPEG_CLEAN.length));
    assert.ok(insert.values.includes(`https://store.private.blob.example/${upload.calls[0].pathname}`));
    assert.match(insert.text, /'stored'/);
    assert.match(insert.text, /'image\/jpeg'/);
  });
  test('חוט מחבר: תמונה שהועלתה בתוך שיעור נשמרת עם lesson_date ו-lesson_period (שעון ישראל)', async () => {
    const sql = attachDb({ task: { id: TASK_ID, subject: null } });
    const timetable = { slots: [{ weekday: 3, period: 3, startsAt: '10:05', endsAt: '10:50', subject: 'היסטוריה' }] };
    await attachImage({ sql, taskId: TASK_ID, jpeg: JPEG_CLEAN, upload: fakeUpload(), now: new Date('2026-11-24T08:20:00Z'), timetable });
    const [insert] = mediaWrites(sql);
    assert.match(insert.text, /lesson_date/);
    assert.ok(insert.values.includes('2026-11-24'));
    assert.ok(insert.values.includes(3));
    assert.ok(insert.values.includes('היסטוריה'), 'מקצוע ריק במשימה: נגזר מהשיעור');
  });
  test('חוט מחבר: מקצוע של המשימה גובר על מקצוע השיעור; מחוץ לשיעור הקישור NULL', async () => {
    const timetable = { slots: [{ weekday: 3, period: 3, startsAt: '10:05', endsAt: '10:50', subject: 'היסטוריה' }] };
    const inLesson = attachDb();
    await attachImage({ sql: inLesson, taskId: TASK_ID, jpeg: JPEG_CLEAN, upload: fakeUpload(), now: new Date('2026-11-24T08:20:00Z'), timetable });
    assert.ok(mediaWrites(inLesson)[0].values.includes('מתמטיקה'));
    assert.equal(mediaWrites(inLesson)[0].values.includes('היסטוריה'), false);
    const outside = attachDb();
    await attachImage({ sql: outside, taskId: TASK_ID, jpeg: JPEG_CLEAN, upload: fakeUpload(), now: new Date('2026-11-24T18:00:00Z'), timetable });
    const values = mediaWrites(outside)[0].values;
    assert.equal(values.filter((v) => v === null).length >= 2, true, 'lesson_date ו-lesson_period הם null');
  });
  test('שני צירופים: שני שמות שונים', async () => {
    const upload = fakeUpload();
    await attachImage({ sql: attachDb(), taskId: TASK_ID, jpeg: JPEG_CLEAN, upload, now: REVIEW_NOW });
    await attachImage({ sql: attachDb(), taskId: TASK_ID, jpeg: JPEG_CLEAN, upload, now: REVIEW_NOW });
    assert.notEqual(upload.calls[0].pathname, upload.calls[1].pathname);
  });
  test('משימה לא קיימת או לא פתוחה: closed, בלי העלאה ובלי שורה', async () => {
    const sql = attachDb({ task: null });
    const upload = fakeUpload();
    assert.deepEqual(await attachImage({ sql, taskId: TASK_ID, jpeg: JPEG_CLEAN, upload, now: REVIEW_NOW }), { status: 'closed' });
    assert.equal(upload.calls.length, 0);
    assert.equal(mediaWrites(sql).length, 0);
  });
  test('קריטריון 11: כשל העלאה לא משאיר שורה ב-media; בלוג רק שם השגיאה', async (t) => {
    const out = captureConsole(t);
    const sql = attachDb();
    const result = await attachImage({ sql, taskId: TASK_ID, jpeg: JPEG_CLEAN, upload: fakeUpload({ fail: true }), now: REVIEW_NOW });
    assert.deepEqual(result, { status: 'failed' });
    assert.equal(mediaWrites(sql).length, 0);
    assert.match(out.text(), /BlobStoreNotFoundError/);
    assert.doesNotMatch(out.text(), /store not found/);
  });
});

describe('chat: פעולת attach (קריטריון 11)', () => {
  test('נשמרת: status attached, media_id, open_tasks עם media_count, badge; התמונה שהועלתה בלי המיקום', async () => {
    const sql = attachDb();
    const upload = fakeUpload();
    const res = await post(sql, { action: 'attach', task_id: TASK_ID, image: B64 }, { upload });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'attached');
    assert.equal(body.media_id, MEDIA_ID);
    assert.equal(body.open_tasks[0].media_count, 1);
    assert.equal(typeof body.badge, 'number');
    assert.deepEqual(upload.calls[0].body, JPEG_CLEAN);
  });
  test('כשל העלאה: status failed עם הודעת שגיאה, ואין שורה ב-media', async (t) => {
    captureConsole(t);
    const sql = attachDb();
    const body = await (await post(sql, { action: 'attach', task_id: TASK_ID, image: B64 }, { upload: fakeUpload({ fail: true }) })).json();
    assert.equal(body.status, 'failed');
    assert.equal(body.message, UPLOAD_FAILED_TEXT);
    assert.equal(mediaWrites(sql).length, 0);
  });
  test('בלי BLOB_READ_WRITE_TOKEN: status disabled עם "תמונות עוד לא מחוברות", בלי מסד ובלי העלאה', async () => {
    const sql = attachDb();
    const upload = fakeUpload();
    const body = await (await post(sql, { action: 'attach', task_id: TASK_ID, image: B64 }, { blobToken: '', upload })).json();
    assert.deepEqual(body, { status: 'disabled', message: IMAGES_OFF_TEXT });
    assert.equal(IMAGES_OFF_TEXT, 'תמונות עוד לא מחוברות');
    assert.equal(sql.calls.length, 0);
    assert.equal(upload.calls.length, 0);
  });
  test('task_id לא תקף: 400, בלי מסד ובלי העלאה', async () => {
    const sql = attachDb();
    const upload = fakeUpload();
    const res = await post(sql, { action: 'attach', task_id: 'not-a-uuid', image: B64 }, { upload });
    assert.equal(res.status, 400);
    assert.equal(sql.calls.length, 0);
    assert.equal(upload.calls.length, 0);
  });
  test('משימה שלא קיימת: status closed, אין שורה', async () => {
    const sql = attachDb({ task: null });
    const body = await (await post(sql, { action: 'attach', task_id: TASK_ID, image: B64 })).json();
    assert.equal(body.status, 'closed');
    assert.equal(mediaWrites(sql).length, 0);
  });
  test('לא JPEG: 400 בלי העלאה', async () => {
    const sql = attachDb();
    const upload = fakeUpload();
    const res = await post(sql, { action: 'attach', task_id: TASK_ID, image: Buffer.from('not an image').toString('base64') }, { upload });
    assert.equal(res.status, 400);
    assert.equal(upload.calls.length, 0);
  });
  test('תקרות: attach עד 1,500,000 תווים עובר את בדיקת הגודל; מעל = 400; פעולה אחרת מעל 16,384 = 400', async () => {
    assert.equal(MAX_ATTACH_BODY_CHARS, 1_500_000);
    const head = { action: 'attach', task_id: TASK_ID, image: '' };
    const overhead = JSON.stringify(head).length;
    const padded = (total) => {
      // JPEG תקין שמרופד בבתים ב-SCAN עד שהגוף באורך המדויק (base64 בכפולות 4).
      const room = Math.floor((total - overhead) / 4) * 3 - JPEG_CLEAN.length;
      return Buffer.concat([SOI, APP0, DQT, SOS, Buffer.alloc(room, 0x11), EOI]).toString('base64');
    };
    const okImage = padded(MAX_ATTACH_BODY_CHARS);
    assert.ok(JSON.stringify({ ...head, image: okImage }).length <= MAX_ATTACH_BODY_CHARS);
    const ok = await post(attachDb(), { ...head, image: okImage });
    assert.equal(ok.status, 200);
    const tooBig = await post(attachDb(), { ...head, image: okImage + 'AAAA'.repeat(1000) });
    assert.equal(tooBig.status, 400);
    const otherBig = await post(attachDb(), { action: 'read', message_ids: [], pad: 'x'.repeat(16_400) });
    assert.equal(otherBig.status, 400);
  });
  test('פרטיות: הלוג לא מכיל את התמונה, את הטוקן או את המיקום', async (t) => {
    const out = captureConsole(t);
    await post(attachDb(), { action: 'attach', task_id: TASK_ID, image: B64 }, { upload: fakeUpload({ fail: true }) });
    await post(attachDb({ fail: (text) => text.startsWith('INSERT INTO media') }), { action: 'attach', task_id: TASK_ID, image: B64 });
    assert.doesNotMatch(out.text(), new RegExp(FAKE_TOKEN));
    assert.equal(out.text().includes(B64.slice(0, 40)), false);
    assert.doesNotMatch(out.text(), /GPS/);
  });
  test('כשל מסד בשמירת השורה אחרי העלאה: 500 עם נוסח השגיאה הרגיל', async (t) => {
    captureConsole(t);
    const res = await post(attachDb({ fail: (text) => text.startsWith('INSERT INTO media') }), { action: 'attach', task_id: TASK_ID, image: B64 });
    assert.equal(res.status, 500);
  });
});

describe('chat: GET images_enabled', () => {
  test('יש טוקן: true; אין: false. הטוקן עצמו לא מוחזר', async () => {
    const on = await (await get(attachDb(), FAKE_TOKEN)).text();
    assert.equal(JSON.parse(on).images_enabled, true);
    assert.equal(on.includes(FAKE_TOKEN), false);
    assert.equal((await (await get(attachDb(), '')).json()).images_enabled, false);
    assert.equal((await (await get(attachDb(), undefined)).json()).images_enabled, false);
  });
});
