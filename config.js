// config.js — HOF Case Manager Compliance. SAFE TO EDIT.

// The 12 case managers, as DEAL OWNERS. Owner IDs are resolved from HubSpot at run
// time, so only the email address is needed here.
const DEAL_OWNERS = [
  { email: "brenda@hofmigration.com",         name: "Brenda Murowanidzwa" },
  { email: "yamina@hofmigration.com",         name: "Yamina Sadi" },
  { email: "alitariq@hofmigration.com",       name: "Ali Tariq" },
  { email: "anwar@hofmigration.com",          name: "Anwar Saeed" },
  { email: "tamjeed@hofmigration.com",        name: "Tamjeed Zahid" },
  { email: "thushara@hofmigration.com",       name: "Thushara M S" },
  { email: "rahima@hofmigration.com",         name: "Rahima Nabili" },
  { email: "warda@hofmigration.com",          name: "Warda Badar" },
  { email: "umer@hofmigration.com",           name: "Umer Masaud" },
  { email: "hashimtahir@hofmigration.com",    name: "Hashim Tahir" },
  { email: "muhammadzaryab@hofmigration.com", name: "Muhammad Zaryab" },
  { email: "maryamchand@hofmigration.com",    name: "Maryam Chand" },
];

const hoursFrom = (env, dflt) => {
  const raw = String(process.env[env] ?? String(dflt)).trim().toLowerCase();
  if (!raw) return dflt;
  if (raw === "any" || raw === "0") return 0;
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

const listFrom = (env, dflt) => {
  const raw = String(process.env[env] ?? "").trim();
  if (!raw || raw.toLowerCase() === "all") return dflt;
  return raw.split("|").map((s) => s.trim()).filter((s) => s && s !== "- none -");
};

const SETTINGS = {
  // true = safe test: scans and prints, posts nothing.
  DRY_RUN: process.env.DRY_RUN_INPUT ? process.env.DRY_RUN_INPUT === "true" : true,

  // ---- scope ----
  // Cases touched in the last N hours. Typed in the workflow.
  TOUCHED_WITHIN_HOURS: hoursFrom("HOURS_INPUT", 24),
  TOUCHED_WITHIN_HOURS_RAW: String(process.env.HOURS_INPUT ?? "24").trim(),

  // Only cases where a CALL WAS LOGGED inside that window are audited.
  REQUIRE_CALL_IN_WINDOW: true,

  // Client / process filters. "all" in the workflow means no filter.
  CLIENT_STATUS_ALLOWED: listFrom("CLIENT_STATUS_INPUT", ["Active"]),
  APPLICATION_STATUS_ALLOWED: listFrom("APPLICATION_STATUS_INPUT",
    ["In Progress", "In Process"]),

  // ---- mention chase (the critical one) ----
  // A note is only chased once it has been sitting for this long, so a reply made
  // shortly after the tag is never chased.
  MENTION_MIN_AGE_HOURS: 48,
  // Only notes WRITTEN BY one of the case managers, or MENTIONING one of them.
  MENTION_ONLY_OUR_TEAM: true,
  // IMPORTANT: HubSpot does not expose note COMMENTS through its API, so a reply
  // left as a comment is invisible to this agent. The 48h wait above plus the
  // wording of the note (see 6-note.js) are what keep this fair.
  MENTION_COMMENT_CAVEAT: true,

  // ---- notes we post ----
  NOTE_OWNER_ID: "86250521",          // posted as Ali Raza
  MAX_ISSUES_PER_DEAL: 3,
  TASK_PREFIX: "[Compliance]",

  // ---- limits ----
  MAX_DEALS: (() => { const r = (process.env.LIMIT_INPUT || "all").toLowerCase(); if (!r || r === "all" || r === "0") return 0; const n = parseInt(r, 10); return n > 0 ? n : 0; })(),
  MAX_AI_CALLS: 500,
  MAX_EMAILS_PER_DEAL: 8,
  MAX_NOTES_PER_DEAL: 15,

  PORTAL_ID: "23735726",
  TZ_OFFSET_HOURS: 5,
  GEMINI_MODEL: "gemini-flash-lite-latest",

  // ---- toggles ----
  CHECK_CALL_TASK: true,       // call logged but no next task
  CHECK_CALL_EMAIL: true,      // call logged but no follow-up email (AI decides if needed)
  CHECK_CLIENT_REPLY: true,    // client asked something and got no reply
  CHECK_TONE: true,            // our reply tone
  CHECK_MENTIONS: true,        // tagged and not answered
  REPLY_DUE_HOURS: 24,
};

// Optional: audit a single case manager, chosen in the workflow.
const pick = String(process.env.CASE_MANAGER_INPUT || "all").trim().toLowerCase();
const SELECTED_OWNERS = (!pick || pick === "all")
  ? DEAL_OWNERS
  : DEAL_OWNERS.filter((o) => o.name.toLowerCase() === pick || o.email.toLowerCase() === pick) ;

module.exports = { DEAL_OWNERS: SELECTED_OWNERS, ALL_OWNERS: DEAL_OWNERS, SETTINGS };
