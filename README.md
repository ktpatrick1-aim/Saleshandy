# Saleshandy Outbound

Saleshandy integration and outbound sales automation for Trinity One Consulting.

Extracted from dreamcompass-v2 into standalone repo.

## Structure
- `netlify/functions/saleshandy-api.js` — Main API handler (campaigns, enrichment, tagging)
- `netlify/functions/saleshandy-webhook.js` — Incoming Saleshandy event webhook
- `netlify/functions/saleshandy-sender.js` — Sender pool health management (helper)
- `netlify/functions/saleshandy-shared.js` — Shared utilities (helper)
- `SALESHANDY-SETUP.md` — Setup documentation
- `SALESHANDY-ENRICHMENT-RUNBOOK.md` — Operational runbook
- `supabase-migration-sender-pool.sql` — Database schema for sender pool

## Dependencies
- `@supabase/supabase-js` — Supabase client

## Environment Variables
See SALESHANDY-SETUP.md for the full list. Core groups:
- Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- Anthropic: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- Saleshandy: `SALESHANDY_API_KEY`, `SALESHANDY_WEBHOOK_TOKEN`
- Saleshandy field IDs: `SH_FIELD_*`
- Saleshandy sequence steps: `SH_SEQ_*`
- Sender pool: `SH_SENDER_*`
- Zoho: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`
- Admin: `ADMIN_DASHBOARD_PASSWORD`
