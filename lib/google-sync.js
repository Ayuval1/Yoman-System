// סנכרון Google -> האפליקציה (הכרעת יובל 28.11.2026). קוד בלבד, והמוח רק לסיווג.
// מה נעשה לבד: יבוא אירוע עתידי חדש מהיומן הראשי (סנכרון ראשון: רק עתידיים), סיווג, והעברה ליומן של התחום (CALENDAR_BY_DOMAIN).
// מה נשאל: סיווג לא ברור -> כרטיס שאלה אחד לכל הסנכרון, עם רשימה של כל הלא-ברורים. תשובה נענית פריט אחר פריט (itemId).
// שינוי או מחיקה של אירוע שהאפליקציה כבר מכירה: שקט, לפי הכרעת יובל 28.11.2026 (עדכון שמור ב-03-permissions-rules.md טרם אושר ידנית, ראו הדוח).
//   שינוי שעה או כותרת: עדכון השורה. מחיקה: status cancelled (match_key = gcal-cancelled:<G>). לא נכתב ליומן Google.
// לולאה: אירוע שהאפליקציה כתבה (מזהה hex = events.id, או external_id מוכר) לא מיובא. העברה שלנו מסומנת ב-match_key:
//   gcal-pending:<G> (טרם הועבר) -> gcal-moving:<G> (נכתב ליומן היעד, הראשי עוד לא נמחק) -> gcal-moved:<G> (הושלם).
//   מחיקה של G מהראשי שמגיעה אחרי gcal-moving / gcal-moved נחשבת לעצמנו ומתעלמים ממנה. gcal-kept:<G> = יובל בחר להשאיר בראשי.
// idempotency: מזהה האירוע במסד נגזר מ-Google id (md5), ו-INSERT ... ON CONFLICT (id) DO NOTHING; הכתיבה ליומן היעד עם מזהה קבוע (409 = הצלחה);
//   המחיקה מהראשי: 404/410 = הצלחה. שתי ריצות מקבילות לא יוצרות שתי שורות.
// token: google_watch_channels.sync_token בשורת הערוץ הפעיל החדש ביותר של היומן הראשי. 410 = נופלים לסנכרון מלא מעכשיו (idempotent).
// פרטיות: לוגים ו-probe_log רק עם ספירות וקודי סיבה. לא כותרות, לא שעות, לא מזהים.
import { createHash } from 'node:crypto';
import { askBrain } from './brain/ask.js';
import { CALENDAR_BY_DOMAIN, connect, eventBody, googleEventIdFor, resolveCalendarId } from './event-sync.js';
import {
  deleteCalendarEvent, getPrimaryCalendarId, insertCalendarEvent, isAppSeriesEvent, listCalendarChanges, googleConfigFromEnv,
} from './google.js';
import { WEEKDAY_NAMES, weekdayOf } from './intake-dates.js';
import { localParts, zonedToUtc } from './schedule-time.js';

const TIME_ZONE = 'Asia/Jerusalem';
export const UNCLEAR_ENTITY = 'google_unclear';
// מזהה קבוע לכרטיס הפתוח (לא נגזר בזמן טעינה: chat-view מייבא את המודול הזה, ו-brief-view מייבא את chat-view).
export const UNCLEAR_CARD_ID = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
export const KEPT_BUTTON = 'להשאיר ביומן הראשי';
const BUTTON_DOMAIN = Object.freeze({ 'בית ספר': 'school', 'ריצה': 'running', 'לימוד': 'study', 'אישי': 'personal' });
export const UNCLEAR_BUTTONS = Object.freeze(['בית ספר', 'ריצה', 'לימוד', 'אישי', KEPT_BUTTON]);
const DOMAINS = Object.freeze(Object.keys(CALENDAR_BY_DOMAIN));
export const MATCH = Object.freeze({ pending: 'gcal-pending:', moving: 'gcal-moving:', moved: 'gcal-moved:', kept: 'gcal-kept:', cancelled: 'gcal-cancelled:' });
const STATE_BY_PREFIX = Object.freeze({ 'gcal-pending': 'pending', 'gcal-moving': 'moving', 'gcal-moved': 'moved', 'gcal-kept': 'kept', 'gcal-cancelled': 'cancelled' });
const GOOGLE_ID = /^[0-9a-v]{5,1024}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TITLE_FALLBACK = 'אירוע';
const DEFAULT_TIMED_MINUTES = 60; // הנחה, לא אומת: אירוע עם שעת התחלה בלי סוף מקבל שעה
const BRAIN_TIMEOUT_MS = 6000;
const NOT_CONNECTED = Object.freeze(['config_missing', 'not_connected']);

