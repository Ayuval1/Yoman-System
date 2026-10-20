// צינור הקליטה (שלב 8.2, קוד בלבד): מחבר את מודולי הלוגיקה (lib/intake-*.js, lib/timetable.js) לנקודת הקליטה api/intake.js.
// מקור: docs/08-chapter8/35-chapter8-plan.md סעיפים 3.8.0 ו-8.2; docs/02-rules/03-intake-rules.md:157-174 ("מידע קודם, שאלה כרשת ביטחון"),
// 284-286 ("אותה הודעה פעמיים"); docs/02-rules/03-app-channel-rules.md:101,103 (התשובה והכפילות בקיצור). בלי רשת ובלי מודל: מסד בלבד, מוזרק (sql).
// שלב 8.2א-1 (docs/08-chapter8/47-chapter8-step-8-2a-spec.md, "8.2א-1 נתונים ושרת"): ערוץ app (הודעה שיובל הקליד בצ'אט), בועות תשובה ב-messages,
// שאלת "מה זה?", ותשובה שנשמרת כשורת מקור. ההחלטות: 35, טבלת D1-D12 (D8 כפילות, D9 משימה/שאלה/פקודה, D10 "מה זה?", D11 "נרשם" פעם אחת).
//
// שלוש פונקציות מיוצאות:
//   processSource({ sql, source, timetable })      קליטה של הודעה שנשמרה כבר ב-sources. מחזיר { status, reply }.
//   pendingQuestion({ source, facts, timetable })  פונקציה טהורה: השאלה הבאה למקור (או null). הכפתורים והשדה נגזרים בקריאה ואינם נשמרים (אין להם עמודה ב-messages).
//   answerQuestion({ sql, messageId, answer, timetable, now })  תשובה לשאלה פתוחה. מחזיר { done, reply, status, created }.
//
// status של processSource: 'recorded' (נרשם, וייתכן ששאלה נפתחה) · 'duplicate' ("כבר קיבלתי") · 'unclassified' (הקוד לא הבין, או שאלה שהועברה בלי תאריך, או הודעה ארוכה מדי;
// בערוץ app גם משימה, שאלה, פקודה, ושאלת "מה זה?" שנפתחה; עובר לשלב 8.5) · 'skipped' (ערוץ שאינו הקיצור ואינו app, או שהמקור כבר נתפס על ידי ריצה אחרת: claimed = 0).
//
// הסדר לערוץ app (הכרעת יובל "א" בהוראות שלב 8.2א-1, ה1): 1. ארוכה מהתקרה: "התקבל" · 2. כפילות: "כבר קיבלתי" · 3. משימה (channelRole): "התקבל"
// · 4. שאלה אמיתית (מילת שאלה או סימן שאלה; שורשי הצגה כמו "אמרה" אינם שאלה): "התקבל" · 5. חילוץ: נמצא סוג = נרשם כמו בקיצור
// · 6. לא נמצא סוג: פקודה או הצגה (detectIntent אינו info) = "התקבל", אחרת שאלת "מה זה?". ערוץ הקיצור מתנהג כמו לפני השלב, פרט לבועת "נרשם".
//
// בועות תשובה (47 "מה נכנס" סעיפים 5-6, "איך נשמר מה"): שורה ב-messages עם direction='out', kind='update', awaiting_reply=false, entity_type='source', entity_id=המקור.
//  - הודעה שהועברה (shortcut): רק "נרשם · ...", ברגע ההבנה הראשון (בקליטה, או בתשובה שמשלימה את ההבנה).
//  - הודעה מוקלדת (app): בועה אחת בסופו של דבר: "נרשם" ברגע ההבנה הראשון, "כבר קיבלתי" בכפילות, "התקבל" כשאין שאלה ואין הבנה, או כשהשאלה האחרונה
//    נסגרה וההודעה לא הובנה אף פעם. כשנפתחת שאלה בקליטה וההודעה לא הובנה, לא נכתבת בועה (הכרטיס הוא התגובה).
//  - "פעם אחת" נאכף ב-SQL: כל הכנסה של בועה מותנית ב-NOT EXISTS של בועת update יוצאת לאותו מקור, ונכתבת באותה פקודה של התפיסה או הסגירה.
//  - נתיב הקליטה (processSource) לא מזכיר את העמודה read_at בשום פקודה: היא נוספת במסד החי רק בסוף השלב (47, "במסד"), והקיצור חייב להמשיך לעבוד עד אז.
//
// עקרונות הכתיבה:
//  - כל כתיבה של הצינור היא פקודת SQL אחת (WITH ... data-modifying CTE): או הכול או כלום (35, סעיף 8.2: "כתיבה בטרנזקציה אחת"). אין DELETE.
//  - הפקודה "תופסת" קודם את השורה (UPDATE ... WHERE processed_at IS NULL, או awaiting_reply = true, עם RETURNING) וכל ההכנסות תלויות בה.
//    כך הרצה כפולה (לחיצה כפולה, ניסיון חוזר) לא יוצרת עובדות כפולות: ההכנסות הן על שורות ה-RETURNING בלבד. [הנחה, לא אומת: לא נבדק מול Postgres אמיתי, ראה test/intake-process.test.js]
//  - פקודות בלי תפיסה (בועת "התקבל", שאלת "מה זה?") מוגנות רק ב-NOT EXISTS. [הנחה, לא אומת] זה מגן מהרצה חוזרת ולא מהרצה מקבילה; הרצה מקבילה לא קורית,
//    כי כל מקור מעובד פעם אחת, בבקשה שבה נשמר (api/intake.js). אין אילוץ ייחודיות במסד שאוכף זאת.
//  - שמירת המקור קודמת לעיבוד (build-rules 31): processSource נקרא רק אחרי שה-INSERT ל-sources הצליח, ושגיאה בו לא מבטלת אותו (api/intake.js תופס).
//  - "מה שלא ידוע נשאר לא ידוע": עובדה שחסרה לא נכתבת. "לא יודע" נשמר כערך 'unknown' (תשובה תקפה).
//
// הנחות שהמסמכים לא קובעים, כולן [הנחה, לא אומת] ושקל להפוך:
//  - עובדת הסוג נשמרת כשורת facts עם field='type' ו-origin='read' (הסוג נקרא ממילות ההודעה). הדרישה: לשחזר מה זוהה. facts אינה כוללת עמודת זמן, ולכן אין סדר בין שורות.
//  - סדר השאלות: תאריך קודם (כפתורי המקצוע והשיעור תלויים בו), אחריו מקצוע, נושא, חדר, ושיעור אחרון. 35 קובע שדות חיוניים ולא סדר.
//  - אחרי תשובה, השיעור המדויק מושלם בקוד ממערכת השעות אם יש מועמד אחד (origin='inferred'), בדיוק כמו ב-extractFacts (03-intake-rules.md:99-108). עם כמה מועמדים: שואלים.
//  - "מחר" בתשובה חופשית נמדד מרגע התשובה (now), לא מרגע ההודעה המקורית.
//  - candidate_rules (I-48) כבויה כרגע (RECORD_CANDIDATE_RULES = false, ביקורת 12.10, סעיף 10; 35 D7): אין היום זיהוי שמות אוטומטי (35, סעיף 3.8.0), והדפוס שנשמר
//    מהודעה שיובל הקליד ("אצל דנה לוי בנושא שברים") יכול להכיל שם, וכלל הפרויקט אוסר לשמור שמות וטלפונים (CLAUDE.md "ברזלים"; build-rules 12).
//    כשיופעל (יחד עם סינון שמות) היא נכתבת רק כשערוץ המקור הוא 'app' (טקסט שיובל הקליד בעצמו); בהודעות מהקיצור (טקסט של אחרים) לא נרשם כלום.
//  - evidence ב-candidate_rules הוא { message_ids: [...] } בלבד, ללא שורשים (השורשים הם ה-pattern עצמו).
//  - שאלה שהועברה (ביקורת 12.10, סעיף 8): הודעה מהקיצור שהיא שאלה (detectIntent = read) ואין בה תאריך נחשבת "לא מסווגת", ללא כתיבה. שליפה לא נבנתה בפרק 8.
//    בערוץ app הבדיקה הזו לא מופעלת: שאלות אמיתיות כבר סוננו בצעד 4 (הוראות 8.2א-1, ה1).
//  - הודעה ארוכה מ-MAX_PROCESSABLE_LENGTH תווים לא עוברת חילוץ (ביקורת 12.10, סעיף 15): הודעת אירוע קצרה בהרבה, והחילוץ על טקסט ענק חוסם את ה-event loop.
//  - בועה: attempt ריק (NULL), כי הוא "ניסיון בירור מספר כמה" (06) ובועה אינה בירור. expires_at ריק.
//  - הודעה מוקלדת שהטיפול בה הוא "התקבל" (משימה, שאלה, פקודה, ארוכה, "לא יודע" בשאלת "מה זה?") נשארת עם processed_at ריק, כמו "לא מסווג" בקיצור:
//    משימות יטופלו בשלב 8.6. כפילות בכל זאת מזוהה: hasEarlierSameDay מחשיב קודמת כטופלה גם כשיש לה בועה או שאלה ב-messages, ולכן אותו טקסט
//    מוקלד שוב באותו יום מקבל "כבר קיבלתי" (47 קריטריון 15). קודמת בלי processed_at ובלי שום שורה ב-messages (העיבוד נכשל) אינה כפילות.
//
// שלב 8.3-1 ("זיהוי והבנה"): שני סוגים חדשים, early_leave (יציאה מוקדמת) ו-personal_event (אירוע אישי), ושתי שאלות חדשות: 'time' ("באיזו שעה?") ו-'confirm' (כרטיס "נכון / לא נכון").
//  - סדר השאלות: time לפני lesson, confirm אחרון. confirm נשאלת רק כשיש תאריך ושעה מפוענחים (לא unknown); אחרת אין מה לאשר.
//  - השלמות שנגזרות בקוד (origin='inferred'): שיעורים מפוספסים ביציאה מוקדמת, שעת סיום באירוע אישי, ושיעורים אחרונים בביטול ("שני השיעורים האחרונים") גם אחרי שהתאריך נענה בשאלה.
//  - תשובה ל-confirm שומרת את העובדה (yes / no) וסוגרת את השאלה; לא נכתבת בועת "נרשם" שנייה (היא נכתבה בקליטה), ו"לא נכון" לא עושה דבר נוסף (שלב 8.3-3).
//  - בועה: "נרשם · יציאה מוקדמת · שני 19.10" ו"נרשם · אירוע אישי · בדיקה רפואית · שני 19.10" (הכותרת במקום המקצוע).
import { extractFacts, assessFacts, isUnderstood, slotMatchesSubject, ESSENTIAL_FIELDS, UNKNOWN_VALUE, CONFIRM_FIELD, isTimedType, missedLessons, plusOneHour, findLastLessons, lastLessonPeriods } from './intake-facts.js';
import { buildQuestion, applyAnswer, answerPattern, formatReply, parseTypeAnswer, RECEIVED_REPLY, DUPLICATE_REPLY } from './intake-questions.js';
import { fellThroughRoots } from './intake-dictionary.js';
import { tokenize } from './intake-text.js';
import { detectIntent, intentSignals, channelRole } from './intake-intent.js';
import { parseIso, weekdayOf, localDateIso, WEEKDAY_NAMES } from './intake-dates.js';
import { loadTimetable } from './timetable.js';

