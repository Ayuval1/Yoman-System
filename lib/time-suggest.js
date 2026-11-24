// הצעת שעה למשימה אישית בלי שעה (בלוק 7, docs/01-foundation/אפיון-מורחב.md סעיף 6).
// מקורות: docs/02-rules/03-boundaries-rules.md כלל 10 ("10ב. המערכת שואלת עם הצעת חלון קונקרטית, 'רביעי 16:00?'. אחרי 'כן' נכתבת ביומן 'אישי'.
// 10ג. 'לא' או שתיקה: נשארת משימה. לא נכנסת ליומן בלי אישור."; "ההצעה בוחרת רק בזמן שאינו סגור לפי כללים 1–9");
// docs/01-foundation/01-system-overview.md, "הכרעות יובל על 8 השאלות של פתק 103", ש7 = ב': מיד, רגע אחרי שיובל כתב את המשימה.
//
// החלוקה (CLAUDE.md): הכול בקוד. הזמן הפנוי נגזר מכללי הגבולות, ממערכת השעות, מ-events ומ-Google (loadBusy ב-lib/free-check.js, קריאה בלבד).
// הכרטיס הוא שורת messages (entity_type='time_suggest') והעובדות שלו ב-facts לפי מזהה הכרטיס, בלי טבלה חדשה ובלי שינוי סכמה (כמו lib/weekly-runs.js).
//
// מה "כן" עושה: tasks.scheduled_at = תחילת המשבצת (העמודה קיימת בסכמה, "מתי המערכת שיבצה אותה בפועל"); due_at, תאריך היעד, לא משתנה.
// ושורת events (domain 'personal', מפתח 'source:task:<מזהה המשימה>') שנכתבת ליומן "אישי" בדרך הקיימת (lib/event-sync.js, syncEventsByMatchKeys).
//
// הכרעות טכניות, כולן [הנחה, לא אומת] ושקל להפוך (קבועים בראש הקובץ):
//  - אורך המשבצת: 60 דקות (כלל 9: לא יותר משעה רצוף). אין estimated_minutes למשימה אישית.
//  - מרחק: מהיום ועד תאריך היעד, ולכל היותר SEARCH_DAYS ימים. בלי תאריך יעד: לא מציעים (קודם נשאלת "עד מתי?").
//  - המשבצת הראשונה היא המוקדמת הפנויה. "שעה אחרת" מציגה את הבאה (עד MAX_OFFERS הצעות; משבצת ראשונה מכל יום קודם).
//  - היום עצמו: המשבצת מתחילה לפחות NOW_BUFFER_MINUTES אחרי עכשיו, בעיגול לחצי שעה.
//  - חלונות פתוחים לפי יום, מכללים 1 עד 8 ("נגזר, לא נאמר" ב-10): ראשון עד חמישי מ-15:00 או רבע שעה אחרי השיעור האחרון (כלל 1 ו-6; בלי מערכת שעות: 16:00),
//    עד 21:30 (כלל 5); ראשון בלי 17:00–17:45 (פיזיותרפיה); שלישי עד 17:00 (כלל 6, חוג); שישי 10:00–12:00 ו-16:00–21:30 (כלל 7); שבת 10:00–21:30 (כלל 8).
//    יום עם אימון או ריצה (תחום running): רק מהסגירה של כלל 1 עד 17:00 (כלל 3, שני ורביעי 16:00–17:00; דוגמת כלל 10ב "רביעי 16:00?"); אחרי ההתארגנות סגור (כלל 4).
//    יום חופש (יש מערכת שעות והיום אינו יום לימודים): מ-10:00.
//  - שעות בית הספר, חלון "לא זמין" ושאר האירועים: כמו בבדיקת "אני פנוי?" (loadBusy).
//  - ההצעה נשאלת פעם אחת למשימה (גם אחרי "לא"); הכרטיס פג בתחילת המשבצת המוצעת (כמו הצעת תוכנית, 03-analysis-rules.md).
//  - לפני "כן" נבדק שוב שהמשבצת פנויה. נתפסה: מציעים את הבאה.
// פרטיות: כותרת המשימה נשמרת רק ב-tasks, ב-body של הכרטיס והבועה, וב-events (מוצגים באפליקציה וביומן של יובל). לא בלוג.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי. הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה.
import { randomUUID } from 'node:crypto';
import { loadBusy, overlapping } from './free-check.js';
import { loadTimetable } from './timetable.js';
import { localDateIso, addDays, weekdayOf, formatDayMonth, parseIso, WEEKDAY_NAMES } from './intake-dates.js';
import { localParts, zonedToUtc } from './schedule-time.js';

