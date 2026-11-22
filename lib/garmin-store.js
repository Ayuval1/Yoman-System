// שמירת החיבור ל-Garmin ופריטי האימון במסד (בלוק 5 חלק ב). ה-HTTP עצמו: lib/garmin.js. ה-Cron: lib/ops/garmin-sync.js.
// סודות: הסיסמה של Garmin לא נשמרת בשום מקום (הכניסה רצה פעם אחת מהמחשב של יובל, lib/garmin-login-cli.js).
// הטוקנים נשמרים מוצפנים AES-256-GCM במסד, במפתח TOKEN_ENC_KEY הקיים (אותו מפתח כמו Google, lib/google.js encryptToken/decryptToken). אין סוד חדש.
// זה החריג המותנה של docs/02-rules/03-scheduling-rules.md (שלב 2, "חריג מותנה - טוקני Garmin"): לא ידוע אם ה-refresh token מתחלף בכל רענון
// (הספרייה עושה refresh = data.refresh_token ?? old, מדווח), ולכן אחרי כל רענון שומרים את הסט המלא, תמיד.
// רענון שנכשל: נרשם last_error, בלי לולאת ניסיונות. הטבלאות נוצרות בפקודה שהמנהל מריץ ב-Neon; עד אז 42P01 מדווח 'table_missing' ולא קורס.
// [הנחה, לא אומת] שגיאת הדרייבר של Neon נושאת את SQLSTATE בשדה code (כמו ב-lib/subtask.js). לא נבדק מול מסד אמיתי.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי. הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה.
import { decryptToken, encryptToken, shortReason } from './google.js';
import { isTokenSet, needsRefresh, refreshTokens } from './garmin.js';

export const GARMIN_ACCOUNT = 'primary';
export const MISSING_TABLE_CODE = '42P01';
// בועת "החיבור נפל" (03-garmin-rules, "שבירה אינה שקטה"; נוסח מהמשימה). אחת ביום ישראלי לכל היותר.
export const GARMIN_DOWN_TEXT = 'החיבור ל-Garmin נפל. צריך להתחבר מחדש מהמחשב.';
export const GARMIN_DOWN_ENTITY = 'garmin_down';

const MISSING_TABLE_MESSAGE = /relation "garmin_\w+" does not exist/i;
export const isMissingTable = (error) =>
  error?.code === MISSING_TABLE_CODE || (typeof error?.message === 'string' && MISSING_TABLE_MESSAGE.test(error.message));

const rowsOf = (result) => (Array.isArray(result) ? result : []);

// שורת החיבור או null. כשל מסד נזרק (כולל טבלה חסרה; הקורא מבחין לפי isMissingTable).
export async function loadCredentialRow(sql) {
  const rows = rowsOf(await sql`SELECT tokens_enc, updated_at, last_ok_at, last_error FROM garmin_credentials WHERE account = ${GARMIN_ACCOUNT}`);
  return rows[0] ?? null;
}

// שומר את הסט המלא מוצפן. connect=true (חיבור מהמחשב): יוצר או מחליף, ומנקה last_error. אחרת (אחרי רענון): עדכון בלבד.
export async function saveTokens(sql, key, tokens, { connect = false, nowIso = new Date().toISOString() } = {}) {
  const enc = encryptToken(JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, client_id: tokens.client_id }), key);
  if (connect) {
    await sql`
      INSERT INTO garmin_credentials (account, tokens_enc, updated_at, last_error)
      VALUES (${GARMIN_ACCOUNT}, ${enc}, ${nowIso}::timestamptz, NULL)
      ON CONFLICT (account) DO UPDATE SET tokens_enc = EXCLUDED.tokens_enc, updated_at = EXCLUDED.updated_at, last_error = NULL
    `;
    return;
  }
  await sql`UPDATE garmin_credentials SET tokens_enc = ${enc}, updated_at = ${nowIso}::timestamptz WHERE account = ${GARMIN_ACCOUNT}`;
}

export async function markOk(sql, nowIso) {
  await sql`UPDATE garmin_credentials SET last_ok_at = ${nowIso}::timestamptz, last_error = NULL WHERE account = ${GARMIN_ACCOUNT}`;
}

// code: קוד קצר שהקוד שלנו הרכיב (בלי ערכים מהתשובה). נחתך ל-200.
export async function markError(sql, code) {
  await sql`UPDATE garmin_credentials SET last_error = ${String(code).slice(0, 200)} WHERE account = ${GARMIN_ACCOUNT}`;
}

