// בדיקות ל-lib/brief-view.js (שלב B-1, docs/08-chapter8/68: D1-D5, D8, D15-D17 ותבנית ההודעה). מערכת השעות האמיתית; המשימות והשאלות מומצאות, בלי טקסט הודעה אמיתי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composeBrief, schoolSummary, briefEntityId, briefPushText, BRIEF_PUSH_WAITING, BRIEF_FOOTER, FREE_DAY_LINE } from '../lib/brief-view.js';
import { parseTimetableMarkdown } from '../lib/timetable.js';

const TIMETABLE = parseTimetableMarkdown(readFileSync(new URL('../data/school-timetable-taf-shin-pe-zayin.md', import.meta.url), 'utf8'));
// due_at כפי שמסד Postgres מחזיר: חצות ישראל = 21:00 או 22:00 UTC. כאן שעת הצהריים, כדי שהתאריך הישראלי ברור.
const due = (iso) => `${iso}T09:00:00.000Z`;
const linesOf = (text) => text.split('\n');

describe('brief-view: יום עם 9 שיעורים ו-3 משימות (התבנית בסעיף 6 של ה-PRD, שני 26.10.2026)', () => {
  const tasks = [
    { title: 'דף תרגילים' },
    { title: 'שיעורי בית · היסטוריה', due_at: due('2026-10-25') },
    { title: 'שיעורי בית · אנגלית', due_at: due('2026-10-29') },
  ];
  const pending = [{ kind: 'homework', subject: 'פיזיקה' }, { id: 'q1', text: 'טקסט מומצא של שאלה' }];
  const out = composeBrief({ dateIso: '2026-10-26', timetable: TIMETABLE, tasks, pending });

  test('הטקסט המלא זהה לתבנית ב-PRD, מילה במילה (המשימות ממוינות לפי תאריך, בלי תאריך בסוף)', () => {
    assert.equal(out.text, [
      'בריף · יום שני 26.10',
      '08:15–15:45 · 9 שיעורים',
      'היום: מבחן במתמטיקה ב-10:05',
      'משימות פתוחות (3):',
      '· שיעורי בית · היסטוריה — באיחור (היה עד ראשון 25.10)',
      '· שיעורי בית · אנגלית — עד חמישי 29.10',
      '· דף תרגילים — בלי תאריך',
      'שאלות שממתינות: שיעורי בית בפיזיקה · ועוד שאלה אחת',
      'לפי מערכת השעות, שינויים שנקלטו היום לא מוצגים.',
    ].join('\n'));
  });
  test('המבנה המוחזר: שורת בית ספר, יום לימודים, 3 משימות, מבחן אחד', () => {
    assert.deepEqual(out.school, { startsAt: '08:15', endsAt: '15:45', lessons: 9, text: '08:15–15:45 · 9 שיעורים' });
    assert.equal(out.schoolDay, true);
    assert.equal(out.tasks, 3);
    assert.equal(out.exams.length, 1);
  });
  test('שלישי 20.10.2026: 08:15–14:15 · 7 שיעורים (הדוגמה בסעיף 1 של ה-PRD)', () => {
    assert.equal(schoolSummary('2026-10-20', TIMETABLE).text, '08:15–14:15 · 7 שיעורים');
  });
  test('שיעור אחד ביום: "שיעור אחד"', () => {
    assert.equal(schoolSummary('2026-10-20', { slots: [{ weekday: 3, period: 4, startsAt: '10:55', endsAt: '11:40', subject: 'מתמטיקה' }] }).text, '10:55–11:40 · שיעור אחד');
  });
  test('כל השיעורים נספרים, גם פטורים: ביום ראשון יש "שיח אישי" פטור והוא נספר', () => {
    assert.equal(schoolSummary('2026-10-25', TIMETABLE).lessons, TIMETABLE.slots.filter((s) => s.weekday === 1).length);
  });
});

