// selftest.js — the case manager compliance rules register.
// Run after any edit: node selftest.js
process.env.HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN || "selftest";

const checkCall = require("./2-check-call");
const checkClientReply = require("./3-check-client-reply");
const { obviouslyNoReplyNeeded } = require("./3-check-client-reply");
const checkTone = require("./4-check-tone");
const { freshPart } = require("./4-check-tone");
const checkMentions = require("./5-check-mentions");
const { composeNote, buildNoteHtml, tagTarget } = require("./6-note");
const { mentionsIn } = require("./1-fetch");
const { DEAL_OWNERS, SETTINGS } = require("./config");

const H = 3600000, now = Date.now();
const TEAM = ["101", "102", "103"];
let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `\n        ${detail}`}`);
  ok ? pass++ : fail++;
};

const noteHtml = (id, name) =>
  `<div><p>Please confirm the document list <strong><span data-mention-id="${id}" data-mention-name="${name}" style="color: #425b76;font-weight: 600;">@${name}</span></strong></p></div>`;

const deal = (o = {}) => ({
  available: { calls: true, emails: true, tasks: true, notes: true, contact: true },
  id: "9001", name: "Test Case", ownerId: "101",
  clientStatus: "Active", applicationStatus: "In Progress",
  lastTouched: now, calls: [], emails: [], tasks: [], notes: [], ...o,
});

console.log("CASE MANAGER COMPLIANCE SELF-TEST\n");

// ---- config ----
check("all 12 case managers are configured", DEAL_OWNERS.length === 12, `got ${DEAL_OWNERS.length}`);
check("every case manager has a name and an email",
  DEAL_OWNERS.every((o) => /@hofmigration\.com$/.test(o.email) && o.name));
check("cases are scoped to the last 24 hours by default", SETTINGS.TOUCHED_WITHIN_HOURS === 24);
check("a call in the window is required", SETTINGS.REQUIRE_CALL_IN_WINDOW === true);
check("notes are only chased after 48 hours", SETTINGS.MENTION_MIN_AGE_HOURS === 48);
check("only our team's notes are chased", SETTINGS.MENTION_ONLY_OUR_TEAM === true);
check("client and application status filters are set",
  SETTINGS.CLIENT_STATUS_ALLOWED.includes("Active") &&
  SETTINGS.APPLICATION_STATUS_ALLOWED.includes("In Progress") &&
  SETTINGS.APPLICATION_STATUS_ALLOWED.includes("In Process"));

// ---- mention parsing ----
check("a mention is read out of the note markup",
  JSON.stringify(mentionsIn(noteHtml("102", "Anwar Saeed"))) === JSON.stringify([{ id: "102", name: "Anwar Saeed" }]));
check("a note with no mention returns none", mentionsIn("<div><p>just a note</p></div>").length === 0);

// ---- who gets tagged ----
check("a mention chase tags the person who owes the reply",
  tagTarget([{ area: "mention", mentionId: "102", mentionName: "Anwar Saeed" }], "101", "Warda Badar").id === "102");
check("everything else tags the case manager",
  tagTarget([{ area: "task", action: "x" }], "101", "Warda Badar").id === "101");
check("the note about a comment reply is included on a chase",
  /already replied in a comment/i.test(buildNoteHtml([{ area: "mention", mentionId: "102", mentionName: "Anwar Saeed", action: "reply on the note", line: "You were tagged" }], "101", "Warda")));
check("it is not included on an ordinary note",
  !/already replied in a comment/i.test(buildNoteHtml([{ area: "task", action: "create the next follow up task" }], "101", "Warda")));

// ---- emails that never reach the AI ----
check("thank you is dropped without an AI call", obviouslyNoReplyNeeded("Re: docs", "Thank you so much"));
check("out of office is dropped", obviouslyNoReplyNeeded("Automatic reply", "I am away until Monday"));
check("a real question is not dropped",
  !obviouslyNoReplyNeeded("Update?", "Sir when will my file be submitted? It has been three weeks."));
check("quoted history is trimmed before the tone check",
  /unacceptable/i.test(freshPart("This is unacceptable.\n\nOn Mon 3 Aug 2026 at 10:00, Warda wrote:\n> all is progressing well"))
  && !/progressing well/i.test(freshPart("This is unacceptable.\n\nOn Mon 3 Aug 2026 at 10:00, Warda wrote:\n> all is progressing well")));

(async () => {
  const noKey = !process.env.GEMINI_KEY;

  // ---- call -> task ----
  const withCall = { calls: [{ id: "c1", when: now - 2 * H, outcome: "Connected", note: "explained the document requirements and fee structure" }] };
  check("call logged with no open task is flagged",
    (await checkCall(deal({ ...withCall, tasks: [] }))).some((i) => i.area === "task"));
  check("call logged with an open task is fine on the task rule",
    !(await checkCall(deal({ ...withCall, tasks: [{ hs_task_subject: "Follow up", hs_task_status: "NOT_STARTED" }] }))).some((i) => i.area === "task"));
  check("a completed task does not count",
    (await checkCall(deal({ ...withCall, tasks: [{ hs_task_subject: "Old", hs_task_status: "COMPLETED" }] }))).some((i) => i.area === "task"));
  check("our own compliance task does not count",
    (await checkCall(deal({ ...withCall, tasks: [{ hs_task_subject: "[Compliance] do x", hs_task_status: "NOT_STARTED" }] }))).some((i) => i.area === "task"));
  check("no call in the window means no call findings",
    (await checkCall(deal({ calls: [{ id: "c0", when: now - 200 * H, outcome: "Connected", note: "old call" }], tasks: [] }))).length === 0);
  check(`the follow-up email is only chased when the AI says it was needed${noKey ? "" : " (key present)"}`,
    noKey ? !(await checkCall(deal({ ...withCall, tasks: [{ hs_task_subject: "F", hs_task_status: "NOT_STARTED" }], emails: [] }))).some((i) => i.area === "email") : true);

  // ---- mentions ----
  const oldNote = (o = {}) => ({ id: "n1", when: now - 60 * H, authorId: "101", text: "Please confirm the document list @Anwar Saeed", mentions: [{ id: "102", name: "Anwar Saeed" }], ...o });
  check("a note younger than 48h is never chased",
    (await checkMentions(deal({ notes: [oldNote({ when: now - 10 * H })] }), TEAM)).length === 0);
  check("a later note by the tagged person counts as an answer",
    (await checkMentions(deal({ notes: [oldNote(), { id: "n2", when: now - 20 * H, authorId: "102", text: "done", mentions: [] }] }), TEAM)).length === 0);
  check("a note from outside our team is not chased",
    (await checkMentions(deal({ notes: [oldNote({ authorId: "999", mentions: [{ id: "888", name: "Someone Else" }] })] }), TEAM)).length === 0);
  check("tagging yourself is not chased",
    (await checkMentions(deal({ notes: [oldNote({ authorId: "102" })] }), TEAM)).length === 0);
  check("our own compliance note is never chased",
    (await checkMentions(deal({ notes: [oldNote({ text: "Hi @Anwar Saeed Kindly reply on the note" })] }), TEAM)).length === 0);
  check("broken notes lookup stays silent",
    (await checkMentions(deal({ available: { calls: true, emails: true, tasks: true, notes: false, contact: true }, notes: [oldNote()] }), TEAM)).length === 0);
  check(`without a GEMINI_KEY no mention is chased${noKey ? "" : " (key present)"}`,
    noKey ? (await checkMentions(deal({ notes: [oldNote()] }), TEAM)).length === 0 : true);

  // ---- client reply ----
  check("a client email inside 24h is not chased",
    (await checkClientReply(deal({ emails: [{ incoming: true, when: now - 3 * H, subject: "Q", text: "when is my file submitted?" }] }))).length === 0);
  check("an answered client email is not chased",
    (await checkClientReply(deal({ emails: [{ incoming: true, when: now - 40 * H, subject: "Q", text: "when is my file submitted?" }, { incoming: false, when: now - 2 * H, subject: "Re", text: "soon" }] }))).length === 0);
  check("an acknowledgement is never chased",
    (await checkClientReply(deal({ emails: [{ incoming: true, when: now - 40 * H, subject: "Re", text: "Thank you so much" }] }))).length === 0);

  // ---- tone ----
  check("tone check stays silent on an empty inbox", (await checkTone(deal(), 0)).length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nA rule stopped working. Fix it before auditing for real."); process.exit(1); }
  console.log(`\nExample chase note:\n  ${composeNote([{ area: "mention", mentionId: "102", mentionName: "Anwar Saeed", action: "reply on the note", line: "You were tagged on a note 60 hours ago and asked to confirm the document list, and there is still no reply, kindly respond on the note" }], "Warda Badar").split(" | ").join("\n  ")}`);
})();