const uuidFromHex = (hex) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;

// מזהה השורה במסד לאירוע שמיובא מ-Google: נגזר מהמזהה של Google, כך שריצה כפולה לא יוצרת שורה שנייה.
export function importedEventId(googleId) {
  const hex = createHash('md5').update(`gcal:${googleId}`).digest('hex');
  return uuidFromHex(hex);
}

// אם המזהה של Google הוא מזהה שהאפליקציה כתבה (googleEventIdFor = events.id בלי מקפים), מחזירים את ה-uuid שלו; אחרת null.
export function ownGoogleEventId(googleId) {
  return HEX32.test(googleId) ? uuidFromHex(googleId) : null;
}

const pad2 = (n) => String(n).padStart(2, '0');

// שעות האירוע כ-ISO. אירוע עם שעה: dateTime. אירוע של יום שלם / כמה ימים: date, ב-00:00 שעון ישראל.
export function itemTimes(item) {
  try {
    if (typeof item?.start?.dateTime === 'string') {
      const startMs = Date.parse(item.start.dateTime);
      if (Number.isNaN(startMs)) return null;
      const endMs = typeof item?.end?.dateTime === 'string' && !Number.isNaN(Date.parse(item.end.dateTime))
        ? Date.parse(item.end.dateTime) : startMs + DEFAULT_TIMED_MINUTES * 60000;
      return { startsIso: new Date(startMs).toISOString(), endsIso: new Date(endMs).toISOString(), startMs, allDay: false, startDate: null };
    }
    if (typeof item?.start?.date === 'string' && typeof item?.end?.date === 'string') {
      const startMs = zonedToUtc(item.start.date, '00:00', TIME_ZONE).getTime();
      const endMs = zonedToUtc(item.end.date, '00:00', TIME_ZONE).getTime();
      if (endMs <= startMs) return null;
      return { startsIso: new Date(startMs).toISOString(), endsIso: new Date(endMs).toISOString(), startMs, allDay: true, startDate: item.start.date };
    }
  } catch {
    return null; // תאריך לא תקין: מדלגים, בלי לזרוק
  }
  return null;
}

// מפתח match_key -> { state, gid }. מחזיר null לכל מפתח שאינו של סנכרון Google.
export function parseMatchKey(matchKey) {
  if (typeof matchKey !== 'string') return null;
  const colon = matchKey.indexOf(':');
  if (colon < 0) return null;
  const state = STATE_BY_PREFIX[matchKey.slice(0, colon)];
  const gid = matchKey.slice(colon + 1);
  return state && GOOGLE_ID.test(gid) ? { state, gid } : null;
}

// סיווג מהמוח. בלי מפתח, או כשל, או ערך שאינו מתחום מוכר: null (= לא ברור). הערך נבדק שוב בקוד בכל מקום שנכתב.
export const validDomain = (value) => (DOMAINS.includes(value) ? value : null);
const isDomainData = (data) => data !== null && typeof data === 'object' && typeof data.domain === 'string';
function buildPrompt(title, startsAt) {
  return [
    'סווג אירוע יומן של נער לאחד מהתחומים בלבד: school (שיעור או דבר של בית הספר), running (אימון או תחרות ריצה),',
    'study (לימוד עצמאי), personal (כל דבר אחר שהוא אישי). אם לא ברור, החזר "unclear".',
    'החזר JSON בלבד בצורה {"domain":"..."}.',
    `כותרת: ${title}`,
    `זמן: ${startsAt}`,
  ].join('\n');
}
export async function classifyWithBrain({ sql, title, startsAt, now = new Date(), fetchFn = fetch, apiKey = process.env.GEMINI_API_KEY }) {
  if (!apiKey) return null;
  try {
    const result = await askBrain({ sql, fetchFn, apiKey, now, prompt: buildPrompt(title, startsAt), schema: isDomainData, timeoutMs: BRAIN_TIMEOUT_MS });
    return result?.ok ? validDomain(result.data?.domain) : null;
  } catch (error) {
    console.error('google-sync: סיווג נכשל', error?.name);
    return null;
  }
}

