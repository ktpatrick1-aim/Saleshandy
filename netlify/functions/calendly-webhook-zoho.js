// netlify/functions/calendly-webhook-zoho.js
// Receives Calendly webhook events and is the ONLY pipe that creates Zoho Leads.
// Policy (project_saleshandy_zoho_routing): only Calendly-booked people belong
// in Zoho. Saleshandy's native Zoho integration must be disconnected — see
// SALESHANDY-SETUP.md for the manual cutover step.
//
// Subscribed events: invitee.created, invitee.canceled
//
// Required env vars:
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET            (existing)
//   SUPABASE_URL, SUPABASE_SERVICE_KEY            (existing)
//   CALENDLY_WEBHOOK_SIGNING_KEY                  (new — issued by Calendly when you create the subscription)

const https = require("https");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const CALENDLY_WEBHOOK_SIGNING_KEY = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BOOKED_TAG = "calendly-booked";
const CANCELED_TAG = "calendly-canceled";
const NOISE_TAG = "noise-no-calendly-booking";
const BOOKED_STATUS = "Qualified";

// ── Calendly signature verification ─────────────────────────
// Header format: t=<unix>,v1=<hex_hmac_sha256_of_`${t}.${rawBody}`>

function verifyCalendlySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const parts = {};
  for (const seg of signatureHeader.split(",")) {
    const [k, v] = seg.split("=");
    if (k && v !== undefined) parts[k.trim()] = v.trim();
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  const ageSec = Math.abs(Date.now() / 1000 - parseInt(t, 10));
  if (!Number.isFinite(ageSec) || ageSec > 180) return false;

  const expected = crypto
    .createHmac("sha256", CALENDLY_WEBHOOK_SIGNING_KEY)
    .update(`${t}.${rawBody}`)
    .digest("hex");

  if (expected.length !== v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}

// ── Zoho auth (mirrors saleshandy-webhook.js) ───────────────

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

// ── Domain logic ────────────────────────────────────────────

function splitName(full) {
  const parts = (full || "").trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return { first: "Unknown", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

async function handleInviteeCreated(accessToken, invitee) {
  const email = (invitee.email || "").trim().toLowerCase();
  if (!email) throw new Error("invitee.created with no email");

  const { first, last } = splitName(invitee.name);
  const evt = invitee.scheduled_event || {};
  const description = [
    `Calendly booking: ${evt.name || "(unnamed event)"}`,
    `Scheduled: ${evt.start_time} → ${evt.end_time}`,
    evt.location?.join_url ? `Join: ${evt.location.join_url}` : null,
    invitee.timezone ? `Invitee TZ: ${invitee.timezone}` : null,
  ].filter(Boolean).join("\n");

  const upsertResp = await zohoRequest("POST", "/Leads/upsert", accessToken, {
    data: [{
      Email: invitee.email,
      First_Name: first,
      Last_Name: last || "(unknown)",
      Lead_Source: "Calendly",
      Lead_Status: BOOKED_STATUS,
      Description: description,
    }],
    duplicate_check_fields: ["Email"],
  });

  const record = upsertResp.data?.data?.[0];
  if (!record || !record.details?.id) {
    throw new Error("Zoho upsert failed: " + JSON.stringify(upsertResp.data));
  }
  const leadId = record.details.id;

  // Tag as booked, remove the "noise" tag if a prior cleanup had set it
  await zohoRequest("POST", `/Leads/actions/add_tags?ids=${leadId}&tag_names=${encodeURIComponent(BOOKED_TAG)}`, accessToken);
  await zohoRequest("POST", `/Leads/actions/remove_tags?ids=${leadId}&tag_names=${encodeURIComponent(NOISE_TAG)}`, accessToken);

  return { leadId, action: record.action }; // action = "insert" or "update"
}

async function handleInviteeCanceled(accessToken, invitee) {
  const email = (invitee.email || "").trim().toLowerCase();
  if (!email) return { skipped: "no email" };

  const search = await zohoRequest("GET", `/Leads/search?email=${encodeURIComponent(invitee.email)}`, accessToken);
  if (search.status === 204 || !search.data?.data?.length) {
    return { skipped: "no matching lead" };
  }
  const leadId = search.data.data[0].id;
  await zohoRequest("POST", `/Leads/actions/add_tags?ids=${leadId}&tag_names=${encodeURIComponent(CANCELED_TAG)}`, accessToken);
  return { leadId, action: "tagged_canceled" };
}

// ── Handler ─────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "method not allowed" };
  }

  if (!CALENDLY_WEBHOOK_SIGNING_KEY) {
    return { statusCode: 500, body: "CALENDLY_WEBHOOK_SIGNING_KEY not configured" };
  }

  const rawBody = event.body || "";
  const sigHeader = event.headers["calendly-webhook-signature"] || event.headers["Calendly-Webhook-Signature"];
  if (!verifyCalendlySignature(rawBody, sigHeader)) {
    return { statusCode: 401, body: "invalid signature" };
  }

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return { statusCode: 400, body: "invalid json" }; }

  const eventType = payload.event;
  const invitee = payload.payload;
  if (!eventType || !invitee) return { statusCode: 400, body: "missing event or payload" };

  try {
    const accessToken = await getZohoAccessToken();
    let result;
    if (eventType === "invitee.created") {
      result = await handleInviteeCreated(accessToken, invitee);
    } else if (eventType === "invitee.canceled") {
      result = await handleInviteeCanceled(accessToken, invitee);
    } else {
      return { statusCode: 200, body: JSON.stringify({ ignored: eventType }) };
    }

    await supabase.from("crm_sync_log").insert({
      source: "calendly",
      direction: "inbound",
      entity_type: "lead",
      entity_id: result.leadId || null,
      email: invitee.email,
      payload: { event: eventType, invitee_uri: invitee.uri, result },
      status: "success",
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, event: eventType, result }) };
  } catch (err) {
    await supabase.from("crm_sync_log").insert({
      source: "calendly",
      direction: "inbound",
      entity_type: "lead",
      email: invitee.email,
      payload: { event: eventType, invitee_uri: invitee.uri },
      status: "error",
      error_msg: err.message,
    });
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
