// בדיקות ל-lib/help-reply.js: "מה אתה יודע לעשות?" / "עזרה" -> בועת דוגמאות. בלי מסד.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql } from './helpers.js';
import { detectHelp, answerHelp, HELP_TEXT } from '../lib/help-reply.js';
import { processSource } from '../lib/intake-process.js';

const SRC = { id: '44444444-4444-4444-8444-444444444444', channel: 'app', raw_content: 'מה אתה יודע לעשות?', content_hash: 'h', received_at: new Date('2026-11-23T07:00:00.000Z') };

describe('help-reply', () => {
  test('זיהוי: ביטויים מלאים בלבד', () => {
    for (const t of ['עזרה', 'מה אתה יודע לעשות?', 'מה אפשר לכתוב פה?', 'איך זה עובד?', '?', 'help']) assert.equal(detectHelp(t), true, t);
    for (const t of ['עזרה בשיעורי בית במתמטיקה', 'מה יש לי מחר?', 'פגישה מחר', null]) assert.equal(detectHelp(t), false, String(t));
  });
  test('הנוסח כולל את היכולות העיקריות', () => {
    for (const part of ['מה יש לי מחר?', 'אני פנוי', 'תראה לי את השבוע', 'תביא לי', 'לא לומד היום', 'להאזנה', '4fitness']) assert.ok(HELP_TEXT.includes(part), part);
  });
  test('answerHelp: בועה אחת, בלי כתיבה ליומן', async () => {
    const sql = fakeSql((text) => (text.includes('help-reply') ? [{ claimed: 1 }] : []));
    const out = await answerHelp({ sql, source: SRC });
    assert.equal(out.status, 'recorded');
    assert.equal(out.reply, HELP_TEXT);
    assert.equal(sql.find('INSERT INTO events').length, 0);
  });
  test('בצינור: מוקלד נענה לפני המוח; מועבר לא', async () => {
    let asked = 0;
    const understand = async () => { asked += 1; return { ok: false, reason: 'no-key' }; };
    const sql = fakeSql((text) => (text.includes('help-reply') ? [{ claimed: 1 }] : []));
    const out = await processSource({ sql, source: SRC, timetable: null, understand });
    assert.equal(out.status, 'recorded');
    assert.equal(asked, 0);
    const fwd = fakeSql(() => []);
    await processSource({ sql: fwd, source: { ...SRC, channel: 'shortcut' }, timetable: null, understand });
    assert.equal(fwd.find('help-reply').length, 0);
  });
  test('אותה שאלה שוב באותו יום: נענית שוב', async () => {
    const sql = fakeSql((text) => (text.includes('help-reply') ? [{ claimed: 1 }] : text.includes('JOIN sources p') ? [{ found: 1 }] : []));
    const out = await processSource({ sql, source: SRC, timetable: null });
    assert.equal(out.status, 'recorded');
  });
});
