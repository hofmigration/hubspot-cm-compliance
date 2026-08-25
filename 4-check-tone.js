// 4-check-tone.js — our own replies to the client. Deliberately narrow: only
// genuinely rude, sarcastic, dismissive or aggressive wording. Blunt, firm, brief or
// bad-news emails are not flagged.
const { SETTINGS } = require("./config");
const { askJson } = require("./0-ai");

function freshPart(text) {
  let t = String(text || "");
  for (const c of [/On .{0,60}wrote:/i, /-----Original Message-----/i, /From:.{0,80}Sent:/i, /_{10,}/]) {
    const m = t.match(c); if (m && m.index > 40) t = t.slice(0, m.index);
  }
  return t.split(/\n/).filter((l) => !/^\s*>/.test(l)).join("\n").trim();
}

const PROMPT = (subject, body) => `You review an email OUR OWN staff sent to a client. Flag it ONLY if the wording is genuinely unprofessional.

FLAG only when unmistakable: rude or insulting wording, sarcasm, talking down to the client, blaming or scolding them ("I already told you"), or aggressive/threatening tone.

DO NOT FLAG: short or blunt replies, firm but polite chasing, delivering bad news or refusals politely, imperfect English or typos, templates, or anything borderline.

Subject: ${String(subject || "").slice(0, 200)}
Body:
"""${String(body || "").slice(0, 2200)}"""

Reply ONLY JSON: {"flag": true|false, "category": "rude"|"dismissive"|"aggressive"|"", "confidence": "high"|"low", "quote": "<the exact words, max 15 words>"}`;

module.exports = async function checkTone(d, windowStart) {
  if (!SETTINGS.CHECK_TONE || !d.available.emails) return [];
  const issues = [];
  const outgoing = d.emails
    .filter((e) => !e.incoming && (!windowStart || e.when >= windowStart))
    .slice(0, SETTINGS.MAX_EMAILS_PER_DEAL);

  for (const e of outgoing) {
    const body = freshPart(e.text);
    if (body.replace(/\s+/g, "").length < 25) continue;
    const j = await askJson(PROMPT(e.subject, body));
    if (!j || !j.flag) continue;
    if (String(j.confidence || "").toLowerCase() !== "high" || !String(j.quote || "").trim()) continue;
    issues.push({
      area: "tone",
      problem: `Email tone flagged as ${j.category || "unprofessional"} — "${j.quote}"`,
      action: "review the tone of the email sent to the client",
      line: `The tone of the email to the client reads as ${j.category || "unprofessional"}, kindly review it`,
    });
  }
  return issues;
};
module.exports.freshPart = freshPart;
