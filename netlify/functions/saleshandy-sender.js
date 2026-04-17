// netlify/functions/saleshandy-sender.js
// Multi-sender pool management for SalesHandy outbound.
// Handles: sender rotation, warmup progression, daily limits, health monitoring.
// All functions accept a Supabase client — keeps saleshandy-shared.js pure.

const BOUNCE_THRESHOLD = parseFloat(process.env.SH_SENDER_BOUNCE_THRESHOLD || "0.05");
const MIN_SENDS_FOR_PAUSE = 20; // Don't auto-pause until sender has enough data

// ── Warmup Schedule ────────────────────────────────────────────
// Returns the daily send limit for a given warmup day and sender group.
// Cold pool (separate domains): ramp faster, higher ceiling.
// Warm pool (shared .io domain): ramp slower, lower ceiling.

function getWarmupDailyLimit(day, senderGroup) {
  const schedules = {
    "cold-pool": [
      [3, 5], [7, 10], [10, 15], [14, 25], [17, 35], [21, 50],
    ],
    "warm-pool": [
      [3, 3], [7, 5], [10, 10], [14, 15], [17, 20], [21, 30],
    ],
    "content-pool": [
      [3, 5], [7, 10], [10, 15], [14, 20], [17, 25], [21, 30],
    ],
  };
  const schedule = schedules[senderGroup] || schedules["cold-pool"];
  for (const [maxDay, limit] of schedule) {
    if (day <= maxDay) return limit;
  }
  return schedule[schedule.length - 1][1];
}

// ── Warmup Advancement ─────────────────────────────────────────
// Lazily advances warmup: called on each API interaction.
// If sender is in warmup, calculates current warmup day from start date
// and updates daily_limit accordingly. Graduates to 'active' at day 21+.

async function advanceWarmup(supabase, sender) {
  if (sender.status !== "warmup" || !sender.warmup_start_date) return sender;

  const startDate = new Date(sender.warmup_start_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);
  const warmupDay = Math.floor((today - startDate) / (1000 * 60 * 60 * 24)) + 1;

  const warmupDays = parseInt(process.env.SH_SENDER_WARMUP_DAYS || "21", 10);
  const newLimit = getWarmupDailyLimit(warmupDay, sender.sender_group);
  const graduated = warmupDay >= warmupDays;

  const updates = {
    warmup_day: warmupDay,
    daily_limit: graduated ? sender.max_daily_limit : newLimit,
    status: graduated ? "active" : "warmup",
    updated_at: new Date().toISOString(),
  };

  if (warmupDay !== sender.warmup_day || updates.status !== sender.status) {
    await supabase.from("sh_senders").update(updates).eq("id", sender.id);

    if (graduated && sender.status === "warmup") {
      await supabase.from("sh_sender_alerts").insert({
        sender_email: sender.email,
        alert_type: "warmup_complete",
        message: `${sender.email} graduated from warmup after ${warmupDay} days. Daily limit: ${sender.max_daily_limit}`,
      });
    }
  }

  return { ...sender, ...updates };
}

// ── Date Rollover ──────────────────────────────────────────────
// Resets sends_today if the date has changed since last tracked.

function needsDateRollover(sender) {
  if (!sender.sends_today_date) return true;
  const today = new Date().toISOString().slice(0, 10);
  return sender.sends_today_date !== today;
}

async function rolloverIfNeeded(supabase, sender) {
  if (!needsDateRollover(sender)) return sender;

  const today = new Date().toISOString().slice(0, 10);
  await supabase.from("sh_senders").update({
    sends_today: 0,
    sends_today_date: today,
    updated_at: new Date().toISOString(),
  }).eq("id", sender.id);

  return { ...sender, sends_today: 0, sends_today_date: today };
}

// ── Sender Pool ────────────────────────────────────────────────
// Returns senders in a group that have remaining capacity today.
// Advances warmup and handles date rollover lazily.

async function getSenderPool(supabase, group) {
  const { data: senders, error } = await supabase
    .from("sh_senders")
    .select("*")
    .eq("sender_group", group)
    .in("status", ["active", "warmup"])
    .order("sends_today", { ascending: true });

  if (error || !senders) return [];

  const pool = [];
  for (let sender of senders) {
    sender = await rolloverIfNeeded(supabase, sender);
    sender = await advanceWarmup(supabase, sender);
    if (sender.sends_today < sender.daily_limit) {
      pool.push(sender);
    }
  }

  return pool;
}

// ── Capacity Check ─────────────────────────────────────────────
// Pre-flight check before importing prospects.

