// כתיבת אירועים ליומן Google (שלב 8.3-4, docs/08-chapter8/65 D2, D5; ההחלטות אושרו ביובל ב-27.10.2026). קוד בלבד, בלי מודל.
// מה נכתב: רק שורות events שנולדו מהודעה (match_key שמתחיל ב-'source:', שלב 8.3-3), ורק בתחום שבטבלה CALENDAR_BY_DOMAIN. כל תחום אחר לא נכתב לעולם.
// לאן: היומן נמצא בזמן ריצה לפי שם מדויק (summary) מתוך calendarList, רק בין יומנים עם owner או writer. אפס התאמות או יותר מאחת = לא כותבים,
// מחזירים קוד (calendar_not_found / calendar_ambiguous) והשורה לא משתנה. אין כתיבה ליומן הראשי ואין ברירת מחדל.
// אימפוטנטיות: מזהה האירוע ב-Google נגזר מ-events.id (ה-uuid בלי מקפים, אותיות קטנות; hex הוא תת-קבוצה של base32hex שמותר ב-Google).
// יצירה שנכשלה באמצע או רצה פעמיים לא יוצרת כפילות: 409 = כבר קיים = הצלחה. אחרי הצלחה המזהה נשמר ב-external_id (רק אם עדיין ריק).
// עדכון (תיקון "השעה" / "התאריך" בצ'אט): PATCH של start ו-end לערכי השורה. בלי external_id: יצירה במקום.
// ביטול ("לא קורה"): DELETE לפי external_id, או לפי המזהה הנגזר כשהוא ריק; 404 / 410 = הצלחה. השורה במסד נשארת cancelled, ו-external_id נשמר.
// פערים ידועים (ביקורת 27.10, נמוכים): קליטה שעברה את 5 השניות לא מפעילה כתיבה מיידית, והסריקה של 07:30 לא תתפוס אירוע של אותו יום שכבר התחיל;
// התשובה בקליטה ובצ'אט ממתינה ל-Google (עד 10 שניות לכל קריאה, שלוש קריאות); תיקון לשעה שכבר עברה לא נשלח ל-Google.
// אירוע שכבר התחיל (starts_at <= עכשיו) לא נוצר ולא מתעדכן. מחיקה מותרת כל עוד ends_at בעתיד.
// מתי: מיד, באותה בקשה, אחרי שהכתיבה למסד הצליחה (api/intake.js אחרי processSource, api/chat.js אחרי answerQuestion), ובניסיון חוזר יומי
// (sweepEventSync, נקרא מ-lib/ops/daily-check.js ב-07:30). הקריאות כאן לעולם לא זורקות לקורא בכשל צפוי, ואינן משנות את התשובה ליובל.
// פער ידוע (בכוונה): הסריקה היומית לא מעדכנת אירועים קיימים, כי עדכון עלול לדרוס שינוי שיובל עשה ביד ב-Google (החלטה 4 בחוקים: שינוי כזה נשאל).
// לכן PATCH מיידי שנכשל נרשם בלוג (קוד בלבד) ולא מנוסה שוב.
// פרטיות: לא נרשמים ולא נשמרים tokens, כותרות, שעות, מזהי אירוע או יומן, או טקסט מתשובות Google. רק קודים קצרים (shortReason) וספירות.
import {
  WATCHABLE_ROLES, decryptToken, deleteCalendarEvent, googleConfigFromEnv, insertCalendarEvent, listCalendars, missingConfig, parseEncKey,
  patchCalendarEvent, refreshAccessToken, shortReason,
} from './google.js';

const ACCOUNT = 'primary';
export const SOURCE_KEY_PREFIX = 'source:';
export const EVENT_TIME_ZONE = 'Asia/Jerusalem';
// תחום ← שם היומן ב-Google (הכרעת יובל 27.10.2026; D2: אירוע אישי ← "אישי", D5: יציאה מוקדמת ← "בית ספר"). רק מה שכאן נכתב.
export const CALENDAR_BY_DOMAIN = Object.freeze({ personal: 'אישי', school: 'בית ספר' });
// יומנים שמותר לכתוב אליהם: owner או writer (אותה רשימה כמו watch).
const WRITABLE_ROLES = WATCHABLE_ROLES;
const GOOGLE_ID = /^[0-9a-v]{5,1024}$/;
const FIX_FIELDS = ['fix_time', 'fix_date'];

