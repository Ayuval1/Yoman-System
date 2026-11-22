// ריצות שלישי ושישי (בלוק 5): "כל הריצות בשבוע". קוד בלבד, בלי מודל.
// המפרט המחייב: docs/02-rules/03-4fitness-rules.md, "כל הריצות בשבוע" (הטבלה, הכרעות 1-7, "כללים שחלים על כל הריצות");
// הסמכות: docs/02-rules/03-sources-rules.md, שורת "ריצה עצמאית מתוכננת" (שעת ההתחלה קבועה, האורך מ-Garmin, אין אימון ב-Garmin -> המערכת שואלת).
//
// הטבלה:  שלישי: התארגנות 18:00–18:30, ריצה מ-18:30. שישי: התארגנות 04:30–05:30 ("אני קם ב04:30"), ריצה מ-05:30. האורך מ-Garmin.
//
// הכרעה טכנית של המנהל (22.11.2026), במקום סדרה חוזרת ב-Google: אירוע נפרד לכל תאריך, כי Garmin קובע את האורך בכל שבוע
// (סדרה הייתה דורשת חריגה לכל מופע). שורות events בתחום running, מפתח 'source:weekly:<YYYY-MM-DD>:run' / ':prep'.
// המפתח מתחיל ב-'source:', ולכן lib/event-sync.js כותב אותו ליומן "אימונים" (syncEventsByMatchKeys) והסריקה היומית מנסה שוב.
// הריצה מקבלת צבע 11 ותזכורות 1440 + 60 כמו אימון 4fitness (eventBody); ההתארגנות (':prep') כותרת ושעות בלבד.
// כותרת: "ריצה" (כמו "ריצה" בדוגמת שני בקובץ: "ריצה" 18:00–18:50) ו"התארגנות" (PREP_TITLE, כמו בשני/רביעי).
// המפתח 'source:weekly:' אינו ':fitness:', ולכן lib/garmin-apply.js (שני/רביעי) לא נוגע בהם, והלוז (lib/intake-process.js) עובד רק על שני ורביעי.
// lib/training-source.js ("אימונים מחר" בסגירה) כולל את הריצה לפי המפתח, ו-lib/closing-tomorrow.js לא מציג אותה פעמיים.
//
// מתי (lib/ops/garmin-sync.js, אחרי כל משיכה; Cron 13:00 ו-14:00 UTC):
//   - יש ריצה מתוכננת ב-Garmin לשלישי/שישי בטווח היום..+7: יוצרים ריצה + התארגנות, או מעדכנים את האורך. התוכן מ-Garmin בתיאור.
//   - אין ריצה ב-Garmin: ביום שלפני (שני לשלישי, חמישי לשישי, "עד חמישי בערב"), במשיכה של 14:00 UTC ואילך, שאלה "יש ריצה ביום שלישי 24.11?" עם כן / לא.
//     גם כשהמשיכה מ-Garmin נכשלה (אין פריט = אין אימון ידוע): שואלים, ולא יוצרים כלום.
//   - "כן" -> ריצה של 60 דקות (הנחה, לא אומת) + התארגנות. "לא" -> כלום. אימון שמגיע מ-Garmin אחרי "כן" מעדכן את האורך.
// התנגשות (03-4fitness, "התנגשות -> שאלה, לא הזזה"): לפני יצירה או הארכה בודקים אירועים במסד וביומני Google של אותו יום.
//   חפיפה -> לא יוצרים, ושאלה "ריצת שלישי 18:30–19:30 מתנגשת ב-X. לרשום בכל זאת?" עם כן / לא. "כן" = נרשם בכל זאת, ומאז האורך מתעדכן בלי לשאול שוב.
//
// השאלות: שורת messages רגילה (kind='question', awaiting_reply=true), כמו lib/vacation-ask.js. entity_type 'weekly_run_ask' / 'weekly_run_conflict',
// entity_id דטרמיניסטי מהתאריך (briefEntityId), והכנסה עם NOT EXISTS: ריצה חוזרת לא יוצרת שאלה שנייה. התאריך, האורך והתוכן נשמרים ב-facts
// (entity_type 'weekly_run', אותו entity_id), כדי שהתשובה תדע מה לרשום. אין טבלה חדשה ואין שינוי סכמה.
// התשובה נשמרת כשורת sources (ערוץ app, sender='answer'), מקושרת ב-reply_source_id, כמו בשאלת החופשה.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי (אין מסד בסשן הבנייה). הבדיקות מוודאות את התוכנית, הפרמטרים והזרימה.
// פרטיות: ללוג נכנסים רק קודים קצרים, בלי כותרות ובלי מזהים.
import { PREP_TITLE } from './fitness-schedule.js';
import { googleEventIdFor, syncEventsByMatchKeys } from './event-sync.js';
import { addDays, formatDayMonth, localDateIso, WEEKDAY_NAMES, weekdayOf } from './intake-dates.js';
import { localParts, zonedToUtc } from './schedule-time.js';
import { briefEntityId } from './brief-view.js';
import { isRunningItem, pushNow } from './garmin-apply.js';
import { cleanTitle, dayRange } from './closing-tomorrow.js';
import { googleDayFromEnv } from './free-check.js';
import { isMissingTable } from './garmin-store.js';

