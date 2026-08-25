// 5-check-mentions.js — THE CRITICAL CHECK: somebody was tagged and never answered.
//
// Covers both directions in one rule:
//   - the case manager was tagged and has not answered
//   - the case manager tagged someone else and THEY have not answered
//
// KNOWN BLIND SPOT, handled deliberately:
// HubSpot does NOT expose note COMMENTS through its API, so a reply left as a comment
// is invisible to any script. Four guards keep this fair:
//   1. a note is only chased once it is MENTION_MIN_AGE_HOURS old (48h) — most comment
//      replies happen within hours, so the wait removes nearly all of the risk
//   2. only notes written by, or mentioning, one of our case managers are considered
//   3. any LATER note by the mentioned person on the same case counts as an answer,
//      because a reply is often written as a fresh note rather than a comment
//   4. the AI must first agree the note actually ASKS that person for something —
//      documents dropped in, FYI notes and summaries are never chased
// The note we post also invites anyone who did reply in a comment to ignore it.
const { SETTINGS } = require("./config");
const { askJson } = require("./0-ai");

const PROMPT = (text, names) => `You audit an immigration consultancy's CRM. A team member wrote a note on a client case and tagged ${names}. Decide whether that note is ASKING the tagged person for something they must respond to.

NEEDS A RESPONSE (true) when the note asks them to do something, asks a question, requests information, a decision, a review, or an action from them, or hands the case over to them.

NO RESPONSE NEEDED (false) when the note is:
- information, an update, a summary or a CV/document write-up shared for awareness
- attaching or recording documents, with nothing being asked
- an FYI, a heads-up, or simply naming who handles the case
- thanking or acknowledging them
- anything where nothing is actually being asked of the tagged person

Be conservative. If nothing is clearly being asked of them, answer false.

Note:
"""${String(text || "").slice(0, 2000)}"""

Reply ONLY JSON: {"needsResponse": true|false, "asks": "<what is being asked of them, max 12 words>"}`;

module.exports = async function checkMentions(d, ourTeamIds) {
  if (!SETTINGS.CHECK_MENTIONS || !d.available.notes) return [];

  const minAge = Date.now() - SETTINGS.MENTION_MIN_AGE_HOURS * 3600000;
  const team = new Set((ourTeamIds || []).map(String));
  const issues = [];

  // oldest first, so the earliest unanswered tag is reported
  const candidates = d.notes
    .filter((n) => n.when && n.when <= minAge)                       // guard 1: old enough
    .filter((n) => n.mentions && n.mentions.length)
    .filter((n) => !SETTINGS.MENTION_ONLY_OUR_TEAM ||                 // guard 2: our team only
      team.has(String(n.authorId)) || n.mentions.some((m) => team.has(String(m.id))))
    .filter((n) => !/^\s*hi\s*@/i.test(n.text || "") || !/\bkindly\b/i.test(n.text || "")) // never chase our own compliance notes
    .sort((a, b) => a.when - b.when);

  for (const note of candidates) {
    for (const m of note.mentions) {
      if (String(m.id) === String(note.authorId)) continue;           // tagged themselves
      if (String(m.id) === String(SETTINGS.NOTE_OWNER_ID)) continue;  // tagged Ali: not chased here

      // guard 3: any later note by that person on this case counts as an answer
      const answered = d.notes.some((n) => n.when > note.when && String(n.authorId) === String(m.id));
      if (answered) continue;

      // guard 4: was anything actually being asked of them?
      const j = await askJson(PROMPT(note.text, m.name || "a colleague"));
      if (!j || !j.needsResponse) continue;

      const hours = Math.floor((Date.now() - note.when) / 3600000);
      issues.push({
        area: "mention",
        mentionId: String(m.id),
        mentionName: m.name || "",
        noteId: note.id,
        hours,
        problem: `Tagged ${hours}h ago and no reply yet${j.asks ? ` — asked to ${j.asks}` : ""}`,
        action: "reply on the note",
        line: `You were tagged on a note ${hours} hours ago${j.asks ? ` and asked to ${j.asks}` : ""} and there is still no reply, kindly respond on the note`,
      });
      break;    // one chase per note is enough
    }
    if (issues.length) break;   // one mention chase per case per run
  }
  return issues;
};
