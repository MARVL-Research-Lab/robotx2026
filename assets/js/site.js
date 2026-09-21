/* Navigation, site search, the embedded simulator and the page index.
   Everything here is progressive: the pages read and navigate with
   JavaScript switched off, and the search page falls back to its own form. */
(function () {
  "use strict";

  // --------------------------------------------------------------- nav --
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  // ------------------------------------------------------------ search --
  var index = null;
  var loading = null;

  function loadIndex() {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = fetch(base() + "assets/search-index.json")
        .then(function (r) { return r.json(); })
        .then(function (data) { index = data; return data; });
    }
    return loading;
  }

  function base() {
    // Every page of this site sits at the root, so links in results and the
    // index itself are plain relative paths.
    return "";
  }

  function score(entry, terms) {
    var title = entry.t.toLowerCase();
    var section = (entry.s || "").toLowerCase();
    var text = entry.x.toLowerCase();
    var total = 0;
    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      var hits = text.split(term).length - 1;
      if (title.indexOf(term) >= 0) total += 12;
      if (section.indexOf(term) >= 0) total += 6;
      if (hits === 0 && title.indexOf(term) < 0 && section.indexOf(term) < 0) return 0;
      total += Math.min(hits, 6);
    }
    return total;
  }

  function snippet(entry, terms) {
    var text = entry.x;
    var at = text.toLowerCase().indexOf(terms[0]);
    if (at < 0) at = 0;
    var from = Math.max(0, at - 60);
    var cut = text.slice(from, from + 190);
    if (from > 0) cut = "…" + cut;
    if (from + 190 < text.length) cut = cut + "…";
    return cut;
  }

  function search(query) {
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length || !index) return [];
    return index
      .map(function (entry) { return { entry: entry, score: score(entry, terms) }; })
      .filter(function (hit) { return hit.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 12)
      .map(function (hit) { return { entry: hit.entry, snippet: snippet(hit.entry, terms) }; });
  }

  function render(list, into, query) {
    into.innerHTML = "";
    if (!list.length) {
      var empty = document.createElement("li");
      empty.className = "search-empty";
      empty.textContent = query ? "Nothing matches “" + query + "”. Try a vehicle name, a task number or a handbook section." : "";
      into.appendChild(empty);
      return;
    }
    list.forEach(function (hit) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = base() + hit.entry.u;
      a.innerHTML =
        "<strong>" + escapeHtml(hit.entry.t) + "</strong>" +
        "<span class=\"where\">" + escapeHtml(hit.entry.s || "") + "</span>" +
        "<span class=\"snippet\">" + escapeHtml(hit.snippet) + "</span>";
      li.appendChild(a);
      into.appendChild(li);
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }

  var dialog = document.getElementById("search-dialog");
  var opener = document.querySelector(".search-open");
  if (dialog && opener && typeof dialog.showModal === "function") {
    var field = dialog.querySelector("input");
    var results = dialog.querySelector(".results");
    var timer = null;

    opener.addEventListener("click", function () {
      loadIndex().then(function () { run(); });
      dialog.showModal();
      field.focus();
      field.select();
    });

    document.addEventListener("keydown", function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        opener.click();
      }
    });

    function run() {
      render(search(field.value), results, field.value.trim());
    }

    field.addEventListener("input", function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { loadIndex().then(run); }, 90);
    });

    dialog.querySelector("form").addEventListener("submit", function (event) {
      event.preventDefault();
      var first = results.querySelector("a");
      if (first) window.location.href = first.getAttribute("href");
    });
  }

  // the standalone search page
  var page = document.getElementById("search-page");
  if (page) {
    var pageField = page.querySelector("input");
    var pageResults = page.querySelector(".results");
    var initial = new URLSearchParams(window.location.search).get("q") || "";
    pageField.value = initial;
    var runPage = function () {
      loadIndex().then(function () {
        render(search(pageField.value), pageResults, pageField.value.trim());
      });
    };
    pageField.addEventListener("input", runPage);
    page.querySelector("form").addEventListener("submit", function (event) { event.preventDefault(); runPage(); });
    if (initial) runPage();
    pageField.focus();
  }

  // --------------------------------------------------------- simulator --
  document.querySelectorAll("[data-sim]").forEach(function (frame) {
    var button = frame.querySelector(".sim-start");
    if (!button) return;
    button.addEventListener("click", function () {
      var iframe = document.createElement("iframe");
      iframe.src = frame.getAttribute("data-sim");
      iframe.title = frame.getAttribute("data-sim-title") || "Course simulator";
      iframe.allow = "fullscreen";
      frame.innerHTML = "";
      frame.appendChild(iframe);
    });
  });

  // ------------------------------------------------------- page index ---
  var marks = document.querySelectorAll(".soundings a");
  if (marks.length && "IntersectionObserver" in window) {
    var byId = {};
    marks.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var link = byId[entry.target.id];
        if (!link) return;
        if (entry.isIntersecting) {
          marks.forEach(function (a) { a.classList.remove("current"); });
          link.classList.add("current");
        }
      });
    }, { rootMargin: "-80px 0px -70% 0px" });
    Object.keys(byId).forEach(function (id) {
      var section = document.getElementById(id);
      if (section) observer.observe(section);
    });
  }

  // --------------------------------------------------- motion, video ----
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll("video[autoplay]").forEach(function (video) {
      video.removeAttribute("autoplay");
      video.pause();
    });
  }
})();