// שורות gcal של כל האירועים שהמערכת מכירה (מיובאים בלבד). מפתח: מזהה Google.
async function loadGcalRows(sql) {
  const rows = await sql`SELECT id, external_id, match_key, domain, status, title, starts_at, ends_at FROM events WHERE match_key LIKE 'gcal-%'`;
  const map = new Map();
  for (const row of rows) {
    const parsed = parseMatchKey(row.match_key);
    if (parsed) map.set(parsed.gid, { ...row, state: parsed.state, gid: parsed.gid });
  }
  return map;
}

// שורת הכרטיס: תאריך ושעה לפי שעון ישראל, כמו בשאר המערכת.
function describeItem(row) {
  const parts = localParts(new Date(row.starts_at), TIME_ZONE);
  const iso = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  const day = `יום ${WEEKDAY_NAMES[weekdayOf(iso)]} ${pad2(parts.day)}.${pad2(parts.month)}`;
  // יום שלם = התחלה ב-00:00 (כמו ב-allDayDates ב-event-sync)
  const allDay = parts.hour === 0 && parts.minute === 0;
  const when = allDay ? `${day} (כל היום)` : `${day} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
  return `'${row.title ?? TITLE_FALLBACK}', ${when}`;
}

// כרטיס שאלה אחד לכל הסנכרון: רשימה של כל הלא-ברורים. פעם אחת פתוח; כל ריצה מרעננת את הרשימה.
async function ensureUnclearCard(sql, rows) {
  if (rows.length === 0) return false;
  const body = `ראיתי ביומן Google ${rows.length === 1 ? 'אירוע' : 'אירועים'} שלא ברור לי מה הם. מה כל אחד מהם?\n${rows.map((r) => `• ${describeItem(r)}`).join('\n')}`;
  const updated = await sql`
    UPDATE messages SET body = ${body}::text WHERE entity_type = ${UNCLEAR_ENTITY}::text AND entity_id = ${UNCLEAR_CARD_ID}::uuid AND awaiting_reply = true RETURNING id
  `;
  if (updated.length > 0) return true;
  const inserted = await sql`
    INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
    SELECT 'out', ${body}::text, 'question', now(), true, NULL::uuid, NULL::timestamptz, ${UNCLEAR_ENTITY}::text, ${UNCLEAR_CARD_ID}::uuid, 1
    WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.entity_type = ${UNCLEAR_ENTITY}::text AND x.entity_id = ${UNCLEAR_CARD_ID}::uuid AND x.awaiting_reply = true)
    RETURNING id
  `;
  return inserted.length > 0;
}

// העברה של שורה אחת מהראשי ליומן התחום. שלושה צעדים, כל אחד אידמפוטנטי (ראו הכותרת). מחזיר { ok, reason? }.
async function moveRow(sql, row, ctx) {
  const target = resolveCalendarId(ctx.calendars, CALENDAR_BY_DOMAIN[row.domain]);
  if (!target.ok) return { ok: false, reason: target.reason };
  const eventId = googleEventIdFor(row.id);
  if (!eventId) return { ok: false, reason: 'bad_event_id' };
  if (row.state === 'pending') {
    const created = await insertCalendarEvent({
      accessToken: ctx.accessToken, calendarId: target.calendarId, eventId, event: eventBody({ title: row.title, starts_at: row.starts_at, ends_at: row.ends_at, domain: row.domain }), fetchFn: ctx.fetchFn,
    });
    if (!created.ok) return { ok: false, reason: created.reason };
    const claimed = await sql`
      UPDATE events SET external_id = ${eventId}, match_key = ${MATCH.moving + row.gid} WHERE id = ${row.id}::uuid AND match_key = ${MATCH.pending + row.gid} RETURNING id
    `;
    if (claimed.length === 0) return { ok: false, reason: 'claimed_elsewhere' };
    row.state = 'moving';
  }
  const deleted = await deleteCalendarEvent({ accessToken: ctx.accessToken, calendarId: ctx.primaryId, eventId: row.gid, fetchFn: ctx.fetchFn });
  if (!deleted.ok) return { ok: false, reason: deleted.reason };
  await sql`UPDATE events SET match_key = ${MATCH.moved + row.gid} WHERE id = ${row.id}::uuid AND match_key = ${MATCH.moving + row.gid}`;
  row.state = 'moved';
  return { ok: true };
}

// הסנכרון עצמו. מחזיר { ok, mode?, imported, moved, cards, updated, cancelled, skipped?, reason? }. לא זורק על כשל צפוי.
export async function syncPrimaryCalendar({ sql, config, fetchFn = fetch, nowMs = Date.now(), calendarId = null, classify = classifyWithBrain }) {
  const counts = { imported: 0, moved: 0, cards: 0, updated: 0, cancelled: 0 };
  try {
    const conn = await connect({ sql, config, fetchFn, label: 'google-sync' });
    if (!conn.ok) return { ok: false, reason: conn.reason, ...counts };
    const primary = await getPrimaryCalendarId({ accessToken: conn.accessToken, fetchImpl: fetchFn });
    if (!primary.ok) return { ok: false, reason: primary.reason, ...counts };
    const primaryId = primary.calendarId;
    if (calendarId !== null && calendarId !== primaryId) return { ok: true, skipped: 'not_primary', ...counts };

    const [channel] = await sql`SELECT id, sync_token FROM google_watch_channels WHERE calendar_id = ${primaryId} AND stopped_at IS NULL ORDER BY created_at DESC LIMIT 1`;
    if (!channel) return { ok: false, reason: 'no_channel', ...counts };

    const now = new Date(nowMs);
    const timeMin = now.toISOString();
    let mode = channel.sync_token ? 'incremental' : 'initial';
    let listed = await listCalendarChanges({ accessToken: conn.accessToken, calendarId: primaryId, syncToken: channel.sync_token ?? null, timeMin, fetchImpl: fetchFn });
    if (!listed.ok && listed.gone) {
      mode = 'full';
      listed = await listCalendarChanges({ accessToken: conn.accessToken, calendarId: primaryId, syncToken: null, timeMin, fetchImpl: fetchFn });
    }
    if (!listed.ok) return { ok: false, reason: listed.reason, mode, ...counts };

    const gcal = await loadGcalRows(sql);
    const ctx = { accessToken: conn.accessToken, calendars: conn.calendars, primaryId, fetchFn };
    for (const raw of listed.items) {
      const gid = raw.id;
      if (!GOOGLE_ID.test(gid)) continue;
      const known = gcal.get(gid);
      if (known) {
        // עברנו בעצמנו: המחיקה מהראשי היא תוצאה של ההעברה, לא שינוי של יובל. מתעלמים.
        if (known.state === 'moving' || known.state === 'moved' || known.state === 'cancelled') continue;
        if (raw.status === 'cancelled') {
          await sql`UPDATE events SET status = 'cancelled', match_key = ${MATCH.cancelled + gid} WHERE id = ${known.id}::uuid AND match_key = ${known.match_key}`;
          known.state = 'cancelled';
          counts.cancelled += 1;
          continue;
        }
        // שינוי שעה או כותרת ביומן הראשי: מעדכנים את השורה, בשקט (הכרעת יובל 28.11).
        const changed = itemTimes(raw);
        const newTitle = typeof raw.summary === 'string' && raw.summary.trim() !== '' ? raw.summary.trim() : TITLE_FALLBACK;
        if (changed && (newTitle !== known.title || Date.parse(known.starts_at) !== changed.startMs || Date.parse(known.ends_at) !== Date.parse(changed.endsIso))) {
          await sql`UPDATE events SET title = ${newTitle}, starts_at = ${changed.startsIso}::timestamptz, ends_at = ${changed.endsIso}::timestamptz WHERE id = ${known.id}::uuid AND match_key = ${known.match_key}`;
          Object.assign(known, { title: newTitle, starts_at: changed.startsIso, ends_at: changed.endsIso });
          counts.updated += 1;
        }
        continue;
      }
      if (raw.status === 'cancelled' || isAppSeriesEvent(raw)) continue;
      const ownId = ownGoogleEventId(gid);
      const [owned] = await sql`SELECT id FROM events WHERE id = ${ownId}::uuid OR external_id = ${gid}`;
      if (owned) continue;
      const times = itemTimes(raw);
      if (!times || times.startMs < nowMs) continue; // רק עתידיים
      const title = typeof raw.summary === 'string' && raw.summary.trim() !== '' ? raw.summary.trim() : TITLE_FALLBACK;
      const domain = validDomain(await classify({ sql, title, startsAt: times.startsIso, now, fetchFn }));
      const id = importedEventId(gid);
      const inserted = await sql`
        INSERT INTO events (id, title, starts_at, ends_at, domain, movable, status, external_id, match_key)
        VALUES (${id}::uuid, ${title}, ${times.startsIso}::timestamptz, ${times.endsIso}::timestamptz, ${domain}, NULL, 'planned', ${gid}, ${MATCH.pending + gid})
        ON CONFLICT (id) DO NOTHING RETURNING id
      `;
      if (inserted.length === 0) continue;
      counts.imported += 1;
      gcal.set(gid, { id, state: 'pending', gid, domain, title, starts_at: times.startsIso, ends_at: times.endsIso, external_id: gid, match_key: MATCH.pending + gid });
    }

    // סריקה: כל מה שממתין להעברה (גם מהפעם הקודמת, אם נכשל), ושאלה לכל הלא-ברורים.
    const unclear = [];
    for (const row of gcal.values()) {
      if (row.state !== 'pending' && row.state !== 'moving') continue;
      if (row.state === 'pending' && row.domain === null) { unclear.push(row); continue; }
      const moved = await moveRow(sql, row, ctx);
      if (moved.ok) counts.moved += 1;
    }
    if (await ensureUnclearCard(sql, unclear)) counts.cards = 1;

    await sql`UPDATE google_watch_channels SET sync_token = ${listed.nextSyncToken} WHERE id = ${channel.id}`;
    return { ok: true, mode, ...counts };
  } catch (error) {
    console.error('google-sync: סנכרון נכשל', error?.name);
    return { ok: false, reason: 'db_error', ...counts };
  }
}

// עטיפה לקריאות מהווב-הוק ומה-Cron: לעולם לא זורקת, וכותבת ל-probe_log רק כשיש שינוי או כשל (ספירות בלבד).
export async function syncAndLog({ sql, config = googleConfigFromEnv(), fetchFn = fetch, nowMs = Date.now(), calendarId = null, classify = classifyWithBrain }) {
  let result;
  try {
    result = await syncPrimaryCalendar({ sql, config, fetchFn, nowMs, calendarId, classify });
  } catch (error) {
    console.error('google-sync: קריאה נכשלה', error?.name);
    result = { ok: false, reason: 'crashed', imported: 0, moved: 0, cards: 0, updated: 0, cancelled: 0 };
  }
  const changed = result.imported + result.moved + result.cards + result.updated + result.cancelled > 0;
  if (result.skipped === undefined && (changed || (!result.ok && !NOT_CONNECTED.includes(result.reason)))) {
    const detail = `mode=${result.mode ?? '-'} imported=${result.imported} moved=${result.moved} cards=${result.cards} updated=${result.updated} cancelled=${result.cancelled}${result.reason ? ` reason=${result.reason}` : ''}`;
    try {
      await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('google-sync', ${result.ok === true}, ${detail})`;
    } catch (error) {
      console.error('google-sync: כתיבה ל-probe_log נכשלה', error?.name);
    }
  }
  return result;
}