async function checkSenderCapacity(supabase, group) {
  const { data: senders, error } = await supabase
    .from("sh_senders")
    .select("email, sends_today, sends_today_date, daily_limit, status")
    .eq("sender_group", group)
    .in("status", ["active", "warmup"]);

  if (error || !senders || senders.length === 0) {
    return { hasCapacity: false, remaining: 0, totalLimit: 0, activeSenders: 0 };
  }

  const today = new Date().toISOString().slice(0, 10);
  let remaining = 0;
  let totalLimit = 0;

  for (const s of senders) {
    const todaySends = s.sends_today_date === today ? s.sends_today : 0;
    remaining += Math.max(0, s.daily_limit - todaySends);
    totalLimit += s.daily_limit;
  }

  return {
    hasCapacity: remaining > 0,
    remaining,
    totalLimit,
    activeSenders: senders.length,
  };
}

// ── Increment Send Count ───────────────────────────────────────
// Called after a successful prospect import. Tracks daily and total counts.

async function incrementSenderCount(supabase, email) {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  // Update sender record
  const { data: sender } = await supabase
    .from("sh_senders")
    .select("id, sends_today, sends_today_date, total_sends")
    .eq("email", email)
    .single();

  if (!sender) return;

  const todaySends = sender.sends_today_date === today ? sender.sends_today : 0;

  await supabase.from("sh_senders").update({
    sends_today: todaySends + 1,
    sends_today_date: today,
    total_sends: (sender.total_sends || 0) + 1,
    last_send_at: now,
    updated_at: now,
  }).eq("id", sender.id);

  // Upsert daily log
  const { data: existing } = await supabase
    .from("sh_sender_daily_log")
    .select("id, sends")
    .eq("sender_email", email)
    .eq("log_date", today)
    .single();

  if (existing) {
    await supabase.from("sh_sender_daily_log").update({
      sends: (existing.sends || 0) + 1,
    }).eq("id", existing.id);
  } else {
    await supabase.from("sh_sender_daily_log").insert({
      sender_email: email,
      log_date: today,
      sends: 1,
    });
  }
}

// ── Health Updates ─────────────────────────────────────────────
// Called by the webhook on every engagement event.
// Tracks bounces, replies, opens. Auto-pauses on high bounce rate.

async function updateSenderHealth(supabase, email, eventType) {
  if (!email) return null;

  const { data: sender } = await supabase
    .from("sh_senders")
    .select("*")
    .eq("email", email)
    .single();

  if (!sender) return null;

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const senderUpdates = { updated_at: now };
  const dailyUpdates = {};

  switch (eventType) {
    case "email-bounced": {
      const newBounces = (sender.total_bounces || 0) + 1;
      const newRate = sender.total_sends > 0 ? newBounces / sender.total_sends : 0;
      senderUpdates.total_bounces = newBounces;
      senderUpdates.bounce_rate = Math.round(newRate * 10000) / 10000;
      senderUpdates.last_bounce_at = now;
      dailyUpdates.bounces = 1;

      // Auto-pause if bounce rate exceeds threshold with sufficient data
      if (newRate > BOUNCE_THRESHOLD && sender.total_sends >= MIN_SENDS_FOR_PAUSE) {
        senderUpdates.status = "paused";
        senderUpdates.pause_reason = `Bounce rate ${(newRate * 100).toFixed(1)}% exceeds ${(BOUNCE_THRESHOLD * 100)}% threshold`;
        await supabase.from("sh_sender_alerts").insert({
          sender_email: email,
          alert_type: "auto_paused",
          message: senderUpdates.pause_reason + ` (${newBounces}/${sender.total_sends} bounced)`,
        });
        console.warn(`AUTO-PAUSED sender ${email}: ${senderUpdates.pause_reason}`);
      }
      break;
    }
    case "reply-received":
      senderUpdates.total_replies = (sender.total_replies || 0) + 1;
      dailyUpdates.replies = 1;
      break;
    case "email-opened":
      dailyUpdates.opens = 1;
      break;
    case "prospect-unsubscribed":
      dailyUpdates.unsubscribes = 1;
      break;
  }

  // Update sender record
  await supabase.from("sh_senders").update(senderUpdates).eq("id", sender.id);

  // Update daily log
  if (Object.keys(dailyUpdates).length > 0) {
    const { data: existing } = await supabase
      .from("sh_sender_daily_log")
      .select("id, bounces, opens, replies, unsubscribes")
      .eq("sender_email", email)
      .eq("log_date", today)
      .single();

    if (existing) {
      const patch = {};
      for (const [key, increment] of Object.entries(dailyUpdates)) {
        patch[key] = (existing[key] || 0) + increment;
      }
      if (dailyUpdates.bounces && existing.sends > 0) {
        patch.bounce_rate = Math.round(((existing.bounces || 0) + 1) / existing.sends * 10000) / 10000;
      }
      await supabase.from("sh_sender_daily_log").update(patch).eq("id", existing.id);
    } else {
      await supabase.from("sh_sender_daily_log").insert({
        sender_email: email,
        log_date: today,
        ...dailyUpdates,
      });
    }
  }

  return senderUpdates.status === "paused" ? "paused" : "ok";
}

