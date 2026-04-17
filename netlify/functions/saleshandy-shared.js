// netlify/functions/saleshandy-shared.js
// Shared utilities for SalesHandy integration (webhook + API)
// Single source of truth for lead scoring, classification, deal estimation, and tagging.

// ── Lead Scoring Algorithm ──────────────────────────────────
// Unified scorer — accepts a flat prospect object OR person+organization pair.
// Caller can pass { email, title, industry, employeeCount, linkedin, techStack, totalFunding }
// or { person: {...}, organization: {...} } — we normalize internally.

function calculateLeadScore(input, orgInput) {
  let title, industry, email, employeeCount, techStack, funding, linkedin;

  if (orgInput) {
    // person + organization form (used by saleshandy-api build action)
    title = (input.title || input.jobTitle || "").toLowerCase();
    email = input.email || "";
    linkedin = input.linkedin_url || input.linkedin || "";
    industry = (orgInput.industry || "").toLowerCase();
    employeeCount = orgInput.estimated_num_employees || orgInput.employeeCount || 0;
    techStack = (Array.isArray(orgInput.technologies) ? orgInput.technologies.join(" ") : (orgInput.techStack || "")).toLowerCase();
    funding = orgInput.total_funding || orgInput.totalFunding || 0;
  } else {
    // flat prospect form (used by webhook auto-enrichment)
    title = (input.title || input.jobTitle || "").toLowerCase();
    email = input.email || "";
    linkedin = input.linkedin || input.linkedinUrl || "";
    industry = (input.industry || "").toLowerCase();
    employeeCount = parseInt(input.employeeCount || input.employee_count || input.companySize || 0, 10);
    techStack = (Array.isArray(input.technologies) ? input.technologies.join(" ") : (input.techStack || "")).toLowerCase();
    funding = parseFloat(input.totalFunding || input.total_funding || 0);
  }

  let score = 0;

  // Company size scoring
  if (employeeCount >= 1001) score += 30;
  else if (employeeCount >= 201) score += 20;
  else if (employeeCount >= 50) score += 10;

  // Title seniority scoring
  if (/\b(ceo|cfo|coo|cto|cpo|chro|chief|president|founder)\b/.test(title)) score += 25;
  else if (/\b(vp|vice president|svp|evp)\b/.test(title)) score += 25;
  else if (/\b(director|head of)\b/.test(title)) score += 25;
  else if (/\b(manager|lead)\b/.test(title)) score += 15;

  // HR/People/Culture title bonus
  if (/\b(hr|human resources|people|culture|talent|engagement|employee experience|organizational development|dream manager)\b/.test(title)) score += 20;

  // Industry scoring
  if (/\b(technology|software|saas|professional services|consulting|financial|healthcare|distribution|manufacturing|construction|field services)\b/.test(industry)) score += 15;

  // Corporate email (not free provider)
  const freeProviders = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com"];
  const emailDomain = (email.split("@")[1] || "").toLowerCase();
  if (emailDomain && !freeProviders.includes(emailDomain)) score += 10;

  // LinkedIn presence
  if (linkedin) score += 5;

  // Funding signal
  if (funding >= 10000000) score += 10;

  // HR tech stack signal
  if (/\b(workday|bamboohr|gusto|adp|paychex|namely|lattice|culture amp|15five|glint|qualtrics|peakon)\b/.test(techStack)) score += 10;

  return Math.min(score, 100);
}

// ── Title seniority classifier ──────────────────────────────

function classifyTitleSeniority(title) {
  const t = (title || "").toLowerCase();
  if (/\b(ceo|cfo|coo|cto|cpo|chro|chief|president|founder|owner)\b/.test(t)) return "C-Suite";
  if (/\b(vp|vice president|svp|evp)\b/.test(t)) return "VP";
  if (/\b(director|head of)\b/.test(t)) return "Director";
  if (/\b(manager|lead|supervisor)\b/.test(t)) return "Manager";
  return "IC";
}

// ── Company size band ───────────────────────────────────────

function getCompanySizeBand(count) {
  if (!count || count <= 0) return "Unknown";
  if (count <= 50) return "1-50";
  if (count <= 200) return "51-200";
  if (count <= 1000) return "201-1000";
  if (count <= 5000) return "1001-5000";
  return "5000+";
}

// ── Estimate deal metrics ───────────────────────────────────

