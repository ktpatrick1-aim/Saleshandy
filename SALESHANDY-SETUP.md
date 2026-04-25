# SalesHandy Setup Guide — Dream Compass

## ⚠️ Zoho Routing Policy (2026-04-24)

**Only Calendly-booked prospects belong in Zoho.** All other Saleshandy activity (opens, clicks, replies without a booking, bounces, unsubscribes) is treated as noise and must NOT flow into Zoho.

This reverses the prior approach where Saleshandy's native Zoho integration auto-created Leads on every prospect added to a sequence.

### Cutover steps (one-time)

1. **Disconnect Saleshandy native Zoho** — Saleshandy UI → Settings → Integrations → Zoho → Disconnect. Without this step Saleshandy will keep dumping noise Leads into Zoho.
2. **Add new env vars in Netlify:**
   - `CALENDLY_API_TOKEN` — Calendly personal access token (calendly.com/integrations/api_webhooks → Personal Access Tokens)
   - `CALENDLY_WEBHOOK_SIGNING_KEY` — leave unset for now; populated by step 4
3. **Backfill cleanup** of noise Leads already in Zoho:
   ```
   # Dry run — review the hit list
   curl 'https://saleshandy-outbound.netlify.app/.netlify/functions/cleanup-zoho-noncalendly?days=14'

   # Archive (tags `noise-no-calendly-booking`, sets Lead_Status="Junk Lead")
   curl -X POST 'https://saleshandy-outbound.netlify.app/.netlify/functions/cleanup-zoho-noncalendly?days=14&dryRun=false&confirm=yes'
   ```
4. **Register the Calendly→Zoho webhook subscription:**
   ```
   curl 'https://saleshandy-outbound.netlify.app/.netlify/functions/calendly-register-webhook?confirm=yes'
   ```
   Copy the returned `signing_key` into Netlify env as `CALENDLY_WEBHOOK_SIGNING_KEY` and trigger a redeploy.
5. **Test:** book a Calendly slot with a fresh email, confirm a Zoho Lead appears with `Lead_Source=Calendly`, tag `calendly-booked`, `Lead_Status=Qualified`. Check `crm_sync_log` in Supabase for the audit row.

### Go-forward architecture

```
Saleshandy sequences  →  Supabase engagement log only (no Zoho writes)
Calendly invitee.created/canceled  →  calendly-webhook-zoho.js  →  Zoho Lead (upsert)
```

The custom Saleshandy webhook (`saleshandy-webhook.js`) still runs but its Zoho write paths are now no-ops in spirit — Lead creation comes from Calendly only. Engagement scoring/sequence branching remain in Supabase.

---

## Overview (legacy — pre-Calendly cutover)

SalesHandy handles outbound email sequences for lead nurturing. Pre-cutover this integrated with:
- **Zoho CRM (native)** — SalesHandy's built-in Zoho integration handles lead/contact creation, activity logging, bounce/unsub tagging, and duplicate checking — **DISABLED per policy above**
- **Zoho CRM (custom webhook)** — our `saleshandy-webhook.js` supplements native by adding engagement scoring, lifecycle stage promotion (MQL/SQL), outcome mapping, and **automatic sequence branching**
- **Supabase** — engagement analytics logged to `sh_engagement_log`
- **SalesHandy API** — import prospects into sequences and manage tags programmatically

### Native vs Custom Integration (legacy — native is now disconnected)

| Capability | Native SalesHandy-Zoho (DISABLED) | Custom Webhook |
|------------|----------------------|----------------|
| Create Leads/Contacts in Zoho | ~~Yes~~ → now Calendly only | No (defers to Calendly webhook) |
| Log email activity as Zoho notes | ~~Yes~~ → noise; not replaced | No |
| Tag bounced/unsubscribed contacts | ~~Yes~~ → noise; not replaced | No |
| Duplicate checking | ~~Yes~~ → handled by `Leads/upsert` in Calendly webhook | No |
| Custom field mapping | ~~Yes (basic)~~ | No |
| Engagement scoring (0-100) | No | **Yes** |
| Lifecycle stage promotion (MQL/SQL) | No | **Yes** |
| Outcome → stage mapping | No | **Yes** |
| Sequence branching (auto-move) | No | **Yes** |
| Supabase analytics logging | No | **Yes** |
| Reply snippet storage | No | **Yes** |
| CRM sync audit trail | No | **Yes** |

---

## 1. Enable Native Zoho Integration (Do This First)

1. In SalesHandy: **Settings > Integrations > Zoho CRM > Connect Now**
2. Authorize with your Zoho account
3. Configure field mapping:
   - Map `First Name`, `Last Name`, `Email` (auto-mapped)
   - Add custom mappings for `Company`, `Job Title`, `Phone`, `Website`
4. Configure triggers:
   - **Create Lead** on: Email Sent (so every prospect gets a Zoho record)
   - **Update Lead** on: Reply Received, Prospect Outcome Updated
5. Enable engagement tracking (opens, clicks, replies sync as Zoho notes)
6. Bounced/unsubscribed contacts auto-tagged with `Unsubscribed-Saleshandy`

