// netlify/functions/zoho-bootstrap.js
// One-shot helper to mint a fresh Zoho refresh_token from a self-client
// authorization code and write it into Supabase `zoho_tokens`.
//
// When to use: any time `Zoho token refresh failed: invalid_code` shows up
// in another function — Zoho auto-revokes refresh tokens that go unused
// for ~90 days, so this re-bootstraps the OAuth state.
//
// Steps for the human:
//   1. Go to https://api-console.zoho.com → open the existing client
//      (the one whose ID matches ZOHO_CLIENT_ID).
//   2. "Generate Code" tab. Scopes:
//        ZohoCRM.modules.ALL,ZohoCRM.settings.ALL
//      Time duration: 10 minutes. Description: "saleshandy bootstrap".
//   3. Copy the code (looks like `1000.xxxxxxxxx`).
//   4. Hit:
//        curl -X POST 'https://saleshandy-outbound.netlify.app/.netlify/functions/zoho-bootstrap?code=<code>&confirm=yes'
//      Within 10 minutes (codes expire fast).
//
// What it does:
//   - Exchanges the code at accounts.zoho.com/oauth/v2/token for an
//     access_token + refresh_token.
//   - Upserts `zoho_tokens.id='default'` in Supabase with both tokens
//     and the new expiry.

const https = require("https");
const { createClient } = require("@supabase/supabase-js");

const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function exchangeCode(code) {
  const postData = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    code,
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "accounts.zoho.com",
      path: "/oauth/v2/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
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
    req.write(postData);
    req.end();
  });
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  if (qs.confirm !== "yes") {
    return json(400, { error: "this rewrites zoho_tokens — pass ?confirm=yes" });
  }
  const code = qs.code;
  if (!code) return json(400, { error: "?code=<self-client code from api-console.zoho.com> required" });

  try {
    const resp = await exchangeCode(code);
    if (resp.status !== 200 || !resp.data.refresh_token) {
      return json(500, { error: "Zoho code exchange failed", body: resp.data });
    }

    const expiresAt = new Date(Date.now() + (resp.data.expires_in || 3600) * 1000).toISOString();

    const { error } = await supabase.from("zoho_tokens").upsert({
      id: "default",
      access_token: resp.data.access_token,
      refresh_token: resp.data.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });
    if (error) return json(500, { error: "Supabase upsert failed", body: error });

    return json(200, {
      ok: true,
      message: "zoho_tokens refreshed",
      expires_at: expiresAt,
      api_domain: resp.data.api_domain,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

function json(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body, null, 2),
  };
}
