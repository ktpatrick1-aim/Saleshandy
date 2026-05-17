# ERP VAR Cold Sequence — Design

**Status:** Approved 2026-05-17
**Owner:** KP
**Scope:** New outbound email sequence positioning the Trinity One suite + services as the operating system for ERP VARs (channel partners / SIs reselling NetSuite, Acumatica, Sage, Dynamics 365, Epicor, Infor, SAP B1).

## 1. Strategic positioning

**Master narrative:** *"You sell systems that run other people's businesses. What runs yours?"*

**One-liner:** Trinity One is the operating system for ERP VARs — a purpose-built suite (Keystone CRM, Meridian PM, Beacon CSM) wrapped by senior operators who've actually run services firms (Calibrate, Forge, Cadence).

**Positioning posture:** Suite-led, services as wrapper. The software story (Meridian / Keystone / Beacon) leads. Calibrate / Forge / Cadence appear as the human delivery layer that backs the software — "we built this because we lived it." No competitor pairs both.

## 2. ICP and audience

- **Companies:** ERP VARs, channel partners, SIs for NetSuite, Acumatica, Sage Intacct, Sage 100/300, Microsoft Dynamics 365 Business Central / F&O, Epicor, Infor, SAP Business One.
- **Size:** 15–250 FTE, $3M–$75M revenue.
- **Titles:** Owner, Founder, President, CEO, COO, VP Operations, VP Services, Practice Lead, Managing Partner.
- **Geo:** US + Canada for v1.
- **Exclude:** ERP vendors themselves; pure staffing shops; firms under 10 FTE; sub-brand resellers who are obviously dropshipping the platform with no services attached.

## 3. Sequence architecture

Five email touches over 18 days with varied CTAs per step. Cold-pool senders only. Mon–Thu send window. Reply / click-to-call / unsubscribe stops the sequence. Auto-branching on reply is handled by the existing `saleshandy-webhook` classifier.

| # | Day | Theme | CTA |
|---|----:|-------|-----|
| 1 | 0  | Pattern interrupt — identity tension | Public **VAR Operating Score** scorecard (no gate) |
| 2 | +3 | The 25 / 50 / 100 wall | Reply with one word |
| 3 | +7 | Specific insight + proof | Free **Calibrate Audit** (existing audit.html) |
| 4 | +12 | Channel switch + soft call | **LinkedIn connect** + 15-min "compare notes" |
| 5 | +18 | Breakup + product self-serve | **Meridian early access** or **Keystone tour** |

A parallel `erp-var-warm` 3-step sequence catches replies branded "interested" by the classifier. Out-of-scope for v1 spec; copy lives in the same `erp-var-cold-copy.md` doc under a Warm section.

### Cadence rules

- Send window: Mon–Thu, 9am–4pm prospect-local time.
- Reply / click-to-call / unsubscribe halts the sequence immediately (existing webhook behavior).
- Branching (existing webhook + `lifecycle_stage` field):
  - `interested` → erp-var-warm step 1, alert KP via Pushover.
  - `wrong person` → referral-ask micro-sequence (1 step) + mark for re-routing.
  - `not now` → 90-day re-engagement queue.

### Sender + deliverability

- Sender pool: `cold-pool` (existing).
- Reply-to: kevin@trinityoneconsulting.com.
- Staged import: 25–40 prospects/day per sender to protect domain reputation.
- SendGrid SMTP relay handles per-sender warming (existing infra).

## 4. Personalization and merge fields

Required prospect fields (Claude enrichment fills these):
- `{{first_name}}`, `{{last_name}}`, `{{company}}`
- `{{erp_platform}}` — NetSuite, Acumatica, Sage Intacct, etc. New field; Claude detects from website signals.
- `{{var_scorecard_url}}` — `https://trinityoneconsulting.com/var-scorecard`
- `{{calibrate_audit_url}}` — existing `https://trinitycalibrate.com/audit`
- `{{calendar_url}}` — KP Calendly
- `{{linkedin_url}}` — KP LinkedIn personal
- `{{meridian_url}}`, `{{keystone_url}}` — existing brand sites
- `{{quarter_end}}` — derived at import time

A new SalesHandy custom field `SH_FIELD_ERP_PLATFORM` (env var: `SH_FIELD_ERP_PLATFORM`) holds the detected platform.

## 5. Tech integration

### Saleshandy `SEQUENCES` registry (saleshandy-api.js)

Two new entries:

```js
"erp-var-cold": {
  name: "Trinity One — ERP VAR Cold",
  senderGroup: "cold-pool",
  stepIds: {
    1: process.env.SH_SEQ_ERPVAR_COLD_STEP1 || "",
    2: process.env.SH_SEQ_ERPVAR_COLD_STEP2 || "",
    3: process.env.SH_SEQ_ERPVAR_COLD_STEP3 || "",
    4: process.env.SH_SEQ_ERPVAR_COLD_STEP4 || "",
    5: process.env.SH_SEQ_ERPVAR_COLD_STEP5 || "",
  },
},
"erp-var-warm": {
  name: "Trinity One — ERP VAR Warm",
  senderGroup: "warm-pool",
  stepIds: {
    1: process.env.SH_SEQ_ERPVAR_WARM_STEP1 || "",
    2: process.env.SH_SEQ_ERPVAR_WARM_STEP2 || "",
    3: process.env.SH_SEQ_ERPVAR_WARM_STEP3 || "",
  },
},
```