This gives you baseline CRM sync. Our custom webhook adds scoring and lifecycle management on top.

---

## 2. Email Branding & Signature

### Logo

Use the Trinity One Consulting logo in SalesHandy email templates.

**Logo file:** `dreamcompass-v2/netlify/trinity-one/images/logo.png` (1500x1250, PNG)

In SalesHandy: **Settings > Email Settings > Signature** — upload the logo and set width to 100px.

If SalesHandy supports HTML signatures, use the base64-encoded version from `send-ceo-letter.js` for guaranteed rendering without broken image links.

### Signature Image

The handwritten "Kevin Patrick" signature image should be hosted publicly (e.g., on Netlify or your CDN) and referenced in the HTML signature below as `[SIGNATURE_URL]`. The original image is 7680x1654 — render at 180px wide in email for crisp display on retina screens.

**Tip:** If SalesHandy doesn't support hosted image URLs reliably, convert the signature PNG to base64 and embed it inline (same approach used for the logo in `send-ceo-letter.js`).

### Email Signature (paste into SalesHandy)

Use this signature across all sequences. In SalesHandy: **Settings > Email Settings > Signature**, or set per-sequence under each step's editor.

```html
<table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top:24px; border-top:2px solid #f0f0f6; padding-top:16px;">
  <tr>
    <td width="100" valign="top" style="padding-right:16px; padding-top:2px;">
      <!-- Replace [LOGO_URL] with hosted logo URL or use base64 from send-ceo-letter.js -->
      <img src="[LOGO_URL]" style="width:100px;height:auto;display:block;" alt="Trinity One Consulting"/>
    </td>
    <td valign="top">
      <table border="0" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-bottom:6px;">
            <!-- Replace [SIGNATURE_URL] with hosted signature image URL -->
            <img src="[SIGNATURE_URL]" style="width:180px;height:auto;display:block;" alt="Kevin Patrick"/>
          </td>
        </tr>
        <tr>
          <td style="font-family:Arial, Helvetica, sans-serif; font-size:11px; font-weight:bold; color:#6b21a8; letter-spacing:1px; text-transform:uppercase; padding-bottom:2px;">
            Certified Dream Manager
          </td>
        </tr>
        <tr>
          <td style="font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#555555; padding-bottom:2px;">
            Director of Professional Services
          </td>
        </tr>
        <tr>
          <td style="font-family:Arial, Helvetica, sans-serif; font-size:12px; font-weight:bold; color:#059669; letter-spacing:0.5px;">
            Trinity One Consulting
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td colspan="2" style="padding-top:12px;">
      <table border="0" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#888888; padding-bottom:4px;">
            &#9993;&nbsp;&nbsp;<a href="mailto:kevin@trinityoneconsulting.com" style="color:#3d3d8f; text-decoration:none;">kevin@trinityoneconsulting.com</a>
          </td>
        </tr>
        <tr>
          <td style="font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#888888;">
            &#127760;&nbsp;&nbsp;<a href="https://rhythmoflife.thedreamdividend.com" style="color:#059669; text-decoration:none;">rhythmoflife.thedreamdividend.com</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

### From Name / Reply-To

| Field | Value |
|-------|-------|
| From Name | `Kevin Patrick | Trinity One Consulting` |
| From Email | *(varies by sender pool — see Section 2.5)* |
| Reply-To | *(same as From Email for each sender)* |

---

## 2.5 Multi-Sender Configuration

### Sender Pool Overview

12 sender accounts across 4 groups. SalesHandy handles sender rotation within each sequence — our code tracks capacity, warmup, and health.

#### Group A: Cold Outbound (5 SalesHandy-generated domains — isolated reputation)

| ID | Email | Sequences | Max Daily |
|----|-------|-----------|-----------|
| cold-1 | `kevin.patrick@trytrinityoneconsulting.com` | Seq 1 (Cold), Seq 4 (Re-Engage) | 50 |
| cold-2 | `kevin.patrick@gettrinityoneconsulting.com` | Seq 1, Seq 4 | 50 |
| cold-3 | `kevin.patrick@gotrinityoneconsulting.com` | Seq 1, Seq 4 | 50 |
| cold-4 | `kevin.patrick@jointrinityoneconsulting.com` | Seq 1, Seq 4 | 50 |
| cold-5 | `kevin.patrick@reachtrinityoneconsulting.com` | Seq 1, Seq 4 | 50 |

**Why separate domains:** Each domain has isolated reputation. If one gets flagged, the others are unaffected. Ideal for first-touch cold outreach.

#### Group B: Warm/Nurture (5 Namecheap aliases on trinityoneconsulting.io)

| ID | Email | Sequence Assignment | Max Daily |
|----|-------|---------------------|-----------|
| warm-1 | `admin@trinityoneconsulting.io` | Seq 3: Trial Activation | 30 |
| warm-2 | `crm@trinityoneconsulting.io` | Seq 2: Warm Nurture | 30 |
| warm-3 | `info@trinityoneconsulting.io` | (backup/overflow) | 30 |
| warm-4 | `marketing@trinityoneconsulting.io` | Seq 4: Re-engagement (backup) | 30 |
| warm-5 | `sales@trinityoneconsulting.io` | Seq 5: Post-Demo | 30 |

**Why lower limits:** All 5 share one domain's reputation (trinityoneconsulting.io). Conservative caps protect the domain.

#### Group C: Content/Podcast Nurture (Dream Dividend brand)

| ID | Email | Sequence Assignment | Max Daily |
|----|-------|---------------------|-----------|
| content-1 | `kpatrick@thedreamdividend.com` | Seq 6: Inbound/Referral Nurture | 30 |

**Why separate:** Inbound leads from the Dream Dividend podcast or content expect to hear from that brand. Keeps the content funnel on its own domain reputation.

#### Group D: Protected (never used for bulk)

| Email | Role |
|-------|------|
| `kevin@trinityoneconsulting.com` | Personal replies, 1:1 follow-up only |

### Full Capacity at Warmup Completion

| Group | Senders | Per-Sender | Total/Day |
|-------|---------|------------|-----------|
| Cold Pool | 5 | 50 | 250 |
| Warm Pool | 5 | 30 | 150 |
| Content Pool | 1 | 30 | 30 |
| **Total** | **11** | | **430/day** |

### SalesHandy UI Setup

For each sequence, add the appropriate senders:

1. Go to **Sequences > [Sequence Name] > Settings > Sender Accounts**
2. Add all senders from the assigned group
3. Enable **Sender Rotation** (SalesHandy round-robins automatically)
4. Set the **From Name** to match the `display_name` for that group

| Sequence | Add These Senders |
|----------|-------------------|
| Seq 1: Cold Outbound | All 5 cold-pool senders |
| Seq 2: Warm Nurture | `crm@trinityoneconsulting.io` |
| Seq 3: Trial Activation | `admin@trinityoneconsulting.io` |
| Seq 4: Re-Engagement | All 5 cold-pool senders + `marketing@trinityoneconsulting.io` |
| Seq 5: Post-Demo | `sales@trinityoneconsulting.io` |
| Seq 6: Inbound/Referral | `kpatrick@thedreamdividend.com` |

### Warmup Schedule

New accounts start with low daily limits that ramp over 21 days:

**Cold pool** (separate domains):
- Days 1-3: 5/day | Days 4-7: 10 | Days 8-10: 15 | Days 11-14: 25 | Days 15-17: 35 | Days 18-21: 50

**Warm pool** (shared .io domain):
- Days 1-3: 3/day | Days 4-7: 5 | Days 8-10: 10 | Days 11-14: 15 | Days 15-17: 20 | Days 18-21: 30

**Content pool:**
- Days 1-3: 5/day | Days 4-7: 10 | Days 8-10: 15 | Days 11-14: 20 | Days 15-17: 25 | Days 18-21: 30

Warmup advances automatically on each API call. Check progress via `sender-status` action.

### Health Monitoring

- **Auto-pause:** Senders with >5% bounce rate (after 20+ sends) are automatically paused
- **Alerts:** All auto-pause events and warmup completions logged to `sh_sender_alerts` table
- **Dashboard:** Use `sender-status` action to view all senders, capacity, and alerts
- **Resume:** Use `sender-manage` action with `operation: "resume"` to reactivate paused senders

---

## 3. Environment Variables

Add these to Netlify (Site Settings > Environment Variables):

```
SALESHANDY_API_KEY=          # Settings > API Key > Create API Key
SALESHANDY_WEBHOOK_TOKEN=    # Custom token for webhook auth (you create this)