const TIME_ZONE = 'Asia/Jerusalem';
const rowsOf = (result) => (Array.isArray(result) ? result : []);
const pad2 = (n) => String(n).padStart(2, '0');

export const TIME_SUGGEST_ENTITY = 'time_suggest';
export const YES = 'כן';
export const OTHER = 'שעה אחרת';
export const NO = 'לא';
export const TIME_SUGGEST_BUTTONS = Object.freeze([YES, OTHER, NO]);
export const SLOT_MINUTES = 60; // הנחה, לא אומת
export const SEARCH_DAYS = 7; // הנחה, לא אומת
export const MAX_OFFERS = 3; // הנחה, לא אומת
const NOW_BUFFER_MINUTES = 30; // הנחה, לא אומת
const GRID_MINUTES = 30;
const CLOSE_MINUTE = 21 * 60 + 30; // כלל 5א
const SCHOOL_BUFFER_MINUTES = 15; // כלל 1: רבע שעה אחרי השיעור האחרון
const DEFAULT_SCHOOL_DAY_OPEN = 16 * 60; // כלל 1: הסגירה המאוחרת בלוח (שני, רביעי, חמישי), כשאין מערכת שעות
const SHORT_DAY_OPEN = 15 * 60; // כלל 6
const FREE_DAY_OPEN = 10 * 60; // שישי (כלל 7), שבת (כלל 8) ויום חופש [הנחה, לא אומת]
const RUNNING_DOMAIN = 'running';
const TRAINING_DAY_CLOSE = 17 * 60; // כלל 3: ההתארגנות לאימון מ-17:00
// סגור קבוע לפי יום בשבוע (0 = ראשון): ראשון 17:00–17:45 פיזיותרפיה (כלל 6, כלל 1: ההפסקה עד 17:45); שלישי מ-17:00 חוג (כלל 6).
const FIXED_CLOSED = Object.freeze({ 0: [[17 * 60, 17 * 60 + 45]], 2: [[17 * 60, CLOSE_MINUTE]] });
const FRIDAY_WINDOWS = Object.freeze([[10 * 60, 12 * 60], [16 * 60, CLOSE_MINUTE]]); // כלל 7

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const clockOf = (minutes) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
const ceilToGrid = (minutes) => Math.ceil(minutes / GRID_MINUTES) * GRID_MINUTES;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const taskKey = (taskId) => `source:task:${taskId}`;

// ---------------------------------------------------------------------------
// חלונות ומשבצות (פונקציות טהורות)
// ---------------------------------------------------------------------------

function subtract(windows, closed) {
  let out = windows;
  for (const [from, to] of closed) {
    out = out.flatMap(([start, end]) => {
      if (to <= start || from >= end) return [[start, end]];
      return [...(from > start ? [[start, from]] : []), ...(to < end ? [[to, end]] : [])];
    });
  }
  return out;
}

// החלונות הפתוחים ביום, בדקות [[התחלה, סוף]]. busy: תוצאת loadBusy ({ items, timetable }).
export function openWindows({ dateIso, busy }) {
  const items = Array.isArray(busy?.items) ? busy.items : [];
  // יום בתוך אירוע אישי של כמה ימים (חופשה, טיול; lib/away.js): סגור להצעות. תוכנית למידה והצעת שעה למשימה נשענות על הפונקציה הזו.
  if (items.some((item) => item.away === true)) return [];
  const weekday = weekdayOf(dateIso);
  if (weekday === 5) return FRIDAY_WINDOWS.map(([from, to]) => [from, to]);
  if (weekday === 6) return [[FREE_DAY_OPEN, CLOSE_MINUTE]];
  const school = items.find((item) => item.domain === 'school');
  let open;
  if (school) open = Math.max(SHORT_DAY_OPEN, minutesOf(school.end) + SCHOOL_BUFFER_MINUTES);
  else open = busy?.timetable ? FREE_DAY_OPEN : DEFAULT_SCHOOL_DAY_OPEN;
  // יום עם אימון או ריצה (תחום running), 03-boundaries-rules.md כלל 3 (שורות 150-153: "ביום שיש בו אימון... מסוף הסגירה של כלל 1 ועד תחילת ההתארגנות... פתוח", שני ורביעי 16:00–17:00)
  // ודוגמת כלל 10ב (שורה 259, "רביעי 16:00?", רביעי הוא יום אימון). אחרי תחילת ההתארגנות (17:00) סגור: כלל 4 (שורות 164-168, ערב אחרי אימון סגור עד 21:30).
  // [הנחה, לא אומת] הסוף = הקטן מבין TRAINING_DAY_CLOSE ותחילת הפריט המוקדם של running; ביום כזה השעות הקבועות של כלל 6 לא חלות.
  const running = items.filter((item) => item.domain === RUNNING_DOMAIN).map((item) => minutesOf(item.start));
  if (running.length > 0) return [[open, Math.min(TRAINING_DAY_CLOSE, ...running)]].filter(([from, to]) => to > from);
  return subtract([[open, CLOSE_MINUTE]], FIXED_CLOSED[weekday] ?? []);
}

