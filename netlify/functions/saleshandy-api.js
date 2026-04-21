// netlify/functions/saleshandy-api.js
// Utility endpoints for SalesHandy integration:
//   - Build prospect lists from raw data (auto-score, classify, assign sequence, tag, Zoho upsert)
//   - Import prospects into SalesHandy sequences
//   - Tag/untag prospects
//   - Query sequence stats
// Called from admin dashboard or Zoho workflows
//
// The "build" action replaces Apollo's enrichment intelligence:
//   - Lead scoring (company size, title seniority, industry, email domain, LinkedIn, funding, HR tech stack)
//   - Title seniority classification (C-Suite, VP, Director, Manager, IC)
//   - Company size banding (SMB, Mid-Market, Enterprise)
//   - Auto-sequence assignment based on score + campaign type
//   - Auto-tagging (hr-leader, c-suite, mid-market, etc.)
//   - Zoho CRM lead upsert with all enrichment fields
//   - Deal value estimation

const https = require("https");
const { createClient } = require("@supabase/supabase-js");
const {
  calculateLeadScore,
  classifyTitleSeniority,
  getCompanySizeBand,
  estimateDealMetrics,
  generateAutoTags,
  mapRoutedPropertyToCampaign,
  extractJsonFromText,
} = require("./saleshandy-shared");
const {
  checkSenderCapacity,
  incrementSenderCount,
  getSenderHealthReport,
  manageSender,
} = require("./saleshandy-sender");

// ── Credentials ──────────────────────────────────────────────
const SALESHANDY_API_KEY = process.env.SALESHANDY_API_KEY;
const SALESHANDY_BASE = "open-api.saleshandy.com";
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function validateSaleshandyFields(options = {}) {
  const enrichmentEnabled = !!options.enrichmentEnabled;
  const needed = [
    "SH_FIELD_LEAD_SCORE",
    "SH_FIELD_COMPANY_SIZE",
    "SH_FIELD_SENIORITY",
    "SH_FIELD_ZOHO_ID",
  ];

  if (enrichmentEnabled) {
    needed.push(
      "SH_FIELD_COMPANY_CONTEXT",
      "SH_FIELD_PAIN_POINTS",
      "SH_FIELD_ROUTED_PROPERTY",
      "SH_FIELD_PERSONALIZED_SEQUENCE"
    );
  }

  const missing = needed.filter((k) => !process.env[k] || process.env[k] === "");
  if (missing.length > 0) {
    console.warn(`Missing required SalesHandy field IDs in env: ${missing.join(", ")}`);
  }
  return missing;
}

// ── Zoho API helpers (matches codebase pattern) ─────────────

