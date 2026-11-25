// אירוע בשעת שיעור (יובל, 25.11.2026, "ב'" ו"א'"): "היום בשעה השלישית יש הרצאה בנושא X" -> אירוע כללי (personal_event) עם שיעור:
// השעות ממערכת השעות, יומן "בית ספר", כרטיס "נכון?" עם "במקום <מקצוע>", והשיעור נחשב מבוטל (בלי שאלת "היו שיעורי בית?").
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql } from './helpers.js';
import { extractFacts } from '../lib/intake-facts.js';
import { buildPrompt, mergeUnderstanding } from '../lib/intake-brain.js';
import { buildQuestion } from '../lib/intake-questions.js';
import { decideAbsence } from '../lib/homework-absence.js';
import { processSource } from '../lib/intake-process.js';

const slot = (weekday, period, startsAt, endsAt, subject) => ({ weekday, period, startsAt, endsAt, subject, teacher: null, room: null });
// רביעי = 4 (במערכת השעות 1 = ראשון)
const TIMETABLE = { slots: [slot(4, 1, '08:15', '09:00', 'כימיה'), slot(4, 2, '09:05', '09:50', 'כימיה'), slot(4, 3, '10:05', '10:50', 'ערבית'), slot(4, 4, '10:55', '11:40', 'אנגלית')] };
const WEDNESDAY = new Date('2026-11-25T05:29:00.000Z'); // רביעי 25.11, 07:29
const TEXT = 'היום בשעה השלישית יש הרצאה בנושא שוויון זוגות לבעלי מוגבלויות';
const SRC_ID = '11111111-1111-4111-8111-111111111111';
const source = (text = TEXT) => ({ id: SRC_ID, channel: 'app', raw_content: text, content_hash: `h-${text}`, received_at: WEDNESDAY });
const brain = (over = {}) => ({ kind: 'personal_event', subject: null, topic: 'הרצאה בנושא שוויון זוגות לבעלי מוגבלויות', date_text: 'היום', new_date_text: null, time_text: null, new_room: null, end_date_text: null, uncertain: [], ...over });
const valueOf = (result, field) => result.facts.find((f) => f.field === field)?.value;
const originOf = (result, field) => result.facts.find((f) => f.field === field)?.origin;
const writesOf = (sql) => sql.calls.filter((call) => /\b(INSERT|UPDATE|DELETE)\b/.test(call.text));

describe('אירוע בשעת שיעור: החילוץ', () => {
  test('"בשעה השלישית": שיעור 3 נקרא, והשעות ממערכת השעות (10:05–10:50)', () => {
    const r = extractFacts({ text: TEXT, receivedAt: WEDNESDAY, channel: 'app', timetable: TIMETABLE, forcedType: 'personal_event' });
    assert.equal(valueOf(r, 'date'), '2026-11-25');
    assert.equal(valueOf(r, 'lesson'), '3');
    assert.equal(originOf(r, 'lesson'), 'read');
    assert.equal(valueOf(r, 'time'), '10:05');
    assert.equal(originOf(r, 'time'), 'inferred');
    assert.equal(valueOf(r, 'end_time'), '10:50');
  });
  test('כמה שיעורים ("בשעה השלישית והרביעית"): מתחילת הראשון עד סוף האחרון', () => {
    const r = extractFacts({ text: 'היום בשעה השלישית והרביעית יש טקס', receivedAt: WEDNESDAY, channel: 'app', timetable: TIMETABLE, forcedType: 'personal_event' });
    assert.equal(valueOf(r, 'lesson'), '3,4');
    assert.equal(valueOf(r, 'time'), '10:05');
    assert.equal(valueOf(r, 'end_time'), '11:40');
  });
  test('בלי מערכת שעות: השיעור נקרא, השעה חסרה (נשאלת)', () => {
    const r = extractFacts({ text: TEXT, receivedAt: WEDNESDAY, channel: 'app', timetable: null, forcedType: 'personal_event' });
    assert.equal(valueOf(r, 'lesson'), '3');
    assert.equal(valueOf(r, 'time'), undefined);
    assert.ok(r.missing.includes('time'));
  });
  test('שעה מפורשת גוברת על שיעור, ואירוע בלי שיעור לא משתנה', () => {
    const timed = extractFacts({ text: 'פגישה עם המורה מחר ב-16:00', receivedAt: WEDNESDAY, channel: 'app', timetable: TIMETABLE, forcedType: 'personal_event' });
    assert.equal(valueOf(timed, 'lesson'), undefined);
    assert.equal(valueOf(timed, 'time'), '16:00');
  });
});