const hits = (item, from, to) => {
  const start = minutesOf(item.start);
  const end = minutesOf(item.end);
  return start === end ? start >= from && start < to : start < to && end > from;
};

// משבצות של SLOT_MINUTES בתוך החלונות, מעוגלות לחצי שעה, שלא חופפות לפריטים ולא מתחילות לפני earliest (דקות). [{ start, end }] (HH:MM).
export function freeSlots({ windows, items = [], earliest = 0 }) {
  const slots = [];
  for (const [from, to] of windows) {
    let cursor = ceilToGrid(Math.max(from, earliest));
    while (cursor + SLOT_MINUTES <= to) {
      const blocking = items.filter((item) => hits(item, cursor, cursor + SLOT_MINUTES));
      if (blocking.length === 0) {
        slots.push({ start: clockOf(cursor), end: clockOf(cursor + SLOT_MINUTES) });
        cursor += SLOT_MINUTES;
      } else {
        cursor = Math.max(ceilToGrid(Math.max(...blocking.map((item) => minutesOf(item.end)))), cursor + GRID_MINUTES);
      }
    }
  }
  return slots;
}

// ההצעות: המשבצת הראשונה מכל יום (לפי סדר הימים), ואם חסר, משבצות נוספות מאותם ימים. עד MAX_OFFERS. days: [{ date, slots }].
export function pickOffers(days) {
  const offers = [];
  for (const day of days) if (day.slots.length > 0 && offers.length < MAX_OFFERS) offers.push({ date: day.date, ...day.slots[0] });
  for (const day of days) {
    for (const slot of day.slots.slice(1)) if (offers.length < MAX_OFFERS) offers.push({ date: day.date, ...slot });
  }
  return offers;
}

// ---------------------------------------------------------------------------
// נוסח
// ---------------------------------------------------------------------------

const dayName = (date) => WEEKDAY_NAMES[weekdayOf(date)];
function dayLabel(date, today) {
  if (date === today) return 'היום';
  if (date === addDays(today, 1)) return 'מחר';
  return `${dayName(date)} ${formatDayMonth(date)}`;
}
export const suggestText = ({ title, date, start, today }) => `${title} — ${dayLabel(date, today)} ${start}?`;
const yesBubble = ({ title, date, start, end }) => `נקבע · ${title} · ${dayName(date)} ${formatDayMonth(date)} ${start}–${end}`;
const noBubble = (title) => `נשארת בלי שעה · ${title}`;
const noMoreBubble = (title) => `אין עוד חלונות פנויים · ${title} נשארת בלי שעה`;
const unknownBubble = (title) => `לא הצלחתי לבדוק את היומן עכשיו, נשאר בלי שעה · ${title}`;
const takenBubble = (title) => `החלון נתפס בינתיים · ${title}`;

// ---------------------------------------------------------------------------
// חיפוש
// ---------------------------------------------------------------------------

const instantOf = (date, hhmm) => zonedToUtc(date, hhmm, TIME_ZONE);

export const BUSY_TIMEOUT_MS = 6000; // הנחה, לא אומת: תקרת זמן כוללת לקריאת היומן; חריגה = Google לא נבדק

