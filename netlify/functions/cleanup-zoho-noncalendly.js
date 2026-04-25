// netlify/functions/cleanup-zoho-noncalendly.js
// One-shot backfill: tags Zoho Leads that were created in the last N days
// but whose email does NOT appear in the Calendly booked-invitee set.
//
// Policy: only Calendly-booked leads belong in Zoho. Everything else is noise.
// This function does NOT delete — it tags the lead `noise-no-calendly-booking`
// and sets Lead_Status to "Junk Lead" so you can bulk-review in the Zoho UI
// and hard-delete from there once you've eyeballed the list.
//
// Usage:
//   GET /.netlify/functions/cleanup-zoho-noncalendly
//     → default dry run, last 14 days, returns hit list only
//   GET /.netlify/functions/cleanup-zoho-noncalendly?days=14&dryRun=false&confirm=yes
//     → actually archives
//
// Required env vars (same as saleshandy-webhook.js, plus CALENDLY_API_TOKEN):
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   CALENDLY_API_TOKEN  ← new; Calendly personal access token

const https = require("https");
const { createClient } = require("@supabase/supabase-js");

const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const CALENDLY_API_TOKEN = process.env.CALENDLY_API_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const NOISE_TAG = "noise-no-calendly-booking";
const NOISE_STATUS = "Junk Lead";
const CALENDLY_LOOKBACK_DAYS = 90;
const CALENDLY_LOOKAHEAD_DAYS = 365;

// ── Zoho auth (identical pattern to saleshandy-webhook.js) ──

