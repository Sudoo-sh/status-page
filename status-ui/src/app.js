import { DATA_URL, REFRESH_MS, STALE_AFTER_MIN, SLOW_MS } from "./config.js";
import { STR } from "./i18n.js";
import { serviceState, headline, dayBlocks, uptimeValue, samplesIn, formatAge, parseTime } from "./logic.js";

const root = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let data = null;
let failed = false;
let range = "30d";
const open = new Set();
const chartWindow = {};
try {
  const r = localStorage.getItem("sudoo.status.range");
  if (["24h", "7d", "30d", "90d", "all"].includes(r)) range = r;
} catch (e) { /* storage blocked */ }

const lang = () => (root.lang === "ar" ? "ar" : "en");
const t = () => STR[lang()];
const locale = () => (lang() === "ar" ? "ar-EG" : "en-GB");
const num = (v, d = 0) => new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const when = (ms) => new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
const day = (ms) => new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeZone: "UTC" }).format(new Date(ms));

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const SVGNS = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}

// icon + text + colour: a state is never colour only
const ICON = {
  ok: ["M5 12.5l4.2 4.2L19 7"],
  slow: ["M12 7v5.5l3.5 2", "circle"],
  down: ["M6.5 6.5l11 11M17.5 6.5l-11 11"],
  attention: ["M12 7.5v6", "M12 16.6v.1"],
  stale: ["M9.5 9.2a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.4 1-1.4 2", "M12 16.6v.1"],
  unknown: ["M7 12h10"],
  loading: ["M7 12h.1M12 12h.1M17 12h.1"],
};
function icon(state, size = 20) {
  const parts = ICON[state] || ICON.unknown;
  const svg = s("svg", { viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": "true", class: "ico" });
  if (state === "attention") svg.append(s("path", { d: "M12 3.6l9.3 16.2H2.7z", class: "ico-fill" }));
  else if (state === "stale" || state === "slow" || state === "unknown") svg.append(s("circle", { cx: 12, cy: 12, r: 9.2, class: "ico-fill" }));
  else svg.append(s("circle", { cx: 12, cy: 12, r: 9.2, class: "ico-fill" }));
  for (const d of parts) if (d !== "circle") svg.append(s("path", { d, class: "ico-stroke" }));
  return svg;
}

const GROUPS = [
  ["web", ["website", "docs"]],
  ["panel", ["hub-api", "sign-in", "account", "admin"]],
  ["market", ["marketplace", "developers"]],
  ["downloads", ["installer", "files"]],
];

function applyStatic() {
  const T = t();
  $$("[data-i18n]").forEach((el) => {
    const v = el.dataset.i18n.split(".").reduce((o, k) => (o ? o[k] : undefined), T);
    if (typeof v === "string") el.textContent = v;
  });
  document.title = T.title;
  const list = $("[data-about-list]");
  list.textContent = "";
  T.about(STALE_AFTER_MIN, SLOW_MS, sinceText() || "-").forEach((line) => list.append(h("li", {}, line)));
  $("[data-lang-switch]").textContent = T.lang;
  $("[data-lang-switch]").lang = lang() === "ar" ? "en" : "ar";
  $("[data-theme-group]").setAttribute("aria-label", T.theme.label);
  const cur = root.getAttribute("data-theme") || "auto";
  $$("[data-theme-set]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.themeSet === cur)));
  $$("[data-range]").forEach((b) => {
    // 90 d is hidden entirely until the data supports it
    const na = b.dataset.range === "90d" && !(data ? data.services : []).some((x) => uptimeValue(x, "90d") !== null);
    b.textContent = T.ranges[b.dataset.range];
    b.hidden = na;
    b.setAttribute("aria-checked", String(b.dataset.range === range));
  });
}

function sinceText() {
  const start = data && data.coverageStart ? parseTime(data.coverageStart) : null;
  return start === null ? "" : day(start);
}

function renderHero(now, rows) {
  const T = t();
  const hero = $("[data-hero]");
  const title = $("[data-hero-title]");
  const sub = $("[data-hero-sub]");
  const meta = $("[data-hero-meta]");
  const ic = $("[data-hero-icon]");
  ic.textContent = "";
  meta.textContent = "";
  if (failed && !data) {
    hero.dataset.state = "unknown";
    title.textContent = T.loadFailed;
    sub.textContent = "";
    ic.append(icon("unknown", 34));
    return;
  }
  if (!data) {
    hero.dataset.state = "loading";
    title.textContent = T.loading;
    sub.textContent = "";
    ic.append(icon("loading", 34));
    return;
  }
  const hl = headline(rows.map((r) => r.st.state));
  const key = { ok: "ok", slow: "slow", outdated: "stale", failing: "down", attention: "stale", nodata: "unknown" }[hl.key];
  hero.dataset.state = key;
  ic.append(icon(key === "down" ? "down" : key, 34));
  title.textContent = T.headline[hl.key];
  sub.textContent = T.headlineSub(hl.count, hl.total);
  const gen = parseTime(data.generatedAt);
  const ages = rows.map((r) => r.st.ageMin).filter((x) => x !== null && x !== undefined);
  const newest = ages.length ? Math.min(...ages) : null;
  const parts = [];
  if (gen !== null) parts.push(T.updated(formatAge(Math.round((now - gen) / 60000), T.age)));
  if (newest === null) parts.push(T.noMonitor);
  else if (newest >= STALE_AFTER_MIN) parts.push(T.monitorLatest(formatAge(newest, T.age)));
  meta.textContent = parts.join(" · ");
}

function stateFacts(svc, st) {
  const T = t();
  if (st.state === "attention") return T.attentionFacts(svc.code, (svc.expected || []).join(", ") || "?");
  if (st.state === "down") return T.downFacts(svc.code);
  if (st.state === "stale") return T.staleFacts(STALE_AFTER_MIN);
  if (st.state === "unknown") return "";
  return "";
}

function bar(svc, now) {
  const T = t();
  const blocks = dayBlocks(svc, now);
  const wrap = h("div", { class: "bar", role: "group", "aria-label": `${T.barLabel}: ${T.names[svc.slug] || svc.name}`, tabindex: "0", "data-bar": svc.slug });
  blocks.forEach((b, i) => {
    wrap.append(h("span", { class: `blk k-${b.kind}`, "data-i": i }));
  });
  const describe = (b) => {
    if (b.kind === "nodata") return `${day(Date.parse(b.date))}: ${T.barNodata}`;
    if (b.kind === "none") return `${day(Date.parse(b.date))}: ${T.barNone}`;
    return `${day(Date.parse(b.date))}: ${T.barDown(num(b.pct, 1), num(b.minutes, 0))}`;
  };
  wrap._blocks = blocks;
  wrap._describe = describe;
  return wrap;
}

function chart(svc, now) {
  const T = t();
  const win = chartWindow[svc.slug] || "24h";
  const ms = win === "24h" ? 86400000 : 7 * 86400000;
  const pts = samplesIn(svc, ms, now);
  const box = h("div", { class: "chart" });
  const tabs = h("div", { class: "range small", role: "radiogroup", "aria-label": T.response },
    ["24h", "7d"].map((w) => h("button", { type: "button", role: "radio", "aria-checked": String(w === win), "data-cw": `${svc.slug}:${w}` }, w === "24h" ? T.window24 : T.window7)));
  box.append(h("div", { class: "chart-head" }, h("strong", {}, T.response), tabs));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length >= 2) {
    const W = 640, H = 180, L = 46, R = 10, TP = 12, B = 22;
    const t0 = now - ms, t1 = now;
    const max = Math.max.apply(null, pts.map((p) => p.ms)) * 1.15 || 1;
    const x = (v) => L + ((v - t0) / (t1 - t0)) * (W - L - R);
    const y = (v) => TP + (1 - v / max) * (H - TP - B);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "plot", role: "img", "aria-label": `${T.response}: ${T.samples(pts.length, when(first.t), when(last.t))}` });
    for (let i = 0; i <= 3; i++) {
      const v = (max / 3) * i;
      svg.append(s("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }));
      const lab = s("text", { x: L - 6, y: y(v) + 4, class: "axis", "text-anchor": "end" });
      lab.textContent = num(Math.round(v));
      svg.append(lab);
    }
    svg.append(s("polyline", { points: pts.map((p) => `${x(p.t).toFixed(1)},${y(p.ms).toFixed(1)}`).join(" "), class: "line" }));
    pts.forEach((p) => svg.append(s("circle", { cx: x(p.t).toFixed(1), cy: y(p.ms).toFixed(1), r: 3.4, class: "dot" }, (() => { const tt = s("title"); tt.textContent = `${when(p.t)}: ${T.ms(num(p.ms))}`; return tt; })())));
    box.append(svg);
    box.append(h("p", { class: "faint small-t" }, T.samples(pts.length, when(first.t), when(last.t))));
  } else {
    box.append(h("p", { class: "faint" }, T.notEnough));
    if (last) box.append(h("p", {}, `${T.latest}: ${T.ms(num(last.ms))} (${when(last.t)})`));
    else if (svc.responseTime) box.append(h("p", {}, `${T.latest}: ${T.ms(num(svc.responseTime))}${svc.lastUpdated ? ` (${when(parseTime(svc.lastUpdated))})` : ""}`));
  }
  const a = svc.avgMs || {};
  const keys = Object.keys(T.avg).filter((k) => a[k] !== undefined && a[k] !== null);
  if (keys.length) box.append(h("p", { class: "small-t" }, `${T.averages}: `, keys.map((k) => `${T.avg[k]} ${T.ms(num(a[k]))}`).join(" · ")));
  return box;
}

const RANGE_DAYS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };
function coverageText(svc, now) {
  const T = t();
  const start = parseTime(svc.startTime);
  if (start === null) return "";
  if (range === "all") return `${T.coverageAll(day(start))}. ${T.reported}`;
  const have = Math.max(0, Math.round(((now - start) / 86400000) * 10) / 10);
  const want = RANGE_DAYS[range];
  return (have < want ? `${T.coverage(num(have, 1), num(want))}. ` : "") + T.reported;
}

function row(svc, now) {
  const T = t();
  const st = serviceState(svc, now);
  const name = T.names[svc.slug] || svc.name;
  const u = uptimeValue(svc, range);
  const uText = u === null ? "" : `${num(u, u >= 99.995 || u === 0 ? 0 : 2)}%`;
  const isOpen = open.has(svc.slug);
  const lastText = svc.lastUpdated && st.ageMin !== null ? `${T.lastUpdate}: ${formatAge(st.ageMin, T.age)}` : `${T.lastUpdate}: ${T.never}`;
  const facts = stateFacts(svc, st);
  const chev = s("svg", { viewBox: "0 0 24 24", width: 18, height: 18, "aria-hidden": "true", class: "chev" }, s("path", { d: "M6 9l6 6 6-6", class: "ico-stroke" }));
  const details = isOpen
    ? h("div", { class: "details", id: `d-${svc.slug}` },
        h("p", { class: "faint" }, lastText),
        facts ? h("p", { class: "facts" }, facts) : null,
        u === null && range === "90d" ? h("p", { class: "faint" }, T.unavailable90) : h("p", { class: "faint" }, coverageText(svc, now)),
        chart(svc, now))
    : null;
  return h("article", { class: "row", "data-state": st.state },
    h("div", { class: "row-main" },
      h("div", { class: "row-name" }, h("h3", {}, name), h("span", { class: "chip", "data-state": st.state }, icon(st.state, 14), h("span", {}, T.states[st.state]))),
      h("div", { class: "row-up" }, h("span", { class: "up-val" }, uText || "–"),
        h("button", { type: "button", class: "chev-btn", "aria-expanded": String(isOpen), "aria-controls": isOpen ? `d-${svc.slug}` : null, "aria-label": `${isOpen ? T.hide : T.details}: ${name}`, "data-toggle": svc.slug }, chev))),
    bar(svc, now),
    details);
}

function renderServices(now, rows) {
  const T = t();
  const host = $("[data-groups]");
  host.textContent = "";
  if (!data) return;
  const by = {};
  rows.forEach((r) => (by[r.svc.slug] = r));
  const placed = new Set();
  GROUPS.forEach(([g, slugs]) => {
    const list = slugs.filter((x) => by[x]);
    if (!list.length) return;
    list.forEach((x) => placed.add(x));
    host.append(h("section", { class: "group" }, h("h2", { class: "group-h" }, T.groups[g]), h("div", { class: "rows" }, list.map((x) => row(by[x].svc, now)))));
  });
  const rest = rows.filter((r) => !placed.has(r.svc.slug));
  if (rest.length) host.append(h("section", { class: "group" }, h("div", { class: "rows" }, rest.map((r) => row(r.svc, now)))));
}

function duration(a, b) {
  const min = Math.max(0, Math.round((b - a) / 60000));
  if (min < 60) return `${num(min)} min`;
  if (min < 2880) return `${num(Math.round(min / 6) / 10, 1)} h`;
  return `${num(Math.round(min / 144) / 10, 1)} d`;
}

function eventList(list, kind, now) {
  const T = t();
  return h("ul", { class: "events" }, list.map((e) => {
    const a = parseTime(e.start), b = parseTime(e.end);
    const svcName = e.service ? T.names[e.service] || e.service : T.notSpecified;
    return h("li", { class: "event" },
      h("div", { class: "event-top" }, e.url ? h("a", { href: e.url }, e.title) : h("strong", {}, e.title), h("span", { class: "chip small", "data-state": b === null ? "down" : "ok" }, b === null ? T.ongoing : T.resolved)),
      h("div", { class: "faint small-t" }, `${T.service}: ${svcName}`, a !== null ? ` · ${T.started}: ${when(a)}` : "", b !== null ? ` · ${T.ended}: ${when(b)}` : "", a !== null ? ` · ${T.duration}: ${duration(a, b === null ? now : b)}` : ""));
  }));
}

function renderEvents(now) {
  const T = t();
  const inc = $("[data-incidents]");
  const mnt = $("[data-maintenance]");
  inc.textContent = "";
  mnt.textContent = "";
  if (!data) return;
  if (data.incidents === null || data.incidents === undefined) inc.append(h("p", { class: "empty" }, T.incidentsUnavailable));
  else if (!data.incidents.length) inc.append(h("p", { class: "empty" }, h("span", { class: "empty-ico" }, icon("ok", 18)), T.noIncidents(sinceText())));
  else inc.append(eventList(data.incidents, "incident", now));
  if (data.maintenance === null || data.maintenance === undefined) mnt.append(h("p", { class: "faint" }, T.incidentsUnavailable));
  else if (!data.maintenance.length) mnt.append(h("p", { class: "faint" }, T.noMaintenance));
  else mnt.append(eventList(data.maintenance, "maintenance", now));
}

function render() {
  applyStatic();
  const now = Date.now();
  const sample = $("[data-sample]");
  sample.hidden = !(data && data.sample);
  sample.textContent = data && data.sample ? t().sample : "";
  const rows = data ? data.services.map((svc) => ({ svc, st: serviceState(svc, now) })) : [];
  renderHero(now, rows);
  renderServices(now, rows);
  renderEvents(now);
}

async function load() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.json();
    if (!body || !Array.isArray(body.services)) throw new Error("shape");
    data = body;
    failed = false;
  } catch (e) {
    // Keep the last good data on screen only if it is the data we already showed; never invent.
    if (!data) failed = true;
  }
  render();
}

