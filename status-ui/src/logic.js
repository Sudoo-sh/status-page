// Pure functions: state of a service, headline, day blocks, chart points. No DOM.
// Used by app.js in the browser and by test/logic.test.mjs under Node, so nothing here may touch the page.
import { SLOW_MS, STALE_AFTER_MIN } from "./config.js";

const DAY = 86400000;

/**
 * Read a time stamp.
 * @param {string|null|undefined} value An ISO 8601 date and time, as Upptime writes them.
 * @returns {number|null} Milliseconds since 1970, or null when the value is empty or not a date.
 */
export function parseTime(value) {
  const t = Date.parse(value || "");
  return Number.isNaN(t) ? null : t;
}

/**
 * Work out what the page shows for one service, from what the monitor recorded. A failing check with a redirect,
 * 401 or 403 is "attention", not "down": the page states the recorded code and claims no cause.
 * @param {{lastUpdated?: string, status?: string, code?: number|string, responseTime?: number|string}} svc The service's
 *   recorded data.
 * @param {number} now The current time in milliseconds.
 * @returns {{state: string, ageMin: number|null}} The state (one of the values below) and the age of the last recorded
 *   update in minutes (null when there is none).
 */
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

/**
 * Pick the page's headline from the states of all services. The worst state wins, in this order: failing, attention,
 * outdated (stale or unknown), slow, ok. "nodata" only when no service has a recorded update.
 * @param {string[]} states The state of each service, from `serviceState`.
 * @returns {{key: string, count: Object<string, number>, total: number}} The headline key, the count per state and the
 *   number of services.
 */
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

/**
 * Build the 90 daily blocks of a service's bar. A day without a downtime entry is "none" (no downtime recorded), never
 * a claim of 100%.
 * @param {{startTime?: string, lastUpdated?: string, dailyMinutesDown?: Object<string, number>}} svc The service's
 *   recorded data.
 * @param {number} nowMs The current time in milliseconds; the last block is this UTC day.
 * @returns {{date: string, kind: string, minutes?: number, pct?: number}[]} 90 blocks, oldest first.
 */
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

/**
 * Read a service's uptime for a range.
 * @param {{uptime?: Object<string, string|number|null>}} svc The service's data.
 * @param {string} range "24h", "7d", "30d", "90d" or "all".
 * @returns {number|null} The uptime in percent, or null when the data has no figure for that range.
 */
export function uptimeValue(svc, range) {
  const u = svc.uptime || {};
  const raw = { "24h": u.day, "7d": u.week, "30d": u.month, "90d": u.ninetyDay, all: u.all }[range];
  if (raw === undefined || raw === null || raw === "") return null;
  const n = parseFloat(String(raw).replace("%", ""));
  return Number.isNaN(n) ? null : n;
}

/**
 * Pick the recorded response-time samples inside a window, oldest first. Samples with no valid time or value are
 * dropped.
 * @param {{samples?: {t: string, ms: number|string}[]}} svc The service's data.
 * @param {number} windowMs The window's length in milliseconds, ending now.
 * @param {number} now The current time in milliseconds.
 * @returns {{t: number, ms: number}[]} The samples.
 */
// Recorded samples inside a window. No resampling, no filling.
export function samplesIn(svc, windowMs, now) {
  return (svc.samples || [])
    .map((s) => ({ t: parseTime(s.t), ms: Number(s.ms) }))
    .filter((s) => s.t !== null && !Number.isNaN(s.ms) && now - s.t <= windowMs && s.t <= now)
    .sort((a, b) => a.t - b.t);
}

/**
 * Say an age in words: under a minute, minutes, hours (below 48 h) or days.
 * @param {number|null} min The age in minutes.
 * @param {{lessThanMinute: string, minutes: Function, hours: Function, days: Function}} t The words of the page's
 *   language (`STR[lang].age`).
 * @returns {string|null} The text, or null when the age is not known.
 */
export function formatAge(min, t) {
  if (min === null) return null;
  if (min < 1) return t.lessThanMinute;
  if (min < 60) return t.minutes(min);
  if (min < 48 * 60) return t.hours(Math.round(min / 60));
  return t.days(Math.round(min / 1440));
}

/**
 * Count the items of a list.
 * @param {Array} a The list.
 * @returns {number} Its length.
 */
function total_(a) {
  return a.length;
}
