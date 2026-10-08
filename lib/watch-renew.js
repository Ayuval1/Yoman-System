// חידוש אוטומטי של ערוצי watch (שלב 5ג). נקרא מ-api/daily-check.js. ערוץ של Google פג כ-7 ימים אחרי היצירה (נמדד).
// הכלל: יומן שיש לו ערוץ פעיל שפג בתוך 48 שעות (או כבר פג ולא נעצר), ואין לו ערוץ פעיל אחר שפג אחרי 48 השעות - נפתח לו ערוץ חדש
// ונוספת שורה חדשה. הערוץ הישן נשאר פעיל עד שהוא פג (חפיפה, בלי חור), וה-webhook ממשיך לענות לו 200 במקום 404.
// ניקוי: שורה ישנה שכבר פגה ויש לה ערוץ חלופי תקין מסומנת stopped_at, כדי שבדיקת הבריאות לא תדווח עליה "עומד לפוג" לנצח.
// הנחה, לא אומת: ערוץ NULL (אין תפוגה מ-Google) נחשב כיסוי תקין ולא מחדשים אותו - אין לנו דרך לדעת מתי הוא פג.
// פרטיות: לא מחזירים ולא מדפיסים מזהי יומן/ערוץ/resource, tokens או סודות. רק ספירות וקודי סיבה קצרים.
// בלי ערוץ שעומד לפוג - אפס קריאות ל-Google (גם לא רענון token).
import { randomUUID } from 'node:crypto';
import {
  WATCHABLE_ROLES, WATCH_ADDRESS, decryptToken, deriveChannelToken, listCalendars, missingConfig, parseEncKey, refreshAccessToken,
  shortReason, watchCalendarEvents,
} from './google.js';

const ACCOUNT = 'primary';
const RENEW_WINDOW_MS = 48 * 60 * 60 * 1000;