export const TYPE_FIELD = 'type';
// כתיבה ל-candidate_rules (I-48). כבוי עד שיהיה זיהוי שמות אוטומטי (ביקורת 12.10, סעיף 10; 35 D7: נשאר כבוי גם ב-8.2א).
// answerQuestion מקבל recordCandidateRules (ברירת מחדל: הקבוע הזה), כדי שהבדיקות יוכלו לבדוק את הנתיב כשהוא דלוק.
export const RECORD_CANDIDATE_RULES = false;
// תקרת אורך לחילוץ (תווים). [הנחה, לא אומת] 20,000 היא בחירה של Claude: הודעת אירוע רגילה קצרה בהרבה, ו-api/intake.js מקבל עד 100,000 תווים.
// מעל התקרה: "לא מסווג", בלי חילוץ וב-processed_at ריק (ביקורת 12.10, סעיף 15). בערוץ app גם בלי שאלת "מה זה?" (47 "מה נכנס" סעיף 7).
export const MAX_PROCESSABLE_LENGTH = 20_000;
const CHANNEL_SHORTCUT = 'shortcut';
const CHANNEL_APP = 'app';
const NOTHING_CREATED = Object.freeze({ answerSourceId: null, bubbleId: null, questionId: null });

// הסדר שבו שואלים על שדה חסר. תאריך קודם כי כפתורי המקצוע והשיעור נגזרים מיום המערכת שלו; שיעור אחרון כי הוא תלוי במקצוע ובתאריך.
// שלב 8.3-1: time (שעה) לפני lesson, ו-confirm (כרטיס האישור) אחרון.
const ASK_ORDER = Object.freeze(['date', 'new_date', 'subject', 'topic', 'new_room', 'time', 'lesson', CONFIRM_FIELD]);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const rowsOf = (result) => (Array.isArray(result) ? result : []);

