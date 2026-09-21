/* por.js: the three proof of readiness courses, built to handbook 3.1.
 *
 * These are not the competition course. Before a team may deploy anything at
 * RobotX 2026 it has to film an autonomous run on the courses RoboNation
 * specifies in 3.1, and those specifications are short and exact:
 *
 *   USV (3.1.2)  two pairs of red and green buoys standing about 1 m out of
 *                the water, 6 to 10 ft apart across the gate and 25 to 100 ft
 *                between the gates, the vehicle starting 3 m behind the first
 *   UUV (3.1.3)  a 2 m horizontal gate 1 m under the surface, anchored, with a
 *                vertical marker 10 m beyond it, the vehicle starting 3 m
 *                behind the gate and never breaching
 *   UAV (3.1.4)  a takeoff point, the published square and hourglass patterns
 *                on 10 m legs, a geofence and a ceiling that both have to hold
 *                when the pilot commands past them
 *
 * All three sit on one stretch of water with a bank along the north side for
 * the pilot and the pad, so an operator can walk between them without
 * reloading. Dimensions come from readiness.py, which reads them off the
 * handbook, so the scene is the course the video has to be shot on.
 */
"use strict";

const Por = (() => {
  let scene, cfg, api;
  const parts = {
    usv: { buoys: [], gates: [] },
    uuv: { gate: null, marker: null, legs: [] },
    uav: { pad: null, points: [], fence: null, ceiling: null, pilot: null },
  };

  const labels = [];
  const V3 = (x, y, z) => new BABYLON.Vector3(x, y, z);
  const C3 = hex => BABYLON.Color3.FromHexString(hex);

  /* Floating text, the same billboard the vehicles carry.
   *
   * The plane is a fixed 512 x 96 texture whatever the string is, so a long
   * caption on a narrow plane would run off the end. The font shrinks to fit
   * instead, which keeps every caption the same physical size on the water.
   */
  function label(name, text, position, opts = {}) {
    const width = opts.width || 2.4;
    // "usv-gate-0" belongs to the USV course, "pilot" to the UAV one
    const owner = opts.domain
      || (name.startsWith("usv") ? "USV"
         : name.startsWith("uuv") ? "UUV" : "UAV");
    const plane = BABYLON.MeshBuilder.CreatePlane("por-label-" + name,
      { width, height: width * 0.1875 }, scene);
    const tex = new BABYLON.DynamicTexture("por-label-tex-" + name,
      { width: 512, height: 96 }, scene, true);
    const ctx = tex.getContext();
    ctx.fillStyle = opts.background || "rgba(8,12,18,0.78)";
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = opts.accent || "#74c0fc";
    ctx.fillRect(0, 0, 10, 96);
    let size = 38;
    ctx.font = `bold ${size}px Segoe UI, sans-serif`;
    while (size > 16 && ctx.measureText(text).width > 462) {
      size -= 2;
      ctx.font = `bold ${size}px Segoe UI, sans-serif`;
    }
    ctx.fillStyle = "#e9ecef";
    ctx.fillText(text, 22, 48 + size * 0.35);
    tex.update();
    const m = new BABYLON.StandardMaterial("por-label-mat-" + name, scene);
    m.diffuseTexture = tex;
    m.diffuseTexture.hasAlpha = true;
    m.emissiveColor = new BABYLON.Color3(1, 1, 1);
    m.disableLighting = true;
    m.backFaceCulling = false;
    plane.material = m;
    plane.position.copyFrom(position);
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    plane.applyFog = false;
    plane.metadata = { domain: owner };
    labels.push(plane);
    return plane;
  }

  /* Caption only the course being rehearsed.
   *
   * All three courses share one stretch of water, so with every caption up at
   * once the frame carries thirty of them and the run is somewhere behind the
   * text. The props stay where they are; only the writing on them goes.
   */
  function showDomain(domain) {
    const want = domain === "COMMS" ? null : domain;
    labels.forEach(plane => {
      const owner = plane.metadata && plane.metadata.domain;
      plane.setEnabled(!want || owner === want);
    });
  }

  /* Hold every caption at a readable size on screen.
   *
   * A billboard has a fixed size in metres, so the caption on the start line
   * fills the frame when the camera is three metres from it and disappears
   * from the far bank. The vehicle labels already solve this by scaling with
   * range; the course captions do the same.
   */
  function frame(cameraPosition) {
    if (!cameraPosition) return;
    labels.forEach(plane => {
      if (!plane.isEnabled()) return;
      const d = BABYLON.Vector3.Distance(cameraPosition, plane.position);
      // these courses are metres across, not hundreds: a caption sized the
      // way the mission view sizes them covers the vehicle it is naming
      const scale = Math.min(2.6, Math.max(0.22, d * 0.013));
      plane.scaling.set(scale, scale, scale);
    });
  }

  /** A dashed line on the water, for gate lines and measured distances. */
  function guide(name, a, b, color, y = 0.06) {
    const pts = [V3(a[0], y, a[1]), V3(b[0], y, b[1])];
    const line = BABYLON.MeshBuilder.CreateDashedLines(name,
      { points: pts, dashSize: 3, gapSize: 2, dashNb: 60 }, scene);
    line.color = C3(color);
    line.alpha = 0.8;
    line.isPickable = false;
    return line;
  }

  // ------------------------------------------------------------- the site --
  /* A bank along the north side. The UAV patterns are flown from a pad on
   * land with the pilot behind it, which is how the handbook draws them, and
   * the two water courses sit south of it.
   */
  function buildBank() {
    const pond = cfg.layout.pond;
    const bankZ = 8.0;
    const depth = 70.0;
    const tex = Tex.canvas(scene, "por-bank", 512, 512, (ctx, w, h) => {
      ctx.fillStyle = "#46523a";                 // mown grass
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        ctx.fillStyle = `rgba(${56 + Math.random() * 34},${68 + Math.random() * 38},${42 + Math.random() * 24},0.5)`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3);
      }
      ctx.fillStyle = "#71736f";                 // the concrete apron at the water
      ctx.fillRect(0, h - 92, w, 92);
      ctx.fillStyle = "rgba(60,64,68,0.35)";
      for (let x = 0; x < w; x += 64) ctx.fillRect(x, h - 92, 3, 92);
    });
    const ground = BABYLON.MeshBuilder.CreateGround("por-bank",
      { width: pond.width, height: depth }, scene);
    ground.position.set(0, 0.12, bankZ + depth / 2);
    const m = new BABYLON.StandardMaterial("por-bank-mat", scene);
    m.diffuseTexture = Tex.aniso(tex, 8, 6);
    m.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
    ground.material = m;
    /* No shadows on the bank. The sun's shadow map covers a fraction of the
     * site, so a ground plane this size takes the shadow on one half and not
     * the other, and the seam reads as a wedge of different grass.
     */
    ground.receiveShadows = false;
    ground.isPickable = false;
    ground.freezeWorldMatrix();

    // the quay edge, so the bank has a thickness where it meets the water
    const edge = BABYLON.MeshBuilder.CreateBox("por-quay",
      { width: pond.width, height: 0.5, depth: 0.6 }, scene);
    edge.position.set(0, 0.0, bankZ);
    edge.material = api.mat("por-quay-mat", "#9a9c97");
    edge.isPickable = false;
    edge.freezeWorldMatrix();
  }

  /* The pilot, standing behind the pad on the flight line. A person in the
   * frame is what makes "the drone facing away from the pilot" mean anything,
   * and the handbook figure draws one.
   */
  function buildPilot(x, z) {
    const skin = api.mat("por-pilot-skin", "#c98d6b");
    const shirt = api.mat("por-pilot-shirt", "#2f4f6f");
    const legs = api.mat("por-pilot-legs", "#2b2f36");
    const body = BABYLON.MeshBuilder.CreateCylinder("por-pilot-body",
      { diameterTop: 0.34, diameterBottom: 0.4, height: 0.62, tessellation: 10 }, scene);
    body.position.set(x, 1.06, z);
    body.material = shirt;
    const head = BABYLON.MeshBuilder.CreateSphere("por-pilot-head",
      { diameter: 0.23, segments: 10 }, scene);
    head.position.set(x, 1.48, z);
    head.material = skin;
    const leg = BABYLON.MeshBuilder.CreateCylinder("por-pilot-legs",
      { diameter: 0.3, height: 0.76, tessellation: 10 }, scene);
    leg.position.set(x, 0.5, z);
    leg.material = legs;
    const rc = BABYLON.MeshBuilder.CreateBox("por-pilot-rc",
      { width: 0.32, height: 0.16, depth: 0.1 }, scene);
    rc.position.set(x, 1.16, z - 0.28);
    rc.material = api.mat("por-pilot-rc-mat", "#1b1f24", { emissive: "#0d1b2a" });
    [body, head, leg, rc].forEach(mesh => { mesh.isPickable = false; });
    parts.uav.pilot = { body, head, leg, rc };
    label("pilot", "Pilot, hands on the controller", V3(x, 2.2, z), { width: 3.0 });
  }

  // ------------------------------------------------------- USV PoR course --
  /* Two pairs of red and green buoys. The figure puts red to port and green
   * to starboard in the direction of travel, which is the opposite of the
   * competition course, so the buoys are placed the way 3.1.2 draws them and
   * not the way Task 1 does.
   */
  function buildUsvCourse() {
    const spec = cfg.courses.usv;
    const [ox, oz] = cfg.layout.usv.origin;
    const half = spec.gate_width_m / 2;

    const redMat = api.mat("por-buoy-red", "#c92a2a", { emissive: "#3b0a0a" });
    const greenMat = api.mat("por-buoy-green", "#2f9e44", { emissive: "#08300f" });

    [0, spec.gate_spacing_m].forEach((along, gateIndex) => {
      const z = oz + along;
      const gate = { index: gateIndex, z, west: ox - half, east: ox + half, buoys: [] };
      [[-half, redMat, "red"], [half, greenMat, "green"]].forEach(([side, material, colour]) => {
        const x = ox + side;
        // a spar buoy about 1 m out of the water, as 3.1.2 asks for
        const body = BABYLON.MeshBuilder.CreateCylinder(
          `por-usv-buoy-${gateIndex}-${colour}`,
          { diameterTop: 0.26, diameterBottom: 0.36, height: spec.buoy_freeboard_m,
            tessellation: 14 }, scene);
        body.position.set(x, spec.buoy_freeboard_m / 2, z);
        body.material = material;
        const collar = BABYLON.MeshBuilder.CreateTorus(
          `por-usv-collar-${gateIndex}-${colour}`,
          { diameter: 0.62, thickness: 0.16, tessellation: 14 }, scene);
        collar.position.set(x, 0.06, z);
        collar.material = material;
        const cap = BABYLON.MeshBuilder.CreateCylinder(
          `por-usv-cap-${gateIndex}-${colour}`,
          { diameterTop: 0, diameterBottom: 0.28, height: 0.22, tessellation: 12 }, scene);
        cap.position.set(x, spec.buoy_freeboard_m + 0.11, z);
        cap.material = material;
        [body, collar, cap].forEach(mesh => { mesh.isPickable = false; });
        const buoy = { x, z, colour, radius: 0.31, meshes: [body, collar, cap] };
        gate.buoys.push(buoy);
        parts.usv.buoys.push(buoy);
      });
      gate.line = guide(`por-usv-gate-${gateIndex}`, [ox - half, z], [ox + half, z], "#ffd43b");
      label(`usv-gate-${gateIndex}`, `Gate ${gateIndex + 1}: ${spec.gate_width_m.toFixed(1)} m`,
            V3(ox, 2.4, z), { width: 2.6, accent: "#ffd43b" });
      parts.usv.gates.push(gate);
    });

    const startZ = oz - spec.start_offset_m;
    guide("por-usv-start", [ox - 1.6, startZ], [ox + 1.6, startZ], "#74c0fc");
    label("usv-start", `Start, ${spec.start_offset_m.toFixed(0)} m behind the gate`,
          V3(ox, 1.3, startZ), { width: 3.4 });
    label("usv-title", "USV Proof of Readiness (3.1.2)",
          V3(ox, 4.6, oz + spec.gate_spacing_m / 2), { width: 4.6, accent: "#f59f00" });
  }

  // ------------------------------------------------------- UUV PoR course --
  /* A horizontal gate 2 m wide hung 1 m under the surface on two legs, moored
   * to the bed, and a vertical marker 10 m beyond it. The vehicle has to pass
   * under the bar, circle the marker and come back through, without ever
   * breaking the surface.
   */
  function buildUuvCourse() {
    const spec = cfg.courses.uuv;
    const [ox, oz] = cfg.layout.uuv.origin;
    const half = spec.gate_width_m / 2;
    const bedY = -(cfg.seabed_depth_m || 6);
    const pvc = api.mat("por-pvc", "#dee2e6", { emissive: "#20252b" });
    const anchorMat = api.mat("por-anchor", "#495057");

    // the bar itself, at 1 m depth
    const bar = BABYLON.MeshBuilder.CreateCylinder("por-uuv-gate-bar",
      { diameter: 0.09, height: spec.gate_width_m, tessellation: 10 }, scene);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(ox, -spec.gate_depth_m, oz);
    bar.material = pvc;
    bar.isPickable = false;

    // two legs down to the bed with a mooring block on each
    [-half, half].forEach((side, i) => {
      const legHeight = Math.abs(bedY) - spec.gate_depth_m;
      const leg = BABYLON.MeshBuilder.CreateCylinder(`por-uuv-gate-leg${i}`,
        { diameter: 0.07, height: legHeight, tessellation: 8 }, scene);
      leg.position.set(ox + side, -spec.gate_depth_m - legHeight / 2, oz);
      leg.material = pvc;
      leg.isPickable = false;
      const block = BABYLON.MeshBuilder.CreateBox(`por-uuv-block${i}`,
        { width: 0.55, height: 0.28, depth: 0.55 }, scene);
      block.position.set(ox + side, bedY + 0.14, oz);
      block.material = anchorMat;
      block.isPickable = false;
      parts.uuv.legs.push({ x: ox + side, z: oz, radius: 0.2 });
    });
    parts.uuv.gate = {
      x: ox, z: oz, half, depth: spec.gate_depth_m, bar,
    };

    // the marker, 10 m beyond the gate: a pole from the surface to the bed
    const markerZ = oz + spec.marker_distance_m;
    const pole = BABYLON.MeshBuilder.CreateCylinder("por-uuv-marker",
      { diameter: spec.marker_radius_m * 2, height: Math.abs(bedY) + 1.2, tessellation: 12 },
      scene);
    pole.position.set(ox, (0.6 - Math.abs(bedY)) / 2 + 0.3, markerZ);
    pole.material = api.mat("por-marker-mat", "#f76707", { emissive: "#3a1a02" });
    pole.isPickable = false;
    const flag = BABYLON.MeshBuilder.CreateBox("por-uuv-marker-flag",
      { width: 0.5, height: 0.32, depth: 0.02 }, scene);
    flag.position.set(ox + 0.25, 0.95, markerZ);
    flag.material = api.mat("por-marker-flag", "#f76707", { emissive: "#4a2103" });
    flag.isPickable = false;
    parts.uuv.marker = { x: ox, z: markerZ, radius: spec.marker_radius_m + 0.15, mesh: pole };

    /* The alternate course for a USV tethered to the UUV: the same 2 m gate
     * and the same marker 10 m beyond, but the gate is a pair of buoys
     * standing out of the water and reaching far enough below it for the ROV
     * to navigate by, so the tether cannot foul a submerged bar.
     */
    const altMat = api.mat("por-uuv-alt-buoy", "#f59f00", { emissive: "#3a2503" });
    const alt = [];
    [-half, half].forEach((side, i) => {
      const above = BABYLON.MeshBuilder.CreateCylinder(`por-uuv-alt-buoy${i}`,
        { diameterTop: 0.22, diameterBottom: 0.3, height: 0.8, tessellation: 12 }, scene);
      above.position.set(ox + side, 0.4, oz);
      above.material = altMat;
      const below = BABYLON.MeshBuilder.CreateCylinder(`por-uuv-alt-skirt${i}`,
        { diameter: 0.14, height: 1.8, tessellation: 10 }, scene);
      below.position.set(ox + side, -0.9, oz);
      below.material = altMat;
      alt.push(above, below);
    });
    parts.uuv.alternate = alt;
    setUuvCourse("standard");

    const startZ = oz - spec.start_offset_m;
    guide("por-uuv-start", [ox - 1.4, startZ], [ox + 1.4, startZ], "#74c0fc");
    parts.uuv.gate.line = guide("por-uuv-gateline", [ox - half, oz], [ox + half, oz], "#ffd43b");
    label("uuv-title", "UUV Proof of Readiness (3.1.3)",
          V3(ox, 4.6, oz + spec.marker_distance_m / 2), { width: 4.6, accent: "#4dabf7" });
    label("uuv-gate", `Gate: ${spec.gate_width_m.toFixed(0)} m wide, `
          + `${spec.gate_depth_m.toFixed(0)} m down`, V3(ox, 2.4, oz), { width: 3.2,
          accent: "#ffd43b" });
    label("uuv-marker", `Marker, ${spec.marker_distance_m.toFixed(0)} m beyond`,
          V3(ox, 1.6, markerZ), { width: 3.0, accent: "#f76707" });
    label("uuv-start", `Start, ${spec.start_offset_m.toFixed(0)} m behind the gate`,
          V3(ox, 1.3, startZ), { width: 3.4 });
  }

  // ------------------------------------------------------- UAV PoR course --
  /* The pad, the two published patterns, the geofence and the ceiling. The
   * fence and the ceiling are drawn because the run has to show the vehicle
   * refusing to cross them when it is commanded to.
   */
  function buildUavCourse() {
    const spec = cfg.courses.uav;
    const [ox, oz] = cfg.layout.uav.origin;

    const padTex = Tex.canvas(scene, "por-pad", 256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#1f6feb";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#e9ecef";
      ctx.lineWidth = 10;
      ctx.strokeRect(12, 12, w - 24, h - 24);
      ctx.beginPath();
      ctx.moveTo(w / 2, 30); ctx.lineTo(w - 30, h / 2);
      ctx.lineTo(w / 2, h - 30); ctx.lineTo(30, h / 2);
      ctx.closePath();
      ctx.stroke();
      ctx.font = "bold 34px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#e9ecef";
      ctx.fillText("START / END", w / 2, h / 2 + 12);
    });
    const pad = BABYLON.MeshBuilder.CreateGround("por-uav-pad",
      { width: 2.2, height: 2.2 }, scene);
    pad.position.set(ox, 0.14, oz);
    const padMat = new BABYLON.StandardMaterial("por-pad-mat", scene);
    padMat.diffuseTexture = padTex;
    padMat.specularColor = BABYLON.Color3.Black();
    pad.material = padMat;
    pad.isPickable = false;
    parts.uav.pad = { x: ox, z: oz };

    buildPilot(ox, oz - 4.5);

    // the two patterns, as numbered points with the legs drawn between them
    const colours = { square: "#e64980", hourglass: "#20c997" };
    Object.entries(spec.patterns).forEach(([name, points]) => {
      const world = points.map(p => [ox + p[0], oz + p[1]]);
      world.forEach((p, i) => {
        const post = BABYLON.MeshBuilder.CreateCylinder(`por-uav-${name}-post${i}`,
          { diameter: 0.16, height: 1.1, tessellation: 8 }, scene);
        post.position.set(p[0], 0.55, p[1]);
        // a material each: the rehearsal lights the posts one at a time as
        // the pattern is flown, and a shared one would light all four
        post.material = api.mat(`por-uav-post-${name}-${i}`, colours[name],
                                { emissive: colours[name] });
        post.isPickable = false;
        label(`${name}-${i}`, String(i + 1), V3(p[0], 1.5, p[1]),
              { width: 0.7, accent: colours[name] });
        parts.uav.points.push({
          pattern: name, index: i, x: p[0], z: p[1], mesh: post,
          colour: colours[name],
        });
      });
      // the order the legs are flown in, which is what makes a square a
      // square and an hourglass an hourglass
      const order = world.concat([world[0]]);
      const line = BABYLON.MeshBuilder.CreateLines(`por-uav-${name}-path`, {
        points: order.map(p => V3(p[0], spec.hover_alt_m, p[1])),
      }, scene);
      line.color = C3(colours[name]);
      line.alpha = 0.55;
      line.isPickable = false;
      parts.uav[name + "Path"] = line;
    });

    // the geofence, drawn as a wall so "commanded past the boundary" has
    // something to be refused by
    const fence = BABYLON.MeshBuilder.CreateCylinder("por-uav-geofence", {
      diameter: spec.geofence_radius_m * 2, height: 12, tessellation: 48,
      sideOrientation: BABYLON.Mesh.DOUBLESIDE,
    }, scene);
    fence.position.set(ox, 6, oz);
    const fenceMat = new BABYLON.StandardMaterial("por-fence-mat", scene);
    fenceMat.diffuseColor = C3("#ffd43b");
    fenceMat.emissiveColor = C3("#3a2f05");
    fenceMat.alpha = 0.12;
    fenceMat.backFaceCulling = false;
    fence.material = fenceMat;
    fence.isPickable = false;
    parts.uav.fence = { x: ox, z: oz, radius: spec.geofence_radius_m, mesh: fence };
    label("uav-fence", `Geofence, ${spec.geofence_radius_m.toFixed(0)} m`,
          V3(ox + spec.geofence_radius_m, 12.6, oz), { width: 3.0, accent: "#ffd43b" });

    // the ceiling, only worth drawing while the ceiling test is running
    const ceiling = BABYLON.MeshBuilder.CreateGround("por-uav-ceiling",
      { width: spec.geofence_radius_m * 2.4, height: spec.geofence_radius_m * 2.4 }, scene);
    ceiling.position.set(ox, spec.ceiling_m, oz);
    const ceilMat = new BABYLON.StandardMaterial("por-ceiling-mat", scene);
    ceilMat.diffuseColor = C3("#ff6b6b");
    ceilMat.emissiveColor = C3("#3a0d0d");
    ceilMat.alpha = 0.16;
    ceilMat.backFaceCulling = false;
    ceiling.material = ceilMat;
    ceiling.isPickable = false;
    ceiling.setEnabled(false);
    parts.uav.ceiling = { alt: spec.ceiling_m, mesh: ceiling };

    label("uav-title", "UAV Proof of Readiness (3.1.4)",
          V3(ox, 5.4, oz + 6), { width: 4.6, accent: "#e64980" });
  }

  // ---------------------------------------------------------------- build --
  function build(babylonScene, config, helpers) {
    scene = babylonScene;
    cfg = config;
    api = helpers;
    buildBank();
    buildUsvCourse();
    buildUuvCourse();
    buildUavCourse();
    return parts;
  }

  /* Standard course or the tethered pair alternate (3.1.3). Only one of the
   * two gates is in the water at a time, because only one of them is the
   * course being filmed.
   */
  function setUuvCourse(variant) {
    const tethered = variant === "tethered";
    const gate = parts.uuv.gate;
    if (gate && gate.bar) {
      gate.bar.setEnabled(!tethered);
      scene.meshes.forEach(m => {
        if (/^por-uuv-gate-leg|^por-uuv-block/.test(m.name)) m.setEnabled(!tethered);
      });
    }
    (parts.uuv.alternate || []).forEach(m => m.setEnabled(tethered));
    parts.uuv.variant = tethered ? "tethered" : "standard";
  }

  /** Show the ceiling plane only while something is testing it. */
  function showCeiling(on) {
    if (parts.uav.ceiling) parts.uav.ceiling.mesh.setEnabled(Boolean(on));
  }

  /** Highlight one pattern and dim the other, so the frame is unambiguous. */
  function showPattern(name) {
    Object.keys(cfg.courses.uav.patterns).forEach(key => {
      const line = parts.uav[key + "Path"];
      if (line) line.alpha = key === name ? 0.75 : 0.12;
    });
  }

  return { build, frame, showCeiling, showPattern, setUuvCourse, showDomain,
           get parts() { return parts; }, get labels() { return labels; } };
})();
