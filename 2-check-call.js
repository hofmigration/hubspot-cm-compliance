// 2-check-call.js — for the call(s) logged in the window:
//   a) is there an OPEN task for the next follow up?
//   b) was a follow-up email sent after the call — but ONLY when one was actually needed.
//
// The email is NOT always required. The case is read first: a quick internal call, a
// wrong number, or a call where nothing was promised needs no email. A call where
// something was explained, promised, requested or agreed does.
const { SETTINGS } = require("./config");
const { askJson } = require("./0-ai");
const { callsInWindow } = require("./1-fetch");

const DONE = ["completed"];
const PLACEHOLDER = /^(na|n\/a|n\.a\.?|none|nil|-+|\.+|x+)$/i;
const hasText = (t) => { const s = String(t || "").trim(); return s.length >= 3 && !PLACEHOLDER.test(s); };

const EMAIL_NEEDED_PROMPT = (outcome, note) => `You audit an immigration consultancy's case work. A case manager logged a call with a client. Decide whether a FOLLOW-UP EMAIL to the client was genuinely needed after this call.

EMAIL NEEDED (true) when the call involved anything the client should have in writing:
- documents, information or payment were requested from the client
- a process, requirement, timeline, fee or next step was explained
- something was promised, agreed, confirmed or scheduled
- the client asked a question that needs a written answer or attachment

EMAIL NOT NEEDED (false) when:
- the client did not answer, the line was busy, or it was a wrong number
- it was a short courtesy or check-in call with nothing to confirm
- the note shows the client simply acknowledged something already sent
- nothing was requested, promised or explained

Call outcome: ${outcome || "unknown"}
Call notes:
"""${String(note || "").slice(0, 1200)}"""

If the notes are empty or too vague to tell, answer false.

Reply ONLY JSON: {"emailNeeded": true|false, "why": "<max 10 words>"}`;

module.exports = async function checkCall(d) {
  if (!d.available.calls) return [];
  const inWindow = callsInWindow(d);
  if (!inWindow.length) return [];
  const issues = [];
  const latest = inWindow[0];

  // a) next follow-up task
  if (SETTINGS.CHECK_CALL_TASK && d.available.tasks) {
    const open = d.tasks.filter((t) => {
      const s = String(t.hs_task_subject || "").toLowerCase();
      if (s.startsWith(SETTINGS.TASK_PREFIX.toLowerCase())) return false;
      return !DONE.includes(String(t.hs_task_status || "").toLowerCase());
    });
    if (!open.length)
      issues.push({
        area: "task",
        problem: `Call logged (${latest.outcome || "no outcome"}) but no next task created`,
        action: "create the next follow up task on the case",
        line: "A call is logged but there is no next follow up task, kindly create it",
      });
  }

  // b) follow-up email, only when the call actually called for one
  if (SETTINGS.CHECK_CALL_EMAIL && d.available.emails && hasText(latest.note)) {
    const sentAfter = d.emails.some((e) => !e.incoming && e.when >= latest.when - 2 * 3600000);
    if (!sentAfter) {
      const j = await askJson(EMAIL_NEEDED_PROMPT(latest.outcome, latest.note));
      if (j && j.emailNeeded) {
        issues.push({
          area: "email",
          problem: `Call logged but no follow-up email${j.why ? ` (${j.why})` : ""}`,
          action: "send the client the follow up email for this call",
          line: `The call needed a follow up email${j.why ? ` (${j.why})` : ""}, kindly send it to the client`,
        });
      }
    }
  }

  return issues;
};
