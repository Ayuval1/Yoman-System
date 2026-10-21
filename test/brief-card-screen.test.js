// כרטיס הבריף החי בדף האפליקציה (docs/08-chapter8/68, הכרעת יובל 21.10.2026: כרטיס בנוסף להודעת הבוקר בצ'אט).
// public/index.html הוא סקריפט inline בלי מודולים נפרדים, ולכן אין כאן בדיקת התנהגות בדפדפן: בדיקות צורה על הקובץ
// (סדר הציור, localStorage בתוך try/catch, מפתח לפי תאריך, textContent בלבד, המסך המלא, והמספר על האייקון) והרצה של העזרים הטהורים.
// ההוכחה האמיתית (מראה, לחיצה, "ראיתי" על האייפון) היא בדיקה של יובל מצילום מסך.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { FREE_DAY_LINE } from '../lib/brief-view.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../public/index.html');
const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

// גוף פונקציה אחת מהסקריפט (עד הסוגר שבתחילת שורה), לבדיקות צורה.
function bodyOf(name) {
  const match = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(script);
  assert.ok(match, `הפונקציה ${name} קיימת`);
  return match[0];
}
const extract = (name) => vm.runInNewContext(`(${bodyOf(name)})`);
// שורת const אחת (arrow) מהסקריפט.
function constLine(name) {
  const match = new RegExp(`^const ${name} = .*;$`, 'm').exec(script);
  assert.ok(match, `השורה ${name} קיימת`);
  return match[0];
}
// קטע הכרטיס כולו: מהכותרת שלו עד renderPending.
const briefBlock = script.slice(script.indexOf('// --- כרטיס הבריף החי'), script.indexOf('function renderPending() {'));

