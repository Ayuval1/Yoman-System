# קוד המסכים שאושרו

> **מה זה:** שישה קבצי HTML, מילה במילה, כפי שאושרו בשיחת העיצוב 22–23.9.2026.
> זה **המקור** שממנו נגזר ה-CSS האמיתי של האפליקציה — לא תמונה להסתכל עליה.
>
> המסמך המחייב להחלטות: `03-design-rules.md`. המקורות והסקריפטים: `07-design-assets.md`.

---

## איך להשתמש

מדביקים כל קטע לקובץ בשם המתאים תחת `design/mockups/`, ואז:

```bash
python tools/render-mockups.py
```

**מידות:** 440×956 — אייפון 16 פרו מקס, ב-`device_scale_factor=3`.

⚠️ **הפונט ב-mockים הוא Assistant, כתחליף ל-SF Hebrew** שלא קיים על לינוקס.
באפליקציה האמיתית זה `system-ui` ואין צורך בתחליף. **אל תעתיק את שורת
ה-Google Fonts לקוד האמיתי** — פונט של גוגל היה הסימן הכי חזק
ל"מרגיש אנדרואיד", והוא נפסל.

---

## מה כל מסך מראה

| הקובץ | מה בפנים |
|---|---|
| `s_main_light.html` | המסך הראשי, בהיר. שלוש דרגות העוצמה, הערימה, בועה של יובל ובועת מערכת |
| `s_main_dark.html` | אותו מסך, מצב כהה. הפלטה השנייה |
| `s_close_light.html` | סגירת 21:00, בהיר |
| `s_close_dark.html` | סגירת 21:00, כהה |
| `states.html` | גיליון ארבעה מצבים: שתיקה · הודעת תמונה · ערימה פתוחה · היום הראשון. **ה-body שלו רחב 1900px** — ארבעה מסכים זה לצד זה |
| `home.html` | מסך הבית של האייפון עם המספר על האייקון |

---

## `design/mockups/s_main_light.html`

```html
<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-font-smoothing:antialiased}
:root{
  --deep:#0A7A36;
  --deep2:#0E8C40;
  --live:#16A64B;
  --mint:#F0F8F3;
  --bg:#EDEFF2;
  --label:#0B1410;
  --label2:rgba(45,60,52,.62);
  --label3:rgba(45,60,52,.34);
  --sep:rgba(45,60,52,.14);
  --amber:#96650F;
  --amberbg:#FCF3E2;
}
/* real app: font-family: system-ui, -apple-system → SF Hebrew on iPhone.
   Assistant is a stand-in for this Linux-rendered mock only. */
body{font-family:'Assistant',system-ui,-apple-system,sans-serif;background:#fff;width:440px;height:956px;overflow:hidden}
.screen{width:440px;height:956px;display:flex;flex-direction:column;position:relative;
  background:linear-gradient(180deg,#EFF2F4 0%,#E4E9EB 100%)}
.screen::before{content:"";position:absolute;top:0;left:0;right:0;height:470px;z-index:0;pointer-events:none;
  background:radial-gradient(125% 62% at 50% 0%, rgba(14,140,64,.20), rgba(14,140,64,.06) 55%, rgba(14,140,64,0) 82%)}
.screen::after{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;opacity:.5;mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter><rect width='160' height='160' filter='url(%23n)' opacity='0.42'/></svg>")}

/* ---------- hero ---------- */
.hero{position:relative;z-index:2;color:#fff;padding-bottom:44px;
  background:linear-gradient(168deg,var(--deep2) 0%,var(--deep) 66%,#096B2F 100%);
  border-radius:0 0 34px 34px;
  box-shadow:0 10px 26px rgba(6,60,28,.30), 0 2px 6px rgba(6,60,28,.18)}
.hero::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:radial-gradient(85% 60% at 88% -8%, rgba(255,255,255,.26), rgba(255,255,255,0) 62%)}
.hero::after{content:"";position:absolute;left:0;right:0;bottom:0;height:52%;border-radius:inherit;pointer-events:none;
  background:linear-gradient(180deg, rgba(0,40,18,0) 0%, rgba(0,40,18,.16) 100%)}
.hero > *{position:relative;z-index:1}
.status{height:52px;display:flex;align-items:flex-end;justify-content:space-between;padding:0 30px 5px;font-size:15px;font-weight:600}
.sysic{display:flex;gap:6px;align-items:center}
.bars{display:flex;gap:2px;align-items:flex-end}
.bars i{width:3px;background:#fff;border-radius:1px;display:block}
.navtop{display:flex;align-items:center;gap:9px;height:28px;padding:0 24px}
.appmark{width:21px;height:21px;flex:none;opacity:.92}
.navname{font-size:14.5px;font-weight:600;opacity:.8;letter-spacing:.2px}
.large{font-size:33px;font-weight:700;letter-spacing:-.9px;line-height:1.08;padding:7px 24px 0}
.navsub{font-size:14.5px;opacity:.72;padding:2px 24px 0}

.body{position:relative;z-index:3;flex:1;min-height:0;display:flex;flex-direction:column}

/* ---------- level 1 · needs you ---------- */
.pinwrap{position:relative;z-index:50;padding:0 14px;margin-top:-30px}
.stack{display:flex;flex-direction:column}
.card1{position:relative;z-index:3;background:#fff;border-radius:24px;overflow:hidden;
       box-shadow:0 10px 24px rgba(8,52,30,.16), 0 2px 6px rgba(8,52,30,.08)}
.chead{display:flex;align-items:center;gap:8px;padding:13px 18px;background:var(--amberbg)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--amber);flex:none}
.clbl{font-size:13px;font-weight:700;color:var(--amber)}
.cnt{margin-inline-start:auto;font-size:12px;font-weight:700;color:#fff;background:var(--amber);border-radius:100px;padding:2px 10px}
.ctxt{font-size:17px;line-height:1.42;color:var(--label);padding:17px 18px 0}
.ctxt b{font-weight:700}
.btns{display:flex;gap:9px;padding:15px 18px 17px}
.cap{flex:1;text-align:center;padding:12px 0;border-radius:100px;font-size:16px;font-weight:700}
.yes{background:var(--deep);color:#fff;box-shadow:0 4px 10px rgba(10,122,54,.28)}
.no{background:#EFF1F3;color:var(--label2);font-weight:600}
.peek{background:#fff;border-radius:24px;height:26px;position:relative}
.p2{margin:-16px 12px 0;z-index:2;box-shadow:0 7px 14px rgba(8,52,30,.10)}
.p3{margin:-16px 26px 0;z-index:1;box-shadow:0 7px 14px rgba(8,52,30,.07);opacity:.9}
.more{text-align:center;font-size:13.5px;font-weight:700;color:var(--deep);padding:15px 0 0}

/* ---------- feed ---------- */
.feed{flex:1;overflow:hidden;padding:0 16px 10px;display:flex;flex-direction:column;justify-content:flex-end;gap:15px}

/* level 2 · today's picture */
.card2{background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 4px 12px rgba(8,52,30,.09)}
.h2{display:flex;align-items:center;gap:8px;padding:12px 18px;background:var(--mint)}
.h2 .lbl{font-size:13px;font-weight:700;color:var(--deep)}
.h2 .t{margin-inline-start:auto;font-size:12.5px;font-weight:600;color:rgba(10,122,54,.55);font-variant-numeric:tabular-nums}
.row{display:flex;align-items:baseline;gap:12px;padding:13px 18px;position:relative}
.row+.row::before{content:"";position:absolute;top:0;right:18px;left:18px;height:1px;background:var(--sep)}
.rt{font-size:15px;font-weight:700;color:var(--deep);min-width:46px;font-variant-numeric:tabular-nums}
.rb{font-size:17px;color:var(--label);line-height:1.3}
.rb small{display:block;font-size:13px;color:var(--label2);margin-top:2px}

/* level 3 · fyi */
.ghead{font-size:13px;color:var(--label2);padding:0 8px 7px;display:flex}
.ghead .t{margin-inline-start:auto;font-variant-numeric:tabular-nums}
.card3{background:#fff;border-radius:20px;box-shadow:0 2px 7px rgba(8,52,30,.06);padding:15px 18px;font-size:17px;line-height:1.4;color:var(--label)}
.old{color:var(--label3);text-decoration:line-through;font-variant-numeric:tabular-nums}
.new{color:var(--deep);font-weight:700;font-variant-numeric:tabular-nums}

/* me */
.me{align-self:flex-end;max-width:76%;background:linear-gradient(165deg,#1AB455,var(--live));color:#fff;
    border-radius:22px;padding:11px 17px;font-size:17px;line-height:1.3;box-shadow:0 4px 12px rgba(22,166,75,.26)}
.metime{align-self:flex-end;font-size:11.5px;color:var(--label3);margin:-11px 8px 0;direction:ltr}
.ack{align-self:flex-start;font-size:13px;color:var(--label2);margin-top:-8px}

/* input */
.inputbar{position:relative;z-index:3;padding:10px 16px 26px;display:flex;align-items:center;gap:10px;background:rgba(237,241,243,.9);backdrop-filter:saturate(180%) blur(20px)}
.field{flex:1;background:#fff;border-radius:100px;padding:7px 18px 7px 7px;font-size:17px;color:var(--label3);
  box-shadow:0 2px 7px rgba(8,52,30,.07);display:flex;align-items:center;gap:10px}
.field span{flex:1}
.send{width:32px;height:32px;border-radius:50%;background:var(--deep);flex:none;display:flex;align-items:center;justify-content:center}
.home{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:140px;height:5px;border-radius:3px;background:#0005}

.navtop{padding:0 24px;height:26px;display:flex;align-items:center}
.appmark{width:22px;height:22px;opacity:.9}
.sub{font-size:12.5px;font-weight:700;color:var(--label2);letter-spacing:.3px;padding:15px 18px 3px}
.sub.sep{border-top:1px solid var(--sep);margin-top:6px;padding-top:15px}
.row.wait{align-items:center;gap:11px}
.row.wait+.row.wait::before{display:none}
.wdot{width:8px;height:8px;border-radius:50%;background:var(--amber);flex:none;margin-inline-start:19px}
.row.wait .rb{font-size:16px}
.sub+.row::before{display:none}

.sysb{align-self:flex-start;max-width:80%;background:#fff;border-radius:22px;padding:11px 16px 9px;
  font-size:17px;line-height:1.4;color:var(--label);box-shadow:0 3px 10px rgba(8,52,30,.09)}
.sysb .sl{display:block;font-size:12.5px;font-weight:700;color:var(--deep);margin-bottom:2px}
.sysb .bt{font-size:11.5px;color:var(--label3);margin-top:3px;text-align:left;direction:ltr}
</style></head><body><div class="screen"><div class="hero">
  <div class="status"><span>9:41</span><span class="sysic">
  <span class="bars"><i style="height:5px"></i><i style="height:7px"></i><i style="height:9px"></i><i style="height:11px"></i></span>
  <svg width="16" height="12" viewBox="0 0 16 12" fill="#fff"><path d="M8 11.5 .8 4.2a10 10 0 0 1 14.4 0z"/></svg>
  <svg width="26" height="13" viewBox="0 0 26 13"><rect x="1" y="1" width="21" height="11" rx="4" fill="none" stroke="#fff" opacity=".5"/><rect x="2.8" y="2.8" width="17" height="7.4" rx="2.5" fill="#fff"/><path d="M23.5 4.5v4a2.2 2.2 0 0 0 0-4z" fill="#fff" opacity=".5"/></svg>
</span></div>
  <div class="navtop"><svg class="appmark" viewBox="0 0 1024 1024" fill="#fff"><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71z" opacity=".22"/><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71zm-45 141h650v-70c0-39-32-71-71-71H232c-39 0-71 32-71 71v70z" fill="none" stroke="#fff" stroke-width="52"/><rect x="318" y="118" width="46" height="98" rx="23"/><rect x="660" y="118" width="46" height="98" rx="23"/><circle cx="330" cy="470" r="34"/><circle cx="512" cy="470" r="34"/><circle cx="694" cy="470" r="34"/><circle cx="330" cy="600" r="34"/><circle cx="512" cy="600" r="34"/><circle cx="694" cy="600" r="34"/></svg></div>
  <div class="large">יום שני</div>
  <div class="navsub">9 בנובמבר 2026</div>
</div>
<div class="body">
  <div class="pinwrap"><div class="stack">
    <div class="card1">
      <div class="chead"><span class="dot"></span><span class="clbl">ממתין לתשובה</span><span class="cnt">4</span></div>
      <div class="ctxt">האימון של היום מתנגש עם המבדק במתמטיקה מחר. <b>לבטל את האימון?</b></div>
      <div class="btns"><div class="cap no">לא</div><div class="cap yes">כן, בטל</div></div>
    </div>
    <div class="peek p2"></div><div class="peek p3"></div>
    <div class="more">עוד 3 ממתינים ›</div>
  </div></div>
  <div class="feed">
    <div class="card2">
      <div class="h2"><span class="lbl">בריף הבוקר</span><span class="t">07:30</span></div>
      <div class="row"><span class="rt">08:00</span><span class="rb">בית ספר<small>עד 15:45</small></span></div>
      <div class="row"><span class="rt">10:05</span><span class="rb">מבדק במתמטיקה<small>שיעור שלישי</small></span></div>
      <div class="row"><span class="rt">18:30</span><span class="rb">אימון 4fitness<small>ממתין להכרעה שלך</small></span></div>
    </div>
    <div class="me">להביא סרגל ומחוגה</div>
    <div class="metime">09:12</div>
    <div class="sysb"><span class="sl">נרשם</span>מחר 08:00<div class="bt">09:12</div></div>
    <div>
      <div class="ghead">עודכן ביומן<span class="t">09:20</span></div>
      <div class="card3">המבדק בפיזיקה הוזז מ־<span class="old">2.11</span> ל־<span class="new">9.11</span></div>
    </div>
  </div>
</div><div class="inputbar">
  <div class="field"><span>הודעה</span>
    <div class="send"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></div>
  </div>
</div><div class="home"></div></div></body></html>
```

