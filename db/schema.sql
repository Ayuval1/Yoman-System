-- סכמת מסד הנתונים, שלב 1 (Neon / Postgres).
-- מקורות: docs/01-foundation/06-db-schema.md (sources) · docs/05-chapter7/17-step1-cloud-handoff.md סעיף 6 · docs/06-handoff-notes/20-handoff-note-2026-10-05-close.md (טבלת השדות המוצעת).
-- כללים: מזהים uuid · כל הזמנים timestamptz · אין מחיקה פיזית (יש סטטוס) · מה שלא ידוע נשאר NULL.
-- הקובץ אידמפוטנטי: אפשר להריץ אותו כמה פעמים. הוא רק יוצר מה שחסר, ולא משנה טבלה קיימת.
-- שלב 1 כלל רק את sources; 13 הטבלאות של 06 נוספו בשלב 8.1 (בסוף הקובץ).

-- ---------------------------------------------------------------------------
-- sources — ההודעה הגולמית כפי שהתקבלה. נוסח מחייב: docs/01-foundation/06-db-schema.md שורות 13-26.
-- media_url ירד (הוחלף בטבלת media, שאינה בשלב 1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ערכים לפי 06: app · shortcut · calendar · system · file. בלי CHECK, כדי לא לנעול רשימה.
  -- הנחה, לא אומת: NOT NULL על channel (06 לא קובע; הקוד תמיד יודע את הערוץ)
  channel       text        NOT NULL,
  sender        text,                       -- כפי שהערוץ מדווח; NULL כשלא ידוע
  raw_content   text,                       -- הטקסט המקורי, בלי עיבוד
  content_hash  text,                       -- הנחה, לא אומת: sha256 (hex) של הטקסט בלבד. 06 לא מגדיר אלגוריתם ולא מה נכנס לחישוב
  -- הנחה, לא אומת: NOT NULL על received_at (06 לא קובע; הוא תמיד ידוע ברגע הקליטה)
  received_at   timestamptz NOT NULL,       -- בהודעה מהקיצור: רגע ההעברה, לא רגע השליחה המקורי (06)
  processed_at  timestamptz                 -- ריק עד שהטיפול הסתיים
);