function toMs(value) {
  if (value === null || value === undefined) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// מחזיר { renewed, failed, skipped, reason? }. reason = קוד קצר כשכל הריצה נעצרה לפני שהגיעה ליומנים. לא זורק על כשל צפוי.
export async function renewExpiringChannels({
  sql, config, fetchImpl = fetch, nowMs = Date.now(), makeChannelId = randomUUID, address = WATCH_ADDRESS,
}) {
  const result = { renewed: 0, failed: 0, skipped: 0 };
  const soonMs = nowMs + RENEW_WINDOW_MS;

  // כל הערוצים הפעילים (מעטים). את ההחלטה עושים בקוד כדי שתהיה דטרמיניסטית ונבדקת בלי מסד.
  const rows = await sql`SELECT id, calendar_id, expiration FROM google_watch_channels WHERE stopped_at IS NULL`;
  const byCalendar = new Map();
  for (const row of rows) {
    if (typeof row.calendar_id !== 'string') continue;
    const list = byCalendar.get(row.calendar_id) ?? [];
    list.push({ id: row.id, expirationMs: toMs(row.expiration) });
    byCalendar.set(row.calendar_id, list);
  }

  const toRenew = []; // calendar_id שצריכים ערוץ חדש
  const toStop = []; // שורות שפגו ויש להן חלופה תקינה
  for (const [calendarId, list] of byCalendar) {
    // NULL (או תפוגה שלא נקראה) = אין מידע; נחשב כיסוי. תפוגה מעבר ל-48 שעות = כיסוי.
    const covered = list.some((c) => c.expirationMs === null || c.expirationMs > soonMs);
    const expiring = list.some((c) => c.expirationMs !== null && c.expirationMs <= soonMs);
    if (covered) {
      for (const c of list) if (c.expirationMs !== null && c.expirationMs <= nowMs) toStop.push(c.id);
      if (expiring) result.skipped += 1; // כבר חודש (או שיש כיסוי אחר)
    } else if (expiring) {
      toRenew.push(calendarId);
    }
  }

  for (const id of toStop) {
    try {
      await sql`UPDATE google_watch_channels SET stopped_at = now() WHERE id = ${id} AND stopped_at IS NULL`;
    } catch (error) {
      console.error('watch-renew: סימון ערוץ ישן כנעצר נכשל', error?.name); // לא עוצר: ינוסה שוב מחר
    }
  }
  if (toRenew.length === 0) return result;

  // מכאן צריך Google. כשל כללי נספר ככשל לכל יומן שהיה צריך חידוש.
  const abort = (reason) => ({ ...result, failed: result.failed + toRenew.length, reason });
  if (missingConfig(config).length > 0) return abort('config_missing');
  let key;
  try {
    key = parseEncKey(config.encKeyRaw);
  } catch {
    return abort('config_missing');
  }
  let credentials;
  try {
    credentials = (await sql`SELECT refresh_token_enc FROM google_credentials WHERE account = ${ACCOUNT}`)[0];
  } catch (error) {
    console.error('watch-renew: קריאת חיבור נכשלה', error?.name);
    return abort('db_error');
  }
  if (!credentials) return abort('not_connected');
  let refreshToken;
  try {
    refreshToken = decryptToken(credentials.refresh_token_enc, key);
  } catch {
    return abort('decrypt_failed');
  }
  const refreshed = await refreshAccessToken({ refreshToken, clientId: config.clientId, clientSecret: config.clientSecret, fetchImpl });
  if (!refreshed.ok) {
    console.error('watch-renew: רענון נכשל:', refreshed.reason, refreshed.status);
    return abort(shortReason(refreshed.reason, refreshed.status));
  }
  const listed = await listCalendars({ accessToken: refreshed.accessToken, fetchImpl });
  if (!listed.ok) {
    console.error('watch-renew: calendarList נכשל:', listed.reason, listed.status);
    return abort(shortReason(`calendarlist_${listed.reason}`, listed.status));
  }
  const watchable = new Set(listed.calendars.filter((c) => typeof c.id === 'string' && WATCHABLE_ROLES.includes(c.accessRole)).map((c) => c.id));

  for (const calendarId of toRenew) {
    try {
      if (!watchable.has(calendarId)) { // נמחק מהרשימה או הפך לקריאה בלבד
        result.skipped += 1;
        continue;
      }
      const channelId = makeChannelId();
      const watched = await watchCalendarEvents({
        accessToken: refreshed.accessToken, calendarId, channelId, token: deriveChannelToken(channelId, key), address, fetchFn: fetchImpl,
      });
      if (!watched.ok) {
        console.error('watch-renew: watch נכשל:', watched.reason, watched.status);
        result.failed += 1;
        continue;
      }
      // תפוגה מופרכת (ענקית) גורמת ל-toISOString לזרוק; הערוץ כבר נפתח אצל Google, אז שומרים NULL ולא זורקים.
      let expirationIso = null;
      if (watched.expiration !== null) {
        const expirationDate = new Date(watched.expiration);
        if (Number.isNaN(expirationDate.getTime())) console.error('watch-renew: תפוגה לא שמישה מ-Google, נשמר NULL');
        else expirationIso = expirationDate.toISOString();
      }
      try {
        await sql`
          INSERT INTO google_watch_channels (calendar_id, channel_id, resource_id, expiration)
          VALUES (${calendarId}, ${channelId}, ${watched.resourceId}, ${expirationIso})
        `;
      } catch (error) {
        console.error('watch-renew: שמירת ערוץ נכשלה', error?.name);
        result.failed += 1;
        continue;
      }
      result.renewed += 1;
      // ערוצים ישנים שכבר פגו וקיבלו חלופה: עוצרים עכשיו. אלה שעוד לא פגו נשארים פעילים עד שיפוגו (ינוקו בריצה הבאה אחרי הפקיעה).
      for (const c of byCalendar.get(calendarId)) {
        if (c.expirationMs !== null && c.expirationMs <= nowMs) {
          try {
            await sql`UPDATE google_watch_channels SET stopped_at = now() WHERE id = ${c.id} AND stopped_at IS NULL`;
          } catch (error) {
            console.error('watch-renew: סימון ערוץ ישן כנעצר נכשל', error?.name);
          }
        }
      }
    } catch (error) {
      console.error('watch-renew: טיפול ביומן נכשל', error?.name);
      result.failed += 1;
    }
  }
  return result;
}
