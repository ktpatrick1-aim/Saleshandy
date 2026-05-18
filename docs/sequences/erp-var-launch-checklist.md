# ERP VAR Sequence — Launch Checklist

What's still on you to finish, in order. The big stuff (custom field, both sequences, all 8 steps) was already built via Playwright on 2026-05-17.

## Status

| Item | Status |
|------|--------|
| ERP Platform custom field | ✅ Created (ID `qwmNG19ePj`) |
| Cold sequence — 5 steps, base subjects, days, bodies | ✅ Built (sequence ID `847638`) |
| Warm sequence — 3 steps, base subjects, days, bodies | ✅ Built (sequence ID `847642`) |
| Subject B variants | ⬜ Not yet — see §1 |
| Sequence send window (Mon–Thu) | ⬜ Verify — see §2 |
| Netlify env vars | ⬜ Paste — see §3 |
| Zoho lead source + SH_ERP_Platform custom field | ⬜ Create — see §4 |
| Canary | ⬜ After §3 + §4 — see §5 |

## §1. Add Subject B variants (5 min/step, ~40 min total)

For each step, open the step → click "Create variant" → enter the Subject B → paste the **same body** as variant A → Save. Saleshandy will A/B-split traffic 50/50.

| Step | Subject B |
|------|-----------|
| Cold 1 | `ERP VARs running on spreadsheets` |
| Cold 2 | `{{Company}} past the founder yet?` |
| Cold 3 | `the implementation tail problem` |
| Cold 4 | `{{First Name}} — quick one` |
| Cold 5 | `last note` |
| Warm 1 | `glad you replied, {{First Name}}` |
| Warm 2 | `how this usually plays out for {{ERP Platform}} VARs` |
| Warm 3 | `still around?` |

Variants are optional for v1 launch — single-subject sends will work fine. Add them after the first batch lands if you want A/B data.

## §2. Verify sequence settings

Open each sequence → **Settings** tab. Confirm:

- [ ] **Sending window**: Mon, Tue, Wed, Thu only (excluding Fri/Sat/Sun). Default is usually all 7 days — important to restrict because Step 4 of Cold scheduled on Sat May 30, which auto-shifts to next-business-day but cleaner if explicitly restricted.
- [ ] **Sending hours**: 9am – 4pm prospect timezone (or whatever you usually run).
- [ ] **Stop on reply / click-to-call / unsubscribe**: ON.
- [ ] **Sender pool**: assign cold-pool senders for Cold, warm-pool senders for Warm.
- [ ] **Tracking**: Open + click tracking ON (needed for engagement scoring in the existing webhook).

## §3. Netlify env vars (the IDs to paste)

On the **Saleshandy site** in Netlify → Environment variables. Paste these exact values, then trigger a redeploy (Netlify functions don't hot-reload env vars).

```bash
# Cold sequence — Trinity One — ERP VAR Cold (seq 847638)
SH_SEQ_ERPVAR_COLD_STEP1=2419237
SH_SEQ_ERPVAR_COLD_STEP2=2419238
SH_SEQ_ERPVAR_COLD_STEP3=2419240
SH_SEQ_ERPVAR_COLD_STEP4=2419241
SH_SEQ_ERPVAR_COLD_STEP5=2419242

# Warm sequence — Trinity One — ERP VAR Warm (seq 847642)
SH_SEQ_ERPVAR_WARM_STEP1=2419243
SH_SEQ_ERPVAR_WARM_STEP2=2419244
SH_SEQ_ERPVAR_WARM_STEP3=2419245

# Custom field
SH_FIELD_ERP_PLATFORM=qwmNG19ePj
```

Then: **Deploys → Trigger deploy → Clear cache and deploy site**.

## §4. Zoho lead source + custom field

In Zoho → Setup → Customization → Modules → Leads:

- [ ] Add `"ERP VAR Cold Outbound"` to the **Lead Source** picklist.
- [ ] Add a new custom field named **`SH_ERP_Platform`** (Single Line text, ~30 chars). The webhook writes to this; missing field = silent drop.
- [ ] Confirm `SH_Routed_Property` accepts the new picklist value `"Trinity One"` — either add it to the picklist, or change the field to free text.

## §5. Canary

```bash
cd ~/Documents/GitHub/Saleshandy
BUILD_TEST_MODE=paid-canary \
BUILD_TEST_EMAIL=<one-real-erp-var-contact-from-your-list> \
BUILD_TEST_CAMPAIGN=erp-var \
node scripts/test-saleshandy-build.js
```

Expected:
- [ ] Prospect appears in **Trinity One — ERP VAR Cold** Step 1.
- [ ] Zoho lead with `SH_Routed_Property = "Trinity One"`, `SH_ERP_Platform = "<detected>"`.
- [ ] Supabase `crm_sync_log` row with `payload.erp_platform` populated.

## §6. List arrival → staged import

When the list is ready:

- [ ] Drop CSV in `~/Documents/GitHub/Saleshandy/` (or wherever the build script reads).
- [ ] Spot-check 10 rows for VAR-fit accuracy before bulk import.
- [ ] Import 25–40 prospects/day across cold-pool senders.
- [ ] Tag with `lead_source:erp-var-2026-Q2` for reporting.
- [ ] Monitor `sh_engagement_log` daily for the first 5 business days.

## Reference: IDs at a glance

```
Sequences:
  Cold  → https://my.saleshandy.com/sequence/847638/steps
  Warm  → https://my.saleshandy.com/sequence/847642/steps

Custom field:
  ERP Platform → qwmNG19ePj  (merge tag: {{ERP Platform}}, fallback "ERP")

Cold step IDs (1→5): 2419237, 2419238, 2419240, 2419241, 2419242
Warm step IDs (1→3): 2419243, 2419244, 2419245
```