---

## `design/mockups/s_main_dark.html`

```html
<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-font-smoothing:antialiased}
:root{
  --deep:#0A7A36;
  --deep2:#0E8C40;
  --live:#16A64B;
  --mint:#F0F8F3;
  --bg:#EDEFF2;
  --label:#0B1410;
  --label2:rgba(45,60,52,.62);
  --label3:rgba(45,60,52,.34);
  --sep:rgba(45,60,52,.14);
  --amber:#96650F;
  --amberbg:#FCF3E2;
}
/* real app: font-family: system-ui, -apple-system → SF Hebrew on iPhone.
   Assistant is a stand-in for this Linux-rendered mock only. */
body{font-family:'Assistant',system-ui,-apple-system,sans-serif;background:#fff;width:440px;height:956px;overflow:hidden}
.screen{width:440px;height:956px;display:flex;flex-direction:column;position:relative;
  background:linear-gradient(180deg,#EFF2F4 0%,#E4E9EB 100%)}
.screen::before{content:"";position:absolute;top:0;left:0;right:0;height:470px;z-index:0;pointer-events:none;
  background:radial-gradient(125% 62% at 50% 0%, rgba(14,140,64,.20), rgba(14,140,64,.06) 55%, rgba(14,140,64,0) 82%)}
.screen::after{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;opacity:.5;mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter><rect width='160' height='160' filter='url(%23n)' opacity='0.42'/></svg>")}

/* ---------- hero ---------- */
.hero{position:relative;z-index:2;color:#fff;padding-bottom:44px;
  background:linear-gradient(168deg,var(--deep2) 0%,var(--deep) 66%,#096B2F 100%);
  border-radius:0 0 34px 34px;
  box-shadow:0 10px 26px rgba(6,60,28,.30), 0 2px 6px rgba(6,60,28,.18)}
.hero::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:radial-gradient(85% 60% at 88% -8%, rgba(255,255,255,.26), rgba(255,255,255,0) 62%)}
.hero::after{content:"";position:absolute;left:0;right:0;bottom:0;height:52%;border-radius:inherit;pointer-events:none;
  background:linear-gradient(180deg, rgba(0,40,18,0) 0%, rgba(0,40,18,.16) 100%)}
.hero > *{position:relative;z-index:1}
.status{height:52px;display:flex;align-items:flex-end;justify-content:space-between;padding:0 30px 5px;font-size:15px;font-weight:600}
.sysic{display:flex;gap:6px;align-items:center}
.bars{display:flex;gap:2px;align-items:flex-end}
.bars i{width:3px;background:#fff;border-radius:1px;display:block}
.navtop{display:flex;align-items:center;gap:9px;height:28px;padding:0 24px}
.appmark{width:21px;height:21px;flex:none;opacity:.92}
.navname{font-size:14.5px;font-weight:600;opacity:.8;letter-spacing:.2px}
.large{font-size:33px;font-weight:700;letter-spacing:-.9px;line-height:1.08;padding:7px 24px 0}
.navsub{font-size:14.5px;opacity:.72;padding:2px 24px 0}

.body{position:relative;z-index:3;flex:1;min-height:0;display:flex;flex-direction:column}

/* ---------- level 1 · needs you ---------- */
.pinwrap{position:relative;z-index:50;padding:0 14px;margin-top:-30px}
.stack{display:flex;flex-direction:column}
.card1{position:relative;z-index:3;background:#fff;border-radius:24px;overflow:hidden;
       box-shadow:0 10px 24px rgba(8,52,30,.16), 0 2px 6px rgba(8,52,30,.08)}
.chead{display:flex;align-items:center;gap:8px;padding:13px 18px;background:var(--amberbg)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--amber);flex:none}
.clbl{font-size:13px;font-weight:700;color:var(--amber)}
.cnt{margin-inline-start:auto;font-size:12px;font-weight:700;color:#fff;background:var(--amber);border-radius:100px;padding:2px 10px}
.ctxt{font-size:17px;line-height:1.42;color:var(--label);padding:17px 18px 0}
.ctxt b{font-weight:700}
.btns{display:flex;gap:9px;padding:15px 18px 17px}
.cap{flex:1;text-align:center;padding:12px 0;border-radius:100px;font-size:16px;font-weight:700}
.yes{background:var(--deep);color:#fff;box-shadow:0 4px 10px rgba(10,122,54,.28)}
.no{background:#EFF1F3;color:var(--label2);font-weight:600}
.peek{background:#fff;border-radius:24px;height:26px;position:relative}
.p2{margin:-16px 12px 0;z-index:2;box-shadow:0 7px 14px rgba(8,52,30,.10)}
.p3{margin:-16px 26px 0;z-index:1;box-shadow:0 7px 14px rgba(8,52,30,.07);opacity:.9}
.more{text-align:center;font-size:13.5px;font-weight:700;color:var(--deep);padding:15px 0 0}

/* ---------- feed ---------- */
.feed{flex:1;overflow:hidden;padding:0 16px 10px;display:flex;flex-direction:column;justify-content:flex-end;gap:15px}

/* level 2 · today's picture */
.card2{background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 4px 12px rgba(8,52,30,.09)}
.h2{display:flex;align-items:center;gap:8px;padding:12px 18px;background:var(--mint)}
.h2 .lbl{font-size:13px;font-weight:700;color:var(--deep)}
.h2 .t{margin-inline-start:auto;font-size:12.5px;font-weight:600;color:rgba(10,122,54,.55);font-variant-numeric:tabular-nums}
.row{display:flex;align-items:baseline;gap:12px;padding:13px 18px;position:relative}
.row+.row::before{content:"";position:absolute;top:0;right:18px;left:18px;height:1px;background:var(--sep)}
.rt{font-size:15px;font-weight:700;color:var(--deep);min-width:46px;font-variant-numeric:tabular-nums}
.rb{font-size:17px;color:var(--label);line-height:1.3}
.rb small{display:block;font-size:13px;color:var(--label2);margin-top:2px}

/* level 3 · fyi */
.ghead{font-size:13px;color:var(--label2);padding:0 8px 7px;display:flex}
.ghead .t{margin-inline-start:auto;font-variant-numeric:tabular-nums}
.card3{background:#fff;border-radius:20px;box-shadow:0 2px 7px rgba(8,52,30,.06);padding:15px 18px;font-size:17px;line-height:1.4;color:var(--label)}
.old{color:var(--label3);text-decoration:line-through;font-variant-numeric:tabular-nums}
.new{color:var(--deep);font-weight:700;font-variant-numeric:tabular-nums}

/* me */
.me{align-self:flex-end;max-width:76%;background:linear-gradient(165deg,#1AB455,var(--live));color:#fff;
    border-radius:22px;padding:11px 17px;font-size:17px;line-height:1.3;box-shadow:0 4px 12px rgba(22,166,75,.26)}
.metime{align-self:flex-end;font-size:11.5px;color:var(--label3);margin:-11px 8px 0;direction:ltr}
.ack{align-self:flex-start;font-size:13px;color:var(--label2);margin-top:-8px}

/* input */
.inputbar{position:relative;z-index:3;padding:10px 16px 26px;display:flex;align-items:center;gap:10px;background:rgba(237,241,243,.9);backdrop-filter:saturate(180%) blur(20px)}
.field{flex:1;background:#fff;border-radius:100px;padding:7px 18px 7px 7px;font-size:17px;color:var(--label3);
  box-shadow:0 2px 7px rgba(8,52,30,.07);display:flex;align-items:center;gap:10px}
.field span{flex:1}
.send{width:32px;height:32px;border-radius:50%;background:var(--deep);flex:none;display:flex;align-items:center;justify-content:center}
.home{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:140px;height:5px;border-radius:3px;background:#0005}

.navtop{padding:0 24px;height:26px;display:flex;align-items:center}
.appmark{width:22px;height:22px;opacity:.9}
.sub{font-size:12.5px;font-weight:700;color:var(--label2);letter-spacing:.3px;padding:15px 18px 3px}
.sub.sep{border-top:1px solid var(--sep);margin-top:6px;padding-top:15px}
.row.wait{align-items:center;gap:11px}
.row.wait+.row.wait::before{display:none}
.wdot{width:8px;height:8px;border-radius:50%;background:var(--amber);flex:none;margin-inline-start:19px}
.row.wait .rb{font-size:16px}
.sub+.row::before{display:none}

:root{
  --deep:#0A5A2A; --deep2:#0C6B33; --live:#149042;
  --mint:#16291F; --label:#EEF4F0;
  --label2:rgba(226,240,232,.60); --label3:rgba(226,240,232,.32);
  --sep:rgba(226,240,232,.12);
  --amber:#D9A03C; --amberbg:#2A2211;
}
.screen{background:linear-gradient(180deg,#141A17 0%,#0D1210 100%)!important}
.screen::before{background:radial-gradient(125% 62% at 50% 0%, rgba(20,160,74,.20), rgba(20,160,74,.05) 55%, rgba(20,160,74,0) 82%)!important}
.screen::after{mix-blend-mode:screen!important;opacity:.28!important}
.hero{box-shadow:0 12px 30px rgba(0,0,0,.55)!important}
.hero::after{background:linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,.28) 100%)!important}
.card1{background:#1D2621!important;box-shadow:0 12px 28px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.4)!important}
.card2,.card3,.peek{background:#1B2420!important}
.card2{box-shadow:0 6px 16px rgba(0,0,0,.42)!important}
.card3{box-shadow:0 3px 10px rgba(0,0,0,.36)!important}
.peek{box-shadow:0 8px 16px rgba(0,0,0,.45)!important}
.h2 .t{color:rgba(120,220,160,.6)!important}
.h2 .lbl{color:#54CC85!important}
.rt,.new,.more{color:#54CC85!important}
.no{background:rgba(235,245,238,.10)!important;color:var(--label2)!important}
.yes{background:#12803A!important;box-shadow:0 4px 12px rgba(0,0,0,.4)!important}
.clbl,.wdot{color:var(--amber)}
.cnt{color:#1A1509!important}
.me{background:linear-gradient(165deg,#179A47,#12853C)!important;box-shadow:0 5px 14px rgba(0,0,0,.4)!important}
.inputbar{background:rgba(16,22,19,.9)!important}
.field{background:#1D2621!important;box-shadow:0 2px 8px rgba(0,0,0,.4)!important}
.send{background:#12803A!important}
.home{background:#ffffff55!important}

.sysb{align-self:flex-start;max-width:80%;background:#fff;border-radius:22px;padding:11px 16px 9px;
  font-size:17px;line-height:1.4;color:var(--label);box-shadow:0 3px 10px rgba(8,52,30,.09)}
.sysb .sl{display:block;font-size:12.5px;font-weight:700;color:var(--deep);margin-bottom:2px}
.sysb .bt{font-size:11.5px;color:var(--label3);margin-top:3px;text-align:left;direction:ltr}

.sysb{background:#1D2621!important;box-shadow:0 4px 12px rgba(0,0,0,.42)!important}
.sysb .sl{color:#54CC85!important}
</style></head><body><div class="screen"><div class="hero">
  <div class="status"><span>9:41</span><span class="sysic">
  <span class="bars"><i style="height:5px"></i><i style="height:7px"></i><i style="height:9px"></i><i style="height:11px"></i></span>
  <svg width="16" height="12" viewBox="0 0 16 12" fill="#fff"><path d="M8 11.5 .8 4.2a10 10 0 0 1 14.4 0z"/></svg>
  <svg width="26" height="13" viewBox="0 0 26 13"><rect x="1" y="1" width="21" height="11" rx="4" fill="none" stroke="#fff" opacity=".5"/><rect x="2.8" y="2.8" width="17" height="7.4" rx="2.5" fill="#fff"/><path d="M23.5 4.5v4a2.2 2.2 0 0 0 0-4z" fill="#fff" opacity=".5"/></svg>
</span></div>
  <div class="navtop"><svg class="appmark" viewBox="0 0 1024 1024" fill="#fff"><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71z" opacity=".22"/><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71zm-45 141h650v-70c0-39-32-71-71-71H232c-39 0-71 32-71 71v70z" fill="none" stroke="#fff" stroke-width="52"/><rect x="318" y="118" width="46" height="98" rx="23"/><rect x="660" y="118" width="46" height="98" rx="23"/><circle cx="330" cy="470" r="34"/><circle cx="512" cy="470" r="34"/><circle cx="694" cy="470" r="34"/><circle cx="330" cy="600" r="34"/><circle cx="512" cy="600" r="34"/><circle cx="694" cy="600" r="34"/></svg></div>
  <div class="large">יום שני</div>
  <div class="navsub">9 בנובמבר 2026</div>
</div>
<div class="body">
  <div class="pinwrap"><div class="stack">
    <div class="card1">
      <div class="chead"><span class="dot"></span><span class="clbl">ממתין לתשובה</span><span class="cnt">4</span></div>
      <div class="ctxt">האימון של היום מתנגש עם המבדק במתמטיקה מחר. <b>לבטל את האימון?</b></div>
      <div class="btns"><div class="cap no">לא</div><div class="cap yes">כן, בטל</div></div>
    </div>
    <div class="peek p2"></div><div class="peek p3"></div>
    <div class="more">עוד 3 ממתינים ›</div>
  </div></div>
  <div class="feed">
    <div class="card2">
      <div class="h2"><span class="lbl">בריף הבוקר</span><span class="t">07:30</span></div>
      <div class="row"><span class="rt">08:00</span><span class="rb">בית ספר<small>עד 15:45</small></span></div>
      <div class="row"><span class="rt">10:05</span><span class="rb">מבדק במתמטיקה<small>שיעור שלישי</small></span></div>
      <div class="row"><span class="rt">18:30</span><span class="rb">אימון 4fitness<small>ממתין להכרעה שלך</small></span></div>
    </div>
    <div class="me">להביא סרגל ומחוגה</div>
    <div class="metime">09:12</div>
    <div class="sysb"><span class="sl">נרשם</span>מחר 08:00<div class="bt">09:12</div></div>
    <div>
      <div class="ghead">עודכן ביומן<span class="t">09:20</span></div>
      <div class="card3">המבדק בפיזיקה הוזז מ־<span class="old">2.11</span> ל־<span class="new">9.11</span></div>
    </div>
  </div>
</div><div class="inputbar">
  <div class="field"><span>הודעה</span>
    <div class="send"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></div>
  </div>
</div><div class="home"></div></div></body></html>
```

