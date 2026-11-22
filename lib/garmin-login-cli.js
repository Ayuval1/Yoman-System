// כניסה חד-פעמית ל-Garmin מהמחשב של יובל (בלוק 5 חלק ב; החלטת המנהל: הסיסמה לא נשמרת בשום מקום, לא ב-Vercel ולא במסד).
// הרצה (מתיקיית הריפו, בחלון טרמינל): node lib/garmin-login-cli.js
// מה קורה: שואל את CRON_SECRET (מוסתר) ובודק אותו מול garmin-status לפני הכל; שואל אימייל וסיסמה (מוסתרת); נכנס ל-Garmin ב-3 שלבים (lib/garmin.js),
//   עם קוד MFA אם Garmin מבקש; שולח את סט הטוקנים ל-garmin-connect; ומריץ משיכה ראשונה (garmin-sync) כדי לראות מיד אם השרת מגיע ל-Garmin.
// מודפס: מילות סטטוס בלבד. לעולם לא סיסמה, סוד או טוקן. ב-429 / 427 / captcha: הודעה בעברית ויציאה, בלי ניסיון חוזר
//   (מדווחת חסימת כניסה של 48-72 שעות לחשבון, docs/02-rules/03-garmin-rules.md "לבדיקה חיה" 3).
// הקובץ יושב ב-lib/ ולא ב-scripts/ כי הבנאי כותב רק ב-lib/, api/ ו-test/. הוא לא נקרא מאף נקודת API; בשרת הוא רק נטען אם מישהו מייבא אותו.
import { pathToFileURL } from 'node:url';
import { exchangeTicket, startLogin, submitLogin, submitMfa } from './garmin.js';

export const DEFAULT_ORIGIN = 'https://yoman-system.vercel.app';
const TASK_TIMEOUT_MS = 60000; // garmin-sync בשרת עושה כמה קריאות ל-Garmin

// הודעות לכל סיבת כשל של Garmin. מה שלא ברשימה: הודעה כללית עם הקוד (קוד בלבד, בלי ערכים).
const STOP_NO_RETRY = 'לא לנסות שוב עכשיו. לחכות לפחות יום, ואז להריץ שוב פעם אחת.';
function garminFailureText(result) {
  const code = `${result.reason}${result.status ? ` (${result.status})` : ''}`;
  switch (result.reason) {
    case 'blocked': return `Garmin חסם זמנית את הכניסה (${code}). ${STOP_NO_RETRY}`;
    case 'captcha': return `Garmin ביקש captcha, ואי אפשר לפתור אותו מכאן. ${STOP_NO_RETRY}`;
    case 'bad_credentials': return 'האימייל או הסיסמה לא נכונים. אפשר להריץ שוב, אבל לא יותר מפעם-פעמיים: ניסיונות חוזרים עלולים לנעול את החשבון.';
    case 'mfa_failed': return 'קוד האימות לא התקבל. אפשר להריץ שוב עם קוד חדש.';
    case 'forbidden': return `Garmin דחה את הבקשה (${code}); כנראה חסימה של Cloudflare. ${STOP_NO_RETRY}`;
    case 'timeout': case 'network': return `אין תקשורת עם Garmin (${code}). לבדוק אינטרנט ולנסות שוב.`;
    default: return `הכניסה ל-Garmin נכשלה (${code}).`;
  }
}

// קריאה לשרת שלנו. מחזיר { status, body } (body = JSON או null) או { status:null } בכשל רשת.
async function callServer({ fetchImpl, origin, secret, task, method = 'GET', body }) {
  try {
    const response = await fetchImpl(`${origin}/api/ops?task=${task}`, {
      method,
      headers: body === undefined ? { authorization: `Bearer ${secret}` } : { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TASK_TIMEOUT_MS),
    });
    let parsed = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  } catch {
    return { status: null, body: null };
  }
}

