// Runs before first paint: language, direction and theme, so an Arabic page never flashes left to right
// and a dark choice never flashes light. External file because the Content-Security-Policy has no inline script.
// Order: the saved choice (localStorage), then the sudoo_lang / sudoo_theme cookie shared with sudoo.sh, then the
// browser's languages; English and the system theme otherwise. Plain ES5 so it runs on any browser before app.js.
(function () {
  var root = document.documentElement;
  var lang = null;
  try { lang = localStorage.getItem("sudoo.status.lang"); } catch (e) { /* storage blocked */ }
  if (lang !== "en" && lang !== "ar") {
    var c = /(?:^|;\s*)sudoo_lang=(en|ar)(?:;|$)/.exec(document.cookie);
    lang = c ? c[1] : null;
  }
  if (!lang) {
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
    for (var i = 0; i < list.length && !lang; i++) {
      var p = String(list[i]).toLowerCase().split("-")[0];
      if (p === "en" || p === "ar") lang = p;
    }
  }
  lang = lang || "en";
  root.lang = lang;
  root.dir = lang === "ar" ? "rtl" : "ltr";
  var theme = null;
  try { theme = localStorage.getItem("sudoo.status.theme"); } catch (e) { /* storage blocked */ }
  if (theme !== "light" && theme !== "dark") {
    var m = /(?:^|;\s*)sudoo_theme=(light|dark)(?:;|$)/.exec(document.cookie);
    theme = m ? m[1] : null;
  }
  if (theme) root.setAttribute("data-theme", theme);
})();
