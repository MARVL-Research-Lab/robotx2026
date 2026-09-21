/* main.js: wiring. Loads the course, builds the world, runs the mission loop,
 * and keeps the panels in step with it.
 */
"use strict";

(async function () {
  const cfg = await (await fetch("./api/course.json")).json();
  const canvas = document.getElementById("scene");
  World.init(canvas, cfg);
  const state = Sim.init(cfg);

  const el = id => document.getElementById(id);
  const input = { throttle: 0, steer: 0, vertical: 0 };
  const keys = new Set();
  const CAMS = ["orbit", "free", "chase", "top"];
  const FOLLOWS = ["usv", "uuv", "uav"];
  const POVS = ["", "usv", "uav", "uuv"];
  let camIdx = 0, povIdx = 0;
  let liveMode = false;

  Cameras.bindKeys(keys);

  const CAM_TEXT = {
    orbit: "Orbit: drag to swing around the course, wheel to zoom, right-drag to pan.",
    free: "Free flight: W A S D to move, Q E down and up, drag to look, shift for speed, wheel sets the fly speed.",
    chase: "Third person behind the selected vehicle. Drag or scroll to look around it; it takes the camera back a few seconds later.",
    top: "Plan view of the whole operating area.",
  };

  const TIER_TEXT = {
    CORE: "Core: the surface craft circles the flashing blue entry buoy clockwise, transits the passage, and circles the solid blue exit buoy counterclockwise. Side beacons are lit, so the USV can do it alone.",
    ADVANCED: "Advanced: the safe route is visible only from above, so the UAV flies the field first and relays entry, exit, and marker positions before the USV transits.",
    DISRUPTIVE: "Disruptive: the route can change mid-transit. The UAV stays on station and pushes updates while the USV is in the field.",
  };

  // ------------------------------------------------------------- panels --
  function fillCourseFacts() {
    const facts = [
      ["Operating area", `${cfg.area.width} x ${cfg.area.depth} m`],
      ["Task 1 buoys", `${cfg.task1.buoys.length} with light beacons`],
      ["Pipeline", `5 sections, ${cfg.task2.pipeline.nodes.length - 1} lit nodes`],
      ["Pinger", `${(cfg.pinger_freq_hz / 1000).toFixed(0)} kHz, active buoy only`],
      ["Docking bays", `3, safe bay ${cfg.task3.safe_bay}`],
      ["Platforms", `${cfg.platforms.items.length} x ${cfg.platforms.size_m} m`],
      ["Seabed", `${cfg.seabed_depth_m} m`],
      ["Origin", `${cfg.origin.lat.toFixed(4)}, ${cfg.origin.lon.toFixed(4)}`],
    ];
    el("course-facts").innerHTML = facts
      .map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join("");
    el("course-id").textContent = cfg.course_id;
  }

  function fillTasks() {
    el("tasks").innerHTML = cfg.tasks.map(t => `
      <li data-task="${t.id}">
        <span class="tick">${t.number}</span>
        <span>${t.label}</span>
        <span class="tier" data-tier-for="${t.id}"></span>
      </li>`).join("");
  }

  function refreshTasks() {
    cfg.tasks.forEach(t => {
      const li = document.querySelector(`#tasks li[data-task="${t.id}"]`);
      const tier = state.completed[t.id];
      li.classList.toggle("done", Boolean(tier));
      const activeTask = Object.values(state.vehicles).map(v => v.task).find(Boolean);
      li.classList.toggle("active", !tier && activeTask === t.id);
      li.querySelector(".tier").textContent = tier || "";
    });
  }

  function pushMessage(entry) {
    const li = document.createElement("li");
    const cls = entry.dir === "RX" ? "rx" : "tx";
    const arrow = entry.dir === "RX" ? "&larr;" : "&rarr;";
    li.innerHTML = `<span class="${cls}">${arrow}</span> <b>${entry.label}</b> ${entry.detail || ""}`;
    const list = el("messages");
    list.prepend(li);
    while (list.children.length > 60) list.lastChild.remove();
  }

  function pushEvent(text) {
    const li = document.createElement("li");
    const mm = String(Math.floor(state.t / 60)).padStart(2, "0");
    const ss = String(Math.floor(state.t % 60)).padStart(2, "0");
    li.textContent = `${mm}:${ss}  ${text}`;
    const list = el("log");
    list.prepend(li);
    while (list.children.length > 40) list.lastChild.remove();
  }

  function refreshVehicles() {
    const rows = Object.values(state.vehicles).map(v => {
      const alt = v.id === "uuv"
        ? `${Math.abs(v.y).toFixed(1)} m deep`
        : (v.id === "uav" ? `${v.y.toFixed(1)} m` : "-");
      const cls = v.state.toLowerCase();
      return `<tr>
        <td>${v.spec.label}</td>
        <td class="${cls}">${v.state}</td>
        <td>${v.task ? v.task.replace(/_/g, " ").toLowerCase() : "-"}</td>
        <td>${v.speed.toFixed(1)} m/s</td>
        <td>${alt}</td>
      </tr>`;
    });
    el("vehicles").querySelector("tbody").innerHTML = rows.join("");
  }

  function refreshHeader() {
    const mm = String(Math.floor(state.t / 60)).padStart(2, "0");
    const ss = String(Math.floor(state.t % 60)).padStart(2, "0");
    el("clock").textContent = `${mm}:${ss}`;
    const pill = el("run-state");
    if (liveMode) {
      pill.textContent = "LIVE";
      pill.className = "pill pill-run";
    } else if (!state.running) {
      pill.textContent = state.started ? "PAUSED" : "PRE-RUN";
      pill.className = "pill pill-idle";
    } else if (!state.started) {
      pill.textContent = "HOLDING";
      pill.className = "pill pill-hold";
    } else {
      pill.textContent = `RUN ${state.runId}`;
      pill.className = "pill pill-run";
    }
    el("step").textContent = state.step || "-";
    el("hb-count").textContent = `${state.heartbeats} heartbeats`;
    const manual = state.manual;
    const ms = el("manual-state");
    if (manual) {
      ms.className = "pill pill-manual";
      ms.textContent = `${state.vehicles[manual].spec.label} manual: not scoring`;
    } else {
      ms.className = "pill pill-auto";
      ms.textContent = "All systems autonomous";
    }
  }

  // ------------------------------------------------------------- events --
  Sim.on((kind, payload) => {
    if (kind === "message") pushMessage(payload);
    else if (kind === "event") pushEvent(payload.text);
    else if (kind === "progress") refreshTasks();
    else if (kind === "reset") {
      el("messages").innerHTML = "";
      el("log").innerHTML = "";
      refreshTasks();
    }
  });

  function setTier(tier) {
    document.querySelectorAll("#tier-seg button").forEach(b =>
      b.classList.toggle("active", b.dataset.tier === tier));
    el("tier-desc").textContent = TIER_TEXT[tier];
    Sim.setTier(tier);
    el("btn-play").textContent = "Start";
  }

  function setCam(mode) {
    camIdx = Math.max(0, CAMS.indexOf(mode));
    Cameras.setMode(mode);
    // a camera mode takes over from any onboard view, so the buttons follow
    povIdx = 0;
    document.querySelectorAll("#cam-seg button").forEach(b =>
      b.classList.toggle("active", b.dataset.cam === mode));
    document.querySelectorAll("#pov-seg button").forEach(b =>
      b.classList.toggle("active", !b.dataset.pov));
    el("cam-desc").textContent = CAM_TEXT[mode] || "";
    el("fly-speed-row").classList.toggle("on", mode === "free");
    refreshHelp();
  }

  function setFollowButtons(id) {
    document.querySelectorAll("#follow-seg button").forEach(b =>
      b.classList.toggle("active", b.dataset.follow === id));
  }

  function setFollow(id) {
    Cameras.setFollow(id);
    setFollowButtons(id);
    // picking a vehicle to watch is a request to watch it
    if (Cameras.mode !== "chase") setCam("chase");
  }

  function setPov(id) {
    povIdx = Math.max(0, POVS.indexOf(id));
    Render.setPov(id || null);
    document.querySelectorAll("#pov-seg button").forEach(b =>
      b.classList.toggle("active", (b.dataset.pov || "") === (id || "")));
    refreshHelp();
  }

  /* The movement keys mean different things depending on what is driving.
   * In free flight W A S D flies the camera and the arrows drive a manual
   * vehicle; everywhere else W A S D drives and the arrows do the same thing.
   */
  function refreshHelp() {
    const flying = Cameras.mode === "free" && !Cameras.pov;
    el("help-move").innerHTML = flying
      ? "<b>W A S D</b> fly camera, <b>arrows</b> drive manual"
      : "<b>W A S D</b> drive manual";
    el("help-vert").innerHTML = flying
      ? "<b>Q E</b> camera down / up"
      : "<b>Q E</b> depth / altitude";
  }

  function toggleVisuals(force) {
    const panel = el("visuals");
    const open = force === undefined ? !panel.classList.contains("open") : force;
    panel.classList.toggle("open", open);
    el("btn-visuals").classList.toggle("active", open);
  }

  document.querySelectorAll("#tier-seg button").forEach(b =>
    b.onclick = () => setTier(b.dataset.tier));
  document.querySelectorAll("#cam-seg button").forEach(b =>
    b.onclick = () => setCam(b.dataset.cam));
  document.querySelectorAll("#follow-seg button").forEach(b =>
    b.onclick = () => setFollow(b.dataset.follow));
  document.querySelectorAll("#pov-seg button").forEach(b =>
    b.onclick = () => setPov(b.dataset.pov));
  document.querySelectorAll("#t4-seg button").forEach(b =>
    b.onclick = () => Sim.injectIncident(b.dataset.kind));
  document.querySelectorAll(".min-btn").forEach(b =>
    b.onclick = () => {
      const panel = b.closest("aside");
      if (panel.id === "visuals") toggleVisuals(false);
      else panel.classList.toggle("min");
    });

  Visuals.mount(el("visuals-body"));
  el("btn-visuals").onclick = () => toggleVisuals();
  el("fly-speed").oninput = e => {
    Cameras.setFlySpeed(parseFloat(e.target.value));
    el("fly-speed-val").textContent = Cameras.flySpeed.toFixed(0);
  };

  el("btn-play").onclick = () => {
    Sim.toggle();
    el("btn-play").textContent = state.running ? "Pause" : "Start";
  };
  el("btn-reset").onclick = () => {
    Sim.reset(state.tier);
    el("btn-play").textContent = "Start";
  };
  el("show-rings").onchange = e => { state.showRings = e.target.checked; };
  el("show-labels").onchange = e => { state.showLabels = e.target.checked; };

  const SWALLOW = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"];

  window.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT") return;
    keys.add(e.code);
    if (SWALLOW.indexOf(e.code) !== -1) e.preventDefault();
    if (e.code === "Space") {
      e.preventDefault();
      Sim.toggle();
      el("btn-play").textContent = state.running ? "Pause" : "Start";
    } else if (e.code === "KeyR") {
      Sim.reset(state.tier);
      el("btn-play").textContent = "Start";
    } else if (e.code === "KeyC") {
      setCam(CAMS[(camIdx + 1) % CAMS.length]);
    } else if (e.code === "KeyV") {
      setPov(POVS[(povIdx + 1) % POVS.length]);
    } else if (e.code === "KeyG") {
      toggleVisuals();
    } else if (e.code === "KeyM") {
      Sim.setManual("usv");
    } else if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3") {
      setFollow(FOLLOWS[Number(e.code.slice(-1)) - 1]);
    } else if (e.code === "Digit5") {
      Sim.injectIncident("ASSISTANCE_REQUEST");
    } else if (e.code === "Digit6") {
      Sim.injectIncident("KEEPOUT_ZONE");
    } else if (e.code === "Digit7") {
      Sim.injectIncident("MOVING_OBJECT");
    }
  });
  window.addEventListener("keyup", e => keys.delete(e.code));

  /* Manual driving and free flight both want W A S D, so only one of them
   * has it at a time: in free flight the camera takes them and the arrow keys
   * drive, and everywhere else both sets drive. The arrows work in every mode
   * so a hand already on them never has to move.
   */
  function readInput() {
    const flying = Cameras.mode === "free" && !Cameras.pov;
    const fwd = flying ? 0 : (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const side = flying ? 0 : (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const rise = flying ? 0 : (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0);
    input.throttle = fwd + (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0);
    input.steer = side + (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
    input.vertical = rise + (keys.has("PageUp") ? 1 : 0) - (keys.has("PageDown") ? 1 : 0);
    input.throttle = Math.max(-1, Math.min(1, input.throttle));
    input.steer = Math.max(-1, Math.min(1, input.steer));
    input.vertical = Math.max(-1, Math.min(1, input.vertical));
  }

  // --------------------------------------------------------------- live --
  function startLive() {
    liveMode = true;
    Sim.pause();
    const status = el("live-status");
    Live.attach(state, {
      status(connected, detail) {
        status.className = connected ? "pill pill-live" : "pill pill-dead";
        status.textContent = connected ? `Live: ${detail}` : `Live: ${detail}`;
      },
      message(label, detail) { pushMessage({ label, detail, dir: "RX", t: state.t }); },
      event(text) { pushEvent(text); },
      course(id, runId) {
        el("course-id").textContent = id;
        if (runId) state.runId = runId;
      },
    });
  }

  if (cfg.live && cfg.live.enabled) {
    startLive();
  } else {
    el("live-status").textContent =
      "Simulation (--broker, --mavlink or dashboard --viz for live traffic)";
  }

  // ----------------------------------------------------------- run loop --
  fillCourseFacts();
  fillTasks();
  setTier(state.tier);
  setCam("orbit");
  setFollowButtons("usv");
  refreshTasks();
  refreshHelp();

  let uiAccum = 0;
  World.scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, World.engine.getDeltaTime() / 1000);
    readInput();
    if (!liveMode) Sim.update(dt, input);
    Render.frame(state, dt);
    uiAccum += dt;
    if (uiAccum > 0.2) {
      uiAccum = 0;
      refreshHeader();
      refreshVehicles();
      refreshTasks();
    }
  });
})();