// tooltip on the 90-day bars: pointer hover/tap and keyboard arrows
const tip = $("[data-tip]");
function showTip(bar, i, target) {
  const b = bar._blocks[i];
  if (!b) return;
  tip.textContent = bar._describe(b);
  tip.hidden = false;
  $$(".blk.on", bar).forEach((x) => x.classList.remove("on"));
  const el = bar.children[i];
  el.classList.add("on");
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  let left = r.left + r.width / 2 - w / 2 + window.scrollX;
  left = Math.max(8, Math.min(left, window.scrollX + document.documentElement.clientWidth - w - 8));
  tip.style.left = `${left}px`;
  tip.style.top = `${r.top + window.scrollY - tip.offsetHeight - 8}px`;
  bar.dataset.cur = String(i);
}
document.addEventListener("pointerover", (e) => {
  const blk = e.target.closest && e.target.closest(".blk");
  if (blk) showTip(blk.parentElement, Number(blk.dataset.i));
});
document.addEventListener("pointerleave", () => {}, true);
document.addEventListener("pointerout", (e) => {
  if (e.target.closest && e.target.closest(".blk") && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".blk"))) tip.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("[data-about]").hidden) {
    $("[data-about]").hidden = true;
    $$("[data-about-toggle]").forEach((x) => x.setAttribute("aria-expanded", "false"));
    return;
  }
  const bar = e.target.closest && e.target.closest(".bar");
  if (!bar) return;
  let i = Number(bar.dataset.cur || 89);
  const rtl = root.dir === "rtl";
  if (e.key === "ArrowLeft") i += rtl ? 1 : -1;
  else if (e.key === "ArrowRight") i += rtl ? -1 : 1;
  else if (e.key === "Home") i = 0;
  else if (e.key === "End") i = 89;
  else return;
  e.preventDefault();
  showTip(bar, Math.max(0, Math.min(89, i)));
});
document.addEventListener("focusin", (e) => {
  const bar = e.target.closest && e.target.closest(".bar");
  if (bar && bar === e.target) showTip(bar, Number(bar.dataset.cur || 89));
});
document.addEventListener("focusout", (e) => {
  if (e.target.closest && e.target.closest(".bar")) tip.hidden = true;
});