async function getZohoAccessToken() {
  const { data: tokens, error } = await supabase
    .from("zoho_tokens")
    .select("*")
    .eq("id", "default")
    .single();

  if (error || !tokens) throw new Error("Zoho tokens not initialized");

  const expiresAt = new Date(tokens.expires_at).getTime();
  if (expiresAt <= Date.now() + 5 * 60 * 1000) {
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

    if (result.error) throw new Error("Token refresh failed: " + result.error);

    await supabase.from("zoho_tokens").update({
      access_token: result.access_token,
      expires_at: new Date(Date.now() + (result.expires_in || 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", "default");

    return result.access_token;
  }

  return tokens.access_token;
}

function zohoApiRequest(method, path, accessToken, body) {
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

// ── Auto-sequence assignment ────────────────────────────────
// Maps campaign + score to the right initial sequence.
// Dream Manager and inbound-referral have dedicated sequences;
// others start with cold outbound.

function assignSequence(campaign, leadScore, isInbound) {
  if (isInbound) return "inbound-referral";
  switch (campaign) {
    case "dream-manager":
      return "lead-nurture-cold";
    case "trinity-forge":
      return "lead-nurture-cold";
    case "trinity-calibrate":
      return "lead-nurture-cold";
    case "unicorn":
      return "lead-nurture-cold";
    default:
      return "lead-nurture-cold";
  }
}

// ── SalesHandy Sequence Step IDs ─────────────────────────────
const SEQUENCES = {
  "lead-nurture-cold": {
    name: "DC Lead Nurture – Cold Outbound",
    senderGroup: "cold-pool",
    stepIds: {
      1: process.env.SH_SEQ_NURTURE_COLD_STEP1 || "",
      2: process.env.SH_SEQ_NURTURE_COLD_STEP2 || "",
      3: process.env.SH_SEQ_NURTURE_COLD_STEP3 || "",
      4: process.env.SH_SEQ_NURTURE_COLD_STEP4 || "",
      5: process.env.SH_SEQ_NURTURE_COLD_STEP5 || "",
    },
  },
  "lead-nurture-warm": {
    name: "DC Lead Nurture – Warm (Engaged)",
    senderGroup: "warm-pool",
    stepIds: {
      1: process.env.SH_SEQ_NURTURE_WARM_STEP1 || "",
      2: process.env.SH_SEQ_NURTURE_WARM_STEP2 || "",
      3: process.env.SH_SEQ_NURTURE_WARM_STEP3 || "",
    },
  },
  "trial-activation": {
    name: "DC Trial Activation",
    senderGroup: "warm-pool",
    stepIds: {
      1: process.env.SH_SEQ_TRIAL_STEP1 || "",
      2: process.env.SH_SEQ_TRIAL_STEP2 || "",
      3: process.env.SH_SEQ_TRIAL_STEP3 || "",
    },
  },
  "re-engagement": {
    name: "DC Re-Engagement (Stale Leads)",
    senderGroup: "cold-pool",
    stepIds: {
      1: process.env.SH_SEQ_REENGAGE_STEP1 || "",
      2: process.env.SH_SEQ_REENGAGE_STEP2 || "",
      3: process.env.SH_SEQ_REENGAGE_STEP3 || "",
    },
  },
  "post-demo": {
    name: "DC Post-Demo Follow-Up",
    senderGroup: "warm-pool",
    stepIds: {
      1: process.env.SH_SEQ_POSTDEMO_STEP1 || "",
      2: process.env.SH_SEQ_POSTDEMO_STEP2 || "",
      3: process.env.SH_SEQ_POSTDEMO_STEP3 || "",
    },
  },
  "inbound-referral": {
    name: "DC Inbound / Referral Nurture",
    senderGroup: "content-pool",
    stepIds: {
      1: process.env.SH_SEQ_INBOUND_STEP1 || "",
      2: process.env.SH_SEQ_INBOUND_STEP2 || "",
      3: process.env.SH_SEQ_INBOUND_STEP3 || "",
      4: process.env.SH_SEQ_INBOUND_STEP4 || "",
    },
  },
};

// ── SalesHandy Prospect Field IDs ────────────────────────────
const FIELD_IDS = {
  firstName: process.env.SH_FIELD_FIRST_NAME || "GlPYv8WvaV",
  lastName: process.env.SH_FIELD_LAST_NAME || "LVPXoNWdwl",
  email: process.env.SH_FIELD_EMAIL || "Y7PWZEW7wo",
  phone: process.env.SH_FIELD_PHONE || "",
  company: process.env.SH_FIELD_COMPANY || "",
  jobTitle: process.env.SH_FIELD_JOB_TITLE || "",
  website: process.env.SH_FIELD_WEBSITE || "",
  city: process.env.SH_FIELD_CITY || "",
  state: process.env.SH_FIELD_STATE || "",
  country: process.env.SH_FIELD_COUNTRY || "",
  linkedin: process.env.SH_FIELD_LINKEDIN || "",
  leadScore: process.env.SH_FIELD_LEAD_SCORE || "",
  companySizeBand: process.env.SH_FIELD_COMPANY_SIZE || "",
  titleSeniority: process.env.SH_FIELD_SENIORITY || "",
  zohoLeadId: process.env.SH_FIELD_ZOHO_ID || "",
  companyContext: process.env.SH_FIELD_COMPANY_CONTEXT || "",
  painPoints: process.env.SH_FIELD_PAIN_POINTS || "",
  routedProperty: process.env.SH_FIELD_ROUTED_PROPERTY || "",
  personalizedSequence: process.env.SH_FIELD_PERSONALIZED_SEQUENCE || "",
};

// ── Sequence content linter ──────────────────────────────────
// Flags authoring mistakes in Saleshandy sequence step variants that would
// otherwise ship to prospects as-is. Intentionally conservative — only flags
// patterns that are almost certainly wrong, not stylistic preferences.
//
// Patterns detected:
//   - spintax:     literal {a|b|c} that wasn't registered via Saleshandy's
//                  spintax feature. Would send the raw braces to the prospect.
//                  Uses lookarounds to ignore double-brace merge tags.
//   - placeholder: unreplaced [SIGNATURE_URL] or [CTA_URL]-style markers from
//                  the SETUP doc that were pasted but never filled in.
//   - empty:       email step variant with no subject at all.

const SPINTAX_RE = /(?<!\{)\{[^{}\n]{1,400}\|[^{}\n]{0,400}\}(?!\})/g;
const PLACEHOLDER_RE = /\[(SIGNATURE_URL|CTA_URL|UNSUBSCRIBE_URL|CALENDAR_URL|REPLACE[A-Z_]*)\]/g;

function stripHtmlToText(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function findMatches(text, regex) {
  if (!text) return [];
  const out = [];
  const re = new RegExp(regex.source, regex.flags);
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0]);
    if (out.length >= 10) break;
  }
  return out;
}

function lintVariant(variant, channel) {
  const issues = [];
  const subject = variant.subject || "";
  const rawBody = variant.content || variant.body || variant.htmlBody || "";
  const bodyText = stripHtmlToText(rawBody);

  if (channel === "email" && !subject.trim()) {
    issues.push({ kind: "empty-subject", field: "subject", snippet: "" });
  }

  for (const hit of findMatches(subject, SPINTAX_RE)) {
    issues.push({ kind: "spintax", field: "subject", snippet: hit });
  }
  for (const hit of findMatches(bodyText, SPINTAX_RE)) {
    issues.push({ kind: "spintax", field: "body", snippet: hit });
  }

  for (const hit of findMatches(subject, PLACEHOLDER_RE)) {
    issues.push({ kind: "placeholder", field: "subject", snippet: hit });
  }
  for (const hit of findMatches(bodyText, PLACEHOLDER_RE)) {
    issues.push({ kind: "placeholder", field: "body", snippet: hit });
  }

  return issues;
}

// ── SalesHandy API helper ────────────────────────────────────

function saleshandyRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: SALESHANDY_BASE,
      path: `/v1${path}`,
      method,
      headers: {
        "x-api-key": SALESHANDY_API_KEY,
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

async function callClaudeEnrichment(person, organization, raw) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY must be configured for Claude enrichment");

  const systemPrompt = `You are Trinity One Consulting's B2B pipeline intelligence engine. Analyze a salesperson prospect and generate a structured enrichment payload for SalesHandy sequence personalization. Use a direct, consultative tone and be concise.`;

  const userPrompt = `Prospect:
Name: ${person.first_name || ""} ${person.last_name || ""}
Title: ${person.title || ""}
Email: ${person.email || ""}
Company: ${organization.name || ""}
Industry: ${organization.industry || ""}
Employees: ${organization.estimated_num_employees || "unknown"}
Location: ${organization.location || ""}
Website: ${organization.domain || ""}
LinkedIn: ${person.linkedin_url || ""}
Additional context: ${raw.notes || raw.context || "N/A"}

Generate output as valid JSON only with exactly these keys:
1. company_context (3-4 sentences)
2. pain_points (array of top 3 strings, ranked by likelihood)
3. recommended_property (one of: "Dream Manager", "Trinity Calibrate", "Trinity Forge", "Consulting")
4. personalized_steps (array of 4 strings) and each step should be a full email body for a sequence step. Do not include step numbers.

Example format:
{
  "company_context": "...",
  "pain_points": ["...", "...", "..."],
  "recommended_property": "Dream Manager",
  "personalized_steps": ["...", "...", "...", "..."]
}`;

  const bodyPayload = JSON.stringify({
    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 600,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const data = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyPayload),
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => raw += chunk);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { reject(new Error("Invalid JSON response from Claude: " + raw.slice(0, 300))); }
      });
    });
    req.on("error", reject);
    req.write(bodyPayload);
    req.end();
  });

  if (data.status !== 200) {
    throw new Error(`Claude API error ${data.status}: ${JSON.stringify(data.body)}`);
  }

  const text = data.body.content?.[0]?.text || data.body.completion || "";
  const json = extractJsonFromText(text);
  if (!json) {
    throw new Error("Unable to parse JSON from Claude enrichment response");
  }

  const completeness = [
    !!json.company_context,
    Array.isArray(json.pain_points) && json.pain_points.length >= 1,
    !!json.recommended_property,
    Array.isArray(json.personalized_steps) && json.personalized_steps.length >= 4,
  ].reduce((sum, bit) => sum + (bit ? 1 : 0), 0);

  const claudeQuality = Math.round((completeness / 4) * 100);

  return {
    company_context: json.company_context || "",
    pain_points: Array.isArray(json.pain_points) ? json.pain_points.slice(0, 3) : [],
    recommended_property: json.recommended_property || "Dream Manager",
    personalized_steps: Array.isArray(json.personalized_steps) ? json.personalized_steps.slice(0, 4) : [],
    claude_quality: claudeQuality,
  };
}