---

## `design/mockups/s_close_light.html`

```html
<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-font-smoothing:antialiased}
:root{
  --deep:#0A7A36;
  --deep2:#0E8C40;
  --live:#16A64B;
  --mint:#F0F8F3;
  --bg:#EDEFF2;
  --label:#0B1410;
  --label2:rgba(45,60,52,.62);
  --label3:rgba(45,60,52,.34);
  --sep:rgba(45,60,52,.14);
  --amber:#96650F;
  --amberbg:#FCF3E2;
}
/* real app: font-family: system-ui, -apple-system → SF Hebrew on iPhone.
   Assistant is a stand-in for this Linux-rendered mock only. */
body{font-family:'Assistant',system-ui,-apple-system,sans-serif;background:#fff;width:440px;height:956px;overflow:hidden}
.screen{width:440px;height:956px;display:flex;flex-direction:column;position:relative;
  background:linear-gradient(180deg,#EFF2F4 0%,#E4E9EB 100%)}
.screen::before{content:"";position:absolute;top:0;left:0;right:0;height:470px;z-index:0;pointer-events:none;
  background:radial-gradient(125% 62% at 50% 0%, rgba(14,140,64,.20), rgba(14,140,64,.06) 55%, rgba(14,140,64,0) 82%)}
.screen::after{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;opacity:.5;mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter><rect width='160' height='160' filter='url(%23n)' opacity='0.42'/></svg>")}

/* ---------- hero ---------- */
.hero{position:relative;z-index:2;color:#fff;padding-bottom:44px;
  background:linear-gradient(168deg,var(--deep2) 0%,var(--deep) 66%,#096B2F 100%);
  border-radius:0 0 34px 34px;
  box-shadow:0 10px 26px rgba(6,60,28,.30), 0 2px 6px rgba(6,60,28,.18)}
.hero::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:radial-gradient(85% 60% at 88% -8%, rgba(255,255,255,.26), rgba(255,255,255,0) 62%)}
.hero::after{content:"";position:absolute;left:0;right:0;bottom:0;height:52%;border-radius:inherit;pointer-events:none;
  background:linear-gradient(180deg, rgba(0,40,18,0) 0%, rgba(0,40,18,.16) 100%)}
.hero > *{position:relative;z-index:1}
.status{height:52px;display:flex;align-items:flex-end;justify-content:space-between;padding:0 30px 5px;font-size:15px;font-weight:600}
.sysic{display:flex;gap:6px;align-items:center}
.bars{display:flex;gap:2px;align-items:flex-end}
.bars i{width:3px;background:#fff;border-radius:1px;display:block}
.navtop{display:flex;align-items:center;gap:9px;height:28px;padding:0 24px}
.appmark{width:21px;height:21px;flex:none;opacity:.92}
.navname{font-size:14.5px;font-weight:600;opacity:.8;letter-spacing:.2px}
.large{font-size:33px;font-weight:700;letter-spacing:-.9px;line-height:1.08;padding:7px 24px 0}
.navsub{font-size:14.5px;opacity:.72;padding:2px 24px 0}

.body{position:relative;z-index:3;flex:1;min-height:0;display:flex;flex-direction:column}

/* ---------- level 1 · needs you ---------- */
.pinwrap{position:relative;z-index:50;padding:0 14px;margin-top:-30px}
.stack{display:flex;flex-direction:column}
.card1{position:relative;z-index:3;background:#fff;border-radius:24px;overflow:hidden;
       box-shadow:0 10px 24px rgba(8,52,30,.16), 0 2px 6px rgba(8,52,30,.08)}
.chead{display:flex;align-items:center;gap:8px;padding:13px 18px;background:var(--amberbg)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--amber);flex:none}
.clbl{font-size:13px;font-weight:700;color:var(--amber)}
.cnt{margin-inline-start:auto;font-size:12px;font-weight:700;color:#fff;background:var(--amber);border-radius:100px;padding:2px 10px}
.ctxt{font-size:17px;line-height:1.42;color:var(--label);padding:17px 18px 0}
.ctxt b{font-weight:700}
.btns{display:flex;gap:9px;padding:15px 18px 17px}
.cap{flex:1;text-align:center;padding:12px 0;border-radius:100px;font-size:16px;font-weight:700}
.yes{background:var(--deep);color:#fff;box-shadow:0 4px 10px rgba(10,122,54,.28)}
.no{background:#EFF1F3;color:var(--label2);font-weight:600}
.peek{background:#fff;border-radius:24px;height:26px;position:relative}
.p2{margin:-16px 12px 0;z-index:2;box-shadow:0 7px 14px rgba(8,52,30,.10)}
.p3{margin:-16px 26px 0;z-index:1;box-shadow:0 7px 14px rgba(8,52,30,.07);opacity:.9}
.more{text-align:center;font-size:13.5px;font-weight:700;color:var(--deep);padding:15px 0 0}

/* ---------- feed ---------- */
.feed{flex:1;overflow:hidden;padding:0 16px 10px;display:flex;flex-direction:column;justify-content:flex-end;gap:15px}

/* level 2 · today's picture */
.card2{background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 4px 12px rgba(8,52,30,.09)}
.h2{display:flex;align-items:center;gap:8px;padding:12px 18px;background:var(--mint)}
.h2 .lbl{font-size:13px;font-weight:700;color:var(--deep)}
.h2 .t{margin-inline-start:auto;font-size:12.5px;font-weight:600;color:rgba(10,122,54,.55);font-variant-numeric:tabular-nums}
.row{display:flex;align-items:baseline;gap:12px;padding:13px 18px;position:relative}
.row+.row::before{content:"";position:absolute;top:0;right:18px;left:18px;height:1px;background:var(--sep)}
.rt{font-size:15px;font-weight:700;color:var(--deep);min-width:46px;font-variant-numeric:tabular-nums}
.rb{font-size:17px;color:var(--label);line-height:1.3}
.rb small{display:block;font-size:13px;color:var(--label2);margin-top:2px}

/* level 3 · fyi */
.ghead{font-size:13px;color:var(--label2);padding:0 8px 7px;display:flex}
.ghead .t{margin-inline-start:auto;font-variant-numeric:tabular-nums}
.card3{background:#fff;border-radius:20px;box-shadow:0 2px 7px rgba(8,52,30,.06);padding:15px 18px;font-size:17px;line-height:1.4;color:var(--label)}
.old{color:var(--label3);text-decoration:line-through;font-variant-numeric:tabular-nums}
.new{color:var(--deep);font-weight:700;font-variant-numeric:tabular-nums}

/* me */
.me{align-self:flex-end;max-width:76%;background:linear-gradient(165deg,#1AB455,var(--live));color:#fff;
    border-radius:22px;padding:11px 17px;font-size:17px;line-height:1.3;box-shadow:0 4px 12px rgba(22,166,75,.26)}
.metime{align-self:flex-end;font-size:11.5px;color:var(--label3);margin:-11px 8px 0;direction:ltr}
.ack{align-self:flex-start;font-size:13px;color:var(--label2);margin-top:-8px}

/* input */
.inputbar{position:relative;z-index:3;padding:10px 16px 26px;display:flex;align-items:center;gap:10px;background:rgba(237,241,243,.9);backdrop-filter:saturate(180%) blur(20px)}
.field{flex:1;background:#fff;border-radius:100px;padding:7px 18px 7px 7px;font-size:17px;color:var(--label3);
  box-shadow:0 2px 7px rgba(8,52,30,.07);display:flex;align-items:center;gap:10px}
.field span{flex:1}
.send{width:32px;height:32px;border-radius:50%;background:var(--deep);flex:none;display:flex;align-items:center;justify-content:center}
.home{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:140px;height:5px;border-radius:3px;background:#0005}

.navtop{padding:0 24px;height:26px;display:flex;align-items:center}
.appmark{width:22px;height:22px;opacity:.9}
.sub{font-size:12.5px;font-weight:700;color:var(--label2);letter-spacing:.3px;padding:15px 18px 3px}
.sub.sep{border-top:1px solid var(--sep);margin-top:6px;padding-top:15px}
.row.wait{align-items:center;gap:11px}
.row.wait+.row.wait::before{display:none}
.wdot{width:8px;height:8px;border-radius:50%;background:var(--amber);flex:none;margin-inline-start:19px}
.row.wait .rb{font-size:16px}
.sub+.row::before{display:none}
</style></head><body><div class="screen"><div class="hero">
  <div class="status"><span>21:00</span><span class="sysic">
  <span class="bars"><i style="height:5px"></i><i style="height:7px"></i><i style="height:9px"></i><i style="height:11px"></i></span>
  <svg width="16" height="12" viewBox="0 0 16 12" fill="#fff"><path d="M8 11.5 .8 4.2a10 10 0 0 1 14.4 0z"/></svg>
  <svg width="26" height="13" viewBox="0 0 26 13"><rect x="1" y="1" width="21" height="11" rx="4" fill="none" stroke="#fff" opacity=".5"/><rect x="2.8" y="2.8" width="17" height="7.4" rx="2.5" fill="#fff"/><path d="M23.5 4.5v4a2.2 2.2 0 0 0 0-4z" fill="#fff" opacity=".5"/></svg>
</span></div>
  <div class="navtop"><svg class="appmark" viewBox="0 0 1024 1024" fill="#fff"><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71z" opacity=".22"/><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71zm-45 141h650v-70c0-39-32-71-71-71H232c-39 0-71 32-71 71v70z" fill="none" stroke="#fff" stroke-width="52"/><rect x="318" y="118" width="46" height="98" rx="23"/><rect x="660" y="118" width="46" height="98" rx="23"/><circle cx="330" cy="470" r="34"/><circle cx="512" cy="470" r="34"/><circle cx="694" cy="470" r="34"/><circle cx="330" cy="600" r="34"/><circle cx="512" cy="600" r="34"/><circle cx="694" cy="600" r="34"/></svg></div>
  <div class="large">יום שני</div>
  <div class="navsub">9 בנובמבר 2026</div>
</div>
<div class="body">
  <div class="pinwrap"><div class="stack">
    <div class="card1">
      <div class="chead"><span class="dot"></span><span class="clbl">ממתין לתשובה</span><span class="cnt">1</span></div>
      <div class="ctxt">היום היו לך שני מבדקים ואימון. <b>יום כבד — צדקתי?</b></div>
      <div class="btns"><div class="cap no">לא ממש</div><div class="cap yes">כן, צדקת</div></div>
    </div>
    
  </div></div>
  <div class="feed">
    <div class="card2">
      <div class="h2"><span class="lbl">סגירת היום</span><span class="t">21:00</span></div>

      <div class="sub">נקלט היום</div>
      <div class="row"><span class="rt">10:41</span><span class="rb">יום מקוצר מחר<small>מקבוצת הכיתה</small></span></div>
      <div class="row"><span class="rt">19:55</span><span class="rb">להביא סרגל ומחוגה<small>נרשם למחר 08:00</small></span></div>

      <div class="sub sep">ממתין לך</div>
      <div class="row wait"><span class="wdot"></span><span class="rb">לבטל את האימון של רביעי<small>נשלח היום 14:30</small></span></div>
      <div class="row wait"><span class="wdot"></span><span class="rb">להפוך "מזיז אימון לפני מבחן" לכלל<small>נשלח אתמול</small></span></div>

      <div class="sub sep">מחר</div>
      <div class="row"><span class="rt">08:00</span><span class="rb">בית ספר<small>יום מקוצר — עד 12:40</small></span></div>
    </div>
  </div>
</div><div class="inputbar">
  <div class="field"><span>הודעה</span>
    <div class="send"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></div>
  </div>
</div><div class="home"></div></div></body></html>
```

