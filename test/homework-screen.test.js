// מסך שאלת שיעורי הבית ורשימת "פתוחות" (שלב 8.6-2; מפרט: docs/08-chapter8/60-chapter8-step-8-6-spec.md).
// public/index.html הוא סקריפט inline בלי מודולים נפרדים, ולכן אין בדיקת התנהגות בדפדפן: כאן בדיקות צורה על הקובץ
// (הסקריפט נטען כתחביר תקין, הנוסחים והפעולות קיימים, כרטיס שיעורי בית לא עובר דרך מסלול הכפתורים-טקסט) והרצה של שני העזרים הטהורים.
// ההוכחה האמיתית של קריטריונים 9-10 היא בדיקה של יובל על האייפון.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

// חותך פונקציה אחת (עד הסוגר שבתחילת שורה) ומריץ אותה בבידוד.
function extract(name) {
  const match = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(script);
  assert.ok(match, `הפונקציה ${name} קיימת ב-public/index.html`);
  return vm.runInNewContext(`(${match[0]})`);
}

// גוף פונקציה אחת מהסקריפט, לבדיקות צורה.
function bodyOf(name) {
  const match = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(script);
  assert.ok(match, `הפונקציה ${name} קיימת`);
  return match[0];
}

describe('public/index.html: שלב 8.6-2', () => {
  test('הסקריפט תקין תחבירית (בלי export, כי vm.Script אינו מודול)', () => {
    assert.ok(script.length > 1000);
    assert.doesNotThrow(() => new vm.Script(script.replace(/^export /gm, '')));
  });

  test('ymdLabel: YYYY-MM-DD -> d.M בלי אפס מוביל; פורמט אחר = ריק', () => {
    const ymdLabel = extract('ymdLabel');
    assert.equal(ymdLabel('2026-10-22'), '22.10');
    assert.equal(ymdLabel('2026-01-05'), '5.1');
    assert.equal(ymdLabel('22.10'), '');
    assert.equal(ymdLabel(null), '');
  });

  test('dueLabel: היום בישראל, גם כשה-UTC עוד ביום הקודם; לא תאריך = ריק', () => {
    const dueLabel = extract('dueLabel');
    // 09:03 שעון ישראל ב-22.10.2026 (UTC+3) = 06:03Z
    assert.equal(dueLabel('2026-10-22T06:03:00.000Z'), '22.10');
    // 00:30 שעון ישראל ב-29.10.2026 (UTC+2 אחרי מעבר השעון) = 22:30Z ב-28.10
    assert.equal(dueLabel('2026-10-28T22:30:00.000Z'), '29.10');
    assert.equal(dueLabel('לא תאריך'), '');
    assert.equal(dueLabel(undefined), '');
  });

  test('questionText: שאלת שיעורי בית נגזרת מהמקצוע; שאלה רגילה נשארת כמו שהיא', () => {
    const questionText = extract('questionText');
    assert.equal(questionText({ kind: 'homework', subject: 'מתמטיקה' }), 'מתמטיקה: היו שיעורי בית?');
    assert.equal(questionText({ kind: 'homework', subject: null }), 'היו שיעורי בית?');
    assert.equal(questionText({ text: 'על איזה נושא?' }), 'על איזה נושא?');
  });

  test('הנוסחים מההחלטות: "לא היו", "היו שיעורי בית", "השיעור הבא", "סגור", unclear', () => {
    for (const text of ["'לא היו'", "'היו שיעורי בית'", 'השיעור הבא (', 'השיעור הבא כבר עבר', "'סגור'", 'לא הצלחתי לחשב תאריך. נסה שוב', "'מה למדתם?'", "'פתוחות'", "'בוצע'", "'תמונה אחת'"]) {
      assert.ok(script.includes(text), `חסר: ${text}`);
    }
  });

  test('כרטיס שיעורי בית: אין "לא יודע", אין תיבת כתיבה חופשית, ו"סגור" מקומי בלבד (בלי שליחה לשרת)', () => {
    const card = bodyOf('homeworkCard');
    assert.doesNotMatch(card, /לא יודע/);
    assert.doesNotMatch(card, /qfield[\s\S]*?type = 'submit'/, 'אין כפתור שליחה/טופס כתיבה בכרטיס');
    assert.doesNotMatch(card, /createElement\('form'\)|el\('form'/);
    assert.doesNotMatch(card, /sendAnswer|postChat/);
    // ענף "סגור": מסתיר מקומית
    const closed = /if \(dates\.length === 0\) \{[\s\S]*?\n  \}/.exec(card)?.[0] ?? '';
    assert.match(closed, /state\.dismissed\.add/);
    assert.doesNotMatch(closed, /sendHomework|postChat|fetch/);
  });

  test('כרטיס שיעורי בית לא עובר דרך questionCard; ההכרעה בין הכרטיסים לפי kind', () => {
    assert.doesNotMatch(bodyOf('homeworkCard'), /questionCard/);
    assert.match(script, /question\.kind === 'homework' \? homeworkCard\(question, options\) : questionCard\(question, options\)/);
    // renderPending משתמש ב-cardFor ולא קורא ל-questionCard ישירות
    assert.doesNotMatch(bodyOf('renderPending'), /questionCard\(/);
    assert.match(bodyOf('renderPending'), /cardFor\(current/);
    // המסלול הרגיל נשאר: כפתורי טקסט ו-allowFreeText
    const regular = bodyOf('questionCard');
    assert.match(regular, /Array\.isArray\(question\.buttons\)/);
    assert.match(regular, /allowFreeText !== false/);
  });

  test('הפעולות: homework עם due:next רק כש-had, topic רק כשלא ריק; task_done; נעילה נגד לחיצה כפולה', () => {
    const send = bodyOf('sendHomework');
    assert.match(send, /action: 'homework'/);
    assert.match(send, /if \(had\) body\.due = 'next'/);
    assert.match(send, /if \(topic\) body\.topic = topic/);
    assert.match(send, /state\.busy\.has\(messageId\)\) return/);
    assert.match(send, /status === 'unclear'/);
    const done = bodyOf('sendTaskDone');
    assert.match(done, /action: 'task_done', task_id: taskId/);
    assert.match(done, /state\.busy\.has\(taskId\)\) return/);
  });

  test('open_tasks נטען מ-GET ומתשובות homework ו-task_done, והמספר על האייקון מתעדכן מהתשובות', () => {
    assert.match(bodyOf('loadOnce'), /state\.open_tasks = Array\.isArray\(data\?\.open_tasks\)/);
    const lists = bodyOf('applyServerLists');
    assert.match(lists, /state\.open_tasks = data\.open_tasks/);
    assert.match(lists, /state\.pending = data\.pending/);
    assert.match(lists, /setBadge\(data\.badge\)/);
    assert.match(bodyOf('sendHomework'), /applyServerLists\(data\)/);
    assert.match(bodyOf('sendTaskDone'), /applyServerLists\(data\)/);
  });

  test("רשימת הפתוחות נעוצה בראש הצ'אט ומוסתרת כשהיא ריקה, ולא שוברת את הערימה ואת פס הסיכום", () => {
    const render = bodyOf('renderPending');
    assert.match(render, /!hasReview && !hasOpen/);
    assert.match(render, /openTasksNodes\(/);
    assert.match(render, /reviewStrip\(\)/);
    assert.match(render, /state\.stackOpen/);
    assert.match(bodyOf('openTasksNodes'), /list\.length === 0\) return \[\]/);
  });

  test('אין צבע, גופן או מחלקה בלי טוקן בעיצוב החדש: מחלקות .openrow / .odone בנויות ממשתנים קיימים', () => {
    const css = /\.openrow \{[\s\S]*?\.odone \{[\s\S]*?\}/.exec(html)?.[0] ?? '';
    assert.ok(css.length > 0, 'בלוק ה-CSS של הפתוחות קיים');
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|font-family/);
  });
});