// ── Build prospect fields array ──────────────────────────────

function buildProspectFields(prospect) {
  const fields = [];
  const map = {
    firstName: prospect.firstName || prospect.first_name || "",
    lastName: prospect.lastName || prospect.last_name || "",
    email: prospect.email || "",
    phone: prospect.phone || "",
    company: prospect.company || "",
    jobTitle: prospect.jobTitle || prospect.title || "",
    website: prospect.website || "",
    city: prospect.city || "",
    state: prospect.state || "",
    country: prospect.country || "",
    linkedin: prospect.linkedin || prospect.linkedin_url || "",
    leadScore: prospect.leadScore?.toString() || "",
    companySizeBand: prospect.companySizeBand || prospect.company_size_band || "",
    titleSeniority: prospect.titleSeniority || prospect.title_seniority || "",
    zohoLeadId: prospect.zohoLeadId || prospect.zoho_lead_id || "",
    companyContext: prospect.companyContext || prospect.company_context || "",
    painPoints: Array.isArray(prospect.painPoints)
      ? prospect.painPoints.join("; ")
      : (prospect.painPoints || prospect.pain_points || ""),
    routedProperty: prospect.routedProperty || prospect.routed_property || "",
    personalizedSequence: prospect.personalizedSequence || prospect.personalized_sequence || "",
  };

  for (const [key, value] of Object.entries(map)) {
    if (FIELD_IDS[key] && value) {
      fields.push({ id: FIELD_IDS[key], value });
    }
  }

  return fields;
}

