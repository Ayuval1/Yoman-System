# ⚠️ מיושן (6.10.2026): הסקריפט מחפש תיקיית docs בתוך התיקייה שלו, מכיר רק 26 שמות קבצים, ולא נבדק בהרצה מאז שהקבצים הועברו לתיקיות ממוספרות. לבדיקת מצביעים: .claude/skills/yoman-builder/scripts/check-pointers.py
# סקריפט הבדיקה המכנית — נשמר 4.10.2026. הרצה: python3 check-project.py <תיקיית המסמכים>
#!/usr/bin/env python3
"""בדיקות מכניות על מסמכי פרויקט "מערכת יומן" ושלד ה-PWA ב-07. בלי מודל."""
import re, json, subprocess, sys, pathlib, datetime, zoneinfo
D = pathlib.Path(__file__).parent / "docs"
PROJECT_DOCS = """02-build-plan 05-open-questions 03-personal-weights-rules 01-system-overview 03-boundaries-rules 06-db-schema 03-google-calendar-rules 00-project-instructions 03-4fitness-rules 03-brain-module-rules 03-app-channel-rules 03-permissions-rules 03-scheduling-rules 03-design-rules 03-intake-rules 03-homework-rules 03-messaging-rules 04-working-method 09-design-mockups-layer4 03-sources-rules 03-analysis-rules 03-garmin-rules 08-design-mockups 07-design-assets 03-telegram-rules 10-chapter7-research-report""".split()
DATA = "school-vacations-taf-shin-pe-zayin school-events-taf-shin-pe-zayin school-exams-taf-shin-pe-zayin school-subjects-teachers school-day-structure school-timetable-taf-shin-pe-zayin".split()
known = {"README.md"} | {n + ".md" for n in PROJECT_DOCS} | {n + ".md" for n in DATA}
docs = {p.name: p.read_text(encoding="utf-8") for p in sorted(D.glob("*.md"))}
out = []
def h(t): out.append("\n## " + t)
def li(t): out.append("- " + t)

out.append("# דוח בדיקות מכניות — מערכת יומן")
out.append(f"נסרקו {len(docs)} קבצים מתוך {len(known)}: " + ", ".join(docs))
out.append("**לא נסרקו:** " + ", ".join(sorted(k for k in known if k not in docs)))

# 1. מצביעים
h("1. מצביעים לקבצים שאינם קיימים בפרויקט")
bad = 0
for name, txt in docs.items():
    for i, line in enumerate(txt.splitlines(), 1):
        for m in re.finditer(r"`([\w\-/]+\.md)`", line):
            ref = m.group(1).split("/")[-1]
            if ref not in known:
                li(f"{name}:{i} → `{m.group(1)}` (לא ברשימת הקבצים)"); bad += 1
if not bad: li("אין")

# 2. סתירות / ניסוחים מוכרים
h("2. חיפוש ניסוחים מוכרים לבעיה (מיקום מדויק)")
pats = [
 (r"0\.5\s?GB|0\.5GB|חצי ג", "Neon — 0.5GB (המחקר: 1GB מ-2.10.2026)"),
 (r"שליחת 0|שליחת \"?0", "איפוס באדג' ב'שליחת 0' (המחקר: מציג התראה ריקה)"),
 (r"showNotification", "showNotification (מול דחיפה הצהרתית)"),
 (r"מיליון (פעולות|אירועים)", "מיליון פעולות/אירועים (Workflow = 50,000)"),
 (r"לא מסחרי|non-?commercial|personal use", "תנאי שימוש Hobby / שימוש אישי"),
 (r"יומן \"?עסק", "יומן 'עסק' (הוסר 3.10)"),
]
for pat, label in pats:
    hits = []
    for name, txt in docs.items():
        for i, line in enumerate(txt.splitlines(), 1):
            if re.search(pat, line): hits.append(f"{name}:{i}")
    li(f"**{label}** — {len(hits)} מופעים: " + (", ".join(hits[:25]) + (" …" if len(hits) > 25 else "") if hits else "אין"))

