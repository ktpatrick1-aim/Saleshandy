# Trinity One — ERP VAR sequences (Saleshandy 3.0 paste-ready)

Final substituted version of the cold + warm sequences. All merge tags in Saleshandy 3.0 syntax (`{{First Name}}`, `{{Company}}`, `{{ERP Platform}}`), URLs hardcoded, quarter end pinned to **June 30**.

**Rewritten 2026-05-18** for clarity, breathing room, and mobile readability — shorter sentences, more whitespace, fewer parentheticals, plainer English.

## Custom field requirement

Field **ERP Platform** (exact label) must exist. Already created — id `qwmNG19ePj`, fallback "ERP".

## Day-field mapping (Saleshandy "Day N" is absolute, not relative)

| Cold step | Day | Warm step | Day |
|-----------|----:|-----------|----:|
| 1 | 1  | 1 | 1  |
| 2 | 4  | 2 | 5  |
| 3 | 8  | 3 | 11 |
| 4 | 13 |   |    |
| 5 | 19 |   |    |

---

# Trinity One — ERP VAR Cold

Sender pool: cold-pool. Schedule: Trinity ERP VAR (Mon–Thu). Stop on reply / click-to-call / unsubscribe.

## Step 1 — Day 1

**Subject A:** {{First Name}}, what runs {{Company}}?
**Subject B:** ERP VARs running on spreadsheets

**Body:**
```
Hi {{First Name}},

You sell {{ERP Platform}} to companies that need a real system of record.

What runs yours?

Most ERP VARs we talk to are flying with spreadsheets for delivery, a CRM that's really a contact list, and a support queue that swallows customers after go-live.

We built a 12-question scorecard for this — the one we wish we'd had when we ran a services firm. Four minutes. No email gate.

https://trinityoneconsulting.com/var-scorecard

If your score lands where most do, I'll send you what we built to fix it.

— KP

Kevin Patrick
Trinity One Consulting
https://www.linkedin.com/company/trinityoneconsulting
```

## Step 2 — Day 4

**Subject A:** the wall at 50 FTE
**Subject B:** {{Company}} past the founder yet?

**Body:**
```
{{First Name}} — quick one.

Across the ERP VARs we work with, three operational ceilings show up like clockwork.

~25 FTE — the founder is still on every deal review.

~50 FTE — services margin starts compressing while revenue grows.

~100 FTE — nobody can remember what the customer was promised at sale.

Which one is {{Company}} closest to? Reply with the number. That's the whole ask.

— KP
```

## Step 3 — Day 8

**Subject A:** your services margin is leaking 18%
**Subject B:** the implementation tail problem

**Body:**
```
{{First Name}},

Across the ERP VAR audits we've run, the median margin loss to utilization gaps and post-SOW scope creep is around 18%.

The fix isn't another PSA tool. It's an operating model that ties the sale, the SOW, and the delivery plan together.

We're running free Calibrate Audits for services-SMBs through June 30. Same diagnostic we run with paying clients. 14-day turnaround. Written report. 90-day plan. No pitch attached.

https://calibrate.trinityoneconsulting.com/audit

If the timing's off, say the word and I'll send the audit framework as a PDF instead.

— KP
```

## Step 4 — Day 13

**Subject A:** compare notes?
**Subject B:** {{First Name}} — quick one

**Body:**
```
{{First Name}},

I won't keep cluttering your inbox.

If a 15-minute "compare notes" call is useful, here's my calendar:

https://calendly.com/kevin-trinityoneconsulting/30-minute-trinity-one-call-with-kevin-patrick

No slides. No pitch. I'll walk you through our internal operating dashboard — the one we built for ourselves before we productized it as Meridian — if you walk me through yours.

Not ready for a call? Follow Trinity One on LinkedIn instead.

https://www.linkedin.com/company/trinityoneconsulting

— KP
```

## Step 5 — Day 19

**Subject A:** closing the loop on {{Company}}
**Subject B:** last note

**Body:**
```
{{First Name}},

Last note from me on this thread. I'll close the file on my end.

If you ever want to look at the software side without a call, two options.

Meridian — the PM tool we built for services-SMBs. The kind of project visibility most PSA tools fake.
https://meridian.trinityoneconsulting.com

Keystone — services-aware CRM with deal-to-delivery handoff baked in.
https://keystone.trinityoneconsulting.com

Both are running in production for us and a handful of early clients. The early-access tier is priced for that — real discount, no enterprise contract.

Wishing {{Company}} a strong quarter.

— KP
```

---

# Trinity One — ERP VAR Warm

Sender pool: warm-pool. Schedule: Trinity ERP VAR (Mon–Thu). Auto-triggered when the reply classifier tags a reply as `interested` OR a prospect opens 2+ cold emails.

## Warm Step 1 — Day 1

**Subject A:** re: {{Company}} — quick yes
**Subject B:** glad you replied, {{First Name}}

**Body:**
```
{{First Name}},

Thanks for the reply.

Two options — pick whichever is easier.

1. A 15-minute call. I'll ask three questions. You'll know fast if there's a fit.
   https://calendly.com/kevin-trinityoneconsulting/30-minute-trinity-one-call-with-kevin-patrick

2. The free Calibrate Audit. Async. 14-day turnaround. Written report and 90-day plan. No call required.
   https://calibrate.trinityoneconsulting.com/audit

Either works. I'm partial to the audit because you get a real deliverable in your hands either way.

— KP
```

## Warm Step 2 — Day 5

**Subject A:** quick context on what we'd actually do
**Subject B:** how this usually plays out for {{ERP Platform}} VARs

**Body:**
```
{{First Name}},

In case it helps you decide — here's what a typical {{ERP Platform}} VAR engagement looks like for us.

1. Calibrate Audit (free). Two weeks. Written diagnostic plus 90-day plan.

2. Targeted fix sprint. Usually one of three.
   • Forge — fix the GTM motion.
   • Calibrate Fractional COO — fix the services-delivery operating model.
   • Keystone + Meridian — re-platform the CRM and PM stack.

3. Ongoing cadence. Monthly leadership notes. Quarterly strategy reviews.

Most VARs we work with start with the audit and decide from there. No pressure either way.

https://calendly.com/kevin-trinityoneconsulting/30-minute-trinity-one-call-with-kevin-patrick

or

https://calibrate.trinityoneconsulting.com/audit

— KP
```

## Warm Step 3 — Day 11

**Subject A:** loop-close on {{Company}}
**Subject B:** still around?

**Body:**
```
{{First Name}},

Closing the loop.

If the timing isn't right, no worries. I'll check back in 90 days.

If it is, three ways in — ranked by commitment.

4-minute self-score, no email required.
https://trinityoneconsulting.com/var-scorecard

Async written audit.
https://calibrate.trinityoneconsulting.com/audit

15-minute call.
https://calendly.com/kevin-trinityoneconsulting/30-minute-trinity-one-call-with-kevin-patrick

— KP
```

---

# Authoring notes (for Playwright + manual edits)

- Plain text. No HTML formatting beyond what Saleshandy adds for links.
- Do NOT use spintax `{a|b|c}` — Saleshandy will send the literal braces. Subject A/B is configured via the native variant feature, not spintax.
- The em-dash before "— KP" is intentional. Keep it.
- Short paragraphs. Blank line between thoughts.
- No unsubscribe footer — Saleshandy injects one automatically.