// הזרימה כולה. כל התלויות מוזרקות. מחזיר קוד יציאה: 0 הצליח, 1 נכשל, 2 נשמר אבל המשיכה הראשונה נכשלה.
export async function runLogin({ ask, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), print = console.log, origin = DEFAULT_ORIGIN, random = Math.random }) {
  print('חיבור ל-Garmin (פעם אחת). הסיסמה לא נשמרת בשום מקום.');
  const secret = (await ask('CRON_SECRET: ', { hidden: true })).trim();

  // 1. הסוד והשרת, לפני שנוגעים ב-Garmin.
  const status = await callServer({ fetchImpl, origin, secret, task: 'garmin-status' });
  if (status.status === 401) {
    print('CRON_SECRET לא נכון. לא נוגעים ב-Garmin. לבדוק את הערך ב-Vercel ולהריץ שוב.');
    return 1;
  }
  if (status.status !== 200 || !status.body) {
    print(`השרת לא ענה כמו שצריך (${status.status ?? 'אין תקשורת'}). לא נוגעים ב-Garmin.`);
    return 1;
  }
  if (status.body.reason === 'table_missing') {
    print('הטבלאות של Garmin עוד לא נוצרו במסד. צריך להריץ קודם את פקודת המסד ב-Neon.');
    return 1;
  }
  if (status.body.config_ok === false) {
    print('בשרת חסר TOKEN_ENC_KEY תקין, אז אי אפשר לשמור את החיבור מוצפן. לא נוגעים ב-Garmin.');
    return 1;
  }
  print('השרת מוכן.');

  // 2. הכניסה ל-Garmin.
  const email = (await ask('אימייל של Garmin: ')).trim();
  let password = await ask('סיסמה של Garmin: ', { hidden: true });

  const started = await startLogin({ fetchImpl });
  if (!started.ok) {
    print(garminFailureText(started));
    return 1;
  }
  // 2-5 שניות בין דף הכניסה לשליחה, כמו בספרייה (מדווח).
  await sleep(2000 + Math.floor(random() * 3000));
  let login = await submitLogin({ email, password, cookies: started.cookies, fetchImpl });
  password = null; // לא נשאר בזיכרון של הסקריפט יותר מהנדרש
  if (!login.ok && login.reason === 'mfa_required') {
    print(`Garmin שלח קוד אימות (${login.mfaMethod}).`);
    const code = (await ask('קוד אימות: ')).trim();
    login = await submitMfa({ code, mfaMethod: login.mfaMethod, cookies: login.cookies, fetchImpl });
  }
  if (!login.ok) {
    print(garminFailureText(login));
    return 1;
  }
  const exchanged = await exchangeTicket({ ticket: login.ticket, fetchImpl });
  if (!exchanged.ok) {
    print(garminFailureText(exchanged));
    return 1;
  }
  print('הכניסה ל-Garmin הצליחה.');

  // 3. שמירה בשרת (מוצפן שם). רק הסט: access, refresh, client_id.
  const saved = await callServer({ fetchImpl, origin, secret, task: 'garmin-connect', method: 'POST', body: exchanged.tokens });
  if (saved.status !== 200 || saved.body?.ok !== true) {
    print(`השרת לא שמר את החיבור (${saved.status ?? 'אין תקשורת'} ${saved.body?.reason ?? ''}).`.trim());
    return 1;
  }
  print('החיבור נשמר בשרת.');

  // 4. משיכה ראשונה מהשרת: האם Vercel מגיע ל-Garmin (Cloudflare לא נבדק).
  const synced = await callServer({ fetchImpl, origin, secret, task: 'garmin-sync' });
  if (synced.status === 200 && synced.body?.ok === true) {
    print(`משיכה ראשונה הצליחה: ${synced.body.planned} מתוכננים, ${synced.body.done} שבוצעו.`);
    return 0;
  }
  print(`החיבור נשמר, אבל המשיכה הראשונה מהשרת נכשלה: ${synced.body?.reason ?? synced.status ?? 'אין תקשורת'}.`);
  return 2;
}

// שאלה בטרמינל. hidden: התווים לא מודפסים. עובד במצב raw (תו-תו), ולכן דורש חלון טרמינל אמיתי.
export function askLine(question, { hidden = false, input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    output.write(question);
    let value = '';
    const wasRaw = input.isRaw === true;
    input.setRawMode?.(true);
    input.setEncoding?.('utf8');
    input.resume();
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode?.(wasRaw);
      input.pause();
    };
    function onData(chunk) {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          output.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          output.write('\n');
          reject(new Error('בוטל'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            if (!hidden) output.write('\b \b');
          }
          continue;
        }
        value += ch;
        if (!hidden) output.write(ch);
      }
    }
    input.on('data', onData);
  });
}

async function main() {
  if (!process.stdin.isTTY) {
    console.log('צריך להריץ את זה בחלון טרמינל רגיל (לא דרך צינור), כדי שהסיסמה לא תוצג.');
    process.exitCode = 1;
    return;
  }
  const origin = process.env.YOMAN_ORIGIN?.trim() || DEFAULT_ORIGIN;
  try {
    process.exitCode = await runLogin({ ask: (q, o) => askLine(q, o), origin });
  } catch {
    // רק הודעה כללית: שגיאה כאן עלולה לשאת ערכים.
    console.log('הכניסה הופסקה.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