// קריאת הנתונים של כמה ימים במקביל, עם תקרת זמן אחת. { ok: true, busyByDate } או { ok: false, reason }.
// ok:false כש-Google לא נבדק באחד הימים (כשל, חסר הגדרות, או חריגת זמן): לעולם לא מציעים ולא מאשרים על נתונים חלקיים. כשל מסד נזרק.
export async function loadBusyDays({ sql, dates, timetable, googleDay, timeoutMs }) {
  let timer;
  const cap = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const loaded = await Promise.race([Promise.all(dates.map((dateIso) => loadBusy({ sql, dateIso, timetable, googleDay }))), cap]);
    if (loaded === 'timeout') return { ok: false, reason: 'timeout' };
    const partial = loaded.find((busy) => busy.google !== 'ok');
    if (partial) return { ok: false, reason: `google_${partial.google}` };
    return { ok: true, busyByDate: new Map(dates.map((date, index) => [date, loaded[index]])) };
  } finally {
    clearTimeout(timer);
  }
}

// הצעות לתאריך יעד: הימים נקראים במקביל (קריאה בלבד). { ok: false, reason } כשאין נתונים מלאים. כשל מסד נזרק.
async function findOffers({ sql, today, lastDate, now, timetable, googleDay, timeoutMs = BUSY_TIMEOUT_MS }) {
  const parts = localParts(now, TIME_ZONE);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const dates = [];
  for (let date = today; date <= lastDate; date = addDays(date, 1)) dates.push(date);
  const loaded = await loadBusyDays({ sql, dates, timetable, googleDay, timeoutMs });
  if (!loaded.ok) return loaded;
  const days = dates.map((date) => {
    const busy = loaded.busyByDate.get(date);
    const earliest = date === today ? ceilToGrid(nowMinutes + NOW_BUFFER_MINUTES) : 0;
    return { date, slots: freeSlots({ windows: openWindows({ dateIso: date, busy }), items: busy.items, earliest }) };
  });
  return { ok: true, offers: pickOffers(days) };
}

// האם המשבצת עדיין פנויה: 'free' | 'busy' | 'unknown' (Google לא נבדק או חריגת זמן). קריאה בלבד.
async function slotState({ sql, slot, timetable, googleDay, timeoutMs = BUSY_TIMEOUT_MS }) {
  const loaded = await loadBusyDays({ sql, dates: [slot.date], timetable, googleDay, timeoutMs });
  if (!loaded.ok) return 'unknown';
  const busy = loaded.busyByDate.get(slot.date);
  const from = minutesOf(slot.start);
  const to = minutesOf(slot.end);
  const inWindow = openWindows({ dateIso: slot.date, busy }).some(([start, end]) => start <= from && to <= end);
  return inWindow && overlapping(busy.items, slot.start, slot.end).length === 0 ? 'free' : 'busy';
}

// ---------------------------------------------------------------------------
// יצירה
// ---------------------------------------------------------------------------

const cardFacts = ({ taskId, offer, alts }) => [
  { field: 'task', value: taskId },
  { field: 'date', value: offer.date },
  { field: 'start', value: offer.start },
  { field: 'end', value: offer.end },
  { field: 'alts', value: JSON.stringify(alts) },
];

