// 0-hubspot.js — shared HubSpot helpers.
// A lookup that FAILS must never look like "no data".
const TOKEN = process.env.HUBSPOT_TOKEN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hub(method, path, body) {
  const url = `https://api.hubapi.com${path}`;
  for (let a = 0; a < 6; a++) {
    const res = await fetch(url, {
      method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) { await sleep(2000 * (a + 1)); continue; }
    if (!res.ok) { const t = await res.text(); const e = new Error(`${method} ${path} -> ${res.status}: ${t.slice(0, 200)}`); e.status = res.status; throw e; }
    return res.status === 204 ? null : res.json();
  }
  throw new Error(`rate-limited: ${method} ${path}`);
}

const warned = new Set();
function warnOnce(type, msg) {
  if (warned.has(type)) return;
  warned.add(type);
  console.log(`!! LOOKUP FAILED for "${type}" — ${msg}`);
}

async function assocIds(fromType, id, toType) {
  let lastErr, anyOk = false;
  for (const version of ["v4", "v3"]) {
    try {
      const d = await hub("GET", `/crm/${version}/objects/${fromType}/${id}/associations/${toType}?limit=200`);
      anyOk = true;
      const ids = (d.results || []).map((r) => r.toObjectId || r.id).filter(Boolean);
      if (ids.length) return { ids, ok: true };
    } catch (e) { lastErr = e; }
  }
  if (anyOk) return { ids: [], ok: true };
  warnOnce(toType, lastErr?.message || "unknown error");
  return { ids: [], ok: false };
}

async function batchRead(objectType, ids, properties) {
  if (!ids.length) return { records: [], ok: true };
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    try {
      const d = await hub("POST", `/crm/v3/objects/${objectType}/batch/read`, { properties, inputs: ids.slice(i, i + 100).map((x) => ({ id: String(x) })) });
      out.push(...(d.results || []));
    } catch (e) { warnOnce(`${objectType} (read)`, e.message); return { records: out, ok: false }; }
  }
  return { records: out, ok: true };
}

// email -> { id, name } for every owner, so only addresses need configuring
async function ownersByEmail() {
  const map = {}; let after;
  for (const archived of [false, true]) {
    after = undefined;
    for (let i = 0; i < 30; i++) {
      const d = await hub("GET", `/crm/v3/owners/?limit=100&archived=${archived}${after ? `&after=${after}` : ""}`);
      for (const o of d.results || []) {
        const key = String(o.email || "").toLowerCase();
        if (key && !map[key]) map[key] = { id: String(o.id), name: [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || o.email, active: !archived };
      }
      after = d.paging?.next?.after; if (!after) break;
    }
  }
  return map;
}

const strip = (h) => (h || "")
  .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const when = (p) => Date.parse(p.hs_timestamp || p.hs_createdate || p.createdate || 0) || 0;

module.exports = { hub, assocIds, batchRead, ownersByEmail, strip, when };
