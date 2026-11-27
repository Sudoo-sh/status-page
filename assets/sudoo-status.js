// status.sudoo.sh: fills the page (assets/index.html) with the figures the checks commit to this repository.
// history/summary.json is the latest summary (state, uptime, response time, minutes down per day); history/<slug>.yml
// gives the moment each service was first checked, so days before it are shown as "not yet checked" rather than as
// days without downtime. Open incidents are this repository's open issues labelled "status". All of it is read from
// the two hosts the Content-Security-Policy allows; nothing else is loaded and nothing is sent.
(function () {
  "use strict";
  var HISTORY = "https://raw.githubusercontent.com/Sudoo-sh/status-page/master/history/";
  var INCIDENTS = "https://api.github.com/repos/Sudoo-sh/status-page/issues?state=open&labels=status&per_page=10";
  var REFRESH = 60 * 1000;
  // the issues API allows 60 unauthenticated reads an hour per visitor: read it every fifth refresh
  var INCIDENTS_EVERY = 5;
  // a response slower than this is shown as "slow"
  var SLOW_MS = 2000;
  var DAYS = 30;

  var root = document.documentElement;
  var words = {
    en: {
      up: "Working",
      degraded: "Slow",
      down: "Down",
      checking: "Checking",
      title: "Sudoo.sh status",
      working: function (n, total) {
        return n + " of " + total + " working";
      },
      countDown: function (n) {
        return n + " down";
      },
      countSlow: function (n) {
        return n + " slow";
      },
      retry: "Reload the page to try again.",
      updated: function (time) {
        return "Updated " + time + ". The figures refresh every minute.";
      },
      uptime: function (value) {
        return value + " uptime";
      },
      response: "Average response, last 7 days: ",
      dayOk: "no downtime recorded",
      dayDown: function (text) {
        return text + " down";
      },
      dayNone: "not yet checked",
      span: function (h, m) {
        var parts = [];
        if (h) parts.push(number(h, 0) + " h");
        if (m || !h) parts.push(number(m, 0) + " min");
        return parts.join(" ");
      },
      daysLabel: function (n) {
        return n === 0
          ? "Last 30 days: no downtime recorded"
          : "Last 30 days: downtime on " + n + (n === 1 ? " day" : " days");
      },
      opened: "Opened ",
      openIncidents: function (n) {
        return n + (n === 1 ? " open incident" : " open incidents");
      },
      noIncidents: "No open incidents.",
      toDark: "Dark theme",
      locale: "en-GB",
      ms: " ms",
    },
    ar: {
      up: "تعمل",
      degraded: "بطيئة",
      down: "متوقفة",
      checking: "جارٍ التحقق",
      title: "حالة Sudoo.sh",
      working: function (n, total) {
        return "تعمل " + n + " من " + total;
      },
      countDown: function (n) {
        return "متوقفة: " + n;
      },
      countSlow: function (n) {
        return "بطيئة: " + n;
      },
      retry: "أعد تحميل الصفحة للمحاولة مجددًا.",
      updated: function (time) {
        return "آخر تحديث " + time + ". تتحدث الأرقام كل دقيقة.";
      },
      uptime: function (value) {
        return "التوفر " + value;
      },
      response: "متوسط الاستجابة خلال آخر 7 أيام: ",
      dayOk: "لا توقف مسجّل",
      dayDown: function (text) {
        return "توقف " + text;
      },
      dayNone: "قبل بدء التحقق",
      span: function (h, m) {
        var parts = [];
        if (h) parts.push(number(h, 0) + " س");
        if (m || !h) parts.push(number(m, 0) + " د");
        return parts.join(" ");
      },
      daysLabel: function (n) {
        return n === 0 ? "آخر 30 يومًا: لا توقف مسجّل" : "آخر 30 يومًا: أيام فيها توقف: " + n;
      },
      opened: "فُتحت ",
      openIncidents: function (n) {
        return "حوادث مفتوحة: " + n;
      },
      noIncidents: "لا حوادث مفتوحة.",
      toDark: "المظهر الداكن",
      // Arabic words with the same digits as the rest of the page (and sudoo.sh)
      locale: "ar-u-nu-latn",
      ms: " م.ث",
    },
  };
  var lang = function () {
    return root.lang === "ar" ? "ar" : "en";
  };
  var w = function () {
    return words[lang()];
  };
  // Intl formatters are slow to create: one per language and kind, kept
  var formatters = {};
  var formatter = function (kind, options) {
    var key = lang() + kind;
    if (!formatters[key]) {
      formatters[key] =
        kind.charAt(0) === "n" ? new Intl.NumberFormat(w().locale, options) : new Intl.DateTimeFormat(w().locale, options);
    }
    return formatters[key];
  };
  var number = function (value, digits) {
    return formatter("n" + digits, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  };
  var percent = function (value) {
    return formatter("n%", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100);
  };
  // withTime: the visitor's local time; utc: a day as the checks key it (UTC); neither: the visitor's local date
  var dateText = function (date, withTime, utc) {
    var options = withTime ? { timeStyle: "short" } : { dateStyle: "medium" };
    if (utc) options.timeZone = "UTC";
    return formatter("d" + (withTime ? "t" : "") + (utc ? "u" : ""), options).format(date);
  };

  var summary = null; // null: not loaded yet, false: could not be loaded
  var since = {}; // slug -> "YYYY-MM-DD" of the first check
  var incidents = null; // null: not loaded
  var loadedAt = null;
  var rounds = 0;

  function stateOf(site) {
    if (site.status === "down") return "down";
    if (site.status === "degraded" || site.time > SLOW_MS) return "degraded";
    return "up";
  }

  // the last DAYS days in UTC, the days the summary's dailyMinutesDown is keyed by, oldest first
  function lastDays() {
    var list = [];
    var now = Date.now();
    for (var i = DAYS - 1; i >= 0; i--) list.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
    return list;
  }

  // the words of one day, for its tooltip
  function dayTitle(day, kind, minutes) {
    var t = w();
    var text = kind === "none" ? t.dayNone : kind === "ok" ? t.dayOk : t.dayDown(t.span(Math.floor(minutes / 60), minutes % 60));
    return dateText(new Date(day + "T12:00:00Z"), false, true) + ": " + text;
  }

  function drawDays(box, site) {
    var down = site.dailyMinutesDown || {};
    var first = since[site.slug];
    var count = 0;
    var fragment = document.createDocumentFragment();
    lastDays().forEach(function (day) {
      var bar = document.createElement("span");
      var minutes = down[day] || 0;
      var kind;
      if (minutes > 0) {
        count++;
        kind = minutes >= 60 ? "major" : "minor";
      } else kind = !first || day < first ? "none" : "ok";
      bar.className = "day";
      bar.setAttribute("data-day", kind);
      bar.setAttribute("data-date", day);
      if (minutes) bar.setAttribute("data-minutes", String(minutes));
      fragment.appendChild(bar);
    });
    box.textContent = "";
    box.appendChild(fragment);
    box.setAttribute("aria-label", w().daysLabel(count));
  }

  // tooltips are written when a day is first pointed at: three hundred dates formatted up front slow the first paint
  document.addEventListener("pointerover", function (event) {
    var bar = event.target;
    if (!bar.classList || !bar.classList.contains("day") || !bar.hasAttribute("data-date")) return;
    bar.title = dayTitle(
      bar.getAttribute("data-date"),
      bar.getAttribute("data-day"),
      Number(bar.getAttribute("data-minutes") || 0),
    );
  });

  function draw() {
    var t = w();
    document.title = t.title;
    var overall = "checking";
    var counts = { up: 0, degraded: 0, down: 0 };
    if (summary === false) overall = "unknown";
    else if (summary) {
      summary.forEach(function (site) {
        var state = stateOf(site);
        counts[state]++;
        var row = document.querySelector('.service[data-slug="' + site.slug + '"]');
        if (!row) return;
        row.setAttribute("data-tone", state);
        row.querySelector('[data-field="state"]').textContent = t[state];
        var uptime = parseFloat(String(site.uptimeMonth || site.uptime).replace("%", ""));
        row.querySelector('[data-field="uptime"]').textContent = isNaN(uptime) ? "" : t.uptime(percent(uptime));
        var time = site.timeWeek || site.time;
        var cell = row.querySelector('[data-field="time"]');
        cell.textContent = "";
        if (time) {
          var label = document.createElement("span");
          label.className = "sr";
          label.textContent = t.response;
          cell.appendChild(label);
          cell.appendChild(document.createTextNode(number(time, 0) + t.ms));
          cell.title = t.response.replace(/: $/, "");
        }
        drawDays(row.querySelector('[data-field="days"]'), site);
      });
      overall = counts.down ? "down" : counts.degraded ? "degraded" : "up";
    }

    var card = document.querySelector("[data-overall]");
    card.setAttribute("data-overall", overall);
    card.setAttribute("data-tone", overall);
    var detail = document.querySelector("[data-overall-detail]");
    if (summary) {
      var total = summary.length;
      var parts = [t.working(number(counts.up, 0), number(total, 0))];
      if (counts.down) parts.push(t.countDown(number(counts.down, 0)));
      if (counts.degraded) parts.push(t.countSlow(number(counts.degraded, 0)));
      detail.textContent = parts.join(" · ");
      if (incidents && incidents.length) {
        var jump = document.createElement("a");
        jump.href = "#incidents";
        jump.textContent = t.openIncidents(number(incidents.length, 0));
        detail.appendChild(document.createTextNode(" · "));
        detail.appendChild(jump);
      }
    } else detail.textContent = summary === false ? t.retry : " ";

    if (loadedAt) document.querySelector("[data-updated]").textContent = t.updated(dateText(loadedAt, true));

    var box = document.querySelector(".incidents");
    var list = document.querySelector("[data-incidents]");
    list.textContent = "";
    (incidents || []).forEach(function (issue) {
      var item = document.createElement("li");
      var link = document.createElement("a");
      link.href = issue.html_url;
      // the checks open issues titled with a status emoji first; the words are enough here
      link.textContent = String(issue.title).replace(/^[^\p{L}\p{N}]+/u, "");
      var when = document.createElement("span");
      when.className = "when";
      when.textContent = t.opened + dateText(new Date(issue.created_at)) + ", " + dateText(new Date(issue.created_at), true);
      item.appendChild(link);
      item.appendChild(when);
      list.appendChild(item);
    });
    // shown only when there is something to show: an empty list says nothing a working summary does not
    box.hidden = !incidents || incidents.length === 0;
  }

  function getJson(url, options) {
    return fetch(url, options).then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    });
  }

  // each service's first check, read once: "startTime: 2026-11-21T11:09:51.010Z" in history/<slug>.yml
  function loadSince() {
    var rows = document.querySelectorAll(".service[data-slug]");
    return Promise.all(
      Array.prototype.map.call(rows, function (row) {
        var slug = row.getAttribute("data-slug");
        return fetch(HISTORY + encodeURIComponent(slug) + ".yml")
          .then(function (response) {
            return response.ok ? response.text() : "";
          })
          .then(function (text) {
            var found = /^startTime:\s*(\d{4}-\d{2}-\d{2})T/m.exec(text);
            if (found) since[slug] = found[1];
          })
          .catch(function () {
            /* left unknown: its days show as not yet checked */
          });
      }),
    );
  }

  function load() {
    var incidentsRead = null;
    if (rounds++ % INCIDENTS_EVERY === 0)
      incidentsRead = getJson(INCIDENTS, { headers: { Accept: "application/vnd.github+json" } })
        .then(function (data) {
          incidents = Array.isArray(data)
            ? data.filter(function (issue) {
                return !issue.pull_request;
              })
            : incidents;
        })
        .catch(function () {
          /* rate limited or offline: the list stays as it was */
        });
    var summaryRead = getJson(HISTORY + "summary.json", { cache: "no-cache" })
      .then(function (data) {
        summary = Array.isArray(data) ? data : false;
        if (summary) loadedAt = new Date();
      })
      .catch(function () {
        if (!summary) summary = false;
      });
    // drawn once everything of this round is in, so nothing changes size or colour after it is shown
    Promise.all([summaryRead, incidentsRead, firstChecks]).then(draw);
  }

  // ---------- language ----------
  var language = document.querySelector("[data-switch-language]");
  language.addEventListener("click", function () {
    var next = lang() === "ar" ? "en" : "ar";
    root.lang = next;
    root.dir = next === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem("sudoo.status.lang", next);
    } catch (e) {
      /* storage blocked: this visit only */
    }
    syncTheme();
    draw();
  });
  language.setAttribute("data-ready", "");

  // ---------- theme: the sudoo_theme cookie every sudoo.sh site shares (sudoo-website src/scripts/theme.js) ----------
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  var themeButton = document.querySelector("[data-theme-toggle]");
  function readTheme() {
    var found = /(?:^|;\s*)sudoo_theme=(light|dark|system)/.exec(document.cookie);
    return found ? found[1] : null;
  }
  function writeTheme(theme) {
    var host = location.hostname;
    var domain = host === "sudoo.sh" || /\.sudoo\.sh$/.test(host) ? "; Domain=.sudoo.sh" : "";
    var secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = "sudoo_theme=" + theme + "; Path=/; Max-Age=31536000; SameSite=Lax" + domain + secure;
  }
  function applyTheme() {
    var theme = readTheme();
    if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
    else root.removeAttribute("data-theme");
  }
  function currentTheme() {
    var set = root.getAttribute("data-theme");
    return set === "light" || set === "dark" ? set : systemDark.matches ? "dark" : "light";
  }
  function syncTheme() {
    themeButton.setAttribute("aria-checked", String(currentTheme() === "dark"));
    themeButton.setAttribute("aria-label", w().toDark);
    themeButton.title = w().toDark;
  }
  themeButton.addEventListener("click", function () {
    var next = currentTheme() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    writeTheme(next);
    syncTheme();
  });
  if (systemDark.addEventListener) systemDark.addEventListener("change", syncTheme);
  // changed on another sudoo.sh site or tab: follow it when this page is shown again
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      applyTheme();
      syncTheme();
    }
  });
  syncTheme();
  themeButton.setAttribute("data-ready", "");

  var firstChecks = loadSince();
  load();
  setInterval(load, REFRESH);
})();
