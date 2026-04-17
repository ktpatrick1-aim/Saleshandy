// netlify/functions/saleshandy-webhook.js
// Receives engagement events from SalesHandy webhooks (opens, clicks, replies, bounces)
//
// NOTE: SalesHandy's NATIVE Zoho integration already handles:
//   - Creating/updating Leads, Contacts, Deals, Accounts in Zoho
//   - Logging email activity as notes on Zoho records
//   - Tagging bounced/unsubscribed contacts
//   - Duplicate checking and custom field mapping
//
// This webhook SUPPLEMENTS the native integration by handling:
//   - Auto-enrichment on first email (lead scoring, seniority, size band, deal value, tags)
//   - Custom engagement scoring (0-100)
//   - Lifecycle stage promotion (MQL/SQL based on engagement)
//   - Outcome-to-lifecycle-stage mapping
//   - Sequence branching (auto-move prospects between sequences based on engagement)
//   - Supabase analytics logging (sh_engagement_log)
//   - CRM sync log for audit trail
//
// AUTO-ENRICHMENT (replaces Apollo intelligence):
//   When a prospect enters a sequence (email-sent, step 1), we auto-calculate:
//   - Lead score (company size, title seniority, industry, email domain, LinkedIn, funding, HR tech)
//   - Title seniority classification (C-Suite, VP, Director, Manager, IC)
//   - Company size banding (SMB, Mid-Market, Enterprise)
//   - Deal value estimation (seats + ARR)
//   - Campaign detection from sequence name
//   - Auto-tags (hr-leader, c-suite, mid-market, campaign name, etc.)
//   All written to Zoho Lead on first touch — zero manual steps after Lead Finder → Add to Sequence
//
// SEQUENCE BRANCHING:
//   - Opens >= 2 from cold sequence → auto-add to warm sequence
//   - Stale 30+ days (prospect-finished with no reply) → auto-add to re-engagement
//   - Outcome = "Meeting Completed" → auto-add to post-demo sequence
//   - Inbound/referral leads get their own sequence (Sequence 6)

const https = require("https");
const { createClient } = require("@supabase/supabase-js");
const {
  calculateLeadScore,
  classifyTitleSeniority,
  getCompanySizeBand,
  estimateDealMetrics,
  calculateEngagementScore,
  detectCampaign,
  generateAutoTags,
  extractJsonFromText,
  normalizeReplyCategory,
} = require("./saleshandy-shared");
const { updateSenderHealth } = require("./saleshandy-sender");

// ── Credentials ──────────────────────────────────────────────
const SALESHANDY_WEBHOOK_TOKEN = process.env.SALESHANDY_WEBHOOK_TOKEN;
const SALESHANDY_API_KEY = process.env.SALESHANDY_API_KEY;
const SALESHANDY_BASE = "open-api.saleshandy.com";
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Sequence Step IDs for branching ─────────────────────────
// These must match the IDs configured in saleshandy-api.js SEQUENCES map.
const BRANCH_SEQUENCES = {
  "lead-nurture-warm": {
    stepId: process.env.SH_SEQ_NURTURE_WARM_STEP1 || "",
    tag: "warm-engaged",
  },
  "re-engagement": {
    stepId: process.env.SH_SEQ_REENGAGE_STEP1 || "",
    tag: "stale-30d",
  },
  "post-demo": {
    stepId: process.env.SH_SEQ_POSTDEMO_STEP1 || "",
    tag: "demo-completed",
  },
  "inbound-referral": {
    stepId: process.env.SH_SEQ_INBOUND_STEP1 || "",
    tag: "inbound-referral",
  },
};

// ── Zoho API helpers (matches codebase pattern) ──────────────

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

// ── SalesHandy API helper (for sequence branching) ──────────

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

// ── Sequence Branching Engine ────────────────────────────────
// Automatically moves prospects between sequences based on engagement signals.

