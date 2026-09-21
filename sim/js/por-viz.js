/* por-viz.js: what the rehearsal draws on top of the course.
 *
 * por.js builds the three courses of handbook 3.1 and never changes them.
 * This is the layer that moves: the track each vehicle leaves behind it, the
 * mark it is steering for, the gate it is about to pass and whether the pass
 * counted, the clearance to the nearest buoy, the depth of the ROV, the hoop
 * it draws around the marker, and the fence and the ceiling holding the UAV.
 *
 * All of it is read off the rehearsal state and the criteria it has already
 * decided, so nothing here can disagree with what the panel says. It draws
 * only for the submission being rehearsed; the other two courses stay clean,
 * which is what a video of one run wants in frame.
 */
"use strict";

const PorViz = (() => {
  const TAU = Math.PI * 2;
  const V3 = (x, y, z) => new BABYLON.Vector3(x, y, z);
  const C3 = hex => BABYLON.Color3.FromHexString(hex);

  const COLOR = {
    usv: "#f59f00",
    uuv: "#4dabf7",
    uav: "#e64980",
    pass: "#2f9e44",
    fail: "#e03131",
    warn: "#f59f00",
    mark: "#74c0fc",
    lit: "#ffd43b",
  };

  // How many points a track holds. At the sampling rate below that is about
  // 90 seconds of history, which covers the longest rehearsal leg.
  const TRACK_LEN = 260;
  const TRACK_STEP_S = 0.12;
  const TRACK_STEP_M = 0.08;

  let scene = null, cfg = null, api = null;
  let t = 0, lastT = 0;
  let domain = "USV", variant = "standard";
  // where the ground is under the UAV: its altitude is AGL and its pad is on
  // the bank, so the scene sits it that much higher than the water
  let ground = 0;
  const tracks = {};
  const readouts = {};
  const marks = {};
  const usv = {};
  const uuv = {};
  const uav = {};
  const notes = {};         // the captions that belong to whichever run is up
  const scaled = [];        // billboards held at a readable size on screen

  const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

  function unlit(name, hex, alpha) {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.diffuseColor = C3(hex);
    m.emissiveColor = C3(hex);
    m.disableLighting = true;
    m.backFaceCulling = false;
    if (alpha !== undefined) m.alpha = alpha;
    return m;
  }

  function tint(mesh, hex, alpha) {
    if (!mesh || !mesh.material) return;
    const c = C3(hex);
    mesh.material.diffuseColor = c;
    mesh.material.emissiveColor = c;
    if (alpha !== undefined) mesh.material.alpha = alpha;
  }

  /* A caption whose text changes while the run is going.
   *
   * The static course captions in por.js paint their texture once. These are
   * repainted, so they only redraw when the string actually changes: a
   * clearance readout rounded to a centimetre changes a few times a second,
   * and repainting a 512 x 96 texture every frame for that is wasted work.
   */
  function readout(name, opts = {}) {
    const width = opts.width || 2.4;
    const plane = BABYLON.MeshBuilder.CreatePlane("por-viz-" + name,
      { width, height: width * 0.1875 }, scene);
    const tex = new BABYLON.DynamicTexture("por-viz-tex-" + name,
      { width: 512, height: 96 }, scene, true);
    const m = new BABYLON.StandardMaterial("por-viz-mat-" + name, scene);
    m.diffuseTexture = tex;
    m.diffuseTexture.hasAlpha = true;
    m.emissiveColor = new BABYLON.Color3(1, 1, 1);
    m.disableLighting = true;
    m.backFaceCulling = false;
    plane.material = m;
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    plane.applyFog = false;
    plane.setEnabled(false);
    const item = {
      plane,
      text: null,
      accent: null,
      set(text, accent = COLOR.mark) {
        if (text === item.text && accent === item.accent) return;
        item.text = text;
        item.accent = accent;
        const ctx = tex.getContext();
        ctx.clearRect(0, 0, 512, 96);
        ctx.fillStyle = "rgba(8,12,18,0.8)";
        ctx.fillRect(0, 0, 512, 96);
        ctx.fillStyle = accent;
        ctx.fillRect(0, 0, 12, 96);
        let size = 40;
        ctx.font = `bold ${size}px Segoe UI, sans-serif`;
        while (size > 16 && ctx.measureText(text).width > 458) {
          size -= 2;
          ctx.font = `bold ${size}px Segoe UI, sans-serif`;
        }
        ctx.fillStyle = "#e9ecef";
        ctx.fillText(text, 26, 48 + size * 0.35);
        tex.update();
      },
      at(x, y, z) { plane.position.set(x, y, z); },
      show(on) { plane.setEnabled(Boolean(on)); },
    };
    scaled.push(plane);
    return item;
  }

  /* A polyline that is rewritten every frame. Babylon updates a lines mesh in
   * place when the point count does not change, so the buffer is a fixed
   * length from the start and unused points sit on top of the first one.
   */
  function polyline(name, count, hex, opts = {}) {
    const base = C3(hex);
    const points = [];
    const colors = [];
    for (let i = 0; i < count; i++) {
      points.push(V3(0, 0, 0));
      // oldest end transparent, so a track fades out behind the vehicle
      const a = opts.flat ? (opts.alpha || 0.9)
                          : Math.pow(i / Math.max(1, count - 1), 1.6) * (opts.alpha || 0.9);
      colors.push(new BABYLON.Color4(base.r, base.g, base.b, a));
    }
    const mesh = BABYLON.MeshBuilder.CreateLines(name, {
      points, colors, updatable: true, useVertexAlpha: true,
    }, scene);
    mesh.isPickable = false;
    mesh.applyFog = false;
    mesh.setEnabled(false);
    return {
      mesh,
      points,
      colour(nextHex) {
        const c = C3(nextHex);
        for (let i = 0; i < colors.length; i++) {
          colors[i].r = c.r; colors[i].g = c.g; colors[i].b = c.b;
        }
        BABYLON.MeshBuilder.CreateLines(name, { points, colors, instance: mesh }, scene);
      },
      push() {
        BABYLON.MeshBuilder.CreateLines(name, { points, instance: mesh }, scene);
      },
      show(on) { mesh.setEnabled(Boolean(on)); },
    };
  }

  // ------------------------------------------------------------- tracks --
  /* Where the vehicle has been. The UAV carries a second one on the ground,
   * because a line in the air over a flat bank gives no sense of where the
   * aircraft is standing.
   */
  function buildTrack(id, hex, opts = {}) {
    tracks[id] = {
      line: polyline("por-track-" + id, TRACK_LEN, hex),
      ground: opts.ground ? polyline("por-track-ground-" + id, TRACK_LEN, hex,
                                     { alpha: 0.35 }) : null,
      since: 0,
      seeded: false,
    };
  }

  function seedTrack(id, x, y, z) {
    const tr = tracks[id];
    if (!tr) return;
    tr.line.points.forEach(p => p.set(x, y, z));
    if (tr.ground) tr.ground.points.forEach(p => p.set(x, ground + 0.02, z));
    tr.line.push();
    if (tr.ground) tr.ground.push();
    tr.seeded = true;
    tr.since = 0;
  }

  function sampleTrack(id, v, dt) {
    const tr = tracks[id];
    if (!tr) return;
    const y = id === "uuv" ? v.y
      : (id === "uav" ? v.y + ground + 0.02 : Math.max(v.y, 0.06));
    if (!tr.seeded) { seedTrack(id, v.x, y, v.z); return; }
    tr.since += dt;
    const head = tr.line.points[TRACK_LEN - 1];
    const moved = Math.hypot(head.x - v.x, head.y - y, head.z - v.z);
    if (tr.since < TRACK_STEP_S || moved < TRACK_STEP_M) return;
    tr.since = 0;
    // slide the buffer down one and write the new head
    for (let i = 0; i < TRACK_LEN - 1; i++) {
      tr.line.points[i].copyFrom(tr.line.points[i + 1]);
      if (tr.ground) tr.ground.points[i].copyFrom(tr.ground.points[i + 1]);
    }
    tr.line.points[TRACK_LEN - 1].set(v.x, y, v.z);
    tr.line.push();
    if (tr.ground) {
      tr.ground.points[TRACK_LEN - 1].set(v.x, ground + 0.02, v.z);
      tr.ground.push();
    }
  }

  // -------------------------------------------------- the mark being flown --
  /* The waypoint the guidance is steering for, and the line to it. Without it
   * a viewer sees a vehicle turn and has to guess why; with it the turn is
   * obviously the vehicle lining up on the next mark.
   */
  function buildMarks() {
    ["usv", "uuv", "uav"].forEach(id => {
      const ring = BABYLON.MeshBuilder.CreateTorus("por-mark-" + id,
        { diameter: 1.5, thickness: 0.08, tessellation: 28 }, scene);
      ring.material = unlit("por-mark-mat-" + id, COLOR.mark, 0.7);
      ring.isPickable = false;
      ring.setEnabled(false);
      if (api && api.glow) api.glow.addIncludedOnlyMesh(ring);
      marks[id] = { ring, line: polyline("por-mark-line-" + id, 2, COLOR.mark, { alpha: 0.5 }) };
    });
  }

  function updateMark(id, v, running) {
    const m = marks[id];
    if (!m) return;
    const on = Boolean(running && v.target);
    m.ring.setEnabled(on);
    m.line.show(on);
    if (!on) return;
    const y = id === "uav" ? v.target.y + ground
      : (id === "uuv" ? v.target.y : 0.12);
    // Babylon builds a torus flat, in the XZ plane, which is how a mark on
    // the water and a mark in the air both want to read: a hoop stood on
    // edge is a gate, and none of these are gates.
    m.ring.position.set(v.target.x, y, v.target.z);
    const pulse = 1 + 0.12 * Math.sin(t * 3.4);
    m.ring.scaling.set(pulse, pulse, pulse);
    m.ring.material.alpha = 0.45 + 0.2 * Math.sin(t * 3.4);
    m.line.points[0].set(
      v.x, id === "uuv" ? v.y : (id === "uav" ? v.y + ground : 0.12), v.z);
    m.line.points[1].set(v.target.x, y, v.target.z);
    m.line.push();
  }

  // ------------------------------------------------------- USV feedback --
  function buildUsv() {
    const spec = cfg.courses.usv;
    const [ox, oz] = cfg.layout.usv.origin;
    const gates = [oz, oz + spec.gate_spacing_m];

    /* The passage itself, drawn. The run is judged on crossing between the
     * two buoys, so the gap between them is a pane of light the vehicle
     * drives through: amber until it is crossed, then the verdict's colour.
     */
    usv.curtains = gates.map((z, i) => {
      const pane = BABYLON.MeshBuilder.CreatePlane("por-usv-curtain" + i,
        { width: spec.gate_width_m, height: 1.5 }, scene);
      pane.position.set(ox, 0.75, z);
      pane.material = unlit("por-usv-curtain-mat" + i, COLOR.warn, 0.1);
      pane.isPickable = false;
      return pane;
    });
    // a bar across the top of the pane, so the passage has an edge to it
    // rather than being a faint rectangle on the water
    usv.bars = gates.map((z, i) => {
      const bar = polyline("por-usv-gate-bar" + i, 2, COLOR.warn,
                           { flat: true, alpha: 0.8 });
      bar.points[0].set(ox - spec.gate_width_m / 2, 1.5, z);
      bar.points[1].set(ox + spec.gate_width_m / 2, 1.5, z);
      bar.push();
      return bar;
    });
    usv.verdicts = gates.map((z, i) =>
      readout("usv-gate-verdict" + i, { width: 3.2 }));
    usv.verdicts.forEach((r, i) => r.at(ox, 2.0, gates[i] - 0.6));

    // the route the run is meant to fly, start line to past the second gate
    const startZ = oz - spec.start_offset_m;
    usv.route = polyline("por-usv-route", 4, COLOR.mark, { flat: true, alpha: 0.4 });
    usv.route.points[0].set(ox, 0.09, startZ);
    usv.route.points[1].set(ox, 0.09, gates[0]);
    usv.route.points[2].set(ox, 0.09, gates[1]);
    usv.route.points[3].set(ox, 0.09, gates[1] + 4.0);
    usv.route.push();

    // the closest buoy, measured live: this is the no-strike criterion
    usv.clearance = polyline("por-usv-clearance", 2, COLOR.pass, { flat: true, alpha: 0.8 });
    usv.clearanceLabel = readout("usv-clearance", { width: 2.0 });
  }

  function updateUsv(state) {
    const on = domain === "USV";
    usv.curtains.forEach(c => c.setEnabled(on));
    usv.bars.forEach(b => b.show(on));
    usv.route.show(on);
    if (!on) {
      usv.clearance.show(false);
      usv.clearanceLabel.show(false);
      usv.verdicts.forEach(r => r.show(false));
      return;
    }

    const v = state.vehicles.usv;
    const spec = cfg.courses.usv;
    const [ox, oz] = cfg.layout.usv.origin;
    const gates = [oz, oz + spec.gate_spacing_m];

    // each gate: pending, then the verdict the rehearsal recorded
    gates.forEach((z, i) => {
      const result = state.results[`usv.gate${i + 1}`];
      const gate = (Por.parts.usv.gates || [])[i];
      let hex = COLOR.warn, alpha = 0.14;
      if (result) {
        hex = result.passed ? COLOR.pass : COLOR.fail;
        alpha = 0.22;
        const off = (result.measured && result.measured.offset_m) || 0;
        usv.verdicts[i].set(
          `Gate ${i + 1} ${result.passed ? "PASS" : "FAIL"}  ${off.toFixed(2)} m off centre`,
          hex);
        usv.verdicts[i].show(true);
      } else {
        usv.verdicts[i].show(false);
        // the gate being approached breathes, so the next one is obvious
        const next = v.z < z;
        alpha = next ? 0.14 + 0.06 * Math.sin(t * 2.2) : 0.07;
      }
      tint(usv.curtains[i], hex, alpha);
      usv.bars[i].colour(hex);
      if (gate && gate.line) gate.line.color = C3(hex);
    });

    // live clearance to the nearest buoy while the run is being judged
    const buoys = Por.parts.usv.buoys || [];
    let nearest = null, best = Infinity;
    buoys.forEach(b => {
      const gap = dist(v.x, v.z, b.x, b.z) - b.radius - 0.6;   // 0.6 m half beam
      if (gap < best) { best = gap; nearest = b; }
    });
    const showClearance = state.scoring && nearest && best < 6.0;
    usv.clearance.show(showClearance);
    usv.clearanceLabel.show(showClearance);
    if (showClearance) {
      const hex = best > 1.0 ? COLOR.pass : (best > 0.3 ? COLOR.warn : COLOR.fail);
      usv.clearance.points[0].set(v.x, 0.35, v.z);
      usv.clearance.points[1].set(nearest.x, 0.35, nearest.z);
      usv.clearance.push();
      usv.clearance.colour(hex);
      usv.clearanceLabel.set(`${Math.max(0, best).toFixed(2)} m clear`, hex);
      usv.clearanceLabel.at((v.x + nearest.x) / 2, 0.62, (v.z + nearest.z) / 2);
    }
  }

  // ------------------------------------------------------- UUV feedback --
  function buildUuv() {
    const spec = cfg.courses.uuv;
    const [ox, oz] = cfg.layout.uuv.origin;

    // the window under the bar the ROV has to fly through
    uuv.window = BABYLON.MeshBuilder.CreatePlane("por-uuv-window",
      { width: spec.gate_width_m, height: 1.6 }, scene);
    uuv.window.position.set(ox, -spec.gate_depth_m - 0.8, oz);
    uuv.window.material = unlit("por-uuv-window-mat", COLOR.warn, 0.12);
    uuv.window.isPickable = false;
    uuv.windowLabel = readout("uuv-gate-verdict", { width: 3.2 });
    uuv.windowLabel.at(ox, -0.4, oz - 0.6);

    /* Depth. The water is opaque from above, so the ROV gets a column from
     * the hull to the surface: the length of it is the depth, and the reading
     * is on the label at the top of it where a camera above the water can
     * still see it.
     */
    uuv.column = polyline("por-uuv-column", 2, COLOR.uuv, { flat: true, alpha: 0.7 });
    uuv.depthLabel = readout("uuv-depth", { width: 2.2 });

    /* The hoop the ROV draws around the marker. It grows with the angle the
     * rehearsal has actually swept, so a run that stops half way shows half a
     * hoop, which is the criterion being measured.
     */
    const path = [];
    for (let i = 0; i < 48; i++) path.push(V3(ox, -1, oz));
    uuv.sweep = BABYLON.MeshBuilder.CreateTube("por-uuv-sweep", {
      path, radius: 0.035, tessellation: 6, updatable: true,
      cap: BABYLON.Mesh.NO_CAP,
    }, scene);
    uuv.sweep.material = unlit("por-uuv-sweep-mat", COLOR.uuv, 0.6);
    uuv.sweep.isPickable = false;
    uuv.sweep.setEnabled(false);
    uuv.sweepPath = path;
    uuv.sweepLabel = readout("uuv-sweep", { width: 2.6 });

    /* The tether of the alternate course (3.1.3), from the towed USV down to
     * the ROV. It is the thing the alternate course exists for, so it is
     * drawn rather than implied.
     */
    const tetherPath = [];
    for (let i = 0; i < 16; i++) tetherPath.push(V3(ox, 0, oz));
    uuv.tether = BABYLON.MeshBuilder.CreateTube("por-uuv-tether", {
      path: tetherPath, radius: 0.014, tessellation: 6, updatable: true,
      cap: BABYLON.Mesh.NO_CAP,
    }, scene);
    uuv.tether.material = unlit("por-uuv-tether-mat", "#e8590c", 1.0);
    uuv.tether.isPickable = false;
    uuv.tether.setEnabled(false);
    uuv.tetherPath = tetherPath;
  }

  function updateUuv(state) {
    const on = domain === "UUV";
    uuv.window.setEnabled(on);
    if (!on) {
      uuv.column.show(false);
      uuv.depthLabel.show(false);
      uuv.windowLabel.show(false);
      uuv.sweep.setEnabled(false);
      uuv.sweepLabel.show(false);
      uuv.tether.setEnabled(false);
      return;
    }

    const spec = cfg.courses.uuv;
    const [ox, oz] = cfg.layout.uuv.origin;
    const v = state.vehicles.uuv;
    const out = state.results["uuv.gate_out"];
    const back = state.results["uuv.gate_back"];
    const verdict = back || out;
    let hex = COLOR.warn, alpha = 0.12;
    if (verdict) {
      hex = verdict.passed ? COLOR.pass : COLOR.fail;
      alpha = 0.18;
      const depth = (verdict.measured && verdict.measured.depth_m) || 0;
      uuv.windowLabel.set(
        `${back ? "Return" : "Outbound"} ${verdict.passed ? "PASS" : "FAIL"}  `
        + `${depth.toFixed(2)} m deep`, hex);
      uuv.windowLabel.show(true);
    } else {
      alpha = 0.12 + 0.05 * Math.sin(t * 2.2);
      uuv.windowLabel.show(false);
    }
    tint(uuv.window, hex, alpha);
    const gate = Por.parts.uuv.gate;
    if (gate && gate.line) gate.line.color = C3(hex);

    // depth column and its reading
    const submerged = v.y < -0.1;
    uuv.column.show(submerged);
    uuv.depthLabel.show(submerged);
    if (submerged) {
      // a breach is the run's worst failure, so the column says so on the way
      const breach = v.y > -0.3;
      const colour = breach ? COLOR.fail : COLOR.uuv;
      uuv.column.points[0].set(v.x, v.y, v.z);
      uuv.column.points[1].set(v.x, 0, v.z);
      uuv.column.push();
      uuv.column.colour(colour);
      uuv.depthLabel.set(`${Math.abs(v.y).toFixed(2)} m deep`, colour);
      uuv.depthLabel.at(v.x, 0.9, v.z);
    }

    // the hoop around the marker
    const swept = Math.min(TAU, Math.abs(state.circleAngle || 0));
    const circling = state.scoring && swept > 0.15;
    uuv.sweep.setEnabled(circling);
    uuv.sweepLabel.show(circling);
    if (circling) {
      const markerZ = oz + spec.marker_distance_m;
      const r = spec.circle_radius_m;
      const start = -Math.PI / 2;
      const dir = (state.circleAngle || 0) < 0 ? -1 : 1;
      // half a metre under the vehicle: the hoop is drawn on the circle the
      // ROV is flying, so at eye level it would cut across the chase camera
      const y = Math.min(-0.9, v.y - 0.5);
      for (let i = 0; i < uuv.sweepPath.length; i++) {
        const a = start + dir * swept * (i / (uuv.sweepPath.length - 1));
        uuv.sweepPath[i].set(ox + Math.cos(a) * r, y, markerZ + Math.sin(a) * r);
      }
      BABYLON.MeshBuilder.CreateTube("por-uuv-sweep",
        { path: uuv.sweepPath, instance: uuv.sweep }, scene);
      const done = swept >= TAU * 0.92;
      tint(uuv.sweep, done ? COLOR.pass : COLOR.uuv, 0.6);
      // the ROV is on this circle, so the chase camera is on it too
      fadeNearCamera(uuv.sweep, uuv.sweepPath, 0.6);
      uuv.sweepLabel.set(`${((swept * 180) / Math.PI).toFixed(0)} of 360 degrees`,
                         done ? COLOR.pass : COLOR.uuv);
      uuv.sweepLabel.at(ox, 1.3, markerZ);
    }

    // the alternate course: the towed USV, the ROV, and the cable between
    const towed = variant === "tethered";
    uuv.tether.setEnabled(towed);
    if (towed) {
      const s = state.vehicles.usv;
      const ax = s.x - Math.cos(s.heading) * 0.55;
      const az = s.z - Math.sin(s.heading) * 0.55;
      const bx = v.x - Math.cos(v.heading) * 0.22;
      const bz = v.z - Math.sin(v.heading) * 0.22;
      const n = uuv.tetherPath.length - 1;
      const slack = Math.max(0.2, Math.abs(v.y) * 0.35);
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        // a cable hangs, and a positively buoyant one hangs shallower than a
        // catenary: half a sine bulge is close enough at this length
        const sag = Math.sin(u * Math.PI) * slack;
        uuv.tetherPath[i].set(
          ax + (bx - ax) * u,
          0.12 + (v.y + 0.1 - 0.12) * u - sag * 0.35,
          az + (bz - az) * u);
      }
      BABYLON.MeshBuilder.CreateTube("por-uuv-tether",
        { path: uuv.tetherPath, instance: uuv.tether }, scene);
      // the chase camera sits astern of the ROV, which is exactly where the
      // cable runs: a tether through the lens hides the vehicle it belongs to
      fadeNearCamera(uuv.tether, uuv.tetherPath, 1.0);
    }
  }

  /* Fade anything the camera is about to fly through. A tube drawn on the
   * path the vehicle is following passes close to a camera following the same
   * path, and at half a metre it is a wall of colour rather than a cable.
   */
  function fadeNearCamera(mesh, path, baseAlpha) {
    const cam = scene.activeCamera;
    if (!cam || !mesh.material) return;
    let near = Infinity;
    path.forEach(p => { near = Math.min(near, BABYLON.Vector3.Distance(cam.position, p)); });
    const fade = Math.max(0, Math.min(1, (near - 0.6) / 1.2));
    mesh.material.alpha = baseAlpha * fade;
  }

  // ------------------------------------------------------- UAV feedback --
  function buildUav() {
    const spec = cfg.courses.uav;
    const [ox, oz] = cfg.layout.uav.origin;

    // where the aircraft is standing, and how far above it that is
    uav.shadow = BABYLON.MeshBuilder.CreateDisc("por-uav-shadow",
      { radius: 0.5, tessellation: 28 }, scene);
    uav.shadow.rotation.x = Math.PI / 2;
    uav.shadow.material = unlit("por-uav-shadow-mat", "#0b1015", 0.35);
    uav.shadow.isPickable = false;
    uav.shadow.setEnabled(false);
    uav.drop = polyline("por-uav-drop", 2, COLOR.uav, { flat: true, alpha: 0.45 });
    uav.altLabel = readout("uav-alt", { width: 2.4 });

    // the two limits the submission has to prove, called out when they hold
    uav.limitLabel = readout("uav-limit", { width: 3.6 });
    uav.fenceRing = BABYLON.MeshBuilder.CreateTorus("por-uav-fence-ring", {
      diameter: spec.geofence_radius_m * 2, thickness: 0.12, tessellation: 64,
    }, scene);
    uav.fenceRing.position.set(ox, spec.hover_alt_m, oz);
    uav.fenceRing.material = unlit("por-uav-fence-ring-mat", COLOR.lit, 0.5);
    uav.fenceRing.isPickable = false;
    uav.fenceRing.setEnabled(false);
    if (api && api.glow) api.glow.addIncludedOnlyMesh(uav.fenceRing);
  }

  function updateUav(state) {
    const on = domain === "UAV";
    const spec = cfg.courses.uav;
    const [ox, oz] = cfg.layout.uav.origin;
    const v = state.vehicles.uav;

    // the pattern posts light as they are reached, whichever pattern is up
    (Por.parts.uav.points || []).forEach(p => {
      if (!p.mesh) return;
      const active = on && p.pattern === state.patternName;
      let hex = p.colour;
      if (active) {
        if (p.index < state.patternIndex) hex = COLOR.pass;
        else if (p.index === state.patternIndex) hex = COLOR.lit;
      }
      tint(p.mesh, hex);
      p.mesh.material.alpha = active || !on ? 1 : 0.75;
    });

    uav.shadow.setEnabled(on && v.y > 0.2);
    uav.drop.show(on && v.y > 0.2);
    uav.altLabel.show(on && v.y > 3.0);
    if (!on) {
      uav.limitLabel.show(false);
      uav.fenceRing.setEnabled(false);
      return;
    }

    if (v.y > 0.2) {
      // the pad sits on the bank, so the ground under the aircraft is the
      // bank surface rather than the water
      uav.shadow.position.set(v.x, ground + 0.02, v.z);
      const spread = 1 + v.y * 0.06;
      uav.shadow.scaling.set(spread, spread, spread);
      uav.shadow.material.alpha = Math.max(0.06, 0.34 - v.y * 0.006);
      uav.drop.points[0].set(v.x, v.y + ground - 0.16, v.z);
      uav.drop.points[1].set(v.x, ground + 0.02, v.z);
      uav.drop.push();
      uav.altLabel.set(`${v.y.toFixed(1)} m AGL`, COLOR.uav);
      uav.altLabel.at(v.x, v.y * 0.55 + ground + 0.4, v.z);
    }

    /* The fence and the ceiling. Both are only interesting while the vehicle
     * is being commanded through them, which is exactly when the rehearsal
     * has the flag set, so the callout comes and goes with the test.
     */
    const fenceTest = state.step.indexOf("GEOFENCE") !== -1;
    const ceilingTest = state.step.indexOf("CEILING") !== -1;
    uav.fenceRing.setEnabled(fenceTest);
    if (fenceTest) {
      uav.fenceRing.position.y = Math.max(1.0, v.y + ground);
      const held = state.fenceHit;
      tint(uav.fenceRing, held ? COLOR.fail : COLOR.lit,
           held ? 0.45 + 0.25 * Math.sin(t * 6) : 0.3);
    }
    const fence = Por.parts.uav.fence;
    if (fence && fence.mesh) {
      const held = fenceTest && state.fenceHit;
      fence.mesh.material.alpha = held ? 0.20 + 0.06 * Math.sin(t * 6) : 0.12;
      fence.mesh.material.emissiveColor = C3(held ? "#5a2b0b" : "#3a2f05");
    }
    const ceiling = Por.parts.uav.ceiling;
    if (ceiling && ceiling.mesh) {
      const held = ceilingTest && state.ceilingHit;
      ceiling.mesh.material.alpha = held ? 0.24 + 0.08 * Math.sin(t * 6) : 0.16;
    }

    if (fenceTest && state.fenceHit) {
      uav.limitLabel.set(
        `Geofence holding at ${state.uavMaxRadius.toFixed(1)} m of `
        + `${spec.geofence_radius_m.toFixed(0)} m`, COLOR.fail);
      uav.limitLabel.at(v.x, v.y + ground + 2.4, v.z);
      uav.limitLabel.show(true);
    } else if (ceilingTest && state.ceilingHit) {
      uav.limitLabel.set(
        `Ceiling holding at ${state.uavMaxAlt.toFixed(1)} m of `
        + `${spec.ceiling_m.toFixed(0)} m`, COLOR.fail);
      uav.limitLabel.at(v.x, v.y + ground + 2.4, v.z);
      uav.limitLabel.show(true);
    } else {
      uav.limitLabel.show(false);
    }
    void ox; void oz;
  }

  // --------------------------------------------------- what is happening --
  /* The parts of the submission that are a statement rather than a
   * measurement: the feedback lights, the two kill switches, the link loss.
   * A viewer watching the run should not have to read the panel to know that
   * the boat sitting still with a yellow light on the mast is the manual
   * feedback demonstration, so the run says so on the water.
   */
  const STEP_NOTE = {
    AUTONOMY_ON: ["Autonomy on, hands off the controller", COLOR.pass],
    FEEDBACK_AUTO: ["Visual feedback: AUTO, green", COLOR.pass],
    FEEDBACK_MANUAL: ["Visual feedback: MANUAL, yellow", COLOR.warn],
    KILL_ONBOARD: ["Onboard kill switch: thrusters stopped", COLOR.fail],
    KILL_REMOTE: ["Remote kill switch: thrusters stopped", COLOR.fail],
    SUBMERGE: ["Submerging for the gate", COLOR.uuv],
    SURFACE: ["Surfacing, run complete", COLOR.uuv],
    LINK_LOSS: ["Controller link lost", COLOR.fail],
    LINK_LOSS_RETURN: ["Returning home on link loss", COLOR.warn],
    LINK_LOSS_LAND: ["Landing itself on link loss", COLOR.warn],
  };

  // the UAV flies each element twice, so its steps carry a MANUAL_ or AUTO_
  const STEP_SUFFIX = {
    PREFLIGHT: ["Flight mode indicator on camera", COLOR.mark],
    TAKEOFF: ["Takeoff, above 3 m AGL", COLOR.uav],
    HOVER: ["Settling on the pattern altitude", COLOR.uav],
    PATTERN_SQUARE: ["Flying the square, points 1 to 4", COLOR.uav],
    PATTERN_HOURGLASS: ["Flying the hourglass", COLOR.uav],
    RETURN: ["Returning to the pad", COLOR.uav],
    LAND: ["Landing, aircraft safe", COLOR.uav],
  };

  function stepNote(step) {
    if (STEP_NOTE[step]) return STEP_NOTE[step];
    const cut = step.indexOf("_");
    if (cut > 0) {
      const tail = step.slice(cut + 1);
      if (STEP_SUFFIX[tail]) return STEP_SUFFIX[tail];
    }
    return null;
  }

  function buildNotes() {
    notes.step = readout("step-note", { width: 4.4 });
    notes.verdict = readout("run-verdict", { width: 4.4 });
  }

  function updateNotes(state) {
    const lead = { USV: "usv", UUV: "uuv", UAV: "uav" }[domain];
    const v = lead && state.vehicles[lead];
    if (!v) { notes.step.show(false); notes.verdict.show(false); return; }
    const base = lead === "usv" ? Math.max(v.y, 0)
      : (lead === "uav" ? v.y + ground : v.y);
    const top = base + (lead === "uuv" ? 1.5 : 2.9);

    // the verdict, once the run has finished, in the frame the video ends on
    if (state.step === "COMPLETE") {
      const mine = Object.entries(state.results)
        .filter(([id]) => id.indexOf(domain.toLowerCase() + ".") === 0);
      const failed = mine.filter(([, r]) => !r.passed).length;
      notes.verdict.set(
        failed
          ? `${domain} rehearsal FAIL  ${failed} of ${mine.length} criteria`
          : `${domain} rehearsal PASS  ${mine.length} of ${mine.length} criteria`,
        failed ? COLOR.fail : COLOR.pass);
      notes.verdict.at(v.x, top, v.z);
      notes.verdict.show(true);
      notes.step.show(false);
      return;
    }
    notes.verdict.show(false);

    const note = stepNote(state.step);
    notes.step.show(Boolean(note));
    if (note) {
      notes.step.set(note[0], note[1]);
      notes.step.at(v.x, top, v.z);
    }
  }

  // ------------------------------------------------------ the readouts --
  /* One line of telemetry beside whichever vehicle is flying the rehearsal,
   * so the picture can be read without the panel: what mode it is in and how
   * fast it is going, which together are most of what 3.1 asks a viewer to
   * see.
   */
  function buildReadouts() {
    ["usv", "uuv", "uav"].forEach(id => {
      readouts[id] = readout(id + "-telemetry", { width: 2.6 });
    });
  }

  const MODE_COLOR = { AUTO: COLOR.pass, MANUAL: COLOR.warn, KILLED: COLOR.fail };

  function updateReadouts(state) {
    const active = { USV: ["usv"], UUV: variant === "tethered" ? ["uuv", "usv"] : ["uuv"],
                     UAV: ["uav"], COMMS: [] }[domain] || [];
    Object.entries(readouts).forEach(([id, r]) => {
      const shown = active.indexOf(id) !== -1;
      r.show(shown);
      if (!shown) return;
      const v = state.vehicles[id];
      const speed = Math.abs(v.speed).toFixed(2);
      let line = `${v.mode}  ${speed} m/s`;
      // the UAV's height is on the line up from its shadow, and the ROV's is
      // on the column up to the surface, so neither is repeated here
      if (id === "uuv" && v.y > -0.1) line += "  on the surface";
      r.set(line, MODE_COLOR[v.mode] || COLOR.mark);
      // the ROV's caption goes down with it: clamped to the surface it would
      // float several metres over a vehicle nobody can see from up there
      const base = id === "usv" ? Math.max(v.y, 0)
        : (id === "uav" ? v.y + ground : v.y);
      r.at(v.x, base + (id === "uuv" ? 0.75 : 1.3), v.z);
    });
  }

  // ---------------------------------------------------------------- api --
  function build(babylonScene, config, helpers) {
    scene = babylonScene;
    cfg = config;
    api = helpers;
    buildTrack("usv", COLOR.usv);
    buildTrack("uuv", COLOR.uuv);
    buildTrack("uav", COLOR.uav, { ground: true });
    buildMarks();
    buildReadouts();
    buildNotes();
    buildUsv();
    buildUuv();
    buildUav();
    return { tracks, marks, notes, usv, uuv, uav };
  }

  /** A new run: throw away the last one's track and start again. */
  function reset(state) {
    Object.keys(tracks).forEach(id => {
      tracks[id].seeded = false;
      tracks[id].line.show(false);
      if (tracks[id].ground) tracks[id].ground.show(false);
      if (state && state.vehicles[id]) {
        const v = state.vehicles[id];
        seedTrack(id, v.x, id === "uuv" ? v.y : Math.max(v.y, 0.06), v.z);
      }
    });
    lastT = 0;
  }

  function setRun(nextDomain, nextVariant) {
    domain = nextDomain || "USV";
    variant = nextVariant || "standard";
    Por.showDomain(domain);
    reset();
  }

  /* Hold every caption at a readable size, the same way por.js does for the
   * course captions: a billboard is a fixed size in metres, and these are
   * looked at from three metres and from the far bank.
   */
  function scaleLabels(cameraPosition) {
    if (!cameraPosition) return;
    scaled.forEach(plane => {
      if (!plane.isEnabled()) return;
      const d = BABYLON.Vector3.Distance(cameraPosition, plane.position);
      // the floor is what a caption shrinks to when the camera is on top of
      // the vehicle: a 0.46 m ROV wants a smaller one than a bay does
      const scale = Math.min(3.2, Math.max(0.24, d * 0.019));
      plane.scaling.set(scale, scale, scale);
    });
  }

  function frame(state, dt) {
    if (!scene || !state) return;
    t += dt;
    ground = state.groundY || 0;
    // a restart winds the clock back, and the old track is not this run's
    if (state.t + 0.001 < lastT) reset(state);
    lastT = state.t;
    if (domain !== state.domain || variant !== state.variant) {
      setRun(state.domain, state.variant);
      reset(state);
    }

    const shown = { USV: ["usv"], UUV: variant === "tethered" ? ["uuv", "usv"] : ["uuv"],
                    UAV: ["uav"], COMMS: [] }[domain] || [];
    Object.keys(tracks).forEach(id => {
      const live = shown.indexOf(id) !== -1;
      tracks[id].line.show(live);
      if (tracks[id].ground) tracks[id].ground.show(live && id === "uav");
      if (live) sampleTrack(id, state.vehicles[id], dt);
      updateMark(id, state.vehicles[id], live && state.running);
    });

    updateReadouts(state);
    updateNotes(state);
    updateUsv(state);
    updateUuv(state);
    updateUav(state);
    scaleLabels(scene.activeCamera && scene.activeCamera.position);
  }

  return { build, frame, reset, setRun,
           get parts() { return { tracks, marks, notes, usv, uuv, uav }; } };
})();
