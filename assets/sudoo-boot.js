// Before the first paint: the page's language and direction, and the light or dark theme, so an Arabic page never
// flashes left to right and a dark choice never flashes light. The language is the one chosen here before
// (localStorage), else the sudoo_lang cookie every sudoo.sh site shares, else the browser's; the theme is the shared
// sudoo_theme cookie (light, dark or system). An external file: the page's Content-Security-Policy allows no inline script.
(function () {
  var root = document.documentElement;
  var lang = null;
  try {
    lang = localStorage.getItem("sudoo.status.lang");
  } catch (e) {
    /* storage blocked */
  }
  if (lang !== "en" && lang !== "ar") {
    var cookie = /(?:^|;\s*)sudoo_lang=(en|ar)(?:;|$)/.exec(document.cookie);
    lang = cookie ? cookie[1] : null;
  }
  if (!lang) {
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
    for (var i = 0; i < list.length && !lang; i++) {
      var primary = String(list[i]).toLowerCase().split("-")[0];
      if (primary === "en" || primary === "ar") lang = primary;
    }
  }
  lang = lang || "en";
  root.lang = lang;
  root.dir = lang === "ar" ? "rtl" : "ltr";
  var theme = /(?:^|;\s*)sudoo_theme=(light|dark)(?:;|$)/.exec(document.cookie);
  if (theme) root.setAttribute("data-theme", theme[1]);
})();
