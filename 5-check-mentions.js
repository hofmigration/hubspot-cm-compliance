// 5-check-mentions.js — THE CRITICAL CHECK: somebody was tagged and never answered.
//
// Covers both directions in one rule:
//   - the case manager was tagged and has not answered
//   - the case manager tagged someone else and THEY have not answered
//
// KNOWN BLIND SPOT, handled deliberately:
// HubSpot does NOT expose note COMMENTS through its API, so a reply left as a comment
// is invisible to any script. Four guards keep this fair:
//   1. a note is only chased inside a BOUNDED window — old enough that a reply has
//      clearly not come (48h), but not ancient (72h). Without the upper bound the
//      agent chased notes from months ago on every run.
//   2. only notes written by, or mentioning, one of our case managers are considered
//   3. any LATER note by the mentioned person on the same case counts as an answer,
//      because a reply is often written as a fresh note rather than a comment
//   4. the AI must first agree the note actually ASKS that person to DO or ANSWER
//      something. Attachments are counted and told to the AI, because "@Name Excel
//      Sheet" with a file on it is a document hand-over, not a request.
// The note we post also invites anyone who did reply in a comment to ignore it.
const { SETTINGS } = require("./config");
const { askJson } = require("./0-ai");

const PROMPT = (text, names, attachments) => `You audit an immigration consultancy's CRM. A team member wrote a note on a client case and tagged ${names}. Read it the way a manager would and decide whether the note is ASKING the tagged person to DO something or ANSWER something.

${attachments ? `IMPORTANT: this note has ${attachments} document(s) attached.` : "This note has no attachment."}

NEEDS A RESPONSE (true) ONLY when the note clearly asks the tagged person for an action or an answer, for example:
- "please take over this case"
- "can you confirm / check / review / update this"
- "please call the client" or "please share the documents with the client"
- a question directed at them
- work handed to them that they must pick up

NO RESPONSE NEEDED (false) — and this is the common case:
- a document is attached and the note simply names it, e.g. "@Name Excel Sheet",
  "@Name checklist attached", "@Name CV". Handing over a document is NOT a request.
- a CV summary, case summary, profile write-up or update shared for awareness
- an FYI, a heads-up, a status update, or naming who handles the case
- information about the client, what they said, or what happened
- thanks or acknowledgement
- the note names someone only so they can see it

The test: is the tagged person being asked to DO or ANSWER something? A file, a summary
or an update on its own is not a request, however it is worded. If you are not sure,
answer false.

Note:
"""${String(text || "").slice(0, 2000)}"""

Reply ONLY JSON: {"needsResponse": true|false, "asks": "<what they must do, max 12 words, empty if nothing>"}`;

module.exports = async function checkMentions(d, ourTeamIds) {
  if (!SETTINGS.CHECK_MENTIONS || !d.available.notes) return [];

  // bounded window: notes that have just passed the 48h mark, not ancient ones
  const newest = Date.now() - SETTINGS.MENTION_MIN_AGE_HOURS * 3600000;
  const oldest = SETTINGS.MENTION_MAX_AGE_HOURS
    ? Date.now() - SETTINGS.MENTION_MAX_AGE_HOURS * 3600000 : 0;
  const team = new Set((ourTeamIds || []).map(String));
  const issues = [];

  // oldest first, so the earliest unanswered tag is reported
  const candidates = d.notes
    .filter((n) => n.when && n.when <= newest && (!oldest || n.when >= oldest))  // guard 1: in the window
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
      const j = await askJson(PROMPT(note.text, m.name || "a colleague", note.attachments || 0));
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
