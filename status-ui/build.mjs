#!/usr/bin/env node
// Builds the status page into an output directory. It only reads: the repository checkout (history/),
// the public GitHub issues API, and local fixtures. It never pushes, commits or deploys.
//
//   node status-ui/build.mjs --out /tmp/preview --data fixture [--fixture sample|calm|unknown]
//   node status-ui/build.mjs --out /tmp/preview --data live      (needs full git history: fetch-depth 0)
//
// Environment: GITHUB_TOKEN (optional, raises the issues API limit), STATUS_REPO (default Sudoo-sh/status-page).
// Exit codes: 0 when the page is built; 1 (an uncaught error) when a file cannot be read. An issues API failure is
// only a warning: the page then says the lists were not available.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true] : null)).filter(Boolean));
const out = resolve(args.out || "dist");
const mode = args.data || "fixture";
const REPO = process.env.STATUS_REPO || "Sudoo-sh/status-page";
const SLUGS = ["website", "docs", "hub-api", "sign-in", "account", "admin", "marketplace", "developers", "installer", "files"];

/**
 * Read the flat "key: value" lines of an Upptime history file. Not a YAML parser: nested values are ignored, which is
 * enough for history/<slug>.yml.
 * @param {string} text The file's text.
 * @returns {Object<string, string>} The values by key, as text.
 */
function yml(text) {
  const o = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (m) o[m[1]] = m[2].trim();
  }
  return o;
}
/**
 * Run git in the repository checkout.
 * @param {...string} a The arguments.
 * @returns {string} What git printed.
 * @throws When git fails (for example a file that is not in a commit).
 */
