# Trinity One — ERP VAR sequences (Saleshandy 3.0 paste-ready)

This is the **final substituted** version of `erp-var-cold-copy.md` — all merge tags translated to Saleshandy 3.0 syntax (`{{First Name}}`, `{{Company}}`, `{{ERP Platform}}`) and all URLs hardcoded. Use this for Playwright-driven import or manual paste.

Quarter end pinned to **June 30** (Q2 2026); update when re-running in a new quarter.

## Custom field requirement

Before importing, the Saleshandy custom field **ERP Platform** (exact label) must exist. The Playwright build creates it as Step 0.

## Touch / day mapping (Saleshandy "Day N" field is absolute)

| Cold step | Day field value |
|-----------|----------------:|
| 1         | 1               |
| 2         | 4               |
| 3         | 8               |
| 4         | 13              |
| 5         | 19              |

| Warm step | Day field value |
|-----------|----------------:|
| 1         | 1               |
| 2         | 5               |
| 3         | 11              |

---

# Trinity One — ERP VAR Cold

Sender pool: cold-pool.
Stop on: reply, click-to-call, unsubscribe.
Send window: Mon–Thu, 9am–4pm prospect-local.

## Step 1 — Day 1 — Pattern interrupt

**Subject A:** {{First Name}}, what runs {{Company}}?
**Subject B:** ERP VARs running on spreadsheets

**Body:**
```
Hi {{First Name}},

You sell {{ERP Platform}} to firms that need a real system of record. What's yours?

Most ERP VARs we talk to run delivery on spreadsheets, the CRM is a contact dump, and post-go-live the customer just… disappears into the support queue.

We built the scorecard we wish we'd had when we were running a services firm. 12 questions, ~4 minutes, no email gate:

https://trinityoneconsulting.com/var-scorecard

If the score lands where most do (the median is uncomfortable), happy to share what we built to fix it.

— KP

Kevin Patrick
Trinity One Consulting
https://www.linkedin.com/company/trinityoneconsulting
```

## Step 2 — Day 4 — The 25 / 50 / 100 wall

**Subject A:** the wall at 50 FTE
**Subject B:** {{Company}} past the founder yet?

**Body:**
```
{{First Name}} — quick one.

Across the ERP VARs we work with, three operational ceilings are predictable enough to set your watch by:

• ~25 FTE — the founder is still the bottleneck on every deal review.
• ~50 FTE — services margin starts compressing even as revenue grows.
• ~100 FTE — nobody knows what the customer was promised at sale.

Which one is closest to where {{Company}} sits right now? Reply with the number — that's the whole ask.

— KP
```

## Step 3 — Day 8 — Specific insight + Calibrate Audit

**Subject A:** your services margin is leaking 18%
**Subject B:** the implementation tail problem

**Body:**
```
{{First Name}},

Across the ERP VAR audits we've run, the median services-margin loss to resource-utilization gaps and post-SOW scope creep is ~18%. The fix isn't another PSA tool — it's an operating model that ties the sale, the SOW, and the delivery plan together.

We do a free Calibrate Audit for services-SMBs through June 30. Same diagnostic we run with paying clients. 14-day turnaround, written report, 90-day plan. No pitch attached:

https://calibrate.trinityoneconsulting.com/audit

If the timing is off, no worries — happy to send the audit framework as a PDF instead. Just say the word.

— KP
```

## Step 4 — Day 13 — Channel switch + LinkedIn

**Subject A:** compare notes?
**Subject B:** {{First Name}} — quick one

**Body:**
```
{{First Name}},

I won't keep cluttering your inbox. If a 15-minute "compare notes" call is useful, here's my calendar:

https://calendly.com/kevin-trinityoneconsulting/30-minute-trinity-one-call-with-kevin-patrick

No slides, no pitch. I'll show you our internal operating dashboard (the one we built for ourselves before we productized it as Meridian) if you show me yours.

Or follow Trinity One on LinkedIn — we publish the operating-system playbook for services firms there:

https://www.linkedin.com/company/trinityoneconsulting

— KP
```

## Step 5 — Day 19 — Breakup + product self-serve

**Subject A:** closing the loop on {{Company}}
**Subject B:** last note

(Step 5 needs its own subject — UNCHECK "Send this email in same thread as follow-up".)

**Body:**
```
{{First Name}},

Last note from me on this thread — I'll close the file on my end.

If you ever want to poke at the software side without a call:

• Meridian — the PM tool we built for services-SMBs (the kind of project visibility most PSA tools fake): https://meridian.trinityoneconsulting.com

• Keystone — services-aware CRM with deal-to-delivery handoff baked in: https://keystone.trinityoneconsulting.com

Both are running in production for us and a handful of early clients. The early-access tier is meaningful pricing if you want a closer look later.

Wishing {{Company}} a strong quarter.

— KP
```

---

# Trinity One — ERP VAR Warm

Sender pool: warm-pool.
Triggered when the reply classifier tags a reply as `interested`.
Stop on: reply, click-to-call, unsubscribe.
Pushover alert on launch (existing webhook).

## Warm Step 1 — Day 1 — Hot follow-up

**Subject A:** re: {{Company}} — quick yes
**Subject B:** glad you replied, {{First Name}}

**Body:**
```
{{First Name}},

Thanks for the reply. Two options — pick whichever is easier:

1. 15 minutes on the phone — I'll ask 3 questions, you'll know within 10 minutes if there's a fit: https://calendly.com/kevin-trinityoneconsulting/30-minute-trinity-one-call-with-kevin-patrick

2. Free Calibrate Audit, async — 14-day turnaround, no call required, you get a written report + 90-day plan: https://calibrate.trinityoneconsulting.com/audit

Either works. I'm partial to the audit because the deliverable is real either way.

— KP
```

## Warm Step 2 — Day 5 — Add proof / context

**Subject A:** quick context on what we'd actually do
**Subject B:** how this usually plays out for {{ERP Platform}} VARs

**Body:**
```
{{First Name}},

In case it helps you decide — here's roughly what a typical engagement with a {{ERP Platform}} VAR looks like in our world:

1. Calibrate Audit (free) — 2 weeks, written diagnostic + 90-day plan.
2. Targeted fix sprint — usually one of: GTM motion (Forge), services-delivery operating model (Calibrate Fractional COO), or CRM/PM re-platform (Keystone + Meridian).
3. Ongoing cadence — monthly leadership notes, quarterly strategy reviews.

Most VARs we work with start with the audit and decide from there. No pressure either way:

https://calendly.com/kevin-trinityoneconsulting/30-minute-trinity-one-call-with-kevin-patrick

or

https://calibrate.trinityoneconsulting.com/audit

— KP
```

## Warm Step 3 — Day 11 — Soft close

**Subject A:** loop-close on {{Company}}
**Subject B:** still around?

(Warm Step 3 needs its own subject — UNCHECK "Send this email in same thread as follow-up".)

**Body:**
```
{{First Name}},

Closing the loop. If the timing isn't right, totally fine — I'll check back in 90 days.

If it is and you just need a different entry point, here are the three I'd suggest in order of commitment:

• https://trinityoneconsulting.com/var-scorecard — 4-minute self-score, no email.
• https://calibrate.trinityoneconsulting.com/audit — async written audit.
• https://calendly.com/kevin-trinityoneconsulting/30-minute-trinity-one-call-with-kevin-patrick — 15-min call.

— KP
```