# Sequence Step IDs (populate after creating sequences in UI)
SH_SEQ_NURTURE_COLD_STEP1=
SH_SEQ_NURTURE_COLD_STEP2=
SH_SEQ_NURTURE_COLD_STEP3=
SH_SEQ_NURTURE_COLD_STEP4=
SH_SEQ_NURTURE_COLD_STEP5=

SH_SEQ_NURTURE_WARM_STEP1=
SH_SEQ_NURTURE_WARM_STEP2=
SH_SEQ_NURTURE_WARM_STEP3=

SH_SEQ_TRIAL_STEP1=
SH_SEQ_TRIAL_STEP2=
SH_SEQ_TRIAL_STEP3=

SH_SEQ_REENGAGE_STEP1=
SH_SEQ_REENGAGE_STEP2=
SH_SEQ_REENGAGE_STEP3=

SH_SEQ_POSTDEMO_STEP1=
SH_SEQ_POSTDEMO_STEP2=
SH_SEQ_POSTDEMO_STEP3=

SH_SEQ_INBOUND_STEP1=
SH_SEQ_INBOUND_STEP2=
SH_SEQ_INBOUND_STEP3=
SH_SEQ_INBOUND_STEP4=

# Prospect Field IDs (Settings > Prospect Fields > System Fields)
SH_FIELD_FIRST_NAME=
SH_FIELD_LAST_NAME=
SH_FIELD_EMAIL=
SH_FIELD_PHONE=
SH_FIELD_COMPANY=
SH_FIELD_JOB_TITLE=
SH_FIELD_WEBSITE=
SH_FIELD_CITY=
SH_FIELD_STATE=
SH_FIELD_COUNTRY=
SH_FIELD_LINKEDIN=
SH_FIELD_LEAD_SCORE=       # Custom field
SH_FIELD_COMPANY_SIZE=     # Custom field
SH_FIELD_SENIORITY=        # Custom field
SH_FIELD_ZOHO_ID=          # Custom field
SH_FIELD_COMPANY_CONTEXT=  # Custom field for Claude company context
SH_FIELD_PAIN_POINTS=      # Custom field for Claude pain points
SH_FIELD_ROUTED_PROPERTY=  # Custom field for recommended Trinity property
SH_FIELD_PERSONALIZED_SEQUENCE= # Custom field for combined personalized steps

