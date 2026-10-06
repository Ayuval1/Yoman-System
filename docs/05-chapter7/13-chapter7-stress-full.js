export const meta = {
  name: 'chapter7-prebuild-research',
  description: 'Verified research + adversarial stress-test of the chapter-7 plan before any code is written',
  whenToUse: 'Pre-build research and plan review for the calendar system',
  phases: [
    { title: 'Research', detail: 'one researcher per topic, primary sources only' },
    { title: 'Verify', detail: 'a skeptic re-checks every finding against the source and tries to refute it' },
    { title: 'Stress-test', detail: 'four lenses try to break the chapter-7 plan using verified findings' },
    { title: 'Critic', detail: 'what is still missing' },
    { title: 'Synthesis', detail: 'Hebrew report, every claim with source or marked unverified' },
  ],
}

const TODAY = '2026-10-04'

const RULES = `
Hard rules (the project forbids guessing):
- Today is ${TODAY}. Prefer PRIMARY sources (official docs, specs, vendor pricing/limits pages, source repos, official policy pages). Blogs/community posts are allowed only if labeled as such.
- Every finding needs: a URL you actually opened, a short EXACT quote from it, and the page date if shown. Never invent a quote, number, limit or price. If you cannot open a source, list it under couldNotAccess instead of stating the claim.
- If WebFetch/WebSearch is blocked for a domain, do NOT use curl/wget/python to fetch it. Report it as inaccessible.
- Limits, prices, quotas and terms change: always check the CURRENT page, and note anything that looks older than 12 months.
- If you cannot confirm something, put it in "unknowns". "I could not confirm this" is a valid and valuable answer.
- Context: Yuval (Hebrew speaker, iPhone 16 Pro Max, iOS 26) builds a personal calendar/task system: a PWA (home-screen web app) as the only channel, Vercel Hobby (free) + Neon Postgres + GitHub, zero budget, Claude called from inside a Vercel Sandbox via his Claude Pro subscription token (not API), Google Calendar integration, Garmin Connect data, an iOS Shortcut that sends WhatsApp text/images to the server. Output language for findings: English is fine (quotes stay in original language).`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          claim: { type: 'string' },
          sourceUrl: { type: 'string' },
          sourceQuote: { type: 'string' },
          sourceDate: { type: 'string' },
          sourceType: { type: 'string', enum: ['official', 'vendor-blog', 'source-code', 'community', 'news', 'other'] },
          affects: { type: 'string' },
        },
        required: ['id', 'claim', 'sourceUrl', 'sourceQuote', 'sourceType', 'affects'],
      },
    },
    unknowns: { type: 'array', items: { type: 'string' } },
    couldNotAccess: { type: 'array', items: { type: 'string' } },
  },
  required: ['topic', 'findings', 'unknowns', 'couldNotAccess'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'contradicted', 'outdated', 'unverifiable', 'overstated'] },
          evidence: { type: 'string' },
          evidenceUrl: { type: 'string' },
          correctedClaim: { type: 'string' },
        },
        required: ['id', 'verdict', 'evidence'],
      },
    },
    missedByResearcher: { type: 'array', items: { type: 'string' } },
  },
  required: ['topic', 'verdicts', 'missedByResearcher'],
}