-- ---------------------------------------------------------------------------
-- alarms — שעונים. הדרישות: docs/17 סעיף 6 ("claim אטומי ומצבים, מפתח ייחודי לכל שעון"), build-rules 26, 30.
-- כל השדות והערכים כאן: הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alarms (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text        NOT NULL,                       -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית (אילו סוגים קיימים - לא מוגדר)
  payload      jsonb,                                      -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית
  fire_at      timestamptz NOT NULL,                       -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית
  timezone     text        NOT NULL DEFAULT 'Asia/Jerusalem', -- כלל חוזר נושא אזור זמן (docs/17:58). "מחר" אינו "+24 שעות"
  all_day      boolean     NOT NULL DEFAULT false,         -- דגל all_day נדרש (docs/17:58)
  -- הנחה, לא אומת: ערכי status: pending / claimed / done / failed / cancelled (הצעה מ-docs/20:21, לא אושרה סופית). בלי CHECK.
  status       text        NOT NULL DEFAULT 'pending',
  claimed_by   text,                                       -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית
  claimed_at   timestamptz,                                -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית
  lease_until  timestamptz,                                -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית
  attempts     integer     NOT NULL DEFAULT 0,             -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית
  last_error   text,                                       -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית
  dedupe_key   text        NOT NULL UNIQUE,                -- מפתח ייחודי לכל שעון (docs/17:54)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- הנחה, לא אומת: האינדקס הוא רעיון שלי לשליפת "מה הגיע זמנו"; לא מוגדר באף מסמך
CREATE INDEX IF NOT EXISTS alarms_status_fire_at_idx ON alarms (status, fire_at);

-- ה-CLAIM האטומי (build-rules 26: שעון לא ירוץ פעמיים). לא רץ בשלב 1; מתועד כאן כדי שיהיה מוכן לשלב שיפעיל שעונים.
-- ההצעה (הנחה, לא אומת: ההצעה שלי, לא אושרה סופית):
--   * משתמשים ב-FOR UPDATE SKIP LOCKED בתוך UPDATE אחד, כך ששתי ריצות מקבילות לעולם לא תופסות אותו שעון.
--   * lease: 5 דקות (הנחה, לא אומת: המשך lease לא הוגדר באף מסמך).
--   * שעון "claimed" שה-lease שלו פג חוזר להיתפס (הנחה, לא אומת: מדיניות התאוששות לא הוגדרה).
--   $1 = מזהה הריצה (claimed_by), $2 = כמה שעונים לכל היותר.
--
-- UPDATE alarms
--    SET status      = 'claimed',
--        claimed_by  = $1,
--        claimed_at  = now(),
--        lease_until = now() + interval '5 minutes',
--        attempts    = attempts + 1,
--        updated_at  = now()
--  WHERE id IN (
--          SELECT id
--            FROM alarms
--           WHERE (status = 'pending' AND fire_at <= now())
--              OR (status = 'claimed' AND lease_until < now())
--           ORDER BY fire_at
--           LIMIT $2
--             FOR UPDATE SKIP LOCKED
--        )
-- RETURNING *;

-- ---------------------------------------------------------------------------
-- push_subscriptions — מנויי דחיפה. דרישות: docs/17:55-56, build-rules 27-28.
-- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית (כל השדות). אין מחיקה פיזית: מנוי שקיבל 410 מסומן בסטטוס.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint            text        NOT NULL UNIQUE,
  p256dh              text        NOT NULL,   -- מפתחות המנוי. הנחה, לא אומת: שמות העמודות (p256dh, auth) לפי שמות המפתחות במנוי Web Push; לא מוגדרים ב-docs/20
  auth                text        NOT NULL,
  status              text        NOT NULL DEFAULT 'active',  -- הנחה, לא אומת: ערכים active / gone_410
  last_sent_at        timestamptz,
  last_status         integer,                -- קוד ה-HTTP האחרון (429 חל על בקשות רצופות לאותו מכשיר, docs/17:55)
  retry_after         timestamptz,            -- הנחה, לא אומת: כשעון ולא כמספר שניות
  -- הנחה, לא אומת: העמודה הזו היא הצעה שלי, לא ב-docs/20; נועדה לתמוך ב"JWT של VAPID מתחדש פעם בשעה לכל היותר" (docs/17:55)
  vapid_jwt_issued_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- dedupe בשליחה (build-rules 28, step_retrying): לא הוגדרה עמודה. הכלל מדבר על שליחה ולא על מנוי,
-- ולכן לא הוספתי עמודה כאן; ההכרעה לשלב 4.

-- ---------------------------------------------------------------------------
-- watch_channels — ערוץ watch של Google Calendar. אחד לכל יומן.
-- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית (כל השדות). הערוץ עצמו מתחיל בשלב 5.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watch_channels (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id      text        NOT NULL UNIQUE,   -- UNIQUE = ערוץ אחד לכל יומן
  channel_id       text,
  resource_id      text,
  sync_token       text,
  expires_at       timestamptz,
  status           text        NOT NULL DEFAULT 'active', -- הנחה, לא אומת: ערכי הסטטוס לא הוגדרו
  last_notified_at timestamptz
);

-- ---------------------------------------------------------------------------
-- call_log — יומן קריאות. docs/17:57: "גם שגיאות 429 וסוג הקריאה". Vercel שומר לוגים שעה בלבד (docs/17:71).
-- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית (כל השדות).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text        NOT NULL,       -- סוג הקריאה
  status_code integer,                    -- כולל 429
  ok          boolean     NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  duration_ms integer,
  error       text
);

