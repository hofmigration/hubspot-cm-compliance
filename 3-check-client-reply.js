// 3-check-client-reply.js — a client email that was left unanswered AND needed an answer.
// An acknowledgement ("thanks", "noted", "received") is never chased. Anything where
// the client is asking or raising something is.
const { SETTINGS } = require("./config");
const { askJson } = require("./0-ai");

const AUTO = /(out of office|automatic reply|auto-?reply|do not reply|delivery status notification|read receipt|undeliverable|mailer-daemon)/i;
const ACK_ONLY = /^(ok(ay)?|thanks?|thank you( so much| very much)?|noted|received|got it|sure|great|perfect|alright|understood|will do|yes|no problem)[\s.!,]*$/i;

function obviouslyNoReplyNeeded(subject, text) {
  const s = String(subject || ""), t = String(text || "").trim();
  if (AUTO.test(s) || AUTO.test(t.slice(0, 300))) return true;
  const short = t.replace(/\s+/g, " ").trim();
  if (short.length <= 60 && ACK_ONLY.test(short.replace(/[^\w\s.!,]/g, "").trim())) return true;
  if (short.length < 12) return true;
  return false;
}

const PROMPT = (subject, body) => `You review an email a CLIENT sent to an immigration consultancy. Decide whether it REQUIRES a reply.

REPLY REQUIRED (true): the client asks a question, asks for an update, a document, a call or a timeline; reports a problem or a concern; requests an action, change, refund or cancellation; or clearly expects a decision or confirmation.

NO REPLY REQUIRED (false): a thank you or acknowledgement; an automated message; simply attaching documents we asked for with no question; a courtesy message; or anything with nothing being asked of us.

Be conservative. If nothing is actually being asked of us, answer false.

Subject: ${String(subject || "").slice(0, 200)}
Body:
"""${String(body || "").slice(0, 2000)}"""

Reply ONLY JSON: {"replyRequired": true|false, "asks": "<what the client wants, max 12 words>"}`;

module.exports = async function checkClientReply(d) {
  if (!SETTINGS.CHECK_CLIENT_REPLY || !d.available.emails) return [];
  const incoming = d.emails.filter((e) => e.incoming);
  if (!incoming.length) return [];

  const lastOutgoing = Math.max(0, ...d.emails.filter((e) => !e.incoming).map((e) => e.when));
  const overdue = incoming
    .filter((e) => e.when > lastOutgoing)
    .filter((e) => (Date.now() - e.when) / 3600000 >= SETTINGS.REPLY_DUE_HOURS)
    .sort((a, b) => a.when - b.when);
  if (!overdue.length) return [];

  for (const e of overdue) {
    if (obviouslyNoReplyNeeded(e.subject, e.text)) continue;
    const j = await askJson(PROMPT(e.subject, e.text));
    if (!j || !j.replyRequired) continue;
    const hours = Math.floor((Date.now() - e.when) / 3600000);
    return [{
      area: "clientreply",
      problem: `Client email unanswered for ${hours}h${j.asks ? ` — asks: ${j.asks}` : ""}`,
      action: "reply to the client email",
      line: `The client emailed ${hours} hours ago${j.asks ? ` asking ${j.asks}` : ""} and has had no reply, kindly respond`,
    }];
  }
  return [];
};
module.exports.obviouslyNoReplyNeeded = obviouslyNoReplyNeeded;