async function getZohoAccessToken() {
  const { data: tokens, error } = await supabase
    .from("zoho_tokens").select("*").eq("id", "default").single();
  if (error || !tokens) throw new Error("Zoho tokens not initialized");

  const expiresAt = new Date(tokens.expires_at).getTime();
  if (expiresAt > Date.now() + 5 * 60 * 1000) return tokens.access_token;

  const postData = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    refresh_token: tokens.refresh_token,
  }).toString();

  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "accounts.zoho.com",
      path: "/oauth/v2/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(postData) },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { reject(new Error("Token parse error")); } });
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });

  if (result.error) throw new Error("Zoho token refresh failed: " + result.error);

  await supabase.from("zoho_tokens").update({
    access_token: result.access_token,
    expires_at: new Date(Date.now() + (result.expires_in || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", "default");

  return result.access_token;
}

function zohoRequest(method, path, accessToken, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "www.zohoapis.com",
      path: `/crm/v6${path}`,
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
    };
    if (bodyStr) options.headers["Content-Length"] = Buffer.byteLength(bodyStr);

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Calendly helpers ────────────────────────────────────────

function calendlyRequest(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.calendly.com",
      path,
      method: "GET",
      headers: {
        Authorization: `Bearer ${CALENDLY_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function fetchCalendlyBookedEmails() {
  const me = await calendlyRequest("/users/me");
  if (me.status !== 200 || !me.data?.resource?.uri) {
    throw new Error("Calendly /users/me failed: " + JSON.stringify(me.data));
  }
  const userUri = me.data.resource.uri;

  const minStart = new Date(Date.now() - CALENDLY_LOOKBACK_DAYS * 86400e3).toISOString();
  const maxStart = new Date(Date.now() + CALENDLY_LOOKAHEAD_DAYS * 86400e3).toISOString();

  const emails = new Set();
  let nextPage = `/scheduled_events?user=${encodeURIComponent(userUri)}&min_start_time=${minStart}&max_start_time=${maxStart}&count=100`;

  while (nextPage) {
    const resp = await calendlyRequest(nextPage);
    if (resp.status !== 200) throw new Error("Calendly events list failed: " + JSON.stringify(resp.data));

    for (const evt of resp.data.collection || []) {
      const uuid = evt.uri.split("/").pop();
      const inv = await calendlyRequest(`/scheduled_events/${uuid}/invitees?count=100`);
      if (inv.status !== 200) continue;
      for (const invitee of inv.data.collection || []) {
        if (invitee.email) emails.add(invitee.email.trim().toLowerCase());
      }
    }

    const next = resp.data.pagination?.next_page;
    nextPage = next ? next.replace("https://api.calendly.com", "") : null;
  }

  return emails;
}

// ── Zoho lead listing (last N days) ─────────────────────────

async function fetchRecentZohoLeads(accessToken, days) {
  // Zoho rejects the trailing "Z" + millisecond ISO format; it wants
  // explicit +00:00 offset and no fractional seconds.
  // e.g. 2026-04-10T00:00:00+00:00
  const sinceIso = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 19) + "+00:00";
  const criteria = `(Created_Time:greater_equal:${sinceIso})`;

  const leads = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const path = `/Leads/search?criteria=${encodeURIComponent(criteria)}&page=${page}&per_page=${perPage}`;
    const resp = await zohoRequest("GET", path, accessToken);

    if (resp.status === 204) break; // no records
    if (resp.status !== 200) throw new Error(`Zoho Leads search failed (page ${page}): ${JSON.stringify(resp.data)}`);

    const batch = resp.data.data || [];
    leads.push(...batch);

    if (!resp.data.info?.more_records) break;
    page += 1;
    if (page > 50) break; // safety cap: 10k leads
  }

  return leads;
}

// ── Archive action ──────────────────────────────────────────

async function archiveLeads(accessToken, leadIds) {
  const results = { tagged: 0, statusUpdated: 0, errors: [] };

  // Zoho tag endpoint accepts up to 100 ids per call
  for (let i = 0; i < leadIds.length; i += 100) {
    const chunk = leadIds.slice(i, i + 100);
    const idsParam = chunk.join(",");
    const tagResp = await zohoRequest(
      "POST",
      `/Leads/actions/add_tags?ids=${idsParam}&tag_names=${encodeURIComponent(NOISE_TAG)}`,
      accessToken,
    );
    if (tagResp.status === 200) results.tagged += chunk.length;
    else results.errors.push({ op: "tag", chunk: i, status: tagResp.status, body: tagResp.data });
  }

  // Update Lead_Status in batches of 100
  for (let i = 0; i < leadIds.length; i += 100) {
    const chunk = leadIds.slice(i, i + 100);
    const body = { data: chunk.map((id) => ({ id, Lead_Status: NOISE_STATUS })) };
    const updResp = await zohoRequest("PUT", `/Leads`, accessToken, body);
    if (updResp.status === 200) results.statusUpdated += chunk.length;
    else results.errors.push({ op: "status", chunk: i, status: updResp.status, body: updResp.data });
  }

  return results;
}

// ── Handler ─────────────────────────────────────────────────

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const dryRun = qs.dryRun !== "false"; // default true
  const days = Math.max(1, Math.min(90, parseInt(qs.days || "14", 10)));
  const confirm = qs.confirm === "yes";

  try {
    if (!CALENDLY_API_TOKEN) throw new Error("CALENDLY_API_TOKEN env var is required");
    if (!dryRun && !confirm) {
      return json(400, { error: "dryRun=false requires confirm=yes to proceed" });
    }

    const [accessToken, bookedEmails] = await Promise.all([
      getZohoAccessToken(),
      fetchCalendlyBookedEmails(),
    ]);

    const leads = await fetchRecentZohoLeads(accessToken, days);

    const hits = [];
    for (const lead of leads) {
      const email = (lead.Email || "").trim().toLowerCase();
      if (!email) continue; // skip leads with no email — can't evaluate
      if (bookedEmails.has(email)) continue;
      hits.push({
        id: lead.id,
        email: lead.Email,
        name: `${lead.First_Name || ""} ${lead.Last_Name || ""}`.trim(),
        company: lead.Company || null,
        created: lead.Created_Time,
        status: lead.Lead_Status,
      });
    }

    let actionResults = null;
    if (!dryRun && hits.length > 0) {
      actionResults = await archiveLeads(accessToken, hits.map((h) => h.id));
      await supabase.from("crm_sync_log").insert({
        source: "cleanup-zoho-noncalendly",
        direction: "outbound",
        entity_type: "lead_bulk_archive",
        entity_id: null,
        email: null,
        payload: { days, hit_count: hits.length, hit_ids: hits.map((h) => h.id), results: actionResults },
        status: actionResults.errors.length === 0 ? "success" : "partial_error",
        error_msg: actionResults.errors.length ? JSON.stringify(actionResults.errors).slice(0, 2000) : null,
      });
    }

    return json(200, {
      dryRun,
      days,
      calendly_booked_emails: bookedEmails.size,
      zoho_leads_in_window: leads.length,
      noise_count: hits.length,
      action: dryRun ? "none (dry run)" : "tagged + status updated",
      results: actionResults,
      hits: hits.slice(0, 500), // cap response payload
      truncated: hits.length > 500,
    });
  } catch (err) {
    return json(500, { error: err.message, stack: err.stack });
  }
};

function json(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body, null, 2),
  };
}