# 3. ימי שבוע מול תאריכים (2026)
h("3. יום שבוע מול תאריך (שנת 2026)")
days = {"ראשון":6,"שני":0,"שלישי":1,"רביעי":2,"חמישי":3,"שישי":4,"שבת":5}  # python weekday
wrong = 0; checked = 0
rx1 = re.compile(r"(?:יום\s)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)[,\s]+(\d{1,2})\.(\d{1,2})(?:\.(20\d\d|\d\d))?(?!\d)")
rx2 = re.compile(r"(\d{1,2})\.(\d{1,2})(?:\.(20\d\d))?,?\s+(?:יום\s)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(?![א-ת])")
def chk(name,i,day,d,mo,yr,line):
    global wrong, checked
    y = 2026
    if yr: y = int(yr) if len(yr)==4 else 2000+int(yr)
    try: dt = datetime.date(y,int(mo),int(d))
    except ValueError: return
    checked += 1
    if dt.weekday() != days[day]:
        wrong += 1; li(f"{name}:{i} «{day} {d}.{mo}{('.'+yr) if yr else ''}» — בפועל יום {[k for k,v in days.items() if v==dt.weekday()][0]} ב-{dt}")
for name, txt in docs.items():
    for i, line in enumerate(txt.splitlines(), 1):
        if line.lstrip().startswith("#"): continue   # כותרות סעיפים כמו "3.2 שני סוגי" אינן תאריכים
        for m in rx1.finditer(line): chk(name,i,m.group(1),m.group(2),m.group(3),m.group(4),line)
        for m in rx2.finditer(line): chk(name,i,m.group(4),m.group(1),m.group(2),m.group(3),line)
li(f"נבדקו {checked} צירופים; חריגים: {wrong}. ⚠️ ייתכנו תאריכים משנים אחרות — לבדוק ידנית כל חריג.")

# 4. DST
h("4. מעבר שעון בישראל — מחושב מנתוני אזורי הזמן")
tz = zoneinfo.ZoneInfo("Asia/Jerusalem")
prev = None
d = datetime.datetime(2026,1,1,12,tzinfo=tz)
while d.year == 2026:
    off = d.utcoffset()
    if prev is not None and off != prev:
        li(f"שינוי offset בין {(d-datetime.timedelta(days=1)).date()} ל-{d.date()}: {prev} → {off} ({d.strftime('%A')})")
    prev = off; d += datetime.timedelta(days=1)
li("הערה: מחושב מ-tzdata של סביבת הריצה. אינו מאמת את החוק הרשמי; מצביע רק על מה שהמאגר מכיר.")

# 5. 07-design-assets
h("5. בדיקות על 07-design-assets.md")
a = docs.get("07-design-assets.md", "")
blocks = re.findall(r"```(\w*)\n(.*?)```", a, re.S)
li(f"נמצאו {len(blocks)} בלוקי קוד")
def find(lang, needle):
    for l, b in blocks:
        if l == lang and needle in b: return b
manifest = find("json", '"display"'); vercel = find("json", '"outputDirectory"')
sw = find("javascript", "addEventListener('push'"); html = find("html", "<!DOCTYPE html>")
env = find("", "VAPID_PUBLIC_KEY")
tmp = pathlib.Path("/tmp/c7"); tmp.mkdir(exist_ok=True)
for nm, b in (("manifest.json", manifest), ("vercel.json", vercel)):
    try: json.loads(b); li(f"{nm}: JSON תקין")
    except Exception as e: li(f"{nm}: **שגיאה** {e}")