describe('brief-view: יום בלי כלום (D8)', () => {
  test('שבת בלי משימות ובלי שאלות: כותרת, "יום פנוי", ושורת D1', () => {
    const out = composeBrief({ dateIso: '2026-10-24', timetable: TIMETABLE, tasks: [], pending: [] });
    assert.equal(out.text, `בריף · יום שבת 24.10\n${FREE_DAY_LINE}\n${BRIEF_FOOTER}`);
    assert.equal(out.schoolDay, false);
    assert.equal(out.school, null);
  });
  test('מערכת שעות חסרה (null) וגם בלי משימות: בלי שורת בית ספר, ובלי "יום פנוי" (אי אפשר לטעון שאין בית ספר)', () => {
    const out = composeBrief({ dateIso: '2026-10-21', timetable: null, tasks: [], pending: [] });
    assert.equal(out.text, `בריף · יום רביעי 21.10\n${BRIEF_FOOTER}`);
  });
  test('מערכת שעות חסרה עם משימות: המשימות מופיעות, בלי שורת בית ספר', () => {
    const out = composeBrief({ dateIso: '2026-10-21', timetable: null, tasks: [{ title: 'דף', due_at: due('2026-10-22') }], pending: [] });
    assert.deepEqual(linesOf(out.text), ['בריף · יום רביעי 21.10', 'משימות פתוחות (1):', '· דף — עד חמישי 22.10', BRIEF_FOOTER]);
  });
  test('שבת עם משימה אחת: אין "יום פנוי" ואין שורת בית ספר, המשימה מופיעה', () => {
    const out = composeBrief({ dateIso: '2026-10-24', timetable: TIMETABLE, tasks: [{ title: 'דף' }], pending: [] });
    assert.deepEqual(linesOf(out.text), ['בריף · יום שבת 24.10', 'משימות פתוחות (1):', '· דף — בלי תאריך', BRIEF_FOOTER]);
  });
  test('שבת עם שאלה ממתינה בלבד: אין "יום פנוי"', () => {
    const out = composeBrief({ dateIso: '2026-10-24', timetable: TIMETABLE, tasks: [], pending: [{ id: 'q' }] });
    assert.deepEqual(linesOf(out.text), ['בריף · יום שבת 24.10', 'שאלות שממתינות: שאלה אחת', BRIEF_FOOTER]);
  });
});

describe('brief-view: משימות, בלי תקרה, באיחור, בלי תאריך בסוף (D3, D16)', () => {
  test('12 משימות מופיעות כולן, והכותרת סופרת 12', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({ title: `משימה ${i + 1}`, due_at: due(`2026-10-${String(27 + (i % 3)).padStart(2, '0')}`) }));
    const out = composeBrief({ dateIso: '2026-10-26', timetable: TIMETABLE, tasks, pending: [] });
    assert.ok(out.text.includes('משימות פתוחות (12):'));
    assert.equal(linesOf(out.text).filter((line) => line.startsWith('· ')).length, 12);
    assert.equal(out.tasks, 12);
  });
  test('סדר: תאריך עולה, באיחור בראש, בלי תאריך בסוף; שוויון נשאר בסדר הקלט', () => {
    const tasks = [
      { title: 'ללא-1' }, { title: 'עתיד', due_at: due('2026-10-30') }, { title: 'ללא-2' }, { title: 'עבר', due_at: due('2026-10-20') }, { title: 'מחר-א', due_at: due('2026-10-27') }, { title: 'מחר-ב', due_at: due('2026-10-27') },
    ];
    const titles = linesOf(composeBrief({ dateIso: '2026-10-26', timetable: TIMETABLE, tasks, pending: [] }).text).filter((line) => line.startsWith('· ')).map((line) => line.split(' — ')[0].slice(2));
    assert.deepEqual(titles, ['עבר', 'מחר-א', 'מחר-ב', 'עתיד', 'ללא-1', 'ללא-2']);
  });
  test('משימה באיחור: "באיחור (היה עד <יום d.M>)"', () => {
    const out = composeBrief({ dateIso: '2026-10-26', timetable: TIMETABLE, tasks: [{ title: 'ישנה', due_at: due('2026-10-20') }], pending: [] });
    assert.ok(out.text.includes('· ישנה — באיחור (היה עד שלישי 20.10)'));
  });
  test('משימה שמועדה היום (גם בבוקר) עוד לא באיחור: "עד שני 26.10"', () => {
    const out = composeBrief({ dateIso: '2026-10-26', timetable: TIMETABLE, tasks: [{ title: 'להיום', due_at: '2026-10-26T05:15:00.000Z' }], pending: [] });
    assert.ok(out.text.includes('· להיום — עד שני 26.10'));
  });
  test('התאריך הוא הישראלי של due_at, לא UTC: 21:30 UTC ב-25.10 הוא כבר 26.10 בישראל (שעון חורף, UTC+2) = היום, לא באיחור', () => {
    const out = composeBrief({ dateIso: '2026-10-26', timetable: TIMETABLE, tasks: [{ title: 'חצות', due_at: '2026-10-25T22:30:00.000Z' }], pending: [] });
    assert.ok(out.text.includes('· חצות — עד שני 26.10'), out.text);
  });
  test('כותרת ריקה: "משימה"; due_at לא תקין: "בלי תאריך"', () => {
    const out = composeBrief({ dateIso: '2026-10-26', timetable: TIMETABLE, tasks: [{ title: '  ' }, { title: 'x', due_at: 'לא-תאריך' }], pending: [] });
    assert.ok(out.text.includes('· משימה — בלי תאריך'));
    assert.ok(out.text.includes('· x — בלי תאריך'));
  });
  test('בלי משימות: אין בלוק "משימות פתוחות"', () => {
    assert.ok(!composeBrief({ dateIso: '2026-10-26', timetable: TIMETABLE, tasks: [], pending: [] }).text.includes('משימות פתוחות'));
  });
});

