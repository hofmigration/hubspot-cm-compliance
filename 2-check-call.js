// 2-check-call.js — the call is the reason this case is being audited, so it is
// checked strictly.
//
//   a) NEXT TASK — a call was logged and there is no OPEN task for the next follow up.
//   b) SAME-DAY EMAIL — a call was logged and no email went out on that SAME DAY.
//      Same calendar day in PKT, so an email sent earlier that day still counts.
//   c) CALL DESCRIPTION — a call where the client was reached must say what happened.
//
// The email is not demanded blindly: the case is read first. But the default is that
// an email IS expected, and only a clear reason excuses it (wrong number, or the
// client simply acknowledging something already sent). A vague or empty call note is
// never an excuse.
const { SETTINGS } = require("./config");
const { askJson } = require("./0-ai");
const { callsInWindow } = require("./1-fetch");

const DONE = ["completed"];
const PLACEHOLDER = /^(na|n\/a|n\.a\.?|none|nil|-+|\.+|x+)$/i;
const hasText = (t) => { const s = String(t || "").trim(); return s.length >= 3 && !PLACEHOLDER.test(s); };
const REACHED = ["connected", "meeting booked"];

// start of the PKT calendar day that `ms` falls in
function startOfDay(ms) {
  const off = SETTINGS.TZ_OFFSET_HOURS * 3600000;
  return Math.floor((ms + off) / 86400000) * 86400000 - off;
}

const EMAIL_PROMPT = (outcome, note) => `You audit an immigration consultancy's case work. A case manager logged a call with a client and sent NO email that day. Decide whether an email was genuinely not needed.

Assume an email WAS needed unless there is a clear reason it was not. An email is needed whenever anything was discussed, explained, requested, promised, agreed or scheduled, and whenever the client could not be reached and should be followed up in writing.

An email was NOT needed (answer emailNeeded false) ONLY when:
- it was a wrong number, or the call was not with the client at all
- the client only acknowledged something already sent, and nothing new came up
- the call was purely internal, or a duplicate of a call already followed up that day

Call outcome: ${outcome || "unknown"}
Call notes:
"""${String(note || "(no notes were written)").slice(0, 1200)}"""

If the notes are empty or vague, an email is still needed: answer true.

Reply ONLY JSON: {"emailNeeded": true|false, "why": "<max 10 words>"}`;

module.exports = async function checkCall(d) {
  if (!d.available.calls) return [];
  const inWindow = callsInWindow(d);
  if (!inWindow.length) return [];

  const issues = [];
  const latest = inWindow[0];
  const reached = REACHED.includes(String(latest.outcome).toLowerCase());

  // ---- a) next follow-up task ----
  if (SETTINGS.CHECK_CALL_TASK && d.available.tasks) {
    const open = d.tasks.filter((t) => {
      const s = String(t.hs_task_subject || "").toLowerCase();
      if (s.startsWith(SETTINGS.TASK_PREFIX.toLowerCase())) return false;
      return !DONE.includes(String(t.hs_task_status || "").toLowerCase());
    });
    if (!open.length)
      issues.push({
        area: "task",
        problem: `Call logged (${latest.outcome || "no outcome"}) but no next follow-up task`,
        action: "create the next follow up task on the case",
        line: "A call is logged but there is no next follow up task, kindly create it",
      });
  }

  // ---- b) same-day email ----
  if (SETTINGS.CHECK_CALL_EMAIL && d.available.emails) {
    const callDay = startOfDay(latest.when);
    const sameDay = d.emails.some((e) => !e.incoming && e.when >= callDay);
    if (!sameDay) {
      let needed = true, why = "";
      if (String(latest.outcome).toLowerCase() === "wrong number") {
        needed = false;
      } else {
        const j = await askJson(EMAIL_PROMPT(latest.outcome, latest.note));
        // no AI answer -> stay strict, an email is still expected
        if (j && j.emailNeeded === false) { needed = false; why = j.why || ""; }
        else if (j) why = j.why || "";
      }
      if (needed)
        issues.push({
          area: "email",
          problem: `Call logged but no email sent the same day${why ? ` (${why})` : ""}`,
          action: "send the client the follow up email for this call",
          line: "A call was made and no email was sent to the client the same day, kindly send the follow up email",
        });
    }
  }

  // ---- c) call description ----
  if (SETTINGS.CHECK_CALL_DESCRIPTION && reached && !hasText(latest.note))
    issues.push({
      area: "calldesc",
      problem: `"${latest.outcome}" call but no description logged`,
      action: "log what was discussed on the call",
      line: "The call is logged with no description, kindly write what was discussed",
    });

  return issues;
};
module.exports.startOfDay = startOfDay;