// access token תקף. מחזיר { ok:true, accessToken, refreshed } או { ok:false, reason, auth }.
// reason: not_connected · table_missing · db_error · decrypt_failed · save_failed · refresh_<סיבה> (<סטטוס>). auth=true רק כש-Garmin דחה את ה-refresh token.
export async function getAccessToken({ sql, key, fetchImpl = fetch, nowMs = Date.now() }) {
  const fail = (reason, auth = false) => ({ ok: false, reason, auth });
  let row;
  try {
    row = await loadCredentialRow(sql);
  } catch (error) {
    if (isMissingTable(error)) return fail('table_missing');
    console.error('garmin-store: קריאת החיבור נכשלה', error?.name);
    return fail('db_error');
  }
  if (!row) return fail('not_connected');
  let tokens;
  try {
    tokens = JSON.parse(decryptToken(row.tokens_enc, key));
  } catch {
    return fail('decrypt_failed');
  }
  if (!isTokenSet(tokens)) return fail('decrypt_failed');
  if (!needsRefresh(tokens, nowMs)) return { ok: true, accessToken: tokens.access_token, refreshed: false };

  const refreshed = await refreshTokens({ tokens, fetchImpl });
  if (!refreshed.ok) return fail(shortReason(`refresh_${refreshed.reason}`, refreshed.status), refreshed.auth === true);
  try {
    await saveTokens(sql, key, refreshed.tokens, { nowIso: new Date(nowMs).toISOString() });
  } catch (error) {
    // בלי שמירה, refresh שהתחלף היה הולך לאיבוד. לא ממשיכים, כדי שהכשל ייראה (last_error), ולא שקט.
    console.error('garmin-store: שמירת הטוקנים אחרי רענון נכשלה', error?.name);
    return fail('save_failed');
  }
  return { ok: true, accessToken: refreshed.tokens.access_token, refreshed: true };
}

// upsert לכל פריט (עד כמה עשרות ביום). מחזיר כמה נכתבו. כשל מסד נזרק (הקורא מבחין בטבלה חסרה).
export async function upsertItems(sql, items, nowIso) {
  let count = 0;
  for (const item of items) {
    await sql`
      INSERT INTO garmin_items (garmin_id, kind, item_date, title, sport, duration_sec, starts_at, fetched_at)
      VALUES (${item.garmin_id}, ${item.kind}, ${item.item_date}::date, ${item.title}, ${item.sport}, ${item.duration_sec}, ${item.starts_at}::timestamptz, ${nowIso}::timestamptz)
      ON CONFLICT (garmin_id) DO UPDATE SET kind = EXCLUDED.kind, item_date = EXCLUDED.item_date, title = EXCLUDED.title, sport = EXCLUDED.sport,
        duration_sec = EXCLUDED.duration_sec, starts_at = EXCLUDED.starts_at, fetched_at = EXCLUDED.fetched_at
    `;
    count += 1;
  }
  return count;
}

// קריאה לשלב הבא (מיזוג עם 4fitness ועם אירועי היומן; לא בשימוש עדיין). dateIso = תאריך ישראלי 'YYYY-MM-DD'.
// מחזיר את השורות כמו שהן, כולל fetched_at: אימון מתוכנן שהמאמן מחק נשאר בטבלה (אין מחיקה), ולכן הקורא צריך להשוות fetched_at למשיכה האחרונה.
// טבלה חסרה = []. כל כשל אחר נזרק.
export async function loadGarminItemsForDate(sql, dateIso) {
  try {
    return rowsOf(await sql`
      SELECT garmin_id, kind, item_date::text AS item_date, title, sport, duration_sec, starts_at, fetched_at
      FROM garmin_items WHERE item_date = ${dateIso}::date
      ORDER BY kind, starts_at NULLS LAST, garmin_id
    `);
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

// בועת "החיבור נפל": הודעת update יוצאת שלא נקראה (נספרת במספר על האייקון, כמו כל בועה). אחת ביום ישראלי: NOT EXISTS על אותו יום.
// מחזיר true אם נכתבה. כשל מסד נזרק.
export async function notifyGarminDown(sql, { today, nowIso }) {
  const rows = rowsOf(await sql`
    INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
    SELECT 'out', ${GARMIN_DOWN_TEXT}::text, 'update', ${nowIso}::timestamptz, false, NULL::uuid, NULL::timestamptz, 'garmin_down', NULL::uuid, NULL::integer
    WHERE NOT EXISTS (
      SELECT 1 FROM messages WHERE entity_type = 'garmin_down' AND (sent_at AT TIME ZONE 'Asia/Jerusalem')::date = ${today}::date
    )
    RETURNING id
  `);
  return rows.length > 0;
}