describe('אירוע בשעת שיעור: המוח', () => {
  test('הפרומפט: אירוע בבית הספר (הרצאה, טקס, סיור) הוא personal_event, ושיעור אינו time_text', () => {
    const prompt = buildPrompt({ text: TEXT });
    assert.match(prompt, /personal_event: [^\n]*הרצאה/);
    assert.match(prompt, /time_text[^\n]*שיעור/);
  });
  test('מיזוג: "time" ב-uncertain לא מוחק שעה שנגזרה משיעור שנקרא', () => {
    const extracted = extractFacts({ text: TEXT, receivedAt: WEDNESDAY, channel: 'app', timetable: TIMETABLE, forcedType: 'personal_event' });
    const merged = mergeUnderstanding({ extracted, understanding: brain({ uncertain: ['time'] }), receivedAt: WEDNESDAY, text: TEXT });
    assert.equal(merged.facts.find((f) => f.field === 'time')?.value, '10:05');
    assert.equal(merged.facts.find((f) => f.field === 'lesson')?.value, '3');
  });
});

describe('אירוע בשעת שיעור: כרטיס, יומן, ביטול השיעור', () => {
  const fx = (field, value, origin = 'read') => ({ field, value, origin });
  const FACTS = [fx('date', '2026-11-25'), fx('time', '10:05', 'inferred'), fx('end_time', '10:50', 'inferred'), fx('topic', 'הרצאה בנושא שוויון'), fx('lesson', '3')];
  test('כרטיס האישור: "..., היום 10:05 עד 10:50, במקום ערבית. נכון?"', () => {
    const q = buildQuestion({ field: 'confirm', type: 'personal_event', facts: FACTS, timetable: TIMETABLE, today: '2026-11-25' });
    assert.equal(q.text, 'הרצאה בנושא שוויון, היום 10:05 עד 10:50, במקום ערבית. נכון?');
  });
  test('בצינור (המוח אומר personal_event): שורת האירוע ביומן "בית ספר" (domain school), בשעות השיעור', async () => {
    const sql = fakeSql(() => []);
    await processSource({ sql, source: source(), timetable: TIMETABLE, understand: async () => ({ ok: true, model: 'm', understanding: brain() }) });
    const write = writesOf(sql).find((c) => c.text.includes('WITH claim AS'));
    const [row] = JSON.parse(write.values.at(-1));
    assert.equal(row.domain, 'school');
    assert.equal(row.start_time, '10:05');
    assert.equal(row.end_time, '10:50');
    assert.equal(row.movable, false);
    const texts = write.values.filter((v) => typeof v === 'string');
    assert.ok(texts.some((t) => t.includes('במקום ערבית. נכון?')), texts.join(' | '));
  });
  test('השיעור נחשב מבוטל: אין שאלת "היו שיעורי בית?" על שיעור 3 (אישור או בלי אישור); "לא נכון" / "לא קורה": לא', () => {
    const rows = (extra = []) => [
      { source_id: 's1', field: 'type', value: 'personal_event' }, { source_id: 's1', field: 'date', value: '2026-11-25' }, { source_id: 's1', field: 'lesson', value: '3' }, ...extra,
    ];
    const sequence = { lessonDate: '2026-11-25', startPeriod: 3, endPeriod: 3, endsAt: '10:50' };
    assert.equal(decideAbsence({ rows: rows(), sequence, timetable: TIMETABLE }).cancelled, true);
    assert.equal(decideAbsence({ rows: rows([{ source_id: 's1', field: 'confirm', value: 'yes' }]), sequence, timetable: TIMETABLE }).cancelled, true);
    assert.equal(decideAbsence({ rows: rows([{ source_id: 's1', field: 'confirm', value: 'no' }]), sequence, timetable: TIMETABLE }).cancelled, false);
    assert.equal(decideAbsence({ rows: rows([{ source_id: 's1', field: 'fix', value: 'cancel' }]), sequence, timetable: TIMETABLE }).cancelled, false);
    const other = { lessonDate: '2026-11-25', startPeriod: 4, endPeriod: 4, endsAt: '11:40' };
    assert.equal(decideAbsence({ rows: rows(), sequence: other, timetable: TIMETABLE }).cancelled, false);
  });
});
