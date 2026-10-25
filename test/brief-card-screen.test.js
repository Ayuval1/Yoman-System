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
    const noQuestions = /pinEl\.replaceChildren\(\.\.\.\(hasBrief \? \[briefNode\] : \[\]\), \.\.\.\(hasReview \? \[reviewStrip\(\)\] : \[\]\), \.\.\.\(hasBrief \? \[\] : openTasksNodes\(/.exec(body);
    assert.ok(noQuestions, 'בלי שאלות: כרטיס, ואז פס, ואז פתוחות (רק בלי כרטיס)');
    // מסלול "עם שאלות": מערך הצמתים מתחיל בכרטיס, לפני כרטיסי השאלות (cardFor) ולפני reviewStrip / openTasksNodes.
    const start = body.indexOf('const nodes = hasBrief ? [briefNode] : [];');
    assert.ok(start > 0, 'עם שאלות: nodes מתחיל בכרטיס');
    assert.ok(start < body.indexOf('cardFor('), 'לפני כרטיסי השאלות');
    assert.ok(start < body.indexOf('nodes.push(reviewStrip())'), 'לפני פס הסיכום');
    assert.ok(start < body.indexOf('nodes.push(...openTasksNodes(true))'), 'לפני רשימת הפתוחות');
    assert.match(body, /if \(hasOpen && !hasBrief\) nodes\.push\(\.\.\.openTasksNodes\(true\)\)/, 'עם שאלות: רשימה נפרדת רק בלי כרטיס');
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
    // הכותרת קבועה (יום לימודים / יום פנוי), ושורות הטקסט מהשרת (school, מבחנים) נכנסות דרך el
    assert.match(bodyOf('briefCard'), /el\('span', 'bfhead', headText\)/);
    assert.match(bodyOf('briefCard'), /typeof brief\.schoolDay === 'boolean' \? \(brief\.schoolDay \? 'יום לימודים' : 'יום פנוי'\)/);
    assert.match(bodyOf('briefCard'), /el\('span', 'bfline', examLine\)/);
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
    assert.match(body, /el\('button', 'bfseen', 'ראיתי'\)/);
    assert.match(body, /markBriefSeen\(brief\.dateIso\)/);
    assert.match(body, /renderPending\(\)/);
  });

  test('ספירות חיות מהמצב הקיים (open_tasks ו-pending בלי שנסגרו), וניסוחים: יחיד, רבים, ושמות בלי אפס', () => {
    const body = bodyOf('briefCard');
    assert.match(body, /Array\.isArray\(state\.open_tasks\) \? state\.open_tasks : \[\]/);
    assert.match(body, /const openCount = tasks\.length/);
    assert.match(body, /state\.pending\.filter\(\(question\) => !state\.dismissed\.has\(question\.id\)\)\.length/);
    const api = vm.runInNewContext(`${constLine('taskCountText')}\n${constLine('questionCountText')}\n({ taskCountText, questionCountText });`);
    assert.equal(api.taskCountText(1), 'משימה אחת פתוחה');
    assert.equal(api.taskCountText(3), '3 משימות פתוחות');
    assert.equal(api.questionCountText(1), 'שאלה אחת ממתינה');
    assert.equal(api.questionCountText(2), '2 שאלות ממתינות');
    assert.match(body, /if \(openCount > 0\) nums\.append/, 'אפס משימות: המספר מושמט');
    assert.match(body, /if \(questionCount > 0\) block\.append/, 'אפס שאלות: השורה מושמטת');
  });

  test('שורת "יום פנוי" בכרטיס זהה לזו של השרת, ומוצגת רק בלי בית ספר, בלי משימות, בלי שאלות ובלי מבחן', () => {
    assert.ok(script.includes(`const FREE_DAY_TEXT = '${FREE_DAY_LINE}'`));
    assert.match(bodyOf('briefCard'), /else if \(!schoolDay && brief\.freeDay && openCount === 0 && questionCount === 0 && brief\.exams\.length === 0\)/);
  });

  test('plan B: בלי השדה brief, null או צורה לא צפויה: אין כרטיס; שדה תקין מנורמל', () => {
    const validBrief = extract('validBrief');
    for (const bad of [undefined, null, 5, 'x', {}, { dateIso: '2026-10-21' }, { dateIso: 1, title: 'א', text: 'ב' }]) assert.equal(validBrief(bad), null);
    const good = validBrief({ dateIso: '2026-10-21', title: 'בריף', text: 'טקסט', school: '', exams: ['היום: מבחן', 7], freeDay: 'כן' });
    assert.deepEqual(JSON.parse(JSON.stringify(good)), { dateIso: '2026-10-21', title: 'בריף', text: 'טקסט', school: null, exams: ['היום: מבחן'], freeDay: false, schoolLessons: null, schoolStartsAt: null, schoolEndsAt: null, schoolDay: null });
    // schoolDay: רק true/false נשמרים; כל השאר (שרת ישן, מחרוזת, מספר) null = לא ידוע
    const day = (value) => JSON.parse(JSON.stringify(validBrief({ dateIso: '2026-10-22', title: 'בריף', text: 'ט', schoolDay: value }))).schoolDay;
    assert.deepEqual([day(true), day(false), day(null), day(undefined), day('true'), day(1)], [true, false, null, null, null, null]);
    // שדות חדשים: מספר שלם לא שלילי ושעה HH:MM; כל השאר null
    const withNew = (extra) => JSON.parse(JSON.stringify(validBrief({ dateIso: '2026-10-22', title: 'בריף', text: 'ט', ...extra })));
    const ok = withNew({ schoolLessons: 9, schoolStartsAt: '08:15', schoolEndsAt: '15:45' });
    assert.deepEqual([ok.schoolLessons, ok.schoolStartsAt, ok.schoolEndsAt], [9, '08:15', '15:45']);
    assert.equal(withNew({ schoolLessons: 0 }).schoolLessons, 0, 'אפס שיעורים תקין');
    for (const bad of [-1, 2.5, NaN, Infinity, '9', null, undefined, {}]) assert.equal(withNew({ schoolLessons: bad }).schoolLessons, null, `שיעורים ${String(bad)}`);
    for (const bad of ['8:15', '08:15:00', '0815', 815, null, '', 'ab:cd', '08:15 ']) {
      assert.equal(withNew({ schoolStartsAt: bad }).schoolStartsAt, null, `שעה ${String(bad)}`);
      assert.equal(withNew({ schoolEndsAt: bad }).schoolEndsAt, null, `שעה ${String(bad)}`);
    }
    // briefCard מחזיר null כשאין brief; GET ו-applyServerLists קוראים ל-validBrief
    assert.match(bodyOf('briefCard'), /if \(!brief \|\| briefIsSeen\(brief\.dateIso\)\) return null/);
    assert.match(bodyOf('loadOnce'), /state\.brief = validBrief\(data\?\.brief\)/);
    assert.match(bodyOf('applyServerLists'), /'brief' in data\) state\.brief = validBrief\(data\.brief\)/);
  });

  // --- הרצה של briefCard ו-renderPending על DOM מזויף מינימלי: מבנה הכרטיס בכל מצב, והרשימה הנפרדת ---
  class FakeNode {
    constructor(tag) { this.tag = tag; this.className = ''; this.textContent = ''; this.childNodes = []; this.attrs = {}; this.handlers = {}; this.style = {}; }
    append(...kids) { this.childNodes.push(...kids); }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    hasClass(name) { return this.className.split(' ').includes(name); }
    find(name) { const out = []; const walk = (node) => { if (node.hasClass(name)) out.push(node); node.childNodes.forEach(walk); }; walk(this); return out; }
    collect() { return [this.textContent, ...this.childNodes.flatMap((node) => node.collect())].filter((text) => text !== ''); }
  }
  function makeCardEnv(stateInit) {
    const state = { brief: null, open_tasks: [], pending: [], dismissed: new Set(), busy: new Set(), notes: new Map(), briefSeen: null, bfOpen: false, review: { total: 0, items: [] }, stackOpen: false, focusId: null, ...stateInit };
    const calls = { openBrief: 0, done: [] };
    const pinEl = { hidden: true, classList: { remove() {}, toggle() {} }, children: [], replaceChildren(...nodes) { this.children = nodes; } };
    const code = `
      const FREE_DAY_TEXT = ${JSON.stringify(FREE_DAY_LINE)};
      const BRIEF_TIME_TEXT = '07:30';
      const BRIEF_SEEN_PREFIX = 'brief-seen-';
      ${constLine('briefSeenKey')}
      ${constLine('taskCountText')}
      ${constLine('questionCountText')}
      ${bodyOf('el')}
      ${bodyOf('dueLabel')}
      ${bodyOf('briefIsSeen')}
      ${bodyOf('markBriefSeen')}
      ${bodyOf('openTaskRow')}
      ${bodyOf('openTasksNodes')}
      ${bodyOf('nearestDueLabel')}
      ${bodyOf('bfNumber')}
      ${bodyOf('briefCard')}
      ${bodyOf('renderPending')}
      ({ briefCard, renderPending });
    `;
    const ctx = {
      state, pinEl, document: { createElement: (tag) => new FakeNode(tag) }, Intl,
      localStorage: { getItem() { return null; }, setItem() {} },
      openBrief() { calls.openBrief++; }, closeBrief() {},
      sendTaskDone(id) { calls.done.push(id); },
      reviewStrip: () => new FakeNode('review'),
      cardFor: () => new FakeNode('qcard'),
    };
    const api = vm.runInNewContext(code, ctx);
    return { state, pinEl, calls, ...api };
  }
  const SCHOOL = { dateIso: '2026-10-22', title: 'בריף · יום חמישי 22.10', text: 'טקסט מלא', school: '9 שיעורים · 08:15–15:45', exams: [], freeDay: false, schoolLessons: 9, schoolStartsAt: '08:15', schoolEndsAt: '15:45' };
  const FREE = { dateIso: '2026-10-24', title: 'בריף · שבת 24.10', text: 'טקסט', school: null, exams: [], freeDay: true, schoolLessons: null, schoolStartsAt: null, schoolEndsAt: null };
  const TASK = { id: 't1', title: 'שיעורי בית · אנגלית', due_at: '2026-10-24T21:15:00.000Z', media_count: 0 };

  test('מבנה כרטיס ב2 ביום לימודים: שורת "הבריף של היום" ו-07:30, כותרת, שני מספרים עם שעות בשורה אחת ו"עד 25.10", משימה ו"ראיתי"', () => {
    const env = makeCardEnv({ brief: SCHOOL, open_tasks: [TASK] });
    const card = env.briefCard();
    const block = card.find('bfblock')[0];
    assert.equal(block.tag, 'button');
    block.handlers.click();
    assert.equal(env.calls.openBrief, 1, 'לחיצה על הגוש פותחת את המסך המלא');
    assert.deepEqual(block.find('bftop')[0].collect(), ['הבריף של היום', '07:30']);
    assert.equal(block.find('bfhead')[0].textContent, 'יום לימודים');
    const nums = block.find('bfnum');
    assert.deepEqual(nums.map((node) => node.collect()), [['9', 'שיעורים', '08:15–15:45'], ['1', 'משימה', 'עד 25.10']]);
    assert.ok(nums[0].find('bfs')[0].hasClass('bfltr'), 'שעות: direction ltr');
    assert.match(html, /\.bfs \{[^}]*white-space: nowrap/);
    assert.match(html, /\.bfltr \{[^}]*direction: ltr/);
    const body = card.find('bfbody')[0];
    assert.equal(body.find('bftask').length, 1);
    assert.deepEqual(body.find('bftask')[0].collect(), ['שיעורי בית · אנגלית', 'עד 25.10', 'בוצע']);
    assert.equal(body.childNodes.at(-1).textContent, 'ראיתי', '"ראיתי" מתחת למשימה');
    assert.equal(card.find('bfline').length, 0, 'אין שורות נוספות');
  });

  test('יום פנוי: כותרת "יום פנוי"; משימות כמספר בלבד; בלי משימות, מבחנים ושאלות: שורת FREE_DAY_TEXT; בלי משימות אין שורת משימה, נשאר "ראיתי"', () => {
    const withTasks = makeCardEnv({ brief: { ...FREE, freeDay: false, schoolDay: false }, open_tasks: [TASK, { ...TASK, id: 't2', due_at: null }] }).briefCard();
    assert.equal(withTasks.find('bfhead')[0].textContent, 'יום פנוי');
    assert.deepEqual(withTasks.find('bfnum').map((node) => node.collect()), [['2', 'משימות', 'עד 25.10']]);
    const empty = makeCardEnv({ brief: FREE }).briefCard();
    assert.deepEqual(empty.find('bfline').map((node) => node.textContent), [FREE_DAY_LINE]);
    assert.equal(empty.find('bfnum').length, 0);
    assert.equal(empty.find('bftask').length, 0, 'אין משימות: אין שורה');
    assert.deepEqual(empty.find('bfbody')[0].collect(), ['ראיתי']);
    // יום פנוי עם שאלה ממתינה: בלי שורת FREE_DAY_TEXT
    const asked = makeCardEnv({ brief: FREE, pending: [{ id: 'q1' }] }).briefCard();
    assert.deepEqual(asked.find('bfline').map((node) => node.textContent), ['שאלה אחת ממתינה']);
  });

  test('יום עם מבחן: שורות "היום: ..." בתוך הגוש; שאלות ממתינות: שורה קטנה בגוש (בלי שאלות שנסגרו)', () => {
    const exam = makeCardEnv({
      brief: { ...SCHOOL, exams: ['היום: מבחן בחשבון'] }, open_tasks: [TASK],
      pending: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }], dismissed: new Set(['q3']),
    }).briefCard();
    assert.deepEqual(exam.find('bfblock')[0].find('bfline').map((node) => node.textContent), ['היום: מבחן בחשבון', '2 שאלות ממתינות']);
    assert.equal(exam.find('bfbody')[0].find('bfline').length, 0, 'השורות בגוש ולא בגוף');
  });

  test('"יום פנוי" רק כשידוע שאין בית ספר: מערכת שעות חסרה (schoolDay null, בלי freeDay) לא מציגה טענה, אלא את כותרת הבריף', () => {
    const unknown = { ...FREE, freeDay: false, schoolDay: null };
    assert.equal(makeCardEnv({ brief: unknown }).briefCard().find('bfhead')[0].textContent, FREE.title);
    assert.equal(makeCardEnv({ brief: unknown, open_tasks: [TASK] }).briefCard().find('bfhead')[0].textContent, FREE.title, 'גם עם משימות');
    assert.equal(makeCardEnv({ brief: { ...unknown, schoolDay: false }, open_tasks: [TASK] }).briefCard().find('bfhead')[0].textContent, 'יום פנוי', 'ידוע שאין בית ספר, עם משימות');
    assert.equal(makeCardEnv({ brief: { ...SCHOOL, schoolDay: true } }).briefCard().find('bfhead')[0].textContent, 'יום לימודים');
    // בלי שורת "אין בית ספר ואין משימות" כשלא ידוע
    assert.equal(makeCardEnv({ brief: unknown }).briefCard().find('bfline').length, 0);
  });

  test('שרת ישן בלי השדות החדשים: חוזרים לשורת school הטקסטואלית, בלי שבירה', () => {
    const old = { ...SCHOOL, schoolLessons: null, schoolStartsAt: null, schoolEndsAt: null };
    const card = makeCardEnv({ brief: old, open_tasks: [TASK] }).briefCard();
    assert.equal(card.find('bfhead')[0].textContent, 'יום לימודים');
    assert.deepEqual(card.find('bfline').map((node) => node.textContent), [SCHOOL.school]);
    assert.deepEqual(card.find('bfnum').map((node) => node.collect()), [['1', 'משימה', 'עד 25.10']]);
    // שיעורים בלי שעות: מספר בלי שורת שעות
    const noHours = makeCardEnv({ brief: { ...SCHOOL, schoolStartsAt: null } }).briefCard();
    assert.deepEqual(noHours.find('bfnum').map((node) => node.collect()), [['9', 'שיעורים']]);
  });

  test('הרשימה הנפרדת "פתוחות" לא מצוירת כל עוד הכרטיס מוצג (בשני המסלולים), וחוזרת אחרי "ראיתי"', () => {
    for (const pending of [[], [{ id: 'q1' }]]) {
      const env = makeCardEnv({ brief: SCHOOL, open_tasks: [TASK], pending });
      env.renderPending();
      const shown = env.pinEl.children;
      assert.ok(shown[0].hasClass('bf2'), 'הכרטיס ראשון');
      assert.equal(shown.filter((node) => node.hasClass('exhead')).length, 0, 'אין כותרת "פתוחות"');
      assert.equal(shown.filter((node) => node.hasClass('mini') && node.hasClass('openrow')).length, 0, 'אין שורות נפרדות');
      assert.equal(shown.flatMap((node) => node.find('bftask')).length, 1, 'המשימה בתוך הכרטיס');
      // "ראיתי": הכרטיס נעלם והרשימה חוזרת
      env.state.briefSeen = SCHOOL.dateIso;
      env.renderPending();
      const after = env.pinEl.children;
      assert.equal(after.filter((node) => node.hasClass('bf2')).length, 0, 'הכרטיס נעלם');
      assert.equal(after.filter((node) => node.hasClass('exhead')).length, 1, 'הרשימה חזרה');
      assert.equal(after.filter((node) => node.hasClass('openrow')).length, 1);
    }
  });

  test('שורה לכל משימה בכרטיס (הכרעת יובל, 22.10): שלוש משימות = שלוש שורות עם "בוצע", לפי סדר הרשימה, ו"ראיתי" אחרונה', () => {
    const tasks = [TASK, { ...TASK, id: 't2', title: 'דף תרגילים', due_at: null }, { ...TASK, id: 't3', title: 'מחברת' }];
    const body = makeCardEnv({ brief: SCHOOL, open_tasks: tasks }).briefCard().find('bfbody')[0];
    assert.equal(body.find('bftask').length, 3);
    assert.deepEqual(body.find('bftask').map((row) => row.find('odone').length), [1, 1, 1]);
    assert.deepEqual(body.find('bftask').map((row) => row.collect()[0]), ['שיעורי בית · אנגלית', 'דף תרגילים', 'מחברת']);
    assert.equal(body.childNodes.at(-1).textContent, 'ראיתי');
    assert.doesNotMatch(bodyOf('briefCard'), /tasks\[0\]/);
  });

  test('"ראיתי" בכרטיס מסמן ומסתיר; "בוצע" בכרטיס שולח task_done, והמספר יורד כש-state.open_tasks מתעדכן', () => {
    const env = makeCardEnv({ brief: SCHOOL, open_tasks: [TASK, { ...TASK, id: 't2', due_at: '2026-10-26T21:15:00.000Z' }] });
    const first = env.briefCard();
    assert.deepEqual(first.find('bfnum')[1].collect(), ['2', 'משימות', 'עד 25.10']);
    first.find('odone')[0].handlers.click();
    assert.deepEqual(env.calls.done, ['t1']);
    env.state.open_tasks = env.state.open_tasks.filter((task) => task.id !== 't1'); // מה ש-sendTaskDone עושה
    const second = env.briefCard();
    assert.deepEqual(second.find('bfnum')[1].collect(), ['1', 'משימה', 'עד 26.10']);
    env.state.open_tasks = [];
    assert.equal(env.briefCard().find('bftask').length, 0);
    // "ראיתי"
    env.briefCard().find('bfseen')[0].handlers.click();
    assert.equal(env.state.briefSeen, SCHOOL.dateIso);
    assert.equal(env.briefCard(), null);
  });

  test('CSS של k1 (25.10): כרטיס בהיר מטוקני --bf-*, אריחים עם מספר מעל הכיתוב, מספרים 40px וכותרת 30px, בלי צבע קבוע', () => {
    const css = html.slice(html.indexOf('.bfcard.bf2 {'), html.indexOf('.bfseen {'));
    assert.match(css, /\.bfcard\.bf2 \{ background: var\(--bf-bg\)/);
    assert.doesNotMatch(css, /linear-gradient/);
    assert.match(css, /\.bfnum \{[^}]*flex-direction: column[^}]*background: var\(--bf-tile\)/);
    assert.match(css, /\.bfn \{ font-size: 40px/);
    assert.match(css, /\.bfhead \{ font-size: 30px/);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    // כל טוקן --bf-* שהדף משתמש בו מוגדר ב-tokens.css
    const tokens = readFileSync(new URL('../public/tokens.css', import.meta.url), 'utf8');
    for (const name of new Set(css.match(/--bf-[a-z]+/g) ?? [])) {
      assert.match(tokens, new RegExp(`${name}:\\s*(#|rgba?\\()`), `${name} חסר ב-tokens.css`);
    }
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
