// 1-fetch.js — finds the cases to audit and loads everything the checks need.
// Scope: deals owned by the 12 case managers, touched inside the window, with a CALL
// LOGGED inside that window, and matching the client / application status filters.
const { hub, assocIds, batchRead, strip, when } = require("./0-hubspot");
const { SETTINGS } = require("./config");

const STANDARD_DISPOSITIONS = {
  "9d9162e7-6cf3-4944-bf63-4dff82258764": "Busy",
  "f240bbac-87c9-4f6e-bf70-924b57d47db7": "Connected",
  "a4c4c377-d246-4b32-a13b-75a56a4cd0ff": "Left live message",
  "b2cf5968-551e-4856-9783-52b3da59a7d0": "Left voicemail",
  "2e7360c1-6b71-40e9-ab2b-30ae98a4678c": "Meeting booked",
  "73a0d17f-1163-4015-bdd5-ec830791da20": "No answer",
  "17b47fee-58de-441e-a44c-c6300d46f273": "Wrong number",
};

const windowStart = () => (SETTINGS.TOUCHED_WITHIN_HOURS ? Date.now() - SETTINGS.TOUCHED_WITHIN_HOURS * 3600000 : 0);

async function dispositions() {
  try {
    const p = await hub("GET", "/crm/v3/properties/calls/hs_call_disposition");
    const m = { ...STANDARD_DISPOSITIONS };
    for (const o of p.options || []) m[o.value] = o.label;
    return m;
  } catch { return { ...STANDARD_DISPOSITIONS }; }
}

async function fetchDeals(ownerIds) {
  const start = windowStart();
  const filters = [{ propertyName: "hubspot_owner_id", operator: "IN", values: ownerIds }];
  if (SETTINGS.CLIENT_STATUS_ALLOWED.length)
    filters.push({ propertyName: "client_status", operator: "IN", values: SETTINGS.CLIENT_STATUS_ALLOWED });
  if (SETTINGS.APPLICATION_STATUS_ALLOWED.length)
    filters.push({ propertyName: "application_status", operator: "IN", values: SETTINGS.APPLICATION_STATUS_ALLOWED });

  const props = ["dealname", "hubspot_owner_id", "client_status", "application_status",
    "dealstage", "pipeline", "notes_last_contacted"];

  const out = []; let after;
  for (let page = 0; page < 200; page++) {
    const d = await hub("POST", "/crm/v3/objects/deals/search", {
      filterGroups: [{ filters }],
      sorts: [{ propertyName: "notes_last_contacted", direction: "DESCENDING" }],
      properties: props, limit: 100, after,
    });
    let stop = false;
    for (const deal of d.results || []) {
      const lc = deal.properties.notes_last_contacted ? Date.parse(deal.properties.notes_last_contacted) : 0;
      if (start && lc && lc < start) { stop = true; break; }
      out.push(deal);
      if (SETTINGS.MAX_DEALS && out.length >= SETTINGS.MAX_DEALS) { stop = true; break; }
    }
    after = d.paging?.next?.after;
    if (stop || !after) break;
  }
  return out;
}

// pulls every @mention out of a note body: <span data-mention-id="123" data-mention-name="X">
function mentionsIn(html) {
  const out = [];
  const re = /data-mention-id="(\d+)"[^>]*data-mention-name="([^"]*)"/g;
  let m;
  while ((m = re.exec(String(html || "")))) out.push({ id: m[1], name: m[2] });
  return out;
}

async function attach(deal, dispoMap) {
  const [callA, emailA, taskA, noteA, contactA] = await Promise.all([
    assocIds("deals", deal.id, "calls"), assocIds("deals", deal.id, "emails"),
    assocIds("deals", deal.id, "tasks"), assocIds("deals", deal.id, "notes"),
    assocIds("deals", deal.id, "contacts"),
  ]);
  const [callR, emailR, taskR, noteR, contactR] = await Promise.all([
    batchRead("calls", callA.ids, ["hs_call_body", "hs_call_title", "hs_call_disposition", "hs_timestamp", "hs_createdate", "hubspot_owner_id"]),
    batchRead("emails", emailA.ids, ["hs_email_subject", "hs_email_text", "hs_email_html", "hs_email_direction", "hs_timestamp", "hs_createdate"]),
    batchRead("tasks", taskA.ids, ["hs_task_subject", "hs_task_status", "hs_timestamp", "hs_createdate"]),
    batchRead("notes", noteA.ids, ["hs_note_body", "hs_body_preview", "hs_timestamp", "hs_createdate", "hubspot_owner_id", "hs_created_by"]),
    batchRead("contacts", contactA.ids, ["firstname", "lastname", "email"]),
  ]);

  const available = {
    calls: callA.ok && callR.ok, emails: emailA.ok && emailR.ok,
    tasks: taskA.ok && taskR.ok, notes: noteA.ok && noteR.ok, contact: contactA.ok && contactR.ok,
  };
  const p = deal.properties;
  const contact = contactR.records[0]?.properties || null;

  const calls = callR.records.map((x) => ({
    id: x.id, when: when(x.properties),
    outcome: dispoMap[x.properties.hs_call_disposition] || x.properties.hs_call_disposition || "",
    note: strip(x.properties.hs_call_body || x.properties.hs_call_title),
    ownerId: x.properties.hubspot_owner_id || null,
  })).sort((a, b) => b.when - a.when);

  const emails = emailR.records.map((x) => {
    const pr = x.properties;
    return {
      id: x.id, when: when(pr),
      incoming: String(pr.hs_email_direction || "").toUpperCase() === "INCOMING_EMAIL",
      subject: pr.hs_email_subject || "",
      text: strip(pr.hs_email_text || pr.hs_email_html).slice(0, 4000),
    };
  }).filter((e) => e.when).sort((a, b) => b.when - a.when);

  const notes = noteR.records.map((x) => {
    const pr = x.properties;
    return {
      id: x.id, when: when(pr),
      authorId: String(pr.hubspot_owner_id || pr.hs_created_by || ""),
      text: pr.hs_body_preview || strip(pr.hs_note_body),
      mentions: mentionsIn(pr.hs_note_body),
      raw: pr.hs_note_body || "",
    };
  }).sort((a, b) => b.when - a.when).slice(0, SETTINGS.MAX_NOTES_PER_DEAL);

  return {
    id: deal.id,
    name: p.dealname || (contact ? [contact.firstname, contact.lastname].filter(Boolean).join(" ") : `Deal ${deal.id}`),
    ownerId: p.hubspot_owner_id,
    clientStatus: p.client_status || null,
    applicationStatus: p.application_status || null,
    lastTouched: p.notes_last_contacted ? Date.parse(p.notes_last_contacted) : 0,
    available, calls, emails, tasks: taskR.records.map((x) => x.properties), notes,
    contactName: contact ? [contact.firstname, contact.lastname].filter(Boolean).join(" ").trim() : "",
  };
}

// the calls logged inside the audit window — the reason this case is being audited
const callsInWindow = (d) => {
  const start = windowStart();
  return d.calls.filter((c) => !start || c.when >= start);
};

module.exports = { fetchDeals, attach, dispositions, windowStart, callsInWindow, mentionsIn };