function estimateDealMetrics(employeeCount) {
  let seats, monthlyPrice;
  if (!employeeCount || employeeCount <= 50) {
    seats = 5; monthlyPrice = 125;
  } else if (employeeCount <= 200) {
    seats = 10; monthlyPrice = 225;
  } else if (employeeCount <= 1000) {
    seats = 25; monthlyPrice = 499;
  } else {
    seats = 50; monthlyPrice = 899;
  }
  return { seats, estimatedDealValue: monthlyPrice * 12 };
}

// ── Auto-tag generator ──────────────────────────────────────
// Accepts flat prospect OR person+organization. Normalizes internally.

function generateAutoTags(input, orgOrScore, scoreOrSeniority, seniorityOrSizeBand, maybeSizeBand) {
  let title, employeeCount, leadScore, seniority;

  if (typeof orgOrScore === "object" && orgOrScore !== null && !Array.isArray(orgOrScore)) {
    // person + organization + leadScore + seniority + sizeBand form
    title = (input.title || input.jobTitle || "").toLowerCase();
    employeeCount = orgOrScore.estimated_num_employees || orgOrScore.employeeCount || 0;
    leadScore = scoreOrSeniority;
    seniority = seniorityOrSizeBand;
  } else {
    // flat: prospect + leadScore + seniority + campaign
    title = (input.title || input.jobTitle || "").toLowerCase();
    employeeCount = parseInt(input.employeeCount || input.employee_count || input.companySize || 0, 10);
    leadScore = orgOrScore;
    seniority = scoreOrSeniority;
  }

  const tags = [];

  tags.push("enriched-import");
  if (leadScore >= 40) tags.push("mql");
  if (seniority === "C-Suite") tags.push("c-suite");

  if (/\b(hr|human resources|people|culture|talent|engagement|employee experience|organizational development|dream manager)\b/.test(title)) {
    tags.push("hr-leader");
  }

  if (employeeCount <= 200) tags.push("smb");
  else if (employeeCount <= 1000) tags.push("mid-market");
  else if (employeeCount > 1000) tags.push("enterprise");

  return tags;
}

// ── Engagement score calculator ─────────────────────────────

function calculateEngagementScore(eventType, existingScore) {
  const base = existingScore || 0;
  const points = {
    "email-sent": 0,
    "email-opened": 5,
    "email-link-clicked": 15,
    "reply-received": 30,
    "email-bounced": -10,
    "prospect-unsubscribed": -20,
    "prospect-finished": 0,
    "prospect-outcome-updated": 0,
  };
  return Math.max(0, Math.min(100, base + (points[eventType] || 0)));
}

// ── Detect campaign from sequence name ──────────────────────

function detectCampaign(sequenceName) {
  const name = (sequenceName || "").toLowerCase();
  if (/dream|dmp|dreamcompass/.test(name)) return "dream-manager";
  if (/forge|launch|entrepreneur/.test(name)) return "trinity-forge";
  if (/calibrate|optimize|ai/.test(name)) return "trinity-calibrate";
  if (/unicorn|integrated|human.*machine/.test(name)) return "unicorn";
  return "cold-outbound";
}

// ── Map routed property to campaign ─────────────────────────

function mapRoutedPropertyToCampaign(property) {
  if (!property || typeof property !== "string") return null;
  const normalized = property.trim().toLowerCase();
  if (normalized.includes("dream") || normalized.includes("retention") || normalized.includes("culture")) {
    return "dream-manager";
  }
  if (normalized.includes("calibrate") || normalized.includes("operational") || normalized.includes("ai")) {
    return "trinity-calibrate";
  }
  if (normalized.includes("forge") || normalized.includes("venture") || normalized.includes("pivot")) {
    return "trinity-forge";
  }
  if (normalized.includes("consult") || normalized.includes("complex")) {
    return "unicorn";
  }
  return "dream-manager";
}

// ── JSON extraction from Claude responses ───────────────────

function extractJsonFromText(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// ── Normalize reply category ────────────────────────────────

function normalizeReplyCategory(category) {
  const normalized = String(category || "").trim().toLowerCase();
  const allowed = ["interested", "objection", "not now", "unsubscribe"];
  if (allowed.includes(normalized)) return normalized;
  if (normalized.includes("interest")) return "interested";
  if (normalized.includes("object")) return "objection";
  if (normalized.includes("unsub")) return "unsubscribe";
  return "not now";
}

module.exports = {
  calculateLeadScore,
  classifyTitleSeniority,
  getCompanySizeBand,
  estimateDealMetrics,
  generateAutoTags,
  calculateEngagementScore,
  detectCampaign,
  mapRoutedPropertyToCampaign,
  extractJsonFromText,
  normalizeReplyCategory,
};
