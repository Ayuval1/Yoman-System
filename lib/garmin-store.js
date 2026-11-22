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
// בועות הכשל (03-garmin-rules "שבירה אינה שקטה"; 03-scheduling-rules שלב 3 "כל כשל -> הודעה, פעם אחת"; הנוסחים מהמנהל).
// auth (Garmin דחה את החיבור): צריך כניסה מחדש מהמחשב. כל כשל אחר (403 / 429 / רשת / טבלה חסרה / מפתח חסר): המשיכה נכשלה היום.
// בסך הכול בועה אחת ביום ישראלי, משני הסוגים יחד (אותו entity_type ואותה בדיקת NOT EXISTS).
export const GARMIN_DOWN_TEXT = 'החיבור ל-Garmin נפל. צריך להתחבר מחדש מהמחשב.';
export const GARMIN_PULL_FAILED_TEXT = 'המשיכה מ-Garmin נכשלה היום. אנסה שוב מחר.';
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

const encryptSet = (tokens, key) =>
  encryptToken(JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, client_id: tokens.client_id }), key);

// חיבור מהמחשב (garmin-connect): יוצר או מחליף את הסט בלי תנאי, ומנקה last_error. upsert, ולכן לא יכול "לא לעשות כלום" בשקט.
export async function saveTokens(sql, key, tokens, { nowIso = new Date().toISOString() } = {}) {
  const enc = encryptSet(tokens, key);
  await sql`
    INSERT INTO garmin_credentials (account, tokens_enc, updated_at, last_error)
    VALUES (${GARMIN_ACCOUNT}, ${enc}, ${nowIso}::timestamptz, NULL)
    ON CONFLICT (account) DO UPDATE SET tokens_enc = EXCLUDED.tokens_enc, updated_at = EXCLUDED.updated_at, last_error = NULL
  `;
}

// שמירה אחרי רענון: upsert מותנה. מחליף רק אם השמור עדיין הסט שממנו ריעננו (oldEnc), כדי לא לדרוס סט חדש יותר שריצה מקבילה כבר שמרה.
// שורה חסרה (נמחקה בינתיים) נוצרת מחדש: upsert ולא UPDATE, כדי שהשמירה לא "תצליח" על אפס שורות בשקט.
// מחזיר true אם נשמר, false אם השמור כבר שונה (ריצה אחרת קדמה). כשל מסד נזרק.
export async function saveRefreshedTokens(sql, key, tokens, oldEnc, nowIso) {
  const enc = encryptSet(tokens, key);
  const rows = rowsOf(await sql`
    INSERT INTO garmin_credentials (account, tokens_enc, updated_at)
    VALUES (${GARMIN_ACCOUNT}, ${enc}, ${nowIso}::timestamptz)
    ON CONFLICT (account) DO UPDATE SET tokens_enc = EXCLUDED.tokens_enc, updated_at = EXCLUDED.updated_at
    WHERE garmin_credentials.tokens_enc = ${oldEnc}
    RETURNING account
  `);
  return rows.length > 0;
}

export async function markOk(sql, nowIso) {
  await sql`UPDATE garmin_credentials SET last_ok_at = ${nowIso}::timestamptz, last_error = NULL WHERE account = ${GARMIN_ACCOUNT}`;
}

// code: קוד קצר שהקוד שלנו הרכיב (בלי ערכים מהתשובה). נחתך ל-200.
export async function markError(sql, code) {
  await sql`UPDATE garmin_credentials SET last_error = ${String(code).slice(0, 200)} WHERE account = ${GARMIN_ACCOUNT}`;
}

// סט שמור -> tokens, או null כשלא ניתן לפענח.
function decodeSet(row, key) {
  try {
    const tokens = JSON.parse(decryptToken(row?.tokens_enc, key));
    return isTokenSet(tokens) ? tokens : null;
  } catch {
    return null;
  }
}