const TOPICS = [
  {
    key: 'pwa-ios-push',
    title: 'PWA on iOS 26: web push, badge, icon, service worker',
    questions: `1) Current iOS/Safari rules for web push in home-screen PWAs (iOS 26): permission flow, requirements, VAPID, Declarative Web Push vs classic service-worker push, whether showNotification is mandatory in the classic path and what happens if a push shows no notification (silent-push restrictions). 2) Badging API behavior in PWAs: can the badge be set from a push handler; persistence; reset. 3) Home-screen icon: apple-touch-icon handling, caching, iOS 26 dark/tinted icon behavior for PWAs. 4) manifest/display standalone quirks, RTL/Hebrew, safe areas, service worker lifetime/eviction on iOS. 5) Known reliability problems of iOS web push in production (delivery delay, silent failure, subscription expiry). 6) Whether a PWA can have a home-screen widget (and what third-party options exist: Scriptable iOS 26 support, Widget Web 26 free tier). Cover each point with sources.`,
  },
  {
    key: 'sandbox-subscription',
    title: 'Claude Agent SDK inside Vercel Sandbox with a Claude subscription token',
    questions: `1) How the Claude Agent SDK / Claude Code authenticates with a subscription (setup-token, CLAUDE_CODE_OAUTH_TOKEN or similar): what is officially documented, token lifetime, headless use. 2) Anthropic's CURRENT terms/policy on using a Pro/Max subscription via the Agent SDK in automated/server contexts, and on using it on behalf of others; any enforcement notices; the status of the June 2026 policy change that was reported as paused. 3) Vercel Sandbox: availability on Hobby, limits (runtime, concurrency, CPU/memory, monthly usage caps, pricing beyond free), network egress controls/credential brokering, snapshots, startup latency. 4) Whether rate_limit information is exposed to SDK consumers (SDKRateLimitEvent or equivalent) and its fields. 5) Alternatives if blocked (Gemini free tier terms about using content for training, quotas, Hebrew quality). Be explicit about what is documented vs inferred.`,
  },
  {
    key: 'vercel-scheduling',
    title: 'Vercel Hobby: Workflow, Cron, Functions, Blob limits',
    questions: `1) Vercel Cron on Hobby: frequency limit and timing precision. 2) Vercel Workflow (Workflow DevKit): availability on Hobby, pricing/quota (verify the claim "50,000 workflow events per month on Hobby" exactly), sleep()/wake accuracy, max sleep duration, step limits, retries, how it is invoked, event counting per step. 3) Vercel Functions limits on Hobby: max duration, body size (4.5MB claim), concurrency, regions. 4) Vercel Blob: Hobby free allowance (storage, operations, transfer), private storage support, what happens on overage. 5) What happens when Hobby limits are exceeded (the 'paused for 30 days' claim). 6) Hobby terms: personal non-commercial use. 7) Alternatives for time-precise triggers if Workflow is unsuitable (Queues, external free schedulers, GitHub Actions cron precision).`,
  },
  {
    key: 'google-calendar',
    title: 'Google Calendar API for a single-user personal system',
    questions: `1) OAuth for personal use: 'In production' publishing status without verification for sensitive/restricted scopes — does the refresh token expire, what warnings/limits (100-user cap, unverified-app screen). Compare with 'Testing' mode 7-day expiry. 2) Scopes: is calendar.app.created enough or is the full calendar scope needed to read the primary calendar and others; exact scope names and sensitivity classification. 3) Push notifications (events.watch): channel lifetime/expiry, renewal, required HTTPS domain verification, whether Vercel domains work, delivery guarantees, sync tokens. 4) Quotas and the planned billing for exceeding quota 'later in 2026'. 5) Creating/cutting recurring series (UNTIL via recurrence update, splitting a series), calendar id stability after rename (summary vs id). 6) Detecting changes made manually by the user (updated timestamps, extendedProperties/private properties to mark system-created events).`,
  },
  {
    key: 'garmin-trainingpeaks',
    title: 'Garmin Connect data from a cloud server; TrainingPeaks to Garmin planned workouts',
    questions: `1) The python-garminconnect library (and garth): current status, how authentication works, MFA handling without a human, token persistence/refresh, known blocks (Cloudflare, rate limits, lockouts), whether it works from datacenter/cloud IPs such as Vercel, any maintainer notes in Oct 2026. 2) Garmin's Terms of Use / API terms regarding unofficial access (read them). 3) Official Garmin Connect Developer Program / Health & Activity API availability for individuals vs businesses. 4) TrainingPeaks to Garmin sync: planned structured workouts, how many days ahead are sent, whether strength workouts or text-only workouts are sent, what the Garmin calendar exposes about planned workout duration/length. 5) Apple Health as alternative: access constraints from a server. Note: python-garminconnect is a GitHub project, so cite repo README/issues as source-code/community sources.`,
  },
  {
    key: 'ios-shortcut-intake',
    title: 'iOS Shortcut share-sheet intake from WhatsApp to a server; Neon limits',
    questions: `1) iOS Shortcuts: what the Share Sheet receives from WhatsApp when sharing a message (text only? images? multiple messages? original message timestamp/sender?). 2) 'Get Contents of URL' action: POST as Form, file uploads, headers, timeout, error display, size limits, and the 'Always Allow' privacy prompt behavior (Apple's page). 3) Shortcut actions to resize images / convert to JPEG / strip location. 4) Whether Shortcuts can run on iOS without opening the Shortcuts app UI (share sheet execution experience) and any iOS 26 changes. 5) Neon free plan: current storage/compute/connection limits, scale-to-zero cold start latency, connecting from serverless (HTTP driver vs pooled), project/branch limits, any change in 2026. 6) Request-size interplay: Vercel 4.5MB request body vs image uploads.`,
  },
  {
    key: 'hebrew-nlp',
    title: 'Hebrew root/lemma matching in code (no LLM), free and deployable serverless',
    questions: `The system must match Hebrew words by ROOT (shoresh) not by string, in code, without calling an LLM: e.g. 'נדחה' vs 'יידחה', 'משוחררים' vs 'משתחררת'. 1) What Hebrew morphological analysis/lemmatization tools exist (HebMorph, Hspell, YAP, DictaBERT-based tools, Dicta APIs, spaCy/Stanza Hebrew models, NLTK-like stemmers, simple prefix-stripping heuristics): license, size, language runtime, whether they can run inside a Vercel serverless function (size limits, cold start) or must run elsewhere. 2) Any free hosted API with acceptable terms and Hebrew support, rate limits. 3) Published accuracy/benchmarks for root or lemma extraction on Hebrew. 4) Practical approach for a small closed domain (school messages: exam, test, postponed, canceled, homework) — e.g. curated root lexicon vs full analyzer; evidence for what works. 5) Handling unvocalized spelling variants (ktiv male/haser) and prefixes (ה, ב, ל, מ, ש, ו, כ).`,
  },
  {
    key: 'engineering-practices',
    title: 'High-level engineering practice for a serverless TypeScript PWA with scheduled jobs',
    questions: `Find authoritative guidance (official docs, well-known engineering write-ups) for: 1) idempotency and exactly-once-ish processing for webhooks/scheduled jobs; deduplication keys; retries with backoff. 2) Time handling with DST and Asia/Jerusalem timezone in JS/TS (Temporal API status in 2026, libraries like date-fns-tz/Luxon/js-joda), pitfalls for 'all-day', 'tomorrow', recurring events. 3) Testing strategy for such a system: unit tests for deterministic rules, fixture-based tests, contract tests for external APIs, how to test web push and service workers, Playwright with WebKit for iOS-like behavior, limits of simulating iOS. 4) Database migrations and schema approach on Neon with TypeScript (Drizzle vs Prisma vs raw SQL) at small scale; append-only history tables. 5) Secrets handling on Vercel (Sensitive env vars), security of a webhook endpoint with a shared secret header, rate limiting on Hobby. 6) Observability on the free tier: logs retention on Hobby, how to see failures. 7) Accessibility/RTL in PWAs. Keep to evidence; flag opinion pieces as community.`,
  },
]