-- ---------------------------------------------------------------------------
-- probe_log — תוצאות בדיקות (probes) שנשמרות במסד כי הלוגים של Vercel ב-Hobby נשמרים שעה בלבד.
-- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית (כל השדות).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS probe_log (
  id     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  probe  text        NOT NULL,
  ok     boolean     NOT NULL,
  detail text,
  at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- push_sends — dedupe בשליחת דחיפה (build-rules 28, step_retrying): אותו dedupe_key לאותו מנוי לא נשלח פעמיים.
-- הנחה, לא אומת: הצעה לשלב 4, לא אושרה. בכוונה בלי delivered_at / ack_at: הם תלויים בהכרעת ack / שירות-עובד (ממצא 2 ב-docs/14), נדחה.
-- מיושם ב-Neon ידנית על ידי יובל (Vercel <- Storage <- Query), לא אוטומטית.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_sends (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid        REFERENCES push_subscriptions(id),
  dedupe_key      text,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  status_code     integer,
  UNIQUE (subscription_id, dedupe_key)
);

-- ---------------------------------------------------------------------------
-- google_oauth_states — state חד-פעמי לתהליך ההסכמה ל-Google (שלב 5א). תפוגה 10 דקות; ניצול אטומי ב-UPDATE אחד
-- (lib/google.js, consumeState). אין מחיקה פיזית: שורה שנוצלה או פגה נשארת כיומן.
-- הנחה, לא אומת: שמות העמודות והטבלה הם הצעה שלי (המשימה קבעה את השדות). מיושם ב-Neon ידנית על ידי יובל.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS google_oauth_states (
  state      text        PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz               -- NULL = לא נוצל
);

-- ---------------------------------------------------------------------------
-- google_credentials — החיבור ל-Google. שורה אחת לחשבון (שימוש אישי יחיד: account = 'primary').
-- refresh_token_enc: AES-256-GCM, פורמט "v1.<iv>.<tag>.<ciphertext>"; המפתח רק במשתנה הסביבה TOKEN_ENC_KEY, לעולם לא במסד.
-- access token לא נשמר. last_error: קוד קצר בלבד (למשל invalid_grant (400)), בלי ערכים.
-- הנחה, לא אומת: העמודה account נוספה על ידי כדי לאכוף "שורה אחת לחשבון" (המשימה לא פירטה מפתח); שאר השדות לפי המשימה.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS google_credentials (
  account           text        PRIMARY KEY DEFAULT 'primary',
  refresh_token_enc text        NOT NULL,
  scopes_granted    text,                       -- הסקופים שניתנו בפועל, מופרדים ברווח
  obtained_at       timestamptz NOT NULL DEFAULT now(),
  last_refresh_at   timestamptz,                -- רענון access token מוצלח אחרון
  last_error        text
);

-- ---------------------------------------------------------------------------
-- google_watch_channels — ערוצי watch של Google Calendar (שלב 5ב). ערוץ אחד לכל יומן בכל רגע, אבל נשמרת היסטוריה:
-- ערוץ שנעצר/פג נשאר כשורה (stopped_at), ויומן יכול לקבל ערוץ חדש. אין מחיקה פיזית.
-- הטבלה הישנה watch_channels (ערוץ אחד לכל יומן, UNIQUE על calendar_id) לא בשימוש ולא שונתה.
-- ה-webhook מאמת לפי channel_id (+ HMAC ב-lib/google.js) ולא קורא אירועים ולא פונה ל-Google.
-- הנחה, לא אומת: שמות העמודות והטבלה הם הצעה שלי. מיושם ב-Neon ידנית על ידי יובל.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS google_watch_channels (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id          text        NOT NULL,
  channel_id           text        NOT NULL UNIQUE,
  resource_id          text,
  expiration           timestamptz,               -- NULL = Google לא החזיר תפוגה
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_notification_at timestamptz,
  last_resource_state  text,                      -- sync | exists | not_exists
  last_message_number  integer,
  notification_count   integer     NOT NULL DEFAULT 0,
  stopped_at           timestamptz,               -- NULL = פעיל
  sync_token           text                       -- שמור לשלב מאוחר, לא בשימוש עכשיו
);
CREATE INDEX IF NOT EXISTS google_watch_channels_calendar_idx ON google_watch_channels (calendar_id);

-- ===========================================================================
-- שלב 8.1 — 13 הטבלאות החסרות לפי docs/01-foundation/06-db-schema.md (נוסח מחייב), docs/08-chapter8/35-chapter8-plan.md סעיף 8.1.
-- כללים לכל הטבלאות שלהלן (build-rules 24, 26, 30, 31):
--   * אין מחיקה פיזית: אין DELETE ואין ON DELETE CASCADE. ביטול הוא סטטוס. מפתח זר = הפניה בלבד.
--   * מה שלא ידוע נשאר NULL: בכוונה אין ערכי ברירת מחדל שמסתירים חוסר מידע (06:215).
--   * הנחה, לא אומת: בכל הטבלאות כאן העמודות nullable אלא אם 06 אומר אחרת, ובלי CHECK על רשימות ערכים (status / kind / domain),
--     כדי לא לנעול רשימות ש-06 מגדיר בתיאור בלבד. הקוד אוכף את הרשימות.
--   * מפתח זר רק היכן ש-06 קובע קשר ("→ טבלה"). entity_type + entity_id הם הפניה פולימורפית: בכוונה בלי מפתח זר.
--   * סדר היצירה: קודם הטבלה המופנית, אחר כך המפנה.
-- אין כאן הכנסת נתונים. לא נוצרות טבלאות למבנים ש-06 (שורות 242-288) מסמן "מבנה לא הוגדר" (נושא שיעור, האזנה, פוקוס, חוט תמונה-שיעור).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- media — תמונות שהתקבלו. 06 שורות 28-42. השורה נשארת גם אחרי שהקובץ נמחק מ-Blob: status = deleted (06:42, 216).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    uuid        REFERENCES sources(id),   -- השיתוף שבו הגיעה (06:33)
  blob_path    text,                                 -- המיקום ב-Vercel Blob, אחסון פרטי (06:34)
  content_type text,                                 -- למשל image/jpeg (06:35)
  bytes        integer,                              -- 06:36 "int"
  received_at  timestamptz,                          -- התאריך שנשמר עם התמונה (06:37)
  subject      text,                                 -- המקצוע, כשידוע. ריק כשלא ידוע; לא ממציאים (06:38)
  status       text,                                 -- stored / deleted (06:39). הנחה, לא אומת: בלי CHECK ובלי ברירת מחדל
  deleted_at   timestamptz                           -- מתי הקובץ נמחק מ-Blob (06:40)
);