---

## `design/mockups/s_close_dark.html`

```html
<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-font-smoothing:antialiased}
:root{
  --deep:#0A7A36;
  --deep2:#0E8C40;
  --live:#16A64B;
  --mint:#F0F8F3;
  --bg:#EDEFF2;
  --label:#0B1410;
  --label2:rgba(45,60,52,.62);
  --label3:rgba(45,60,52,.34);
  --sep:rgba(45,60,52,.14);
  --amber:#96650F;
  --amberbg:#FCF3E2;
}
/* real app: font-family: system-ui, -apple-system → SF Hebrew on iPhone.
   Assistant is a stand-in for this Linux-rendered mock only. */
body{font-family:'Assistant',system-ui,-apple-system,sans-serif;background:#fff;width:440px;height:956px;overflow:hidden}
.screen{width:440px;height:956px;display:flex;flex-direction:column;position:relative;
  background:linear-gradient(180deg,#EFF2F4 0%,#E4E9EB 100%)}
.screen::before{content:"";position:absolute;top:0;left:0;right:0;height:470px;z-index:0;pointer-events:none;
  background:radial-gradient(125% 62% at 50% 0%, rgba(14,140,64,.20), rgba(14,140,64,.06) 55%, rgba(14,140,64,0) 82%)}
.screen::after{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;opacity:.5;mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter><rect width='160' height='160' filter='url(%23n)' opacity='0.42'/></svg>")}

/* ---------- hero ---------- */
.hero{position:relative;z-index:2;color:#fff;padding-bottom:44px;
  background:linear-gradient(168deg,var(--deep2) 0%,var(--deep) 66%,#096B2F 100%);
  border-radius:0 0 34px 34px;
  box-shadow:0 10px 26px rgba(6,60,28,.30), 0 2px 6px rgba(6,60,28,.18)}
.hero::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:radial-gradient(85% 60% at 88% -8%, rgba(255,255,255,.26), rgba(255,255,255,0) 62%)}
.hero::after{content:"";position:absolute;left:0;right:0;bottom:0;height:52%;border-radius:inherit;pointer-events:none;
  background:linear-gradient(180deg, rgba(0,40,18,0) 0%, rgba(0,40,18,.16) 100%)}
.hero > *{position:relative;z-index:1}
.status{height:52px;display:flex;align-items:flex-end;justify-content:space-between;padding:0 30px 5px;font-size:15px;font-weight:600}
.sysic{display:flex;gap:6px;align-items:center}
.bars{display:flex;gap:2px;align-items:flex-end}
.bars i{width:3px;background:#fff;border-radius:1px;display:block}
.navtop{display:flex;align-items:center;gap:9px;height:28px;padding:0 24px}
.appmark{width:21px;height:21px;flex:none;opacity:.92}
.navname{font-size:14.5px;font-weight:600;opacity:.8;letter-spacing:.2px}
.large{font-size:33px;font-weight:700;letter-spacing:-.9px;line-height:1.08;padding:7px 24px 0}
.navsub{font-size:14.5px;opacity:.72;padding:2px 24px 0}

.body{position:relative;z-index:3;flex:1;min-height:0;display:flex;flex-direction:column}

/* ---------- level 1 · needs you ---------- */
.pinwrap{position:relative;z-index:50;padding:0 14px;margin-top:-30px}
.stack{display:flex;flex-direction:column}
.card1{position:relative;z-index:3;background:#fff;border-radius:24px;overflow:hidden;
       box-shadow:0 10px 24px rgba(8,52,30,.16), 0 2px 6px rgba(8,52,30,.08)}
.chead{display:flex;align-items:center;gap:8px;padding:13px 18px;background:var(--amberbg)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--amber);flex:none}
.clbl{font-size:13px;font-weight:700;color:var(--amber)}
.cnt{margin-inline-start:auto;font-size:12px;font-weight:700;color:#fff;background:var(--amber);border-radius:100px;padding:2px 10px}
.ctxt{font-size:17px;line-height:1.42;color:var(--label);padding:17px 18px 0}
.ctxt b{font-weight:700}
.btns{display:flex;gap:9px;padding:15px 18px 17px}
.cap{flex:1;text-align:center;padding:12px 0;border-radius:100px;font-size:16px;font-weight:700}
.yes{background:var(--deep);color:#fff;box-shadow:0 4px 10px rgba(10,122,54,.28)}
.no{background:#EFF1F3;color:var(--label2);font-weight:600}
.peek{background:#fff;border-radius:24px;height:26px;position:relative}
.p2{margin:-16px 12px 0;z-index:2;box-shadow:0 7px 14px rgba(8,52,30,.10)}
.p3{margin:-16px 26px 0;z-index:1;box-shadow:0 7px 14px rgba(8,52,30,.07);opacity:.9}
.more{text-align:center;font-size:13.5px;font-weight:700;color:var(--deep);padding:15px 0 0}

/* ---------- feed ---------- */
.feed{flex:1;overflow:hidden;padding:0 16px 10px;display:flex;flex-direction:column;justify-content:flex-end;gap:15px}

/* level 2 · today's picture */
.card2{background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 4px 12px rgba(8,52,30,.09)}
.h2{display:flex;align-items:center;gap:8px;padding:12px 18px;background:var(--mint)}
.h2 .lbl{font-size:13px;font-weight:700;color:var(--deep)}
.h2 .t{margin-inline-start:auto;font-size:12.5px;font-weight:600;color:rgba(10,122,54,.55);font-variant-numeric:tabular-nums}
.row{display:flex;align-items:baseline;gap:12px;padding:13px 18px;position:relative}
.row+.row::before{content:"";position:absolute;top:0;right:18px;left:18px;height:1px;background:var(--sep)}
.rt{font-size:15px;font-weight:700;color:var(--deep);min-width:46px;font-variant-numeric:tabular-nums}
.rb{font-size:17px;color:var(--label);line-height:1.3}
.rb small{display:block;font-size:13px;color:var(--label2);margin-top:2px}

/* level 3 · fyi */
.ghead{font-size:13px;color:var(--label2);padding:0 8px 7px;display:flex}
.ghead .t{margin-inline-start:auto;font-variant-numeric:tabular-nums}
.card3{background:#fff;border-radius:20px;box-shadow:0 2px 7px rgba(8,52,30,.06);padding:15px 18px;font-size:17px;line-height:1.4;color:var(--label)}
.old{color:var(--label3);text-decoration:line-through;font-variant-numeric:tabular-nums}
.new{color:var(--deep);font-weight:700;font-variant-numeric:tabular-nums}

/* me */
.me{align-self:flex-end;max-width:76%;background:linear-gradient(165deg,#1AB455,var(--live));color:#fff;
    border-radius:22px;padding:11px 17px;font-size:17px;line-height:1.3;box-shadow:0 4px 12px rgba(22,166,75,.26)}
.metime{align-self:flex-end;font-size:11.5px;color:var(--label3);margin:-11px 8px 0;direction:ltr}
.ack{align-self:flex-start;font-size:13px;color:var(--label2);margin-top:-8px}

/* input */
.inputbar{position:relative;z-index:3;padding:10px 16px 26px;display:flex;align-items:center;gap:10px;background:rgba(237,241,243,.9);backdrop-filter:saturate(180%) blur(20px)}
.field{flex:1;background:#fff;border-radius:100px;padding:7px 18px 7px 7px;font-size:17px;color:var(--label3);
  box-shadow:0 2px 7px rgba(8,52,30,.07);display:flex;align-items:center;gap:10px}
.field span{flex:1}
.send{width:32px;height:32px;border-radius:50%;background:var(--deep);flex:none;display:flex;align-items:center;justify-content:center}
.home{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:140px;height:5px;border-radius:3px;background:#0005}

.navtop{padding:0 24px;height:26px;display:flex;align-items:center}
.appmark{width:22px;height:22px;opacity:.9}
.sub{font-size:12.5px;font-weight:700;color:var(--label2);letter-spacing:.3px;padding:15px 18px 3px}
.sub.sep{border-top:1px solid var(--sep);margin-top:6px;padding-top:15px}
.row.wait{align-items:center;gap:11px}
.row.wait+.row.wait::before{display:none}
.wdot{width:8px;height:8px;border-radius:50%;background:var(--amber);flex:none;margin-inline-start:19px}
.row.wait .rb{font-size:16px}
.sub+.row::before{display:none}

:root{
  --deep:#0A5A2A; --deep2:#0C6B33; --live:#149042;
  --mint:#16291F; --label:#EEF4F0;
  --label2:rgba(226,240,232,.60); --label3:rgba(226,240,232,.32);
  --sep:rgba(226,240,232,.12);
  --amber:#D9A03C; --amberbg:#2A2211;
}
.screen{background:linear-gradient(180deg,#141A17 0%,#0D1210 100%)!important}
.screen::before{background:radial-gradient(125% 62% at 50% 0%, rgba(20,160,74,.20), rgba(20,160,74,.05) 55%, rgba(20,160,74,0) 82%)!important}
.screen::after{mix-blend-mode:screen!important;opacity:.28!important}
.hero{box-shadow:0 12px 30px rgba(0,0,0,.55)!important}
.hero::after{background:linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,.28) 100%)!important}
.card1{background:#1D2621!important;box-shadow:0 12px 28px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.4)!important}
.card2,.card3,.peek{background:#1B2420!important}
.card2{box-shadow:0 6px 16px rgba(0,0,0,.42)!important}
.card3{box-shadow:0 3px 10px rgba(0,0,0,.36)!important}
.peek{box-shadow:0 8px 16px rgba(0,0,0,.45)!important}
.h2 .t{color:rgba(120,220,160,.6)!important}
.h2 .lbl{color:#54CC85!important}
.rt,.new,.more{color:#54CC85!important}
.no{background:rgba(235,245,238,.10)!important;color:var(--label2)!important}
.yes{background:#12803A!important;box-shadow:0 4px 12px rgba(0,0,0,.4)!important}
.clbl,.wdot{color:var(--amber)}
.cnt{color:#1A1509!important}
.me{background:linear-gradient(165deg,#179A47,#12853C)!important;box-shadow:0 5px 14px rgba(0,0,0,.4)!important}
.inputbar{background:rgba(16,22,19,.9)!important}
.field{background:#1D2621!important;box-shadow:0 2px 8px rgba(0,0,0,.4)!important}
.send{background:#12803A!important}
.home{background:#ffffff55!important}
</style></head><body><div class="screen"><div class="hero">
  <div class="status"><span>21:00</span><span class="sysic">
  <span class="bars"><i style="height:5px"></i><i style="height:7px"></i><i style="height:9px"></i><i style="height:11px"></i></span>
  <svg width="16" height="12" viewBox="0 0 16 12" fill="#fff"><path d="M8 11.5 .8 4.2a10 10 0 0 1 14.4 0z"/></svg>
  <svg width="26" height="13" viewBox="0 0 26 13"><rect x="1" y="1" width="21" height="11" rx="4" fill="none" stroke="#fff" opacity=".5"/><rect x="2.8" y="2.8" width="17" height="7.4" rx="2.5" fill="#fff"/><path d="M23.5 4.5v4a2.2 2.2 0 0 0 0-4z" fill="#fff" opacity=".5"/></svg>
</span></div>
  <div class="navtop"><svg class="appmark" viewBox="0 0 1024 1024" fill="#fff"><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71z" opacity=".22"/><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71zm-45 141h650v-70c0-39-32-71-71-71H232c-39 0-71 32-71 71v70z" fill="none" stroke="#fff" stroke-width="52"/><rect x="318" y="118" width="46" height="98" rx="23"/><rect x="660" y="118" width="46" height="98" rx="23"/><circle cx="330" cy="470" r="34"/><circle cx="512" cy="470" r="34"/><circle cx="694" cy="470" r="34"/><circle cx="330" cy="600" r="34"/><circle cx="512" cy="600" r="34"/><circle cx="694" cy="600" r="34"/></svg></div>
  <div class="large">יום שני</div>
  <div class="navsub">9 בנובמבר 2026</div>
</div>
<div class="body">
  <div class="pinwrap"><div class="stack">
    <div class="card1">
      <div class="chead"><span class="dot"></span><span class="clbl">ממתין לתשובה</span><span class="cnt">1</span></div>
      <div class="ctxt">היום היו לך שני מבדקים ואימון. <b>יום כבד — צדקתי?</b></div>
      <div class="btns"><div class="cap no">לא ממש</div><div class="cap yes">כן, צדקת</div></div>
    </div>
    
  </div></div>
  <div class="feed">
    <div class="card2">
      <div class="h2"><span class="lbl">סגירת היום</span><span class="t">21:00</span></div>

      <div class="sub">נקלט היום</div>
      <div class="row"><span class="rt">10:41</span><span class="rb">יום מקוצר מחר<small>מקבוצת הכיתה</small></span></div>
      <div class="row"><span class="rt">19:55</span><span class="rb">להביא סרגל ומחוגה<small>נרשם למחר 08:00</small></span></div>

      <div class="sub sep">ממתין לך</div>
      <div class="row wait"><span class="wdot"></span><span class="rb">לבטל את האימון של רביעי<small>נשלח היום 14:30</small></span></div>
      <div class="row wait"><span class="wdot"></span><span class="rb">להפוך "מזיז אימון לפני מבחן" לכלל<small>נשלח אתמול</small></span></div>

      <div class="sub sep">מחר</div>
      <div class="row"><span class="rt">08:00</span><span class="rb">בית ספר<small>יום מקוצר — עד 12:40</small></span></div>
    </div>
  </div>
</div><div class="inputbar">
  <div class="field"><span>הודעה</span>
    <div class="send"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></div>
  </div>
</div><div class="home"></div></div></body></html>
```