phase('Research')
const verifiedTopics = await pipeline(
  TOPICS,
  (t) => agent(
    `You are a meticulous technical researcher. Topic: ${t.title}.\n\nQuestions to answer with sources:\n${t.questions}\n\n${RULES}\n\nReturn 6-14 findings, each atomic (one verifiable claim), each with an exact quote and URL. Put every unanswered question in unknowns.`,
    { label: `research:${t.key}`, phase: 'Research', schema: FINDINGS_SCHEMA }
  ),
  (found, t) => {
    if (!found) return null
    return agent(
      `You are an adversarial verifier (skeptic). Below are findings a researcher produced on "${t.title}". For EACH finding: open the cited URL yourself, check that the quote exists and supports the claim as worded, then search for a more recent or contradicting source. Default to 'unverifiable' if you cannot open the source or confirm; use 'overstated' if the claim says more than the quote; 'outdated' if a newer source changes it. Also list important facts the researcher missed (missedByResearcher).\n\n${RULES}\n\nFINDINGS JSON:\n${JSON.stringify(found)}`,
      { label: `verify:${t.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }
    ).then((v) => ({ key: t.key, title: t.title, found, verdicts: v }))
  }
)

const topics = verifiedTopics.filter(Boolean)
log(`${topics.length}/${TOPICS.length} topics completed research+verification`)

// Compact the verified material for the stress-test lenses
const verifiedDigest = topics.map((t) => {
  const vmap = {}
  ;((t.verdicts && t.verdicts.verdicts) || []).forEach((v) => { vmap[v.id] = v })
  return {
    topic: t.key,
    findings: t.found.findings.map((f) => ({
      id: `${t.key}:${f.id}`,
      claim: (vmap[f.id] && vmap[f.id].correctedClaim) || f.claim,
      verdict: vmap[f.id] ? vmap[f.id].verdict : 'not-verified',
      url: f.sourceUrl,
    })),
    unknowns: t.found.unknowns,
    missedByResearcher: (t.verdicts && t.verdicts.missedByResearcher) || [],
  }
})

const GAPS_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    filesRead: { type: 'array', items: { type: 'string' } },
    couldNotRead: { type: 'array', items: { type: 'string' } },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          title: { type: 'string' },
          whereInPlan: { type: 'string' },
          description: { type: 'string' },
          evidenceFindingIds: { type: 'array', items: { type: 'string' } },
          suggestedFix: { type: 'string' },
          basis: { type: 'string', enum: ['verified-finding', 'plan-internal-contradiction', 'my-inference'] },
        },
        required: ['severity', 'title', 'whereInPlan', 'description', 'basis'],
      },
    },
  },
  required: ['lens', 'filesRead', 'couldNotRead', 'gaps'],
}

const PLAN_READING = `
READ THE ACTUAL PLAN FIRST (not from memory). The plan lives in the claude.ai Project "מערכת יומן". Use the Projects tool with method project_read and these paths (a few have local copies under /home/claude/up/ that you may read with Read: 01-system-overview.md, 02-build-plan.md, 05-open-questions.md, 03-boundaries-rules.md, 03-personal-weights-rules.md):
claude/02-build-plan.md (chapter 7 row, the 'פתק מעבר' notes), claude/01-system-overview.md, claude/05-open-questions.md, claude/07-design-assets.md, claude/03-app-channel-rules.md, claude/03-scheduling-rules.md, claude/03-google-calendar-rules.md, claude/03-garmin-rules.md, claude/03-intake-rules.md, claude/03-permissions-rules.md, claude/03-brain-module-rules.md, claude/06-db-schema.md, claude/03-4fitness-rules.md, claude/03-design-rules.md.
Read only the ones your lens needs, fully. If a file cannot be read, list it in couldNotRead and do NOT critique it from memory.

THE CHAPTER-7 MAP is now the UPDATED one: read the section 'פרק 7 — מפת השלבים (מעודכנת אחרי מחקר, 4.10.2026)' in claude/02-build-plan.md (stages 0-7: half-page success criteria; minimal infra + ingest endpoint; shortcut test early; the gate; push declarative-vs-classic decision before sw.js; long clocks early (Google In production, watch); Garmin only after gate; install last on a throwaway domain). Also read claude/10-chapter7-research-report.md (the earlier partial research report and its live-test checklist G/S/P/H). Attack the UPDATED map, not the old one. Do not just repeat gaps already listed in the report: find NEW ones, or gaps in the proposed fixes themselves (ordering errors, hidden dependencies, steps that cannot be tested as written, things that cost money or break the free tier, things needing Yuval's manual action that the system could discover itself). Opening a GitHub repo / Vercel project needs Yuval's explicit approval.

YOUR JOB: find where the plan is wrong, contradictory, unverified, or missing a step, BEFORE any code is written. Rules: each gap must say its basis. 'verified-finding' = backed by a finding id from the digest below whose verdict is confirmed. 'plan-internal-contradiction' = two plan files disagree (cite both). 'my-inference' = your own reasoning (allowed, but labeled). Do not report style nitpicks. Do not invent plan content: quote the file. Do not re-open decisions Yuval already made unless a verified finding shows they cannot work; in that case say so explicitly and mark severity accordingly.`

const LENSES = [
  { key: 'pwa-push-design', brief: 'LENS: claude/07-design-assets.md file by file (index.html, manifest.json, sw.js, tokens.css, vercel.json, scripts, .env.example). Attack it: does sw.js match the declarative/classic decision; caching, scope, iOS standalone quirks, RTL, icon handling, missing VAPID/subscription flow, missing enablePush button, secrets. Quote the file for each gap.' },
  { key: 'data-logic-engineering', brief: 'LENS: claude/06-db-schema.md and the new infrastructure tables, idempotency/claim of clocks, Asia/Jerusalem DST, Hebrew-root matching mechanism, migrations, observability on Hobby (1h logs), testability of each chapter-7 step, rate_limits shapes.' },
  { key: 'pwa-gate-cost', brief: 'LENS: PWA/iOS push/icon/design-assets skeleton AND the gate (Haiku in Sandbox with subscription token), policy risk, quotas, order of chapter-7 steps. Check 07-design-assets, 03-app-channel-rules, 01, 03-brain-module-rules, 03-scheduling-rules, 05 "לא אומת" against verified findings.' },
  { key: 'integrations-data', brief: 'LENS: Google Calendar, Garmin, iOS Shortcut intake, Vercel scheduling, DB/time/Hebrew-root logic. Check 03-google-calendar-rules, 03-garmin-rules, 03-intake-rules, 03-4fitness-rules, 03-scheduling-rules, 06-db-schema against verified findings. List the exact live tests chapter 7 must run with pass/fail.' },
]

phase('Stress-test')
const reviews = await parallel(LENSES.map((L) => () => agent(
  `${L.brief}\n\n${PLAN_READING}\n\nVERIFIED RESEARCH DIGEST (ids are topic:finding):\n${JSON.stringify(verifiedDigest)}`,
  { label: `stress:${L.key}`, phase: 'Stress-test', schema: GAPS_SCHEMA }
)))
const goodReviews = reviews.filter(Boolean)
log(`${goodReviews.length}/${LENSES.length} stress-test lenses returned`)

const CRITIC_SCHEMA = { type: 'object', properties: { missing: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, why: { type: 'string' }, severity: { type: 'string', enum: ['blocker','high','medium','low'] } }, required: ['what','why','severity'] } }, unverifiedClaimsInReviews: { type: 'array', items: { type: 'string' } }, overreach: { type: 'array', items: { type: 'string' } } }, required: ['missing','unverifiedClaimsInReviews','overreach'] }
phase('Critic')
const critic = await agent(
  `You are a completeness critic. Below: verified research digest and four stress-test reviews of Yuval's chapter-7 plan. (1) What important area or failure mode did NO lens cover? (2) Which review claims lack a real basis (labeled verified-finding but id not confirmed, or inference presented as fact)? (3) Which suggestions overreach: reopen decisions Yuval closed, add cost, or add manual work for Yuval against his 'minimum actions' principle? Be concrete and short.\n\nDIGEST:\n${JSON.stringify(verifiedDigest)}\n\nREVIEWS:\n${JSON.stringify(goodReviews)}`,
  { label: 'critic', phase: 'Critic', schema: CRITIC_SCHEMA }
)

phase('Synthesis')
const report = await agent(
  `Write the final report in HEBREW, masculine address to Yuval, short and direct, no flattery. Use prose and tables, not long bullet dumps. Structure: (1) What blocks chapter 7 or must change in the plan (blocker/high gaps, deduplicated across lenses, each with the source URL from the digest or the two contradicting files; label basis: מאומת / סתירה פנימית / הסקה שלי). (2) What was verified and is safe to rely on (topic by topic, one line each with URL). (3) What could NOT be verified and can only be settled by a live test in chapter 7 — as a concrete checklist with pass/fail. (4) What was contradicted or outdated relative to what the plan assumes. (5) What is still missing (from the critic), including critic's flagged overreach and unverified review claims. This report targets the UPDATED chapter-7 map and 07-design-assets.md: lead with NEW gaps and gaps in the proposed fixes; do not restate the earlier report. Rules: every factual claim carries a URL or a plan-file reference; anything unverified is labeled "לא אומת"; never present an inference as fact; do not invent numbers. End with 'מה אני ממליץ לשנות במפה של פרק 7' — max 7 items, each labeled as my recommendation.\n\nDIGEST:\n${JSON.stringify(verifiedDigest)}\n\nREVIEWS:\n${JSON.stringify(goodReviews)}\n\nCRITIC:\n${JSON.stringify(critic)}`,
  { label: 'synthesis', phase: 'Synthesis' }
)

return { report, critic, digest: verifiedDigest, reviews: goodReviews }