-- ---------------------------------------------------------------------------
-- facts — עובדות שחולצו ממקור. 06 שורות 44-56. נשמרות לתמיד.
-- origin ו-haiku_confidence אינן ב-06: נוספו לפי docs/02-rules/03-intake-rules.md:80,82 ו-docs/02-rules/03-brain-module-rules.md:74
-- ובדרישת docs/08-chapter8/35-chapter8-plan.md:36. הנחה, לא אומת: שמות העמודות וערכיהן הם הצעה שלי; 06 שותק.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facts (
  id               uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        uuid  REFERENCES sources(id),     -- מאיפה זה הגיע (06:51)
  field            text,                             -- מה חולץ: day, time, action, subject (06:52)
  value            text,                             -- הערך כפי שחולץ (06:53)
  confidence       text,                             -- certain / probable / uncertain (06:54). בקוד, לפי שלמות שדות (intake-rules:76-78)
  extracted_by     text,                             -- script / claude (06:55)
  entity_type      text,                             -- על איזה אובייקט זה השפיע. ריק אם עוד לא שויך (06:56)
  entity_id        uuid,
  origin           text,                             -- הנחה, לא אומת: read / inferred. "נקרא" או "הוסק" לכל שדה (intake-rules:80, brain-module-rules:74)
  haiku_confidence text                              -- הנחה, לא אומת: הערכת Haiku, נשמרת לצד הערך ואינה משנה אותו (intake-rules:82). הסוג text הוא ניחוש
);

-- ---------------------------------------------------------------------------
-- commitments — כללים שמייצרים אירועים חוזרים. 06 שורות 91-100. נוצרת לפני events (events מפנה אליה).
-- timezone אינה ב-06: כלל חוזר נושא אזור זמן (build-rules 24; כמו alarms). הנחה, לא אומת: ברירת המחדל Asia/Jerusalem לפי 06:4.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commitments (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text,
  rule        jsonb,                                 -- ימים, שעות, תדירות (06:97)
  timezone    text  NOT NULL DEFAULT 'Asia/Jerusalem', -- הנחה, לא אומת: לא ב-06. "מחר" אינו "+24 שעות"; אין תאריכי DST קבועים בקוד
  domain      text,
  active_from date,                                  -- 06:99
  active_to   date,
  status      text                                   -- active / paused / ended (06:100)
);