# Sender Pool Thresholds
SH_SENDER_BOUNCE_THRESHOLD=0.05       # 5% bounce rate triggers auto-pause
SH_SENDER_MAX_DAILY_COLD=50           # Max daily sends per cold sender (post-warmup)
SH_SENDER_MAX_DAILY_WARM=30           # Max daily sends per warm sender (shared domain)
SH_SENDER_WARMUP_DAYS=21              # Days to full warmup
SH_SENDER_PROTECTED_EMAIL=kevin@trinityoneconsulting.com
```

---

## 4. Sequences to Create in SalesHandy UI

Create these 6 sequences in SalesHandy (Sequences > Create Sequence).

**Branding:** Apply the email signature from Section 2 to every step. Include the Trinity One logo at the top of Step 1 in each sequence (first impression matters). Subsequent steps use signature-only.

---

### Sequence 1: DC Lead Nurture – Cold Outbound

**Purpose:** First-touch outreach for new or manually sourced leads.
**Entry criteria:** New leads with score < 40, no prior engagement.
**Sender Group:** cold-pool (5 SalesHandy domains, rotation enabled)
**From Name:** Kevin Patrick | Trinity One Consulting

| Step | Day | Type | Subject | Body Direction |
|------|-----|------|---------|----------------|
| 1 | Day 0 | Email | What does your best employee dream about? | Open with the question — not their KPIs, their actual dreams. One sentence connecting that to what we do: "I work with companies like {{company}} to find out — and what happens next changes everything about retention, engagement, and culture." End with a genuine question about their current approach to employee engagement. No pitch. No product name yet. Just the question and the connection. Sign: "— Kevin" |
| 2 | Day 3 | Email | The #1 reason your best people leave (it's not comp) | Lead with a data point specific to their industry or company size: "Companies in {{industry}} with {{company_size_band}} employees lose an average of $X per departure." Then the reframe: "The #1 reason isn't compensation. It's not flexibility. It's the feeling that this company sees me as a function, not a human being." Close with: "I wrote something about this that might shift how you think about your people. No pitch — just perspective." Link to the retention blog post. |
| 3 | Day 7 | Email | What happened when a company your size actually asked | Make the ROI personal: "If {{company}} has the same turnover patterns I see in {{industry}}, you're looking at roughly $X/year in replacement costs alone." Then the story: "Here's what happened when a company your size actually asked their people what they were working toward — not their KPIs, their real dreams." Link to the 12 Rooms guide or ROI calculator. Let the content do the selling. |
| 4 | Day 14 | Email | 15 minutes — not a pitch | This is the conversion ask, but in your voice: "I'm not going to pitch you. I want to spend 15 minutes understanding what your people challenges actually look like — and if Dream Compass isn't the right fit, I'll tell you that." Include calendar link. Reference their seniority level: for C-suite, frame as strategic; for directors/managers, frame as operational. "Either way, you'll walk away with at least one idea you can use Monday morning." |
| 5 | Day 21 | Email | No pressure — just one last thing | Human, generous, zero guilt: "I've reached out a few times and I respect that timing matters. If this isn't the right season, no pressure at all. But I'll leave you with this —" Link to a specific blog post or the Dream Dividend podcast. "Whether we ever connect or not, I think it'll shift how you think about your people. Rooting for you and your team either way." Sign: "— Kevin" |

**A/B variants for Steps 1 and 4:**
- Step 1 subject A: "What does your best employee dream about?"
- Step 1 subject B: "The question I ask every leader I work with"
- Step 4 subject A: "15 minutes — not a pitch"
- Step 4 subject B: "Quick question about {{company}}'s people strategy"

---

### Sequence 2: DC Lead Nurture – Warm (Engaged)

**Purpose:** Follow-up for leads who opened/clicked but haven't replied.
**Entry criteria:** Auto-branched from Sequence 1 when opens >= 2 or link clicks >= 1.
**Sender:** crm@trinityoneconsulting.io (warm-pool)

| Step | Day | Type | Subject | Body Direction |
|------|-----|------|---------|----------------|
| 1 | Day 0 | Email | The data behind why your best people leave | Reference what they engaged with — not the click itself. "You looked at something I shared about [topic]. That tells me you're thinking about this." Go deeper on that specific topic with a resource they haven't seen yet: a different blog post, a podcast episode, or the 12 Rooms framework. "Here's the deeper dive — the part most companies miss." |
| 2 | Day 4 | Email | One question | Short. Conversational. No more than 4 sentences. "I've been thinking about companies like {{company}} — specifically the gap between what leadership thinks employees want and what employees actually dream about. What's the biggest people challenge you're navigating right now?" That's it. Low-friction reply ask. The goal is a conversation, not a conversion. |
| 3 | Day 8 | Email | "We didn't expect this" — what one company discovered | Testimonial framed as a story, not a quote box. "A company about your size told me something six months into the Dream Manager program that I didn't expect..." Share the outcome with specifics (turnover reduction, engagement scores, ROI). Direct calendar link: "If you want to see whether something like this could work at {{company}}, here's 15 minutes on my calendar. No slides, just conversation." |

---

### Sequence 3: DC Trial Activation

**Purpose:** Nurture trial signups who haven't activated or completed Session 1.
**Entry criteria:** Trial users with no session completion after 48 hours.
**Sender:** admin@trinityoneconsulting.io (warm-pool)

| Step | Day | Type | Subject | Body Direction |
|------|-----|------|---------|----------------|
| 1 | Day 2 | Email | You signed up because something matters to you | Lead with meaning, not mechanics: "You signed up because something matters to you — about your team, your culture, or how your people experience work. Let's make sure that doesn't stay on the shelf." Then the practical: "Your first session takes about 5 minutes. It starts with one question that most companies never think to ask their people." Direct link to Session 1. Keep it warm — this is someone who already raised their hand. |
| 2 | Day 5 | Email | What Dream Managers are discovering this week | Share real (anonymized) engagement data: "Here's what companies like yours discovered in their first week — the patterns that show up when you actually ask people what they're working toward." 2-3 specific data points or anonymized insights. "Your dashboard is waiting. The first session is where it clicks." |
| 3 | Day 9 | Email | Want me to walk you through it? | Personal, not automated-feeling: "I know getting started with something new can feel like one more thing on the list. So here's my offer — I'll walk you through setup in 10 minutes flat. Not a sales call. Just making sure you get the value you signed up for." Calendar link for 10-min onboarding call. "And if you've already dug in and have questions, I'm here for that too." |

---

### Sequence 4: DC Re-Engagement (Stale Leads)

**Purpose:** Wake up leads that went cold (no activity 30+ days).
**Entry criteria:** Auto-branched when sequence finishes with no reply.
**Sender Group:** cold-pool (5 SalesHandy domains, rotation enabled) + marketing@trinityoneconsulting.io

| Step | Day | Type | Subject | Body Direction |
|------|-----|------|---------|----------------|
| 1 | Day 0 | Email | Something I published that made me think of {{company}} | Specific, not vague. Lead with a concrete new piece of content — a blog post, a podcast episode, a data point that didn't exist when they went quiet. "Since we last connected, I published something that made me think of your situation at {{company}}." Share the link with a 1-sentence hook about why it's relevant to them specifically. Fresh angle, fresh value. |
| 2 | Day 5 | Email | The trend I'm seeing in {{industry}} | Industry-specific data point or trend: "Something is shifting in {{industry}} right now — the companies that are winning on retention aren't doing it with perks. They're doing something most HR leaders wouldn't expect." Position Dream Compass as the mechanism, not the product. "This is what the Dream Manager methodology was built for. Happy to share what I'm seeing if it's useful." |
| 3 | Day 10 | Email | Cleaning up my list — should I keep you on it? | Short. Human. Creates natural reply urgency: "I'm cleaning up my outreach list and I want to be respectful of your inbox. Should I keep you on it, or is this not the right time? Either answer is completely fine — I'd just rather hear it from you than guess." 3 sentences max. This consistently gets the highest reply rates. |

---

### Sequence 5: DC Post-Demo Follow-Up

**Purpose:** Convert demo attendees who haven't started a trial or purchased.
**Entry criteria:** Auto-branched when outcome = "Meeting Completed" and no conversion within 48 hours.
**Sender:** sales@trinityoneconsulting.io (warm-pool)

**Note:** Steps should pull from Claude-enriched fields: `SH_Pain_Points` for personalized pain references, `SH_Company_Context` for company-specific framing, and `SH_Personalized_Sequence` for AI-drafted body content when available.

| Step | Day | Type | Subject | Body Direction |
|------|-----|------|---------|----------------|
| 1 | Day 1 | Email | Following up on our conversation | Personalized recap — not a form letter. Reference 1-2 specific things discussed in the demo. "What stood out to me was [specific challenge they mentioned]. That's exactly the kind of thing the Dream Manager methodology was built to address." Recap the 2-3 value props most relevant to their situation. Link to start trial. "The best way to see if this is real is to experience it. Here's your trial link." |
| 2 | Day 4 | Email | What Dream Compass could mean for {{company}} | Custom ROI based on their company size and the deal metrics we calculated: "Based on what you shared about {{company}} — {{employee_count}} employees, the challenges in {{industry}} — here's what the math looks like." Estimated cost of turnover at their scale. Estimated ROI of Dream Compass. "These aren't hypothetical numbers. They're based on what companies your size actually experience." |
| 3 | Day 8 | Email | Whatever you need to move forward | Decision support, not pressure: "I know decisions like this don't happen in a vacuum. If you need a one-pager for your leadership team, I have it. If you need to loop in someone from HR or finance, I'm happy to jump on a quick call with them. If you need procurement info, it's attached." Remove every friction point. "What would be most helpful for you right now?" |

---

### Sequence 6: DC Inbound / Referral Nurture (NEW)

**Purpose:** Nurture leads who came in through referrals, podcast listeners, content downloads, or direct inbound interest. These people are warmer than cold but haven't been through your email sequences yet.
**Entry criteria:** Leads with `source=inbound` or `source=referral` or `referredBy` field populated. Also used for podcast listeners and content hub visitors who submitted their email.
**Sender:** kpatrick@thedreamdividend.com (content-pool)

| Step | Day | Type | Subject | Body Direction |
|------|-----|------|---------|----------------|
| 1 | Day 0 | Email | Glad you found us — here's the backstory | Warm, personal, acknowledges how they arrived: "Whether someone pointed you our way or you stumbled onto something I wrote — I'm glad you're here." Brief backstory on why Dream Compass exists: "I've spent 20+ years in enterprise systems, and the most important thing I've learned is that the technology is never the hard part. People are. Dream Compass exists because I believe every company should know what their people are actually working toward." If referred, mention the referrer by name: "{{referredBy}} thought we should connect — and I trust their judgment." Link to the 12 Rooms guide or a cornerstone blog post. |
| 2 | Day 3 | Email | The question that changes everything | Share the core methodology hook: "I ask every leader I work with the same question: What does your best employee dream about? Not their KPIs. Their actual dreams." Go deeper than the cold sequence — these people have context. Share a specific story or case study about what happens when companies actually ask. "The answers change everything about how you think about retention, engagement, and culture." |
| 3 | Day 7 | Email | What I'd want to know if I were you | Anticipate their questions: "If I were evaluating something like Dream Compass, here's what I'd want to know: Does it actually work? How long before we see results? What does it cost?" Answer each directly and honestly. Link to ROI calculator. "I'd rather you have the real answers upfront than wonder. And if you have questions I didn't cover — just hit reply." |
| 4 | Day 12 | Email | Let's talk — whenever you're ready | Low-pressure, high-availability: "You've seen what we do. You know the methodology. The only thing left is whether it fits your situation. I'm here whenever that conversation makes sense — no timeline, no pressure." Calendar link. "And if you just want to keep reading and learning for now, that's great too. Here's the latest from The Dream Dividend." Link to most recent podcast episode or blog. |

---

## 5. Sequence Branching (Automated)

The webhook (`saleshandy-webhook.js`) automatically moves prospects between sequences based on engagement signals. No manual intervention required.

| Trigger | Source Sequence | Target Sequence | How It Works |
|---------|----------------|-----------------|--------------|
| Opens >= 2 | Cold Outbound | Warm (Engaged) | Webhook detects 2+ opens from a cold sequence, imports prospect into Warm step 1, tags `warm-engaged` |
| Sequence finished, no reply | Any | Re-Engagement | When a prospect completes all steps with zero replies, auto-added to Re-Engagement step 1, tagged `stale-30d` |
| Outcome = "Meeting Completed" | Any | Post-Demo | Outcome update triggers import to Post-Demo step 1, tagged `demo-completed` |
| Inbound/referral lead | (API import) | Inbound/Referral | When `source=inbound`, `source=referral`, or `referredBy` is set in the build API call, prospect routes to Sequence 6 |

**Guard rails:**
- Each branch checks for existing tags to prevent duplicate imports (e.g., won't re-add to warm if already tagged `warm-engaged`)
- All branch events logged to `crm_sync_log` with `entity_type=sequence_branch`
- If SalesHandy API key is not configured, branching is skipped gracefully (webhook still processes the event)

---

## 6. Prospect Tags (Groups)

Create these tags in SalesHandy for segmentation:

| Tag | Purpose |
|-----|---------|
| `enriched-import` | Leads imported via API or enrichment tools |
| `cold-outbound` | First-touch cold prospects |
| `warm-engaged` | Opened/clicked, auto-moved to warm sequence |
| `trial-user` | Signed up for trial |
| `demo-completed` | Had a demo call |
| `mql` | Marketing Qualified (score >= 40) |
| `sql` | Sales Qualified (demo booked or completed) |
| `stale-30d` | No activity in 30+ days, auto-moved to re-engagement |
| `inbound-referral` | Came in via referral, podcast, or content download |
| `hr-leader` | HR/People/Culture title |
| `c-suite` | C-level decision maker |
| `mid-market` | 201-1000 employees |
| `enterprise` | 1001+ employees |
| `smb` | 1-200 employees |
| `do-not-email` | Bounced or unsubscribed |

---

## 7. Webhook Configuration

In SalesHandy: Settings > Integrations > Webhooks

**Create webhooks for all events:**

| Event | Webhook URL | Custom Header |
|-------|-------------|---------------|
| Email Sent | `https://YOUR_SITE.netlify.app/.netlify/functions/saleshandy-webhook` | `x-webhook-token: YOUR_TOKEN` |
| Email Opened | Same URL | Same header |
| Email Link Clicked | Same URL | Same header |
| Email Bounced | Same URL | Same header |
| Reply Received | Same URL | Same header |
| Prospect Unsubscribed | Same URL | Same header |
| Prospect Finished | Same URL | Same header |
| Prospect Outcome Updated | Same URL | Same header |

