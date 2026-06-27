// Apply the saved theme before first paint to avoid a flash. Defaults to dark
// when nothing is stored. Kept as an external file (not inline) so the panel can
// ship a strict Content-Security-Policy with no `script-src 'unsafe-inline'`.
(function () {
  var t = "dark";
  try {
    var s = localStorage.getItem("cct.panel.theme");
    if (s === "light" || s === "dark" || s === "matrix") t = s;
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", t);
})();
