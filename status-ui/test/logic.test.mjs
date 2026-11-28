// Tests of the pure functions in src/logic.js: states, headline, day blocks, uptime and samples.
// Run: node --test status-ui/test/logic.test.mjs (no dependencies).
import test from "node:test";
import assert from "node:assert/strict";
import { serviceState, headline, dayBlocks, uptimeValue, samplesIn } from "../src/logic.js";

const now = Date.parse("2026-11-25T12:00:00Z");
const base = { status: "up", code: 200, responseTime: 300, lastUpdated: "2026-11-25T11:50:00Z", startTime: "2026-11-21T11:00:00Z" };

test("fresh up is ok", () => assert.equal(serviceState(base, now).state, "ok"));
test("old snapshot is stale, never ok", () =>
  assert.equal(serviceState({ ...base, lastUpdated: "2026-11-25T05:00:00Z" }, now).state, "stale"));
test("missing update is unknown", () => assert.equal(serviceState({ ...base, lastUpdated: "" }, now).state, "unknown"));
test("down with redirect code is attention, claims no cause", () =>
  assert.equal(serviceState({ ...base, status: "down", code: 302 }, now).state, "attention"));
test("down with 500 is down", () => assert.equal(serviceState({ ...base, status: "down", code: 500 }, now).state, "down"));
test("slow", () => assert.equal(serviceState({ ...base, responseTime: 2500 }, now).state, "slow"));
test("headline never working with a stale service", () =>
  assert.equal(headline(["ok", "stale", "ok"]).key, "outdated"));
test("headline problems beats stale", () => assert.equal(headline(["down", "stale"]).key, "failing"));
test("attention alone is not called failing", () => assert.equal(headline(["attention", "ok"]).key, "attention"));
test("all unknown is no observations, not out of date", () => assert.equal(headline(["unknown", "unknown"]).key, "nodata"));
test("headline ok", () => assert.equal(headline(["ok", "ok"]).key, "ok"));
test("day blocks: nodata before start, none without entry, never claims 100%", () => {
  const b = dayBlocks({ ...base, dailyMinutesDown: { "2026-11-24": 30 } }, now);
  assert.equal(b.length, 90);
  assert.equal(b[0].kind, "nodata");
  assert.equal(b[89].kind, "none");
  const d = b.find((x) => x.date === "2026-11-24");
  assert.equal(d.minutes, 30);
  assert.ok(Math.abs(d.pct - 97.9166) < 0.01);
});
test("90d uptime is never taken from year", () =>
  assert.equal(uptimeValue({ uptime: { year: "99%", all: "99%" } }, "90d"), null));
test("samples are not resampled or invented", () => {
  const s = samplesIn({ samples: [{ t: "2026-11-25T10:00:00Z", ms: 1 }, { t: "2026-11-20T10:00:00Z", ms: 2 }] }, 86400000, now);
  assert.equal(s.length, 1);
});
test("service with no recorded update has only no-data blocks", () => {
  const b = dayBlocks({ ...base, lastUpdated: "" }, now);
  assert.ok(b.every((x) => x.kind === "nodata"));
});