Set the `x-webhook-token` value to match your `SALESHANDY_WEBHOOK_TOKEN` env var.

---

## 8. Zoho CRM Custom Fields

Add these custom fields to the **Leads** module in Zoho CRM:

| Field API Name | Type | Purpose |
|----------------|------|---------|
| `SH_Last_Event` | Single Line | Last SalesHandy event type |
| `SH_Last_Event_Date` | Date | Date of last event |
| `SH_Last_Sequence` | Single Line | Name of last active sequence |
| `SH_Last_Step` | Integer | Step number in sequence |
| `SH_Sender_Email` | Email | Which sender email was used |
| `SH_Engagement_Score` | Integer | Calculated engagement score (0-100) |
| `SH_Engagement_Stage` | Picklist | Engaged / Replied / Bounced / Unsubscribed |
| `SH_Emails_Sent` | Integer | Count of emails sent |
| `SH_Emails_Opened` | Integer | Count of opens |
| `SH_Links_Clicked` | Integer | Count of link clicks |
| `SH_Replies` | Integer | Count of replies |
| `SH_Bounced` | Checkbox | Email bounced |
| `SH_Unsubscribed` | Checkbox | Prospect unsubscribed |
| `SH_Sequence_Finished` | Checkbox | Completed all sequence steps |
| `SH_Do_Not_Email` | Checkbox | Bounced or unsubscribed |
| `SH_Outcome` | Single Line | Latest SalesHandy outcome |
| `SH_Previous_Outcome` | Single Line | Previous outcome |
| `SH_Last_Reply_Snippet` | Multi Line | Snippet of last reply (2000 char max) |
| `SH_Reply_Date` | Date | Date of last reply |
| `SH_Reply_Category` | Single Line | Classified reply outcome (interested/objection/not now/unsubscribe) |
| `SH_Reply_Confidence` | Number | Classification confidence score (0-100) |
| `SH_Reply_Response_Draft` | Multi Line | Suggested response draft from AI |
| `SH_Bounce_Reason` | Single Line | Bounce reason |
| `SH_Tags` | Multi Line | Comma-separated SalesHandy tags |