-- ---------------------------------------------------------------------------
-- events — דברים שתופסים זמן. 06 שורות 60-74. שיעורים הם events (35:35).
-- domain מסומן ב-06:69 כ"מיושן" (יומן עסק הוסר ב-3.10); נשמר כפי שהוא, ההתאמה בפרק 8 ובאישור יובל.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text,
  starts_at     timestamptz,
  ends_at       timestamptz,
  location      text,
  description   text,
  domain        text,                                -- school / running / personal / business (06:69). בלי CHECK
  movable       boolean,                             -- שיעור ואימון: לא (06:70). NULL = לא ידוע
  status        text,                                -- planned / done / cancelled (06:71)
  external_id   text,                                -- מזהה האירוע ב-Google Calendar (06:72)
  commitment_id uuid        REFERENCES commitments(id), -- אם נולד מכלל חוזר (06:73)
  match_key     text                                 -- טביעת אצבע: מקור + תאריך + סוג + כותרת מנורמלת (06:74). הנחה, לא אומת: בלי UNIQUE, 06 לא קובע
);

-- ---------------------------------------------------------------------------
-- tasks — דברים שצריך לעשות. 06 שורות 76-89. שיעורי בית הם tasks (35:35).
-- unknown הוא סטטוס לגיטימי (06:89): המערכת שאלה ולא קיבלה תשובה.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text,
  due_at            timestamptz,                     -- תאריך יעד (06:82)
  estimated_minutes integer,                         -- לשיבוץ בחלון פנוי (06:83), "int"
  domain            text,
  status            text,                            -- open / scheduled / done / cancelled / unknown (06:85)
  scheduled_at      timestamptz,                     -- מתי המערכת שיבצה אותה בפועל (06:86)
  source_event_id   uuid        REFERENCES events(id) -- השיעור שממנו נולדה, אם רלוונטי (06:87)
);

-- ---------------------------------------------------------------------------
-- links — קשרים בין ישויות. 06 שורות 102-108. הפניות פולימורפיות: בלי מפתח זר.
-- id אינו ב-06 (הטבלה שם בלי id). הנחה, לא אומת: נוסף מפתח ראשי uuid לפי כלל "מזהים uuid" (06:5).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS links (
  id        uuid  PRIMARY KEY DEFAULT gen_random_uuid(),   -- הנחה, לא אומת: לא ב-06
  from_type text,
  from_id   uuid,
  to_type   text,
  to_id     uuid,
  relation  text                                     -- spawned_from / blocks / relates_to / replaces (06:108)
);

-- ---------------------------------------------------------------------------
-- changes — היסטוריית שינויים. 06 שורות 112-124. עדכון מצב לעולם לא מוחק את הקודם; השינוי נרשם כאן.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS changes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text,                                  -- על מה (06:117)
  entity_id   uuid,
  field       text,                                  -- איזה שדה השתנה (06:118)
  old_value   text,
  new_value   text,
  source_id   uuid        REFERENCES sources(id),    -- בגלל מה (06:120)
  changed_at  timestamptz,                           -- 06:121. הנחה, לא אומת: nullable ובלי DEFAULT now(); 06 לא קובע
  changed_by  text                                   -- system / yuval (06:122)
);

-- ---------------------------------------------------------------------------
-- decisions — תיעוד החלטות. 06 שורות 126-140. לא נשמרת שרשרת מחשבה גולמית (06:140).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS decisions (
  id           uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  situation    text,                                 -- מה היה המצב (06:131)
  alternatives jsonb,                                -- החלופות המרכזיות שנשקלו (06:132)
  decision     text,
  rationale    text,                                 -- נימוק תמציתי
  executed     boolean,                              -- האם בוצע. NULL = לא ידוע
  outcome      text,
  god_mode     boolean,                              -- האם הופעלה חקירה מעמיקה
  entity_type  text,                                 -- על מה זה חל (06:138)
  entity_id    uuid
);

