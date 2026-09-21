/* underwater.js: everything below the waterline.
 *
 * Task 2 is an underwater task and the handbook is explicit that a UUV must
 * not breach the surface during a scoring run (5.3.2), so the survey and the
 * repair both happen down here and the operator has to be able to watch them.
 * That means the world below y = 0 has to be worth looking at:
 *
 *   the surface seen from underneath, as a bright moving ceiling
 *   caustics on the seabed, two layers scrolling against each other
 *   shafts of light coming down through the surface
 *   suspended particulate, so distance reads as distance
 *   a seabed with relief, rocks, weed and dropped junk on it
 *   the mooring lines that hold the buoy field, running down past the diver
 *   the pipeline in its stand, and the leak coming out of the damaged section
 *
 * Cost is kept down by merging the scatter into single meshes, freezing every
 * world matrix, and turning the particle systems off whenever the active
 * camera is above the water.
 */
"use strict";

const Underwater = (() => {
  let scene, cfg, api;
  let bed = null, causticsA = null, causticsB = null, ceiling = null;
  let causticOverlay = null;
  let effects = true;        // caustics, shafts and particulate, off together
  let shafts = [];
  let snow = null, snowNode = null;
  let leak = null;
  const bubblers = {};        // per vehicle id
  let enabled = false;

  const V3 = (x, y, z) => new BABYLON.Vector3(x, y, z);
  const bedY = () => -cfg.seabed_depth_m;

  /* Gentle relief on the bed. Deterministic, because the mooring blocks and
   * the pipeline stands have to sit on the same surface the ground draws. */
  function bedHeight(x, z) {
    return Math.sin(x * 0.035) * Math.cos(z * 0.028) * 0.38
         + Math.sin((x + z) * 0.013 + 1.2) * 0.55
         + Math.cos(x * 0.008 - z * 0.011) * 0.42;
  }

  // -------------------------------------------------------------- seabed --
  function buildSeabed() {
    // updatable, or the relief written below never reaches the GPU and the
    // bed renders as a flat plate with the rocks apparently floating over it
    bed = BABYLON.MeshBuilder.CreateGround("seabed",
      { width: 900, height: 900, subdivisions: 90, updatable: true }, scene);
    const verts = bed.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    for (let i = 0; i < verts.length; i += 3) {
      verts[i + 1] = bedHeight(verts[i], verts[i + 2]);
    }
    bed.updateVerticesData(BABYLON.VertexBuffer.PositionKind, verts);
    bed.createNormals(false);
    bed.position.y = bedY();

    // 900 m over 70 tiles puts a sand ripple every 1.4 m, which is the scale
    // that still reads at the 10 to 40 m the UUV works at
    const sand = Tex.aniso(Tex.seabed(scene), 16, 70);
    const m = new BABYLON.StandardMaterial("bedmat", scene);
    m.diffuseTexture = sand;
    m.specularColor = new BABYLON.Color3(0.03, 0.04, 0.04);
    // first caustic layer rides the bed itself, so it follows the relief
    const c1 = Tex.aniso(Tex.caustics(scene, 1), 16, 165);
    m.emissiveTexture = c1;
    m.emissiveColor = new BABYLON.Color3(0.60, 0.80, 0.72);
    bed.material = m;
    bed.isPickable = false;
    causticsA = c1;

    // second layer, a copy of the bed lifted clear and blended additively:
    // two nets sliding across each other is what makes caustics look alive
    const overlay = bed.clone("seabed-caustics");
    overlay.position.y = bedY() + 0.06;
    const om = new BABYLON.StandardMaterial("bed-caustic-mat", scene);
    const c2 = Tex.aniso(Tex.caustics(scene, 7), 16, 118);
    om.diffuseTexture = c2;
    om.emissiveTexture = c2;
    om.opacityTexture = c2;
    om.disableLighting = true;
    om.emissiveColor = new BABYLON.Color3(0.46, 0.66, 0.60);
    om.alphaMode = BABYLON.Engine.ALPHA_ADD;
    om.backFaceCulling = true;
    overlay.material = om;
    overlay.isPickable = false;
    overlay.receiveShadows = false;
    causticsB = c2;
    causticOverlay = overlay;
  }

  /* Rocks, weed and dropped junk, merged down to a handful of meshes. */
  function buildBedDressing() {
    const rockMat = api.mat("bed-rock", "#6b7368", { emissive: "#1a2422" });
    const weedMat = api.mat("bed-weed", "#356a42", { emissive: "#12301c" });
    const junkMat = api.mat("bed-junk", "#474d51", { emissive: "#161c1f" });

    let seed = 20260807;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    const rocks = [];
    for (let i = 0; i < 90; i++) {
      const x = (rnd() - 0.5) * 260, z = (rnd() - 0.5) * 200;
      const r = 0.16 + rnd() * 0.5;
      const rock = BABYLON.MeshBuilder.CreatePolyhedron("rock" + i, { type: 1, size: r }, scene);
      // sunk in a little, the way a stone on a silt bed sits
      rock.position.set(x, bedY() + bedHeight(x, z) + r * 0.15, z);
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      rock.scaling.set(1, 0.45 + rnd() * 0.4, 1 + rnd() * 0.5);
      rocks.push(rock);
    }
    const rockMesh = BABYLON.Mesh.MergeMeshes(rocks, true, true, undefined, false, false);
    if (rockMesh) { rockMesh.name = "bed-rocks"; rockMesh.material = rockMat; rockMesh.receiveShadows = true; }

    const blades = [];
    for (let c = 0; c < 55; c++) {
      const cx = (rnd() - 0.5) * 240, cz = (rnd() - 0.5) * 180;
      for (let b = 0; b < 6; b++) {
        const x = cx + (rnd() - 0.5) * 1.6, z = cz + (rnd() - 0.5) * 1.6;
        const hgt = 0.7 + rnd() * 1.5;
        const blade = BABYLON.MeshBuilder.CreateCylinder("weed" + c + "-" + b,
          { diameterTop: 0.02, diameterBottom: 0.09, height: hgt, tessellation: 4 }, scene);
        blade.position.set(x, bedY() + bedHeight(x, z) + hgt / 2, z);
        blade.rotation.set((rnd() - 0.5) * 0.5, rnd() * 3, (rnd() - 0.5) * 0.5);
        blades.push(blade);
      }
    }
    const weedMesh = BABYLON.Mesh.MergeMeshes(blades, true, true, undefined, false, false);
    if (weedMesh) { weedMesh.name = "bed-weed"; weedMesh.material = weedMat; }

    // dropped junk: a tyre, a length of chain, a crate. Marina Bay is a
    // working harbour and a clean seabed looks like a render.
    const junk = [];
    const tyre = BABYLON.MeshBuilder.CreateTorus("junk-tyre",
      { diameter: 1.1, thickness: 0.34, tessellation: 14 }, scene);
    tyre.position.set(-14, bedY() + bedHeight(-14, -34) + 0.18, -34);
    tyre.rotation.x = 0.12;
    junk.push(tyre);
    for (let i = 0; i < 14; i++) {
      const link = BABYLON.MeshBuilder.CreateTorus("junk-link" + i,
        { diameter: 0.36, thickness: 0.09, tessellation: 8 }, scene);
      const x = 8 + i * 0.28, z = -36 + Math.sin(i * 0.6) * 1.4;
      link.position.set(x, bedY() + bedHeight(x, z) + 0.1, z);
      link.rotation.set(Math.PI / 2, i * 0.9, 0);
      junk.push(link);
    }
    const crate = BABYLON.MeshBuilder.CreateBox("junk-crate", { width: 1.2, height: 0.8, depth: 0.9 }, scene);
    crate.position.set(38, bedY() + bedHeight(38, -20) + 0.4, -20);
    crate.rotation.y = 0.7;
    crate.rotation.z = 0.14;
    junk.push(crate);
    const junkMesh = BABYLON.Mesh.MergeMeshes(junk, true, true, undefined, false, false);
    if (junkMesh) { junkMesh.name = "bed-junk"; junkMesh.material = junkMat; junkMesh.receiveShadows = true; }
  }

  // ------------------------------------------------------------- ceiling --
  /* The surface, seen from below. Beyond Snell's window water is a mirror, so
   * this is an opaque bright sheet rather than a view of the sky, with the
   * same normal map the surface uses so the two agree about where the waves
   * are. It faces down, so from above it is back-face culled and invisible.
   */
  function buildCeiling() {
    ceiling = BABYLON.MeshBuilder.CreateGround("water-under",
      { width: 1200, height: 1200, subdivisions: 1 }, scene);
    // CreateGround has no sideOrientation option, so turn the mesh over
    // instead. Face culling then hides it from above, which is what keeps it
    // from covering the seabed when the camera is in the air.
    ceiling.rotation.x = Math.PI;
    ceiling.position.y = -0.06;
    const m = new BABYLON.StandardMaterial("water-under-mat", scene);
    m.diffuseColor = api.C3("#0e4d63");
    m.emissiveColor = api.C3("#2d7f9c");
    m.specularColor = api.C3("#eaf6ff");
    m.specularPower = 64;
    // its own instance: the surface material owns the shared chop texture's
    // tiling, and two owners means whichever builds last wins
    m.bumpTexture = Tex.aniso(Tex.chopNormals(scene).clone(), 16, 300);
    m.backFaceCulling = true;
    ceiling.material = m;
    ceiling.isPickable = false;
    ceiling.applyFog = true;
    ceiling.setEnabled(false);
  }

  /* Shafts of light through the surface. Flat planes with a vertical gradient,
   * added rather than blended, turned to face the camera about Y only so they
   * keep their vertical axis.
   */
  function buildShafts() {
    /* A shaft has to fade out sideways as well as downward. The first pass
     * only faded down the height, and a plane with hard vertical edges reads
     * as a lit panel hanging in the water rather than as light coming through
     * a wave.
     */
    const tex = Tex.canvas(scene, "tex-shaft", 64, 256, (ctx, w, h) => {
      // no base fill: the canvas starts transparent and the gradients below
      // are what write the alpha the opacity texture reads
      for (let x = 0; x < w; x++) {
        const u = (x / (w - 1)) * 2 - 1;             // -1 at the edges
        const across = Math.pow(Math.max(0, 1 - u * u), 1.6);
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0.00, `rgba(200,240,255,${0.34 * across})`);
        g.addColorStop(0.30, `rgba(160,215,245,${0.15 * across})`);
        g.addColorStop(1.00, "rgba(120,190,225,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, 1, h);
      }
      // a few brighter filaments, so a shaft is a bundle rather than a wash
      for (let i = 0; i < 10; i++) {
        const x = w * (0.2 + Math.random() * 0.6);
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, `rgba(255,255,255,${0.06 + Math.random() * 0.08})`);
        g.addColorStop(0.7, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, 1 + Math.random() * 1.5, h);
      }
    });
    const m = new BABYLON.StandardMaterial("shaft-mat", scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex;
    m.opacityTexture = tex;
    m.disableLighting = true;
    m.emissiveColor = new BABYLON.Color3(0.34, 0.5, 0.6);
    m.alphaMode = BABYLON.Engine.ALPHA_ADD;
    m.backFaceCulling = false;

    shafts = [];
    let seed = 4711;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 40; i++) {
      const depth = cfg.seabed_depth_m + 0.4;
      const plane = BABYLON.MeshBuilder.CreatePlane("shaft" + i,
        { width: 0.7 + rnd() * 1.8, height: depth }, scene);
      plane.material = m;
      plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
      plane.isPickable = false;
      plane.applyFog = false;
      plane.position.set((rnd() - 0.5) * 160, -depth / 2 + 0.2, (rnd() - 0.5) * 130);
      plane.setEnabled(false);
      shafts.push({ mesh: plane, phase: rnd() * 6.28, home: plane.position.clone() });
    }
  }

  // ----------------------------------------------------------- particles --
  /* Marine snow. The emitter is parked on the active camera so the viewer is
   * always inside the cloud, which is the only way a handful of particles can
   * stand in for a whole water column.
   */
  function buildSnow() {
    snowNode = new BABYLON.TransformNode("snow-src", scene);
    snow = new BABYLON.ParticleSystem("snow", 700, scene);
    snow.particleTexture = Tex.sprite(scene, "snow", "rgba(255,255,255,0.9)", "rgba(200,225,235,0.35)");
    snow.emitter = snowNode;
    snow.minEmitBox = V3(-16, -9, -16);
    snow.maxEmitBox = V3(16, 9, 16);
    snow.minSize = 0.015; snow.maxSize = 0.075;
    snow.minLifeTime = 5; snow.maxLifeTime = 11;
    snow.emitRate = 130;
    snow.gravity = V3(0, -0.05, 0);
    snow.direction1 = V3(-0.06, -0.04, -0.06);
    snow.direction2 = V3(0.06, 0.01, 0.06);
    snow.minEmitPower = 0.01; snow.maxEmitPower = 0.06;
    snow.color1 = new BABYLON.Color4(0.85, 0.93, 0.95, 0.55);
    snow.color2 = new BABYLON.Color4(0.7, 0.85, 0.9, 0.35);
    snow.colorDead = new BABYLON.Color4(0.7, 0.85, 0.9, 0);
    snow.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    snow.renderingGroupId = 1;         // see the note in scene.js init
  }

  /** A rising bubble stream, parented to something that moves. */
  function bubbleStream(name, emitter, rate, size) {
    const ps = new BABYLON.ParticleSystem(name, 260, scene);
    ps.particleTexture = Tex.bubble(scene);
    ps.emitter = emitter;
    ps.minEmitBox = V3(-0.12, 0, -0.12);
    ps.maxEmitBox = V3(0.12, 0, 0.12);
    ps.minSize = size * 0.4; ps.maxSize = size;
    ps.minLifeTime = 2.2; ps.maxLifeTime = 5.0;
    ps.emitRate = rate;
    ps.gravity = V3(0, 0.55, 0);            // bubbles fall upward
    ps.direction1 = V3(-0.12, 0.5, -0.12);
    ps.direction2 = V3(0.12, 0.9, 0.12);
    ps.minEmitPower = 0.2; ps.maxEmitPower = 0.6;
    ps.minAngularSpeed = 0; ps.maxAngularSpeed = 1.5;
    ps.color1 = new BABYLON.Color4(0.85, 0.95, 1, 0.42);
    ps.color2 = new BABYLON.Color4(0.75, 0.9, 1, 0.28);
    ps.colorDead = new BABYLON.Color4(0.8, 0.92, 1, 0);
    ps.renderingGroupId = 1;           // see the note in scene.js init
    return ps;
  }

  /* The damaged pipeline section leaks. It is the one thing in the scene that
   * says which segment is broken without reading the ring light, and it gives
   * the UUV something to be looking at while it holds the probe on.
   */
  function buildLeak(pos) {
    const node = new BABYLON.TransformNode("leak-src", scene);
    node.position.copyFrom(pos);
    leak = bubbleStream("leak", node, 90, 0.055);
    leak.minLifeTime = 3.0; leak.maxLifeTime = 6.5;
    leak.gravity = V3(0, 0.8, 0);
    leak.direction1 = V3(-0.25, 0.7, -0.25);
    leak.direction2 = V3(0.25, 1.2, 0.25);
  }

  /* Mooring: every buoy in the field is on a line to a block on the bed. From
   * underneath, those lines are what tell you where the course is.
   */
  function buildMoorings(points) {
    const lineMat = api.mat("moor-line", "#98a5a0", { emissive: "#1d2624" });
    const blockMat = api.mat("moor-block", "#4a5350");
    const blocks = [];
    points.forEach(([x, z], i) => {
      const y0 = bedY() + bedHeight(x, z);
      // a lazy catenary rather than a taut line, offset so it is not vertical
      const path = [];
      const dx = Math.sin(i * 1.7) * 1.6, dz = Math.cos(i * 2.3) * 1.6;
      for (let k = 0; k <= 8; k++) {
        const u = k / 8;
        path.push(V3(x + dx * u * u, -0.05 + (y0 + 0.25 + 0.05) * u, z + dz * u * u));
      }
      const line = BABYLON.MeshBuilder.CreateTube("moor" + i,
        { path, radius: 0.025, tessellation: 5 }, scene);
      line.material = lineMat;
      line.isPickable = false;
      const block = BABYLON.MeshBuilder.CreateBox("moor-block" + i,
        { width: 0.7, height: 0.34, depth: 0.7 }, scene);
      block.position.set(x + dx, y0 + 0.17, z + dz);
      block.rotation.y = i * 0.4;
      blocks.push(block);
    });
    const merged = BABYLON.Mesh.MergeMeshes(blocks, true, true, undefined, false, false);
    if (merged) { merged.name = "moor-blocks"; merged.material = blockMat; merged.receiveShadows = true; }
  }

  // ---------------------------------------------------------------- api --
  function build(babylonScene, config, helpers) {
    scene = babylonScene;
    cfg = config;
    api = helpers;

    buildSeabed();
    buildBedDressing();
    buildCeiling();
    buildShafts();
    buildSnow();

    /* Moorings and the pipeline leak belong to the competition course. The
     * readiness scene shares the seabed and the light but has neither, so
     * both are built only when the layout carries them.
     */
    const moorPoints = ((cfg.task1 && cfg.task1.buoys) || []).map(b => b.pos)
      .concat(((cfg.task2 && cfg.task2.buoys) || []).map(b => b.pos));
    if (moorPoints.length) buildMoorings(moorPoints);

    const pipeline = cfg.task2 && cfg.task2.pipeline;
    if (pipeline) {
      // leak at the midpoint of the damaged pipeline section
      const nodes = pipeline.nodes;
      const d = pipeline.damaged_segment;
      const a = nodes[d], b = nodes[d + 1];
      const y = bedY() + pipeline.height_above_bed_m;
      buildLeak(V3((a[0] + b[0]) / 2, y + 0.05, (a[1] + b[1]) / 2));
    }

    scene.meshes.forEach(m => {
      if (/^(seabed|bed-|moor|shaft|water-under)/.test(m.name)) {
        m.isPickable = false;
        if (!/^shaft/.test(m.name)) m.freezeWorldMatrix();
      }
    });
  }

  /** Give a vehicle a thruster bubble stream that follows it. */
  function attachBubbles(id, node) {
    if (bubblers[id]) return bubblers[id];
    const ps = bubbleStream("bubbles-" + id, node, 70, 0.032);
    ps.minLifeTime = 1.4; ps.maxLifeTime = 3.4;
    ps.color1 = new BABYLON.Color4(0.8, 0.92, 1, 0.30);
    ps.color2 = new BABYLON.Color4(0.7, 0.86, 1, 0.18);
    bubblers[id] = ps;
    return ps;
  }

  /** One-off puff, for the moment the vehicle breaks the surface going down. */
  function burst(position, count) {
    const node = new BABYLON.TransformNode("burst-src", scene);
    node.position.copyFrom(position);
    const ps = bubbleStream("burst", node, 0, 0.13);
    ps.minLifeTime = 1.6; ps.maxLifeTime = 3.2;
    ps.manualEmitCount = count;
    ps.disposeOnStop = true;
    ps.start();
    ps.targetStopDuration = 0.2;
    setTimeout(() => { node.dispose(); }, 6000);
  }

  /** Everything below the surface, stepped once a frame. */
  function frame(t, dt, cameraY, uuv) {
    const below = cameraY < 0.15;

    // caustics: two nets sliding in different directions at different rates
    if (causticsA) {
      causticsA.uOffset = t * 0.011;
      causticsA.vOffset = t * 0.0075;
    }
    if (causticsB) {
      causticsB.uOffset = -t * 0.0065 + 0.31;
      causticsB.vOffset = t * 0.0125;
    }

    if (below !== enabled) {
      enabled = below;
      if (snow) { if (below && effects) snow.start(); else snow.stop(); }
      shafts.forEach(s => s.mesh.setEnabled(below && effects));
      if (ceiling) ceiling.setEnabled(below);
    }

    if (below) {
      // keep the particulate around the viewer, and sway the shafts
      const cam = scene.activeCamera;
      if (snowNode && cam) snowNode.position.copyFrom(cam.position);
      shafts.forEach(s => {
        s.mesh.position.x = s.home.x + Math.sin(t * 0.21 + s.phase) * 1.5;
        s.mesh.position.z = s.home.z + Math.cos(t * 0.17 + s.phase) * 1.5;
        s.mesh.rotation.z = Math.sin(t * 0.3 + s.phase) * 0.035;
      });
    }

    // the leak runs whenever anyone can see it, which is cheap enough
    if (leak) {
      const wantLeak = below || (uuv && uuv.y < -1);
      if (wantLeak && !leak.isStarted()) leak.start();
      else if (!wantLeak && leak.isStarted()) leak.stop();
    }

    void dt;
  }

  /* Caustics, shafts and particulate. All three are cheap on a desktop GPU
   * and expensive on an integrated one, and the caustic nets are the first
   * thing to go when someone needs to read the pipeline lights instead of
   * looking at the water, so they come off together.
   */
  function setEffects(on) {
    effects = Boolean(on);
    if (causticsA) causticsA.level = effects ? 1 : 0;
    if (causticOverlay) causticOverlay.setEnabled(effects);
    shafts.forEach(s => s.mesh.setEnabled(effects && enabled));
    if (snow) {
      if (!effects && snow.isStarted()) snow.stop();
      else if (effects && enabled && !snow.isStarted()) snow.start();
    }
  }

  return { build, frame, attachBubbles, burst, bedHeight, setEffects,
           get effectsOn() { return effects; },
           get bubblers() { return bubblers; },
           get leakSystem() { return leak; } };
})();