function git(...a) {
  return execFileSync("git", a, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}
/**
 * Read the expected status codes of each monitor from .upptimerc.yml (line by line, no YAML library).
 * @returns {Object<string, string[]>} The codes by slug; a slug without the setting is missing.
 */
function expectedFromConfig() {
  // expectedStatusCodes per slug, read from .upptimerc.yml (monitor settings are only read, never changed)
  const text = readFileSync(join(repoRoot, ".upptimerc.yml"), "utf8");
  const res = {};
  let slug = null;
  for (const line of text.split("\n")) {
    const a = /^\s*slug:\s*(\S+)/.exec(line);
    if (a) slug = a[1];
    const b = /^\s*expectedStatusCodes:\s*\[(.*)\]/.exec(line);
    if (b && slug) res[slug] = b[1].split(",").map((x) => x.trim()).filter(Boolean);
  }
  return res;
}
/**
 * Read a service's response-time samples from the git history of history/<slug>.yml (at most the last 600 commits).
 * @param {string} slug The monitor's slug.
 * @returns {{t: string, ms: number}[]} The samples, oldest first; empty when the history cannot be read.
 */
function samplesFor(slug) {
  // Recorded samples: one per commit that changed history/<slug>.yml, using the file's own recorded time and value.
  // Commit cadence is not check cadence. Nothing here is resampled or filled.
  const file = `history/${slug}.yml`;
  let hashes = [];
  try { hashes = git("log", "--format=%H", "--", file).split("\n").filter(Boolean); } catch { return []; }
  const seen = new Set();
  const list = [];
  for (const h of hashes.slice(0, 600)) {
    let o;
    try { o = yml(git("show", `${h}:${file}`)); } catch { continue; }
    const ms = Number(o.responseTime);
    if (!o.lastUpdated || Number.isNaN(ms) || seen.has(o.lastUpdated)) continue;
    seen.add(o.lastUpdated);
    list.push({ t: o.lastUpdated, ms });
  }
  return list.reverse();
}
/**
 * Read this repository's issues with a label from the public GitHub API (one page of 100; pull requests dropped).
 * GITHUB_TOKEN, when set, is sent to raise the rate limit.
 * @param {string} label The label, "status" or "maintenance".
 * @returns {Promise<Object[]>} The issues as the API gives them.
 * @throws When the API answers with an error status or cannot be reached.
 */
async function issues(label) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "sudoo-status-ui-build" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues?state=all&labels=${label}&per_page=100`, { headers });
  if (!res.ok) throw new Error(`issues ${label}: HTTP ${res.status}`);
  return (await res.json()).filter((i) => !i.pull_request);
}
/**
 * Read the `start:` and `end:` lines from the HTML comment in a maintenance issue's body, as Upptime documents them.
 * @param {string|null} body The issue's body.
 * @returns {Object<string, string>} The values by key; empty when the body has no comment.
 */
function parseMaintenanceBody(body) {
  const m = /<!--([\s\S]*?)-->/.exec(body || "");
  if (!m) return {};
  const o = {};
  for (const line of m[1].split("\n")) {
    const k = /^\s*([A-Za-z]+):\s*(.*)$/.exec(line);
    if (k) o[k[1]] = k[2].trim();
  }
  return o;
}
/**
 * Find the service an issue is about from its labels.
 * @param {(string|{name: string})[]} labels The issue's labels.
 * @returns {string|null} The first label that is a known slug, or null.
 */
function slugOf(labels) {
  const names = labels.map((l) => (typeof l === "string" ? l : l.name));
  return names.find((n) => SLUGS.includes(n)) || null;
}
/**
 * Build the page's data from this checkout: history/summary.json, history/<slug>.yml, .upptimerc.yml and the git
 * history, plus incidents and maintenance from the issues API. When the issues cannot be read the lists are null, so
 * the page says they were not available instead of "none".
 * @returns {Promise<Object>} The data written to data/status.json.
 * @throws When history/summary.json or a history file cannot be read.
 */
async function liveData() {
  const summary = JSON.parse(readFileSync(join(repoRoot, "history/summary.json"), "utf8"));
  const expected = expectedFromConfig();
  const services = summary.map((s) => {
    const f = yml(readFileSync(join(repoRoot, `history/${s.slug}.yml`), "utf8"));
    return {
      slug: s.slug,
      name: s.name,
      url: s.url,
      expected: expected[s.slug] || ["200"],
      status: f.status || s.status,
      code: f.code ? Number(f.code) : null,
      responseTime: f.responseTime ? Number(f.responseTime) : null,
      lastUpdated: f.lastUpdated || null,
      startTime: f.startTime || null,
      // Upptime has no 90-day figure and the files do not prove complete daily coverage, so none is given.
      uptime: { day: s.uptimeDay, week: s.uptimeWeek, month: s.uptimeMonth, all: s.uptime, ninetyDay: null },
      avgMs: { day: s.timeDay, week: s.timeWeek, month: s.timeMonth, year: s.timeYear },
      dailyMinutesDown: s.dailyMinutesDown || {},
      samples: samplesFor(s.slug),
    };
  });
  let incidents = null, maintenance = null;
  try {
    incidents = (await issues("status")).map((i) => ({
      id: i.number, title: i.title, url: i.html_url, start: i.created_at, end: i.closed_at || null, service: slugOf(i.labels || []),
    }));
  } catch (e) { console.warn("incidents unavailable:", e.message); }
  try {
    maintenance = (await issues("maintenance")).map((i) => {
      const c = parseMaintenanceBody(i.body);
      return { id: i.number, title: i.title, url: i.html_url, start: c.start || i.created_at, end: c.end || i.closed_at || null, service: null };
    });
  } catch (e) { console.warn("maintenance unavailable:", e.message); }
  const starts = services.map((s) => Date.parse(s.startTime)).filter((n) => !Number.isNaN(n));
  return {
    sample: false,
    generatedAt: new Date().toISOString(),
    coverageStart: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    services, incidents, maintenance,
  };
}
/**
 * Build the page's data from a fixture in status-ui/fixtures. Ages are turned into times from now; `sample` is true,
 * so the page shows the "Sample data" banner.
 * @param {string} name The fixture's name: sample, calm or unknown.
 * @returns {Object} The data written to data/status.json.
 * @throws When the fixture cannot be read or is not valid JSON.
 */
function fixtureData(name) {
  // Fixtures give ages in minutes so the preview looks the same whenever it is built. Illustrative only.
  const f = JSON.parse(readFileSync(join(here, "fixtures", `${name}.json`), "utf8"));
  const now = Date.now();
  const iso = (agoMin) => new Date(now - agoMin * 60000).toISOString();
  return {
    sample: true,
    generatedAt: iso(f.generatedAgoMin ?? 3),
    coverageStart: iso(f.coverageDays * 1440),
    services: f.services.map((s) => ({
      slug: s.slug, name: s.name, url: "https://example.invalid/", expected: s.expected || ["200"],
      status: s.status, code: s.code ?? null, responseTime: s.ms ?? null,
      lastUpdated: s.updatedAgoMin === null || s.updatedAgoMin === undefined ? null : iso(s.updatedAgoMin),
      startTime: iso(f.coverageDays * 1440),
      uptime: s.uptime, avgMs: s.avgMs || {},
      dailyMinutesDown: Object.fromEntries(Object.entries(s.downDaysAgo || {}).map(([ago, min]) => [new Date(now - Number(ago) * 86400000).toISOString().slice(0, 10), min])),
      samples: (s.samplesAgoMin || []).map(([ago, ms]) => ({ t: iso(ago), ms })),
    })),
    incidents: f.incidents ? f.incidents.map((i) => ({ id: i.id, title: i.title, url: null, start: iso(i.startAgoMin), end: i.endAgoMin === null ? null : iso(i.endAgoMin), service: i.service })) : [],
    maintenance: f.maintenance ? f.maintenance.map((m) => ({ id: m.id, title: m.title, url: null, start: iso(m.startAgoMin), end: iso(m.endAgoMin), service: null })) : [],
  };
}
/**
 * Write the incidents as an Atom feed, newest first. Every value is escaped for XML.
 * @param {Object} data The page's data.
 * @returns {string} The feed's XML.
 */
function atom(data) {
  const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
  const list = (data.incidents || []).slice().sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  const updated = list.length ? list[0].end || list[0].start : data.generatedAt;
  const entries = list.map((i) => `  <entry>
    <id>tag:status.sudoo.sh,2026:incident-${esc(i.id)}</id>
    <title>${esc(i.title)}</title>
    <updated>${esc(i.end || i.start)}</updated>
    <published>${esc(i.start)}</published>
    <link href="${esc(i.url || "https://status.sudoo.sh/")}"/>
    <summary>${esc(i.end ? "Resolved" : "Ongoing")}</summary>
  </entry>`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>tag:status.sudoo.sh,2026:incidents</id>
  <title>Sudoo.sh status: incidents</title>
  <updated>${esc(updated)}</updated>
  <link href="https://status.sudoo.sh/" rel="alternate"/>
${entries}
</feed>
`;
}

// Side effects: the output folder is deleted and made again, then filled with the page, data/status.json and
// incidents.atom. Nothing outside it is written.
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "data"), { recursive: true });
for (const f of ["index.html", "app.css", "boot.js", "favicon.svg"]) cpSync(join(here, f), join(out, f));
for (const f of readdirSync(join(here, "src"))) cpSync(join(here, "src", f), join(out, f));
const data = mode === "live" ? await liveData() : fixtureData(args.fixture || "sample");
writeFileSync(join(out, "data/status.json"), JSON.stringify(data, null, 1));
writeFileSync(join(out, "incidents.atom"), atom(data));
console.log(`built ${out} (${mode}${mode === "live" ? "" : ":" + (args.fixture || "sample")}), ${data.services.length} services`);