function toMs(value) {
  if (value === null || value === undefined) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// מזהה האירוע ב-Google מתוך events.id. null כשהתוצאה אינה מזהה חוקי (למשל id חסר).
export function googleEventIdFor(eventId) {
  if (typeof eventId !== 'string') return null;
  const id = eventId.replace(/-/g, '').toLowerCase();
  return GOOGLE_ID.test(id) ? id : null;
}

// היומן לפי שם מדויק, רק מבין owner / writer. מחזיר { ok:true, calendarId } או { ok:false, reason }.
export function resolveCalendarId(calendars, name) {
  const matches = (Array.isArray(calendars) ? calendars : [])
    .filter((c) => typeof c?.id === 'string' && c.summary === name && WRITABLE_ROLES.includes(c.accessRole));
  if (matches.length === 0) return { ok: false, reason: 'calendar_not_found' };
  if (matches.length > 1) return { ok: false, reason: 'calendar_ambiguous' };
  return { ok: true, calendarId: matches[0].id };
}

// גוף האירוע ל-Google: כותרת, התחלה וסיום. בלי תיאור, מיקום, תזכורות או צבע (ברירות המחדל של היומן).
export function eventTimes(row) {
  return {
    start: { dateTime: new Date(toMs(row.starts_at)).toISOString(), timeZone: EVENT_TIME_ZONE },
    end: { dateTime: new Date(toMs(row.ends_at)).toISOString(), timeZone: EVENT_TIME_ZONE },
  };
}
export function eventBody(row) {
  return { summary: row.title, ...eventTimes(row) };
}

// מה לעשות בשורה אחת (טהור). allowPatch: רק אחרי תיקון בצ'אט. מחזיר { action: 'create' | 'patch' | 'delete' } או { action: null, reason }.
export function planEventSync(row, nowMs, { allowPatch = false } = {}) {
  if (!row) return { action: null, reason: 'no_event' };
  if (typeof row.match_key !== 'string' || !row.match_key.startsWith(SOURCE_KEY_PREFIX)) return { action: null, reason: 'not_source' };
  if (!Object.hasOwn(CALENDAR_BY_DOMAIN, row.domain)) return { action: null, reason: 'domain_not_synced' };
  if (!googleEventIdFor(row.id)) return { action: null, reason: 'bad_event_id' };
  const startsMs = toMs(row.starts_at);
  const endsMs = toMs(row.ends_at);
  if (row.status === 'cancelled') {
    // גם בלי external_id: יצירה קודמת אולי הגיעה ל-Google ונפלה לפני השמירה, והמזהה דטרמיניסטי (404 / 410 = הצלחה). ביקורת 27.10, ממצא 2.
    if (endsMs === null || endsMs <= nowMs) return { action: null, reason: 'past' };
    return { action: 'delete' };
  }
  if (row.status !== 'planned') return { action: null, reason: 'not_planned' };
  if (startsMs === null || endsMs === null || startsMs <= nowMs) return { action: null, reason: 'past' };
  if (!row.external_id) return { action: 'create' };
  return allowPatch ? { action: 'patch' } : { action: null, reason: 'already_synced' };
}

// access token ורשימת היומנים. מחזיר { ok:true, accessToken, calendars } או { ok:false, reason }. לא זורק על כשל צפוי.
async function connect({ sql, config, fetchFn, label }) {
  if (missingConfig(config).length > 0) return { ok: false, reason: 'config_missing' };
  let key;
  try {
    key = parseEncKey(config.encKeyRaw);
  } catch {
    return { ok: false, reason: 'config_missing' };
  }
  let credentials;
  try {
    credentials = (await sql`SELECT refresh_token_enc FROM google_credentials WHERE account = ${ACCOUNT}`)[0];
  } catch (error) {
    console.error(`${label}: קריאת חיבור נכשלה`, error?.name);
    return { ok: false, reason: 'db_error' };
  }
  if (!credentials) return { ok: false, reason: 'not_connected' };
  let refreshToken;
  try {
    refreshToken = decryptToken(credentials.refresh_token_enc, key);
  } catch {
    return { ok: false, reason: 'decrypt_failed' };
  }
  const refreshed = await refreshAccessToken({ refreshToken, clientId: config.clientId, clientSecret: config.clientSecret, fetchImpl: fetchFn });
  if (!refreshed.ok) return { ok: false, reason: shortReason(refreshed.reason, refreshed.status) };
  const listed = await listCalendars({ accessToken: refreshed.accessToken, fetchImpl: fetchFn });
  if (!listed.ok) return { ok: false, reason: shortReason(`calendarlist_${listed.reason}`, listed.status) };
  return { ok: true, accessToken: refreshed.accessToken, calendars: listed.calendars };
}

// מבצע את הפעולה על שורה אחת, אחרי שיש חיבור. מחזיר { ok, action, reason?, status? }.
// allowPatch: אחרי תיקון בצ'אט. יצירה שמחזירה 409 (האירוע כבר נוצר בניסיון שנפל לפני שמירת external_id) נמשכת ב-PATCH,
// כדי ש-Google לא תישאר עם השעה הישנה (ביקורת 27.10, ממצא 1).
async function applyAction({ sql, row, action, accessToken, calendars, fetchFn, allowPatch = false }) {
  const calendar = resolveCalendarId(calendars, CALENDAR_BY_DOMAIN[row.domain]);
  if (!calendar.ok) return { ok: false, action, reason: calendar.reason };
  const eventId = googleEventIdFor(row.id);
  const { calendarId } = calendar;
  if (action === 'delete') {
    const deleted = await deleteCalendarEvent({ accessToken, calendarId, eventId: row.external_id || eventId, fetchFn });
    return deleted.ok ? { ok: true, action } : { ok: false, action, reason: shortReason(deleted.reason, deleted.status) };
  }
  if (action === 'patch') {
    const patched = await patchCalendarEvent({ accessToken, calendarId, eventId: row.external_id, patch: eventTimes(row), fetchFn });
    return patched.ok ? { ok: true, action } : { ok: false, action, reason: shortReason(patched.reason, patched.status) };
  }
  const inserted = await insertCalendarEvent({ accessToken, calendarId, eventId, event: eventBody(row), fetchFn });
  if (!inserted.ok) return { ok: false, action, reason: shortReason(inserted.reason, inserted.status) };
  if (inserted.existed && allowPatch) {
    const patched = await patchCalendarEvent({ accessToken, calendarId, eventId, patch: eventTimes(row), fetchFn });
    if (!patched.ok) return { ok: false, action: 'patch', reason: shortReason(patched.reason, patched.status) };
  }
  // רק אם עדיין ריק: ריצה מקבילה שכבר שמרה לא נדרסת (והמזהה ממילא זהה).
  try {
    await sql`UPDATE events SET external_id = ${eventId} WHERE id = ${row.id}::uuid AND external_id IS NULL`;
  } catch (error) {
    // האירוע קיים ב-Google; בריצה הבאה היצירה תחזיר 409 (הצלחה) והמזהה יישמר אז.
    console.error('event-sync: שמירת external_id נכשלה', error?.name);
    return { ok: false, action, reason: 'db_error' };
  }
  return { ok: true, action };
}

// הנתיב המיידי: האירוע של מקור אחד (match_key = 'source:<id>'). allowPatch רק אחרי תיקון. לא זורק.
// מחזיר { ok, action?, reason? }. ok:true בלי action = אין מה לעשות (reason אומר למה); ok:false = ניסיון שנכשל.
export async function syncEventForSource({
  sql, sourceId, now = new Date(), fetchFn = fetch, env = process.env, config = googleConfigFromEnv(env), allowPatch = false,
}) {
  try {
    // בלי הגדרות Google: מדלגים בשקט, לפני כל קריאה למסד או לרשת.
    if (missingConfig(config).length > 0) return { ok: true, action: null, reason: 'config_missing' };
    if (typeof sourceId !== 'string' || sourceId === '') return { ok: true, action: null, reason: 'no_event' };
    const [row] = await sql`
      SELECT id, title, starts_at, ends_at, domain, status, external_id, match_key
      FROM events WHERE match_key = ${SOURCE_KEY_PREFIX + sourceId}
      LIMIT 1
    `;
    const plan = planEventSync(row, toMs(now), { allowPatch });
    if (!plan.action) return { ok: true, action: null, reason: plan.reason };
    const connected = await connect({ sql, config, fetchFn, label: 'event-sync' });
    if (!connected.ok) {
      if (connected.reason !== 'not_connected') console.error('event-sync: חיבור ל-Google נכשל:', connected.reason);
      return { ok: connected.reason === 'not_connected', action: null, reason: connected.reason };
    }
    const done = await applyAction({ sql, row, action: plan.action, accessToken: connected.accessToken, calendars: connected.calendars, fetchFn, allowPatch });
    if (!done.ok) console.error('event-sync: כתיבה ל-Google נכשלה:', done.action, done.reason);
    return done;
  } catch (error) {
    console.error('event-sync: קרס', error?.name);
    return { ok: false, action: null, reason: 'crashed' };
  }
}

// הנתיב המיידי בצ'אט: answerQuestion לא מחזיר את מזהה המקור, ולכן הוא נקרא משורת השאלה (messages.entity_id, entity_type='source').
// PATCH מותר רק כשנשמר למקור תיקון שעה או תאריך (fix_time / fix_date שאינו unknown): יש רק סבב תיקון אחד, ואחריו אין שאלות נוספות,
// ולכן תשובה שנענתה עכשיו עם תיקון שמור היא התיקון עצמו. תשובה אחרת ("נכון" וכדומה) לא שולחת PATCH, כדי לא לדרוס שינוי ידני ב-Google.
export async function syncEventAfterAnswer({
  sql, messageId, now = new Date(), fetchFn = fetch, env = process.env, config = googleConfigFromEnv(env),
}) {
  try {
    if (missingConfig(config).length > 0) return { ok: true, action: null, reason: 'config_missing' };
    const [found] = await sql`
      SELECT m.entity_id AS source_id,
        EXISTS (SELECT 1 FROM facts f WHERE f.source_id = m.entity_id AND f.field IN (${FIX_FIELDS[0]}, ${FIX_FIELDS[1]}) AND f.value <> 'unknown') AS corrected
      FROM messages m WHERE m.id = ${messageId}::uuid AND m.entity_type = 'source'
    `;
    if (!found?.source_id) return { ok: true, action: null, reason: 'no_event' };
    return await syncEventForSource({ sql, sourceId: String(found.source_id), now, fetchFn, config, allowPatch: found.corrected === true });
  } catch (error) {
    console.error('event-sync: קרס', error?.name);
    return { ok: false, action: null, reason: 'crashed' };
  }
}

// ניסיון חוזר יומי (lib/ops/daily-check.js): (א) יצירת כל אירוע מתוכנן שעוד לא נכתב ועוד לא התחיל; (ב) מחיקת כל אירוע מבוטל שעוד לא הסתיים (גם בלי external_id, לפי המזהה הנגזר).
// לא מעדכן אירועים קיימים (ראו "פער ידוע" למעלה). בלי שורות לטיפול: אפס קריאות ל-Google (גם לא רענון token).
// מחזיר { created, deleted, failed, skipped, reason?, last_failure? }: ספירות וקודים קצרים בלבד. reason = הריצה כולה נעצרה לפני Google.
// הערה: מחיקה שהצליחה משאירה external_id, ולכן השורה תימחק שוב בכל יום עד שתסתיים (410 / 404 = הצלחה). כך הוחלט (החלטה 5, 9).
export async function sweepEventSync({ sql, config, fetchFn = fetch, nowMs = Date.now() }) {
  const result = { created: 0, deleted: 0, failed: 0, skipped: 0 };
  const nowIso = new Date(nowMs).toISOString();
  const domainsJson = JSON.stringify(Object.keys(CALENDAR_BY_DOMAIN));
  const rows = await sql`
    SELECT id, title, starts_at, ends_at, domain, status, external_id, match_key
    FROM events
    WHERE match_key LIKE 'source:%'
      AND domain IN (SELECT jsonb_array_elements_text(${domainsJson}::jsonb))
      AND ((status = 'planned' AND external_id IS NULL AND starts_at > ${nowIso}::timestamptz)
        OR (status = 'cancelled' AND ends_at > ${nowIso}::timestamptz))
  `;
  const work = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const plan = planEventSync(row, nowMs); // בלי allowPatch: הסריקה לא מעדכנת
    if (plan.action === 'create' || plan.action === 'delete') work.push({ row, action: plan.action });
    else result.skipped += 1;
  }
  if (work.length === 0) return result;

  const connected = await connect({ sql, config, fetchFn, label: 'event-sync-sweep' });
  if (!connected.ok) return { ...result, failed: result.failed + work.length, reason: connected.reason };
  for (const { row, action } of work) {
    let done;
    try {
      done = await applyAction({ sql, row, action, accessToken: connected.accessToken, calendars: connected.calendars, fetchFn });
    } catch (error) {
      console.error('event-sync-sweep: שורה קרסה', error?.name);
      done = { ok: false, reason: 'crashed' };
    }
    if (done.ok) {
      if (action === 'create') result.created += 1;
      else result.deleted += 1;
    } else {
      result.failed += 1;
      result.last_failure = done.reason;
    }
  }
  return result;
}
