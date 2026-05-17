# ERP VAR Sequence — Launch Checklist

Everything that needs to happen outside the code I just committed, in the order it needs to happen.

## 1. Saleshandy custom field (5 min)

In Saleshandy → Settings → Prospect Fields:

- [ ] Create a new text field called **"ERP Platform"**.
- [ ] Capture the field ID from the URL or settings page (looks like `GlPYv8WvaV`).
- [ ] Save for step 2.

## 2. Saleshandy sequence build (45 min — both sequences)

Open `docs/sequences/erp-var-cold-copy.md` in this repo. Paste-ready.

### Sequence A: Trinity One — ERP VAR Cold

- [ ] Create new sequence named exactly **"Trinity One — ERP VAR Cold"** (the name regex `detectCampaign` recognizes is forgiving but consistent name aids debugging).
- [ ] Sender pool: cold-pool.
- [ ] Create 5 steps with the days, subjects, and bodies in the doc.
- [ ] Add subject **A/B variants** for each step (Saleshandy native A/B feature — NOT spintax).
- [ ] Send window: Mon–Thu, 9am–4pm prospect-local.
- [ ] Stop on reply, click-to-call, unsubscribe.
- [ ] Save each step ID (visible in step URL: `.../sequences/<seq_id>/steps/<step_id>`).

### Sequence B: Trinity One — ERP VAR Warm

- [ ] Create new sequence named **"Trinity One — ERP VAR Warm"**.
- [ ] Sender pool: warm-pool.
- [ ] Create 3 steps from the Warm section of the copy doc.
- [ ] Save each step ID.

## 3. Netlify env vars (10 min)

On the **Saleshandy site** in Netlify → Environment variables:

- [ ] `SH_SEQ_ERPVAR_COLD_STEP1` = (cold step 1 ID)
- [ ] `SH_SEQ_ERPVAR_COLD_STEP2` = (cold step 2 ID)
- [ ] `SH_SEQ_ERPVAR_COLD_STEP3` = (cold step 3 ID)
- [ ] `SH_SEQ_ERPVAR_COLD_STEP4` = (cold step 4 ID)
- [ ] `SH_SEQ_ERPVAR_COLD_STEP5` = (cold step 5 ID)
- [ ] `SH_SEQ_ERPVAR_WARM_STEP1` = (warm step 1 ID)
- [ ] `SH_SEQ_ERPVAR_WARM_STEP2` = (warm step 2 ID)
- [ ] `SH_SEQ_ERPVAR_WARM_STEP3` = (warm step 3 ID)
- [ ] `SH_FIELD_ERP_PLATFORM` = (the field ID from step 1)
- [ ] **Trigger a Netlify redeploy** of the Saleshandy site so functions pick up the new env (Netlify functions don't hot-reload env vars).

## 4. Zoho lead source + custom field (10 min)

In Zoho → Setup → Customization → Modules → Leads:

- [ ] Add `"ERP VAR Cold Outbound"` to the **Lead Source** picklist.
- [ ] Add a new custom field on Leads named **"SH_ERP_Platform"** (Single Line text, ~20 chars). The Saleshandy upsert is already wired to populate it. If the field doesn't exist, the upsert silently drops the value — no error, just no data captured.
- [ ] Make sure SH_Routed_Property accepts the new picklist value `"Trinity One"` (or change the field type to free text if it's a picklist).

## 5. Trinity One site deploy (auto)

The `var-scorecard.html` page and the `/var-scorecard` redirect were committed to `trinity_one_consulting`. Netlify should auto-deploy on push. Verify:

- [ ] Visit `https://trinityoneconsulting.com/var-scorecard` — page loads, all 12 questions render.
- [ ] Answer all questions, click "See My Score" — results panel renders with breakdown.
- [ ] Open DevTools → Application → check `dataLayer` array contains a `var_scorecard_completed` event after submission.

If Googlebot fetch breaks (the CNAME issue from memory), use Search Console URL Inspection to request indexing.

## 6. Canary run (15 min)

Once steps 1–4 are done, run a 5-prospect canary:

```bash
cd ~/Documents/GitHub/Saleshandy
BUILD_TEST_MODE=paid-canary \
BUILD_TEST_EMAIL=<one-real-erp-var-contact-from-your-list> \
BUILD_TEST_CAMPAIGN=erp-var \
node scripts/test-saleshandy-build.js
```

Then verify:

- [ ] Prospect appears in the **Trinity One — ERP VAR Cold** sequence in Saleshandy.
- [ ] Zoho lead created with `SH_Routed_Property = "Trinity One"`, `SH_ERP_Platform = "<detected platform>"`, `Lead_Source = "SalesHandy"`, `Lead_Source_Detail = "SalesHandy – erp-var"`.
- [ ] Supabase `crm_sync_log` has a row with `payload.erp_platform` populated.

If any of these fail, do NOT proceed to staging. Diagnose first.

## 7. List arrival → staged import

When the list is ready:

- [ ] Drop the CSV in `~/Documents/GitHub/Saleshandy/` (or wherever the build script reads from).
- [ ] Dedupe against existing Zoho leads (the build pipeline does this automatically via `duplicate_check_fields`, but spot-check ~10 rows for ICP accuracy first).
- [ ] Import in waves of **25–40 prospects/day** across the cold-pool senders. The pipeline rotates senders automatically.
- [ ] Tag all imported prospects with `lead_source:erp-var-2026-Q2` (or similar) for clean reporting.
- [ ] Monitor `sh_engagement_log` daily for the first 5 business days.

## 8. Iteration gates

- **At 50 sends:** spot-check 10 replies vs the classifier's tagging. If accuracy < 90%, tighten the reply-classifier prompt.
- **At 200 sends:** review the subject-line variant winners. Lock the winning A/B per step; rotate in a new B variant for the loser.
- **At 200 sends:** look at scorecard click-through rate from touch 1. Anything below 4% → swap the subject line or rewrite the touch.

## 9. Things explicitly NOT done in v1

(Will be follow-up tickets if v1 lands well.)

- LinkedIn parallel outbound to the same prospects.
- Paid retargeting of scorecard visitors.
- Internal Trinity One dashboard tile for ERP VAR pipeline (you'd want one once the volume is real).
- ABM pairing logic when two contacts from the same VAR firm are on the list.

## Reference: env var summary

```bash
# Already configured (existing infra)
SALESHANDY_API_KEY
ANTHROPIC_API_KEY
SUPABASE_URL, SUPABASE_SERVICE_KEY
ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET
SH_FIELD_ROUTED_PROPERTY, SH_FIELD_PERSONALIZED_SEQUENCE  # existing

# NEW — must be set before launch
SH_SEQ_ERPVAR_COLD_STEP1
SH_SEQ_ERPVAR_COLD_STEP2
SH_SEQ_ERPVAR_COLD_STEP3
SH_SEQ_ERPVAR_COLD_STEP4
SH_SEQ_ERPVAR_COLD_STEP5
SH_SEQ_ERPVAR_WARM_STEP1
SH_SEQ_ERPVAR_WARM_STEP2
SH_SEQ_ERPVAR_WARM_STEP3
SH_FIELD_ERP_PLATFORM
```