async function branchProspect(email, targetSequenceKey, reason) {
  if (!SALESHANDY_API_KEY) {
    console.warn(`Sequence branching skipped (no API key): ${email} → ${targetSequenceKey}`);
    return { status: "skipped", reason: "no_api_key" };
  }

  const branch = BRANCH_SEQUENCES[targetSequenceKey];
  if (!branch || !branch.stepId) {
    console.warn(`Sequence branching skipped (step not configured): ${email} → ${targetSequenceKey}`);
    return { status: "skipped", reason: "step_not_configured" };
  }

  try {
    // Import prospect into the target sequence step 1
    const importResult = await saleshandyRequest("POST", "/prospects/import", {
      prospectList: [{ fields: [{ id: process.env.SH_FIELD_EMAIL || "Y7PWZEW7wo", value: email }] }],
      stepId: branch.stepId,
      verifyProspects: false,
      conflictAction: "addMissingFields",
    });

    // Tag the prospect for tracking
    if (branch.tag) {
      await saleshandyRequest("POST", "/prospects/tag", {
        emails: [email],
        tags: [branch.tag],
      });
    }

    console.log(`Sequence branch: ${email} → ${targetSequenceKey} (${reason}) | status=${importResult.status}`);

    await supabase.from("crm_sync_log").insert({
      source: "saleshandy",
      direction: "outbound",
      entity_type: "sequence_branch",
      entity_id: null,
      email,
      payload: { target: targetSequenceKey, reason, tag: branch.tag },
      status: importResult.status < 300 ? "success" : "error",
      error_msg: importResult.status >= 300 ? JSON.stringify(importResult.data) : null,
    });

    return { status: importResult.status < 300 ? "branched" : "error", target: targetSequenceKey };
  } catch (err) {
    console.error(`Sequence branch failed: ${email} → ${targetSequenceKey}:`, err.message);
    await supabase.from("crm_sync_log").insert({
      source: "saleshandy",
      direction: "outbound",
      entity_type: "sequence_branch",
      entity_id: null,
      email,
      payload: { target: targetSequenceKey, reason },
      status: "error",
      error_msg: err.message,
    });
    return { status: "error", error: err.message };
  }
}

// ── Engagement event mapping ─────────────────────────────────

const EVENT_MAP = {
  "email-sent": { zohoField: "SH_Emails_Sent", increment: true, stage: null },
  "email-opened": { zohoField: "SH_Emails_Opened", increment: true, stage: "Engaged" },
  "email-link-clicked": { zohoField: "SH_Links_Clicked", increment: true, stage: "Engaged" },
  "email-bounced": { zohoField: "SH_Bounced", increment: false, stage: "Bounced" },
  "reply-received": { zohoField: "SH_Replies", increment: true, stage: "Replied" },
  "prospect-unsubscribed": { zohoField: "SH_Unsubscribed", increment: false, stage: "Unsubscribed" },
  "prospect-finished": { zohoField: "SH_Sequence_Finished", increment: false, stage: null },
  "prospect-outcome-updated": { zohoField: null, increment: false, stage: null },
};

// ── Reply classification with Claude ────────────────────────

async function classifyReplyWithClaude(replyText) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY must be configured for reply classification");
  const systemPrompt = `You are a sales assistant that categorizes cold outreach replies into one of intent categories. Respond with valid JSON only.`;
  const userPrompt = `Reply text:
${replyText}

Classify this reply into one of: interested, objection, not now, unsubscribe. Also provide a short suggested response draft (one paragraph) if not unsubscribe. Output JSON with keys:\n{ "category": "...", "confidence": 0-100, "responseDraft": "..." }`;

  const reqBody = JSON.stringify({
    model: ANTHROPIC_MODEL,
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
        "Content-Length": Buffer.byteLength(reqBody),
        "x-api-key": ANTHROPIC_API_KEY,
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
    req.write(reqBody);
    req.end();
  });

  if (data.status !== 200) {
    throw new Error(`Claude API error ${data.status}: ${JSON.stringify(data.body)}`);
  }

  const text = data.body.content?.[0]?.text || data.body.completion || "";
  const json = extractJsonFromText(text);
  if (!json) {
    throw new Error("Unable to parse JSON from Claude reply classification");
  }

  const normalizedCategory = normalizeReplyCategory(json.category);
  return {
    category: normalizedCategory,
    confidence: json.confidence || 0,
    responseDraft: json.responseDraft || "",
  };
}

