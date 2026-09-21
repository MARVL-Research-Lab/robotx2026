/* vehicles.js: procedural models of the three vehicles this team fields.
 *
 * Dimensions are the real hulls (BlueBoat 1.2 m x 0.94 m, BlueROV2
 * 0.46 x 0.34 x 0.25 m, a 0.62 m quad under the handbook's 7 kg limit), so a
 * vehicle sitting next to a 2 m delivery platform reads at the right size.
 * Everything is built from primitives and painted textures, since the course
 * network has no internet and this app ships no external assets.
 *
 * The BlueROV2 carries the most detail of the three. Task 2 happens where it
 * is, several metres down, and a vehicle that reads as a box at that range
 * tells the operator nothing about which way it is facing or what it is doing.
 *
 * Propellers: every rotor sits under a TransformNode already turned onto its
 * thrust axis, and render.js spins the rotor about its own local Y. That way a
 * thruster lying on its side still turns about the shaft rather than about the
 * world vertical.
 */
"use strict";

const Vehicles = (() => {
  let api = null;
  const C3 = hex => BABYLON.Color3.FromHexString(hex);

  function mat(scene, name, hex, opts = {}) {
    const found = scene.getMaterialByName(name);
    if (found) return found;
    const m = new BABYLON.StandardMaterial(name, scene);
    m.diffuseColor = C3(hex);
    m.specularColor = new BABYLON.Color3(0.14, 0.14, 0.14);
    if (opts.emissive) m.emissiveColor = C3(opts.emissive);
    if (opts.alpha !== undefined) { m.alpha = opts.alpha; }
    if (opts.spec !== undefined) { m.specularPower = opts.spec; }
    if (opts.texture) m.diffuseTexture = opts.texture;
    if (opts.unlit) { m.disableLighting = true; m.emissiveColor = C3(hex); }
    return m;
  }

  function box(scene, name, size, pos, material, parent, rot) {
    const m = BABYLON.MeshBuilder.CreateBox(name,
      { width: size[0], height: size[1], depth: size[2] }, scene);
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.material = material;
    m.parent = parent;
    return m;
  }

  function cyl(scene, name, dia, height, pos, material, parent, rot, tess) {
    const m = BABYLON.MeshBuilder.CreateCylinder(name,
      { diameter: dia, height, tessellation: tess || 20 }, scene);
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.material = material;
    m.parent = parent;
    return m;
  }

  function taper(scene, name, dTop, dBottom, height, pos, material, parent, rot, tess) {
    const m = BABYLON.MeshBuilder.CreateCylinder(name, {
      diameterTop: dTop, diameterBottom: dBottom, height, tessellation: tess || 16,
    }, scene);
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.material = material;
    m.parent = parent;
    return m;
  }

  /* A ducted thruster: shroud, hub, and a rotor that spins about the shaft.
   * `rot` turns the whole unit onto its thrust axis; the rotor turns inside it.
   */
  function thruster(scene, name, pos, rot, parent, opts) {
    const dia = opts.diameter;
    const dark = mat(scene, "thr-dark", "#2b3138", { spec: 40, emissive: "#0a0c0f" });
    const rotorMat = mat(scene, "thr-rotor", "#5b636d", { spec: 64, emissive: "#121519" });
    const node = new BABYLON.TransformNode(name, scene);
    node.position.set(pos[0], pos[1], pos[2]);
    if (rot) node.rotation.set(rot[0], rot[1], rot[2]);
    node.parent = parent;

    // shroud: a short open duct, drawn as two rings and a wall
    const shroud = BABYLON.MeshBuilder.CreateCylinder(name + "-shroud", {
      diameterTop: dia, diameterBottom: dia, height: opts.length,
      tessellation: 16, cap: BABYLON.Mesh.NO_CAP,
      sideOrientation: BABYLON.Mesh.DOUBLESIDE,
    }, scene);
    shroud.material = opts.shroudMat || dark;
    shroud.parent = node;
    for (const dy of [-opts.length / 2, opts.length / 2]) {
      const lip = BABYLON.MeshBuilder.CreateTorus(name + "-lip" + dy,
        { diameter: dia, thickness: dia * 0.13, tessellation: 16 }, scene);
      lip.position.y = dy;
      lip.material = opts.shroudMat || dark;
      lip.parent = node;
    }
    // motor body sitting in the duct on three stators
    cyl(scene, name + "-hub", dia * 0.48, opts.length * 0.8, [0, 0, 0], dark, node, null, 12);
    for (let i = 0; i < 3; i++) {
      box(scene, name + "-stator" + i, [dia * 0.5, 0.006, 0.012],
        [0, -opts.length * 0.35, 0], dark, node, [0, (i * Math.PI) / 3, 0]);
    }

    const rotor = new BABYLON.TransformNode(name + "-rotor", scene);
    rotor.parent = node;
    for (let i = 0; i < 3; i++) {
      const blade = BABYLON.MeshBuilder.CreateBox(name + "-blade" + i, {
        width: dia * 0.40, height: 0.005, depth: dia * 0.19,
      }, scene);
      blade.position.set(dia * 0.22, 0, 0);
      blade.rotation.z = 0.42;
      blade.material = rotorMat;
      const arm = new BABYLON.TransformNode(name + "-arm" + i, scene);
      arm.rotation.y = (i * Math.PI * 2) / 3;
      arm.parent = rotor;
      blade.parent = arm;
    }
    return { node, rotor, shroud };
  }

  /* ---------------------------------------------------------- BlueBoat --
   * Catamaran: two 1.2 m pontoons on a 0.94 m beam, a deck plate between them
   * carrying the payload and the battery, a sensor mast with the visual
   * feedback light on top (5.3.1 wants RED/YELLOW/GREEN visible through 360
   * degrees), a T200 on each pontoon, and the firefighting monitor Task 3
   * needs.
   */
  function blueBoat(scene) {
    const root = new BABYLON.TransformNode("usv", scene);
    const hullTex = Tex.panel(scene, "bb-hull", "#243039", "#5b6b78", "rgba(10,14,20,0.5)");
    const hull = mat(scene, "bb-hull", "#25313b", { texture: hullTex, spec: 72 });
    const deckTex = Tex.deckTread(scene, "bb", "#39424a", "#f0a500");
    const deck = mat(scene, "bb-deck", "#ffffff", { texture: deckTex, spec: 24 });
    const trim = mat(scene, "bb-trim", "#aeb6bd", { spec: 64 });
    const dark = mat(scene, "bb-dark", "#12161c", { spec: 40 });
    const stripe = mat(scene, "bb-stripe", "#f0a500", { emissive: "#3a2700" });

    const props = [];

    [-0.36, 0.36].forEach((z, i) => {
      const pontoon = BABYLON.MeshBuilder.CreateCapsule("bb-pontoon" + i, {
        height: 1.16, radius: 0.11, tessellation: 16, capSubdivisions: 8,
      }, scene);
      pontoon.rotation.z = Math.PI / 2;      // lie along x (forward)
      pontoon.position.set(0, 0.02, z);
      pontoon.material = hull;
      pontoon.parent = root;

      // fine bow, a chine strip along the waterline, and a skeg aft
      const bow = taper(scene, "bb-bow" + i, 0.015, 0.205, 0.3,
        [0.7, 0.02, z], hull, root, [0, 0, -Math.PI / 2]);
      void bow;
      box(scene, "bb-chine" + i, [1.1, 0.018, 0.03], [0, -0.035, z], stripe, root);
      box(scene, "bb-skeg" + i, [0.22, 0.1, 0.016], [-0.4, -0.1, z], hull, root);
      // grab handle on the outboard side
      for (const dx of [0.28, -0.18]) {
        box(scene, "bb-handle" + i + dx, [0.14, 0.02, 0.02],
          [dx, 0.085, z + (z > 0 ? 0.11 : -0.11)], trim, root);
      }

      const t = thruster(scene, "bb-thr" + i, [-0.63, -0.05, z],
        [0, 0, Math.PI / 2], root, { diameter: 0.1, length: 0.12 });
      props.push(t.rotor);
      // mount bracket tying the thruster to the transom
      box(scene, "bb-thrmount" + i, [0.1, 0.06, 0.02], [-0.57, -0.02, z], dark, root);
    });

    // deck plate, coamings, and the cross beams under it
    box(scene, "bb-deck", [0.98, 0.035, 0.64], [0, 0.13, 0], deck, root);
    for (const dz of [-0.33, 0.33]) {
      box(scene, "bb-beam" + dz, [0.1, 0.05, 0.72], [dz > 0 ? 0.3 : -0.3, 0.1, 0], trim, root);
    }
    box(scene, "bb-coaming-f", [0.02, 0.05, 0.64], [0.49, 0.16, 0], trim, root);
    box(scene, "bb-coaming-a", [0.02, 0.05, 0.64], [-0.49, 0.16, 0], trim, root);

    // payload enclosure with a lid and latches, and the battery box aft
    box(scene, "bb-payload", [0.42, 0.2, 0.34], [0.05, 0.25, 0], trim, root);
    box(scene, "bb-payload-lid", [0.44, 0.02, 0.36], [0.05, 0.36, 0], dark, root);
    for (const dz of [-0.15, 0.15]) {
      box(scene, "bb-latch" + dz, [0.03, 0.04, 0.02], [0.26, 0.33, dz], stripe, root);
    }
    box(scene, "bb-batt", [0.3, 0.14, 0.22], [-0.3, 0.22, 0], dark, root);
    box(scene, "bb-batt-lid", [0.32, 0.012, 0.24], [-0.3, 0.3, 0], trim, root);

    // sensor mast: camera head, GPS pucks, antenna whip, status dome
    cyl(scene, "bb-mast", 0.035, 0.5, [0.05, 0.6, 0], trim, root, null, 10);
    const head = box(scene, "bb-cam", [0.14, 0.09, 0.11], [0.12, 0.88, 0], dark, root);
    void head;
    const lens = cyl(scene, "bb-lens", 0.055, 0.02, [0.19, 0.88, 0], mat(scene, "bb-lens-mat", "#0a1a24",
      { emissive: "#12303f", spec: 128 }), root, [0, 0, Math.PI / 2], 14);
    void lens;
    for (const dz of [-0.09, 0.09]) {
      cyl(scene, "bb-gps" + dz, 0.07, 0.022, [-0.02, 0.85, dz], trim, root, null, 14);
    }
    cyl(scene, "bb-whip", 0.008, 0.34, [-0.06, 1.02, 0], dark, root, null, 6);

    const statusLight = BABYLON.MeshBuilder.CreateSphere("bb-status", { diameter: 0.11, segments: 10 }, scene);
    statusLight.position.set(0.05, 0.97, 0);
    statusLight.material = mat(scene, "bb-status-mat", "#2f9e44", { emissive: "#2f9e44" });
    statusLight.parent = root;
    cyl(scene, "bb-status-base", 0.075, 0.03, [0.05, 0.9, 0], dark, root, null, 12);

    // firefighting monitor: the nozzle Task 3 sprays from, on a short pedestal
    cyl(scene, "bb-monitor-base", 0.07, 0.08, [0.3, 0.19, 0], trim, root, null, 12);
    const nozzle = taper(scene, "bb-nozzle", 0.024, 0.05, 0.16,
      [0.37, 0.26, 0], dark, root, [0, 0, -Math.PI / 2.6], 12);

    return { root, statusLight, props, nozzle };
  }

  /* ---------------------------------------------------------- BlueROV2 --
   * 0.46 x 0.34 frame: two HDPE side panels between a top and bottom plate,
   * the acrylic electronics tube over the battery tube, four vectored
   * thrusters at the corners and two vertical in the middle, buoyancy foam on
   * top, a dome camera forward with a pair of lumen lights either side of it,
   * the magnetic probe Task 2 repairs with, the tether penetrator, and the RJE
   * ULB-350 locator beacon mounted vertically with the end cap down (5.3.2).
   */
  function blueRov(scene) {
    const root = new BABYLON.TransformNode("uuv", scene);
    const frameTex = Tex.panel(scene, "rov", "#2b3138", "#5b6772", "rgba(130,142,152,0.35)");
    const frame = mat(scene, "rov-frame", "#39404a", { texture: frameTex, spec: 48, emissive: "#0d1013" });
    const tube = mat(scene, "rov-tube", "#dce4ea", { alpha: 0.5, spec: 220, emissive: "#1b2530" });
    const guts = mat(scene, "rov-guts", "#2c8f4e", { emissive: "#0b2c15" });
    const foam = mat(scene, "rov-foam", "#2b93e6", { spec: 16, emissive: "#0a2338" });
    const dark = mat(scene, "rov-dark", "#232830", { spec: 40 });
    const alu = mat(scene, "rov-alu", "#b6bec6", { spec: 128, emissive: "#171b1f" });
    const trim = mat(scene, "rov-trim", "#f59f00", { emissive: "#4a3000" });

    // top and bottom plates, side panels, and the rails that tie them together
    box(scene, "rov-plate-b", [0.46, 0.012, 0.34], [0, -0.11, 0], frame, root);
    box(scene, "rov-plate-t", [0.46, 0.012, 0.30], [0, 0.11, 0], frame, root);
    [-0.16, 0.16].forEach((z, i) => {
      box(scene, "rov-side" + i, [0.30, 0.115, 0.008], [0, 0.02, z], frame, root);
      box(scene, "rov-rail" + i, [0.44, 0.022, 0.022], [0, -0.095, z], alu, root);
      // lightening holes cut in the side panel, drawn as recesses
      for (const dx of [-0.09, 0, 0.09]) {
        cyl(scene, "rov-hole" + i + dx, 0.05, 0.012, [dx, 0.02, z], dark, root,
          [Math.PI / 2, 0, 0], 12);
      }
    });

    // electronics enclosure: acrylic tube, a board inside it, alloy end caps
    cyl(scene, "rov-etube", 0.115, 0.29, [0, 0.035, 0], tube, root, [0, 0, Math.PI / 2], 24);
    box(scene, "rov-board", [0.2, 0.012, 0.07], [0, 0.02, 0], guts, root);
    cyl(scene, "rov-ecap-a", 0.122, 0.028, [-0.155, 0.035, 0], alu, root, [0, 0, Math.PI / 2], 24);
    const domeCap = BABYLON.MeshBuilder.CreateSphere("rov-dome",
      { diameter: 0.118, segments: 14, slice: 0.5 }, scene);
    domeCap.rotation.z = -Math.PI / 2;
    domeCap.position.set(0.145, 0.035, 0);
    domeCap.material = tube;
    domeCap.parent = root;
    // the camera behind the dome, tilted down a little the way pilots set it
    cyl(scene, "rov-camera", 0.045, 0.05, [0.115, 0.03, 0],
      mat(scene, "rov-cam-mat", "#0a0d10", { spec: 160 }), root, [0, 0, Math.PI / 2.3], 14);
    const lens = cyl(scene, "rov-lens", 0.03, 0.006, [0.14, 0.026, 0],
      mat(scene, "rov-lens-mat", "#0c2634", { emissive: "#123b52", spec: 256 }), root,
      [0, 0, Math.PI / 2.3], 14);
    void lens;

    // battery enclosure underneath, and the penetrator bulkhead aft
    cyl(scene, "rov-btube", 0.09, 0.25, [0, -0.062, 0], tube, root, [0, 0, Math.PI / 2], 20);
    box(scene, "rov-batt", [0.18, 0.05, 0.05], [0, -0.062, 0], dark, root);
    cyl(scene, "rov-bcap", 0.096, 0.022, [-0.135, -0.062, 0], alu, root, [0, 0, Math.PI / 2], 20);
    for (const dz of [-0.03, 0, 0.03]) {
      cyl(scene, "rov-pen" + dz, 0.012, 0.03, [-0.175, 0.035, dz], alu, root,
        [0, 0, Math.PI / 2], 8);
    }

    // buoyancy foam, cut away over the tube the way the real block is
    box(scene, "rov-foam", [0.33, 0.045, 0.115], [0, 0.15, 0.083], foam, root);
    box(scene, "rov-foam2", [0.33, 0.045, 0.115], [0, 0.15, -0.083], foam, root);

    // four vectored thrusters at 45 degrees, two vertical in the middle
    const props = [];
    [[0.165, 0.125, -Math.PI / 4], [0.165, -0.125, Math.PI / 4],
     [-0.165, 0.125, Math.PI / 4], [-0.165, -0.125, -Math.PI / 4]].forEach(([x, z, yaw], i) => {
      const t = thruster(scene, "rov-vec" + i, [x, -0.025, z],
        [Math.PI / 2, yaw, 0], root, { diameter: 0.078, length: 0.09 });
      props.push(t.rotor);
    });
    [[0.015, 0.135], [0.015, -0.135]].forEach(([x, z], i) => {
      const t = thruster(scene, "rov-vert" + i, [x, 0.055, z], null, root,
        { diameter: 0.078, length: 0.085 });
      props.push(t.rotor);
    });

    // ULB-350 locator beacon: vertical, end cap down, electronics unobstructed
    cyl(scene, "rov-beacon", 0.035, 0.16, [-0.13, 0.2, 0.105], trim, root, null, 14);
    cyl(scene, "rov-beacon-cap", 0.038, 0.02, [-0.13, 0.12, 0.105], dark, root, null, 14);
    box(scene, "rov-beacon-clip", [0.05, 0.02, 0.02], [-0.13, 0.135, 0.09], alu, root);

    // tether: the connector on the top plate and the first metre of cable,
    // positively buoyant so it lifts away astern (5.3.2)
    cyl(scene, "rov-tether-plug", 0.03, 0.05, [-0.18, 0.145, 0], alu, root, null, 12);
    const tetherPath = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      tetherPath.push(new BABYLON.Vector3(-0.2 - u * 1.5, 0.16 + u * u * 0.85, u * 0.25));
    }
    const tether = BABYLON.MeshBuilder.CreateTube("rov-tether",
      { path: tetherPath, radius: 0.011, tessellation: 6 }, scene);
    tether.material = mat(scene, "rov-tether-mat", "#e8590c", { spec: 32 });
    tether.parent = root;

    // the magnetic probe the pipeline repair is made with, on a short arm
    const armNode = new BABYLON.TransformNode("rov-arm", scene);
    armNode.position.set(0.16, -0.085, 0);
    armNode.parent = root;
    cyl(scene, "rov-arm-link", 0.02, 0.14, [0.06, 0, 0], alu, armNode, [0, 0, Math.PI / 2.6], 10);
    const probe = cyl(scene, "rov-probe", 0.05, 0.035, [0.135, -0.045, 0],
      mat(scene, "rov-probe-mat", "#e03131", { emissive: "#3a0a0a" }), armNode,
      [0, 0, Math.PI / 2], 14);

    // lumen lights either side of the dome, and the beams they throw
    const lampMat = mat(scene, "rov-lamp-mat", "#fff3bf", { emissive: "#fff3bf" });
    const lamps = [];
    const beams = [];
    [0.105, -0.105].forEach((z, i) => {
      cyl(scene, "rov-lamp-body" + i, 0.042, 0.07, [0.145, 0.095, z], alu, root,
        [0, 0, Math.PI / 2], 14);
      const face = cyl(scene, "rov-lamp" + i, 0.036, 0.008, [0.182, 0.095, z],
        lampMat, root, [0, 0, Math.PI / 2], 14);
      lamps.push(face);
      // the beam, a soft cone that only shows up under water
      const beam = BABYLON.MeshBuilder.CreateCylinder("rov-beam" + i, {
        diameterTop: 1.5, diameterBottom: 0.06, height: 3.2, tessellation: 16,
      }, scene);
      beam.rotation.z = -Math.PI / 2;
      beam.position.set(1.8, 0.06, z);
      const bm = new BABYLON.StandardMaterial("rov-beam-mat", scene);
      bm.diffuseColor = C3("#ffe8a8");
      bm.emissiveColor = C3("#6a5a2a");
      bm.disableLighting = true;
      bm.alpha = 0.10;
      bm.alphaMode = BABYLON.Engine.ALPHA_ADD;
      bm.backFaceCulling = false;
      beam.material = bm;
      beam.parent = root;
      beam.isPickable = false;
      beam.applyFog = false;
      beam.setEnabled(false);
      beams.push(beam);
    });

    const statusLight = BABYLON.MeshBuilder.CreateSphere("rov-status", { diameter: 0.06, segments: 8 }, scene);
    statusLight.position.set(-0.2, 0.17, 0);
    statusLight.material = mat(scene, "rov-status-mat", "#2f9e44", { emissive: "#2f9e44" });
    statusLight.parent = root;

    /* The lumens are a real light, not just a lit disc. Without it the ROV
     * casts nothing on the pipeline it is inches away from, and the whole
     * point of the dive view is watching it work on that pipeline.
     */
    const lumen = new BABYLON.SpotLight("rov-lumen",
      new BABYLON.Vector3(0.2, 0.05, 0),
      new BABYLON.Vector3(1, -0.18, 0), 1.5, 3, scene);
    lumen.diffuse = C3("#ffeec2");
    lumen.specular = C3("#3a352c");     // a bright specular blows out its own frame
    lumen.intensity = 0;
    lumen.range = 12;
    lumen.parent = root;

    return { root, statusLight, props, lamps, beams, probe, tether, arm: armNode, lumen };
  }

  /* -------------------------------------------------------- quadcopter --
   * 0.62 m across the motors, gimbal camera under the nose, a payload hook for
   * the resource tins, navigation lights (red to port, green to starboard) and
   * the water-activated recovery light every UAV has to carry (5.3.3).
   */
  function quad(scene) {
    const root = new BABYLON.TransformNode("uav", scene);
    // Against dark water a black airframe is a silhouette, so the shell is
    // lifted well off black and the arms are lighter still.
    const shellTex = Tex.panel(scene, "uav", "#39414b", "#6d7783", "rgba(150,160,172,0.3)");
    const body = mat(scene, "uav-body", "#3d454f", { texture: shellTex, spec: 96 });
    const arm = mat(scene, "uav-arm", "#6b747e", { spec: 64 });
    const accent = mat(scene, "uav-accent", "#e64980", { emissive: "#3a0e21" });
    const dark = mat(scene, "uav-dark", "#1a1e23", { spec: 40 });
    const bladeMat = mat(scene, "uav-prop-mat", "#3f474f", { alpha: 0.8, spec: 96 });

    box(scene, "uav-core", [0.24, 0.075, 0.18], [0, 0, 0], body, root);
    // canopy, so the airframe has a front and a back at a glance
    const canopy = BABYLON.MeshBuilder.CreateSphere("uav-canopy",
      { diameterX: 0.18, diameterY: 0.07, diameterZ: 0.15, segments: 10, slice: 0.5 }, scene);
    canopy.position.set(0.03, 0.036, 0);
    canopy.material = mat(scene, "uav-canopy-mat", "#e9ecef", { spec: 128 });
    canopy.parent = root;
    box(scene, "uav-batt", [0.16, 0.05, 0.12], [-0.01, -0.06, 0], accent, root);
    const nose = taper(scene, "uav-nose", 0.04, 0.14, 0.12, [0.16, 0, 0], body, root,
      [0, 0, -Math.PI / 2], 14);
    void nose;

    const props = [];
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz], i) => {
      const ax = sx * 0.2, az = sz * 0.2;
      const boom = BABYLON.MeshBuilder.CreateCylinder("uav-arm" + i,
        { diameter: 0.026, height: 0.3, tessellation: 10 }, scene);
      boom.position.set(ax * 0.55, 0, az * 0.55);
      boom.rotation.set(Math.PI / 2, Math.atan2(sx, sz), 0);
      boom.material = arm;
      boom.parent = root;
      // fairing where the boom meets the body
      box(scene, "uav-fair" + i, [0.06, 0.04, 0.05], [ax * 0.3, 0, az * 0.3], body, root,
        [0, -Math.atan2(sz, sx), 0]);

      cyl(scene, "uav-motor" + i, 0.048, 0.05, [ax, 0.035, az], dark, root, null, 14);
      cyl(scene, "uav-bell" + i, 0.052, 0.016, [ax, 0.06, az], arm, root, null, 14);

      // two tapered blades on a hub that render.js spins
      const rotor = new BABYLON.TransformNode("uav-rotor" + i, scene);
      rotor.position.set(ax, 0.072, az);
      rotor.parent = root;
      for (let b = 0; b < 2; b++) {
        const blade = BABYLON.MeshBuilder.CreateBox("uav-prop" + i + b, {
          width: 0.132, height: 0.0035, depth: 0.021,
        }, scene);
        blade.position.set(0.066, 0, 0);
        blade.rotation.x = 0.22;
        blade.material = bladeMat;
        const hubArm = new BABYLON.TransformNode("uav-hub" + i + b, scene);
        hubArm.rotation.y = b * Math.PI;
        hubArm.parent = rotor;
        blade.parent = hubArm;
      }
      props.push(rotor);

      const leg = BABYLON.MeshBuilder.CreateCylinder("uav-leg" + i,
        { diameter: 0.015, height: 0.15, tessellation: 8 }, scene);
      leg.position.set(ax * 0.62, -0.095, az * 0.62);
      leg.rotation.set(sz * 0.18, 0, -sx * 0.18);
      leg.material = arm;
      leg.parent = root;
      cyl(scene, "uav-foot" + i, 0.03, 0.012, [ax * 0.7, -0.168, az * 0.7], dark, root, null, 10);

      // navigation lights: red to port (-z), green to starboard (+z)
      const nav = BABYLON.MeshBuilder.CreateSphere("uav-nav" + i, { diameter: 0.022, segments: 6 }, scene);
      nav.position.set(ax, 0.012, az);
      nav.material = mat(scene, sz > 0 ? "uav-nav-stbd" : "uav-nav-port",
        sz > 0 ? "#22dd55" : "#ff2d2d", { emissive: sz > 0 ? "#22dd55" : "#ff2d2d" });
      nav.parent = root;
    });

    // two-axis gimbal under the nose
    const yoke = BABYLON.MeshBuilder.CreateTorus("uav-yoke",
      { diameter: 0.085, thickness: 0.008, tessellation: 14 }, scene);
    yoke.position.set(0.1, -0.07, 0);
    yoke.rotation.x = Math.PI / 2;
    yoke.material = arm;
    yoke.parent = root;
    const gimbal = BABYLON.MeshBuilder.CreateSphere("uav-gimbal",
      { diameter: 0.062, segments: 10 }, scene);
    gimbal.position.set(0.1, -0.082, 0);
    gimbal.material = dark;
    gimbal.parent = root;
    cyl(scene, "uav-gimbal-lens", 0.03, 0.008, [0.126, -0.086, 0],
      mat(scene, "uav-glass", "#0c2634", { emissive: "#123b52", spec: 256 }), root,
      [0, 0, Math.PI / 2], 12);

    // payload hook, and the tin it carries when a delivery is in progress
    box(scene, "uav-hook", [0.035, 0.06, 0.035], [-0.03, -0.1, 0], arm, root);
    const tin = BABYLON.MeshBuilder.CreateCylinder("uav-tin",
      { diameter: 0.084, height: 0.062, tessellation: 14 }, scene);
    tin.position.set(-0.03, -0.17, 0);
    tin.material = mat(scene, "uav-tin-mat", "#E8282B");
    tin.parent = root;
    tin.setEnabled(false);
    const line = cyl(scene, "uav-tin-line", 0.005, 0.05, [-0.03, -0.135, 0], arm, root, null, 6);
    line.setEnabled(false);

    const statusLight = BABYLON.MeshBuilder.CreateSphere("uav-status", { diameter: 0.045, segments: 8 }, scene);
    statusLight.position.set(-0.145, 0.05, 0);
    statusLight.material = mat(scene, "uav-status-mat", "#2f9e44", { emissive: "#2f9e44" });
    statusLight.parent = root;

    const beacon = BABYLON.MeshBuilder.CreateSphere("uav-beacon", { diameter: 0.036, segments: 6 }, scene);
    beacon.position.set(-0.145, -0.045, 0.055);
    beacon.material = mat(scene, "uav-beacon-mat", "#ffd43b", { emissive: "#ffd43b" });
    beacon.parent = root;

    /* `gearY` is how far the model's origin sits above the surface it is
     * standing on: the feet are at -0.168. An aircraft's altitude is measured
     * to the gear, so the renderer adds this to keep a landing on the pad
     * rather than in it.
     */
    return { root, statusLight, props, tin, tinLine: line, beacon, gearY: 0.17 };
  }

  const BUILDERS = { usv: blueBoat, uuv: blueRov, uav: quad };

  /** Build one vehicle plus its ground ring and floating label. */
  function build(scene, spec, helpers) {
    api = helpers || api;
    const built = BUILDERS[spec.id](scene);
    built.root.name = spec.id;

    /* Locator ring, scaled to the hull rather than to a fixed size. A 2.4 m
     * ring round a 0.46 m ROV filled the dive camera and read as the subject,
     * and at full emissive the glow layer and the bloom took it to white.
     */
    const ringDia = Math.max(1.1, spec.size[0] * 2.4);
    const ring = BABYLON.MeshBuilder.CreateTorus("ring-" + spec.id, {
      diameter: ringDia, thickness: ringDia * 0.035, tessellation: 44,
    }, scene);
    const dim = C3(spec.color).scale(0.5);
    const ringMat = new BABYLON.StandardMaterial("ring-mat-" + spec.id, scene);
    ringMat.disableLighting = true;
    ringMat.diffuseColor = dim;
    ringMat.emissiveColor = dim;
    ringMat.alpha = 0.5;
    ring.material = ringMat;
    ring.isPickable = false;
    if (api && api.glow) api.glow.addIncludedOnlyMesh(ring);

    // a second ring that pulses outward, so a vehicle can be picked out of the
    // buoy field from across the course
    const pulse = BABYLON.MeshBuilder.CreateTorus("pulse-" + spec.id, {
      diameter: 1, thickness: 0.03, tessellation: 44,
    }, scene);
    const pulseMat = new BABYLON.StandardMaterial("pulse-mat-" + spec.id, scene);
    pulseMat.disableLighting = true;
    pulseMat.diffuseColor = C3(spec.color).scale(0.42);
    pulseMat.emissiveColor = C3(spec.color).scale(0.42);
    pulseMat.alpha = 0.2;
    pulse.material = pulseMat;
    pulse.isPickable = false;
    pulse.ringDiameter = ringDia;

    const label = BABYLON.MeshBuilder.CreatePlane("label-" + spec.id,
      { width: 2.6, height: 0.5 }, scene);
    const tex = new BABYLON.DynamicTexture("label-tex-" + spec.id,
      { width: 512, height: 96 }, scene, true);
    const ctx = tex.getContext();
    ctx.fillStyle = "rgba(8,12,18,0.78)";
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = spec.color;
    ctx.fillRect(0, 0, 14, 96);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(0, 92, 512, 4);
    ctx.font = "bold 40px Segoe UI, sans-serif";
    ctx.fillStyle = "#e9ecef";
    ctx.fillText(`${spec.label}  ${spec.model}`, 28, 63);
    tex.update();
    const lmat = new BABYLON.StandardMaterial("label-mat-" + spec.id, scene);
    lmat.diffuseTexture = tex;
    lmat.diffuseTexture.hasAlpha = true;
    lmat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    lmat.disableLighting = true;
    lmat.backFaceCulling = false;
    label.material = lmat;
    label.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    label.isPickable = false;
    label.applyFog = false;

    return { spec, ...built, ring, pulse, label };
  }

  return { build };
})();
