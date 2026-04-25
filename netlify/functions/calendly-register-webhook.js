// netlify/functions/calendly-register-webhook.js
// One-shot helper: creates a Calendly webhook subscription pointing at
// calendly-webhook-zoho.js. Generates a fresh signing key, registers it with
// Calendly, and returns it so you can paste it into Netlify env as
// CALENDLY_WEBHOOK_SIGNING_KEY. Run once during setup; rerun if you ever
// rotate the key.
//
// Required env vars:
//   CALENDLY_API_TOKEN   (Calendly personal access token)
//
// Usage:
//   GET /.netlify/functions/calendly-register-webhook?confirm=yes
//
// After running:
//   1. Copy the `signing_key` from the response into Netlify env as CALENDLY_WEBHOOK_SIGNING_KEY
//   2. Trigger a redeploy (env var changes don't auto-rebuild functions)

const https = require("https");
const crypto = require("crypto");

const CALENDLY_API_TOKEN = process.env.CALENDLY_API_TOKEN;

function calendlyRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "api.calendly.com",
      path,
      method,
      headers: {
        Authorization: `Bearer ${CALENDLY_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    };
    if (bodyStr) opts.headers["Content-Length"] = Buffer.byteLength(bodyStr);

    const req = https.request(opts, (res) => {
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

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  if (qs.confirm !== "yes") {
    return json(400, { error: "this endpoint mutates Calendly state — pass ?confirm=yes" });
  }
  if (!CALENDLY_API_TOKEN) return json(500, { error: "CALENDLY_API_TOKEN not configured" });

  try {
    const me = await calendlyRequest("GET", "/users/me");
    if (me.status !== 200) return json(500, { error: "Calendly /users/me failed", body: me.data });

    const userUri = me.data.resource.uri;
    const orgUri = me.data.resource.current_organization;
    const host = event.headers.host || event.headers.Host;
    if (!host) return json(500, { error: "could not derive host from request headers" });
    const callbackUrl = `https://${host}/.netlify/functions/calendly-webhook-zoho`;

    const signingKey = crypto.randomBytes(32).toString("hex");

    // List existing subscriptions for this callback URL and delete to avoid duplicates
    const existing = await calendlyRequest("GET", `/webhook_subscriptions?organization=${encodeURIComponent(orgUri)}&user=${encodeURIComponent(userUri)}&scope=user`);
    if (existing.status === 200) {
      for (const sub of existing.data.collection || []) {
        if (sub.callback_url === callbackUrl) {
          const subUuid = sub.uri.split("/").pop();
          await calendlyRequest("DELETE", `/webhook_subscriptions/${subUuid}`);
        }
      }
    }

    const create = await calendlyRequest("POST", "/webhook_subscriptions", {
      url: callbackUrl,
      events: ["invitee.created", "invitee.canceled"],
      organization: orgUri,
      user: userUri,
      scope: "user",
      signing_key: signingKey,
    });

    if (create.status !== 201) {
      return json(500, { error: "Calendly subscription creation failed", status: create.status, body: create.data });
    }

    return json(200, {
      ok: true,
      subscription_uri: create.data.resource.uri,
      callback_url: callbackUrl,
      signing_key: signingKey,
      next_steps: [
        `1. Set Netlify env var CALENDLY_WEBHOOK_SIGNING_KEY=${signingKey}`,
        "2. Trigger a redeploy so the new env var is picked up by calendly-webhook-zoho",
        "3. Test with a Calendly booking; check Supabase crm_sync_log",
      ],
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
