// בדיקות לקובץ db/schema.sql: קורא את הקובץ כטקסט בלבד, בלי חיבור למסד.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
// בלי הערות (-- עד סוף השורה), כדי שמילים בהערות לא יפעילו את הבדיקות.
const sql = raw.split(/\r?\n/).map((line) => line.replace(/--.*$/, '')).join('\n');

const EXISTING = [
  'sources', 'alarms', 'push_subscriptions', 'watch_channels', 'call_log', 'probe_log', 'push_sends',
  'google_oauth_states', 'google_credentials', 'google_watch_channels',
];
const NEW = [
  'media', 'facts', 'events', 'tasks', 'commitments', 'links', 'changes', 'decisions', 'messages',
  'candidate_rules', 'static_loads', 'timetable_slots', 'calendar_exceptions',
];
// טבלת המדידה של הקליטה (docs/09-security/46, שלב M.1).
const MEASUREMENT = ['intake_outcomes', 'intake_checks'];
// שאלת שיעורי הבית (שלב 8.6-1, docs/08-chapter8/60).
const HOMEWORK = ['lesson_asks'];

// כל CREATE TABLE, עם הגוף עד ');' שבתחילת שורה.
const tables = [...sql.matchAll(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\);/gi)]
  .map((m) => ({ ifNotExists: Boolean(m[1]), name: m[2], body: m[3] }));