// access token תקף. מחזיר { ok:true, accessToken, refreshed, saveFailed?, reloaded? } או { ok:false, reason, auth }.
// reason: not_connected · table_missing · db_error · decrypt_failed · refresh_<סיבה> (<סטטוס>). auth=true רק כש-Garmin דחה את ה-refresh token.
// forceRefresh: מרענן גם טוקן שעוד לא קרוב לתפוגה (אחרי 401 באמצע המשיכה).
// אחרי רענון מוצלח: שמירה מותנית (saveRefreshedTokens), וניסיון שמירה שני אם הראשון נזרק.
//   נכשלה פעמיים: ממשיכים עם ה-access החדש (המשיכה של היום לא הולכת לאיבוד), saveFailed=true. הקורא מדווח save_failed ובועת auth,
//   כי אם ה-refresh התחלף, מחר הוא כבר לא יעבוד.
//   0 שורות (ריצה מקבילה כבר שמרה סט חדש): טוענים את השמור וממשיכים איתו (reloaded), בלי לדרוס. טעינה שנכשלה = כמו שמירה שנכשלה.
export async function getAccessToken({ sql, key, fetchImpl = fetch, nowMs = Date.now(), forceRefresh = false }) {
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
  const tokens = decodeSet(row, key);
  if (!tokens) return fail('decrypt_failed');
  if (!forceRefresh && !needsRefresh(tokens, nowMs)) return { ok: true, accessToken: tokens.access_token, refreshed: false };

  const refreshed = await refreshTokens({ tokens, fetchImpl });
  if (!refreshed.ok) return fail(shortReason(`refresh_${refreshed.reason}`, refreshed.status), refreshed.auth === true);
  const fresh = { ok: true, accessToken: refreshed.tokens.access_token, refreshed: true };
  const nowIso = new Date(nowMs).toISOString();

  let saved = null; // true = נשמר · false = ריצה אחרת קדמה · null = נזרק פעמיים
  for (let attempt = 0; attempt < 2 && saved === null; attempt += 1) {
    try {
      saved = await saveRefreshedTokens(sql, key, refreshed.tokens, row.tokens_enc, nowIso);
    } catch (error) {
      console.error('garmin-store: שמירת הטוקנים אחרי רענון נכשלה', attempt + 1, error?.name);
    }
  }
  if (saved === true) return fresh;
  if (saved === false) {
    try {
      const latest = decodeSet(await loadCredentialRow(sql), key);
      if (latest) return { ok: true, accessToken: latest.access_token, refreshed: true, reloaded: true };
    } catch (error) {
      console.error('garmin-store: טעינה מחדש אחרי מרוץ נכשלה', error?.name);
    }
  }
  return { ...fresh, saveFailed: true };
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
// כפילות בין ריצות (ממצא הבודק, נשאר להחלטה בשלב הבא): pullItems מוריד כפילות לוח/תוכנית (תאריך + כותרת) רק בתוך ריצה אחת.
//   אם ביום אחד לוח השנה נכשל והתוכנית הצליחה, נשמר 'sched:<id>', ובריצה אחרת 'cal:<id>' לאותו אימון; שתי השורות נשארות.
//   לכן הקורא צריך לאחד אימונים מתוכננים באותו תאריך ובאותה כותרת (ובמקרה כזה לבחור את בעל fetched_at העדכני).
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

// בועת כשל: הודעת update יוצאת שלא נקראה (נספרת במספר על האייקון, כמו כל בועה). אחת ביום ישראלי: NOT EXISTS על אותו יום.
// auth=true: נוסח "החיבור נפל"; auth=false: נוסח "המשיכה נכשלה". מחזיר true אם נכתבה. כשל מסד נזרק.
export async function notifyGarminDown(sql, { today, nowIso, auth = true }) {
  const text = auth ? GARMIN_DOWN_TEXT : GARMIN_PULL_FAILED_TEXT;
  const rows = rowsOf(await sql`
    INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
    SELECT 'out', ${text}::text, 'update', ${nowIso}::timestamptz, false, NULL::uuid, NULL::timestamptz, 'garmin_down', NULL::uuid, NULL::integer
    WHERE NOT EXISTS (
      SELECT 1 FROM messages WHERE entity_type = 'garmin_down' AND (sent_at AT TIME ZONE 'Asia/Jerusalem')::date = ${today}::date
    )
    RETURNING id
  `);
  return rows.length > 0;
}