---

## 9. Supabase Table

Create the `sh_engagement_log` table:

```sql
CREATE TABLE sh_engagement_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  event_type TEXT NOT NULL,
  sequence_name TEXT,
  sequence_id TEXT,
  step_number INTEGER,
  variant TEXT,
  sender_email TEXT,
  subject TEXT,
  outcome TEXT,
  deal_value NUMERIC,
  open_count INTEGER,
  bounce_reason TEXT,
  reply_snippet TEXT,
  zoho_lead_id TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sh_engagement_email ON sh_engagement_log(email);
CREATE INDEX idx_sh_engagement_event ON sh_engagement_log(event_type);
CREATE INDEX idx_sh_engagement_sequence ON sh_engagement_log(sequence_name);
CREATE INDEX idx_sh_engagement_created ON sh_engagement_log(created_at);
```

---

## 10. API Usage Examples

### Import prospects into a sequence

```bash
curl -X POST https://YOUR_SITE.netlify.app/.netlify/functions/saleshandy-api \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "import",
    "sequenceKey": "lead-nurture-cold",
    "step": 1,
    "prospects": [
      {
        "email": "jane@acme.com",
        "firstName": "Jane",
        "lastName": "Smith",
        "company": "Acme Corp",
        "jobTitle": "VP of People",
        "leadScore": "65",
        "companySizeBand": "201-1000",
        "titleSeniority": "VP"
      }
    ]
  }'
```