// מיד אחרי רישום משימה אישית (lib/intake-process.js recordTask) או אחרי "עד מתי?" (api/chat.js). task: { id, title, dueAt, timed }.
// מחזיר { created: true, messageId } או { created: false }. לא זורק לעולם: המשימה כבר נרשמה, וכשל כאן לא מבטל אותה (רק שם השגיאה בלוג).
export async function suggestTimeForTask({ sql, task, now = new Date(), timetable, googleDay, timeoutMs = BUSY_TIMEOUT_MS }) {
  try {
    if (!task || typeof task.id !== 'string' || !UUID.test(task.id) || task.timed === true || !task.dueAt) return { created: false };
    const due = new Date(task.dueAt);
    if (Number.isNaN(due.getTime())) return { created: false };
    const today = localDateIso(now, TIME_ZONE);
    const dueDate = localDateIso(due, TIME_ZONE);
    if (dueDate < today) return { created: false };
    const table = timetable === undefined ? await loadTimetable(sql) : timetable;
    const lastDate = [dueDate, addDays(today, SEARCH_DAYS - 1)].sort()[0];
    const found = await findOffers({ sql, today, lastDate, now, timetable: table, googleDay, timeoutMs });
    if (!found.ok) {
      console.error('time-suggest: היומן לא נבדק במלואו, אין הצעה:', found.reason); // קוד בלבד
      return { created: false };
    }
    const [offer, ...alts] = found.offers;
    if (!offer) return { created: false };
    // "עד מתי?" לא מחזיר כותרת (lib/personal-task.js answerTaskDue): נטענת כאן, רק אז.
    let rawTitle = task.title;
    if (typeof rawTitle !== 'string') [{ title: rawTitle } = {}] = rowsOf(await sql`SELECT /* time-suggest-title */ title FROM tasks WHERE id = ${task.id}::uuid`);
    const title = typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle.trim() : 'משימה';
    const cardId = randomUUID();
    const body = suggestText({ title, date: offer.date, start: offer.start, today });
    const expiresAt = instantOf(offer.date, offer.start).toISOString();
    const [row] = rowsOf(await sql`
      /* time-suggest-create */ WITH m AS (
        INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
        SELECT 'out', ${body}::text, 'question', now(), true, NULL::uuid, ${expiresAt}::timestamptz, ${TIME_SUGGEST_ENTITY}::text, ${cardId}::uuid, 1
        WHERE EXISTS (SELECT 1 FROM tasks t WHERE t.id = ${task.id}::uuid AND t.status = 'open' AND t.scheduled_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM facts p WHERE p.entity_type = ${TIME_SUGGEST_ENTITY}::text AND p.field = 'task' AND p.value = ${task.id}::text)
        RETURNING id
      ), f AS (
        INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin)
        SELECT NULL::uuid, x.field, x.value, 'certain', 'script', ${TIME_SUGGEST_ENTITY}::text, ${cardId}::uuid, 'read'
        FROM jsonb_to_recordset(${JSON.stringify(cardFacts({ taskId: task.id, offer, alts }))}::jsonb) AS x(field text, value text)
        WHERE EXISTS (SELECT 1 FROM m)
        RETURNING id
      )
      SELECT (SELECT id FROM m) AS message_id
    `);
    return row?.message_id ? { created: true, messageId: row.message_id } : { created: false };
  } catch (error) {
    console.error('time-suggest: יצירת ההצעה נכשלה:', error?.name);
    return { created: false };
  }
}

// ---------------------------------------------------------------------------
// תשובה
// ---------------------------------------------------------------------------

function parseAlts(value) {
  try {
    const list = JSON.parse(value);
    return (Array.isArray(list) ? list : []).filter((slot) => ISO_DAY.test(slot?.date) && HHMM.test(slot?.start) && HHMM.test(slot?.end));
  } catch {
    return [];
  }
}

const validDate = (value) => {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return false;
  try {
    parseIso(value);
    return true;
  } catch {
    return false;
  }
};

// פעולה אחת אטומית, מותנית בסגירת הכרטיס שנענה (כמו lib/weekly-runs.js writeWeekly): סגירה, שורת התשובה, שעת המשימה, האירוע, הכרטיס הבא והבועה.
async function writeAnswer(sql, work, nowIso) {
  const next = work.next ?? null;
  const rows = rowsOf(await sql`
    /* time-suggest-write */ WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${work.messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = ${TIME_SUGGEST_ENTITY}::text
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING id, reply_source_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${work.answer}::text, NULL::text, now(), now() FROM closed
      RETURNING id
    ), upd AS (
      UPDATE tasks SET scheduled_at = ${work.startsAt}::timestamptz
      WHERE ${work.startsAt}::text IS NOT NULL AND id = ${work.taskId}::uuid AND status = 'open' AND EXISTS (SELECT 1 FROM closed)
      RETURNING id
    ), ev AS (
      INSERT INTO events (title, starts_at, ends_at, location, description, domain, movable, status, external_id, commitment_id, match_key)
      SELECT ${work.title}::text, ${work.startsAt}::timestamptz, ${work.endsAt}::timestamptz, NULL::text, NULL::text, 'personal', NULL::boolean, 'planned', NULL::text, NULL::uuid, ${work.key}::text
      FROM upd
      WHERE NOT EXISTS (SELECT 1 FROM events x WHERE x.match_key = ${work.key}::text)
      RETURNING id
    ), q AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${next?.body ?? null}::text, 'question', now(), true, NULL::uuid, ${next?.expiresAt ?? null}::timestamptz, ${TIME_SUGGEST_ENTITY}::text, ${next?.cardId ?? null}::uuid, 1
      FROM closed WHERE ${next?.body ?? null}::text IS NOT NULL
      RETURNING id
    ), qf AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin)
      SELECT NULL::uuid, x.field, x.value, 'certain', 'script', ${TIME_SUGGEST_ENTITY}::text, ${next?.cardId ?? null}::uuid, 'read'
      FROM jsonb_to_recordset(${JSON.stringify(next?.facts ?? [])}::jsonb) AS x(field text, value text)
      WHERE EXISTS (SELECT 1 FROM q)
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${work.bubble ?? null}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'task', ${work.taskId}::uuid, NULL::integer
      FROM closed WHERE ${work.bubble ?? null}::text IS NOT NULL
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id, (SELECT id FROM b) AS bubble_id,
      (SELECT count(*) FROM ev)::int AS events
  `);
  return rows[0] ?? {};
}

