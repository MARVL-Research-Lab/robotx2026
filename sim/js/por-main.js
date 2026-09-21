/* por-main.js: wiring for the proof of readiness page.
 *
 * Left panel: which submission is being rehearsed, the run controls, and the
 * criteria the rehearsal is judging right now. Right panel: every requirement
 * in handbook 3.1, ticked off by the rehearsal where it can be and by a person
 * where it cannot, plus the report that comes out of both.
 */
"use strict";

(async function () {
  const cfg = await (await fetch("./api/readiness.json")).json();
  const canvas = document.getElementById("scene");
  World.init(canvas, cfg, { mode: "readiness" });
  const state = PorSim.init(cfg);

  const el = id => document.getElementById(id);
  const keys = new Set();
  const CAMS = ["orbit", "free", "chase", "top"];
  const POVS = ["", "usv", "uav", "uuv"];
  const RUNS = ["USV", "UUV", "UAV", "COMMS"];
  const STORE_KEY = "rx-por-evidence-v1";
  let camIdx = 0, povIdx = 0;

  Cameras.bindKeys(keys);
  /* Third person, framed for this site. The competition course defaults put
   * the eye 14 m behind a boat crossing a bay; here the whole USV course is
   * 15 m long, and at that range the vehicle the video is about is a speck.
   * The lead offsets look past the vehicle at the gate it is coming up on.
   */
  Cameras.setChase("usv", { radius: 8.5, beta: 1.16, height: 0.9, lead: 2.0 });
  Cameras.setChase("uuv", { radius: 4.2, beta: 1.32, height: 0.15, lead: 1.4 });
  Cameras.setChase("uav", { radius: 9.0, beta: 1.12, height: 0.6, lead: 1.5 });

  const RUN_TEXT = {
    USV: "3.1.2: a fully autonomous run starting 3 m behind the gate and through "
       + "both sets of gates without striking a buoy, then the visual feedback "
       + "system and both kill switches.",
    UUV: "3.1.3: start 3 m behind the gate, submerge, pass under the gate, circle "
       + "the marker 10 m beyond it and come back through, without ever breaching.",
    UAV: "3.1.4: manual and then autonomous, each with mode proof, a takeoff above "
       + "3 m AGL, the published pattern, the geofence and the ceiling holding when "
       + "commanded past them, and a landing. Then a controller link loss.",
    COMMS: "3.1.5: the run start sequence of 3.4.10 with at least two vehicles in "
         + "the declaration. The submission wants the rc-test log, so run rc-check "
         + "against a real broker for the file itself.",
  };

  const KIND_LABEL = {
    rule: "rule", demo: "on camera", video: "on camera",
    upload: "file upload", document: "document", log: "log file",
  };

  // The team's own record of what it has in hand, per requirement.
  let evidence = {};
  try {
    evidence = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
  } catch (err) { void err; }

  function saveEvidence() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(evidence)); } catch (err) { void err; }
  }

  // Artifacts already sitting in the submission directory, found by the
  // server. A finished one outranks the checkbox: the page reports what the
  // submission holds, not what somebody remembered to tick.
  const onDisk = (cfg.submission && cfg.submission.files) || {};
  Object.keys(onDisk).forEach(id => { if (onDisk[id].held) evidence[id] = true; });

  const byId = {};
  cfg.requirements.forEach(r => { byId[r.id] = r; });
  const criteriaById = {};
  cfg.criteria.forEach(c => { criteriaById[c.id] = c; });

  // ---------------------------------------------------------- checklist --
  function requirementStatus(r) {
    const found = onDisk[r.id];
    if (r.criteria.length) {
      const marks = r.criteria.map(c => state.results[c]).filter(Boolean);
      // A real rc-test log outranks a rehearsal that has not been run.
      if (!marks.length) {
        return found && found.held
          ? { cls: "pass", text: "on file" }
          : { cls: "todo", text: "not rehearsed" };
      }
      if (marks.some(m => !m.passed)) return { cls: "fail", text: "FAIL" };
      if (marks.length < r.criteria.length) return { cls: "part", text: "part way" };
      return { cls: "pass", text: "rehearsed" };
    }
    return evidence[r.id]
      ? { cls: "pass", text: "held" }
      : { cls: "todo", text: "to produce" };
  }

  function buildChecklist() {
    const groups = {};
    cfg.requirements.forEach(r => {
      (groups[r.domain] = groups[r.domain] || []).push(r);
    });
    const root = el("requirements");
    root.innerHTML = "";
    Object.entries(groups).forEach(([domain, items]) => {
      const h = document.createElement("h3");
      h.textContent = domain === "ALL" ? "Every submission (3.1.1)" : domain;
      root.appendChild(h);
      const list = document.createElement("ul");
      list.className = "reqs";
      items.forEach(r => {
        const li = document.createElement("li");
        li.dataset.req = r.id;
        li.dataset.rehearsable = r.criteria.length ? "yes" : "no";
        const head = document.createElement("div");
        head.className = "req-head";
        const found = onDisk[r.id];
        const fromDisk = Boolean(found && found.held);
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = Boolean(evidence[r.id]);
        box.disabled = r.criteria.length > 0 || fromDisk;
        box.title = r.criteria.length
          ? "The rehearsal decides this one"
          : fromDisk
            ? `Found in ${cfg.submission.dir}`
            : "Tick when the team has this evidence";
        box.onchange = () => {
          evidence[r.id] = box.checked;
          saveEvidence();
          refreshChecklist();
        };
        const title = document.createElement("span");
        title.className = "req-title";
        title.textContent = r.title;
        const status = document.createElement("b");
        status.className = "req-status";
        head.appendChild(box);
        head.appendChild(title);
        head.appendChild(status);
        const detail = document.createElement("span");
        detail.className = "req-detail";
        detail.textContent = r.detail;
        const meta = document.createElement("span");
        meta.className = "req-meta";
        meta.textContent = `${r.section} - ${KIND_LABEL[r.kind] || r.kind}`;
        li.appendChild(head);
        li.appendChild(detail);
        li.appendChild(meta);
        if (found) {
          const artifact = document.createElement("span");
          artifact.className = "req-artifact" + (found.held ? " held" : "");
          artifact.textContent = `${cfg.submission.dir}/${found.file} - ${found.detail}`;
          li.appendChild(artifact);
        }
        list.appendChild(li);
      });
      root.appendChild(list);
    });
    refreshChecklist();
  }

  let filter = "all";

  function refreshChecklist() {
    let accounted = 0;
    cfg.requirements.forEach(r => {
      const li = document.querySelector(`#requirements li[data-req="${r.id}"]`);
      if (!li) return;
      const status = requirementStatus(r);
      li.className = status.cls;
      li.querySelector(".req-status").textContent = status.text;
      if (status.cls === "pass") accounted += 1;
      const show =
        filter === "all"
        || (filter === "rehearsable" && r.criteria.length)
        || (filter === "artifact" && !r.criteria.length)
        || (filter === "open" && status.cls !== "pass");
      li.style.display = show ? "" : "none";
    });
    const summary = el("por-summary");
    summary.textContent = `${accounted} of ${cfg.requirements.length} accounted for`;
    summary.className = accounted === cfg.requirements.length
      ? "pill pill-live" : "pill pill-sim";
  }

  // ----------------------------------------------------------- criteria --
  function buildCriteria() {
    const list = el("criteria");
    list.innerHTML = "";
    cfg.criteria
      .filter(c => c.domain === state.domain)
      .forEach(c => {
        const li = document.createElement("li");
        li.dataset.criterion = c.id;
        li.innerHTML = `<span class="crit-mark">-</span>`
          + `<span class="crit-body"><b>${c.label}</b>`
          + `<span class="crit-rule">${c.rule}</span></span>`;
        list.appendChild(li);
      });
    refreshCriteria();
  }

  function refreshCriteria() {
    document.querySelectorAll("#criteria li").forEach(li => {
      const result = state.results[li.dataset.criterion];
      const mark = li.querySelector(".crit-mark");
      const rule = li.querySelector(".crit-rule");
      const base = criteriaById[li.dataset.criterion];
      if (!result) {
        li.className = "";
        mark.textContent = "-";
        rule.textContent = base.rule;
        return;
      }
      li.className = result.passed ? "pass" : "fail";
      mark.textContent = result.passed ? "PASS" : "FAIL";
      rule.textContent = result.detail || base.rule;
    });
  }

  // -------------------------------------------------------------- panels --
  function pushEvent(text) {
    const li = document.createElement("li");
    const mm = String(Math.floor(state.t / 60)).padStart(2, "0");
    const ss = String(Math.floor(state.t % 60)).padStart(2, "0");
    li.textContent = `${mm}:${ss}  ${text}`;
    const list = el("log");
    list.prepend(li);
    while (list.children.length > 40) list.lastChild.remove();
  }

  /* The same numbers the scene is drawing, in text.
   *
   * A viewer watching the run reads the callouts on the water; an operator
   * setting the run up wants the figure to two decimals, and wants it for the
   * vehicle whether or not the camera is pointed at it.
   */
  const VEHICLE_LABEL = { usv: "USV1 BlueBoat", uuv: "UUV1 BlueROV2", uav: "UAV1 Quadcopter" };
  const LEAD = { USV: "usv", UUV: "uuv", UAV: "uav" };

  function bearing(heading) {
    // +z is north on all three courses, so a heading of PI/2 is 000
    const deg = (450 - (heading * 180) / Math.PI) % 360;
    return String(Math.round(deg)).padStart(3, "0");
  }

  function nearestHazard(id) {
    if (id === "usv") {
      const v = state.vehicles.usv;
      let best = Infinity;
      (Por.parts.usv.buoys || []).forEach(b => {
        best = Math.min(best, Math.hypot(v.x - b.x, v.z - b.z) - b.radius - 0.6);
      });
      return Number.isFinite(best) ? `${best.toFixed(2)} m` : "-";
    }
    if (id === "uuv") {
      // live, not the run minimum: the criteria panel carries the minimum,
      // and a panel reading that never improves is not telemetry
      const v = state.vehicles.uuv;
      const parts = (Por.parts.uuv.legs || []).concat(
        Por.parts.uuv.marker ? [Por.parts.uuv.marker] : []);
      let best = Infinity;
      parts.forEach(o => {
        best = Math.min(best, Math.hypot(v.x - o.x, v.z - o.z) - (o.radius || 0.2) - 0.35);
      });
      return Number.isFinite(best) ? `${best.toFixed(2)} m` : "-";
    }
    const v = state.vehicles.uav;
    const [ox, oz] = cfg.layout.uav.origin;
    const margin = cfg.courses.uav.geofence_radius_m - Math.hypot(v.x - ox, v.z - oz);
    return `${margin.toFixed(1)} m inside`;
  }

  function refreshHud() {
    const id = LEAD[state.domain];
    const total = state.stepTotal || 0;
    const done = total ? Math.min(1, state.stepIndex / total) : 0;
    el("progress-bar").style.width = `${(state.step === "COMPLETE" ? 1 : done) * 100}%`;
    const VERT_LABEL = { usv: "Off the course line", uuv: "Depth", uav: "Altitude" };
    const CLEAR_LABEL = { usv: "Nearest buoy", uuv: "Nearest structure",
                          uav: "Geofence margin" };
    el("hud-vert-label").textContent = VERT_LABEL[id] || "Altitude";
    el("hud-clear-label").textContent = CLEAR_LABEL[id] || "Nearest hazard";
    if (!id) {
      ["hud-vehicle", "hud-mode", "hud-speed", "hud-heading", "hud-vert", "hud-clear",
       "hud-range"].forEach(key => { el(key).textContent = "-"; });
      el("hud-vehicle").textContent = "OCS to RoboCommand";
      return;
    }
    const v = state.vehicles[id];
    el("hud-vehicle").textContent = VEHICLE_LABEL[id];
    el("hud-mode").textContent = v.mode;
    el("hud-speed").textContent = `${Math.abs(v.speed).toFixed(2)} m/s`;
    el("hud-heading").textContent = bearing(v.heading);
    if (id === "uav") {
      el("hud-vert").textContent = `${v.y.toFixed(1)} m AGL`;
    } else if (id === "uuv") {
      el("hud-vert").textContent = `${Math.abs(Math.min(0, v.y)).toFixed(2)} m`;
    } else {
      // a surface craft has no depth; what its criteria measure is how far
      // off the line through the gates it is
      const line = cfg.layout.usv.origin[0];
      el("hud-vert").textContent = `${Math.abs(v.x - line).toFixed(2)} m`;
    }
    el("hud-clear").textContent = nearestHazard(id);
    el("hud-range").textContent = v.target
      ? `${Math.hypot(v.target.x - v.x, v.target.z - v.z).toFixed(1)} m`
      : "-";
  }

  function refreshHeader() {
    const mm = String(Math.floor(state.t / 60)).padStart(2, "0");
    const ss = String(Math.floor(state.t % 60)).padStart(2, "0");
    el("clock").textContent = `${mm}:${ss}`;
    el("step").textContent = state.step;
    const pill = el("run-state");
    if (state.step === "COMPLETE") {
      const failed = Object.entries(state.results)
        .filter(([id, r]) => id.startsWith(state.domain.toLowerCase() + ".") && !r.passed);
      pill.textContent = failed.length ? `${failed.length} FAILED` : "PASS";
      pill.className = failed.length ? "pill pill-dead" : "pill pill-run";
    } else if (state.running) {
      pill.textContent = `${state.domain} RUNNING`;
      pill.className = "pill pill-hold";
    } else {
      pill.textContent = "READY";
      pill.className = "pill pill-idle";
    }
    el("btn-play").textContent = state.running ? "Pause" : "Start";
  }

  function setRun(domain) {
    PorSim.setRun(domain, { variant: currentVariant() });
    PorViz.setRun(domain, currentVariant());
    document.querySelectorAll("#run-seg button").forEach(b =>
      b.classList.toggle("active", b.dataset.run === domain));
    el("run-desc").textContent = RUN_TEXT[domain] || "";
    el("variant-row").style.display = domain === "UUV" ? "" : "none";
    buildCriteria();
    refreshHeader();
    refreshHud();
    lookAt(domain);
  }

  function currentVariant() {
    const active = document.querySelector("#variant-seg button.active");
    return active ? active.dataset.variant : "standard";
  }

  /* Put the camera where the run about to be flown can be seen, looking up
   * the course the way the video is shot. alpha near -PI/2 puts the eye south
   * of the target looking north, which is the direction every course runs;
   * the UUV view sits under the surface, because the gate it has to pass is a
   * metre down and the water is opaque from above.
   *
   * setTarget on an arc-rotate camera rebuilds alpha, beta and radius out of
   * the current position, so the three of them are set after it, never before.
   */
  const VIEWS = {
    USV: { target: [0, 0.5, 7.5], radius: 26, beta: 1.22, alpha: -Math.PI / 2 + 0.3 },
    UUV: { target: [0, -1.2, 5.0], radius: 17, beta: 1.62, alpha: -Math.PI / 2 + 0.25 },
    UAV: { target: [0, 6.0, 12.0], radius: 42, beta: 1.14, alpha: -Math.PI / 2 + 0.2 },
    COMMS: { target: [0, 2.0, 0.0], radius: 30, beta: 1.25, alpha: -Math.PI / 2 },
  };

  function lookAt(domain) {
    const view = VIEWS[domain] || VIEWS.USV;
    const origin = domain === "COMMS"
      ? [0, 0]
      : cfg.layout[domain.toLowerCase()].origin;
    const cam = World.camera;
    Cameras.setMode("orbit");
    cam.setTarget(new BABYLON.Vector3(
      origin[0] + view.target[0], view.target[1], origin[1] + view.target[2]));
    cam.radius = view.radius;
    cam.beta = view.beta;
    cam.alpha = view.alpha;
    document.querySelectorAll("#cam-seg button").forEach(b =>
      b.classList.toggle("active", b.dataset.cam === "orbit"));
  }

  // ------------------------------------------------------------- report --
  async function buildReport() {
    // Static export: the server renders this markdown from the same data, and
    // the page already has the configuration, so build it here instead.
    const rehearsed = r => r.criteria.length > 0 &&
      r.criteria.every(c => (state.results[c] || {}).passed);
    const held = r => !rehearsed(r) && !!evidence[r.id];
    const reqs = cfg.requirements;
    const lines = [
      "# RobotX 2026 Proof of Readiness",
      "",
      "Mandatory window (USV plus one domain): " + cfg.windows.mandatory +
        ". Optional third system: " + cfg.windows.third_system + ".",
      "",
      "Rehearsed items were flown in the RobotX visualizer against the handbook " +
        "3.1 course specifications. They are evidence that the run planned would " +
        "pass, not a substitute for the video.",
      "",
      reqs.filter(r => rehearsed(r) || held(r)).length + " of " + reqs.length +
        " requirements accounted for: " + reqs.filter(rehearsed).length +
        " rehearsed, " + reqs.filter(held).length + " held as evidence.",
      "",
    ];
    for (const domain of cfg.domains) {
      const items = reqs.filter(r => r.domain === domain);
      if (!items.length) continue;
      lines.push("## " + domain, "",
        "| Section | Requirement | Evidence | Status |", "| --- | --- | --- | --- |");
      for (const r of items) {
        const status = rehearsed(r) ? "PASS (rehearsed)"
          : held(r) ? "held" : "to be produced";
        lines.push("| " + r.section + " | " + r.title + " | " + r.kind + " | " + status + " |");
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  el("btn-report").onclick = async () => {
    const text = await buildReport();
    const blob = new Blob([text], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "proof-of-readiness.md";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  el("btn-copy").onclick = async () => {
    const text = await buildReport();
    try {
      await navigator.clipboard.writeText(text);
      el("btn-copy").textContent = "Copied";
      setTimeout(() => { el("btn-copy").textContent = "Copy"; }, 1500);
    } catch (err) {
      console.warn("clipboard refused", err);
    }
  };

  // ------------------------------------------------------------- events --
  PorSim.on((kind, payload) => {
    if (kind === "event") pushEvent(payload.text);
    else if (kind === "message") pushEvent(`${payload.dir} ${payload.label} ${payload.detail}`);
    else if (kind === "result") { refreshCriteria(); refreshChecklist(); }
    else if (kind === "reset") {
      el("log").innerHTML = "";
      PorViz.reset(state);
      refreshCriteria();
      refreshChecklist();
    }
    else if (kind === "finished") refreshHeader();
  });

  document.querySelectorAll("#run-seg button").forEach(b =>
    b.onclick = () => setRun(b.dataset.run));
  document.querySelectorAll("#variant-seg button").forEach(b =>
    b.onclick = () => {
      document.querySelectorAll("#variant-seg button").forEach(o =>
        o.classList.toggle("active", o === b));
      setRun("UUV");
    });
  document.querySelectorAll("#filter-seg button").forEach(b =>
    b.onclick = () => {
      filter = b.dataset.filter;
      document.querySelectorAll("#filter-seg button").forEach(o =>
        o.classList.toggle("active", o === b));
      refreshChecklist();
    });
  document.querySelectorAll("#cam-seg button").forEach(b =>
    b.onclick = () => setCam(b.dataset.cam));
  document.querySelectorAll("#follow-seg button").forEach(b =>
    b.onclick = () => setFollow(b.dataset.follow));
  document.querySelectorAll("#pov-seg button").forEach(b =>
    b.onclick = () => setPov(b.dataset.pov));
  document.querySelectorAll(".min-btn").forEach(b =>
    b.onclick = () => {
      const panel = b.closest("aside");
      if (panel.id === "visuals") toggleVisuals(false);
      else panel.classList.toggle("min");
    });

  function setCam(mode) {
    camIdx = Math.max(0, CAMS.indexOf(mode));
    Cameras.setMode(mode);
    povIdx = 0;
    document.querySelectorAll("#cam-seg button").forEach(b =>
      b.classList.toggle("active", b.dataset.cam === mode));
    document.querySelectorAll("#pov-seg button").forEach(b =>
      b.classList.toggle("active", !b.dataset.pov));
    el("fly-speed-row").classList.toggle("on", mode === "free");
  }

  function setFollow(id) {
    Cameras.setFollow(id);
    document.querySelectorAll("#follow-seg button").forEach(b =>
      b.classList.toggle("active", b.dataset.follow === id));
    if (Cameras.mode !== "chase") setCam("chase");
  }

  function setPov(id) {
    povIdx = Math.max(0, POVS.indexOf(id));
    Render.setPov(id || null);
    document.querySelectorAll("#pov-seg button").forEach(b =>
      b.classList.toggle("active", (b.dataset.pov || "") === (id || "")));
  }

  function toggleVisuals(force) {
    const panel = el("visuals");
    const open = force === undefined ? !panel.classList.contains("open") : force;
    panel.classList.toggle("open", open);
    el("btn-visuals").classList.toggle("active", open);
  }

  Visuals.mount(el("visuals-body"));
  el("btn-visuals").onclick = () => toggleVisuals();
  el("fly-speed").oninput = e => {
    Cameras.setFlySpeed(parseFloat(e.target.value));
    el("fly-speed-val").textContent = Cameras.flySpeed.toFixed(0);
  };
  /* Starting a run follows the vehicle that is flying it. The fixed view is
   * the one to frame the course from; once the run is moving, the thing worth
   * watching is the vehicle, and the UAV climbs to 60 m for the ceiling test
   * where no fixed view can hold it.
   */
  function startRun() {
    const follow = { USV: "usv", UUV: "uuv", UAV: "uav" }[state.domain];
    if (follow && !state.running && state.step !== "COMPLETE") setFollow(follow);
    PorSim.toggle();
    refreshHeader();
  }

  el("btn-play").onclick = startRun;
  el("btn-reset").onclick = () => { PorSim.reset(); refreshHeader(); };

  const SWALLOW = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"];
  window.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT") return;
    keys.add(e.code);
    if (SWALLOW.indexOf(e.code) !== -1) e.preventDefault();
    if (e.code === "Space") {
      e.preventDefault();
      startRun();
    } else if (e.code === "KeyR") {
      PorSim.reset();
      refreshHeader();
    } else if (e.code === "KeyC") {
      setCam(CAMS[(camIdx + 1) % CAMS.length]);
    } else if (e.code === "KeyV") {
      setPov(POVS[(povIdx + 1) % POVS.length]);
    } else if (e.code === "KeyG") {
      toggleVisuals();
    } else if (["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code) !== -1) {
      setRun(RUNS[Number(e.code.slice(-1)) - 1]);
    }
  });
  window.addEventListener("keyup", e => keys.delete(e.code));

  // --------------------------------------------------------- run loop --
  el("window-note").textContent =
    `handbook 3.1, mandatory window ${cfg.windows.mandatory}`;
  buildChecklist();
  setRun("USV");
  setCam("orbit");
  refreshHud();

  let uiAccum = 0;
  World.scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, World.engine.getDeltaTime() / 1000);
    PorSim.update(dt);
    Render.frame(state, dt);
    PorViz.frame(state, dt);
    Por.frame(World.scene.activeCamera.position);
    uiAccum += dt;
    if (uiAccum > 0.2) {
      uiAccum = 0;
      refreshHeader();
      refreshHud();
    }
  });
})();