// ── Admin auth check ─────────────────────────────────────────

function checkAuth(event) {
  const auth = event.headers.authorization || "";
  const token = auth.replace("Bearer ", "");
  return token === process.env.ADMIN_DASHBOARD_PASSWORD;
}

// ── Main handler ─────────────────────────────────────────────

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  if (!checkAuth(event)) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  if (!SALESHANDY_API_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "SALESHANDY_API_KEY not configured" }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const action = body.action || event.queryStringParameters?.action;

  try {
    switch (action) {

      // ── Build prospect list (full Apollo-style intelligence) ──
      case "build": {
        const { campaign, prospects, sequenceKey: overrideSeqKey, step: overrideStep, skipZoho, skipSalesHandy } = body;

        if (!prospects || !Array.isArray(prospects) || prospects.length === 0) {
          return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "prospects array required" }) };
        }

        if (!campaign && !overrideSeqKey && !body.enrichWithClaude) {
          return { statusCode: 400, headers: CORS, body: JSON.stringify({
            error: "campaign, sequenceKey, or enrichWithClaude=true required",
            validCampaigns: ["dream-manager", "trinity-forge", "trinity-calibrate", "unicorn"],
            validSequenceKeys: Object.keys(SEQUENCES),
          })};
        }

        // Validate SalesHandy custom field IDs
        const missingFieldIds = validateSaleshandyFields({ enrichmentEnabled: !!body.enrichWithClaude });
        if (!skipSalesHandy && missingFieldIds.length > 0) {
          return {
            statusCode: 400,
            headers: CORS,
            body: JSON.stringify({
              error: "Missing required SalesHandy field ID environment variables",
              missingFieldIds,
            }),
          };
        }

        // Get Zoho access token upfront (unless skipping Zoho)
        let accessToken = null;
        if (!skipZoho) {
          try { accessToken = await getZohoAccessToken(); }
          catch (err) {
            console.error("Zoho auth failed — continuing without Zoho upsert:", err.message);
          }
        }

        // ── Sender capacity pre-flight check ──
        if (!skipSalesHandy) {
          const targetGroup = overrideSeqKey
            ? (SEQUENCES[overrideSeqKey]?.senderGroup || "cold-pool")
            : "cold-pool";
          const capacity = await checkSenderCapacity(supabase, targetGroup);
          if (!capacity.hasCapacity) {
            return {
              statusCode: 429,
              headers: CORS,
              body: JSON.stringify({
                error: `All ${targetGroup} senders at daily limit. Try again tomorrow or increase limits.`,
                senderGroup: targetGroup,
                totalLimit: capacity.totalLimit,
                activeSenders: capacity.activeSenders,
              }),
            };
          }
          if (capacity.remaining < prospects.length) {
            console.warn(`Sender capacity warning: ${capacity.remaining} remaining for ${prospects.length} prospects in ${targetGroup}`);
          }
        }

        const results = [];

        // Process prospects with concurrency limit for Claude enrichment
        const CONCURRENCY = body.enrichWithClaude ? 5 : 10;
        for (let i = 0; i < prospects.length; i += CONCURRENCY) {
          const batch = prospects.slice(i, i + CONCURRENCY);
          const batchResults = await Promise.allSettled(batch.map(async (raw) => {
            const email = raw.email;
            if (!email) return { email: null, status: "skipped", reason: "no email" };

            try {
              const person = {
                email,
                first_name: raw.firstName || raw.first_name || "",
                last_name: raw.lastName || raw.last_name || "",
                title: raw.jobTitle || raw.title || "",
                phone: raw.phone || "",
                linkedin_url: raw.linkedin || raw.linkedin_url || "",
              };
              const organization = {
                name: raw.company || "",
                domain: raw.website || "",
                industry: raw.industry || "",
                estimated_num_employees: parseInt(raw.employeeCount || raw.employee_count || 0, 10),
                technologies: raw.technologies || raw.techStack || [],
                total_funding: parseFloat(raw.totalFunding || raw.total_funding || 0),
                annual_revenue: parseFloat(raw.annualRevenue || raw.annual_revenue || 0),
              };

              // ── Run intelligence pipeline ──
              const leadScore = calculateLeadScore(person, organization);
              const seniority = classifyTitleSeniority(person.title);
              const sizeBand = getCompanySizeBand(organization.estimated_num_employees);
              const { seats, estimatedDealValue } = estimateDealMetrics(organization.estimated_num_employees);
              const autoTags = generateAutoTags(person, organization, leadScore, seniority, sizeBand);

              let claudeResults = null;
              if (body.enrichWithClaude) {
                try {
                  claudeResults = await callClaudeEnrichment(person, organization, raw);
                  if (claudeResults.recommended_property) {
                    autoTags.push(`trinity_property:${claudeResults.recommended_property}`);
                  }
                } catch (err) {
                  console.error(`Claude enrichment failed for ${email}:`, err.message);
                }
              }

              const routedCampaign = claudeResults?.recommended_property
                ? mapRoutedPropertyToCampaign(claudeResults.recommended_property)
                : null;
              const effectiveCampaign = campaign || routedCampaign || "dream-manager";
              const isInbound = !!(raw.source === "inbound" || raw.source === "referral" || raw.referredBy);

              const sequenceKey = overrideSeqKey || assignSequence(effectiveCampaign, leadScore, isInbound);
              const stepNum = overrideStep || 1;

              autoTags.push(effectiveCampaign);
              if (routedCampaign && routedCampaign !== effectiveCampaign) autoTags.push(routedCampaign);
              if (isInbound) autoTags.push("inbound-referral");

              const techStack = Array.isArray(organization.technologies)
                ? organization.technologies.join(", ") : "";
              const hasHRIS = /\b(workday|bamboohr|gusto|adp|paychex|namely|lattice|culture amp|15five|glint|qualtrics|peakon)\b/i.test(techStack);

              // ── Upsert to Zoho CRM ──
              let zohoId = null;
              let zohoStatus = "skipped";
              if (accessToken) {
                const zohoLead = {
                  Email: email,
                  First_Name: person.first_name || "",
                  Last_Name: person.last_name || email.split("@")[0],
                  Designation: person.title || "",
                  Phone: person.phone || "",
                  Company: organization.name || email.split("@")[1]?.split(".")[0] || "Unknown",
                  Website: organization.domain || "",
                  Industry: organization.industry || "",
                  Lead_Source: isInbound ? "Inbound Referral" : "SalesHandy",
                  DC_Lead_Score: leadScore,
                  Lead_Source_Detail: isInbound
                    ? `Referral${raw.referredBy ? ` – ${raw.referredBy}` : ""}`
                    : `SalesHandy – ${effectiveCampaign}`,
                  Company_Size_Band: sizeBand,
                  Employee_Count: organization.estimated_num_employees || 0,
                  Industry_Vertical: organization.industry || "",
                  Annual_Revenue: organization.annual_revenue || 0,
                  Total_Funding: organization.total_funding || 0,
                  Tech_Stack: techStack,
                  Has_HRIS: hasHRIS,
                  LinkedIn_URL: person.linkedin_url || "",
                  Title_Seniority: seniority,
                  Estimated_Seat_Count: seats,
                  Estimated_Deal_Value: estimatedDealValue,
                  Lifecycle_Stage: leadScore >= 40 ? "MQL" : "New",
                  MQL_Date: leadScore >= 40 ? new Date().toISOString().split("T")[0] : null,
                  SH_Tags: autoTags.join(", "),
                  SH_Company_Context: claudeResults?.company_context || "",
                  SH_Pain_Points: Array.isArray(claudeResults?.pain_points) ? claudeResults.pain_points.join("; ") : claudeResults?.pain_points || "",
                  SH_Routed_Property: claudeResults?.recommended_property || "",
                  SH_Personalized_Sequence: claudeResults?.personalized_steps ? claudeResults.personalized_steps.join("\n\n") : "",
                };

                const upsertResult = await zohoApiRequest("POST", "/Leads/upsert", accessToken, {
                  data: [zohoLead],
                  duplicate_check_fields: ["Email"],
                  trigger: ["workflow"],
                });

                zohoId = upsertResult.data?.data?.[0]?.details?.id || null;
                zohoStatus = upsertResult.data?.data?.[0]?.status || "unknown";
              }

              // ── Import to SalesHandy sequence ──
              let shStatus = "skipped";
              const stepId = SEQUENCES[sequenceKey]?.stepIds[stepNum];
              if (stepId) {
                const enrichedProspect = {
                  ...raw,
                  leadScore: leadScore.toString(),
                  companySizeBand: sizeBand,
                  titleSeniority: seniority,
                  zohoLeadId: zohoId || "",
                  companyContext: claudeResults?.company_context || "",
                  painPoints: claudeResults?.pain_points || [],
                  routedProperty: claudeResults?.recommended_property || "",
                  personalizedSequence: claudeResults?.personalized_steps ? claudeResults.personalized_steps.join("\n\n") : "",
                };

                const prospectList = [{ fields: buildProspectFields(enrichedProspect) }];

                const shResult = await saleshandyRequest("POST", "/prospects/import", {
                  prospectList,
                  stepId,
                  verifyProspects: false,
                  conflictAction: "addMissingFields",
                });
                shStatus = shResult.status < 300 ? "imported" : "error";

                // Track send count for sender pool capacity management
                if (shStatus === "imported") {
                  const sGroup = SEQUENCES[sequenceKey]?.senderGroup;
                  if (sGroup) {
                    const { data: poolSenders } = await supabase
                      .from("sh_senders")
                      .select("email")
                      .eq("sender_group", sGroup)
                      .in("status", ["active", "warmup"])
                      .order("sends_today", { ascending: true })
                      .limit(1);
                    if (poolSenders?.[0]) {
                      await incrementSenderCount(supabase, poolSenders[0].email);
                    }
                  }

                  if (autoTags.length > 0) {
                    await saleshandyRequest("POST", "/prospects/tag", {
                      emails: [email],
                      tags: autoTags,
                    });
                  }
                }
              } else {
                shStatus = `step_not_configured (${sequenceKey} step ${stepNum})`;
              }

              // ── Log to Supabase ──
              await supabase.from("crm_sync_log").insert({
                source: "saleshandy",
                direction: "outbound",
                entity_type: "prospect_build",
                entity_id: zohoId,
                email,
                payload: {
                  campaign: effectiveCampaign, sequence: sequenceKey, step: stepNum,
                  lead_score: leadScore, seniority, size_band: sizeBand,
                  deal_value: estimatedDealValue, tags: autoTags,
                  claude_quality: claudeResults?.claude_quality || null,
                  recommended_property: claudeResults?.recommended_property || null,
                  routed_campaign: routedCampaign,
                  is_inbound: isInbound,
                },
                status: "success",
                error_msg: null,
              });

              console.log(`Build: ${email} score=${leadScore} seniority=${seniority} seq=${sequenceKey} zoho=${zohoStatus} sh=${shStatus}`);

              return {
                email, leadScore, seniority, sizeBand,
                estimatedDealValue, tags: autoTags,
                campaign: effectiveCampaign,
                routedCampaign,
                sequence: sequenceKey, step: stepNum,
                zoho: { id: zohoId, status: zohoStatus },
                saleshandy: { status: shStatus },
                enrichment: claudeResults,
                claudeQuality: claudeResults?.claude_quality || null,
              };

            } catch (err) {
              console.error(`Error building prospect ${email}:`, err.message);
              await supabase.from("crm_sync_log").insert({
                source: "saleshandy", direction: "outbound",
                entity_type: "prospect_build", entity_id: null, email,
                payload: null, status: "error", error_msg: err.message,
              });
              return { email, status: "error", error: err.message };
            }
          }));

          // Unwrap Promise.allSettled results
          for (const settled of batchResults) {
            results.push(settled.status === "fulfilled" ? settled.value : { status: "error", error: settled.reason?.message });
          }
        }

        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({
            action: "build",
            campaign: campaign || null,
            processed: results.length,
            scored: results.filter(r => r.leadScore !== undefined).length,
            imported: results.filter(r => r.saleshandy?.status === "imported").length,
            zohoSynced: results.filter(r => r.zoho?.status && r.zoho.status !== "skipped").length,
            results,
          }),
        };
      }

      // ── Import prospects into a sequence (raw, no scoring) ──
      case "import": {
        const { sequenceKey, step, prospects, verifyProspects, conflictAction } = body;

        if (!sequenceKey || !SEQUENCES[sequenceKey]) {
          return { statusCode: 400, headers: CORS, body: JSON.stringify({
            error: "Invalid sequenceKey",
            validKeys: Object.keys(SEQUENCES),
          })};
        }

        const stepNum = step || 1;
        const stepId = SEQUENCES[sequenceKey].stepIds[stepNum];
        if (!stepId) {
          return { statusCode: 400, headers: CORS, body: JSON.stringify({
            error: `Step ID not configured for ${sequenceKey} step ${stepNum}. Set SH_SEQ_* env vars.`,
          })};
        }

        if (!prospects || !Array.isArray(prospects) || prospects.length === 0) {
          return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "prospects array required" }) };
        }

        // Sender capacity pre-flight check
        const senderGroup = SEQUENCES[sequenceKey].senderGroup || "cold-pool";
        const capacity = await checkSenderCapacity(supabase, senderGroup);
        if (!capacity.hasCapacity) {
          return {
            statusCode: 429,
            headers: CORS,
            body: JSON.stringify({
              error: `All ${senderGroup} senders at daily limit. Try again tomorrow or increase limits.`,
              senderGroup,
              totalLimit: capacity.totalLimit,
              activeSenders: capacity.activeSenders,
            }),
          };
        }

        const prospectList = prospects.map((p) => ({ fields: buildProspectFields(p) }));

        const result = await saleshandyRequest("POST", "/prospects/import", {
          prospectList,
          stepId,
          verifyProspects: verifyProspects ?? false,
          conflictAction: conflictAction || "addMissingFields",
        });

        console.log(`SalesHandy import: ${prospects.length} prospects → ${SEQUENCES[sequenceKey].name} step ${stepNum}`);

        // Track sender counts for capacity management
        if (result.status < 300) {
          const { data: poolSenders } = await supabase
            .from("sh_senders")
            .select("email")
            .eq("sender_group", senderGroup)
            .in("status", ["active", "warmup"])
            .order("sends_today", { ascending: true })
            .limit(1);
          if (poolSenders?.[0]) {
            for (let i = 0; i < prospects.length; i++) {
              await incrementSenderCount(supabase, poolSenders[0].email);
            }
          }
        }

        for (const p of prospects) {
          await supabase.from("crm_sync_log").insert({
            source: "saleshandy",
            direction: "outbound",
            entity_type: "prospect_import",
            entity_id: null,
            email: p.email,
            payload: { sequence: sequenceKey, step: stepNum },
            status: result.status < 300 ? "success" : "error",
            error_msg: result.status >= 300 ? JSON.stringify(result.data) : null,
          });
        }

        return {
          statusCode: result.status,
          headers: CORS,
          body: JSON.stringify({
            action: "import",
            sequence: SEQUENCES[sequenceKey].name,
            step: stepNum,
            count: prospects.length,
            senderGroup,
            senderCapacityRemaining: capacity.remaining - prospects.length,
            result: result.data,
          }),
        };
      }

      // ── Tag prospects ─────────────────────────────────────
      case "tag": {
        const { prospectEmails, tags } = body;
        if (!prospectEmails?.length || !tags?.length) {
          return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "prospectEmails and tags arrays required" }) };
        }

        const result = await saleshandyRequest("POST", "/prospects/tag", {
          emails: prospectEmails,
          tags,
        });

        console.log(`SalesHandy tag: ${prospectEmails.length} prospects tagged with [${tags.join(", ")}]`);

        return {
          statusCode: result.status,
          headers: CORS,
          body: JSON.stringify({ action: "tag", count: prospectEmails.length, tags, result: result.data }),
        };
      }

      // ── Untag prospects ───────────────────────────────────
      case "untag": {
        const { prospectEmails: emails, tags: removeTags } = body;
        if (!emails?.length || !removeTags?.length) {
          return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "prospectEmails and tags arrays required" }) };
        }

        const result = await saleshandyRequest("POST", "/prospects/untag", {
          emails,
          tags: removeTags,
        });

        return {
          statusCode: result.status,
          headers: CORS,
          body: JSON.stringify({ action: "untag", count: emails.length, tags: removeTags, result: result.data }),
        };
      }

      // ── List configured sequences ─────────────────────────
      case "sequences": {
        const seqList = Object.entries(SEQUENCES).map(([key, val]) => ({
          key,
          name: val.name,
          steps: Object.keys(val.stepIds).length,
          configured: Object.values(val.stepIds).every((id) => id !== ""),
        }));

        return { statusCode: 200, headers: CORS, body: JSON.stringify({ sequences: seqList }) };
      }

      // ── Validate runtime config ────────────────────────────
      case "validate-config": {
        const enrichWithClaude = !!body.enrichWithClaude;
        const missingFieldIds = validateSaleshandyFields({ enrichmentEnabled: enrichWithClaude });
        const sequenceConfig = Object.entries(SEQUENCES).map(([key, val]) => ({
          key,
          name: val.name,
          senderGroup: val.senderGroup,
          configuredSteps: Object.entries(val.stepIds)
            .filter(([, id]) => id)
            .map(([step]) => Number(step)),
          missingSteps: Object.entries(val.stepIds)
            .filter(([, id]) => !id)
            .map(([step]) => Number(step)),
        }));

        // Include sender pool status
        const senderReport = await getSenderHealthReport(supabase);

        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({
            action: "validate-config",
            anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
            saleshandyApiConfigured: !!SALESHANDY_API_KEY,
            zohoConfigured: !!ZOHO_CLIENT_ID && !!ZOHO_CLIENT_SECRET,
            missingFieldIds,
            sequenceConfig,
            senderPool: senderReport,
          }),
        };
      }

      // ── Lint sequence content (catches unrendered spintax etc) ─
      case "lint-sequences": {
        const listRes = await saleshandyRequest("GET", "/sequences?pageSize=1000");
        if (listRes.status !== 200) {
          return {
            statusCode: 502,
            headers: CORS,
            body: JSON.stringify({
              action: "lint-sequences",
              error: "Failed to list sequences from SalesHandy",
              status: listRes.status,
              details: listRes.data,
            }),
          };
        }

        const sequences = Array.isArray(listRes.data?.data)
          ? listRes.data.data
          : Array.isArray(listRes.data?.sequences)
          ? listRes.data.sequences
          : Array.isArray(listRes.data)
          ? listRes.data
          : [];

        const onlyActive = body.onlyActive !== false;
        const filterIds = Array.isArray(body.sequenceIds) && body.sequenceIds.length > 0
          ? new Set(body.sequenceIds.map(String))
          : null;

        const findings = [];
        let stepsScanned = 0;
        let variantsScanned = 0;

        for (const seq of sequences) {
          const sequenceId = String(seq.id || seq._id || "");
          if (!sequenceId) continue;
          if (filterIds && !filterIds.has(sequenceId)) continue;
          if (onlyActive && seq.active === false) continue;

          const stepsRes = await saleshandyRequest("GET", `/sequences/${sequenceId}/steps`);
          if (stepsRes.status !== 200) {
            findings.push({
              sequenceId,
              sequenceName: seq.title || seq.name || "",
              stepId: null,
              variantId: null,
              kind: "fetch-error",
              field: null,
              snippet: `Steps fetch failed (status ${stepsRes.status})`,
            });
            continue;
          }

          const steps = Array.isArray(stepsRes.data?.data)
            ? stepsRes.data.data
            : Array.isArray(stepsRes.data?.steps)
            ? stepsRes.data.steps
            : Array.isArray(stepsRes.data)
            ? stepsRes.data
            : [];

          for (const step of steps) {
            stepsScanned++;
            const stepId = String(step.id || step._id || "");
            const channel = (step.channel || step.type || "email").toLowerCase();
            const variants = Array.isArray(step.variants) ? step.variants : [step];

            for (const variant of variants) {
              variantsScanned++;
              const issues = lintVariant(variant, channel);
              for (const issue of issues) {
                findings.push({
                  sequenceId,
                  sequenceName: seq.title || seq.name || "",
                  stepId,
                  stepOrder: step.order || step.stepOrder || step.position || null,
                  variantId: String(variant.id || variant._id || ""),
                  variantName: variant.name || null,
                  channel,
                  ...issue,
                });
              }
            }
          }
        }

        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({
            action: "lint-sequences",
            ok: findings.filter((f) => f.kind !== "fetch-error").length === 0,
            sequencesScanned: sequences.length,
            stepsScanned,
            variantsScanned,
            issueCount: findings.length,
            findings,
          }),
        };
      }

      // ── Sender pool status ────────────────────────────────
      case "sender-status": {
        const report = await getSenderHealthReport(supabase);
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ action: "sender-status", ...report }),
        };
      }

      // ── Manage senders (pause/resume/update-limit/disable) ─
      case "sender-manage": {
        const { senderEmail, operation, reason, daily_limit, max_daily_limit } = body;
        if (!senderEmail || !operation) {
          return { statusCode: 400, headers: CORS, body: JSON.stringify({
            error: "senderEmail and operation required",
            validOperations: ["pause", "resume", "update-limit", "disable"],
          })};
        }
        const result = await manageSender(supabase, senderEmail, operation, {
          reason, daily_limit, max_daily_limit,
        });
        if (result.error) {
          return { statusCode: 400, headers: CORS, body: JSON.stringify({ action: "sender-manage", ...result }) };
        }
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ action: "sender-manage", ...result }) };
      }

      default:
        return {
          statusCode: 400,
          headers: CORS,
          body: JSON.stringify({
            error: "Unknown action",
            validActions: ["build", "import", "tag", "untag", "sequences", "validate-config", "sender-status", "sender-manage", "lint-sequences"],
          }),
        };
    }
  } catch (err) {
    console.error("SalesHandy API error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