(tmp/"sw.js").write_text(sw)
r = subprocess.run(["node","--check",str(tmp/"sw.js")],capture_output=True,text=True)
li("sw.js: תחביר " + ("תקין" if r.returncode==0 else "**שגוי** "+r.stderr[:200]))
m = re.search(r'<script type="module">(.*?)</script>', html, re.S)
(tmp/"idx.mjs").write_text(m.group(1))
r = subprocess.run(["node","--check",str(tmp/"idx.mjs")],capture_output=True,text=True)
li("index.html (סקריפט module): תחביר " + ("תקין" if r.returncode==0 else "**שגוי** "+r.stderr[:200]))
mj = json.loads(manifest)
title = re.search(r"<title>(.*?)</title>", html).group(1)
awt = re.search(r'apple-mobile-web-app-title" content="(.*?)"', html).group(1)
li(f"שמות: manifest.name=«{mj['name']}», short_name=«{mj['short_name']}», title=«{title}», apple title=«{awt}» — " + ("אחידים" if len({mj['name'],mj['short_name'],title,awt})==1 else "**לא אחידים**"))
li("הכרעה 2.10: השם 'מערכת יומן'. ב-07 מופיע: " + ("'מערכת יומן'" if "מערכת יומן" in mj["name"] else "**'"+mj["name"]+"' — לא עודכן**"))
# קבצים שמוזכרים מול המבנה המוגדר
structure_files = {"index.html","manifest.json","sw.js","tokens.css","apple-touch-icon-180.png","icon-192.png","icon-512.png","icon-1024.png"}
refs = set(re.findall(r"""(?:href|src)=["']/([\w\-.]+)["']""", html)) | set(re.findall(r'"src":\s*"/([\w\-.]+)"', manifest)) | set(re.findall(r"'/([\w\-.]+)'", sw))
miss = sorted(r_ for r_ in refs if r_ not in structure_files and r_ != "")
li("קבצים שמוזכרים בקוד אך אינם במבנה הריפו המתועד: " + (", ".join(miss) if miss else "אין"))
# enablePush
calls = len(re.findall(r"enablePush\(", html)) - len(re.findall(r"function enablePush\(", html))
li(f"enablePush: קריאות בקוד = {calls}" + (" — **אין כפתור/אירוע שקורא לה (ב-iOS דרוש לחיצה)**" if calls<=0 else ""))
# env מול סודות
need = {"סוד הקיצור":["SHORTCUT"],"VAPID":["VAPID_PUBLIC","VAPID_PRIVATE"],"Google OAuth":["GOOGLE"],"Blob":["BLOB"],"Garmin":["GARMIN"],"טוקן Claude":["CLAUDE_CODE_OAUTH_TOKEN","ANTHROPIC"],"Gemini":["GEMINI"],"מסד":["DATABASE_URL"]}
for k, toks in need.items():
    ok = all(t in env for t in toks)
    li(f".env.example — {k}: " + ("קיים" if ok else "**חסר**"))
# SW מול כללי הערוץ
ac = docs.get("03-app-channel-rules.md","")
li("03-app-channel-rules: 'אין צורך בשירות-עובד' = " + ("כן" if "אין צורך בשירות-עובד" in ac else "לא נמצא") + "; sw.js קורא showNotification בנתיב push = " + ("כן" if "showNotification" in sw else "לא"))
li("sw.js: שדות מטען שנקראים: " + ", ".join(sorted(set(re.findall(r"data\.(\w+)", sw)))))
li("tokens.css: public/ ו-src/ הם 'עותק זהה' לפי הטקסט — לא ניתן לבדוק כאן (שני הקבצים אינם מוצגים בנפרד)")

# 6. מקורות קיימים בפרויקט מול רשימת הקבצים ב-02
h("6. עקביות מספור קבצים")
nums = sorted({n.split('-')[0] for n in PROJECT_DOCS})
li("מספרי קבצים בפרויקט: " + ", ".join(nums) + " (06 ואילך רק למסמך שאינו חוקים תפעוליים — לפי 00)")

print("\n".join(out))