// תשובה לכרטיס (api/chat.js, אחרי שאר השאלות שמחזירות closed). מחזיר { status: 'answered' | 'closed' | 'unclear', created, keys, patchKeys }.
//  - closed: הכרטיס לא קיים, כבר נסגר, פג, או נסגר בלחיצה מקבילה. לא נכתב כלום.
//  - unclear: תשובה שאינה אחד הכפתורים. לא נכתב כלום.
//  - answered: פקודה אחת (writeAnswer). keys: האירוע שנכתב, לכתיבה ליומן Google אחרי התשובה (הקורא).
// כשל מסד נזרק (api/chat.js מחזיר 500).
export async function answerTimeSuggest({ sql, messageId, answer, now = new Date(), timetable, googleDay }) {
  const nowIso = now.toISOString();
  const closed = { status: 'closed', created: {}, keys: [], patchKeys: [] };
  const [ask] = rowsOf(await sql`
    SELECT /* time-suggest-ask */ m.id, m.awaiting_reply, m.entity_id AS card_id,
      (SELECT f.value FROM facts f WHERE f.entity_type = ${TIME_SUGGEST_ENTITY}::text AND f.entity_id = m.entity_id AND f.field = 'task' LIMIT 1) AS task_id,
      (SELECT f.value FROM facts f WHERE f.entity_type = ${TIME_SUGGEST_ENTITY}::text AND f.entity_id = m.entity_id AND f.field = 'date' LIMIT 1) AS slot_date,
      (SELECT f.value FROM facts f WHERE f.entity_type = ${TIME_SUGGEST_ENTITY}::text AND f.entity_id = m.entity_id AND f.field = 'start' LIMIT 1) AS slot_start,
      (SELECT f.value FROM facts f WHERE f.entity_type = ${TIME_SUGGEST_ENTITY}::text AND f.entity_id = m.entity_id AND f.field = 'end' LIMIT 1) AS slot_end,
      (SELECT f.value FROM facts f WHERE f.entity_type = ${TIME_SUGGEST_ENTITY}::text AND f.entity_id = m.entity_id AND f.field = 'alts' LIMIT 1) AS alts
    FROM messages m
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type = ${TIME_SUGGEST_ENTITY}::text
      AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
  `);
  if (!ask || ask.awaiting_reply !== true) return closed;
  const text = typeof answer === 'string' ? answer.trim() : '';
  if (!TIME_SUGGEST_BUTTONS.includes(text)) return { status: 'unclear', created: {}, keys: [], patchKeys: [] };

  const slot = { date: ask.slot_date, start: ask.slot_start, end: ask.slot_end };
  const slotValid = validDate(slot.date) && HHMM.test(slot.start ?? '') && HHMM.test(slot.end ?? '');
  const taskId = typeof ask.task_id === 'string' && UUID.test(ask.task_id) ? ask.task_id : null;
  const [taskRow] = taskId ? rowsOf(await sql`SELECT /* time-suggest-task */ id, title, status FROM tasks WHERE id = ${taskId}::uuid`) : [];
  const work = { messageId, answer: text, taskId, title: null, startsAt: null, endsAt: null, key: null, bubble: null, next: null };
  if (!taskRow || taskRow.status !== 'open' || !slotValid) {
    // משימה שנסגרה (בוצעה, בוטלה) או כרטיס פגום: הכרטיס נסגר, בלי אירוע ובלי בועה.
    work.taskId = taskId ?? randomUUID();
    return finish(sql, work, nowIso);
  }
  const title = typeof taskRow.title === 'string' && taskRow.title.trim() !== '' ? taskRow.title.trim() : 'משימה';
  const today = localDateIso(now, TIME_ZONE);
  work.title = title;
  let moveOn = text === OTHER;
  let taken = false;
  if (text === NO) {
    work.bubble = noBubble(title);
  } else if (text === YES) {
    const table = timetable === undefined ? await loadTimetable(sql) : timetable;
    const future = instantOf(slot.date, slot.start).getTime() > now.getTime();
    const state = future ? await slotState({ sql, slot, timetable: table, googleDay }) : 'busy';
    if (state === 'unknown') {
      work.bubble = unknownBubble(title); // לא מאשרים על נתונים חלקיים: בלי כתיבה, נשארת בלי שעה
    } else if (state === 'free') {
      work.startsAt = instantOf(slot.date, slot.start).toISOString();
      work.endsAt = instantOf(slot.date, slot.end).toISOString();
      work.key = taskKey(taskId);
      work.bubble = yesBubble({ title, ...slot });
    } else {
      moveOn = true;
      taken = true;
    }
  }
  if (moveOn) {
    // ההצעה הבאה מהחלופות ששמורות בכרטיס; משבצת שכבר עברה מדולגת. אין עוד: הבועה אומרת, והמשימה נשארת בלי שעה.
    const rest = parseAlts(ask.alts).filter((alt) => instantOf(alt.date, alt.start).getTime() > now.getTime());
    const [offer, ...alts] = rest;
    if (offer) {
      const cardId = randomUUID();
      work.next = {
        cardId, body: suggestText({ title, date: offer.date, start: offer.start, today }), expiresAt: instantOf(offer.date, offer.start).toISOString(),
        facts: cardFacts({ taskId, offer, alts }),
      };
      work.bubble = taken ? takenBubble(title) : null;
    } else {
      work.bubble = noMoreBubble(title);
    }
  }
  return finish(sql, work, nowIso);
}