describe('public/index.html: כרטיס הבריף החי', () => {
  test('הסקריפט תקין תחבירית', () => {
    assert.ok(briefBlock.length > 1000, 'קטע הכרטיס נמצא');
    assert.doesNotThrow(() => new vm.Script(script.replace(/^export /gm, '')));
  });

  test('renderPending: הכרטיס מצויר ראשון, לפני השאלות, פס הסיכום ורשימת הפתוחות', () => {
    const body = bodyOf('renderPending');
    assert.match(body, /const briefNode = briefCard\(\)/);
    // מסלול "בלי שאלות": הכרטיס לפני פס הסיכום ולפני openTasksNodes.
    const noQuestions = /pinEl\.replaceChildren\(\.\.\.\(hasBrief \? \[briefNode\] : \[\]\), \.\.\.\(hasReview \? \[reviewStrip\(\)\] : \[\]\), \.\.\.openTasksNodes\(/.exec(body);
    assert.ok(noQuestions, 'בלי שאלות: כרטיס, ואז פס, ואז פתוחות');
    // מסלול "עם שאלות": מערך הצמתים מתחיל בכרטיס, לפני כרטיסי השאלות (cardFor) ולפני reviewStrip / openTasksNodes.
    const start = body.indexOf('const nodes = hasBrief ? [briefNode] : [];');
    assert.ok(start > 0, 'עם שאלות: nodes מתחיל בכרטיס');
    assert.ok(start < body.indexOf('cardFor('), 'לפני כרטיסי השאלות');
    assert.ok(start < body.indexOf('nodes.push(reviewStrip())'), 'לפני פס הסיכום');
    assert.ok(start < body.indexOf('nodes.push(...openTasksNodes(true))'), 'לפני רשימת הפתוחות');
    // כרטיס לבדו מחזיק את האזור הנעוץ גלוי.
    assert.match(body, /!hasOpen && !hasBrief\)/);
  });

  test('"ראיתי": localStorage רק בתוך try/catch (קריאה, כתיבה, ניקוי); כשל אחסון לא שובר', () => {
    for (const name of ['briefIsSeen', 'markBriefSeen', 'cleanOldBriefKeys']) {
      const body = bodyOf(name);
      assert.match(body, /try \{[\s\S]*localStorage[\s\S]*\} catch/, `${name}: בתוך try/catch`);
      // כל אזכור של localStorage נמצא אחרי "try {" ולפני ה-catch
      const beforeTry = body.slice(0, body.indexOf('try {'));
      assert.doesNotMatch(beforeTry, /localStorage/, `${name}: אין גישה לפני ה-try`);
    }
    // אין גישה ל-localStorage בקטע הכרטיס מחוץ לשלוש הפונקציות הללו
    const outside = briefBlock.replace(bodyOf('briefIsSeen'), '').replace(bodyOf('markBriefSeen'), '').replace(bodyOf('cleanOldBriefKeys'), '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(outside, /localStorage/);
  });

  test('כשאין אחסון: markBriefSeen לא זורק, והכרטיס מוסתר בזיכרון עד רענון; briefIsSeen לא זורק', () => {
    const run = new vm.Script(`
      const state = { briefSeen: null };
      const BRIEF_SEEN_PREFIX = 'brief-seen-';
      ${constLine('briefSeenKey')}
      const localStorage = { getItem() { throw new Error('חסום'); }, setItem() { throw new Error('חסום'); } };
      ${bodyOf('briefIsSeen')}
      ${bodyOf('markBriefSeen')}
      const before = briefIsSeen('2026-10-21');
      markBriefSeen('2026-10-21');
      [before, briefIsSeen('2026-10-21'), briefIsSeen('2026-10-22')];
    `);
    assert.equal(JSON.stringify(run.runInNewContext({})), '[false,true,false]');
  });

  test('המפתח לפי תאריך ישראלי: brief-seen-YYYY-MM-DD, ומפתחות של ימים קודמים נמחקים (רק אלה)', () => {
    const store = new Map([['brief-seen-2026-10-20', '1'], ['brief-seen-2026-10-21', '1'], ['yoman_intake_secret', 'x']]);
    const localStorage = {
      get length() { return store.size; },
      key: (index) => [...store.keys()][index] ?? null,
      removeItem: (key) => store.delete(key),
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    };
    const api = vm.runInNewContext(`
      const BRIEF_SEEN_PREFIX = 'brief-seen-';
      ${constLine('briefSeenKey')}
      ${bodyOf('cleanOldBriefKeys')}
      ({ briefSeenKey, cleanOldBriefKeys });
    `, { localStorage });
    assert.equal(api.briefSeenKey('2026-10-21'), 'brief-seen-2026-10-21');
    api.cleanOldBriefKeys('2026-10-21');
    assert.deepEqual([...store.keys()].sort(), ['brief-seen-2026-10-21', 'yoman_intake_secret']);
    assert.ok(script.includes("const BRIEF_SEEN_PREFIX = 'brief-seen-'"));
    assert.match(bodyOf('markBriefSeen'), /briefSeenKey\(dateIso\)/);
    assert.match(script, /brief\.dateIso/, 'התאריך מגיע מהשרת (התאריך הישראלי), לא משעון המכשיר');
  });

  test('טקסט מהשרת נכנס רק דרך textContent (el): אין innerHTML, outerHTML או insertAdjacentHTML בקטע הכרטיס והמסך המלא', () => {
    assert.doesNotMatch(briefBlock, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    assert.match(bodyOf('briefCard'), /el\('span', 't', brief\.title\)/);
    assert.match(bodyOf('renderBriefScreen'), /el\('div', 'txt', state\.brief\.text\)/);
    // el עצמה משתמשת ב-textContent
    assert.match(bodyOf('el'), /textContent = String\(text\)/);
  });

  test('המסך המלא: אלמנט #bf עם role="dialog" ו-aria-modal, כמו #rv, נסגר ב"סגור" וב-Escape', () => {
    assert.match(html, /<section class="rvscreen" id="bf" role="dialog" aria-modal="true" aria-label="[^"]+" hidden>/);
    assert.match(html, /id="bfClose"/);
    assert.match(html, /id="bfBody"/);
    assert.match(script, /bfCloseBtn\.addEventListener\('click', closeBrief\)/);
    assert.match(script, /event\.key === 'Escape' && state\.bfOpen\) closeBrief\(\)/);
    assert.match(bodyOf('openBrief'), /bfEl\.hidden = false/);
    assert.match(bodyOf('closeBrief'), /bfEl\.hidden = true/);
    // מצויר מחדש עם כל render, כדי שהטקסט יהיה טרי
    assert.match(bodyOf('render'), /renderBriefScreen\(\)/);
  });

  test('שתי הכפתורים בכרטיס: אזור לחיצה ראשי שפותח את המסך המלא, ו"ראיתי" שמסמן ומסתיר', () => {
    const body = bodyOf('briefCard');
    assert.match(body, /addEventListener\('click', openBrief\)/);
    assert.match(body, /el\('button', 'odone', 'ראיתי'\)/);
    assert.match(body, /markBriefSeen\(brief\.dateIso\)/);
    assert.match(body, /renderPending\(\)/);
  });

  test('ספירות חיות מהמצב הקיים (open_tasks ו-pending בלי שנסגרו), וניסוחים: יחיד, רבים, ושמות בלי אפס', () => {
    const body = bodyOf('briefCard');
    assert.match(body, /state\.open_tasks\.length/);
    assert.match(body, /state\.pending\.filter\(\(question\) => !state\.dismissed\.has\(question\.id\)\)\.length/);
    const api = vm.runInNewContext(`${constLine('taskCountText')}\n${constLine('questionCountText')}\n({ taskCountText, questionCountText });`);
    assert.equal(api.taskCountText(1), 'משימה אחת פתוחה');
    assert.equal(api.taskCountText(3), '3 משימות פתוחות');
    assert.equal(api.questionCountText(1), 'שאלה אחת ממתינה');
    assert.equal(api.questionCountText(2), '2 שאלות ממתינות');
    assert.match(body, /if \(openCount > 0\) counts\.push/, 'אפס: מושמט');
    assert.match(body, /if \(questionCount > 0\) counts\.push/, 'אפס: מושמט');
  });

  test('שורת "יום פנוי" בכרטיס זהה לזו של השרת, ומוצגת רק בלי בית ספר, בלי משימות, בלי שאלות ובלי מבחן', () => {
    assert.ok(script.includes(`const FREE_DAY_TEXT = '${FREE_DAY_LINE}'`));
    assert.match(bodyOf('briefCard'), /else if \(brief\.freeDay && openCount === 0 && questionCount === 0 && brief\.exams\.length === 0\)/);
  });

  test('plan B: בלי השדה brief, null או צורה לא צפויה: אין כרטיס; שדה תקין מנורמל', () => {
    const validBrief = extract('validBrief');
    for (const bad of [undefined, null, 5, 'x', {}, { dateIso: '2026-10-21' }, { dateIso: 1, title: 'א', text: 'ב' }]) assert.equal(validBrief(bad), null);
    const good = validBrief({ dateIso: '2026-10-21', title: 'בריף', text: 'טקסט', school: '', exams: ['היום: מבחן', 7], freeDay: 'כן' });
    assert.deepEqual(JSON.parse(JSON.stringify(good)), { dateIso: '2026-10-21', title: 'בריף', text: 'טקסט', school: null, exams: ['היום: מבחן'], freeDay: false });
    // briefCard מחזיר null כשאין brief; GET ו-applyServerLists קוראים ל-validBrief
    assert.match(bodyOf('briefCard'), /if \(!brief \|\| briefIsSeen\(brief\.dateIso\)\) return null/);
    assert.match(bodyOf('loadOnce'), /state\.brief = validBrief\(data\?\.brief\)/);
    assert.match(bodyOf('applyServerLists'), /'brief' in data\) state\.brief = validBrief\(data\.brief\)/);
  });

  test('המספר על האייקון: שום קוד של ה-badge לא מתייחס לבריף', () => {
    assert.doesNotMatch(bodyOf('setBadge').replace(/export async /, ''), /brief/i);
    // כל קריאה ל-setBadge מקבלת רק ערך badge מהשרת
    const calls = script.match(/setBadge\([^)]*\)/g) ?? [];
    assert.ok(calls.length >= 4);
    for (const call of calls) assert.doesNotMatch(call, /brief|state\.open_tasks|\.length/i, call);
    // הכרטיס עצמו לא קורא ל-setBadge
    assert.doesNotMatch(briefBlock.replace(/\/\/.*$/gm, ''), /setBadge|navigator\.(set|clear)AppBadge/);
    // השרת: badgeFrom, ספירת האייקון, וסיכום היום לא יודעים על בריף
    const chatView = read('../lib/chat-view.js');
    const badgeFrom = /export function badgeFrom[\s\S]*?\n\}/.exec(chatView)?.[0] ?? '';
    assert.ok(badgeFrom.length > 0);
    assert.doesNotMatch(badgeFrom, /brief/i);
    const chatApi = read('../api/chat.js');
    const loadBadge = /async function loadBadge[\s\S]*?\n\}/.exec(chatApi)?.[0] ?? '';
    assert.ok(loadBadge.length > 0);
    assert.doesNotMatch(loadBadge, /brief/i);
    assert.doesNotMatch(read('../lib/review-view.js'), /briefCard|state\.brief/);
  });
});