---

## `design/mockups/states.html`

```html
<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-font-smoothing:antialiased}
:root{
  --deep:#0A7A36;
  --deep2:#0E8C40;
  --live:#16A64B;
  --mint:#F0F8F3;
  --bg:#EDEFF2;
  --label:#0B1410;
  --label2:rgba(45,60,52,.62);
  --label3:rgba(45,60,52,.34);
  --sep:rgba(45,60,52,.14);
  --amber:#96650F;
  --amberbg:#FCF3E2;
}
/* real app: font-family: system-ui, -apple-system → SF Hebrew on iPhone.
   Assistant is a stand-in for this Linux-rendered mock only. */
body{font-family:'Assistant',system-ui,-apple-system,sans-serif;background:#fff;width:440px;height:956px;overflow:hidden}
.screen{width:440px;height:956px;display:flex;flex-direction:column;position:relative;
  background:linear-gradient(180deg,#EFF2F4 0%,#E4E9EB 100%)}
.screen::before{content:"";position:absolute;top:0;left:0;right:0;height:470px;z-index:0;pointer-events:none;
  background:radial-gradient(125% 62% at 50% 0%, rgba(14,140,64,.20), rgba(14,140,64,.06) 55%, rgba(14,140,64,0) 82%)}
.screen::after{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;opacity:.5;mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter><rect width='160' height='160' filter='url(%23n)' opacity='0.42'/></svg>")}

/* ---------- hero ---------- */
.hero{position:relative;z-index:2;color:#fff;padding-bottom:44px;
  background:linear-gradient(168deg,var(--deep2) 0%,var(--deep) 66%,#096B2F 100%);
  border-radius:0 0 34px 34px;
  box-shadow:0 10px 26px rgba(6,60,28,.30), 0 2px 6px rgba(6,60,28,.18)}
.hero::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:radial-gradient(85% 60% at 88% -8%, rgba(255,255,255,.26), rgba(255,255,255,0) 62%)}
.hero::after{content:"";position:absolute;left:0;right:0;bottom:0;height:52%;border-radius:inherit;pointer-events:none;
  background:linear-gradient(180deg, rgba(0,40,18,0) 0%, rgba(0,40,18,.16) 100%)}
.hero > *{position:relative;z-index:1}
.status{height:52px;display:flex;align-items:flex-end;justify-content:space-between;padding:0 30px 5px;font-size:15px;font-weight:600}
.sysic{display:flex;gap:6px;align-items:center}
.bars{display:flex;gap:2px;align-items:flex-end}
.bars i{width:3px;background:#fff;border-radius:1px;display:block}
.navtop{display:flex;align-items:center;gap:9px;height:28px;padding:0 24px}
.appmark{width:21px;height:21px;flex:none;opacity:.92}
.navname{font-size:14.5px;font-weight:600;opacity:.8;letter-spacing:.2px}
.large{font-size:33px;font-weight:700;letter-spacing:-.9px;line-height:1.08;padding:7px 24px 0}
.navsub{font-size:14.5px;opacity:.72;padding:2px 24px 0}

.body{position:relative;z-index:3;flex:1;min-height:0;display:flex;flex-direction:column}

/* ---------- level 1 · needs you ---------- */
.pinwrap{position:relative;z-index:50;padding:0 14px;margin-top:-30px}
.stack{display:flex;flex-direction:column}
.card1{position:relative;z-index:3;background:#fff;border-radius:24px;overflow:hidden;
       box-shadow:0 10px 24px rgba(8,52,30,.16), 0 2px 6px rgba(8,52,30,.08)}
.chead{display:flex;align-items:center;gap:8px;padding:13px 18px;background:var(--amberbg)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--amber);flex:none}
.clbl{font-size:13px;font-weight:700;color:var(--amber)}
.cnt{margin-inline-start:auto;font-size:12px;font-weight:700;color:#fff;background:var(--amber);border-radius:100px;padding:2px 10px}
.ctxt{font-size:17px;line-height:1.42;color:var(--label);padding:17px 18px 0}
.ctxt b{font-weight:700}
.btns{display:flex;gap:9px;padding:15px 18px 17px}
.cap{flex:1;text-align:center;padding:12px 0;border-radius:100px;font-size:16px;font-weight:700}
.yes{background:var(--deep);color:#fff;box-shadow:0 4px 10px rgba(10,122,54,.28)}
.no{background:#EFF1F3;color:var(--label2);font-weight:600}
.peek{background:#fff;border-radius:24px;height:26px;position:relative}
.p2{margin:-16px 12px 0;z-index:2;box-shadow:0 7px 14px rgba(8,52,30,.10)}
.p3{margin:-16px 26px 0;z-index:1;box-shadow:0 7px 14px rgba(8,52,30,.07);opacity:.9}
.more{text-align:center;font-size:13.5px;font-weight:700;color:var(--deep);padding:15px 0 0}

/* ---------- feed ---------- */
.feed{flex:1;overflow:hidden;padding:0 16px 10px;display:flex;flex-direction:column;justify-content:flex-end;gap:15px}

/* level 2 · today's picture */
.card2{background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 4px 12px rgba(8,52,30,.09)}
.h2{display:flex;align-items:center;gap:8px;padding:12px 18px;background:var(--mint)}
.h2 .lbl{font-size:13px;font-weight:700;color:var(--deep)}
.h2 .t{margin-inline-start:auto;font-size:12.5px;font-weight:600;color:rgba(10,122,54,.55);font-variant-numeric:tabular-nums}
.row{display:flex;align-items:baseline;gap:12px;padding:13px 18px;position:relative}
.row+.row::before{content:"";position:absolute;top:0;right:18px;left:18px;height:1px;background:var(--sep)}
.rt{font-size:15px;font-weight:700;color:var(--deep);min-width:46px;font-variant-numeric:tabular-nums}
.rb{font-size:17px;color:var(--label);line-height:1.3}
.rb small{display:block;font-size:13px;color:var(--label2);margin-top:2px}

/* level 3 · fyi */
.ghead{font-size:13px;color:var(--label2);padding:0 8px 7px;display:flex}
.ghead .t{margin-inline-start:auto;font-variant-numeric:tabular-nums}
.card3{background:#fff;border-radius:20px;box-shadow:0 2px 7px rgba(8,52,30,.06);padding:15px 18px;font-size:17px;line-height:1.4;color:var(--label)}
.old{color:var(--label3);text-decoration:line-through;font-variant-numeric:tabular-nums}
.new{color:var(--deep);font-weight:700;font-variant-numeric:tabular-nums}

/* me */
.me{align-self:flex-end;max-width:76%;background:linear-gradient(165deg,#1AB455,var(--live));color:#fff;
    border-radius:22px;padding:11px 17px;font-size:17px;line-height:1.3;box-shadow:0 4px 12px rgba(22,166,75,.26)}
.metime{align-self:flex-end;font-size:11.5px;color:var(--label3);margin:-11px 8px 0;direction:ltr}
.ack{align-self:flex-start;font-size:13px;color:var(--label2);margin-top:-8px}

/* input */
.inputbar{position:relative;z-index:3;padding:10px 16px 26px;display:flex;align-items:center;gap:10px;background:rgba(237,241,243,.9);backdrop-filter:saturate(180%) blur(20px)}
.field{flex:1;background:#fff;border-radius:100px;padding:7px 18px 7px 7px;font-size:17px;color:var(--label3);
  box-shadow:0 2px 7px rgba(8,52,30,.07);display:flex;align-items:center;gap:10px}
.field span{flex:1}
.send{width:32px;height:32px;border-radius:50%;background:var(--deep);flex:none;display:flex;align-items:center;justify-content:center}
.home{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:140px;height:5px;border-radius:3px;background:#0005}

.navtop{padding:0 24px;height:26px;display:flex;align-items:center}
.appmark{width:22px;height:22px;opacity:.9}
.sub{font-size:12.5px;font-weight:700;color:var(--label2);letter-spacing:.3px;padding:15px 18px 3px}
.sub.sep{border-top:1px solid var(--sep);margin-top:6px;padding-top:15px}
.row.wait{align-items:center;gap:11px}
.row.wait+.row.wait::before{display:none}
.wdot{width:8px;height:8px;border-radius:50%;background:var(--amber);flex:none;margin-inline-start:19px}
.row.wait .rb{font-size:16px}
.sub+.row::before{display:none}

.navtop{padding:0 24px;height:26px;display:flex;align-items:center}
.appmark{width:22px;height:22px;opacity:.9}
/* stale strip */
.stale{position:relative;z-index:40;margin:-18px 16px 0;background:var(--amberbg);border:1px solid rgba(150,101,15,.22);
  border-radius:16px;padding:11px 14px;display:flex;align-items:center;gap:10px;box-shadow:0 6px 16px rgba(8,52,30,.10)}
.stale svg{flex:none}
.stale .st{font-size:14.5px;color:#6E4A0B;line-height:1.35}
.stale .st b{font-weight:700}
.stale .act{margin-inline-start:auto;font-size:14.5px;font-weight:700;color:var(--amber);flex:none}
/* photo card */
.photo{display:block;width:100%;height:210px}
.pcap{padding:12px 16px;font-size:14.5px;color:var(--label2);display:flex;align-items:center;gap:7px}
.pcap b{color:var(--label);font-weight:600}
/* expanded stack */
.exhead{display:flex;align-items:center;gap:8px;padding:0 6px 9px}
.exlbl{font-size:13px;font-weight:700;color:var(--amber)}
.excnt{margin-inline-start:auto;font-size:13px;font-weight:700;color:var(--amber)}
.mini{background:#fff;border-radius:18px;padding:14px 16px;display:flex;align-items:center;gap:11px;
  box-shadow:0 3px 10px rgba(8,52,30,.09);margin-top:9px}
.mini .d{width:7px;height:7px;border-radius:50%;background:var(--amber);flex:none}
.mini .t{font-size:16px;color:var(--label);line-height:1.3}
.mini .t small{display:block;font-size:12.5px;color:var(--label2);margin-top:2px}
.mini .ch{margin-inline-start:auto;color:var(--label3);font-size:20px;flex:none}
.close{text-align:center;font-size:13.5px;font-weight:700;color:var(--label2);padding:16px 0 0}
/* empty state */
.empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 40px;text-align:center}
.emark{width:64px;height:64px;opacity:.22;margin-bottom:20px}
.etitle{font-size:22px;font-weight:700;color:var(--label);line-height:1.3}
.etext{font-size:16px;color:var(--label2);line-height:1.55;margin-top:10px}
.ecard{background:#fff;border-radius:20px;box-shadow:0 4px 12px rgba(8,52,30,.09);margin-top:26px;width:100%;overflow:hidden}
.erow{display:flex;align-items:baseline;gap:12px;padding:13px 18px;text-align:right;position:relative}
.erow+.erow::before{content:"";position:absolute;top:0;right:18px;left:18px;height:1px;background:var(--sep)}
.erow .rt{font-size:15px;font-weight:700;color:var(--deep);min-width:46px}
.erow .rb{font-size:16px;color:var(--label)}

body{background:#D9DCE1;width:1900px;display:flex;gap:20px;padding:26px 20px;align-items:flex-start;height:auto;overflow:visible}
.wrap{width:440px}
.vcap{padding:0 4px 11px;font-size:14px;color:#3a3a40;line-height:1.45;height:58px}
.vcap b{display:block;font-size:18px;font-weight:700;color:#141416}
.vcap span{color:#5c5c63}
.phone{width:440px;height:956px;border-radius:44px;overflow:hidden;position:relative;box-shadow:0 12px 30px rgba(0,0,0,.16)}
</style></head><body><div class="wrap"><div class="vcap"><b>שתיקה</b><span>המערכת לא עודכנה — הפס מופיע רק כשיש בעיה</span></div><div class="phone"><div class="screen"><div class="hero">
  <div class="status"><span>9:41</span><span class="sysic">
    <span class="bars"><i style="height:5px"></i><i style="height:7px"></i><i style="height:9px"></i><i style="height:11px"></i></span>
    <svg width="16" height="12" viewBox="0 0 16 12" fill="#fff"><path d="M8 11.5 .8 4.2a10 10 0 0 1 14.4 0z"/></svg>
    <svg width="26" height="13" viewBox="0 0 26 13"><rect x="1" y="1" width="21" height="11" rx="4" fill="none" stroke="#fff" opacity=".5"/><rect x="2.8" y="2.8" width="17" height="7.4" rx="2.5" fill="#fff"/><path d="M23.5 4.5v4a2.2 2.2 0 0 0 0-4z" fill="#fff" opacity=".5"/></svg>
  </span></div>
  <div class="navtop"><svg class="appmark" viewBox="0 0 1024 1024" fill="#fff"><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71z" opacity=".22"/><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71zm-45 141h650v-70c0-39-32-71-71-71H232c-39 0-71 32-71 71v70z" fill="none" stroke="#fff" stroke-width="52"/><rect x="318" y="118" width="46" height="98" rx="23"/><rect x="660" y="118" width="46" height="98" rx="23"/><circle cx="330" cy="470" r="34"/><circle cx="512" cy="470" r="34"/><circle cx="694" cy="470" r="34"/><circle cx="330" cy="600" r="34"/><circle cx="512" cy="600" r="34"/><circle cx="694" cy="600" r="34"/></svg></div>
  <div class="large">יום שני</div>
  <div class="navsub">9 בנובמבר 2026</div>
</div>
<div class="body">
<div class="stale">
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#96650F" stroke-width="2.1" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>
  <span class="st">לא הגיע ממני כלום כבר <b>31 שעות</b></span>
  <span class="act">רענן</span>
</div>
<div class="feed">
  <div class="card2">
    <div class="h2"><span class="lbl">בריף הבוקר</span><span class="t">אתמול 07:30</span></div>
    <div class="row"><span class="rt">08:00</span><span class="rb">בית ספר<small>עד 15:45</small></span></div>
    <div class="row"><span class="rt">18:30</span><span class="rb">אימון 4fitness<small>עד 20:00</small></span></div>
  </div>
  <div class="me">להביא סרגל ומחוגה</div>
  <div class="metime">אתמול 09:12</div>
  <div class="ack">נרשם</div>
</div></div><div class="inputbar"><div class="field"><span>הודעה</span>
  <div class="send"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></div>
</div></div><div class="home"></div></div></div></div><div class="wrap"><div class="vcap"><b>תמונה</b><span>רבע מהקלט: צילום בלי מילה אחת</span></div><div class="phone"><div class="screen"><div class="hero">
  <div class="status"><span>11:23</span><span class="sysic">
    <span class="bars"><i style="height:5px"></i><i style="height:7px"></i><i style="height:9px"></i><i style="height:11px"></i></span>
    <svg width="16" height="12" viewBox="0 0 16 12" fill="#fff"><path d="M8 11.5 .8 4.2a10 10 0 0 1 14.4 0z"/></svg>
    <svg width="26" height="13" viewBox="0 0 26 13"><rect x="1" y="1" width="21" height="11" rx="4" fill="none" stroke="#fff" opacity=".5"/><rect x="2.8" y="2.8" width="17" height="7.4" rx="2.5" fill="#fff"/><path d="M23.5 4.5v4a2.2 2.2 0 0 0 0-4z" fill="#fff" opacity=".5"/></svg>
  </span></div>
  <div class="navtop"><svg class="appmark" viewBox="0 0 1024 1024" fill="#fff"><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71z" opacity=".22"/><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71zm-45 141h650v-70c0-39-32-71-71-71H232c-39 0-71 32-71 71v70z" fill="none" stroke="#fff" stroke-width="52"/><rect x="318" y="118" width="46" height="98" rx="23"/><rect x="660" y="118" width="46" height="98" rx="23"/><circle cx="330" cy="470" r="34"/><circle cx="512" cy="470" r="34"/><circle cx="694" cy="470" r="34"/><circle cx="330" cy="600" r="34"/><circle cx="512" cy="600" r="34"/><circle cx="694" cy="600" r="34"/></svg></div>
  <div class="large">יום שני</div>
  <div class="navsub">9 בנובמבר 2026</div>
</div>
<div class="body">
<div class="feed">
  <div class="card2">
    <div class="h2"><span class="lbl">בריף הבוקר</span><span class="t">07:30</span></div>
    <div class="row"><span class="rt">10:05</span><span class="rb">מבדק במתמטיקה<small>שיעור שלישי</small></span></div>
  </div>
  <div>
    <div class="ghead">נקלט מקבוצת מדעים<span class="t">11:20</span></div>
    <div class="card2">
      <svg class="photo" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice">
<rect width="400" height="260" fill="#2C3A33"/><rect x="14" y="14" width="372" height="232" rx="6" fill="#1D2A24"/>
<g stroke="#E8EFE9" stroke-width="3.4" stroke-linecap="round" opacity=".88">
<path d="M40 58h150M40 78h96M40 98h178M40 130h120M40 150h200M40 170h80"/>
</g>
<g stroke="#8FD3A6" stroke-width="3.4" stroke-linecap="round" opacity=".9"><path d="M230 128h110M230 148h72"/></g>
<rect x="250" y="186" width="106" height="30" rx="5" fill="none" stroke="#E7C978" stroke-width="3.2"/>
<g stroke="#E7C978" stroke-width="3.2" stroke-linecap="round"><path d="M262 201h80"/></g>
</svg>
      <div class="pcap">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="8.5" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 3-2 4 4"/></svg>
        <span>תמונה בלי טקסט · <b>לא נקראה</b></span>
      </div>
    </div>
  </div>
  <div class="me">מה זה?</div>
  <div class="metime">11:23</div>
</div></div><div class="inputbar"><div class="field"><span>הודעה</span>
  <div class="send"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></div>
</div></div><div class="home"></div></div></div></div><div class="wrap"><div class="vcap"><b>ערימה פתוחה</b><span>אחרי לחיצה על „עוד 3 ממתינים”</span></div><div class="phone"><div class="screen"><div class="hero">
  <div class="status"><span>21:04</span><span class="sysic">
    <span class="bars"><i style="height:5px"></i><i style="height:7px"></i><i style="height:9px"></i><i style="height:11px"></i></span>
    <svg width="16" height="12" viewBox="0 0 16 12" fill="#fff"><path d="M8 11.5 .8 4.2a10 10 0 0 1 14.4 0z"/></svg>
    <svg width="26" height="13" viewBox="0 0 26 13"><rect x="1" y="1" width="21" height="11" rx="4" fill="none" stroke="#fff" opacity=".5"/><rect x="2.8" y="2.8" width="17" height="7.4" rx="2.5" fill="#fff"/><path d="M23.5 4.5v4a2.2 2.2 0 0 0 0-4z" fill="#fff" opacity=".5"/></svg>
  </span></div>
  <div class="navtop"><svg class="appmark" viewBox="0 0 1024 1024" fill="#fff"><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71z" opacity=".22"/><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71zm-45 141h650v-70c0-39-32-71-71-71H232c-39 0-71 32-71 71v70z" fill="none" stroke="#fff" stroke-width="52"/><rect x="318" y="118" width="46" height="98" rx="23"/><rect x="660" y="118" width="46" height="98" rx="23"/><circle cx="330" cy="470" r="34"/><circle cx="512" cy="470" r="34"/><circle cx="694" cy="470" r="34"/><circle cx="330" cy="600" r="34"/><circle cx="512" cy="600" r="34"/><circle cx="694" cy="600" r="34"/></svg></div>
  <div class="large">יום שני</div>
  <div class="navsub">9 בנובמבר 2026</div>
</div>
<div class="body">
<div class="pinwrap" style="margin-top:14px">
  <div class="exhead"><span class="dot"></span><span class="exlbl">ממתין לתשובה</span><span class="excnt">4</span></div>
  <div class="card1">
    <div class="ctxt" style="padding-top:18px">האימון של היום מתנגש עם המבדק במתמטיקה מחר. <b>לבטל את האימון?</b></div>
    <div class="btns"><div class="cap no">לא</div><div class="cap yes">כן, בטל</div></div>
  </div>
  <div class="mini"><span class="d"></span><span class="t">להפוך "מזיז אימון לפני מבחן" לכלל<small>נשלח אתמול 21:00</small></span><span class="ch">‹</span></div>
  <div class="mini"><span class="d"></span><span class="t">לשבץ למידה למבדק ב-16:30<small>מחוץ לשעות שהגדרת</small></span><span class="ch">‹</span></div>
  <div class="mini"><span class="d"></span><span class="t">"המבחן יתקיים ב-17:12" — שעה או תאריך?<small>החילוץ לא ודאי</small></span><span class="ch">‹</span></div>
  <div class="close">סגור</div>
</div>
<div class="feed"></div></div><div class="inputbar"><div class="field"><span>הודעה</span>
  <div class="send"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></div>
</div></div><div class="home"></div></div></div></div><div class="wrap"><div class="vcap"><b>יום ראשון</b><span>אין היסטוריה, אין מה להציג</span></div><div class="phone"><div class="screen"><div class="hero">
  <div class="status"><span>20:12</span><span class="sysic">
    <span class="bars"><i style="height:5px"></i><i style="height:7px"></i><i style="height:9px"></i><i style="height:11px"></i></span>
    <svg width="16" height="12" viewBox="0 0 16 12" fill="#fff"><path d="M8 11.5 .8 4.2a10 10 0 0 1 14.4 0z"/></svg>
    <svg width="26" height="13" viewBox="0 0 26 13"><rect x="1" y="1" width="21" height="11" rx="4" fill="none" stroke="#fff" opacity=".5"/><rect x="2.8" y="2.8" width="17" height="7.4" rx="2.5" fill="#fff"/><path d="M23.5 4.5v4a2.2 2.2 0 0 0 0-4z" fill="#fff" opacity=".5"/></svg>
  </span></div>
  <div class="navtop"><svg class="appmark" viewBox="0 0 1024 1024" fill="#fff"><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71z" opacity=".22"/><path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71zm-45 141h650v-70c0-39-32-71-71-71H232c-39 0-71 32-71 71v70z" fill="none" stroke="#fff" stroke-width="52"/><rect x="318" y="118" width="46" height="98" rx="23"/><rect x="660" y="118" width="46" height="98" rx="23"/><circle cx="330" cy="470" r="34"/><circle cx="512" cy="470" r="34"/><circle cx="694" cy="470" r="34"/><circle cx="330" cy="600" r="34"/><circle cx="512" cy="600" r="34"/><circle cx="694" cy="600" r="34"/></svg></div>
  <div class="large">יום ראשון</div>
  <div class="navsub">8 בנובמבר 2026</div>
</div>
<div class="body">
<div class="empty">
  <svg class="emark" viewBox="0 0 1024 1024" fill="#0A7A36">
    <path d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71z" opacity=".25"/>
    <rect x="318" y="118" width="46" height="98" rx="23"/><rect x="660" y="118" width="46" height="98" rx="23"/>
    <circle cx="330" cy="470" r="34"/><circle cx="512" cy="470" r="34"/><circle cx="694" cy="470" r="34"/>
    <circle cx="330" cy="600" r="34"/><circle cx="512" cy="600" r="34"/><circle cx="694" cy="600" r="34"/>
  </svg>
  <div class="etitle">עוד אין כלום כאן</div>
  <div class="etext">שלח לי משהו, או שתף הודעה מווטסאפ — ואני אתחיל לעבוד.</div>
  <div class="ecard">
    <div class="erow"><span class="rt">07:30</span><span class="rb">הבריף הראשון מחר בבוקר</span></div>
    <div class="erow"><span class="rt">21:00</span><span class="rb">הסגירה הראשונה מחר בערב</span></div>
  </div>
</div></div><div class="inputbar"><div class="field"><span>הודעה</span>
  <div class="send"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></div>
</div></div><div class="home"></div></div></div></div></body></html>
```

