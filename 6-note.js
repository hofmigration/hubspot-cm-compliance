// 6-note.js — writes the compliance note in Ali's style and posts it on the deal.
// A real HubSpot mention is used (the same markup the UI produces), and the note is
// owned by Ali so it reads as coming from compliance.
//
// For a mention chase the note tags the PERSON WHO OWES THE REPLY, not the case
// manager — and it carries a short line inviting anyone who already replied in a
// comment to ignore it, because comments are invisible to this agent.
const { hub } = require("./0-hubspot");
const { SETTINGS } = require("./config");

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const mentionHtml = (id, name) => {
  const n = esc(name || "there");
  return `<strong><span data-mention-id="${esc(id)}" data-mention-name="${n}" style="color: #425b76;font-weight: 600;">@${n}</span></strong>`;
};

function sentence(issue, index) {
  if (index === 0 && issue.line) return issue.line;
  return index === 0 ? `Kindly ${issue.action}` : `Also ${issue.action}`;
}

function uniqueIssues(issues) {
  const seen = new Set(), out = [];
  for (const i of issues) { const k = i.line || i.action; if (!seen.has(k)) { seen.add(k); out.push(i); } }
  return out;
}

// Who should the note tag? A mention chase tags the person who owes the reply.
function tagTarget(issues, ownerId, ownerName) {
  const chase = issues.find((i) => i.area === "mention");
  return chase ? { id: chase.mentionId, name: chase.mentionName || "there" } : { id: ownerId, name: ownerName };
}

function buildNoteHtml(issues, ownerId, ownerName) {
  const P = (i) => `<p style="margin:0;">${i}</p>`;
  const list = uniqueIssues(issues);
  const target = tagTarget(list, ownerId, ownerName);
  const lines = [P(`Hi ${mentionHtml(target.id, target.name)}`)];
  list.forEach((iss, i) => lines.push(P(esc(sentence(iss, i)))));
  if (SETTINGS.MENTION_COMMENT_CAVEAT && list.some((i) => i.area === "mention"))
    lines.push(P(`<span style="color:#7c8aa5;">If you have already replied in a comment, kindly ignore this.</span>`));
  lines.push(P("Thank you"));
  return `<div style="" dir="auto" data-top-level="true">${lines.join("")}</div>`;
}

const composeNote = (issues, ownerName) => {
  const list = uniqueIssues(issues);
  const chase = list.find((i) => i.area === "mention");
  const who = chase ? (chase.mentionName || "there") : ownerName;
  return `Hi @${who} | ` + list.map((iss, i) => sentence(iss, i)).join(" | ") + " | Thank you";
};

async function postNote(dealId, issues, ownerId, ownerName) {
  await hub("POST", "/crm/v3/objects/notes", {
    properties: {
      hs_timestamp: new Date().toISOString(),
      hs_note_body: buildNoteHtml(issues, ownerId, ownerName),
      hubspot_owner_id: String(SETTINGS.NOTE_OWNER_ID),
    },
    associations: [{ to: { id: String(dealId) }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 }] }],
  });
}

module.exports = { composeNote, buildNoteHtml, postNote, tagTarget };