const TIME_ZONE = 'Asia/Jerusalem';
const MINUTE_MS = 60000;
const LRI = '⁦'; // בידוד כיווני לטווח שעות בפסקה עברית (כמו lib/vacation-ask.js)
const PDI = '⁩';
const DASH = '–';

export const WEEKLY_RUN_TITLE = 'ריצה';
export const WEEKLY_PREP_TITLE = PREP_TITLE;
// 03-4fitness, הטבלה ב"כל הריצות בשבוע". 2 = שלישי, 5 = שישי (weekdayOf: 0 = ראשון). ההתארגנות נגמרת כשהריצה מתחילה.
export const WEEKLY_DAYS = Object.freeze({
  2: Object.freeze({ prepFrom: '18:00', runFrom: '18:30' }),
  5: Object.freeze({ prepFrom: '04:30', runFrom: '05:30' }),
});
// [הנחה, לא אומת] אורך ריצה אחרי "כן" כשאין אימון ב-Garmin, או כשלאימון ב-Garmin אין משך. החלטת המנהל (22.11.2026); ניתן לשינוי כאן בלבד.
export const DEFAULT_RUN_MINUTES = 60;
// השאלה נשאלת במשיכה של 14:00 UTC (השנייה ביום, vercel.json) ואילך, כדי שלמשיכה של 13:00 תהיה הזדמנות להביא את האימון קודם.
export const ASK_FROM_UTC_HOUR = 14;
// כמה ימים קדימה Garmin יוצר / מעדכן ריצות (המנהל: "today..+7").
export const WEEKLY_WINDOW_DAYS = 7;
export const ASK_ENTITY = 'weekly_run_ask';
export const CONFLICT_ENTITY = 'weekly_run_conflict';
export const WEEKLY_ENTITIES = Object.freeze([ASK_ENTITY, CONFLICT_ENTITY]);
export const FACT_ENTITY = 'weekly_run';
export const YES = 'כן';
export const NO = 'לא';
export const WEEKLY_BUTTONS = Object.freeze([YES, NO]);
const FACT_DATE = 'weekly_run_date';
const FACT_MINUTES = 'weekly_run_minutes';
const FACT_DESCRIPTION = 'weekly_run_description';

// [הנחה, לא אומת] נוסחי הבועות אחרי תשובה הם בחירה של Claude בבנייה, לא של יובל.
export const yesBubble = (date, minutes) => `נרשמה ריצה ב${dayName(date)} ${formatDayMonth(date)} ${range(date, minutes)}.`;
export const noBubble = (date) => `נרשם. אין ריצה ב${dayName(date)} ${formatDayMonth(date)}.`;
export const ALREADY_BUBBLE = 'הריצה כבר רשומה.';

const rowsOf = (result) => (Array.isArray(result) ? result : []);
const toMs = (value) => {
  if (value === null || value === undefined) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};
const iso = (ms) => new Date(ms).toISOString();
const textOrNull = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);
const pad2 = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const p = localParts(new Date(ms), TIME_ZONE);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
};
// חותמת מקומית לשורות changes, באותו פורמט כמו lib/garmin-apply.js ('YYYY-MM-DD HH:MM').
const stamp = (ms) => `${localDateIso(new Date(ms), TIME_ZONE)} ${clock(ms)}`;
const dayName = (date) => WEEKDAY_NAMES[weekdayOf(date)];

export const weeklyKey = (date, kind) => `source:weekly:${date}:${kind}`;
const WEEKLY_RUN_KEY = /^source:weekly:\d{4}-\d{2}-\d{2}:run$/;
export const isWeeklyRunKey = (key) => typeof key === 'string' && WEEKLY_RUN_KEY.test(key);
export const isWeeklyDay = (date) => Object.hasOwn(WEEKLY_DAYS, weekdayOf(date));
export const askEntityId = (date) => briefEntityId(`weekly-run-ask-${date}`);
export const conflictEntityId = (date) => briefEntityId(`weekly-run-conflict-${date}`);