### Import an inbound/referral lead

```bash
curl -X POST https://YOUR_SITE.netlify.app/.netlify/functions/saleshandy-api \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "build",
    "enrichWithClaude": true,
    "prospects": [
      {
        "email": "sarah@growthco.com",
        "firstName": "Sarah",
        "lastName": "Chen",
        "company": "GrowthCo",
        "jobTitle": "Director of People Operations",
        "employeeCount": 350,
        "industry": "Technology",
        "source": "referral",
        "referredBy": "Mike Johnson"
      }
    ]
  }'
```

### Tag prospects

```bash
curl -X POST https://YOUR_SITE.netlify.app/.netlify/functions/saleshandy-api \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "tag",
    "prospectEmails": ["jane@acme.com"],
    "tags": ["enriched-import", "mid-market", "hr-leader"]
  }'
```

### List configured sequences

```bash
curl -X POST https://YOUR_SITE.netlify.app/.netlify/functions/saleshandy-api \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"action": "sequences"}'
```

### Lint live sequence content (catches unrendered spintax)

Scans every active sequence in SalesHandy via the open API and reports step variants whose subject or body would ship broken. **Run before activating a new sequence, and on a schedule for active ones.**

```bash
curl -X POST https://YOUR_SITE.netlify.app/.netlify/functions/saleshandy-api \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"action": "lint-sequences"}'
```