-- ---------------------------------------------------------------------------
-- messages — התקשורת עם יובל. 06 שורות 142-159. בירור פתוח = awaiting_reply = true (06:157).
-- awaiting_reply הוא מקור האמת למספר על האייקון ולרשימת הממתינים (06:159): נסגר רק באישור בפועל באפליקציה, לא בשליחה.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  direction       text,                              -- out / in (06:147)
  body            text,
  kind            text,                              -- update / question / approval_request / reminder (06:149). הצעת האזנה: לא נבדק (06:286)
  sent_at         timestamptz,
  awaiting_reply  boolean,                           -- האם ממתינים לתשובה (06:151). הנחה, לא אומת: בלי DEFAULT, כדי לא להסתיר "לא ידוע"
  reply_source_id uuid        REFERENCES sources(id), -- התשובה, כשהגיעה (06:152)
  expires_at      timestamptz,                       -- מתי השאלה מפסיקה להיות רלוונטית (06:153)
  entity_type     text,                              -- על מה השאלה (06:154)
  entity_id       uuid,
  attempt         integer                            -- ניסיון בירור מספר כמה (06:155), "int"
);

-- ---------------------------------------------------------------------------
-- candidate_rules — דפוסים שממתינים לאישור. 06 שורות 161-172. דפוס לא הופך לכלל בלי אישור מפורש של יובל (06:172).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidate_rules (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern     text,                                  -- הדפוס שזוהה (06:166)
  occurrences integer,                               -- כמה פעמים נצפה (06:167), "int"
  first_seen  timestamptz,
  last_seen   timestamptz,
  evidence    jsonb,                                 -- מזהי ההחלטות שמהן נגזר (06:169)
  status      text                                   -- candidate / approved / rejected (06:170)
);

-- ---------------------------------------------------------------------------
-- static_loads — מעקב טעינות של דאטא סטטי מקבצים. 06 שורות 174-186. טעינה חדשה יוצרת שורה חדשה, לא דורסת (06:214).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS static_loads (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name     text,
  version_label text,                                -- למשל "תשפ״ז" (06:184)
  loaded_at     timestamptz,                         -- הנחה, לא אומת: nullable ובלי DEFAULT now(); 06 לא קובע
  checksum      text
);

-- ---------------------------------------------------------------------------
-- timetable_slots — מערכת השעות. 06 שורות 188-196. הטבלה שם בלי id.
-- הנחה, לא אומת: נוסף id uuid כמפתח ראשי (כלל "מזהים uuid", 06:5), ו-timezone כי זה כלל שבועי חוזר (build-rules 24); 06 שותק על שניהם.
-- starts_at / ends_at הם time (שעת קיר ביום השיעור), לא timestamptz: 06:195 קובע time במפורש. אזור הזמן נשמר ב-timezone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timetable_slots (
  id        uuid  PRIMARY KEY DEFAULT gen_random_uuid(),        -- הנחה, לא אומת: לא ב-06
  load_id   uuid  REFERENCES static_loads(id),                  -- 06:192
  weekday   integer,                                            -- 1=ראשון (06:193)
  period    integer,
  starts_at time,                                               -- 06:195
  ends_at   time,
  subject   text,
  teacher   text,
  room      text,
  timezone  text  NOT NULL DEFAULT 'Asia/Jerusalem'             -- הנחה, לא אומת: לא ב-06
);

-- ---------------------------------------------------------------------------
-- calendar_exceptions — חופשות, מבחנים וחריגים. 06 שורות 198-208. הטבלה שם בלי id.
-- הנחה, לא אומת: נוסף id uuid כמפתח ראשי (06:5).
-- 06:208: חריג שמגיע מהודעה ולא מקובץ נשמר עם load_id ריק ומקושר ל-sources. 06 לא מציין שם עמודה לקישור:
-- הנחה, לא אומת: נוספה source_id uuid REFERENCES sources(id) לפי שם הקישור בשאר הטבלאות.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_exceptions (
  id        uuid    PRIMARY KEY DEFAULT gen_random_uuid(),      -- הנחה, לא אומת: לא ב-06
  load_id   uuid    REFERENCES static_loads(id),                -- ריק כשהחריג הגיע מהודעה (06:208)
  source_id uuid    REFERENCES sources(id),                     -- הנחה, לא אומת: לא ב-06 בשם הזה (06:208 מדבר על קישור)
  date_from date,
  date_to   date,
  kind      text,                                               -- vacation / exam / short_day / trip (06:204)
  title     text,
  certain   boolean                                             -- false כשהמקור לא ודאי (06:206). NULL = לא ידוע
);