// השעות של יום ריצה (רגעי UTC, בטוח למעבר שעון: zonedToUtc).
export function weeklyTimes(date, minutes) {
  const spec = WEEKLY_DAYS[weekdayOf(date)];
  const runStart = zonedToUtc(date, spec.runFrom, TIME_ZONE).getTime();
  return { prepStart: zonedToUtc(date, spec.prepFrom, TIME_ZONE).getTime(), runStart, runEnd: runStart + minutes * MINUTE_MS };
}
function range(date, minutes) {
  const { runStart, runEnd } = weeklyTimes(date, minutes);
  return `${LRI}${clock(runStart)}${DASH}${clock(runEnd)}${PDI}`;
}

// נוסח השאלות (המנהל, 22.11.2026: "יש ריצה ביום שלישי 25.11?", "ריצת שלישי 18:30–19:30 מתנגשת ב-X. לרשום בכל זאת?").
export const askText = (date) => `יש ריצה ביום ${dayName(date)} ${formatDayMonth(date)}?`;
export const conflictText = ({ date, minutes, title }) => `ריצת ${dayName(date)} ${range(date, minutes)} מתנגשת ב-${cleanTitle(title)}. לרשום בכל זאת?`;

// התוכנית (טהורה). items = שורות garmin_items; events = אירועי 'source:weekly:' בחלון (כל סטטוס);
// asks = [{ date, entity_type, awaiting_reply, expires_at, answer }] (answer = טקסט התשובה, או null). fetchedAt = null: המשיכה נכשלה, שואלים בלבד.
// מחזיר { candidates: [{ date, action: 'create' | 'update', row, minutes, description, needsCheck }], asks: [date], skipped }.
export function planWeeklyRuns({ items, events, asks, now, fetchedAt }) {
  const nowMs = toMs(now);
  const fetchedMs = toMs(fetchedAt);
  const today = localDateIso(new Date(nowMs), TIME_ZONE);
  const tomorrow = addDays(today, 1);
  const out = { candidates: [], asks: [], skipped: { ambiguous: 0, declined: 0, waiting: 0 } };
  const current = fetchedMs === null ? [] : rowsOf(items).filter((item) => toMs(item.fetched_at) === fetchedMs && item.kind === 'planned' && isRunningItem(item));
  const byKey = new Map(rowsOf(events).map((row) => [row.match_key, row]));
  const asksOf = (date, type) => rowsOf(asks).find((row) => row.date === date && row.entity_type === type) ?? null;
  const open = (row) => row?.awaiting_reply === true && (toMs(row.expires_at) === null || toMs(row.expires_at) > nowMs);

  for (let offset = 0; offset <= WEEKLY_WINDOW_DAYS; offset += 1) {
    const date = addDays(today, offset);
    if (!isWeeklyDay(date)) continue;
    const { runStart } = weeklyTimes(date, 0);
    if (runStart <= nowMs) continue; // ריצה שכבר התחילה לא נוצרת ולא משתנה (כמו lib/event-sync.js)
    const run = byKey.get(weeklyKey(date, 'run')) ?? null;
    const ask = asksOf(date, ASK_ENTITY);
    const conflict = asksOf(date, CONFLICT_ENTITY);

    const unique = new Map(current.filter((item) => item.item_date === date).map((item) => [item.title ?? `#${item.garmin_id}`, item]));
    // שתי ריצות שונות באותו יום: לא ברור איזו היא הריצה, ולכן לא יוצרים (כמו lib/garmin-apply.js). [הנחה, לא אומת] כדי שזה לא ייעלם בשקט
    // ("שבירה אינה שקטה", 03-garmin-rules), שואלים "יש ריצה?" כמו כשאין ריצה ב-Garmin (תיקון אחרי הבודק, 23.11.2026).
    if (unique.size > 1) out.skipped.ambiguous += 1;
    if (unique.size !== 1) {
      // אין ריצה ב-Garmin: שאלה ביום שלפני, מהמשיכה של 14:00 UTC, פעם אחת. לא כשכבר יש אירוע ריצה או שאלה כלשהי על התאריך.
      const late = new Date(nowMs).getUTCHours() >= ASK_FROM_UTC_HOUR;
      if (date === tomorrow && late && !run && !ask && !conflict) out.asks.push(date);
      continue;
    }
    // [הנחה, לא אומת] "לא" של יובל (לשאלה או להתנגשות) גובר על אימון שהגיע אחר כך מ-Garmin: התשובה המפורשת והמאוחרת יותר.
    if (ask?.answer === NO || conflict?.answer === NO) {
      out.skipped.declined += 1;
      continue;
    }
    if (open(conflict)) {
      out.skipped.waiting += 1; // שאלת התנגשות פתוחה: מחכים לתשובה
      continue;
    }
    if (run && run.status !== 'planned') continue;
    const forced = conflict?.answer === YES;
    const [item] = unique.values();
    const description = textOrNull(item.title) ?? textOrNull(run?.description);
    const fromGarmin = Number.isInteger(item.duration_sec) && item.duration_sec > 0 ? Math.round(item.duration_sec / 60) : null;
    if (!run) {
      const minutes = fromGarmin ?? DEFAULT_RUN_MINUTES;
      out.candidates.push({ date, action: 'create', row: null, minutes, description, needsCheck: !forced });
      continue;
    }
    const startMs = toMs(run.starts_at);
    const endMs = toMs(run.ends_at);
    if (startMs === null || endMs === null) continue;
    const minutes = fromGarmin ?? Math.round((endMs - startMs) / MINUTE_MS);
    const newEnd = startMs + minutes * MINUTE_MS;
    if (newEnd === endMs && description === textOrNull(run.description)) continue;
    // רק הארכה יכולה ליצור התנגשות חדשה; קיצור או שינוי תוכן לא נבדקים.
    out.candidates.push({ date, action: 'update', row: run, minutes, description, needsCheck: !forced && newEnd > endMs });
  }
  return out;
}

