---
name: life-calendar-system
description: Build decisions and constraints for Yuval's autonomous life-management/calendar system (this Project's copy)
sources: [cowork]
aliases: ["מערכת יומן"]
---
- [stated] Has a full approved spec for the system, stored as the project doc "אפיון"
- [stated] Chose to build it as a standalone app that always runs, without needing his computer to be on
- [stated] Not willing to pay for third-party software platforms for this system
- [stated] Has a Claude Pro subscription; going with Claude via the Pro subscription (not API) as the system's "brain", open to lower Claude models to save quota
- [stated] Has a free (Hobby) Vercel account; chose Vercel as the platform the system runs on
- [stated] Chapter 3 (blocks + permissions): decided to settle permissions first and leave the code/Claude split of the six blocks for last
- [stated] Decided to split "write event to calendar" into two separate actions: recording an event from an external source vs. scheduling something the system decided on itself
- [stated] Plans to export his class WhatsApp group archive so patterns of real cancellation/exam-move/room-change messages can be derived from it, answering clarifying questions about it afterwards
- [stated] Uses an iPhone 16 Pro Max (iOS 26)
- [stated] Prefers the system's interface to be an app he builds himself on his phone, rather than Telegram
- [stated] Runs the build as several parallel conversations with one routing/manager conversation that decides and hands out prompts; wants worker conversations to produce a full best-guess draft for him to review and correct, instead of interviewing him with questions first
- [stated] Fine with the system using very little AI and doing the vast majority in code, for stability
- [stated] Wants the system connected to a platform that shows whether he actually trained, but does not want a third-party service in between
- [stated] Wants the system to need as few taps/actions from him as possible; doesn't mind many steps behind the scenes, as long as they stay efficient and simple
- [stated] Wants a monthly calendar screen in the app (a square per day) showing the exam schedule with a different color per subject
- [stated] Prefers Gemini (free tier, no payment details) as the system's runtime model if it passes the tests, over Claude; Gemini is a candidate in the chapter-7 gate to be tested on Hebrew quality, quotas and no-card signup; asked to also try to keep Gemini from taking his data
- [stated] Chapter 7: going with Agent SDK for Claude, no written inquiry to Anthropic
- [stated] Works on three things: a business "ריצה-בזמן-מלחמה", a business "מערכות CRM דפי נחיתה", and this calendar system itself
- [stated] The system does not manage his businesses; it only needs to know which business an event/focus time belongs to, so it can place it in the calendar
- [stated] Going with a free vercel.app address and the display name "מערכת יומן" (not a paid custom domain)
- [stated] Iron rule for this project: nothing is managed from his computer, and no secret/key is stored on his computer
- [stated] Event/focus tagging lists three buttons (the two businesses and the calendar system itself) plus "other"
- [stated] Code will be built in Claude Code cloud sessions (Desktop app, Cloud mode, Plan mode), not local; one GitHub repo per project (this one: Yoman-System), rather than one repo with folders per project
- [stated] From 2026-10-05 the whole work process moves out of Cowork/this claude.ai Project into the GitHub repo and Claude Code; the Yoman-System repo is private and becomes the source of truth, holding the project docs and a CLAUDE.md with the project instructions
FINAL WRITE
