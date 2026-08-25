// cm-compliance.js — THE RUNNER for HOF Case Manager Compliance.
//
// Scope: cases owned by the 12 case managers, touched in the last N hours, WITH A CALL
// LOGGED in that window, and matching the client / application status filters.
// Checks: next task after the call, follow-up email when one was needed, unanswered
// client emails, our own email tone, and unanswered @mentions on notes.
// Every case is read by the AI before anything is posted.
//
// SAFE MODE: DRY_RUN=true prints everything and posts nothing.
const { DEAL_OWNERS, SETTINGS } = require("./config");
const { ownersByEmail } = require("./0-hubspot");
const { fetchDeals, attach, dispositions, windowStart, callsInWindow } = require("./1-fetch");
const checkCall = require("./2-check-call");
const checkClientReply = require("./3-check-client-reply");
const checkTone = require("./4-check-tone");
const checkMentions = require("./5-check-mentions");
const { composeNote, postNote } = require("./6-note");
const ai = require("./0-ai");

const PRIORITY = { mention: 1, clientreply: 2, tone: 3, email: 4, task: 5 };
const dealLink = (id) => `https://app.hubspot.com/contacts/${SETTINGS.PORTAL_ID}/record/0-3/${id}`;

async function main() {
  if (!process.env.HUBSPOT_TOKEN) throw new Error("Missing HUBSPOT_TOKEN");
  console.log(`=== HOF Case Manager Compliance — ${new Date().toISOString()} ===  DRY_RUN=${SETTINGS.DRY_RUN}`);
  if (!process.env.GEMINI_KEY) console.log(`!! No GEMINI_KEY — the checks that read the case cannot run. Add the secret.`);

  const raw = SETTINGS.TOUCHED_WITHIN_HOURS_RAW;
  if (raw && !/^(any|0)$/i.test(raw) && !Number.isFinite(parseFloat(raw)))
    console.log(`NOTE: "${raw}" is not a number of hours — using 24.`);

  const start = windowStart();
  const t = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  console.log(`Cases:        touched in the last ${SETTINGS.TOUCHED_WITHIN_HOURS}h (since ${start ? t(start) : "any time"} UTC), with a call logged in that window`);
  console.log(`Client status: ${SETTINGS.CLIENT_STATUS_ALLOWED.join(", ") || "any"}`);
  console.log(`Application:   ${SETTINGS.APPLICATION_STATUS_ALLOWED.join(", ") || "any"}`);
  console.log(`Mentions:      only notes at least ${SETTINGS.MENTION_MIN_AGE_HOURS}h old, written by or tagging our team`);

  // resolve the case managers
  const byEmail = await ownersByEmail();
  const team = [], missing = [];
  for (const o of DEAL_OWNERS) {
    const hit = byEmail[o.email.toLowerCase()];
    if (hit) team.push({ id: hit.id, name: o.name || hit.name, email: o.email }); else missing.push(o.email);
  }
  console.log(`\nCase managers resolved: ${team.length}/${DEAL_OWNERS.length}`);
  if (missing.length) console.log(`  NOT FOUND: ${missing.join(", ")}`);
  if (!team.length) return;
  const NAME = Object.fromEntries(team.map((m) => [m.id, m.name]));
  const teamIds = team.map((m) => m.id);

  const dispoMap = await dispositions();
  const deals = await fetchDeals(teamIds);
  console.log(`Cases matching the filters: ${deals.length}`);

  const flagged = [];
  let audited = 0, noCall = 0, statusSkip = 0;

  for (const rawDeal of deals) {
    let d;
    try { d = await attach(rawDeal, dispoMap); }
    catch (e) { console.log(`fetch error ${rawDeal.id}: ${e.message}`); continue; }

    if (SETTINGS.CLIENT_STATUS_ALLOWED.length && !SETTINGS.CLIENT_STATUS_ALLOWED.includes(d.clientStatus)) { statusSkip++; continue; }
    if (SETTINGS.APPLICATION_STATUS_ALLOWED.length && !SETTINGS.APPLICATION_STATUS_ALLOWED.includes(d.applicationStatus)) { statusSkip++; continue; }
    if (SETTINGS.REQUIRE_CALL_IN_WINDOW && !callsInWindow(d).length) { noCall++; continue; }
    audited++;

    let issues = [];
    try {
      const results = await Promise.all([
        checkCall(d), checkClientReply(d), checkTone(d, start), checkMentions(d, teamIds),
      ]);
      issues = results.flat().filter(Boolean);
    } catch (e) { console.log(`check error ${d.id}: ${e.message}`); }

    issues = issues.filter((i) => typeof i?.problem === "string" && typeof i?.action === "string");
    if (!issues.length) continue;

    issues.sort((a, b) => (PRIORITY[a.area] || 99) - (PRIORITY[b.area] || 99));
    const top = issues.slice(0, SETTINGS.MAX_ISSUES_PER_DEAL);
    const ownerName = NAME[d.ownerId] || `owner ${d.ownerId}`;
    flagged.push({ ...d, ownerName, top, all: issues, note: composeNote(top, ownerName) });

    if (!SETTINGS.DRY_RUN) {
      try { await postNote(d.id, top, d.ownerId, ownerName); }
      catch (e) { console.log(`note error ${d.id}: ${e.message}`); }
    }
  }

  // ---- summary ----
  const perOwner = {}, perArea = {};
  for (const f of flagged) {
    perOwner[f.ownerName] = (perOwner[f.ownerName] || 0) + 1;
    for (const i of f.all) perArea[i.area] = (perArea[i.area] || 0) + 1;
  }
  const desc = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  console.log(`\n===== SUMMARY =====`);
  console.log(`Cases ${deals.length} | no call in window ${noCall} | wrong status ${statusSkip} | audited ${audited} | FLAGGED ${flagged.length}`);
  console.log(`AI calls used: ${ai.usage()}${ai.usage() >= SETTINGS.MAX_AI_CALLS ? " (budget reached)" : ""}`);
  console.log(`\nFindings by type:`); for (const [a, n] of desc(perArea)) console.log(`  ${String(n).padStart(4)}  ${a}`);
  console.log(`\nFlagged per case manager:`); for (const [o, n] of desc(perOwner)) console.log(`  ${String(n).padStart(4)}  ${o}`);

  const chases = flagged.filter((f) => f.top.some((i) => i.area === "mention"));
  if (chases.length) {
    console.log(`\nMENTION CHASES (${chases.length}) — these tag the person who owes the reply:`);
    for (const f of chases.slice(0, 20)) {
      const m = f.top.find((i) => i.area === "mention");
      console.log(`  ${f.ownerName} — ${f.name}\n     tagging ${m.mentionName} (${m.hours}h): ${m.problem}\n     ${dealLink(f.id)}`);
    }
  }

  console.log(`\nSample (first 15):`);
  for (const f of flagged.slice(0, 15)) {
    console.log(`\n• ${f.ownerName} — ${f.name}`);
    console.log(`  note:   ${f.note}`);
    console.log(`  issues: ${f.all.map((i) => i.problem).join("; ")}`);
    console.log(`  link:   ${dealLink(f.id)}`);
  }

  if (SETTINGS.DRY_RUN) console.log(`\nDRY RUN: nothing was posted.`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