---

## `design/mockups/home.html`

```html
<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-font-smoothing:antialiased}
body{font-family:'Assistant',system-ui,sans-serif;width:440px;height:956px;overflow:hidden}
.screen{width:440px;height:956px;position:relative;display:flex;flex-direction:column;
  background:linear-gradient(165deg,#1B2E3F 0%,#26404E 38%,#3E5A55 72%,#5A6B4E 100%)}
.screen::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.35;mix-blend-mode:overlay;
 background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/></filter><rect width='200' height='200' filter='url(%23n)' opacity='0.5'/></svg>")}
.status{height:54px;display:flex;align-items:flex-end;justify-content:space-between;padding:0 32px 5px;color:#fff;font-size:15px;font-weight:600;position:relative;z-index:2}
.sysic{display:flex;gap:6px;align-items:center}
.bars{display:flex;gap:2px;align-items:flex-end}
.bars i{width:3px;background:#fff;border-radius:1px;display:block}
.clock{text-align:center;color:#fff;padding:26px 0 6px;position:relative;z-index:2}
.clock .d{font-size:19px;font-weight:600;opacity:.92;letter-spacing:.2px}
.clock .t{font-size:74px;font-weight:600;line-height:1.02;letter-spacing:-1.5px;margin-top:2px}
.grid{position:relative;z-index:2;padding:30px 26px 0;display:grid;grid-template-columns:repeat(4,1fr);gap:26px 20px;flex:1;align-content:start}
.app{display:flex;flex-direction:column;align-items:center;gap:7px}
.ic{width:66px;height:66px;border-radius:22.4%;overflow:hidden;position:relative;box-shadow:0 3px 8px rgba(0,0,0,.28)}
.ic svg{display:block;width:100%;height:100%}
.nm{font-size:12.5px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.5);font-weight:500}
.badge{position:absolute;top:-5px;left:-5px;min-width:26px;height:26px;border-radius:13px;background:#FF3B30;
  color:#fff;font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center;padding:0 7px;
  box-shadow:0 1px 4px rgba(0,0,0,.35);z-index:5}
.dock{position:relative;z-index:2;margin:0 14px 30px;padding:16px 18px;border-radius:34px;
  background:rgba(255,255,255,.18);backdrop-filter:blur(26px) saturate(160%);display:grid;grid-template-columns:repeat(4,1fr);gap:20px;justify-items:center}
.home{position:absolute;bottom:9px;left:50%;transform:translateX(-50%);width:140px;height:5px;border-radius:3px;background:#ffffffcc;z-index:3}
</style></head><body><div class="screen">
<div class="status"><span>9:41</span><span class="sysic">
 <span class="bars"><i style="height:5px"></i><i style="height:7px"></i><i style="height:9px"></i><i style="height:11px"></i></span>
 <svg width="16" height="12" viewBox="0 0 16 12" fill="#fff"><path d="M8 11.5 .8 4.2a10 10 0 0 1 14.4 0z"/></svg>
 <svg width="26" height="13" viewBox="0 0 26 13"><rect x="1" y="1" width="21" height="11" rx="4" fill="none" stroke="#fff" opacity=".6"/><rect x="2.8" y="2.8" width="17" height="7.4" rx="2.5" fill="#fff"/><path d="M23.5 4.5v4a2.2 2.2 0 0 0 0-4z" fill="#fff" opacity=".6"/></svg>
</span></div>
<div class="clock"><div class="d">יום שני, 9 בנובמבר</div><div class="t">9:41</div></div>
<div class="grid" id="g"></div>
<div class="dock" id="d"></div>
<div class="home"></div>
</div>
<script>
const OUR = `<svg viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#0A7A36"/>
<path fill="#FFF" d="M232 176h560c39 0 71 32 71 71v450c0 39-32 71-71 71H398l-118 104c-14 12-36 2-36-17v-87h-12c-39 0-71-32-71-71V247c0-39 32-71 71-71z"/>
<path fill="#16A64B" d="M232 176h560c39 0 71 32 71 71v70H161v-70c0-39 32-71 71-71z"/>
<rect x="318" y="118" width="46" height="98" rx="23" fill="#FFF"/><rect x="660" y="118" width="46" height="98" rx="23" fill="#FFF"/>
<g fill="#16A64B"><circle cx="330" cy="430" r="30"/><circle cx="512" cy="430" r="30"/><circle cx="694" cy="430" r="30"/>
<circle cx="330" cy="570" r="30"/><circle cx="512" cy="570" r="30"/><circle cx="694" cy="570" r="30"/></g></svg>`;
function blank(a,b,shape){return `<svg viewBox="0 0 100 100"><defs><linearGradient id="x${a.slice(1)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="100" fill="url(#x${a.slice(1)})"/>${shape}</svg>`;}
const W='rgba(255,255,255,.82)';
const shapes=[
 `<circle cx="50" cy="50" r="19" fill="${W}"/>`,
 `<rect x="30" y="30" width="40" height="40" rx="10" fill="${W}"/>`,
 `<path d="M50 28l20 36H30z" fill="${W}"/>`,
 `<rect x="28" y="44" width="44" height="12" rx="6" fill="${W}"/><rect x="44" y="28" width="12" height="44" rx="6" fill="${W}"/>`,
 `<circle cx="40" cy="50" r="12" fill="${W}"/><circle cx="62" cy="50" r="12" fill="${W}" opacity=".6"/>`,
 `<path d="M30 62c8-24 32-24 40 0z" fill="${W}"/>`,
 `<rect x="30" y="32" width="40" height="8" rx="4" fill="${W}"/><rect x="30" y="46" width="28" height="8" rx="4" fill="${W}"/><rect x="30" y="60" width="34" height="8" rx="4" fill="${W}"/>`,
 `<circle cx="50" cy="50" r="20" fill="none" stroke="${W}" stroke-width="8"/>`,
];
const pal=[['#6E7AE8','#4B56C4'],['#E8746E','#C4504B'],['#4FB0C6','#3387A0'],['#E0A83C','#BE8420'],
 ['#8A6FC9','#6650A8'],['#5FBE86','#3E9865'],['#D77FB0','#B05A8C'],['#7A8794','#586472'],
 ['#C98A4B','#A56A32'],['#5B9BD5','#3E7AB0'],['#9CBE5F','#7C9C44']];
const g=document.getElementById('g'); let k=0;
function app(html,name,badge){return `<div class="app"><div class="ic">${badge?`<span class="badge">${badge}</span>`:''}${html}</div><div class="nm">${name}</div></div>`;}
let out='';
for(let i=0;i<4;i++){out+=app(blank(pal[k][0],pal[k][1],shapes[k%8]),'',0);k++;}
out+=app(OUR,'היומן',3);
for(let i=0;i<7;i++){out+=app(blank(pal[k][0],pal[k][1],shapes[k%8]),'',0);k++;}
g.innerHTML=out;
let dk='';for(let i=0;i<4;i++){dk+=app(blank(pal[(i+2)%pal.length][0],pal[(i+2)%pal.length][1],shapes[(i+3)%8]),'',0);}
document.getElementById('d').innerHTML=dk;
</script></body></html>
```

---