async function finish(sql, work, nowIso) {
  const written = await writeAnswer(sql, work, nowIso);
  if (Number(written?.closed) === 0) return { status: 'closed', created: {}, keys: [], patchKeys: [] };
  return {
    status: 'answered',
    created: { answerSourceId: written?.answer_source_id ?? null, bubbleId: written?.bubble_id ?? null },
    keys: work.key && Number(written?.events) > 0 ? [work.key] : [],
    patchKeys: [],
  };
}

// משימה שנסגרה (בוצעה או בוטלה): אירוע ההצעה שלה (source:task:<id>) שעדיין בעתיד נהפך ל-cancelled, ומחזיר את המפתח לסנכרון ליומן Google
// (lib/event-sync.js: שורה cancelled ששעת סופה בעתיד נמחקת מ-Google, גם בסריקה היומית; 404 / 410 = הצלחה). משבצת שכבר התחילה נשארת כהיסטוריה.
// פקודה נפרדת אחרי עדכון המשימה (עדכוני ה-done הקיימים נשארים כמו שהם), אידמפוטנטית ומותנית בכך שהמשימה אכן done / cancelled.
// [הנחה, לא אומת] אין עטיפה בטרנזקציה אחת; אם הפקודה הזו נכשלת, האירוע נשאר מתוכנן. לא זורק: { keys: [] } בכשל, ושם השגיאה בלוג.
export async function cancelTaskEvent({ sql, taskId }) {
  if (typeof taskId !== 'string' || !UUID.test(taskId)) return { keys: [] };
  try {
    const key = taskKey(taskId);
    const rows = rowsOf(await sql`
      /* time-suggest-cancel */ UPDATE events SET status = 'cancelled'
      WHERE match_key = ${key}::text AND status = 'planned' AND starts_at > now()
        AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = ${taskId}::uuid AND t.status IN ('done', 'cancelled'))
      RETURNING match_key
    `);
    return { keys: rows.length > 0 ? [key] : [] };
  } catch (error) {
    console.error('time-suggest: ביטול אירוע המשימה נכשל:', error?.name);
    return { keys: [] };
  }
}