### Routing extensions (saleshandy-shared.js)

`mapRoutedPropertyToCampaign` learns a `"Trinity One"` value (new) and a `"ERP VAR"` synonym → returns `"erp-var"`. `detectCampaign` recognizes `/erp.?var|var.?erp|trinity.?one/i` in sequence names.

### Auto-sequence assignment (saleshandy-api.js)

`assignSequence(campaign, leadScore, isInbound)` gains:
```js
case "erp-var":
  return "erp-var-cold";
```

### Claude enrichment prompt (saleshandy-api.js)

- Add `"Trinity One"` to the `recommended_property` enum.
- Add a new output key `erp_platform` (string, one of: `NetSuite`, `Acumatica`, `Sage Intacct`, `Sage 100`, `Sage 300`, `Dynamics 365 BC`, `Dynamics 365 F&O`, `Epicor`, `Infor`, `SAP B1`, `Other`, or empty if no signal).
- Prompt instructions: if the company website mentions ERP partner/reseller status, set `recommended_property` to `"Trinity One"` and populate `erp_platform`.

### Zoho

Add lead-source value `"ERP VAR Cold Outbound"` (manual one-liner in Zoho admin).

## 6. Build artifacts

### Out-of-tree (KP manual)

1. **Saleshandy UI** — build the two sequences (`Trinity One — ERP VAR Cold` and `Trinity One — ERP VAR Warm`) with copy from `docs/sequences/erp-var-cold-copy.md`. Capture step IDs from the URLs.
2. **Netlify env vars** — set `SH_SEQ_ERPVAR_COLD_STEP1..5` and `SH_SEQ_ERPVAR_WARM_STEP1..3` on the Saleshandy site. Set `SH_FIELD_ERP_PLATFORM` to the new SalesHandy field ID.
3. **Saleshandy custom field** — create `ERP Platform` text field; capture its ID for `SH_FIELD_ERP_PLATFORM`.
4. **Zoho** — add `"ERP VAR Cold Outbound"` to Lead Source picklist.
5. **Trigger Netlify redeploy** on the Saleshandy site after env vars change (functions need fresh env).

### In-tree (this commit)

1. `docs/specs/2026-05-17-erp-var-sequence-design.md` — this file.
2. `docs/sequences/erp-var-cold-copy.md` — paste-ready email copy with A/B subject variants.
3. `netlify/functions/saleshandy-api.js` — SEQUENCES + assignSequence + Claude prompt edits.
4. `netlify/functions/saleshandy-shared.js` — routing map updates.

### In trinity_one_consulting repo (separate commit)

5. `var-scorecard.html` — 12-question public scorecard, no email gate, optional report-request CTA at the end.

## 7. Measurement and success criteria

Per-touch targets (cold B2B services benchmark, conservative):

| Metric | Target |
|--------|-------:|
| Open rate (each step) | ≥ 40% |
| Cumulative reply rate | 8 – 12% |
| Scorecard click rate (touch 1) | 6 – 10% |
| Audit requests (touch 3) | 2 – 4% |
| Meetings booked | 1.5 – 3% of sent |

**v1 success criteria for the first 200 sends:**
- ≥ 3 Calibrate Audit requests.
- ≥ 1 booked discovery call.
- ≥ 5 LinkedIn connect-accepts.
- Reply-classifier accuracy ≥ 90% on a sampled 30-reply spot-check.

**A/B variants:** Subject line A/B per step at launch. After 200 sends, lock the winner per step and rotate in a new B variant.

## 8. Launch plan

Once the list arrives:

1. Validate — dedupe against Zoho existing leads (webhook does this); spot-check 10 rows for VAR-fit accuracy.
2. Enrich — run through `saleshandy-api action=build` with `enrichWithClaude: true` and `campaign: "erp-var"`.
3. Canary — 5-prospect paid canary, confirm SalesHandy ↔ Zoho ↔ Supabase round trip.
4. Stage — 25–40 prospects/day across cold-pool senders.
5. Monitor — daily for the first 5 business days, weekly thereafter; Supabase `sh_engagement_log` is the source of truth.
6. Iterate — at 200 sends, review reply samples + scorecard heatmap + variant performance; tighten copy.

## 9. Open questions / explicitly deferred

- **LinkedIn parallel touch:** Touch 4 already nudges to LinkedIn; a true parallel LinkedIn outreach pipeline is v2.
- **Other-ERP-platform handling:** If `erp_platform` resolves to `"Other"`, copy still works (the merge tag is optional and the lines that use it have safe fallbacks). Revisit if `"Other"` exceeds 20% of the list.
- **Account-based pairing:** For VAR firms where we get two contacts (e.g., founder + COO), no special handling in v1; both run independently.

## 10. Out of scope

- Paid retargeting for non-responders.
- Web ad creative tied to the sequence.
- Trinity One website nav changes (the scorecard is a standalone page; nav placement is optional).
- LinkedIn ad campaign targeting ERP VARs (covered by the separate LI ads pipeline).
