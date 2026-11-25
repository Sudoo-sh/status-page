// status.sudoo.sh: fills the page (assets/index.html) with Upptime's own figures. Upptime checks every service on a
// schedule and commits the results to this repository; history/summary.json is the latest summary of them, read
// here from raw.githubusercontent.com (the page itself is on GitHub Pages, built from assets/). Open incidents are
// this repository's open issues labelled "status", as Upptime opens them. Nothing else is loaded, nothing is sent.
(function () {
  "use strict";
  var SUMMARY = "https://raw.githubusercontent.com/Sudoo-sh/status-page/master/history/summary.json";
  var INCIDENTS = "https://api.github.com/repos/Sudoo-sh/status-page/issues?state=open&labels=status&per_page=10";
  var REFRESH = 60 * 1000;
  // a response slower than this is shown as "slow" (Upptime's own threshold for "degraded" is per check)
  var SLOW_MS = 2000;

  var root = document.documentElement;
  var words = {
    en: { up: "Operational", down: "Down", degraded: "Slow", checking: "Checking", ms: " ms", opened: "Opened " },
    ar: { up: "تعمل", down: "متوقفة", degraded: "بطيئة", checking: "جارٍ التحقق", ms: " م.ث", opened: "فُتحت " },
  };
  var lang = function () {
    return root.lang === "ar" ? "ar" : "en";
  };
  var number = function (value, digits) {
    return new Intl.NumberFormat(lang() === "ar" ? "ar-EG" : "en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  };

  var summary = null;
  var incidents = [];

  function stateOf(site) {
    if (site.status === "down") return "down";
    if (site.status === "degraded" || site.time > SLOW_MS) return "degraded";
    return "up";
  }

  function draw() {
    var w = words[lang()];
    var overall = "checking";
    if (summary === false) overall = "unknown";
    else if (summary) {
      overall = "up";
      summary.forEach(function (site) {
        var state = stateOf(site);
        if (state === "down") overall = "down";
        else if (state === "degraded" && overall !== "down") overall = "degraded";
        var row = document.querySelector('.service[data-slug="' + site.slug + '"]');
        if (!row) return;
        row.setAttribute("data-state", state);
        row.querySelector('[data-field="state"]').textContent = w[state];
        var uptime = parseFloat(String(site.uptimeMonth || site.uptime).replace("%", ""));
        row.querySelector('[data-field="uptime"]').textContent = isNaN(uptime) ? "—" : number(uptime, 2) + "%";
        var time = site.timeWeek || site.time;
        row.querySelector('[data-field="time"]').textContent = time ? number(time, 0) + w.ms : "—";
      });
    }
    document.querySelector("[data-overall]").setAttribute("data-overall", overall);

    var box = document.querySelector(".incidents");
    var list = document.querySelector("[data-incidents]");
    list.textContent = "";
    incidents.forEach(function (issue) {
      var item = document.createElement("li");
      var link = document.createElement("a");
      link.href = issue.html_url;
      link.textContent = issue.title;
      var when = document.createElement("span");
      when.className = "faint";
      when.textContent =
        w.opened +
        new Intl.DateTimeFormat(lang() === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(issue.created_at),
        );
      item.appendChild(link);
      item.appendChild(when);
      list.appendChild(item);
    });
    box.hidden = incidents.length === 0;
  }

  function load() {
    fetch(SUMMARY, { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(function (data) {
        summary = Array.isArray(data) ? data : false;
      })
      .catch(function () {
        if (!summary) summary = false;
      })
      .then(draw);
    fetch(INCIDENTS, { headers: { Accept: "application/vnd.github+json" } })
      .then(function (response) {
        return response.ok ? response.json() : [];
      })
      .then(function (data) {
        incidents = Array.isArray(data)
          ? data.filter(function (issue) {
              return !issue.pull_request;
            })
          : [];
      })
      .catch(function () {
        /* GitHub's API limits unauthenticated reads; the list stays as it was */
      })
      .then(draw);
  }

  var button = document.querySelector("[data-switch-language]");
  button.setAttribute("data-ready", ""); // shown once it can work (its room is kept before)
  button.addEventListener("click", function () {
    var next = lang() === "ar" ? "en" : "ar";
    root.lang = next;
    root.dir = next === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem("sudoo.status.lang", next);
    } catch (e) {
      /* storage blocked: this visit only */
    }
    draw();
  });

  load();
  setInterval(load, REFRESH);
})();
