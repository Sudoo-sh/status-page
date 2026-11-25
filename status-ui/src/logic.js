// Pure functions: state of a service, headline, day blocks, chart points. No DOM.
import { SLOW_MS, STALE_AFTER_MIN } from "./config.js";

const DAY = 86400000;

export function parseTime(value) {
  const t = Date.parse(value || "");
  return Number.isNaN(t) ? null : t;
}

// ok | slow | down | attention | stale | unknown
export function serviceState(svc, now) {
  const updated = parseTime(svc.lastUpdated);
  if (updated === null) return { state: "unknown", ageMin: null };
  const ageMin = Math.max(0, Math.round((now - updated) / 60000));
  if (ageMin > STALE_AFTER_MIN) return { state: "stale", ageMin };
  if (svc.status === "down") {
    const code = Number(svc.code);
    // The monitor's expectation was not met and the recorded answer was a redirect or a
    // sign-in/forbidden code. The page states the facts and claims no cause.
    const attention = (code >= 300 && code < 400) || code === 401 || code === 403;
    return { state: attention ? "attention" : "down", ageMin };
  }
  if (svc.status === "degraded" || Number(svc.responseTime) > SLOW_MS) return { state: "slow", ageMin };
  return { state: "ok", ageMin };
}

const ORDER = ["down", "attention", "stale", "unknown", "slow", "ok"];

export function headline(states) {
  const count = {};
  for (const s of ORDER) count[s] = 0;
  for (const s of states) count[s] += 1;
  let key = "ok";
  if (total_(states) > 0 && count.unknown === states.length) key = "nodata";
  else if (count.down) key = "failing";
  else if (count.attention) key = "attention";
  else if (count.stale || count.unknown) key = "outdated";
  else if (count.slow) key = "slow";
  return { key, count, total: states.length };
}

// 90 day blocks ending on the data's own last day. Coverage starts on the service's startTime day.
// kinds: nodata (before monitoring began), none (no downtime recorded), good/part/bad (downtime entry)
export function dayBlocks(svc, nowMs) {
  const start = parseTime(svc.startTime);
  const startDay = start === null ? null : Math.floor(start / DAY);
  const today = Math.floor(nowMs / DAY);
  const down = svc.dailyMinutesDown || {};
  const out = [];
  for (let i = 89; i >= 0; i--) {
    const day = today - i;
    const date = new Date(day * DAY).toISOString().slice(0, 10);
    // no recorded observation at all: every block is "no data", never "no downtime recorded"
    if (startDay === null || day < startDay || parseTime(svc.lastUpdated) === null) {
      out.push({ date, kind: "nodata" });
      continue;
    }
    const minutes = down[date];
    if (minutes === undefined) {
      out.push({ date, kind: "none" });
      continue;
    }
    const pct = Math.max(0, Math.min(100, (1 - minutes / 1440) * 100));
    out.push({ date, kind: pct >= 99 ? "good" : pct >= 95 ? "part" : "bad", minutes, pct });
  }
  return out;
}

export function uptimeValue(svc, range) {
  const u = svc.uptime || {};
  const raw = { "24h": u.day, "7d": u.week, "30d": u.month, "90d": u.ninetyDay, all: u.all }[range];
  if (raw === undefined || raw === null || raw === "") return null;
  const n = parseFloat(String(raw).replace("%", ""));
  return Number.isNaN(n) ? null : n;
}

// Recorded samples inside a window. No resampling, no filling.
export function samplesIn(svc, windowMs, now) {
  return (svc.samples || [])
    .map((s) => ({ t: parseTime(s.t), ms: Number(s.ms) }))
    .filter((s) => s.t !== null && !Number.isNaN(s.ms) && now - s.t <= windowMs && s.t <= now)
    .sort((a, b) => a.t - b.t);
}

export function formatAge(min, t) {
  if (min === null) return null;
  if (min < 1) return t.lessThanMinute;
  if (min < 60) return t.minutes(min);
  if (min < 48 * 60) return t.hours(Math.round(min / 60));
  return t.days(Math.round(min / 1440));
}

function total_(a) {
  return a.length;
}