Options:
- `"onlyActive": false` — also scan paused sequences (default: true).
- `"sequenceIds": ["<id1>", "<id2>"]` — scope to specific sequences.

Issue kinds returned:
- `spintax` — literal `{a|b}` in subject or body. The prospect sees the raw braces (this is what sent to brandon@theteamarchitects.com on 2026-04-21). Either re-enter the variation via SalesHandy's spintax button or flatten to a single phrasing.
- `placeholder` — unreplaced `[SIGNATURE_URL]`, `[CTA_URL]`, etc. — pasted from this doc but never filled in.
- `empty-subject` — email variant with no subject.
- `fetch-error` — couldn't read the sequence's steps (API/auth issue).

Response shape:

```json
{
  "action": "lint-sequences",
  "ok": false,
  "sequencesScanned": 7,
  "stepsScanned": 24,
  "variantsScanned": 31,
  "issueCount": 3,
  "findings": [
    {
      "sequenceId": "...",
      "sequenceName": "Implementer Charter Outreach",
      "stepId": "...",
      "stepOrder": 1,
      "variantId": "...",
      "channel": "email",
      "kind": "spintax",
      "field": "subject",
      "snippet": "{a question about how you coach|one question about how you coach}"
    }
  ]
}
```

---

## 11. Flow: SalesHandy → Zoho (with Branching)

```
New prospect imported into SalesHandy sequence
    ↓
Native Zoho integration creates/updates Lead in Zoho CRM
    ↓
If score >= 40 (MQL): tagged and tracked
    ↓
SalesHandy sends emails on schedule
    ↓
Engagement events fire webhooks → saleshandy-webhook.js
    ↓
Updates Zoho Lead engagement fields + logs to sh_engagement_log
    ↓
BRANCHING ENGINE:
  ├─ If opened >= 2x from cold → auto-add to "Warm" sequence
  ├─ If reply received → promote to MQL/SQL in Zoho + classify reply
  ├─ If sequence finished with no reply → auto-add to "Re-Engagement"
  ├─ If outcome = "Meeting Completed" → auto-add to "Post-Demo"
  └─ If bounced/unsubscribed → mark SH_Do_Not_Email, stop outreach

Inbound/referral leads (via API with source=referral):
    → Route directly to "Inbound/Referral Nurture" sequence
    → Tagged "inbound-referral" in SalesHandy
    → Lead Source = "Inbound Referral" in Zoho

SENDER POOL LAYER (runs alongside all of the above):
  ├─ Pre-flight: check sender capacity before import (429 if exhausted)
  ├─ On import: increment sender daily count (least-used sender in group)
  ├─ On webhook event: update sender health (bounce/reply/open counts)
  ├─ On bounce: recalculate bounce rate, auto-pause if >5%
  └─ Warmup: lazily advance daily limits over 21-day schedule
```

---

## 12. Sender Pool Management

### Supabase Tables

Run `supabase-migration-sender-pool.sql` to create:
- `sh_senders` — Sender configuration, warmup state, daily counts, health metrics
- `sh_sender_daily_log` — Historical daily send/bounce/open/reply per sender
- `sh_sender_alerts` — Auto-pause events, warmup completions, health warnings

### API: Check Sender Status

```bash
curl -X POST https://YOUR_SITE.netlify.app/.netlify/functions/saleshandy-api \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"action": "sender-status"}'
```

Returns all senders with current warmup day, daily limit, sends today, bounce rate, and overall capacity per group.

### API: Pause a Sender

```bash
curl -X POST https://YOUR_SITE.netlify.app/.netlify/functions/saleshandy-api \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "sender-manage",
    "senderEmail": "kevin.patrick@trytrinityoneconsulting.com",
    "operation": "pause",
    "reason": "Testing deliverability"
  }'
```

### API: Resume a Paused Sender

```bash
curl -X POST https://YOUR_SITE.netlify.app/.netlify/functions/saleshandy-api \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "sender-manage",
    "senderEmail": "kevin.patrick@trytrinityoneconsulting.com",
    "operation": "resume"
  }'
```

### API: Update Daily Limit

```bash
curl -X POST https://YOUR_SITE.netlify.app/.netlify/functions/saleshandy-api \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "sender-manage",
    "senderEmail": "admin@trinityoneconsulting.io",
    "operation": "update-limit",
    "daily_limit": 40,
    "max_daily_limit": 40
  }'
```
