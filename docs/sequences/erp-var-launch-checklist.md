# ERP VAR Sequence — Launch Checklist

Final status after the 2026-05-17 autonomous build. **All Saleshandy + Netlify work is done.** Only Zoho (2 minutes) and the canary remain.

## Status

| Item | Status |
|------|--------|
| ERP Platform custom field in Saleshandy | ✅ `qwmNG19ePj` (fallback "ERP") |
| Cold sequence — 5 steps with A+B subject variants, Days 1/4/8/13/19 | ✅ Sequence ID `847638` |
| Warm sequence — 3 steps with A+B subject variants, Days 1/5/11 | ✅ Sequence ID `847642` |
| Mon-Thu send window (custom schedule "Trinity ERP VAR (Mon–Thu)") | ✅ Created + assigned to both sequences |
| Netlify env vars (9 vars) | ✅ Set on Saleshandy production |
| Netlify production redeploy | ✅ Deployed |
| `validate-config` health check | ✅ Both sequences report `missingSteps: []` |
| Zoho lead source + custom field | ⬜ 2 min manual — see §1 |
| Canary | ⬜ After §1 — see §2 |

## §1. Zoho — 2 minutes

Saleshandy and the Saleshandy ↔ Zoho integration are both ready; the only remaining gap is that two Zoho fields don't yet exist, so values will silently drop on those two fields until you create them. The rest of the upsert still works.

### 1a. Lead Source picklist

Open: https://crm.zoho.com/crm/org886289358/settings/modules/Leads/layouts/6689918000000091055

Find **Lead Source** field → click the settings/edit icon → **Add Picklist Value** → enter `ERP VAR Cold Outbound` → Save.

### 1b. SH_ERP_Platform custom field

Same layout editor. Drag a **Single Line** field from the left rail onto the layout (any section is fine — "Lead Information" works) → name it **`SH_ERP_Platform`** (exact name, with underscore) → Max length 30 → Save the layout.

(Note: if `SH_Routed_Property` is a picklist with restricted values, also add `"Trinity One"` to it. If it's free text, no action needed.)

## §2. Canary

Once §1 is done, run a 5-prospect paid canary:

```bash
cd ~/Documents/GitHub/Saleshandy
BUILD_TEST_MODE=paid-canary \
BUILD_TEST_EMAIL=<one-real-erp-var-contact-from-your-list> \
BUILD_TEST_CAMPAIGN=erp-var \
node scripts/test-saleshandy-build.js
```

Expected outcomes:
- [ ] Prospect appears in **Trinity One — ERP VAR Cold** Step 1 in Saleshandy.
- [ ] Zoho lead created with `SH_Routed_Property = "Trinity One"`, `SH_ERP_Platform` populated (or empty if Claude couldn't detect the platform), `Lead_Source_Detail = "SalesHandy – erp-var"`.
- [ ] Supabase `crm_sync_log` row with `payload.erp_platform` set.

## §3. List arrival → staged import

When the list is ready:

- [ ] Drop CSV in `~/Documents/GitHub/Saleshandy/` (or wherever the build script reads).
- [ ] Spot-check 10 rows for VAR-fit accuracy before bulk import.
- [ ] Import 25–40 prospects/day across cold-pool senders. The current cold-pool has 5 senders in warmup mode at 5/day each (25/day total).
- [ ] Tag with `lead_source:erp-var-2026-Q2` for reporting.
- [ ] Monitor `sh_engagement_log` daily for the first 5 business days.

**Sender pool note:** All 5 cold senders are in `warmup` status with `daily_limit: 5`. Saleshandy or your warmup tool will increment toward `max_daily_limit: 50` over time. For the first batch you're capped at ~25 imports/day; that's a feature, not a bug.

## Reference: IDs at a glance

```
Sequences:
  Cold  → https://my.saleshandy.com/sequence/847638/steps
  Warm  → https://my.saleshandy.com/sequence/847642/steps

Schedule:
  Trinity ERP VAR (Mon–Thu) — 09:00–18:00 sender-local, Mon–Thu only

Custom field:
  ERP Platform → qwmNG19ePj  (merge tag: {{ERP Platform}}, fallback "ERP")

Cold step IDs (1→5): 2419237, 2419238, 2419240, 2419241, 2419242
Warm step IDs (1→3): 2419243, 2419244, 2419245

Netlify site:
  saleshandy-outbound (project ID 602a658b-0af8-4246-b802-5a7525df7f26)
```
