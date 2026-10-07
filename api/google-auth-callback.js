// חזרה מ-Google אחרי ההסכמה (שלב 5א). GET עם code ו-state בכתובת. מחזיר דף HTML קצר בעברית.
// אין סוד בכותרת: זו הפניה של הדפדפן מ-Google. ההגנה היא ה-state: חייב להיות קיים, לא פג (10 דקות) ולא נוצל.
// כללים: ה-code וה-tokens לעולם לא נרשמים בלוג ולא מוצגים. שגיאות: הודעה בעברית בלי ערכים.
// ה-refresh token נשמר מוצפן (AES-256-GCM, מפתח TOKEN_ENC_KEY) בטבלת google_credentials, שורה אחת לחשבון.
// access token לא נשמר: הוא קצר חיים ומתרענן לפי הצורך (api/google-calendars.js).
import { neon } from '@neondatabase/serverless';
import { consumeState, encryptToken, exchangeCode, googleConfigFromEnv, missingConfig, missingScopes, parseEncKey } from '../lib/google.js';

const ACCOUNT = 'primary'; // שימוש אישי יחיד: חשבון אחד

function page(status, title, message) {
  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}h1{font-size:1.4rem}</style>
</head>
<body><main><h1>${title}</h1><p>${message}</p></main></body>
</html>`;
  return new Response(html, {
    status,
    // בלי מטמון ובלי Referer: ה-URL של הדף הזה הכיל את ה-code.
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });
}

const STATE_MESSAGES = {
  not_found: 'בקשת החיבור לא נמצאה. מתחילים מחדש מהאפליקציה.',
  expired: 'בקשת החיבור פגה (עברו יותר מ-10 דקות). מתחילים מחדש מהאפליקציה.',
  used: 'בקשת החיבור כבר נוצלה. מתחילים מחדש מהאפליקציה.',
};

export async function handle(request, { sql, config = googleConfigFromEnv(), fetchImpl = fetch, now = () => Date.now() }) {
  if (request.method !== 'GET') return page(405, 'לא נתמך', 'Method Not Allowed');

  const missing = missingConfig(config);
  if (missing.length > 0) {
    console.error('google-auth-callback: משתני סביבה חסרים:', missing.join(','));
    return page(500, 'החיבור נכשל', `חסרים משתני סביבה בשרת: ${missing.join(', ')}.`);
  }
  let key;
  try {
    key = parseEncKey(config.encKeyRaw);
  } catch (error) {
    console.error('google-auth-callback:', error.message); // ההודעה לא כוללת את ערך המפתח
    return page(500, 'החיבור נכשל', 'מפתח ההצפנה בשרת לא תקין (TOKEN_ENC_KEY). הוא חייב להיות base64 של 32 בתים.');
  }

  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');

  // תחילה state: בלי state תקף לא מטפלים בשום דבר אחר (גם לא בשגיאה שחזרה מ-Google).
  let verdict;
  try {
    verdict = await consumeState(sql, state, now());
  } catch (error) {
    console.error('google-auth-callback: בדיקת state נכשלה', error?.name);
    return page(500, 'החיבור נכשל', 'לא הצלחתי לבדוק את בקשת החיבור במסד. מתחילים מחדש מהאפליקציה.');
  }
  if (!verdict.ok) return page(400, 'החיבור נכשל', STATE_MESSAGES[verdict.reason] ?? STATE_MESSAGES.not_found);

  // המשתמש סירב, או ש-Google החזיר שגיאה: לא מציגים את הערך שחזר.
  if (url.searchParams.has('error')) return page(400, 'החיבור בוטל', 'לא ניתנה הרשאה. אפשר להתחיל מחדש מהאפליקציה.');
  if (typeof code !== 'string' || code.length === 0 || code.length > 2048) {
    return page(400, 'החיבור נכשל', 'לא התקבל קוד מ-Google. מתחילים מחדש מהאפליקציה.');
  }

  const exchanged = await exchangeCode({
    code,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    fetchImpl,
  });
  if (!exchanged.ok) {
    console.error('google-auth-callback: החלפת code נכשלה:', exchanged.reason, exchanged.status);
    if (exchanged.reason === 'no_refresh_token') {
      return page(502, 'החיבור נכשל', 'Google לא החזיר אישור חידוש. אפשר לבטל את הגישה הקיימת של האפליקציה בחשבון Google ולהתחיל מחדש.');
    }
    return page(502, 'החיבור נכשל', 'ההחלפה מול Google נכשלה. מתחילים מחדש מהאפליקציה; אם זה חוזר, בודקים את GOOGLE_CLIENT_ID ו-GOOGLE_CLIENT_SECRET.');
  }

  // הסכמה מפורטת (לא אומת): אם יובל ביטל סקופ במסך ההסכמה, חיבור חלקי חסר תועלת - לא שומרים אותו.
  if (missingScopes(exchanged.scopes).length > 0) {
    return page(400, 'החיבור נכשל', 'לא אושרו כל ההרשאות הנדרשות. מתחילים מחדש ומאשרים את כולן.');
  }

  try {
    const refreshTokenEnc = encryptToken(exchanged.refreshToken, key);
    // חיבור מחדש מחליף את השורה הקיימת וסוגר שגיאה קודמת. אין מחיקה.
    await sql`
      INSERT INTO google_credentials (account, refresh_token_enc, scopes_granted, obtained_at, last_refresh_at, last_error)
      VALUES (${ACCOUNT}, ${refreshTokenEnc}, ${exchanged.scopes.join(' ')}, now(), NULL, NULL)
      ON CONFLICT (account) DO UPDATE
        SET refresh_token_enc = EXCLUDED.refresh_token_enc, scopes_granted = EXCLUDED.scopes_granted,
            obtained_at = now(), last_refresh_at = NULL, last_error = NULL
    `;
  } catch (error) {
    console.error('google-auth-callback: שמירה נכשלה', error?.name);
    return page(500, 'החיבור נכשל', 'לא הצלחתי לשמור את החיבור במסד. ודא שהטבלאות של Google נוצרו (db/schema.sql).');
  }

  return page(200, 'מחובר', 'החיבור ל-Google Calendar נשמר. אפשר לסגור את הדף.');
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
export default {
  fetch(request) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
