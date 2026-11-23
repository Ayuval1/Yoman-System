// צינור הקליטה (שלב 8.2, קוד בלבד): מחבר את מודולי הלוגיקה (lib/intake-*.js, lib/timetable.js) לנקודת הקליטה api/intake.js.
// מקור: docs/08-chapter8/35-chapter8-plan.md סעיפים 3.8.0 ו-8.2; docs/02-rules/03-intake-rules.md:157-174 ("מידע קודם, שאלה כרשת ביטחון"),
// 284-286 ("אותה הודעה פעמיים"); docs/02-rules/03-app-channel-rules.md:101,103 (התשובה והכפילות בקיצור). בלי רשת: מסד בלבד, מוזרק (sql). המוח (בלוק 3ב-1) נכנס רק דרך understand מוזרק (lib/intake-brain.js -> lib/brain/ask.js).
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
//  - תשובה ל-confirm שומרת את העובדה (yes / no) וסוגרת את השאלה; לא נכתבת בועת "נרשם" שנייה (היא נכתבה בקליטה). "לא נכון" פותח את סבב התיקון (שלב 8.3-3, למטה).
//  - בועה: "נרשם · יציאה מוקדמת · שני 19.10" ו"נרשם · אירוע אישי · בדיקה רפואית · שני 19.10" (הכותרת במקום המקצוע).
//
// שלב 8.3-3 ("ישות האירוע הפנימית וזרימת האישור", docs/08-chapter8/65 D1, D2, D2א, D3, D5; H2 ו-H3 נסגרו בהאצלה: אירוע שיובל מקליד = פעולה 1א,
// והכותרת = המילים של יובל בלי תאריך ושעה, כלומר עובדת topic):
//  - שורת events (פעולה 5) לשני הסוגים early_leave ו-personal_event, ברגע שבמצב המקור יש תאריך תקין ושעה HH:MM (לא unknown): בקליטה (processSource)
//    או בתשובה שמשלימה אותם (answerQuestion). באותה פקודה אטומית, רק כשהתפיסה (claim) או הסגירה (closed) החזירו שורה.
//    personal_event: title = topic, או "אירוע אישי"; domain 'personal'; מ-date+time עד date+end_time; movable NULL. early_leave: title "יציאה מוקדמת"; domain 'school';
//    מ-date+time עד סוף יום הלימודים (schoolDayEnd) אם הוא אחרי השעה, אחרת עד date+time; movable false. status 'planned', external_id NULL (נמלא ב-8.3-4), description NULL.
//  - match_key = 'source:' + מזהה המקור. ההכנסה היא INSERT ... WHERE NOT EXISTS על match_key: הרצה כפולה או לחיצה כפולה = שורה אחת. אין אילוץ UNIQUE במסד (06:74),
//    ולכן [הנחה, לא אומת] כמו בבועות: מוגן מהרצה חוזרת, לא מהרצה מקבילה בדיוק באותו רגע.
//  - ההמרה לשעון ישראל נעשית ב-SQL: ((date || ' ' || time)::timestamp AT TIME ZONE 'Asia/Jerusalem'). אין תאריכי מעבר שעון בקוד.
//  - הנתונים לאירוע עוברים כפרמטר JSON אחד (jsonb_to_recordset, כמו העובדות): '[]' = אין אירוע, וה-CTE לא כותב כלום.
//  - "לא נכון" בכרטיס פותח שאלה אחת "מה לא נכון?" (השעה / התאריך / לא קורה), שנשמרת כעובדה fix. "השעה" / "התאריך" שואלים שוב את השעה או את התאריך
//    (fix_time / fix_date), ואחרי התשובה, באותה פקודה: UPDATE לשורת האירוע (אירוע אישי: התחלה חדשה וסיום שעה אחריה, D3; יציאה מוקדמת: התחלה חדשה וסיום
//    לפי סוף יום הלימודים של התאריך בפועל) ובועה "עודכן · ...". "לא קורה": UPDATE status='cancelled' (בלי מחיקה) ובועה "בוטל · ...".
//    שתי הבועות האלה הן חריג לכלל "בועה אחת למקור": הן נכתבות גם כשיש כבר "נרשם", ומוגנות רק מפני בועה זהה לאותו מקור.
//  - **סבב תיקון אחד בלבד.** אחרי fix_time / fix_date אין כרטיס אישור שני, ואין דרך לתקן שוב מהצ'אט. "נכון" לא משנה דבר באירוע.
//  - תשובת "לא יודע" ל-fix_time / fix_date נשמרת כ-'unknown' ולא משנה את האירוע, ואין בועה. [הנחה, לא אומת]
//  - עובדות append-only: התיקון נשמר בשדות חדשים (fix_time, fix_date) ולא דורס את time / date. הערכים "בפועל" = fix_date ?? date, fix_time ?? time (effectiveWhen).
//  - שאלת fix נגזרת ב-resolveState בכל מקור עם confirm=no ובלי fix, אבל שאלה מופיעה ליובל (רשימת הממתינים, המספר על האייקון, הבריף) רק כשיש שורת messages
//    פתוחה (awaiting_reply). שורה כזו נוצרת רק ב-processSource (מקור חדש, שעוד אין לו confirm) וב-answerQuestion (על שאלה פתוחה). מקור ישן עם confirm=no
//    ששאלתו נסגרה לפני השלב הזה לא מקבל שום שורה חדשה, ולכן לא מקבל שאלה.
// בלוק 3ב-2 (אפיון-מורחב ח-2, ח-6): הסוג unavailable ("לא זמין", lib/unavailable.js: שאלות משלו, חלון ב-events) ו"אני פנוי?" (lib/free-check.js: תשובה בקוד בבועה,
// status 'recorded'). זיהוי במוח (kind), ונפילה דטרמיניסטית לניסוחים ברורים (detectAvailability) לפני צעדי המשימה והשאלה. "לא זמין" רק בהודעה מוקלדת.
// בלוק 4 (מפרט 60 סעיף 12, קריטריון 12; lib/personal-task.js): משימה מוקלדת נרשמת ב-tasks (domain='personal'), במקום "התקבל". המוח קובע שזו משימה (kind='task')
// ומעתיק כותרת וביטויי מועד; בלי מוח, הקוד קובע (channelRole: פועל משימה ראשון). סימן שאלה או מילת שאלה = לא משימה ("להתקשר לסבתא?" נשארת "התקבל"), בשני המסלולים.
// הודעה מועברת שהמוח קרא כמשימה: של מישהו אחר, ולכן "לא מסווג" כמו קודם. התוצאה כוללת task: { id, dueAt, timed } לתזמון "בוצע?" (api/intake.js).
// בלוק 4, זיהוי שהודעה שייכת לאירוע קיים (lib/event-match.js): אחרי שהסוג נקבע (אירוע אישי, הזזה, ביטול) ולפני הרישום. התאמה ודאית = עדכון האירוע הקיים
// (status 'recorded', matched: { sourceId } לכתיבה ליומן); כפילות = "כבר רשום"; עמום = שאלת "זה אותו דבר כמו ...?" (entity_type 'event_match'); אין = המסלול הקיים.
// המוח מקבל את המועמדים (understand({ candidates })) ומחזיר match; בלי מוח, ניקוד בקוד. replyTo ("הגב") על הודעה של אירוע = ההתאמה.
// matchDisabled: אחרי "לא, חדש" (answerEventMatch), המסלול הקיים בלי זיהוי.
// תתי-משימות (הכרעת יובל 22.11.2026, lib/subtask.js): בהודעה מוקלדת המוח מקבל גם את המשימות הפתוחות (understand({ loadTaskCandidates })) ומחזיר parent / parent_text.
// אחרי שמשימה נרשמה: קישור מיד (התאמה מפורשת ודאית), כרטיס "זה חלק מ...?", או כלום. בלי מוח: כלום, ורק שורת מדידה. התוצאה כוללת subtask כשנעשה משהו.
// בלוק 5 חלק א' (docs/02-rules/03-4fitness-rules.md): לוז 4fitness בפורמט הרגיל מטופל בקוד אחרי בדיקת הכפילות ולפני המוח (tryFitnessSchedule למטה).
// התוצאה כוללת fitness: { keys, patchKeys } לכתיבה ליומן "אימונים" (api/intake.js -> lib/event-sync.js syncEventsByMatchKeys).
import { extractFacts, assessFacts, isUnderstood, slotMatchesSubject, ESSENTIAL_FIELDS, UNKNOWN_VALUE, CONFIRM_FIELD, FIX_FIELD, FIX_TIME_FIELD, FIX_DATE_FIELD, isTimedType, missedLessons, schoolDayEnd, plusOneHour, findLastLessons, lastLessonPeriods } from './intake-facts.js';
import { buildQuestion, applyAnswer, answerPattern, formatReply, parseTypeAnswer, RECEIVED_REPLY, DUPLICATE_REPLY } from './intake-questions.js';
import { fellThroughRoots } from './intake-dictionary.js';
import { tokenize } from './intake-text.js';
import { detectIntent, intentSignals, channelRole } from './intake-intent.js';
import { parseIso, weekdayOf, localDateIso, formatDayMonth, WEEKDAY_NAMES } from './intake-dates.js';
import { loadTimetable } from './timetable.js';
import { mergeUnderstanding, RETRY_REASONS } from './intake-brain.js';
import { extractUnavailable, resolveUnavailable, applyUnavailableAnswer, unavailableEventRow, unavailableReply, addConflict, UNAVAILABLE_TYPE } from './unavailable.js';
import { answerFreeCheck, detectAvailability } from './free-check.js';
import { answerBringMe, detectBringMe, startsLikeBringRequest } from './bring-me.js'; // בלוק 8: "תביא לי"
import { readTask, recordPersonalTask } from './personal-task.js';
import { suggestTimeForTask } from './time-suggest.js';
import {
  MATCH_TYPES, MATCH_FACT, loadEventPool, loadReplyEvent, brainCandidates, readChange, decideMatch, examLinkFor, examLinkExtras, logMatch,
  writeMatched, writeMatchQuestion, questionFor, pendingPayload, updateReply, duplicateReply,
} from './event-match.js';
import { loadParentPool, brainTaskCandidates, suggestParentAfterRecord } from './subtask.js';
import { parseFitnessSchedule, planFitnessWeek, FITNESS_TITLE_PREFIX, PREP_TITLE } from './fitness-schedule.js';
import { loadApprovedCorrectionRules, applyCorrectionRules, recordCorrection } from './correction-rules.js';

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
    if (forcedType === UNAVAILABLE_TYPE) return extractUnavailable({ text: source.raw_content, receivedAt: source.received_at });
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
  // בלוק 3ב-2 (ח-2): "לא זמין" מנוהל ב-lib/unavailable.js (שאלות משלו: משמעות, "עד מתי?", "מה הסיבה?").
  if (type === UNAVAILABLE_TYPE) {
    let today = null;
    try {
      today = localDateIso(source.received_at);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
    const ambiguousNow = new Map(fresh.type === type ? fresh.ambiguous.map((entry) => [entry.field, entry.candidates]) : []);
    return { type, ...resolveUnavailable({ known, ambiguous: ambiguousNow, fresh: fresh.type === type ? fresh : undefined, today }), extracted: fresh };
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
  // שלב 8.3-3: כשכל השדות נענו ו-confirm=no, סבב התיקון (fix, ואחריו fix_time או fix_date). אחריו אין עוד שאלה (סבב אחד).
  const nextField = ASK_ORDER.find((field) => missing.includes(field) && (field !== CONFIRM_FIELD || confirmable)) ?? (isTimedType(type) ? correctionField(all) : undefined);
  // יום המערכת לכפתורים: בהזזה, השיעור נשאל לפי המועד החדש והמקצוע לפי המועד המקורי (אם נאמר), כמו ב-extractFacts.
  const dayFields = type === 'move' ? (nextField === 'lesson' ? ['new_date'] : ['date', 'new_date']) : ['date'];
  const day = dayFields.map((field) => validIso(all.get(field)?.value)).find(Boolean);
  // יום ההודעה בישראל, לכפתורי "היום" ו"מחר" בשאלת התאריך. received_at לא תקין: בלי כפתורים אלה (ההתנהגות הישנה).
  let today;
  if ((nextField === 'date' || nextField === CONFIRM_FIELD || nextField === FIX_DATE_FIELD) && source.received_at !== null && source.received_at !== undefined && source.received_at !== '') { // new Date(null) הוא 1970, לא שגיאה
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
  if (state.type === UNAVAILABLE_TYPE) return unavailableReply(state.all) ?? RECEIVED_REPLY;
  const date = state.all.get(state.type === 'move' ? 'new_date' : 'date')?.value;
  try {
    return formatReply({ type: state.type, subject: state.all.get('subject')?.value, title: state.all.get('topic')?.value, lesson: state.all.get('lesson')?.value, date, weekday: WEEKDAY_NAMES[weekdayOf(date)] });

  } catch (error) {
    if (error instanceof RangeError) return RECEIVED_REPLY;
    throw error;
  }
}

const factsJson = (facts) => JSON.stringify(facts.map(({ field, value, origin }) => ({ field, value, origin })));

// ---------------------------------------------------------------------------
// שלב 8.3-3: שורת האירוע וסבב התיקון
// ---------------------------------------------------------------------------

const PERSONAL_EVENT_FALLBACK_TITLE = 'אירוע אישי';
const EARLY_LEAVE_TITLE = 'יציאה מוקדמת';
const matchKeyOf = (sourceId) => `source:${sourceId}`;
const validTime = (value) => (typeof value === 'string' && HHMM.test(value) ? value : null);

// השאלה הבאה בסבב התיקון (all: Map שדה -> עובדה), או undefined. רק אחרי confirm=no; סבב אחד: fix, ואחריו fix_time או fix_date לפי הבחירה.
function correctionField(all) {
  if (all.get(CONFIRM_FIELD)?.value !== 'no') return undefined;
  const fix = all.get(FIX_FIELD)?.value;
  if (fix === undefined) return FIX_FIELD;
  if (fix === 'time' && !all.has(FIX_TIME_FIELD)) return FIX_TIME_FIELD;
  if (fix === 'date' && !all.has(FIX_DATE_FIELD)) return FIX_DATE_FIELD;
  return undefined;
}

// התאריך והשעה בפועל: התיקון (אם נענה בערך תקין) גובר על הערך המקורי. corrected = נענה תיקון תקין.
function effectiveWhen(all) {
  const fixDate = validIso(all.get(FIX_DATE_FIELD)?.value);
  const fixTime = validTime(all.get(FIX_TIME_FIELD)?.value);
  return { date: fixDate ?? validIso(all.get('date')?.value), time: fixTime ?? validTime(all.get('time')?.value), corrected: Boolean(fixDate || fixTime), timeCorrected: Boolean(fixTime) };
}

// שורת האירוע (לפרמטר ה-JSON) או null: רק לשני הסוגים, ורק עם תאריך תקין ושעה HH:MM בפועל. התאריך והשעה עוברים כטקסט, וההמרה לשעון ישראל ב-SQL.
//  personal_event: הסיום הוא end_time השמור (נקרא, או שעה אחרי ההתחלה שהוסקה); אחרי תיקון שעה: שעה אחרי ההתחלה החדשה (D3, plusOneHour: מ-23:00 ואילך 23:59).
//  תיקון תאריך בלבד שומר את שעות ההתחלה והסיום (רק היום זז).
//  early_leave: הסיום הוא סוף יום הלימודים בתאריך בפועל, אם הוא אחרי שעת היציאה; אחרת (יציאה אחרי הסוף, יום בלי לימודים, בלי מערכת שעות) = שעת היציאה.
function eventRowFor({ state, sourceId, timetable }) {
  if (state.type === UNAVAILABLE_TYPE) return unavailableEventRow(state.all, sourceId); // בלוק 3ב-2: חלון "לא זמין"
  if (!isTimedType(state.type)) return null;
  const { date, time, timeCorrected } = effectiveWhen(state.all);
  if (!date || !time) return null;
  const base = { start_date: date, start_time: time, end_date: date, match_key: matchKeyOf(sourceId) };
  if (state.type === 'personal_event') {
    const topic = state.all.get('topic')?.value;
    const title = typeof topic === 'string' && topic.trim() !== '' && topic !== UNKNOWN_VALUE ? topic.trim() : PERSONAL_EVENT_FALLBACK_TITLE;
    const savedEnd = validTime(state.all.get('end_time')?.value);
    return { ...base, title, domain: 'personal', end_time: !timeCorrected && savedEnd ? savedEnd : plusOneHour(time), movable: null };
  }
  const dayEnd = schoolDayEnd(timetable, date);
  return { ...base, title: EARLY_LEAVE_TITLE, domain: 'school', end_time: dayEnd && dayEnd > time ? dayEnd : time, movable: false };
}

// "עודכן · אירוע אישי · בדיקה רפואית · שלישי 20.10" / "בוטל · יציאה מוקדמת · שני 19.10": המבנה של "נרשם", עם התאריך בפועל. null כשאין תאריך תקין.
function labelFor(state, verb) {
  const { date } = effectiveWhen(state.all);
  if (!date) return null;
  try {
    return formatReply({ type: state.type, subject: state.all.get('subject')?.value, title: state.all.get('topic')?.value, lesson: state.all.get('lesson')?.value, date, weekday: WEEKDAY_NAMES[weekdayOf(date)], verb });
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

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

// understand (אופציונלי, בלוק 3ב-1): async () => { ok: true, model, understanding } | { ok: false, reason } (lib/intake-brain.js understandSource).
// בלעדיו: בדיוק הנתיב של הקוד. איתו: התוצאה כוללת גם brain ('ok' או סיבת הכשל).
// googleDay (אופציונלי, בלוק 3ב-2): (dateIso) => { ok, events } לאירועי Google של יום ("אני פנוי?" והתנגשות ב"לא זמין"). בלעדיו: Google לא נבדק, והתשובה אומרת זאת.
export async function processSource({ sql, source, timetable, understand, googleDay, replyTo = null, matchDisabled = false } = {}) {
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
  // בלוק 8: בקשת "תביא לי" שחוזרת באותו יום נענית שוב; כפילות לא חלה עליה. בקשה שהקוד מזהה: מיד. בקשה שרק המוח יכול לזהות (נפתחת ב"תביא לי" אבל בלי מילת תמונה): הכפילות נדחית עד שהמוח קרא,
  // ואם הוא לא אמר bring_me (או שלא זמין) היא מטופלת ככפילות רגילה.
  const finishDuplicate = async () => {
    // השורה נשארת (המקור נשמר תמיד). הטיפול בה הסתיים, ולכן מסומנת; כשל בסימון לא משנה את התשובה.
    // הקיצור: אותה פקודה בדיוק כמו לפני שלב 8.2א-1 (בלי בועה: הקיצור כבר הציג "כבר קיבלתי", 47 "מה נכנס" סעיף 6). מוקלדת: גם בועת "כבר קיבלתי".
    try {
      if (typed) await markTypedDuplicate(sql, source.id);
      else await sql`UPDATE sources SET processed_at = now() WHERE id = ${source.id}::uuid AND processed_at IS NULL`;
    } catch (error) {
      console.error('intake: סימון כפילות נכשל:', error?.name);
    }
    return { status: 'duplicate', reply: DUPLICATE_REPLY };
  };
  let deferDuplicate = false;
  if (!(typed && detectBringMe(text)) && await hasEarlierSameDay(sql, source.id)) {
    if (typed && startsLikeBringRequest(text) && typeof understand === 'function') deferDuplicate = true;
    else return finishDuplicate();
  }

  // בלוק 5 חלק א': לוז 4fitness בפורמט הרגיל מטופל בקוד, לפני המוח (חוסך מכסה; 03-4fitness "מה נשאר ל-AI": המוח רק כשהתבנית נכשלת).
  // לוז עם ספק (uncertain) או חותמת לא תקינה: ממשיכים לצינור הרגיל, בלי שינוי.
  const fitness = await tryFitnessSchedule({ sql, source, text });
  if (fitness) return fitness;

  // בלוק 3ב-1: המוח מבין את ההודעה (understand מוזרק; בלעדיו, הנתיב הישן בדיוק). אחרי הכפילות, כדי לא לבזבז מכסה על "כבר קיבלתי".
  // בלוק 4: הקשר הזיהוי. המוח מקבל טוען מועמדים (loadCandidates) ומפעיל אותו רק אחרי שבדק שיש מפתח, כך שבלי מוח לא נוספת אף שאילתה;
  // בנתיב הקוד המועמדים נשלפים רק כשהסוג מתאים. shown = המוח ראה את הרשימה, ורק אז ה-match שלו נחשב.
  const match = matchDisabled ? null : { replyTo, pool: null, shown: false };
  // תתי-משימות: רק בהודעה מוקלדת (משימה נרשמת רק ממנה). shown = המוח ראה רשימה לא ריקה, ורק אז parent שלו נחשב.
  const parents = typed ? { pool: null, shown: false } : null;
  if (typeof understand !== 'function') return processByCode({ sql, source, timetable, typed, text, googleDay, match });
  const loadCandidates = async () => {
    match.pool ??= await loadEventPool(sql, source.received_at);
    match.shown = true;
    return brainCandidates(match.pool);
  };
  const loadTaskCandidates = async () => {
    parents.pool ??= await loadParentPool(sql);
    parents.shown = parents.pool.length > 0;
    return brainTaskCandidates(parents.pool);
  };
  const extra = match || parents ? { ...(match ? { loadCandidates } : {}), ...(parents ? { loadTaskCandidates } : {}) } : undefined;
  let brain;
  try {
    brain = await understand(extra);
  } catch (error) {
    console.error('intake: הבנה במוח נכשלה:', error?.name);
    brain = { ok: false, reason: 'failed' };
  }
  if (deferDuplicate && !(brain?.ok && brain.understanding?.kind === 'bring_me')) return finishDuplicate();
  if (brain?.ok) return { ...(await processByBrain({ sql, source, timetable, typed, text, brain, googleDay, match, parents })), brain: 'ok' };
  const reason = brain?.reason ?? 'failed';
  // נפילה: הנתיב של הקוד, בלי שינוי. הודעה מועברת שהקוד לא הבין נשמרת לטיפול חוזר כשהמכסה חוזרת (lib/intake-brain-retry.js).
  const result = await processByCode({ sql, source, timetable, typed, text, googleDay, match });
  if (!typed && result.status === 'unclassified' && RETRY_REASONS.includes(reason)) await markPending(sql, source.id);
  return { ...result, brain: reason };
}

// סימון "ממתין למוח" (בלוק 3ב-1): שורת probe_log, בלי טבלה חדשה ובלי שינוי סכמה. detail = מזהה המקור בלבד, בלי טקסט.
// ok=false = ממתין; ok=true (נכתב בטיפול החוזר) = המוח כבר ראה. פעם אחת לכל מקור (NOT EXISTS). כשל לא משנה את התשובה.
export const PENDING_PROBE = 'brain-pending';
export const pendingDetail = (sourceId) => `source=${sourceId}`;
async function markPending(sql, sourceId) {
  const detail = pendingDetail(sourceId);
  try {
    await sql`
      INSERT INTO probe_log (probe, ok, detail)
      SELECT 'brain-pending', false, ${detail}::text
      WHERE NOT EXISTS (SELECT 1 FROM probe_log p WHERE p.probe = 'brain-pending' AND p.ok = false AND p.detail = ${detail}::text)
    `;
  } catch (error) {
    console.error('intake: סימון ממתין למוח נכשל:', error?.name);
  }
}

// הסוג שהקוד היה בוחר (למדידת ההסכמה בלבד): task / question בערוץ app, הסוג מהמילון, או other. בלי כתיבה.
function codeKindOf({ source, table, typed, text }) {
  const availability = detectAvailability(text); // בלוק 3ב-2
  if (availability === 'free_check' || (typed && availability === UNAVAILABLE_TYPE)) return availability;
  if (typed && detectBringMe(text)) return 'bring_me'; // בלוק 8
  if (typed && channelRole({ channel: CHANNEL_APP, text }) === 'task') return 'task';
  if (typed && isRealQuestion(text)) return 'question';
  try {
    return extractFacts({ text, receivedAt: source.received_at, channel: source.channel, timetable: table }).type ?? 'other';
  } catch (error) {
    if (error instanceof RangeError) return 'other';
    throw error;
  }
}

// מדידת ההסכמה (בלוק 3ב-1, ה-2: כשיש מחלוקת המוח גובר, ושניהם נרשמים): probe_log 'brain-intake', ok = הסכימו. בלי טקסט ובלי שמות.
async function logAgreement(sql, { ai, code, channel, model }) {
  try {
    await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('brain-intake', ${ai === code}, ${`ai=${ai}; code=${code}; channel=${channel}; model=${model}`})`;
  } catch (error) {
    console.error('intake: רישום ההסכמה נכשל:', error?.name);
  }
}

// המסלול של המוח: הסוג של המוח, והחילוץ, ההשלמה, השאלות והכתיבה של הקוד (אותה פקודה אטומית כמו בנתיב הישן).
// brain.replay (בלוק 4): הבנה שנשמרה לשאלת זיהוי ומשמשת שוב אחרי "לא, חדש". לא נמדדת שוב (היא כבר נרשמה בפעם הראשונה).
async function processByBrain({ sql, source, timetable, typed, text, brain, googleDay, match = null, parents = null }) {
  const { understanding, model } = brain;
  const table = timetable === undefined ? await loadTimetable(sql) : timetable;
  if (!brain.replay) await logAgreement(sql, { ai: understanding.kind, code: codeKindOf({ source, table, typed, text }), channel: source.channel, model });
  // בלוק 3ב-2: "אני פנוי?" (ח-6) נענה בקוד מהביטויים שהמוח העתיק. "לא זמין" (ח-2) רק כשיובל הקליד; בהודעה מועברת זה של מישהו אחר = לא מסווג.
  if (understanding.kind === 'free_check') return answerAvailability({ sql, source, table, googleDay, dateText: understanding.date_text, timeText: understanding.time_text });
  // בלוק 8: "תביא לי" (אפיון-מורחב ה-16). המוח מעתיק מקצוע, נושא וביטוי תאריך; החיפוש והתאריכים בקוד. רק כשיובל הקליד: בהודעה מועברת זו בקשה של מישהו אחר.
  if (understanding.kind === 'bring_me') {
    if (!typed) return { ...UNCLASSIFIED };
    return answerBringMe({ sql, source, timetable: table, understanding });
  }
  if (understanding.kind === UNAVAILABLE_TYPE) {
    if (!typed) return { ...UNCLASSIFIED };
    return recordUnavailable({ sql, source, table, googleDay, extracted: extractUnavailable({ text, receivedAt: source.received_at, understanding }) });
  }
  // בלוק 4: משימה מוקלדת (ולא שאלה, הבדיקה בקוד) נרשמת. הכותרת והביטויים מהמוח, החישוב בקוד (readTask).
  if (understanding.kind === 'task' && typed && !isRealQuestion(text)) return recordTask({ sql, source, text, understanding, parents, timetable: table, googleDay });
  // שאלה, אחר, או משימה שאינה מוקלדת: כמו "לא מסווג" היום. מוקלדת מקבלת "התקבל" (בלי "מה זה?": המוח כבר קבע שזה אינו אחד הסוגים).
  if (!Object.hasOwn(ESSENTIAL_FIELDS, understanding.kind)) {
    if (typed) await writeReceipt(sql, source.id);
    return { ...UNCLASSIFIED };
  }
  let extracted;
  try {
    extracted = extractFacts({ text, receivedAt: source.received_at, channel: source.channel, timetable: table, forcedType: understanding.kind });
    extracted = mergeUnderstanding({ extracted, understanding, receivedAt: source.received_at, text });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    if (typed) await writeReceipt(sql, source.id);
    return { ...UNCLASSIFIED };
  }
  const matched = await tryEventMatch({ sql, source, text, extracted, understanding, match });
  if (matched.result) return matched.result;
  return recordExtracted({ sql, source, table, typed, extracted, link: matched.link });
}

// הנתיב של הקוד (עד בלוק 3ב-1 הנתיב היחיד), בלי שינוי: צעדים 3-6.
async function processByCode({ sql, source, timetable, typed, text, googleDay, match = null }) {
  // בלוק 8: "תביא לי את הלוח מהשיעור בהיסטוריה" (נפילה דטרמיניסטית כשהמוח לא זמין). קודם לכול: "תשלח" הוא פועל משימה, ובקשה עם סימן שאלה הייתה נתפסת כשאלה.
  if (typed && detectBringMe(text)) {
    const table = timetable === undefined ? await loadTimetable(sql) : timetable;
    return answerBringMe({ sql, source, timetable: table });
  }
  // בלוק 3ב-2 (נפילה דטרמיניסטית לניסוחים ברורים): "אני פנוי מחר ב-6?" (ח-6) ו"אני לא זמין ב-5" (ח-2, רק מוקלד). לפני צעדי השאלה והמשימה, שהיו בולעים אותם.
  const availability = detectAvailability(text);
  if (availability === 'free_check' || (typed && availability === UNAVAILABLE_TYPE)) {
    const table = timetable === undefined ? await loadTimetable(sql) : timetable;
    if (availability === 'free_check') return answerAvailability({ sql, source, table, googleDay });
    try {
      return await recordUnavailable({ sql, source, table, googleDay, extracted: extractUnavailable({ text, receivedAt: source.received_at }) });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      await writeReceipt(sql, source.id);
      return { ...UNCLASSIFIED };
    }
  }
  // צעדים 3-4 (מוקלדת בלבד, D9): שאלה אמיתית = "התקבל", בלי חילוץ ובלי שאלה (שליפה לא נבנתה). השאלה נבדקת לפני המשימה: "להתקשר לסבתא?" אינה משימה.
  // בלוק 4: משימה (פועל משימה ראשון) נרשמת ב-tasks (lib/personal-task.js), בלי חילוץ ובלי מערכת שעות.
  if (typed && isRealQuestion(text)) {
    await writeReceipt(sql, source.id);
    return { ...UNCLASSIFIED };
  }
  if (typed && channelRole({ channel: CHANNEL_APP, text }) === 'task') return recordTask({ sql, source, text, timetable, googleDay });

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
  const matched = await tryEventMatch({ sql, source, text, extracted, match });
  if (matched.result) return matched.result;
  return recordExtracted({ sql, source, table, typed, extracted, link: matched.link });
}

// ---------------------------------------------------------------------------
// בלוק 4: זיהוי שהודעה שייכת לאירוע קיים (lib/event-match.js)
// ---------------------------------------------------------------------------

// מחזיר { result } כשההודעה טופלה כאן (עדכון, כפילות, שאלה), או { link } (קישור למבחן מהלוח, או null) להמשך במסלול הקיים.
// understanding: מה שהמוח הבין (או null בנתיב הקוד); match.pool: המועמדים שנשלחו למוח (או null: נשלפים כאן).
async function tryEventMatch({ sql, source, text, extracted, understanding = null, match }) {
  const type = extracted?.type ?? null;
  if (!match || !MATCH_TYPES.includes(type)) return { link: null };
  let today;
  try {
    today = localDateIso(source.received_at);
  } catch (error) {
    if (error instanceof RangeError) return { link: null };
    throw error;
  }
  const facts = extracted.facts;
  const replyEvent = match.replyTo ? await loadReplyEvent(sql, match.replyTo) : null;
  const pool = match.pool ?? (await loadEventPool(sql, source.received_at));
  const change = readChange({ type, facts, text, receivedAt: source.received_at, understanding });
  const brain = understanding && match.shown && Object.hasOwn(understanding, 'match') ? { key: understanding.match, sure: understanding.match_sure === true } : null;
  const decision = decideMatch({ pool, replyEvent, text, type, change, today, brain });
  if (decision.kind !== 'none' || decision.considered > 0) await logMatch(sql, decision);

  const saved = [{ field: TYPE_FIELD, value: type, origin: 'read' }, ...facts];
  if (decision.kind === 'update' || decision.kind === 'duplicate') {
    const { candidate } = decision;
    const target = decision.kind === 'update' ? decision.target : null;
    const bubble = target ? updateReply(candidate, target) : duplicateReply(candidate);
    const written = await writeMatched({
      sql, sourceId: source.id, candidate, target, certainty: extracted.certainty,
      facts: [...saved, { field: MATCH_FACT, value: candidate.id, origin: 'inferred' }], bubble,
    });
    if (written.claimed === 0) return { result: { status: 'skipped', reply: RECEIVED_REPLY } };
    return { result: { status: 'recorded', reply: bubble, matched: target ? { sourceId: candidate.sourceId } : null } };
  }
  if (decision.kind === 'ask') {
    const question = questionFor(decision.options);
    const payload = pendingPayload({ options: decision.options, type, facts, certainty: extracted.certainty, understanding });
    await writeMatchQuestion({ sql, sourceId: source.id, payload, question });
    return { result: { status: 'recorded', reply: question.text } };
  }
  const exam = examLinkFor({ text, type, facts, today });
  return { link: exam ? examLinkExtras(exam, facts) : null };
}

// משימה אישית (בלוק 4): קריאת הכותרת והמועד (המוח, אם יש, והחישוב בקוד) ורישום בפקודה אחת. חותמת קליטה לא תקינה: "התקבל", כמו בשאר המסלולים.
// אחרי הרישום: תת-משימה (lib/subtask.js suggestParentAfterRecord, לא זורק). parents: המשימות שנשלחו למוח ({ pool, shown }) או null.
async function recordTask({ sql, source, text, understanding = null, parents = null, timetable, googleDay }) {
  let task;
  try {
    task = readTask({ text, receivedAt: source.received_at, understanding });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    await writeReceipt(sql, source.id);
    return { ...UNCLASSIFIED };
  }
  const result = await recordPersonalTask({ sql, source, task });
  if (result.status !== 'recorded') return result;
  const subtask = await suggestParentAfterRecord({ sql, source, task: result.task, understanding, parents });
  // בלוק 7 (lib/time-suggest.js): משימה עם תאריך ובלי שעה מקבלת מיד הצעת חלון. בלי תאריך: קודם "עד מתי?" (ההצעה אחרי התשובה). לא זורק.
  if (!result.task.timed && result.task.dueAt) await suggestTimeForTask({ sql, task: { ...result.task, title: task.title }, timetable, googleDay });
  return subtask ? { ...result, subtask } : result;
}

// "לא זמין" (בלוק 3ב-2, ח-2): בדיקת מה יש בשעה (lib/unavailable.js addConflict), ואחריה אותה שמירה אטומית כמו כל סוג.
async function recordUnavailable({ sql, source, table, googleDay, extracted }) {
  const facts = await addConflict({ sql, facts: extracted.facts, timetable: table, googleDay });
  return recordExtracted({ sql, source, table, typed: true, extracted: { ...extracted, facts } });
}

// "אני פנוי?" (בלוק 3ב-2, ח-6): התשובה מחושבת בקוד (lib/free-check.js) ונכתבת כבועה, יחד עם תפיסת המקור, בפקודה אחת. status 'recorded' (נענה), כדי שהודעה מועברת
// תקבל התראה כמו כל הודעה שהובנה. חותמת קליטה לא תקינה: "התקבל" (מוקלדת) או לא מסווג.
async function answerAvailability({ sql, source, table, googleDay, dateText = null, timeText = null }) {
  let answer;
  try {
    answer = await answerFreeCheck({ sql, text: source.raw_content, receivedAt: source.received_at, timetable: table, googleDay, dateText, timeText });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    if (source.channel === CHANNEL_APP) await writeReceipt(sql, source.id);
    return { ...UNCLASSIFIED };
  }
  const written = rowsOf(await sql`
    WITH claim AS (
      UPDATE sources SET processed_at = now()
      WHERE id = ${source.id}::uuid AND processed_at IS NULL
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${answer}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', claim.id, NULL::integer
      FROM claim
      WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source' AND x.entity_id = claim.id)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM claim)::int AS claimed, (SELECT count(*) FROM b)::int AS bubbles_written
  `);
  if (written.length > 0 && Number(written[0].claimed) === 0) return { status: 'skipped', reply: RECEIVED_REPLY };
  return { status: 'recorded', reply: answer };
}

// שמירת מה שהובן (משותף לנתיב הקוד ולנתיב המוח): עובדות, שאלה אחת, בועה ושורת אירוע, בפקודה אטומית אחת.
// link (בלוק 4, אופציונלי): { facts, suffix } של קישור למבחן מהלוח. העובדות נוספות לשמירה, והסיומת לבועת "נרשם" (" · מבחן מרביעי 25.11").
async function recordExtracted({ sql, source, table, typed, extracted: read, link = null }) {
  // בלוק 6 חלק ב' (lib/correction-rules.js): כלל שיובל אישר בכרטיס מחליף שעה שנקראה, בקוד דטרמיניסטי, לפני ובלי AI. רק בהודעה שיובל הקליד ורק בסוג עם שעה.
  let extracted = read;
  if (typed && isTimedType(read.type)) {
    const rules = await loadApprovedCorrectionRules(sql);
    if (rules.length > 0) extracted = { ...read, facts: applyCorrectionRules({ rules, text: source.raw_content, facts: read.facts, type: read.type }) };
  }
  const saved = [{ field: TYPE_FIELD, value: extracted.type, origin: 'read' }, ...extracted.facts, ...(link?.facts ?? [])];
  const state = resolveState({ source, saved, timetable: table, extracted });
  const question = state.next; // שאלה אחת בלבד; הבאה נוצרת אחרי שנענתה (answerQuestion)
  const baseReply = replyFor(state);
  const reply = link?.suffix && baseReply !== RECEIVED_REPLY ? `${baseReply} · ${link.suffix}` : baseReply;
  // הבועה (ה2): "נרשם" כשהובנה עכשיו (הרגע הראשון). מוקלדת שלא הובנה ואין עליה שאלה: "התקבל". אחרת (שאלה נפתחה, או קיצור שלא הובן): בלי בועה.
  let bubble = null;
  if (state.understood && reply !== RECEIVED_REPLY) bubble = reply;
  else if (typed && !question) bubble = RECEIVED_REPLY;
  // שלב 8.3-3: שורת האירוע (או '[]' כשאין: סוג אחר, או בלי תאריך ושעה תקינים).
  const event = eventRowFor({ state, sourceId: source.id, timetable: table });
  const eventJson = JSON.stringify(event ? [event] : []);

  // פקודה אחת אטומית: תפיסת המקור (processed_at) + כל העובדות + השאלה הראשונה + הבועה + שורת האירוע. אם המקור כבר טופל, התפיסה לא מחזירה שורה ואין הכנסות.
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
    ), e AS (
      INSERT INTO events (title, starts_at, ends_at, location, description, domain, movable, status, external_id, commitment_id, match_key)
      SELECT ev.title, ((ev.start_date || ' ' || ev.start_time)::timestamp AT TIME ZONE 'Asia/Jerusalem'), ((ev.end_date || ' ' || ev.end_time)::timestamp AT TIME ZONE 'Asia/Jerusalem'),
        NULL::text, NULL::text, ev.domain, ev.movable, 'planned', NULL::text, NULL::uuid, ev.match_key
      FROM claim, jsonb_to_recordset(${eventJson}::jsonb) AS ev(title text, domain text, start_date text, start_time text, end_date text, end_time text, movable boolean, match_key text)
      WHERE NOT EXISTS (SELECT 1 FROM events x WHERE x.match_key = ev.match_key)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM claim)::int AS claimed, (SELECT count(*) FROM f)::int AS facts_written, (SELECT count(*) FROM m)::int AS questions_written,
      (SELECT count(*) FROM b)::int AS bubbles_written, (SELECT count(*) FROM e)::int AS events_written
  `);
  // claimed = 0: מישהו אחר כבר תפס את המקור (ניסיון חוזר, מירוץ), ולא נכתב כלום (ביקורת 12.10, סעיף 13). בלי שורות בתוצאה (למשל sql מזויף): כמו קודם.
  if (written.length > 0 && Number(written[0].claimed) === 0) return { status: 'skipped', reply: RECEIVED_REPLY };
  return { status: 'recorded', reply };
}

// ---------------------------------------------------------------------------
// בלוק 5 חלק א': לוז 4fitness (lib/fitness-schedule.js; המפרט: docs/02-rules/03-4fitness-rules.md)
// ---------------------------------------------------------------------------
// לכל יום בלוז: אימון "אימון ריצה - <מיקום>" ואירוע "התארגנות" לפניו, בתחום running (movable false, status planned).
// טבלת "שינוי מול אירוע שכבר קיים": אין -> יצירה · זהה -> לא נוגעים · שונה -> עדכון השורה הקיימת + שורות changes · "מנוחה" + קיים -> status 'cancelled'
// (השורה נשארת, וההיסטוריה ב-changes) · "מנוחה" בלי קיים -> כלום. הרמות: 1א / 2 / 3 / 4 אוטונומיים (03-permissions-rules.md, כפי שמצוטט ב-03-4fitness).
// ביטול = מנגנון 1: ההודעה המיידית היא חלק מהפעולה. לכן בועת התשובה (עם "בוטל האימון של רביעי 25.11.") נכתבת באותה פקודה אטומית של הביטול:
// אם הבועה לא נכתבת, גם הביטול לא. בקיצור התשובה מוצגת בקיצור עצמו, וההתראה המאוגדת יוצאת כמו לכל הודעה שנרשמה (api/intake.js, בלי ערוץ חדש).
// "זהה" = כותרת, התחלה, סוף, מיקום ותיאור שווים. [הנחה, לא אומת] הטבלה אומרת "פרטים זהים" / "שעה או מיקום שונים"; שינוי בתיאור בלבד (למשל "כוח" נוסף) נחשב עדכון.
// מפתח: 'source:<מקור>:fitness:<YYYY-MM-DD>:<run|prep>'. מתחיל ב-'source:', ולכן הסריקה היומית (lib/event-sync.js) וזיהוי האירוע (lib/event-match.js) רואים אותו.
// הקיים נשלף לפני הכתיבה, בפקודה נפרדת. [הנחה, לא אומת] כמו בשאר הצינור: מוגן מהרצה חוזרת (התפיסה), לא משתי הודעות לוז באותו רגע בדיוק.
// כמה אימוני ריצה מתוכננים באותו יום: הראשון לפי שעה הוא "הקיים"; השאר לא נוגעים. [הנחה, לא אומת]
export const FITNESS_TYPE = 'fitness_schedule';
const fitnessKey = (sourceId, date, kind) => `source:${sourceId}:fitness:${date}:${kind}`;
const stampOf = ({ date, time }) => `${date} ${time}`;
const textOrNull = (value) => (typeof value === 'string' && value !== '' ? value : null);
const dayDate = (iso) => `${WEEKDAY_NAMES[weekdayOf(iso)]} ${formatDayMonth(iso)}`;

// האימונים וההתארגנויות המתוכננים בתאריכים של הלוז (שעון ישראל). הכותרות בשאילתה = FITNESS_TITLE_PREFIX ו-PREP_TITLE.
async function loadFitnessExisting(sql, dates) {
  return rowsOf(await sql`
    SELECT id, title, location, description, match_key,
      to_char(starts_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS start_date, to_char(starts_at AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI') AS start_time,
      to_char(ends_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS end_date, to_char(ends_at AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI') AS end_time
    FROM events /* fitness-existing */
    WHERE domain = 'running' AND status = 'planned' AND match_key LIKE 'source:%' AND starts_at IS NOT NULL AND ends_at IS NOT NULL
      AND (title LIKE 'אימון ריצה%' OR title = 'התארגנות')
      AND to_char(starts_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') IN (SELECT jsonb_array_elements_text(${JSON.stringify(dates)}::jsonb))
    ORDER BY starts_at ASC
  `);
}

// ההבדלים בין שורה קיימת לאירוע מהלוז: [{ field, old_value, new_value }] (השמות כמו העמודות ב-events). null ו-'' נחשבים שווים.
function fitnessDiff(row, spec) {
  const pairs = [
    ['title', textOrNull(row.title), spec.title],
    ['starts_at', `${row.start_date} ${row.start_time}`, stampOf(spec.start)],
    ['ends_at', `${row.end_date} ${row.end_time}`, stampOf(spec.end)],
    ['location', textOrNull(row.location), textOrNull(spec.location)],
    ['description', textOrNull(row.description), textOrNull(spec.description)],
  ];
  return pairs.filter(([, before, after]) => before !== after).map(([field, before, after]) => ({ field, old_value: before, new_value: after }));
}

// התוכנית מול הקיים -> מה לכתוב, מה לסנכרן, והתשובה. טהורה.
function fitnessWork({ sourceId, plan, existing }) {
  const work = { creates: [], updates: [], cancels: [], changes: [], keys: [], patchKeys: [] };
  const parts = [];
  const cancelledDates = [];
  const fields = (spec) => ({
    title: spec.title, start_date: spec.start.date, start_time: spec.start.time, end_date: spec.end.date, end_time: spec.end.time,
    location: spec.location ?? null, description: spec.description ?? null,
  });
  const apply = (row, spec, date, kind) => {
    if (!row) {
      const key = fitnessKey(sourceId, date, kind);
      work.creates.push({ ...fields(spec), match_key: key });
      work.keys.push(key);
      return 'create';
    }
    const diff = fitnessDiff(row, spec);
    if (diff.length === 0) return 'same';
    work.updates.push({ id: row.id, ...fields(spec) });
    for (const change of diff) work.changes.push({ entity_id: row.id, ...change });
    work.keys.push(row.match_key);
    work.patchKeys.push(row.match_key);
    return 'update';
  };
  for (const day of plan) {
    const onDay = existing.filter((row) => row.start_date === day.date);
    const run = onDay.find((row) => typeof row.title === 'string' && row.title.startsWith(FITNESS_TITLE_PREFIX)) ?? null;
    const prep = onDay.find((row) => row.title === PREP_TITLE) ?? null;
    if (day.rest) {
      for (const row of [run, prep].filter(Boolean)) {
        work.cancels.push({ id: row.id });
        work.changes.push({ entity_id: row.id, field: 'status', old_value: 'planned', new_value: 'cancelled' });
        work.keys.push(row.match_key);
      }
      if (run) cancelledDates.push(day.date);
      parts.push(run ? `${dayDate(day.date)} מנוחה` : `${dayDate(day.date)} מנוחה (אין אימון לבטל)`); // "מנוחה" בלי אימון קיים: לא עושים כלום, ואומרים זאת
      continue;
    }
    const action = apply(run, day.run, day.date, 'run');
    apply(prep, day.prep, day.date, 'prep');
    const place = day.needsAddress ? [day.label, '(לוודא כתובת)'].filter(Boolean).join(' ') : day.label;
    const suffix = action === 'update' ? ' · עודכן' : action === 'same' ? ' · כבר רשום' : '';
    parts.push(`${dayDate(day.date)} ${day.run.start.time}–${day.run.end.time}${place ? ` ${place}` : ''}${suffix}`);
  }
  // התשובה (בקיצור ובבועה): תאריך מלא לכל יום, ושורת ביטול נפרדת לכל אימון שבוטל (03-4fitness, "ביטול שמגיע מהמאמן": "בוטל האימון של רביעי 7.10.").
  const reply = [`נרשמו האימונים: ${parts.join(' · ')}`, ...cancelledDates.map((date) => `בוטל האימון של ${dayDate(date)}.`)].join('\n');
  return { ...work, reply };
}

// null = לא לוז, או לוז עם ספק, או חותמת לא תקינה: הצינור הרגיל ממשיך. אחרת { status, reply, fitness: { keys, patchKeys } } (api/intake.js כותב ליומן לפי המפתחות).
async function tryFitnessSchedule({ sql, source, text }) {
  const parsed = parseFitnessSchedule(text);
  if (!parsed || parsed.uncertain.length > 0) return null;
  let plan;
  try {
    plan = planFitnessWeek(parsed, source.received_at);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
  const existing = await loadFitnessExisting(sql, [...new Set(plan.map((day) => day.date))]);
  const work = fitnessWork({ sourceId: source.id, plan, existing });

  // פקודה אחת אטומית: תפיסת המקור + עובדת type + יצירה (NOT EXISTS על match_key) + עדכון + ביטול (בלי מחיקה) + changes (רק לשורות שעודכנו או בוטלו בפועל) + הבועה.
  const written = rowsOf(await sql`
    /* fitness-write */ WITH claim AS (
      UPDATE sources SET processed_at = now()
      WHERE id = ${source.id}::uuid AND processed_at IS NULL
      RETURNING id
    ), f AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin, haiku_confidence)
      SELECT claim.id, 'type', ${FITNESS_TYPE}::text, 'certain', 'script', NULL::text, NULL::uuid, 'read', NULL::text
      FROM claim
      RETURNING id
    ), ins AS (
      INSERT INTO events (title, starts_at, ends_at, location, description, domain, movable, status, external_id, commitment_id, match_key)
      SELECT ev.title, ((ev.start_date || ' ' || ev.start_time)::timestamp AT TIME ZONE 'Asia/Jerusalem'), ((ev.end_date || ' ' || ev.end_time)::timestamp AT TIME ZONE 'Asia/Jerusalem'),
        ev.location, ev.description, 'running', false, 'planned', NULL::text, NULL::uuid, ev.match_key
      FROM claim, jsonb_to_recordset(${JSON.stringify(work.creates)}::jsonb) AS ev(title text, start_date text, start_time text, end_date text, end_time text, location text, description text, match_key text)
      WHERE NOT EXISTS (SELECT 1 FROM events x WHERE x.match_key = ev.match_key)
      RETURNING id
    ), upd AS (
      UPDATE events SET title = u.title,
        starts_at = ((u.start_date || ' ' || u.start_time)::timestamp AT TIME ZONE 'Asia/Jerusalem'),
        ends_at = ((u.end_date || ' ' || u.end_time)::timestamp AT TIME ZONE 'Asia/Jerusalem'),
        location = u.location, description = u.description
      FROM claim, jsonb_to_recordset(${JSON.stringify(work.updates)}::jsonb) AS u(id text, title text, start_date text, start_time text, end_date text, end_time text, location text, description text)
      WHERE events.id = u.id::uuid AND events.status = 'planned'
      RETURNING events.id
    ), can AS (
      UPDATE events SET status = 'cancelled'
      FROM claim, jsonb_to_recordset(${JSON.stringify(work.cancels)}::jsonb) AS c(id text)
      WHERE events.id = c.id::uuid AND events.status = 'planned'
      RETURNING events.id
    ), ch AS (
      INSERT INTO changes (entity_type, entity_id, field, old_value, new_value, source_id, changed_at, changed_by)
      SELECT 'event', x.entity_id::uuid, x.field, x.old_value, x.new_value, claim.id, now(), 'system'
      FROM claim, jsonb_to_recordset(${JSON.stringify(work.changes)}::jsonb) AS x(entity_id text, field text, old_value text, new_value text)
      WHERE x.entity_id::uuid IN (SELECT id FROM upd UNION SELECT id FROM can)
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${work.reply}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', claim.id, NULL::integer
      FROM claim
      WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source' AND x.entity_id = claim.id)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM claim)::int AS claimed, (SELECT count(*) FROM ins)::int AS created, (SELECT count(*) FROM upd)::int AS updated,
      (SELECT count(*) FROM can)::int AS cancelled, (SELECT count(*) FROM ch)::int AS changes_written, (SELECT count(*) FROM b)::int AS bubbles_written
  `);
  if (written.length > 0 && Number(written[0].claimed) === 0) return { status: 'skipped', reply: RECEIVED_REPLY };
  return { status: 'recorded', reply: work.reply, fitness: { keys: work.keys, patchKeys: work.patchKeys } };
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
// googleDay (אופציונלי, בלוק 3ב-2): כמו ב-processSource, לבדיקת התנגשות כשתשובה ב"לא זמין" השלימה תאריך או שעה.
export async function answerQuestion({ sql, messageId, answer, timetable, now = new Date(), recordCandidateRules = RECORD_CANDIDATE_RULES, googleDay } = {}) {
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
  let parsedValue = null; // הערך שנשמר לשדה שנשאל (לסבב התיקון)
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
    const unavailable = before.type === UNAVAILABLE_TYPE; // בלוק 3ב-2: שאלות "לא זמין" מפוענחות ב-lib/unavailable.js
    const applied = unavailable
      ? applyUnavailableAnswer({ facts: [...before.all.values()], field, answer, now, candidates: before.ambiguous.get(field), all: before.all })
      : applyAnswer({ facts: [...before.all.values()], field, answer, receivedAt: now, candidates: before.ambiguous.get(field) });
    const parsed = applied.find((fact) => fact.field === field);
    // תשובה שאי אפשר לפענח (תאריך לא תקין, שיעור בלי מספר, ריקה): לא כותבים כלום, והשאלה נשארת פתוחה.
    if (!parsed) return { done: false, reply: before.next.text, status: 'unclear', created: { ...NOTHING_CREATED } };
    parsedValue = parsed.value;
    let added = [parsed];
    if (unavailable && (field === 'date' || field === 'time')) {
      // התשובה השלימה תאריך או שעה: בודקים עכשיו מה יש בשעה הזו (ח-2).
      const conflict = (await addConflict({ sql, facts: [...before.all.values(), parsed], timetable: table, googleDay })).find((fact) => fact.field === 'conflict');
      if (conflict && !before.all.has('conflict')) added = [parsed, conflict];
    }
    after = resolveState({ source, saved: [...saved, ...added], timetable: table, extracted: before.extracted });
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

  // שלב 8.3-3: שורת האירוע וסבב התיקון.
  //  - ההכנסה (NOT EXISTS על match_key) רצה בכל תשובה שאחריה יש תאריך ושעה בפועל, חוץ מ"לא קורה": כך מקור שהשלים עכשיו תאריך ושעה מקבל אירוע,
  //    ומקור שכבר יש לו אירוע לא מקבל שני. היא נושאת את הערכים בפועל (אחרי תיקון), כי ה-UPDATE שבאותה פקודה לא רואה שורה שהוכנסה בה.
  //  - אחרי תשובה תקינה ל-fix_time / fix_date: UPDATE לשורה הקיימת + בועת "עודכן". אחרי "לא קורה": UPDATE status='cancelled' + בועת "בוטל".
  const correction = isTimedType(after.type) && after.all.get(CONFIRM_FIELD)?.value === 'no' ? after.all.get(FIX_FIELD)?.value : undefined;
  const cancelledNow = field === FIX_FIELD && correction === 'cancel';
  const event = correction === 'cancel' ? null : eventRowFor({ state: after, sourceId: source.id, timetable: table });
  const fixedNow = (field === FIX_TIME_FIELD || field === FIX_DATE_FIELD) && parsedValue !== null && parsedValue !== UNKNOWN_VALUE && event !== null;
  const eventInsertJson = JSON.stringify(event ? [event] : []);
  const eventUpdateJson = JSON.stringify(fixedNow ? [event] : []);
  const eventCancelJson = JSON.stringify(cancelledNow ? [{ match_key: matchKeyOf(source.id) }] : []);
  let fixBubble = null;
  if (fixedNow) fixBubble = labelFor(after, 'עודכן');
  else if (cancelledNow) fixBubble = labelFor(after, 'בוטל');

  // פקודה אחת אטומית: סגירת השאלה (compare-and-set על awaiting_reply, read_at, ומזהה חדש לשורת התשובה) + שורת התשובה ב-sources + עובדות חדשות
  // + סימון המקור כמטופל (רק אחרי בחירת סוג) + השאלה הבאה + בועה + דפוס + שורת האירוע ותיקונה (8.3-3). אם השאלה כבר נסגרה, אין הכנסות ואין עדכונים.
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
    ), ev_ins AS (
      INSERT INTO events (title, starts_at, ends_at, location, description, domain, movable, status, external_id, commitment_id, match_key)
      SELECT ev.title, ((ev.start_date || ' ' || ev.start_time)::timestamp AT TIME ZONE 'Asia/Jerusalem'), ((ev.end_date || ' ' || ev.end_time)::timestamp AT TIME ZONE 'Asia/Jerusalem'),
        NULL::text, NULL::text, ev.domain, ev.movable, 'planned', NULL::text, NULL::uuid, ev.match_key
      FROM closed, jsonb_to_recordset(${eventInsertJson}::jsonb) AS ev(title text, domain text, start_date text, start_time text, end_date text, end_time text, movable boolean, match_key text)
      WHERE NOT EXISTS (SELECT 1 FROM events x WHERE x.match_key = ev.match_key)
      RETURNING id
    ), ev_upd AS (
      UPDATE events SET starts_at = ((u.start_date || ' ' || u.start_time)::timestamp AT TIME ZONE 'Asia/Jerusalem'),
        ends_at = ((u.end_date || ' ' || u.end_time)::timestamp AT TIME ZONE 'Asia/Jerusalem')
      FROM jsonb_to_recordset(${eventUpdateJson}::jsonb) AS u(start_date text, start_time text, end_date text, end_time text, match_key text)
      WHERE events.match_key = u.match_key AND EXISTS (SELECT 1 FROM closed)
      RETURNING events.id
    ), ev_cancel AS (
      UPDATE events SET status = 'cancelled'
      FROM jsonb_to_recordset(${eventCancelJson}::jsonb) AS c(match_key text)
      WHERE events.match_key = c.match_key AND EXISTS (SELECT 1 FROM closed)
      RETURNING events.id
    ), fb AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${fixBubble}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', ${source.id}::uuid, NULL::integer
      FROM closed
      WHERE ${fixBubble}::text IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source' AND x.entity_id = ${source.id}::uuid AND x.body = ${fixBubble}::text)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id, coalesce((SELECT id FROM b), (SELECT id FROM fb)) AS bubble_id, (SELECT id FROM m) AS question_id
  `);
  const [result] = written;
  if (Number(result?.closed) === 0) return closed; // מישהו אחר (לחיצה כפולה) כבר ענה: לא נכתב כלום

  const created = { answerSourceId: result?.answer_source_id ?? null, bubbleId: result?.bubble_id ?? null, questionId: result?.question_id ?? null };
  // בלוק 6 חלק ב' (lib/correction-rules.js): תיקון שעה שחוזר מוצע ככלל. אחרי שהתשובה נכתבה, בפקודה נפרדת; כשל לא מפיל את התשובה (בלי טקסט ובלי שגיאה מלאה בלוג, פרטיות).
  if (field === FIX_TIME_FIELD && parsedValue !== null) {
    try {
      await recordCorrection({ sql, source, field, value: parsedValue, readTime: saved.find((row) => row.field === 'time')?.value ?? null });
    } catch (error) {
      console.error('correction-rules: רישום התיקון נכשל:', error?.name);
    }
  }
  // גם כשאין שדה פתוח השאלה נסגרה עכשיו עם התשובה (נכתבו שורת תשובה וסגירה), ולכן 'answered' ולא 'closed' (47 קריטריון 6: closed לא כותב כלום).
  return { done, reply: done ? (fixBubble ?? replyFor(after)) : nextQuestion.text, status: 'answered', created };
}