document.addEventListener("click", (e) => {
  const tg = e.target.closest("[data-toggle]");
  if (tg) {
    const k = tg.dataset.toggle;
    open.has(k) ? open.delete(k) : open.add(k);
    render();
    const again = document.querySelector(`[data-toggle="${k}"]`);
    if (again) again.focus();
    return;
  }
  const cw = e.target.closest("[data-cw]");
  if (cw) {
    const [k, w] = cw.dataset.cw.split(":");
    chartWindow[k] = w;
    render();
    const again = document.querySelector(`[data-cw="${k}:${w}"]`);
    if (again) again.focus();
    return;
  }
  const ab = e.target.closest("[data-about-toggle]");
  if (ab) {
    const panel = $("[data-about]");
    panel.hidden = !panel.hidden;
    $$("[data-about-toggle]").forEach((x) => x.setAttribute("aria-expanded", String(!panel.hidden)));
    if (!panel.hidden) panel.scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.target.closest("[data-about-close]")) {
    $("[data-about]").hidden = true;
    $$("[data-about-toggle]").forEach((x) => x.setAttribute("aria-expanded", "false"));
    const back = $("[data-about-toggle]");
    if (back) back.focus();
    return;
  }
  const r = e.target.closest("[data-range]");
  if (r) {
    range = r.dataset.range;
    try { localStorage.setItem("sudoo.status.range", range); } catch (x) { /* ignore */ }
    render();
    const again = document.querySelector(`[data-range="${range}"]`);
    if (again) again.focus();
    return;
  }
  const th = e.target.closest("[data-theme-set]");
  if (th) {
    const v = th.dataset.themeSet;
    if (v === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", v);
    try { v === "auto" ? localStorage.removeItem("sudoo.status.theme") : localStorage.setItem("sudoo.status.theme", v); } catch (x) { /* ignore */ }
    applyStatic();
    return;
  }
  if (e.target.closest("[data-lang-switch]")) {
    const next = lang() === "ar" ? "en" : "ar";
    root.lang = next;
    root.dir = next === "ar" ? "rtl" : "ltr";
    try { localStorage.setItem("sudoo.status.lang", next); } catch (x) { /* ignore */ }
    render();
  }
});

render();
load();
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