describe('db/schema.sql', () => {
  test('בדיוק 26 הטבלאות הצפויות', () => {
    assert.deepEqual(tables.map((t) => t.name).sort(), [...EXISTING, ...NEW, ...MEASUREMENT, ...HOMEWORK].sort());
    assert.equal(tables.length, 26);
  });

  test('lesson_asks: תשע העמודות כפי שיובל הריץ ב-Neon, UNIQUE על (subject, lesson_date, seq_start_period), ו-task_id מפנה ל-tasks', () => {
    const t = tables.find((x) => x.name === 'lesson_asks');
    const columns = t.body.split(/\r?\n/).map((line) => /^\s*(\w+)\s+(\w+)/.exec(line)).filter(Boolean).map((m) => `${m[1]} ${m[2]}`).filter((c) => !c.startsWith('UNIQUE'));
    assert.deepEqual(columns, ['id uuid', 'subject text', 'lesson_date date', 'seq_start_period integer', 'seq_end_at timestamptz', 'topic text', 'had_homework boolean', 'task_id uuid', 'status text']);
    assert.match(t.body, /^\s*subject\s+text\s+NOT NULL/m);
    assert.match(t.body, /^\s*lesson_date\s+date\s+NOT NULL/m);
    assert.match(t.body, /^\s*seq_start_period\s+integer\s+NOT NULL/m);
    assert.match(t.body, /^\s*task_id\s+uuid\s+REFERENCES tasks\(id\)/m);
    assert.match(t.body, /^\s*status\s+text\s+NOT NULL DEFAULT 'asked'/m);
    assert.match(t.body, /UNIQUE \(subject, lesson_date, seq_start_period\)/);
  });

  test('העמודות החדשות של 8.6-1: tasks.subject, tasks.created_at (DEFAULT now()), media.task_id (מפנה ל-tasks)', () => {
    const tasks = tables.find((x) => x.name === 'tasks').body;
    assert.match(tasks, /^\s*subject\s+text\s*,/m);
    assert.match(tasks, /^\s*created_at\s+timestamptz DEFAULT now\(\)/m);
    assert.match(tables.find((x) => x.name === 'media').body, /^\s*task_id\s+uuid\s+REFERENCES tasks\(id\)/m);
  });

  test('intake_checks: בדיוק חמש העמודות של 46, outcome_id מפנה ל-intake_outcomes, ובלי עמודת טקסט או שם', () => {
    const t = tables.find((x) => x.name === 'intake_checks');
    const columns = t.body.split('\n').map((line) => /^\s*(\w+)\s+(\w+)/.exec(line)).filter(Boolean).map((m) => `${m[1]} ${m[2]}`);
    assert.deepEqual(columns, ['id uuid', 'outcome_id uuid', 'verdict text', 'event_type text', 'checked_at timestamptz']);
    assert.match(t.body, /^\s*id\s+uuid\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/m);
    assert.match(t.body, /^\s*outcome_id\s+uuid\s+NOT NULL REFERENCES intake_outcomes\(id\)/m);
    assert.doesNotMatch(t.body, /\bUNIQUE\b/i); // סימון חוזר מוסיף שורה (D17.5)
    assert.match(t.body, /^\s*verdict\s+text\s+NOT NULL/m);
    assert.match(t.body, /^\s*event_type\s+text\s*,/m); // nullable: מלא רק כש-verdict = was_event
    assert.match(t.body, /^\s*checked_at\s+timestamptz\s+NOT NULL DEFAULT now\(\)/m);
  });

  test('intake_outcomes: בדיוק חמש העמודות של 46, source_id ייחודי ומפנה ל-sources, ובלי עמודת טקסט או שם', () => {
    const t = tables.find((x) => x.name === 'intake_outcomes');
    const columns = t.body.split('\n').map((line) => /^\s*(\w+)\s+(\w+)/.exec(line)).filter(Boolean).map((m) => `${m[1]} ${m[2]}`);
    assert.deepEqual(columns, ['id uuid', 'source_id uuid', 'status text', 'reason text', 'recorded_at timestamptz']);
    assert.match(t.body, /^\s*id\s+uuid\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/m);
    assert.match(t.body, /^\s*source_id\s+uuid\s+NOT NULL UNIQUE REFERENCES sources\(id\)/m);
    assert.match(t.body, /^\s*status\s+text\s+NOT NULL/m);
    assert.match(t.body, /^\s*reason\s+text\s*,/m); // nullable: מלא רק כש-status הוא failed
    assert.match(t.body, /^\s*recorded_at\s+timestamptz\s+NOT NULL DEFAULT now\(\)/m);
  });

  test('כל CREATE TABLE כולל IF NOT EXISTS', () => {
    assert.equal((sql.match(/CREATE\s+TABLE/gi) || []).length, tables.length);
    for (const t of tables) assert.ok(t.ifNotExists, `${t.name}: חסר IF NOT EXISTS`);
  });

  test('אין DROP / DELETE / TRUNCATE / ALTER TABLE מחוץ להערות', () => {
    for (const word of ['DROP', 'DELETE', 'TRUNCATE']) {
      assert.equal(new RegExp(`\\b${word}\\b`, 'i').test(sql), false, `נמצא ${word}`);
    }
    assert.equal(/ALTER\s+TABLE/i.test(sql), false, 'נמצא ALTER TABLE');
    assert.equal(/ON\s+DELETE/i.test(sql), false, 'נמצא ON DELETE');
  });

  test('אין INSERT / UPDATE מחוץ להערות (בלי הכנסת נתונים)', () => {
    assert.equal(/\bINSERT\b/i.test(sql), false);
    assert.equal(/\bUPDATE\b/i.test(sql), false);
  });

  test('אין timestamp בלי tz (רק timestamptz)', () => {
    assert.equal(/\btimestamp\b(?!tz)/i.test(sql), false);
    assert.ok(/timestamptz/.test(sql));
  });

  test('אין UNIQUE על calendar_id ב-google_watch_channels (watch_channels הישנה כן, ולא שונתה)', () => {
    const t = tables.find((x) => x.name === 'google_watch_channels');
    assert.equal(/calendar_id\s+[^,\n]*\bUNIQUE\b/i.test(t.body), false);
    assert.equal(/UNIQUE\s*\([^)]*calendar_id/i.test(t.body), false);
    assert.equal(/CREATE\s+UNIQUE\s+INDEX[^;]*google_watch_channels[^;]*calendar_id/i.test(sql), false);
    const old = tables.find((x) => x.name === 'watch_channels');
    assert.match(old.body, /calendar_id\s+text\s+NOT NULL UNIQUE/);
  });

  test('כל עמודה בשם id היא uuid', () => {
    for (const t of tables) {
      const m = t.body.match(/^\s*id\s+(\w+)/m);
      if (m) assert.equal(m[1].toLowerCase(), 'uuid', `${t.name}: id אינו uuid`);
    }
    // 13 הטבלאות החדשות כולן עם id מסוג uuid
    for (const name of NEW) {
      const t = tables.find((x) => x.name === name);
      assert.match(t.body, /^\s*id\s+uuid\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/m, `${name}: חסר id uuid`);
    }
  });

  test('מפתח זר מפנה רק לטבלה שנוצרה קודם', () => {
    const seen = new Set();
    for (const t of tables) {
      for (const m of t.body.matchAll(/REFERENCES\s+(\w+)/gi)) {
        assert.ok(seen.has(m[1]), `${t.name} מפנה ל-${m[1]} לפני שנוצרה`);
      }
      seen.add(t.name);
    }
  });

  test('בטבלה עם כלל חוזר יש עמודת timezone', () => {
    for (const name of ['commitments', 'timetable_slots']) {
      const t = tables.find((x) => x.name === name);
      assert.match(t.body, /\btimezone\s+text/, `${name}: חסר timezone`);
    }
  });
});
