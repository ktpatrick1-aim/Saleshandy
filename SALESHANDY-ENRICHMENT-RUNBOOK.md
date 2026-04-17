# SalesHandy + Claude Enrichment Runbook

This runbook is repo-local and covers the production-safe workflow for lead enrichment, sequence routing, and reply classification.

## Build API Actions

Endpoint: `/.netlify/functions/saleshandy-api`

### `action=build`

Supports three routing patterns:
1. Explicit `sequenceKey`
2. Explicit `campaign`
3. `enrichWithClaude=true` (Claude chooses property, then backend maps to campaign)

If all are omitted, request is rejected.

### `action=validate-config`

Returns a config health snapshot:
- missing SalesHandy field env IDs
- sequence step configuration status
- Anthropic/SalesHandy/Zoho credential presence

Use before any canary run.

## Required Env Variables

### Core
- `SALESHANDY_API_KEY`
- `ADMIN_DASHBOARD_PASSWORD`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`

### Claude
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` (optional)

### SalesHandy custom field IDs
- `SH_FIELD_LEAD_SCORE`
- `SH_FIELD_COMPANY_SIZE`
- `SH_FIELD_SENIORITY`
- `SH_FIELD_ZOHO_ID`
- `SH_FIELD_COMPANY_CONTEXT`
- `SH_FIELD_PAIN_POINTS`
- `SH_FIELD_ROUTED_PROPERTY`
- `SH_FIELD_PERSONALIZED_SEQUENCE`

## Safe Test Workflow

1. Dry-run test:
`BUILD_TEST_MODE=dry-run node scripts/test-saleshandy-build.js`

2. Config health check (recommended):
Call `saleshandy-api` with:
```json
{
  "action": "validate-config",
  "enrichWithClaude": true
}
```

3. Paid canary (single lead):
`BUILD_TEST_MODE=paid-canary BUILD_TEST_EMAIL=real.test@company.com BUILD_TEST_CAMPAIGN=dream-manager node scripts/test-saleshandy-build.js`

## Reply Classification

Endpoint: `/.netlify/functions/saleshandy-webhook`

### Explicit classification mode
POST payload:
```json
{
  "action": "classify_reply",
  "reply_text": "Thanks, this is interesting. Can we talk next week?",
  "email": "prospect@company.com"
}
```

### Event-driven classification mode
When SalesHandy sends `reply-received`, webhook classifies message and writes:
- `SH_Reply_Category`
- `SH_Reply_Confidence`
- `SH_Reply_Response_Draft`

Classification events are logged in `crm_sync_log` as `entity_type=reply_classification`.

## Sequence Branching

The webhook now automatically moves prospects between sequences:
- Opens >= 2 from cold → warm sequence (tagged `warm-engaged`)
- Sequence finished with no reply → re-engagement (tagged `stale-30d`)
- Outcome = "Meeting Completed" → post-demo (tagged `demo-completed`)
- Inbound/referral leads route to Sequence 6 via `source=referral` or `referredBy` field

All branching events logged in `crm_sync_log` as `entity_type=sequence_branch`.

## Inbound/Referral Leads

To import an inbound or referral lead, include `source: "referral"` or `referredBy: "Name"` in the prospect object when calling `action=build`. The system will:
1. Route to `inbound-referral` sequence instead of cold outbound
2. Set `Lead_Source=Inbound Referral` in Zoho
3. Tag with `inbound-referral` in SalesHandy

## Shared Utilities

Lead scoring, title classification, company size banding, deal estimation, and tag generation are now in `saleshandy-shared.js`. Both `saleshandy-webhook.js` and `saleshandy-api.js` import from this single source of truth.

## Production Notes

- Sequence key assignment is always derived from campaign mapping unless manually overridden.
- Inbound leads with `source=referral` or `referredBy` override campaign routing to use Sequence 6.
- If classification category is `unsubscribe`, webhook sets `SH_Do_Not_Email=true`.
- Claude enrichment quality (`claude_quality`) is logged in `crm_sync_log` during build.
- Default Claude model is now `claude-haiku-4-5-20251001` (updated from `claude-3-haiku-20240307`).
- Build action processes prospects in batches of 5 (with Claude enrichment) or 10 (without) for concurrency.