describe('brief-view: שורת המבחן (D15)', () => {
  test('ביום מבחן השורה "היום: ..." אחרי שורת בית הספר ולפני המשימות', () => {
    const lines = linesOf(composeBrief({ dateIso: '2026-10-26', timetable: TIMETABLE, tasks: [{ title: 'דף' }], pending: [] }).text);
    assert.deepEqual(lines.slice(0, 4), ['בריף · יום שני 26.10', '08:15–15:45 · 9 שיעורים', 'היום: מבחן במתמטיקה ב-10:05', 'משימות פתוחות (1):']);
  });
  test('מבחן בלי שיעור של המקצוע באותו יום: בלי שעה (רביעי 18.11, תנ"ך)', () => {
    assert.ok(composeBrief({ dateIso: '2026-11-18', timetable: TIMETABLE }).text.includes('\nהיום: מבחן בתנ"ך\n'));
  });
  test('מבחן של מחר לא נכנס להודעה: 25.10 (מבחן ב-26.10) בלי שורת "היום"', () => {
    const out = composeBrief({ dateIso: '2026-10-25', timetable: TIMETABLE });
    assert.ok(!out.text.includes('היום:'));
    assert.equal(out.exams.length, 0);
  });
  test('יום בלי מבחן: אין שורת "היום"', () => assert.ok(!composeBrief({ dateIso: '2026-10-27', timetable: TIMETABLE }).text.includes('היום:')));
});

describe('brief-view: חופשה ושבת (H1)', () => {
  test('יום חופשה שיש לו שיעורים במערכת (חנוכה, שני 7.12.2026): בלי שורת בית ספר, "יום פנוי"', () => {
    const out = composeBrief({ dateIso: '2026-12-07', timetable: TIMETABLE, tasks: [], pending: [] });
    assert.equal(out.school, null);
    assert.equal(out.schoolDay, false);
    assert.equal(out.text, `בריף · יום שני 7.12\n${FREE_DAY_LINE}\n${BRIEF_FOOTER}`);
  });
  test('יום חופשה עם משימות: בלי שורת בית ספר ובלי "יום פנוי"', () => {
    const out = composeBrief({ dateIso: '2026-12-07', timetable: TIMETABLE, tasks: [{ title: 'דף' }], pending: [] });
    assert.ok(!/\d{2}:\d{2}.\d{2}:\d{2} · /.test(out.text));
    assert.ok(!out.text.includes('יום פנוי'));
  });
  test('שבת: בלי שורת בית ספר', () => assert.equal(composeBrief({ dateIso: '2026-10-24', timetable: TIMETABLE, tasks: [{ title: 'x' }] }).school, null));
});