// ── Health Report ──────────────────────────────────────────────
// Returns full sender pool status for the admin dashboard.

async function getSenderHealthReport(supabase) {
  const { data: senders } = await supabase
    .from("sh_senders")
    .select("*")
    .order("sender_group", { ascending: true })
    .order("id", { ascending: true });

  const { data: alerts } = await supabase
    .from("sh_sender_alerts")
    .select("*")
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(20);

  const today = new Date().toISOString().slice(0, 10);
  const capacity = {};

  for (const s of senders || []) {
    if (!capacity[s.sender_group]) {
      capacity[s.sender_group] = { total: 0, used: 0, remaining: 0, senders: 0 };
    }
    const group = capacity[s.sender_group];
    if (s.status === "active" || s.status === "warmup") {
      const todaySends = s.sends_today_date === today ? s.sends_today : 0;
      group.total += s.daily_limit;
      group.used += todaySends;
      group.remaining += Math.max(0, s.daily_limit - todaySends);
      group.senders += 1;
    }
  }

  return {
    senders: (senders || []).map(s => ({
      id: s.id,
      email: s.email,
      domain: s.domain,
      sender_group: s.sender_group,
      provider: s.provider,
      status: s.status,
      pause_reason: s.pause_reason,
      warmup_day: s.warmup_day,
      daily_limit: s.daily_limit,
      max_daily_limit: s.max_daily_limit,
      sends_today: s.sends_today_date === today ? s.sends_today : 0,
      total_sends: s.total_sends,
      total_bounces: s.total_bounces,
      total_replies: s.total_replies,
      bounce_rate: s.bounce_rate,
      last_send_at: s.last_send_at,
    })),
    alerts: alerts || [],
    capacity,
  };
}

// ── Manage Sender ──────────────────────────────────────────────
// Pause, resume, or update limits on a sender.

async function manageSender(supabase, email, operation, params = {}) {
  const { data: sender } = await supabase
    .from("sh_senders")
    .select("*")
    .eq("email", email)
    .single();

  if (!sender) return { error: `Sender ${email} not found` };

  const now = new Date().toISOString();

  switch (operation) {
    case "pause":
      await supabase.from("sh_senders").update({
        status: "paused",
        pause_reason: params.reason || "Manually paused",
        updated_at: now,
      }).eq("id", sender.id);
      return { status: "paused", email };

    case "resume":
      await supabase.from("sh_senders").update({
        status: sender.warmup_day >= 21 ? "active" : "warmup",
        pause_reason: null,
        updated_at: now,
      }).eq("id", sender.id);
      // Resolve any open alerts for this sender
      await supabase.from("sh_sender_alerts").update({ resolved: true })
        .eq("sender_email", email).eq("resolved", false);
      return { status: "resumed", email };

    case "update-limit":
      if (!params.daily_limit && !params.max_daily_limit) {
        return { error: "Provide daily_limit or max_daily_limit" };
      }
      const limitUpdate = { updated_at: now };
      if (params.daily_limit) limitUpdate.daily_limit = params.daily_limit;
      if (params.max_daily_limit) limitUpdate.max_daily_limit = params.max_daily_limit;
      await supabase.from("sh_senders").update(limitUpdate).eq("id", sender.id);
      return { status: "updated", email, ...limitUpdate };

    case "disable":
      await supabase.from("sh_senders").update({
        status: "disabled",
        pause_reason: params.reason || "Disabled",
        updated_at: now,
      }).eq("id", sender.id);
      return { status: "disabled", email };

    default:
      return { error: `Unknown operation: ${operation}` };
  }
}

module.exports = {
  getWarmupDailyLimit,
  advanceWarmup,
  getSenderPool,
  checkSenderCapacity,
  incrementSenderCount,
  updateSenderHealth,
  getSenderHealthReport,
  manageSender,
};