function validIso(value) {
  if (typeof value !== 'string') return null;
  try {
    parseIso(value);
    return value;
  } catch {
    return null;
  }
}

// שיעורי המקצוע ביום (כמו extractFacts, שורות 257-259): מספרי שיעור ממוינים, בלי כפילויות.
function periodsOf(timetable, iso, subject) {
  const slots = Array.isArray(timetable?.slots) ? timetable.slots : [];
  const weekday = weekdayOf(iso) + 1; // במערכת השעות 1 = ראשון
  const periods = slots.filter((slot) => slot.weekday === weekday && slotMatchesSubject(slot.subject, subject)).map((slot) => slot.period);
  return [...new Set(periods)].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// סיווג הודעה מוקלדת (ערוץ app): משימה, שאלה, ומתי שואלים "מה זה?"
// ---------------------------------------------------------------------------

// שאלה אמיתית: מילת שאלה או סימן שאלה (הוראות 8.2א-1, ה1 צעד 4). שורשי הצגה ("אמרה") ופעלים דו-משמעיים אינם נחשבים כאן שאלה.
function isRealQuestion(text) {
  if (typeof text !== 'string') return false;
  const signals = intentSignals(text);
  return signals.questionWords.length > 0 || signals.questionMark;
}

// האם מקור בלי סוג מקבל שאלת "מה זה?" (47 "מה נכנס" סעיף 7; 35 D10): ערוץ app, לא ארוך מהתקרה, לא משימה, לא שאלה, ולא פקודה או הצגה (detectIntent = info).
// [הנחה, לא אומת] טקסט ריק או רווחים בלבד אינו מקבל שאלה ("התקבל"), כי אין על מה לשאול.
function typeQuestionApplies(source) {
  if (source?.channel !== CHANNEL_APP) return false;
  const text = source.raw_content;
  if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_PROCESSABLE_LENGTH) return false;
  if (channelRole({ channel: CHANNEL_APP, text }) === 'task' || isRealQuestion(text)) return false;
  return detectIntent(text) === 'info';
}

// ---------------------------------------------------------------------------
// מצב של מקור: מה כבר ידוע, מה חסר, ומה השאלה הבאה
// ---------------------------------------------------------------------------

// חילוץ מחדש מהטקסט המקורי. חותמת קליטה לא תקינה לא מונעת שאלה על מה שכבר נשמר: אז אין מועמדים מהחילוץ, והכפתורים נגזרים ממערכת השעות בלבד.
// forcedType (אופציונלי): הסוג שנבחר בשאלת "מה זה?" (lib/intake-facts.js, extractFacts).
const NO_EXTRACTION = Object.freeze({ type: null, facts: [], missing: [], certainty: 'uncertain', ambiguous: [], understood: false });
function safeExtract(source, timetable, forcedType) {
  try {
    return extractFacts({ text: source.raw_content, receivedAt: source.received_at, channel: source.channel, timetable, forcedType });
  } catch (error) {
    if (error instanceof RangeError) return NO_EXTRACTION;
    throw error;
  }
}