describe('brief-view: שאלות ממתינות (D17)', () => {
  const build = (pending) => linesOf(composeBrief({ dateIso: '2026-10-26', timetable: TIMETABLE, pending }).text).find((line) => line.startsWith('שאלות שממתינות'));
  test('שאלת שיעורי בית בשם המקצוע', () => assert.equal(build([{ kind: 'homework', subject: 'מתמטיקה' }]), 'שאלות שממתינות: שיעורי בית במתמטיקה'));
  test('כמה שאלות שיעורי בית: כל אחת בשמה', () => assert.equal(build([{ kind: 'homework', subject: 'אנגלית' }, { kind: 'homework', subject: 'פיזיקה' }]), 'שאלות שממתינות: שיעורי בית באנגלית · שיעורי בית בפיזיקה'));
  test('שאלה אחרת אחת: "ועוד שאלה אחת" אחרי שיעורי בית; לבד: "שאלה אחת"', () => {
    assert.equal(build([{ kind: 'homework', subject: 'פיזיקה' }, { id: 'a', text: 'x' }]), 'שאלות שממתינות: שיעורי בית בפיזיקה · ועוד שאלה אחת');
    assert.equal(build([{ id: 'a', text: 'x' }]), 'שאלות שממתינות: שאלה אחת');
  });
  test('כמה שאלות אחרות: "ועוד N שאלות"', () => {
    assert.equal(build([{ kind: 'homework', subject: 'פיזיקה' }, { id: 'a' }, { id: 'b' }, { id: 'c' }]), 'שאלות שממתינות: שיעורי בית בפיזיקה · ועוד 3 שאלות');
    assert.equal(build([{ id: 'a' }, { id: 'b' }]), 'שאלות שממתינות: 2 שאלות');
  });
  test('פרטיות: טקסט ההודעה, הכפתורים והמזהים של שאלה אחרת לא מופיעים', () => {
    const secret = 'טקסט-סודי-מומצא';
    const out = composeBrief({ dateIso: '2026-10-26', timetable: TIMETABLE, pending: [{ id: 'id-סודי', text: secret, buttons: [{ label: secret }], allowFreeText: true }, { kind: 'homework', subject: 'פיזיקה', topic_allowed: true, buttons: [secret] }] });
    assert.ok(!out.text.includes(secret));
    assert.ok(!out.text.includes('id-סודי'));
  });
  test('שאלת שיעורי בית בלי שם מקצוע נספרת כשאלה אחרת (אין מה להציג)', () => assert.equal(build([{ kind: 'homework', subject: null }]), 'שאלות שממתינות: שאלה אחת'));
  test('אין שאלות: אין שורה', () => assert.equal(build([]), undefined));
});

describe('brief-view: כללי התבנית', () => {
  test('השורה הראשונה תמיד "בריף · יום ...", והאחרונה תמיד שורת D1', () => {
    for (const dateIso of ['2026-10-26', '2026-10-24', '2026-12-07']) {
      const lines = linesOf(composeBrief({ dateIso, timetable: TIMETABLE, tasks: [{ title: 'x' }], pending: [{ id: 'q' }] }).text);
      assert.match(lines[0], /^בריף · יום \S+ \d{1,2}\.\d{1,2}$/);
      assert.equal(lines.at(-1), BRIEF_FOOTER);
    }
  });
  test('ללא ארגומנטים אופציונליים: לא זורק', () => assert.match(composeBrief({ dateIso: '2026-10-26' }).text, /^בריף · יום שני 26\.10\n/));
  test('פרטיות: שם מורה, חדר או טלפון ממערכת השעות לא מופיעים בהודעה', () => {
    const text = composeBrief({ dateIso: '2026-10-26', timetable: TIMETABLE, tasks: [], pending: [] }).text;
    for (const slot of TIMETABLE.slots) if (slot.teacher) assert.ok(!text.includes(slot.teacher), 'שם מורה');
  });
});

describe('brief-view: briefEntityId', () => {
  test('uuid תקין, דטרמיניסטי, ושונה בין משבצות', () => {
    const id = briefEntityId('brief-2026-10-26');
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(briefEntityId('brief-2026-10-26'), id);
    assert.notEqual(briefEntityId('brief-2026-10-27'), id);
  });
});