// האם הבלוק (התארגנות עד סוף הריצה) חופף לאירוע אחר באותו יום. { title } או null. כשל Google לא עוצר:
// [הנחה, לא אומת] כש-Google לא נקרא, בודקים מול המסד בלבד (בשלישי המשיכה של היום היא ההזדמנות האחרונה לפני הריצה). כשל מסד נזרק.
export async function findConflict({ sql, date, fromMs, toMs: untilMs, googleDay }) {
  const { from, to } = dayRange(date);
  const rows = rowsOf(await sql`
    SELECT /* weekly-conflict-events */ id, title, starts_at, ends_at, external_id, match_key
    FROM events
    WHERE status = 'planned' AND starts_at >= ${from.toISOString()}::timestamptz AND starts_at < ${to.toISOString()}::timestamptz
    ORDER BY starts_at ASC
  `);
  const own = (key) => typeof key === 'string' && key.startsWith(`source:weekly:${date}:`);
  const known = new Set();
  for (const row of rows) {
    if (textOrNull(row.external_id)) known.add(row.external_id);
    const derived = googleEventIdFor(row.id);
    if (derived) known.add(derived);
  }
  const overlaps = (startMs, endMs) => {
    if (startMs === null) return false;
    const end = endMs ?? startMs;
    return end === startMs ? startMs >= fromMs && startMs < untilMs : startMs < untilMs && end > fromMs;
  };
  const hits = rows.filter((row) => !own(row.match_key) && overlaps(toMs(row.starts_at), toMs(row.ends_at)))
    .map((row) => ({ title: row.title, startMs: toMs(row.starts_at) }));
  if (typeof googleDay === 'function') {
    let listed;
    try {
      listed = await googleDay(date);
    } catch (error) {
      listed = { ok: false };
      console.error('weekly-runs: קריאת Google קרסה', error?.name);
    }
    if (!listed?.ok) console.error('weekly-runs: Google לא נבדק, בדיקת התנגשות מול המסד בלבד:', listed?.reason ?? 'failed');
    for (const event of listed?.ok && Array.isArray(listed.events) ? listed.events : []) {
      if (!event?.startsAt || known.has(event.id)) continue; // אירוע של יום שלם לא נחשב (כמו lib/free-check.js)
      if (overlaps(toMs(event.startsAt), toMs(event.endsAt))) hits.push({ title: event.title, startMs: toMs(event.startsAt) });
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.startMs - b.startMs);
  return { title: cleanTitle(hits[0].title) };
}

// שורות האירועים ליצירה: ריצה + התארגנות.
function createRows(date, minutes, description) {
  const { prepStart, runStart, runEnd } = weeklyTimes(date, minutes);
  return [
    { title: WEEKLY_RUN_TITLE, starts_at: iso(runStart), ends_at: iso(runEnd), description, match_key: weeklyKey(date, 'run') },
    { title: WEEKLY_PREP_TITLE, starts_at: iso(prepStart), ends_at: iso(runStart), description: null, match_key: weeklyKey(date, 'prep') },
  ];
}
// עדכון ריצה קיימת (אורך ותוכן). מחזיר { update, changes }.
function updateRow(row, minutes, description) {
  const startMs = toMs(row.starts_at);
  const endMs = toMs(row.ends_at);
  const newEnd = startMs + minutes * MINUTE_MS;
  const changes = [];
  if (newEnd !== endMs) changes.push({ entity_id: row.id, field: 'ends_at', old_value: stamp(endMs), new_value: stamp(newEnd) });
  if (description !== textOrNull(row.description)) changes.push({ entity_id: row.id, field: 'description', old_value: textOrNull(row.description), new_value: description });
  return {
    update: { id: row.id, starts_at: iso(startMs), ends_at: iso(newEnd), description, old_starts_at: iso(startMs), old_ends_at: iso(endMs), old_description: textOrNull(row.description) },
    changes,
  };
}
// שאלה + העובדות שלה.
function questionOf({ type, date, minutes = null, description = null, title = null }) {
  const entityId = type === ASK_ENTITY ? askEntityId(date) : conflictEntityId(date);
  const body = type === ASK_ENTITY ? askText(date) : conflictText({ date, minutes, title });
  const facts = [{ entity_id: entityId, field: FACT_DATE, value: date }];
  if (type === CONFLICT_ENTITY) {
    facts.push({ entity_id: entityId, field: FACT_MINUTES, value: String(minutes) });
    if (description) facts.push({ entity_id: entityId, field: FACT_DESCRIPTION, value: description });
  }
  return { question: { entity_type: type, entity_id: entityId, body, expires_at: iso(weeklyTimes(date, 0).runStart) }, facts };
}

// הכתיבה: פקודה אחת אטומית. gate (בתשובה בצ'אט): הכול מותנה בסגירת השאלה שנענתה (closed), כמו lib/vacation-ask.js; בלי gate (Cron): בלי תנאי.
// עדכון רק כשהשורה עדיין כמו שנקראה (כמו lib/garmin-apply.js). יצירה ושאלה עם NOT EXISTS. סגירת שאלה פתוחה שכבר לא רלוונטית: awaiting_reply=false בלי תשובה.
async function writeWeekly(sql, work, nowIso) {
  const gate = work.gate ?? null;
  const gated = gate !== null;
  const rows = rowsOf(await sql`
    /* weekly-runs-write */ WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${gate?.messageId ?? null}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = ${gate?.entityType ?? null}::text
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING id, reply_source_id, entity_type, entity_id
    ), ok AS (
      SELECT (NOT ${gated}::boolean OR EXISTS (SELECT 1 FROM closed)) AS go
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${gate?.answer ?? null}::text, NULL::text, now(), now()
      FROM closed
      RETURNING id
    ), upd AS (
      UPDATE events SET ends_at = u.ends_at::timestamptz, description = u.description
      FROM jsonb_to_recordset(${JSON.stringify(work.updates)}::jsonb) AS u(id text, starts_at text, ends_at text, description text, old_starts_at text, old_ends_at text, old_description text)
      WHERE (SELECT go FROM ok) AND events.id = u.id::uuid AND events.status = 'planned' AND events.starts_at = u.old_starts_at::timestamptz
        AND events.ends_at = u.old_ends_at::timestamptz AND COALESCE(events.description, '') = COALESCE(u.old_description, '')
      RETURNING events.id
    ), ins AS (
      INSERT INTO events (title, starts_at, ends_at, location, description, domain, movable, status, external_id, commitment_id, match_key)
      SELECT c.title, c.starts_at::timestamptz, c.ends_at::timestamptz, NULL::text, c.description, 'running', false, 'planned', NULL::text, NULL::uuid, c.match_key
      FROM jsonb_to_recordset(${JSON.stringify(work.creates)}::jsonb) AS c(title text, starts_at text, ends_at text, description text, match_key text)
      WHERE (SELECT go FROM ok) AND NOT EXISTS (SELECT 1 FROM events x WHERE x.match_key = c.match_key)
      RETURNING id
    ), ch AS (
      INSERT INTO changes (entity_type, entity_id, field, old_value, new_value, source_id, changed_at, changed_by)
      SELECT 'event', x.entity_id::uuid, x.field, x.old_value, x.new_value, NULL::uuid, ${nowIso}::timestamptz, 'system'
      FROM jsonb_to_recordset(${JSON.stringify(work.changes)}::jsonb) AS x(entity_id text, field text, old_value text, new_value text)
      WHERE x.entity_id::uuid IN (SELECT id FROM upd)
      RETURNING id
    ), shut AS (
      UPDATE messages SET awaiting_reply = false
      WHERE (SELECT go FROM ok) AND kind = 'question' AND awaiting_reply = true AND entity_type = ${ASK_ENTITY}::text
        AND entity_id IN (SELECT t.id::uuid FROM jsonb_array_elements_text(${JSON.stringify(work.closeAsks)}::jsonb) AS t(id))
      RETURNING id
    ), q AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', n.body, 'question', ${nowIso}::timestamptz, true, NULL::uuid, n.expires_at::timestamptz, n.entity_type, n.entity_id::uuid, 1
      FROM jsonb_to_recordset(${JSON.stringify(work.questions)}::jsonb) AS n(entity_type text, entity_id text, body text, expires_at text)
      WHERE (SELECT go FROM ok) AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.entity_type = n.entity_type AND x.entity_id = n.entity_id::uuid)
      RETURNING entity_id
    ), qf AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin)
      SELECT NULL::uuid, f.field, f.value, 'certain', 'script', ${FACT_ENTITY}::text, f.entity_id::uuid, 'read'
      FROM jsonb_to_recordset(${JSON.stringify(work.facts)}::jsonb) AS f(entity_id text, field text, value text)
      WHERE f.entity_id::uuid IN (SELECT entity_id FROM q)
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${work.bubble ?? null}::text, 'update', ${nowIso}::timestamptz, false, NULL::uuid, NULL::timestamptz, closed.entity_type, closed.entity_id, NULL::integer
      FROM closed WHERE ${work.bubble ?? null}::text IS NOT NULL
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id, (SELECT id FROM b) AS bubble_id,
      (SELECT count(*) FROM upd)::int AS updated, (SELECT count(*) FROM ins)::int AS created, (SELECT count(*) FROM q)::int AS questions,
      (SELECT count(*) FROM shut)::int AS asks_closed
  `);
  return rows[0] ?? {};
}

const emptyWork = () => ({ creates: [], updates: [], changes: [], questions: [], facts: [], closeAsks: [], keys: [], patchKeys: [] });
const addQuestion = (work, spec) => {
  const { question, facts } = questionOf(spec);
  work.questions.push(question);
  work.facts.push(...facts);
};

// אחרי כל משיכה (lib/ops/garmin-sync.js). fetchedAt = ה-fetched_at של המשיכה, או null כשהמשיכה נכשלה (אז שואלים בלבד).
// מחזיר { ok, created, updated, questions, push?, sync? } או { ok:false, reason }. לא זורק.
export async function applyWeeklyRuns({
  sql, now = new Date(), fetchedAt = null, googleDay = googleDayFromEnv({ sql }), syncEvents = syncEventsByMatchKeys, push = pushNow,
}) {
  try {
    const nowDate = new Date(toMs(now));
    const today = localDateIso(nowDate, TIME_ZONE);
    const last = addDays(today, WEEKLY_WINDOW_DAYS);
    const dates = [];
    for (let d = today; d <= last; d = addDays(d, 1)) if (isWeeklyDay(d)) dates.push(d);
    let items = [];
    if (fetchedAt !== null) {
      try {
        items = rowsOf(await sql`
          SELECT /* weekly-runs-items */ garmin_id, kind, item_date::text AS item_date, title, sport, duration_sec, starts_at, fetched_at
          FROM garmin_items WHERE kind = 'planned' AND item_date >= ${today}::date AND item_date <= ${last}::date
        `);
      } catch (error) {
        if (!isMissingTable(error)) throw error;
        items = []; // טבלה חסרה: כמו "אין אימון ב-Garmin"
      }
    }
    const events = rowsOf(await sql`
      SELECT /* weekly-runs-events */ id, title, starts_at, ends_at, description, status, match_key
      FROM events WHERE match_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(dates.flatMap((d) => [weeklyKey(d, 'run'), weeklyKey(d, 'prep')]))}::jsonb))
    `);
    const dateById = new Map(dates.flatMap((d) => [[askEntityId(d), d], [conflictEntityId(d), d]]));
    const askRows = rowsOf(await sql`
      SELECT /* weekly-runs-asks */ m.entity_type, m.entity_id::text AS entity_id, m.awaiting_reply, m.expires_at, s.raw_content AS answer
      FROM messages m LEFT JOIN sources s ON s.id = m.reply_source_id
      WHERE m.kind = 'question' AND m.entity_type IN (${ASK_ENTITY}::text, ${CONFLICT_ENTITY}::text)
        AND m.entity_id IN (SELECT t.id::uuid FROM jsonb_array_elements_text(${JSON.stringify([...dateById.keys()])}::jsonb) AS t(id))
    `).map((row) => ({ ...row, date: dateById.get(row.entity_id) ?? null }));

    const plan = planWeeklyRuns({ items, events, asks: askRows, now: nowDate, fetchedAt });
    const work = emptyWork();
    const openAsk = (date) => askRows.some((row) => row.date === date && row.entity_type === ASK_ENTITY && row.awaiting_reply === true);
    for (const date of plan.asks) addQuestion(work, { type: ASK_ENTITY, date });
    for (const c of plan.candidates) {
      const { prepStart, runEnd } = weeklyTimes(c.date, c.minutes);
      const hit = c.needsCheck ? await findConflict({ sql, date: c.date, fromMs: prepStart, toMs: runEnd, googleDay }) : null;
      if (openAsk(c.date)) work.closeAsks.push(askEntityId(c.date)); // Garmin הכריע: השאלה "יש ריצה?" כבר לא רלוונטית
      if (hit) {
        addQuestion(work, { type: CONFLICT_ENTITY, date: c.date, minutes: c.minutes, description: c.description, title: hit.title });
        continue;
      }
      if (c.action === 'create') {
        const rows = createRows(c.date, c.minutes, c.description);
        work.creates.push(...rows);
        work.keys.push(...rows.map((row) => row.match_key));
      } else {
        const { update, changes } = updateRow(c.row, c.minutes, c.description);
        work.updates.push(update);
        work.changes.push(...changes);
        work.keys.push(c.row.match_key);
        work.patchKeys.push(c.row.match_key);
      }
    }
    const result = { ok: true, created: 0, updated: 0, questions: 0 };
    if (work.creates.length + work.updates.length + work.questions.length + work.closeAsks.length === 0) return result;
    const written = await writeWeekly(sql, work, nowDate.toISOString());
    result.created = Number(written.created ?? 0);
    result.updated = Number(written.updated ?? 0);
    result.questions = Number(written.questions ?? 0);
    // הדחיפה המיידית של בלוק 5 (pushNow, lib/garmin-apply.js): מכבדת חלון "לא זמין" (deferIfQuiet ב-lib/chat-notify.js). רק כשנכתבה שאלה חדשה בפועל.
    if (result.questions > 0) result.push = (await push({ sql, now: nowDate, label: 'weekly-runs' })).sent ? 'sent' : 'not_sent';
    if (work.keys.length > 0) result.sync = await syncKeys({ sql, syncEvents, keys: work.keys, patchKeys: work.patchKeys, now: nowDate });
    return result;
  } catch (error) {
    console.error('weekly-runs: נכשל', error?.name);
    return { ok: false, reason: 'db_error' };
  }
}

async function syncKeys({ sql, syncEvents, keys, patchKeys, now }) {
  try {
    const synced = await syncEvents({ sql, keys: [...new Set(keys)], patchKeys: [...new Set(patchKeys)], now });
    if (synced?.reason || synced?.failed) console.error('weekly-runs: כתיבה ליומן לא הושלמה:', synced.reason ?? synced.last_failure ?? 'failed');
    return synced?.reason ?? (synced?.failed ? 'failed' : 'ok');
  } catch (error) {
    console.error('weekly-runs: הכתיבה ליומן קרסה', error?.name);
    return 'crashed';
  }
}

// תשובה לשאלה (api/chat.js, אחרי שאר השאלות שמחזירות closed). מחזיר { status: 'answered' | 'closed' | 'unclear', created, keys, patchKeys }.
//  - closed: השאלה לא קיימת, אינה של ריצה, כבר נסגרה, פגה, או נסגרה במקביל. לא נכתב כלום.
//  - unclear: תשובה שאינה "כן" / "לא". לא נכתב כלום.
//  - answered: פקודה אחת (writeWeekly עם gate). keys / patchKeys: לכתיבה ליומן Google אחרי התשובה (הקורא).
// "כן" לשאלה: בדיקת התנגשות, ואז ריצה של 60 דקות + התארגנות, או שאלת התנגשות. "כן" להתנגשות: נרשם בכל זאת, באורך שנשמר בשאלה.
// כשל מסד נזרק (api/chat.js מחזיר 500).
export async function answerWeeklyRun({ sql, messageId, answer, now = new Date(), googleDay }) {
  const nowIso = now.toISOString();
  const [ask] = rowsOf(await sql`
    SELECT /* weekly-runs-ask */ m.id, m.entity_type, m.awaiting_reply,
      (SELECT f.value FROM facts f WHERE f.entity_type = ${FACT_ENTITY}::text AND f.entity_id = m.entity_id AND f.field = ${FACT_DATE}::text LIMIT 1) AS run_date,
      (SELECT f.value FROM facts f WHERE f.entity_type = ${FACT_ENTITY}::text AND f.entity_id = m.entity_id AND f.field = ${FACT_MINUTES}::text LIMIT 1) AS minutes,
      (SELECT f.value FROM facts f WHERE f.entity_type = ${FACT_ENTITY}::text AND f.entity_id = m.entity_id AND f.field = ${FACT_DESCRIPTION}::text LIMIT 1) AS description
    FROM messages m
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type IN (${ASK_ENTITY}::text, ${CONFLICT_ENTITY}::text)
      AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
  `);
  const closed = { status: 'closed', created: {}, keys: [], patchKeys: [] };
  if (!ask || ask.awaiting_reply !== true) return closed;
  const text = typeof answer === 'string' ? answer.trim() : '';
  if (text !== YES && text !== NO) return { status: 'unclear', created: {}, keys: [], patchKeys: [] };
  const date = typeof ask.run_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ask.run_date) && isWeeklyDay(ask.run_date) ? ask.run_date : null;
  const work = emptyWork();
  work.gate = { messageId, entityType: ask.entity_type, answer: text };
  if (text === NO || date === null) {
    // [הנחה, לא אומת] שאלה בלי תאריך שמור (עובדה חסרה) נסגרת עם התשובה ולא יוצרת כלום.
    work.bubble = date === null ? null : (ask.entity_type === ASK_ENTITY ? noBubble(date) : 'נרשם. הריצה לא נרשמה.');
  } else {
    const [run] = rowsOf(await sql`
      SELECT /* weekly-runs-run */ id, title, starts_at, ends_at, description, status, match_key FROM events WHERE match_key = ${weeklyKey(date, 'run')}
    `);
    const minutes = ask.entity_type === CONFLICT_ENTITY && Number.parseInt(ask.minutes, 10) > 0 ? Number.parseInt(ask.minutes, 10) : DEFAULT_RUN_MINUTES;
    const description = ask.entity_type === CONFLICT_ENTITY ? textOrNull(ask.description) : null;
    if (run && ask.entity_type === ASK_ENTITY) {
      work.bubble = ALREADY_BUBBLE; // נוצרה בינתיים (Garmin): לא נוגעים
    } else if (run) {
      // "כן" להתנגשות על ריצה קיימת (הארכה): האורך שנשאל.
      if (run.status === 'planned') {
        const { update, changes } = updateRow(run, minutes, description ?? textOrNull(run.description));
        work.updates.push(update);
        work.changes.push(...changes);
        work.keys.push(run.match_key);
        work.patchKeys.push(run.match_key);
      }
      work.bubble = yesBubble(date, minutes);
    } else {
      const { prepStart, runEnd } = weeklyTimes(date, minutes);
      const hit = ask.entity_type === ASK_ENTITY ? await findConflict({ sql, date, fromMs: prepStart, toMs: runEnd, googleDay }) : null;
      if (hit) {
        addQuestion(work, { type: CONFLICT_ENTITY, date, minutes, description, title: hit.title });
        work.bubble = null; // שאלת ההתנגשות היא התשובה
      } else {
        const rows = createRows(date, minutes, description);
        work.creates.push(...rows);
        work.keys.push(...rows.map((row) => row.match_key));
        work.bubble = yesBubble(date, minutes);
      }
    }
  }
  const written = await writeWeekly(sql, work, nowIso);
  if (Number(written?.closed) === 0) return closed;
  return {
    status: 'answered',
    created: { answerSourceId: written?.answer_source_id ?? null, bubbleId: written?.bubble_id ?? null },
    keys: [...new Set(work.keys)],
    patchKeys: [...new Set(work.patchKeys)],
  };
}
