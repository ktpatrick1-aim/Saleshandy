# Trinity One — ERP VAR Cold Sequence (paste-ready copy)

5 email steps + 2 subject variants per step. Cold-pool senders. Stop on reply.

**Merge tags (Saleshandy syntax — double curly braces):**
- `{{first_name}}`, `{{last_name}}`, `{{company}}`
- `{{erp_platform}}` — new custom field
- `{{var_scorecard_url}}` — `https://trinityoneconsulting.com/var-scorecard`
- `{{calibrate_audit_url}}` — `https://trinitycalibrate.com/audit`
- `{{calendar_url}}` — KP Calendly
- `{{linkedin_url}}` — `https://www.linkedin.com/in/ktpatrick1/` (confirm)
- `{{meridian_url}}` — `https://trinitymeridian.com/early-access`
- `{{keystone_url}}` — `https://trinitykeystone.com/tour`
- `{{quarter_end}}` — e.g., "June 30" (set at import time)

If `{{erp_platform}}` is blank, the sentence using it still reads cleanly because of the fallback wording.

---

## Step 1 — Day 0 — Pattern interrupt

### Subject A
{{first_name}}, what runs {{company}}?

### Subject B
ERP VARs running on spreadsheets

### Body
Hi {{first_name}},

You sell {{erp_platform}} to firms that need a real system of record. What's yours?

Most ERP VARs we talk to run delivery on spreadsheets, the CRM is a contact dump, and post-go-live the customer just… disappears into the support queue.

We built the scorecard we wish we'd had when we were running a services firm. 12 questions, ~4 minutes, no email gate:

{{var_scorecard_url}}

If the score lands where most do (the median is uncomfortable), happy to share what we built to fix it.

— KP

Kevin Patrick
Trinity One Consulting
{{linkedin_url}}

---

## Step 2 — Day +3 — The 25 / 50 / 100 wall

### Subject A
the wall at 50 FTE

### Subject B
{{company}} past the founder yet?

### Body
{{first_name}} — quick one.

Across the ERP VARs we work with, three operational ceilings are predictable enough to set your watch by:

• ~25 FTE — the founder is still the bottleneck on every deal review.
• ~50 FTE — services margin starts compressing even as revenue grows.
• ~100 FTE — nobody knows what the customer was promised at sale.

Which one is closest to where {{company}} sits right now? Reply with the number — that's the whole ask.

— KP

---

## Step 3 — Day +7 — Specific insight + Calibrate Audit

### Subject A
your services margin is leaking 18%

### Subject B
the implementation tail problem

### Body
{{first_name}},

Across the ERP VAR audits we've run, the median services-margin loss to resource-utilization gaps and post-SOW scope creep is ~18%. The fix isn't another PSA tool — it's an operating model that ties the sale, the SOW, and the delivery plan together.

We do a free Calibrate Audit for services-SMBs through {{quarter_end}}. Same diagnostic we run with paying clients. 14-day turnaround, written report, 90-day plan. No pitch attached:

{{calibrate_audit_url}}

If the timing is off, no worries — happy to send the audit framework as a PDF instead. Just say the word.

— KP

---

## Step 4 — Day +12 — Channel switch + LinkedIn

### Subject A
compare notes?

### Subject B
{{first_name}} — quick one

### Body
{{first_name}},

I won't keep cluttering your inbox. If a 15-minute "compare notes" call is useful, here's my calendar:

{{calendar_url}}

I'll show you our internal operating dashboard (the one we built for ourselves before we productized it as Meridian) if you show me yours. No slides, no pitch.

Or just connect on LinkedIn and we'll let it breathe:

{{linkedin_url}}

— KP

---

## Step 5 — Day +18 — Breakup + product self-serve

### Subject A
closing the loop on {{company}}

### Subject B
last note

### Body
{{first_name}},

Last note from me on this thread — I'll close the file on my end.

If you ever want to poke at the software side without a call:

• **Meridian** — the PM tool we built for services-SMBs (the kind of project visibility most PSA tools fake): {{meridian_url}}
• **Keystone** — services-aware CRM with deal-to-delivery handoff baked in: {{keystone_url}}

Both are running in production for us and a handful of early clients. The early-access tier is meaningful pricing if you want a closer look later.

Wishing {{company}} a strong quarter.

— KP

---

# Warm branch (erp-var-warm)

Auto-triggered when the reply classifier tags a reply as `interested`. 3 steps over ~10 days. Sender pool: warm-pool. KP is also alerted via Pushover for hot-handoff.

## Warm Step 1 — Day 0 (immediate hot follow-up)

### Subject A
re: {{company}} — quick yes

### Subject B
glad you replied, {{first_name}}

### Body
{{first_name}},

Thanks for the reply. Two options — pick whichever is easier:

1. **15 minutes on the phone** — I'll ask 3 questions, you'll know within 10 minutes if there's a fit: {{calendar_url}}
2. **Free Calibrate Audit, async** — 14-day turnaround, no call required, you get a written report + 90-day plan: {{calibrate_audit_url}}

Either works. I'm partial to the audit because the deliverable is real either way.

— KP

---

## Warm Step 2 — Day +4 — Add proof / case context

### Subject A
quick context on what we'd actually do

### Subject B
how this usually plays out for {{erp_platform}} VARs

### Body
{{first_name}},

In case it helps you decide — here's roughly what a typical engagement with a ~{{erp_platform}} VAR looks like in our world:

1. **Calibrate Audit (free)** — 2 weeks, written diagnostic + 90-day plan.
2. **Targeted fix sprint** — usually one of: GTM motion (Forge), services-delivery operating model (Calibrate Fractional COO), or CRM/PM re-platform (Keystone + Meridian).
3. **Ongoing cadence** — monthly leadership notes, quarterly strategy reviews.

Most VARs we work with start with the audit and decide from there. No pressure either way:

{{calendar_url}} or {{calibrate_audit_url}}

— KP

---

## Warm Step 3 — Day +10 — Soft close

### Subject A
loop-close on {{company}}

### Subject B
still around?

### Body
{{first_name}},

Closing the loop. If the timing isn't right, totally fine — I'll check back in 90 days.

If it is and you just need a different entry point, here are the three I'd suggest in order of commitment:

• {{var_scorecard_url}} — 4-minute self-score, no email.
• {{calibrate_audit_url}} — async written audit.
• {{calendar_url}} — 15-min call.

— KP

---

# Authoring notes (for the Saleshandy UI build)

- Plain-text, no HTML formatting beyond what Saleshandy adds for links.
- Do NOT use spintax `{a|b|c}` — Saleshandy will send the literal braces. Subject variants are configured via the native A/B feature, not spintax. (See `lintVariant` in `saleshandy-api.js` — it will flag spintax mistakes.)
- The em-dash before "— KP" is intentional and on-brand; keep it.
- Mobile-first formatting: short paragraphs, blank line between thoughts, bullets sparing.
- Do not include an unsubscribe footer — Saleshandy injects one automatically.