describe('brief-view: partial (חלק מהנתונים לא נטען)', () => {
  test('partial=true בשבת בלי משימות ושאלות: בלי "יום פנוי", ושורת הסיום נשארת', () => {
    const out = composeBrief({ dateIso: '2026-10-24', timetable: TIMETABLE, tasks: [], pending: [], partial: true });
    assert.equal(out.text, `בריף · יום שבת 24.10\n${BRIEF_FOOTER}`);
  });
  test('partial=false (ברירת מחדל): "יום פנוי" כרגיל', () => {
    assert.ok(composeBrief({ dateIso: '2026-10-24', timetable: TIMETABLE }).text.includes(FREE_DAY_LINE));
  });
});

// ---------------------------------------------------------------------------
// B-2: נוסח התראת הבוקר (briefPushText). מספרים ותוויות בלבד, בכל יום, גם בשבת ובחופשה.
// 2026-10-27 = שלישי (יום לימודים בלי מבחן), 2026-10-26 = שני עם מבחן במתמטיקה ב-10:05, 2026-10-24 = שבת, 2026-12-08 = שלישי בתוך חנוכה (6-12.12).
// ---------------------------------------------------------------------------
describe('brief-view: briefPushText (B-2)', () => {
  const T = (n) => Array.from({ length: n }, (_, i) => ({ title: `כותרת-סודית-${i}` }));
  const push = (dateIso, n, extra = {}) => briefPushText({ brief: composeBrief({ dateIso, timetable: TIMETABLE, tasks: T(n), ...extra }), timetable: TIMETABLE, partial: extra.partial });

  test('יום לימודים עם 3 משימות: שורת בית הספר ואחריה "3 משימות פתוחות"', () => {
    assert.equal(push('2026-10-27', 3), `${schoolSummary('2026-10-27', TIMETABLE).text} · 3 משימות פתוחות`);
  });
  test('משימה אחת: "משימה אחת פתוחה"; אפס משימות: החלק מושמט', () => {
    assert.ok(push('2026-10-27', 1).endsWith(' · משימה אחת פתוחה'));
    assert.equal(push('2026-10-27', 0), schoolSummary('2026-10-27', TIMETABLE).text);
  });
  test('יום מבחן: ההתראה נפתחת בשורת המבחן (עם שעה), ואחריה שורת בית הספר והמשימות', () => {
    assert.equal(push('2026-10-26', 3), 'מבחן במתמטיקה ב-10:05 · 08:15–15:45 · 9 שיעורים · 3 משימות פתוחות');
  });
  test('שבת עם משימות: "יום פנוי · N משימות פתוחות"; משימה אחת: "יום פנוי · משימה אחת פתוחה"', () => {
    assert.equal(push('2026-10-24', 3), 'יום פנוי · 3 משימות פתוחות');
    assert.equal(push('2026-10-24', 1), 'יום פנוי · משימה אחת פתוחה');
  });
  test('שבת בלי משימות: נוסח D8 הקיים', () => assert.equal(push('2026-10-24', 0), FREE_DAY_LINE));
  test('יום חופשה (חנוכה): נוסח "יום פנוי", בלי שורת בית ספר', () => {
    assert.equal(push('2026-12-08', 2), 'יום פנוי · 2 משימות פתוחות');
    assert.equal(push('2026-12-08', 0), FREE_DAY_LINE);
  });
  test('מערכת שעות חסרה (null): "הבריף של היום מחכה"', () => {
    assert.equal(BRIEF_PUSH_WAITING, 'הבריף של היום מחכה');
    assert.equal(briefPushText({ brief: composeBrief({ dateIso: '2026-10-27', timetable: null, tasks: T(2) }), timetable: null }), BRIEF_PUSH_WAITING);
  });
  test('partial (המשימות לא נטענו): בלי ספירת משימות, ובלא-לימודים לא טוענים "יום פנוי"', () => {
    assert.equal(push('2026-10-27', 0, { partial: true }), schoolSummary('2026-10-27', TIMETABLE).text);
    assert.equal(push('2026-10-24', 0, { partial: true }), BRIEF_PUSH_WAITING);
  });
  test('פרטיות: אין כותרת משימה ואין טקסט שאלה בנוסח', () => {
    const text = push('2026-10-27', 3, { pending: [{ kind: 'homework', subject: 'פיזיקה' }, { id: 'q' }] });
    assert.ok(!text.includes('כותרת-סודית') && !text.includes('פיזיקה'));
  });
});