// תשובה לפריט בכרטיס (api/chat.js). { status: 'answered' | 'closed' | 'unclear', created, keys, patchKeys }.
// itemId = מזהה השורה ב-events. ההעברה ליומן מנסים מיד; כשלה - הסנכרון הבא ינסה שוב (מצב moving/pending נשמר).
export async function answerGoogleUnclear({ sql, messageId, itemId = null, answer, now = new Date(), config = googleConfigFromEnv(), fetchFn = fetch }) {
  const closed = { status: 'closed', created: {}, keys: [], patchKeys: [] };
  const unclearResult = { status: 'unclear', created: {}, keys: [], patchKeys: [] };
  const nowIso = now.toISOString();
  const [card] = await sql`
    SELECT m.id, m.awaiting_reply, m.entity_type FROM messages m
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type = ${UNCLEAR_ENTITY}::text
  `;
  if (!card || card.entity_type !== UNCLEAR_ENTITY || card.awaiting_reply !== true) return closed;
  const text = typeof answer === 'string' ? answer.trim() : '';
  if (!UNCLEAR_BUTTONS.includes(text)) return unclearResult;
  // בלי פריט: אם יש בדיוק פריט לא ברור אחד - הוא. ברשימה של כמה בלי פריט - לא ברור למי התשובה.
  let targetId = itemId;
  if (targetId === null) {
    const open = await sql`SELECT id FROM events WHERE match_key LIKE 'gcal-pending:%' AND domain IS NULL`;
    if (open.length !== 1) return unclearResult;
    targetId = open[0].id;
  }
  if (typeof targetId !== 'string' || !UUID.test(targetId)) return unclearResult;
  const [item] = await sql`
    SELECT id, title, starts_at, ends_at, domain, match_key FROM events
    WHERE id = ${targetId}::uuid AND match_key LIKE 'gcal-pending:%' AND domain IS NULL
  `;
  const parsed = item ? parseMatchKey(item.match_key) : null;
  if (!item || !parsed || parsed.state !== 'pending') return unclearResult;

  if (text === KEPT_BUTTON) {
    await sql`UPDATE events SET match_key = ${MATCH.kept + parsed.gid} WHERE id = ${targetId}::uuid AND match_key = ${MATCH.pending + parsed.gid} AND domain IS NULL`;
  } else {
    const domain = BUTTON_DOMAIN[text];
    const set = await sql`UPDATE events SET domain = ${domain} WHERE id = ${targetId}::uuid AND match_key = ${MATCH.pending + parsed.gid} AND domain IS NULL RETURNING id`;
    if (set.length === 0) return unclearResult;
    try {
      const conn = await connect({ sql, config, fetchFn, label: 'google-sync' });
      const primary = conn.ok ? await getPrimaryCalendarId({ accessToken: conn.accessToken, fetchImpl: fetchFn }) : { ok: false };
      if (conn.ok && primary.ok) {
        await moveRow(sql, { ...item, state: 'pending', gid: parsed.gid, domain, starts_at: item.starts_at, ends_at: item.ends_at }, {
          accessToken: conn.accessToken, calendars: conn.calendars, primaryId: primary.calendarId, fetchFn,
        });
      }
    } catch (error) {
      console.error('google-sync: העברה מיידית נכשלה', error?.name); // הסנכרון הבא ינסה שוב
    }
  }

  // הכרטיס נסגר רק כשלא נשארו פריטים לא ברורים.
  await sql`
    UPDATE messages SET awaiting_reply = false, read_at = ${nowIso}::timestamptz
    WHERE id = ${messageId}::uuid AND awaiting_reply = true
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.match_key LIKE 'gcal-pending:%' AND e.domain IS NULL)
  `;
  return { status: 'answered', created: {}, keys: [], patchKeys: [] };
}