// ── Sync log helper ──────────────────────────────────────────

async function logSync(source, direction, entityType, entityId, email, payload, status, errorMsg) {
  await supabase.from("crm_sync_log").insert({
    source,
    direction,
    entity_type: entityType,
    entity_id: entityId,
    email,
    payload,
    status,
    error_msg: errorMsg || null,
  });
}

// ── Main handler ─────────────────────────────────────────────

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-webhook-token, Authorization",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };

  // Validate webhook token (SalesHandy uses custom headers, no HMAC)
  if (SALESHANDY_WEBHOOK_TOKEN) {
    const token = event.headers["x-webhook-token"] || event.headers["X-Webhook-Token"];
    if (token !== SALESHANDY_WEBHOOK_TOKEN) {
      console.error("SalesHandy webhook token mismatch");
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "Invalid token" }) };
    }
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  // Optional support endpoint for explicit reply classification
  if (payload.action === "classify_reply") {
    if (!payload.reply_text) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "reply_text required" }) };
    }
    try {
      const classification = await classifyReplyWithClaude(payload.reply_text);
      const classificationEmail = payload.email || payload.prospect?.email || null;
      await logSync(
        "saleshandy",
        "inbound",
        "reply_classification",
        null,
        classificationEmail,
        { action: "classify_reply", classification },
        "success",
        null
      );
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ action: "classify_reply", classification }) };
    } catch (err) {
      console.error("Reply classification failed:", err.message);
      const classificationEmail = payload.email || payload.prospect?.email || null;
      await logSync(
        "saleshandy",
        "inbound",
        "reply_classification",
        null,
        classificationEmail,
        { action: "classify_reply", reply_text: payload.reply_text || "" },
        "error",
        err.message
      );
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
    }
  }

  const eventType = payload.event;
  if (!eventType) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing event type" }) };
  }

  const eventConfig = EVENT_MAP[eventType];
  if (!eventConfig) {
    console.warn(`Unknown SalesHandy event: ${eventType}`);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: "ignored", event: eventType }) };
  }

  const prospect = payload.prospect || {};
  const sequence = payload.sequence || {};
  const email = prospect.email;

  if (!email) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: "skipped", reason: "no email" }) };
  }

  console.log(`SalesHandy ${eventType}: ${email} | seq=${sequence.sequenceName || "N/A"} step=${sequence.stepNumber || "N/A"}`);

  let accessToken;
  try {
    accessToken = await getZohoAccessToken();
  } catch (err) {
    console.error("Failed to get Zoho access token:", err.message);
    await logSync("saleshandy", "inbound", "lead", null, email, payload, "error", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Zoho auth failed" }) };
  }

  try {
    // Search for existing lead by email
    const searchResult = await zohoApiRequest(
      "GET",
      `/Leads/search?email=${encodeURIComponent(email)}`,
      accessToken
    );

    const existingLead = searchResult.data?.data?.[0];
    const zohoId = existingLead?.id;

    // Build update payload
    const updateFields = {
      SH_Last_Event: eventType,
      SH_Last_Event_Date: new Date().toISOString().split("T")[0],
      SH_Last_Sequence: sequence.sequenceName || "",
      SH_Last_Step: sequence.stepNumber ? parseInt(sequence.stepNumber, 10) : null,
      SH_Sender_Email: sequence.senderEmail || "",
    };

    // Update engagement score
    const existingEngScore = existingLead?.SH_Engagement_Score || 0;
    updateFields.SH_Engagement_Score = calculateEngagementScore(eventType, existingEngScore);

    // ── AUTO-ENRICHMENT on first email (step 1) ──────────────
    const stepNumber = sequence.stepNumber ? parseInt(sequence.stepNumber, 10) : null;
    const isFirstTouch = eventType === "email-sent" && (stepNumber === 1 || !existingLead?.DC_Lead_Score);

    if (isFirstTouch) {
      const prospectData = {
        email,
        title: prospect.title || prospect.jobTitle || existingLead?.Designation || "",
        company: prospect.company || prospect.companyName || existingLead?.Company || "",
        industry: prospect.industry || existingLead?.Industry || "",
        employeeCount: prospect.employeeCount || prospect.companySize || existingLead?.Employee_Count || 0,
        linkedin: prospect.linkedin || prospect.linkedinUrl || existingLead?.LinkedIn_URL || "",
        jobTitle: prospect.title || prospect.jobTitle || existingLead?.Designation || "",
        techStack: prospect.techStack || existingLead?.Tech_Stack || "",
        totalFunding: prospect.totalFunding || existingLead?.Total_Funding || 0,
      };

      const leadScore = calculateLeadScore(prospectData);
      const seniority = classifyTitleSeniority(prospectData.title);
      const employeeCount = parseInt(prospectData.employeeCount || 0, 10);
      const sizeBand = getCompanySizeBand(employeeCount);
      const { seats, estimatedDealValue } = estimateDealMetrics(employeeCount);
      const campaign = detectCampaign(sequence.sequenceName);
      const autoTags = generateAutoTags(prospectData, leadScore, seniority, campaign);
      if (campaign) autoTags.push(campaign);

      // Write enrichment fields to Zoho Lead
      updateFields.DC_Lead_Score = leadScore;
      updateFields.Lead_Source = "SalesHandy";
      updateFields.Lead_Source_Detail = `SalesHandy – ${campaign}`;
      updateFields.Title_Seniority = seniority;
      updateFields.Company_Size_Band = sizeBand;
      updateFields.Estimated_Seat_Count = seats;
      updateFields.Estimated_Deal_Value = estimatedDealValue;
      updateFields.SH_Tags = autoTags.join(", ");

      // Set lifecycle stage based on score
      if (leadScore >= 40) {
        updateFields.Lifecycle_Stage = "MQL";
        updateFields.MQL_Date = new Date().toISOString().split("T")[0];
      } else if (!existingLead?.Lifecycle_Stage) {
        updateFields.Lifecycle_Stage = "New";
      }

      console.log(`Auto-enrichment: ${email} score=${leadScore} seniority=${seniority} sizeBand=${sizeBand} dealValue=${estimatedDealValue} campaign=${campaign} tags=[${autoTags.join(", ")}]`);

      await supabase.from("crm_sync_log").insert({
        source: "saleshandy",
        direction: "inbound",
        entity_type: "auto_enrichment",
        entity_id: zohoId,
        email,
        payload: {
          lead_score: leadScore, seniority, size_band: sizeBand,
          deal_value: estimatedDealValue, campaign, tags: autoTags,
          sequence: sequence.sequenceName,
        },
        status: "success",
        error_msg: null,
      });
    }

    // Increment counter fields
    if (eventConfig.zohoField && eventConfig.increment && existingLead) {
      updateFields[eventConfig.zohoField] = (existingLead[eventConfig.zohoField] || 0) + 1;
    } else if (eventConfig.zohoField && !eventConfig.increment) {
      updateFields[eventConfig.zohoField] = true;
    }

    // Track sequence branching actions
    let branchResult = null;

    // Update lifecycle stage on meaningful engagement
    if (eventConfig.stage) {
      updateFields.SH_Engagement_Stage = eventConfig.stage;

      // ── SEQUENCE BRANCHING: Opens >= 2 → warm sequence ──
      if (eventType === "email-opened" && existingLead) {
        const newOpenCount = (existingLead.SH_Emails_Opened || 0) + 1;
        const currentSequence = (sequence.sequenceName || "").toLowerCase();
        const isColdSequence = currentSequence.includes("cold") || currentSequence.includes("nurture");
        const notAlreadyWarm = !existingLead.SH_Tags?.includes("warm-engaged");

        if (newOpenCount >= 2 && isColdSequence && notAlreadyWarm) {
          branchResult = await branchProspect(email, "lead-nurture-warm", `opens=${newOpenCount} from cold sequence`);
        }
      }

      // Auto-promote to MQL on reply
      if (eventType === "reply-received" && existingLead) {
        const currentStage = existingLead.Lifecycle_Stage || "";
        if (currentStage === "New" || currentStage === "") {
          updateFields.Lifecycle_Stage = "MQL";
          updateFields.MQL_Date = new Date().toISOString().split("T")[0];
        }

        // Classify the reply using Claude and save category + draft
        const replyText = payload.receivedReplyMessage || payload.reply_text || "";
        if (replyText) {
          try {
            const classification = await classifyReplyWithClaude(replyText);
            updateFields.SH_Reply_Category = classification.category;
            updateFields.SH_Reply_Confidence = classification.confidence;
            updateFields.SH_Reply_Response_Draft = classification.responseDraft;
            if (classification.category === "unsubscribe") updateFields.SH_Do_Not_Email = true;

            await logSync("saleshandy", "inbound", "reply_classification", zohoId || null, email, {
              event: eventType,
              sequence: sequence.sequenceName,
              category: classification.category,
              confidence: classification.confidence,
            }, "success", null);
          } catch (err) {
            console.error("Reply classification error:", err.message);
            await logSync("saleshandy", "inbound", "reply_classification", zohoId || null, email, {
              event: eventType,
              sequence: sequence.sequenceName,
              reply_text: replyText.substring(0, 400),
            }, "error", err.message);
          }
        }
      }

      // Mark as disqualified on bounce/unsub
      if (eventType === "email-bounced" || eventType === "prospect-unsubscribed") {
        updateFields.SH_Do_Not_Email = true;
      }
    }

    // ── SEQUENCE BRANCHING: Sequence finished with no reply → re-engagement ──
    if (eventType === "prospect-finished" && existingLead) {
      const hasReplied = (existingLead.SH_Replies || 0) > 0;
      const notAlreadyReengaged = !existingLead.SH_Tags?.includes("stale-30d");

      if (!hasReplied && notAlreadyReengaged) {
        branchResult = await branchProspect(email, "re-engagement", "sequence finished with no reply");
      }
    }

    // Handle outcome updates
    if (eventType === "prospect-outcome-updated") {
      updateFields.SH_Outcome = payload.newOutcome || "";
      updateFields.SH_Previous_Outcome = payload.oldOutcome || "";

      // Map SalesHandy outcomes to Zoho lifecycle stages
      const outcomeStageMap = {
        "Interested": "MQL",
        "Meeting Booked": "SQL",
        "Meeting Completed": "SQL",
        "Closed": "Customer",
        "Not Interested": "Disqualified",
        "Do Not Contact": "Disqualified",
        "Out of Office": null,
        "Auto Reply": null,
        "Wrong Person": "Disqualified",
      };
      const mappedStage = outcomeStageMap[payload.newOutcome];
      if (mappedStage) {
        updateFields.Lifecycle_Stage = mappedStage;
        if (mappedStage === "MQL") updateFields.MQL_Date = new Date().toISOString().split("T")[0];
        if (mappedStage === "SQL") updateFields.SQL_Date = new Date().toISOString().split("T")[0];
      }

      // ── SEQUENCE BRANCHING: Meeting Completed → post-demo sequence ──
      if (payload.newOutcome === "Meeting Completed") {
        const notAlreadyPostDemo = !existingLead?.SH_Tags?.includes("demo-completed");
        if (notAlreadyPostDemo) {
          branchResult = await branchProspect(email, "post-demo", "outcome=Meeting Completed");
        }
      }
    }

    // Store reply content for context
    if (eventType === "reply-received" && payload.receivedReplyMessage) {
      updateFields.SH_Last_Reply_Snippet = (payload.receivedReplyMessage || "").substring(0, 2000);
      updateFields.SH_Reply_Date = new Date().toISOString().split("T")[0];
    }

    // Store bounce reason
    if (eventType === "email-bounced" && payload.bounceReason) {
      updateFields.SH_Bounce_Reason = (payload.bounceReason || "").substring(0, 500);
    }

    // The native SalesHandy-Zoho integration handles lead creation,
    // activity notes, and basic field sync. We only update our CUSTOM
    // scoring/lifecycle fields on existing leads.
    let result;
    if (zohoId) {
      result = await zohoApiRequest("PUT", `/Leads/${zohoId}`, accessToken, {
        data: [updateFields],
        trigger: ["workflow"],
      });
    } else {
      // Lead not found in Zoho yet — the native integration will create it.
      // Log to Supabase only; skip Zoho write to avoid race condition.
      console.log(`Lead ${email} not in Zoho yet — native integration will create. Logging to Supabase only.`);
      result = { data: { data: [{ status: "deferred_to_native", details: {} }] } };
    }

    const resultId = result.data?.data?.[0]?.details?.id || zohoId || null;
    const resultStatus = result.data?.data?.[0]?.status || "unknown";

    console.log(`Zoho update for ${email}: ${resultStatus} (${resultId}) | event=${eventType}`);

    // Log engagement event to Supabase for analytics
    const { error: logError } = await supabase.from("sh_engagement_log").insert({
      email,
      event_type: eventType,
      sequence_name: sequence.sequenceName || null,
      sequence_id: sequence.id || null,
      step_number: sequence.stepNumber ? parseInt(sequence.stepNumber, 10) : null,
      variant: sequence.variant || null,
      sender_email: sequence.senderEmail || null,
      subject: sequence.emailSubject || null,
      outcome: payload.newOutcome || payload.sequence?.latestOutcome || null,
      deal_value: sequence.dealValue ? parseFloat(sequence.dealValue) : null,
      open_count: payload.openCount || null,
      bounce_reason: payload.bounceReason || null,
      reply_snippet: eventType === "reply-received" ? (payload.receivedReplyMessage || "").substring(0, 500) : null,
      zoho_lead_id: resultId,
      raw_payload: payload,
      created_at: new Date().toISOString(),
    });

    if (logError) console.warn("Failed to log to sh_engagement_log:", logError.message);

    // ── Sender health tracking ──
    const senderEmail = sequence.senderEmail;
    if (senderEmail) {
      const healthResult = await updateSenderHealth(supabase, senderEmail, eventType);
      if (healthResult === "paused") {
        console.warn(`Sender ${senderEmail} auto-paused due to high bounce rate`);
      }
    }

    await logSync("saleshandy", "inbound", "engagement", resultId, email, {
      event: eventType,
      sequence: sequence.sequenceName,
      step: sequence.stepNumber,
      engagement_score: updateFields.SH_Engagement_Score,
      branch: branchResult,
    }, "success", null);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        status: "ok",
        event: eventType,
        email,
        zoho_id: resultId,
        zoho_status: resultStatus,
        engagement_score: updateFields.SH_Engagement_Score,
        branch: branchResult,
      }),
    };

  } catch (err) {
    console.error(`Error processing SalesHandy event for ${email}:`, err.message);
    await logSync("saleshandy", "inbound", "engagement", null, email, payload, "error", err.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