// saved: שורות facts של המקור ({ field, value, origin }), כולל שורת ה-type. extracted (אופציונלי): תוצאת extractFacts שכבר חושבה.
// מחזיר { type, all (Map שדה -> עובדה: מה שנשמר ועוד מה שהושלם עכשיו בהסקה), ambiguous (Map שדה -> מועמדים), missing, next, certainty, understood, extracted }.
// הסוג השמור גובר על הסוג המחושב מחדש (המילון יכול להשתנות בין הקליטה לתשובה).
function resolveState({ source, saved, timetable, extracted }) {
  const known = new Map();
  for (const row of saved) {
    if (row && typeof row.field === 'string' && row.field !== TYPE_FIELD && row.value !== null && row.value !== undefined && !known.has(row.field)) {
      known.set(row.field, { field: row.field, value: String(row.value), origin: row.origin ?? 'read', extracted_by: 'script' });
    }
  }
  const savedType = saved.find((row) => row?.field === TYPE_FIELD)?.value;
  const savedTypeValid = Object.hasOwn(ESSENTIAL_FIELDS, savedType);
  let fresh = extracted === undefined ? safeExtract(source, timetable) : extracted;
  // הסוג נשמר (למשל נבחר בשאלת "מה זה?") והמילון לא מוצא סוג בטקסט: מחלצים מחדש עם הסוג השמור, כדי שהמועמדים (למשל כמה מקצועות) לא יאבדו (47, תרחיש ג).
  if (extracted === undefined && savedTypeValid && !fresh.type) fresh = safeExtract(source, timetable, savedType);
  const type = savedTypeValid ? savedType : fresh.type;
  if (!type) {
    // אין סוג: הודעה מוקלדת זכאית מקבלת שאלת "מה זה?" (47 סעיף 7); אחרת אין שאלה.
    const next = typeQuestionApplies(source) ? buildQuestion({ field: TYPE_FIELD }) : null;
    return { type: null, all: new Map(), ambiguous: new Map(), missing: [], next, certainty: 'uncertain', understood: false, extracted: fresh };
  }

  const all = new Map(known);
  const ambiguous = new Map();
  if (fresh.type === type) {
    for (const entry of fresh.ambiguous) if (!known.has(entry.field)) ambiguous.set(entry.field, entry.candidates);
  }

  // השלמת השיעור המדויק ממערכת השעות (03-intake-rules.md:99-108): מועמד יחיד = הסקה, כמה מועמדים = שאלה.
  const dateField = type === 'move' ? 'new_date' : 'date';
  const inferred = (field, value) => ({ field, value: String(value), origin: 'inferred', extracted_by: 'script' });
  if (isTimedType(type)) {
    // שלב 8.3-1: שעת סיום באירוע אישי (שעה אחרי ההתחלה) ושיעורים מפוספסים ביציאה מוקדמת, ברגע שהשעה (והתאריך) ידועות, גם אחרי תשובה לשאלת השעה.
    const time = known.get('time')?.value;
    const day = validIso(known.get('date')?.value);
    if (HHMM.test(time ?? '')) {
      if (type === 'personal_event' && !known.has('end_time')) all.set('end_time', inferred('end_time', plusOneHour(time)));
      if (type === 'early_leave' && day && !known.has('lesson')) {
        const missed = missedLessons(timetable, day, time);
        if (missed.length > 0) all.set('lesson', inferred('lesson', missed.join(',')));
      }
    }
  } else if (type === 'cancel' && !known.has('lesson')) {
    // "שני השיעורים האחרונים": כשהתאריך נענה אחרי הקליטה, השיעורים והמקצוע (אם יש אחד) נגזרים עכשיו, כמו ב-extractFacts.
    const last = findLastLessons(tokenize(source.raw_content).tokens.map((token) => token.w));
    const day = validIso(known.get('date')?.value);
    const periods = last && day ? lastLessonPeriods(timetable, day, last.count) : [];
    if (periods.length > 0) {
      all.set('lesson', inferred('lesson', periods.join(',')));
      ambiguous.delete('lesson');
      if (!known.has('subject')) {
        const weekday = weekdayOf(day) + 1;
        const slots = Array.isArray(timetable?.slots) ? timetable.slots : [];
        const subjects = [...new Set(slots.filter((slot) => slot.weekday === weekday && periods.includes(slot.period)).sort((a, b) => a.period - b.period).map((slot) => slot.subject))];
        if (subjects.length === 1) {
          all.set('subject', inferred('subject', subjects[0]));
          ambiguous.delete('subject');
        } else if (subjects.length > 1) {
          ambiguous.set('subject', subjects);
        }
      }
    }
  }
  if (type !== 'short_day' && !isTimedType(type) && !all.has('lesson')) {
    const subject = known.get('subject')?.value;
    const day = validIso(known.get(dateField)?.value);
    if (subject && subject !== UNKNOWN_VALUE && day) {
      const periods = periodsOf(timetable, day, subject);
      if (periods.length === 1) {
        all.set('lesson', { field: 'lesson', value: String(periods[0]), origin: 'inferred', extracted_by: 'script' });
        ambiguous.delete('lesson');
      } else if (periods.length > 1) {
        ambiguous.set('lesson', periods.map(String));
      }
    }
  }

  const missing = ESSENTIAL_FIELDS[type].filter((field) => !all.has(field));
  // כרטיס האישור נשאל רק כשיש מה לאשר: תאריך ושעה מפוענחים (לא unknown).
  const confirmable = ['date', 'time'].every((field) => all.has(field) && all.get(field).value !== UNKNOWN_VALUE);
  const nextField = ASK_ORDER.find((field) => missing.includes(field) && (field !== CONFIRM_FIELD || confirmable));
  // יום המערכת לכפתורים: בהזזה, השיעור נשאל לפי המועד החדש והמקצוע לפי המועד המקורי (אם נאמר), כמו ב-extractFacts.
  const dayFields = type === 'move' ? (nextField === 'lesson' ? ['new_date'] : ['date', 'new_date']) : ['date'];
  const day = dayFields.map((field) => validIso(all.get(field)?.value)).find(Boolean);
  // יום ההודעה בישראל, לכפתורי "היום" ו"מחר" בשאלת התאריך. received_at לא תקין: בלי כפתורים אלה (ההתנהגות הישנה).
  let today;
  if ((nextField === 'date' || nextField === CONFIRM_FIELD) && source.received_at !== null && source.received_at !== undefined && source.received_at !== '') { // new Date(null) הוא 1970, לא שגיאה
    try {
      today = localDateIso(source.received_at);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  const next = nextField
    ? buildQuestion({ field: nextField, type, candidates: ambiguous.get(nextField), timetable, date: day, today, facts: [...all.values()] })
    : null;

  const facts = [...all.values()];
  const contradiction = fresh.type === type && fresh.certainty === 'uncertain' && fresh.ambiguous.length === 0; // uncertain בלי עמימות = סתירה
  const { certainty } = assessFacts({ type, facts, ambiguous: [...ambiguous].map(([field, candidates]) => ({ field, candidates })), contradiction });
  return { type, all, ambiguous, missing, next, certainty, understood: isUnderstood(type, facts), extracted: fresh };
}

// "נרשם · מבחן · מתמטיקה · שלישי 13.10" כשהסוג, המקצוע והתאריך מפוענחים; אחרת "התקבל" (03-intake-rules.md:60; 35 סעיף 3.8.0).
function replyFor(state) {
  if (!state.understood) return RECEIVED_REPLY;
  const date = state.all.get(state.type === 'move' ? 'new_date' : 'date')?.value;
  try {
    return formatReply({ type: state.type, subject: state.all.get('subject')?.value, title: state.all.get('topic')?.value, date, weekday: WEEKDAY_NAMES[weekdayOf(date)] });

  } catch (error) {
    if (error instanceof RangeError) return RECEIVED_REPLY;
    throw error;
  }
}

const factsJson = (facts) => JSON.stringify(facts.map(({ field, value, origin }) => ({ field, value, origin })));

// ---------------------------------------------------------------------------
// קליטה
// ---------------------------------------------------------------------------

// האם יש שורה קודמת עם אותו content_hash באותו יום קלנדרי בשעון ישראל (I-21). "קודמת": received_at קטן יותר, ובשוויון id קטן יותר; לא השורה עצמה.
// קודמת נחשבת "טופלה" אם processed_at שלה מלא, או שיש לה שורה ב-messages (בועה או שאלה, entity_type='source'): הודעה מוקלדת שקיבלה "התקבל"
// או שאלת "מה זה?" נשארת עם processed_at ריק, ובלי התנאי השני אותו טקסט מוקלד שוב היה מקבל "התקבל" שני או כרטיס שני (47 קריטריון 15).
// קודמת שנכשלה ואין לה שום שורה ב-messages (processed_at ריק) אינה נחשבת כפילות (ביקורת 12.10, סעיף 14), ולכן ההעתק מעובד.
// ההשוואה נעשית במסד לפי השורה השמורה (בלי להעביר חותמת מ-JS, שמאבדת מיקרו-שניות), ובלי תאריכי DST בקוד (build-rules 32).
// לפי תוכן בלבד ובין ערוצים (35 D8): גם הודעה שהועברה אחרי אותו טקסט מוקלד שקיבל בועה או שאלה היא "כבר קיבלתי".
// שורת תשובה (sender='answer') נשמרת עם content_hash ריק, ו-NULL לעולם לא שווה ל-NULL: תשובה אינה כפילות (47 "איך נשמר מה").
async function hasEarlierSameDay(sql, id) {
  const rows = await sql`
    SELECT 1 AS found
    FROM sources s
    JOIN sources p ON p.content_hash = s.content_hash AND p.id <> s.id
    WHERE s.id = ${id}::uuid
      AND (p.processed_at IS NOT NULL OR EXISTS (SELECT 1 FROM messages x WHERE x.entity_type = 'source' AND x.entity_id = p.id))
      AND (p.received_at AT TIME ZONE 'Asia/Jerusalem')::date = (s.received_at AT TIME ZONE 'Asia/Jerusalem')::date
      AND (p.received_at < s.received_at OR (p.received_at = s.received_at AND p.id < s.id))
    LIMIT 1
  `;
  return rowsOf(rows).length > 0;
}

// בועת "התקבל" להודעה מוקלדת שאין עליה שאלה ואין בה הבנה (ה2). פקודה אחת; פעם אחת לכל מקור (NOT EXISTS של בועה קיימת).
// בלי תפיסה: processed_at נשאר ריק (ראה הנחות למעלה). בלי read_at (ראה "בועות תשובה" למעלה).
async function writeReceipt(sql, sourceId) {
  await sql`
    WITH b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${RECEIVED_REPLY}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', s.id, NULL::integer
      FROM sources s
      WHERE s.id = ${sourceId}::uuid
        AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source' AND x.entity_id = s.id)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM b)::int AS bubbles_written
  `;
}

// שאלת "מה זה?" (ה4): פקודה אחת, רק למקור שלא טופל, ורק אם אין לו שאלה כלשהי ("שאלת הסוג לא נוצרת פעמיים", 47 קריטריון 11). processed_at נשאר ריק.
async function writeTypeQuestion(sql, sourceId, text) {
  await sql`
    WITH q AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${text}::text, 'question', now(), true, NULL::uuid, NULL::timestamptz, 'source', s.id, 1
      FROM sources s
      WHERE s.id = ${sourceId}::uuid AND s.processed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.kind = 'question' AND x.entity_type = 'source' AND x.entity_id = s.id)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM q)::int AS questions_written
  `;
}

// כפילות בהודעה מוקלדת: תפיסת המקור (processed_at) ובועת "כבר קיבלתי", בפקודה אחת. הבועה נכתבת רק אם התפיסה הצליחה.
async function markTypedDuplicate(sql, sourceId) {
  await sql`
    WITH claim AS (
      UPDATE sources SET processed_at = now()
      WHERE id = ${sourceId}::uuid AND processed_at IS NULL
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${DUPLICATE_REPLY}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', claim.id, NULL::integer
      FROM claim
      WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source' AND x.entity_id = claim.id)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM claim)::int AS claimed, (SELECT count(*) FROM b)::int AS bubbles_written
  `;
}

const UNCLASSIFIED = Object.freeze({ status: 'unclassified', reply: RECEIVED_REPLY });

export async function processSource({ sql, source, timetable } = {}) {
  if (typeof sql !== 'function') throw new TypeError('processSource: חסר sql');
  if (!source || typeof source.id !== 'string' || source.id === '') throw new TypeError('processSource: חסר source.id');

  const typed = source.channel === CHANNEL_APP;
  // ערוץ שאינו הקיצור ואינו הצ'אט המוקלד (calendar, system, file): לא מעובד כאן.
  if (source.channel !== CHANNEL_SHORTCUT && !typed) return { status: 'skipped', reply: RECEIVED_REPLY };
  const text = source.raw_content;

  // צעד 1: הודעה ארוכה מאוד: בלי חילוץ (המקור כבר נשמר, processed_at נשאר ריק). בקיצור בלי מסד בכלל; מוקלדת מקבלת בועת "התקבל" בלי שאלה.
  if (typeof text === 'string' && text.length > MAX_PROCESSABLE_LENGTH) {
    if (typed) await writeReceipt(sql, source.id);
    return { ...UNCLASSIFIED };
  }

  // צעד 2: כפילות (D8: לפי תוכן בלבד, בין ערוצים).
  if (await hasEarlierSameDay(sql, source.id)) {
    // השורה נשארת (המקור נשמר תמיד). הטיפול בה הסתיים, ולכן מסומנת; כשל בסימון לא משנה את התשובה.
    // הקיצור: אותה פקודה בדיוק כמו לפני שלב 8.2א-1 (בלי בועה: הקיצור כבר הציג "כבר קיבלתי", 47 "מה נכנס" סעיף 6). מוקלדת: גם בועת "כבר קיבלתי".
    try {
      if (typed) await markTypedDuplicate(sql, source.id);
      else await sql`UPDATE sources SET processed_at = now() WHERE id = ${source.id}::uuid AND processed_at IS NULL`;
    } catch (error) {
      console.error('intake: סימון כפילות נכשל:', error?.name);
    }
    return { status: 'duplicate', reply: DUPLICATE_REPLY };
  }

  // צעדים 3-4 (מוקלדת בלבד, D9): משימה או שאלה אמיתית = "התקבל", בלי חילוץ ובלי שאלה. משימות הן שלב 8.6 ושליפה לא נבנתה בפרק 8 (47, תרחיש ג).
  if (typed && (channelRole({ channel: CHANNEL_APP, text }) === 'task' || isRealQuestion(text))) {
    await writeReceipt(sql, source.id);
    return { ...UNCLASSIFIED };
  }

  const table = timetable === undefined ? await loadTimetable(sql) : timetable; // null מותר: מעבדים בלי השלמה
  let extracted;
  try {
    extracted = extractFacts({ text, receivedAt: source.received_at, channel: source.channel, timetable: table });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    // חותמת קליטה לא תקינה: לא מסווג. מוקלדת מקבלת "התקבל" (אין שאלה ואין הבנה).
    if (typed) await writeReceipt(sql, source.id);
    return { ...UNCLASSIFIED };
  }
  // מידע קודם (03-intake-rules.md:157-174): כשנמצא סוג, נרשם גם אם יש סימן שאלה. לא נמצא סוג: לא מבינים, processed_at נשאר NULL, בלי עובדות (שלב 8.5).
  if (!extracted.type) {
    if (!typed) return { ...UNCLASSIFIED };
    // צעד 6 (מוקלדת): פקודה או הצגה = "התקבל"; מידע שלא הובן = שאלת "מה זה?" (D10). הכרטיס הוא התגובה, ולכן בלי בועה.
    if (typeQuestionApplies(source)) await writeTypeQuestion(sql, source.id, buildQuestion({ field: TYPE_FIELD }).text);
    else await writeReceipt(sql, source.id);
    return { ...UNCLASSIFIED };
  }
  // שאלה שהועברה (03-intake-rules.md:167, צעד 3): יש סוג, אבל זו שאלה ואין בה תאריך = אין מידע לרשום. התשובה לשאלה (שליפה) לא נבנתה בפרק 8, לכן "לא מסווג", בלי כתיבה.
  // [הנחה, לא אומת] "יש מידע" נבדק כאן כעובדת date או new_date בלבד. רק בקיצור: בערוץ app שאלות כבר סוננו בצעד 4 (ה1, צעד 5).
  if (!typed && detectIntent(text) === 'read' && !extracted.facts.some((fact) => fact.field === 'date' || fact.field === 'new_date')) {
    return { ...UNCLASSIFIED };
  }

  const saved = [{ field: TYPE_FIELD, value: extracted.type, origin: 'read' }, ...extracted.facts];
  const state = resolveState({ source, saved, timetable: table, extracted });
  const question = state.next; // שאלה אחת בלבד; הבאה נוצרת אחרי שנענתה (answerQuestion)
  const reply = replyFor(state);
  // הבועה (ה2): "נרשם" כשהובנה עכשיו (הרגע הראשון). מוקלדת שלא הובנה ואין עליה שאלה: "התקבל". אחרת (שאלה נפתחה, או קיצור שלא הובן): בלי בועה.
  let bubble = null;
  if (state.understood && reply !== RECEIVED_REPLY) bubble = reply;
  else if (typed && !question) bubble = RECEIVED_REPLY;

  // פקודה אחת אטומית: תפיסת המקור (processed_at) + כל העובדות + השאלה הראשונה + הבועה. אם המקור כבר טופל, התפיסה לא מחזירה שורה ואין הכנסות.
  const written = rowsOf(await sql`
    WITH claim AS (
      UPDATE sources SET processed_at = now()
      WHERE id = ${source.id}::uuid AND processed_at IS NULL
      RETURNING id
    ), f AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin, haiku_confidence)
      SELECT claim.id, x.field, x.value, ${extracted.certainty}::text, 'script', NULL::text, NULL::uuid, x.origin, NULL::text
      FROM claim, jsonb_to_recordset(${factsJson(saved)}::jsonb) AS x(field text, value text, origin text)
      RETURNING id
    ), m AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${question?.text ?? null}::text, 'question', now(), true, NULL::uuid, NULL::timestamptz, 'source', claim.id, 1
      FROM claim
      WHERE ${question?.text ?? null}::text IS NOT NULL
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${bubble}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', claim.id, NULL::integer
      FROM claim
      WHERE ${bubble}::text IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source' AND x.entity_id = claim.id)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM claim)::int AS claimed, (SELECT count(*) FROM f)::int AS facts_written, (SELECT count(*) FROM m)::int AS questions_written,
      (SELECT count(*) FROM b)::int AS bubbles_written
  `);
  // claimed = 0: מישהו אחר כבר תפס את המקור (ניסיון חוזר, מירוץ), ולא נכתב כלום (ביקורת 12.10, סעיף 13). בלי שורות בתוצאה (למשל sql מזויף): כמו קודם.
  if (written.length > 0 && Number(written[0].claimed) === 0) return { status: 'skipped', reply: RECEIVED_REPLY };
  return { status: 'recorded', reply };
}

// ---------------------------------------------------------------------------
// שאלה פתוחה ותשובה
// ---------------------------------------------------------------------------

// השאלה הבאה למקור: { field, text, buttons, allowFreeText } או null. facts = שורות facts של המקור מהמסד ({ field, value, origin }).
// מחשב מחדש את החילוץ מהטקסט המקורי, ומוריד מה שכבר נשמר. פונקציה טהורה: לא כותבת ולא קוראת מהמסד.
// מקור מוקלד בלי סוג: שאלת "מה זה?" (field = 'type'), כמו בקליטה.
export function pendingQuestion({ source, facts, timetable } = {}) {
  if (!source) throw new TypeError('pendingQuestion: חסר source');
  return resolveState({ source, saved: Array.isArray(facts) ? facts : [], timetable }).next;
}

// הבועה שנכתבת בתשובה (ה2): "נרשם" רק ברגע ההבנה הראשון (לא הובן לפני התשובה, והובן אחריה). מוקלדת שהשאלה האחרונה שלה נסגרה בלי שהובנה אף פעם: "התקבל".
// הודעה שהועברה לא מקבלת "התקבל" אף פעם (הקיצור כבר הציג אותו, 47 "מה נכנס" סעיף 6). ה-SQL מוסיף NOT EXISTS: אם כבר יש בועה למקור, לא נכתבת עוד אחת.
function bubbleAfterAnswer({ channel, before, after, done }) {
  if (!before.understood && after.understood) {
    const recorded = replyFor(after);
    if (recorded !== RECEIVED_REPLY) return recorded;
  }
  if (channel === CHANNEL_APP && done && !after.understood) return RECEIVED_REPLY;
  return null;
}

// מחזיר { done, reply, status, created }. status: 'answered' (נכתב) · 'closed' (השאלה כבר סגורה, לא קיימת, או נסגרה בלחיצה מקבילה: לא נכתב כלום)
// · 'unclear' (אי אפשר לפענח את התשובה: לא נכתב כלום, והשאלה נשארת פתוחה). created: מזהי השורות שנוצרו (מקור התשובה, הבועה, השאלה הבאה); מה שלא נוצר: null.
export async function answerQuestion({ sql, messageId, answer, timetable, now = new Date(), recordCandidateRules = RECORD_CANDIDATE_RULES } = {}) {
  if (typeof sql !== 'function') throw new TypeError('answerQuestion: חסר sql');
  if (typeof messageId !== 'string' || messageId === '') throw new TypeError('answerQuestion: חסר messageId');
  const closed = { done: false, reply: null, status: 'closed', created: { ...NOTHING_CREATED } };

  const [message] = rowsOf(await sql`
    SELECT id, kind, awaiting_reply, entity_type, entity_id, attempt FROM messages WHERE id = ${messageId}::uuid
  `);
  if (!message || message.kind !== 'question' || message.awaiting_reply !== true || message.entity_type !== 'source' || !message.entity_id) return closed;

  const [source] = rowsOf(await sql`
    SELECT id, channel, raw_content, content_hash, received_at FROM sources WHERE id = ${message.entity_id}::uuid
  `);
  if (!source) return closed;
  const saved = rowsOf(await sql`SELECT field, value, origin FROM facts WHERE source_id = ${source.id}::uuid`);
  const table = timetable === undefined ? await loadTimetable(sql) : timetable;

  const before = resolveState({ source, saved, timetable: table });
  const field = before.next?.field;
  const savedFields = new Set(saved.map((row) => row.field));
  let rows = [];
  let after = before;
  let nextQuestion = null;
  let markProcessed = false;
  if (field === TYPE_FIELD) {
    // שאלת "מה זה?" (ה4). "לא יודע": סוגרים בלי עובדות, וההודעה נשמרת כלא מסווגת (processed_at ריק).
    const chosen = parseTypeAnswer(answer);
    if (chosen === null) return { done: false, reply: before.next.text, status: 'unclear', created: { ...NOTHING_CREATED } };
    if (chosen !== UNKNOWN_VALUE) {
      // סוג שנבחר: חילוץ מחדש מהטקסט המקורי עם הסוג הכפוי, שמירת עובדת type ועוד מה שחולץ, וסימון המקור כמטופל. שואלים רק על מה שחסר (47 קריטריון 11).
      const typeRow = { field: TYPE_FIELD, value: chosen, origin: 'read' };
      const forced = safeExtract(source, table, chosen);
      after = resolveState({ source, saved: [...saved, typeRow, ...forced.facts], timetable: table, extracted: forced });
      rows = [typeRow, ...after.all.values()].filter((fact) => !savedFields.has(fact.field));
      nextQuestion = after.next;
      markProcessed = true;
    }
  } else if (field) {
    const applied = applyAnswer({ facts: [...before.all.values()], field, answer, receivedAt: now });
    const parsed = applied.find((fact) => fact.field === field);
    // תשובה שאי אפשר לפענח (תאריך לא תקין, שיעור בלי מספר, ריקה): לא כותבים כלום, והשאלה נשארת פתוחה.
    if (!parsed) return { done: false, reply: before.next.text, status: 'unclear', created: { ...NOTHING_CREATED } };
    after = resolveState({ source, saved: [...saved, parsed], timetable: table, extracted: before.extracted });
    rows = [...after.all.values()].filter((fact) => !savedFields.has(fact.field)); // שדות חדשים בלבד: אין UPDATE על עובדות קיימות
    nextQuestion = after.next;
  }
  // בלי שדה פתוח (המצב כבר שלם): השאלה נסגרת עם התשובה, בלי עובדות חדשות.

  // רישום ב-candidate_rules (I-48): כבוי כברירת מחדל (RECORD_CANDIDATE_RULES). כשדלוק: רק בהודעה שיובל הקליד בעצמו; בהודעות מהקיצור (טקסט של אחרים)
  // לא נרשם כלום, כדי לא לשמור שמות (ראה הערה בראש הקובץ). כשכבוי הפרמטרים של הדפוס הם NULL: ה-CTE קיים בפקודה אבל אינו כותב ואינו מעדכן.
  const rule = recordCandidateRules && source.channel === CHANNEL_APP && field && after.type
    ? answerPattern({ type: after.type, field, rootsThatFellThrough: fellThroughRoots(source.raw_content) })
    : null;
  const pattern = rule?.pattern ?? null;
  const attempt = (Number(message.attempt) || 1) + 1;
  const done = !nextQuestion;
  const bubble = bubbleAfterAnswer({ channel: source.channel, before, after, done });
  // התשובה כפי שנשלחה, כשורת מקור (47 "איך נשמר מה"): ערוץ app, sender='answer', content_hash ריק (לא כפילות), ומסומנת כטופלה.
  const answerText = String(answer ?? '');

  // פקודה אחת אטומית: סגירת השאלה (compare-and-set על awaiting_reply, read_at, ומזהה חדש לשורת התשובה) + שורת התשובה ב-sources + עובדות חדשות
  // + סימון המקור כמטופל (רק אחרי בחירת סוג) + השאלה הבאה + בועה + דפוס. אם השאלה כבר נסגרה, אין הכנסות.
  // reply_source_id נקבע ב-closed (gen_random_uuid) ושורת המקור מוכנסת מתוך closed עם אותו מזהה, כך שאין הכנסה שאינה תלויה בסגירה ואין שורת מקור יתומה בלחיצה כפולה.
  // המפתח הזר messages.reply_source_id -> sources.id: ב-Postgres בדיקת מפתח זר שאינו DEFERRABLE היא טריגר AFTER שרץ בסוף הפקודה (לא בסוף כל CTE),
  // ואז שורת המקור שהוכנסה באותה פקודה כבר נראית. [הנחה, לא אומת: מבוסס על תיעוד Postgres ("NOT DEFERRABLE ... checked immediately after every command"), לא הורץ מול Neon]
  const written = rowsOf(await sql`
    WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true
      RETURNING id, reply_source_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${answerText}::text, NULL::text, now(), now()
      FROM closed
      RETURNING id
    ), f AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin, haiku_confidence)
      SELECT ${source.id}::uuid, x.field, x.value, ${after.certainty}::text, 'script', NULL::text, NULL::uuid, x.origin, NULL::text
      FROM closed, jsonb_to_recordset(${factsJson(rows)}::jsonb) AS x(field text, value text, origin text)
      RETURNING id
    ), p AS (
      UPDATE sources SET processed_at = now()
      WHERE id = ${source.id}::uuid AND processed_at IS NULL AND ${markProcessed}::boolean AND EXISTS (SELECT 1 FROM closed)
      RETURNING id
    ), m AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${nextQuestion?.text ?? null}::text, 'question', now(), true, NULL::uuid, NULL::timestamptz, 'source', ${source.id}::uuid, ${attempt}::integer
      FROM closed
      WHERE ${nextQuestion?.text ?? null}::text IS NOT NULL
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${bubble}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', ${source.id}::uuid, NULL::integer
      FROM closed
      WHERE ${bubble}::text IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source' AND x.entity_id = ${source.id}::uuid)
      RETURNING id
    ), r_upd AS (
      UPDATE candidate_rules
      SET occurrences = coalesce(occurrences, 0) + 1, last_seen = now(),
          evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object('message_ids', coalesce(evidence -> 'message_ids', '[]'::jsonb) || to_jsonb(${messageId}::text))
      WHERE pattern = ${pattern}::text AND EXISTS (SELECT 1 FROM closed)
      RETURNING id
    ), r_ins AS (
      INSERT INTO candidate_rules (pattern, occurrences, first_seen, last_seen, evidence, status)
      SELECT ${pattern}::text, 1, now(), now(), jsonb_build_object('message_ids', jsonb_build_array(${messageId}::text)), 'candidate'
      FROM closed
      WHERE ${pattern}::text IS NOT NULL AND NOT EXISTS (SELECT 1 FROM r_upd)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id, (SELECT id FROM b) AS bubble_id, (SELECT id FROM m) AS question_id
  `);
  const [result] = written;
  if (Number(result?.closed) === 0) return closed; // מישהו אחר (לחיצה כפולה) כבר ענה: לא נכתב כלום

  const created = { answerSourceId: result?.answer_source_id ?? null, bubbleId: result?.bubble_id ?? null, questionId: result?.question_id ?? null };
  // גם כשאין שדה פתוח השאלה נסגרה עכשיו עם התשובה (נכתבו שורת תשובה וסגירה), ולכן 'answered' ולא 'closed' (47 קריטריון 6: closed לא כותב כלום).
  return { done, reply: done ? replyFor(after) : nextQuestion.text, status: 'answered', created };
}
