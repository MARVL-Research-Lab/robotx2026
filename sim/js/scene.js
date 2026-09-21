/* scene.js: the Babylon world. Marina Bay water and sky, the course elements
 * from handbook 3.5, and the three vehicles.
 *
 * Frame: metres, +x east, +z north, +y up, origin at the centre of the
 * operating area. Everything is built from primitives and painted textures so
 * the app runs with no network at all (handbook 3.4.2).
 *
 * This file owns the world above the waterline and the course hardware.
 * landmarks.js has the skyline, underwater.js has everything below y = 0,
 * vehicles.js has the three craft, and render.js drives all of it per frame.
 */
"use strict";

const World = (() => {
  let engine, scene, camera, cfg, glow, pipeline, sun, skyLight, shadows;
  let water, waterFar, waterVerts, waterBase, waterMat;
  let chopTex;
  let sunDisk = null, sunGlare = null;
  const skyMeshes = [];        // hidden the moment the camera goes under
  const cloudMeshes = [];
  const vehicles = {};
  const buoys = {};
  const indicators = {};
  const pipelineLights = [];
  let dockLights = [];
  let incidentMarker = null, keepoutRing = null, movingObject = null, diveMarker = null;
  let spray = null;
  let underwater = false;
  let waveScale = 1.0;
  let mode = "course";
  const wakes = {};
  const clock = { t: 0 };

  const C3 = hex => BABYLON.Color3.FromHexString(hex);
  const BEACON_COLORS = {
    OFF: "#15181d",
    FLASHING_RED: "#ff2d2d",
    FLASHING_GREEN: "#22dd55",
    FLASHING_BLUE: "#2b6cff",
    STEADY_BLUE: "#2b6cff",
  };

  // The sun sits low and to the north west: the finals run late in the day and
  // a low sun is what puts a glitter path on the water.
  const SUN_DIR = new BABYLON.Vector3(-0.52, -0.42, 0.74);

  /* The water at full strength. visuals.js dials between these and the calm
   * end of each one, so the glitter path and the reflected sky can be turned
   * down without the bay losing its colour.
   */
  const WATER_DIFFUSE = "#2f6377";      // the water's own colour, lit by the sun
  const WATER_SPECULAR = "#fff3dc";     // the sun's own colour in the chop
  const WATER_SKY = "#a8c8e2";          // sky returned at a grazing angle
  const WATER_SKY_CALM = "#41697f";     // the same angle with the sky dialled out
  const FOG_AIR = 0.00062;
  const FOG_SEA = 0.032;

  function mat(name, hex, opts = {}) {
    // Names are the cache key. Anything render.js recolours per frame is
    // created under a per-instance name, so sharing here is safe.
    const found = scene.getMaterialByName(name);
    if (found) return found;
    const m = new BABYLON.StandardMaterial(name, scene);
    m.diffuseColor = C3(hex);
    m.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    if (opts.emissive) m.emissiveColor = C3(opts.emissive);
    if (opts.alpha !== undefined) m.alpha = opts.alpha;
    if (opts.spec !== undefined) m.specularPower = opts.spec;
    if (opts.unlit) { m.disableLighting = true; m.emissiveColor = C3(hex); }
    return m;
  }

  /** Lit material carrying a painted texture, for facades and hull plating. */
  function texMat(name, hex, texture, opts = {}) {
    const m = mat(name, hex, opts);
    m.diffuseTexture = texture;
    if (opts.emissiveTexture) m.emissiveTexture = texture;
    return m;
  }

  function canvasTex(name, size, draw) {
    const w = size.width || size, h = size.height || size;
    return Tex.canvas(scene, name, w, h, draw);
  }

  // The helper bundle the other modules build against.
  const api = { get mat() { return mat; }, get texMat() { return texMat; }, C3 };

  // ---------------------------------------------------------------- sky --
  function buildSky() {
    const dome = BABYLON.MeshBuilder.CreateSphere("sky",
      { diameter: 4200, segments: 24, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
    const tex = canvasTex("skytex", { width: 128, height: 512 }, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0.00, "#0a1c38");     // zenith
      g.addColorStop(0.30, "#2f6299");
      g.addColorStop(0.52, "#79aed3");
      g.addColorStop(0.66, "#bcd3e0");
      g.addColorStop(0.745, "#f2c99a");    // haze band just above the horizon
      g.addColorStop(0.775, "#e79a63");
      g.addColorStop(0.80, "#c07a55");
      g.addColorStop(0.86, "#435468");
      g.addColorStop(1.00, "#1a2634");     // below the horizon, unseen
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // thin cirrus, drawn straight into the dome so the sky is not a ramp
      for (let i = 0; i < 90; i++) {
        const y = 90 + Math.random() * 250;
        const len = 12 + Math.random() * 70;
        ctx.fillStyle = `rgba(255,240,225,${0.02 + Math.random() * 0.07})`;
        ctx.fillRect(Math.random() * w, y, len, 1 + Math.random() * 2.5);
      }
    });
    const m = new BABYLON.StandardMaterial("skymat", scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex;
    m.disableLighting = true;
    m.backFaceCulling = false;
    dome.material = m;
    dome.isPickable = false;
    dome.infiniteDistance = true;
    dome.applyFog = false;
    skyMeshes.push(dome);

    buildSun();
    buildClouds();
    return dome;
  }

  /* Sun disk plus its glare. The disk is a real mesh rather than part of the
   * sky texture, so bloom picks it up and so the glitter path on the water
   * lines up with the light that makes it.
   */
  function buildSun() {
    const dir = SUN_DIR.clone().normalize().scale(-1600);
    const glare = BABYLON.MeshBuilder.CreatePlane("sun-glare", { size: 620 }, scene);
    glare.position.copyFrom(dir);
    glare.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    const gm = new BABYLON.StandardMaterial("sun-glare-mat", scene);
    gm.diffuseTexture = Tex.sprite(scene, "sun-glare", "rgba(255,240,205,0.95)", "rgba(255,190,120,0.30)");
    gm.opacityTexture = gm.diffuseTexture;
    gm.emissiveColor = new BABYLON.Color3(1, 0.88, 0.68);
    gm.disableLighting = true;
    gm.alphaMode = BABYLON.Engine.ALPHA_ADD;
    glare.material = gm;
    glare.isPickable = false;
    glare.applyFog = false;
    glare.infiniteDistance = true;
    sunGlare = glare;

    sunDisk = BABYLON.MeshBuilder.CreatePlane("sun-disk", { size: 96 }, scene);
    sunDisk.position.copyFrom(dir);
    sunDisk.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    const dm = new BABYLON.StandardMaterial("sun-disk-mat", scene);
    dm.diffuseTexture = Tex.sprite(scene, "sun-disk", "rgba(255,255,250,1)", "rgba(255,236,200,0.9)");
    dm.opacityTexture = dm.diffuseTexture;
    dm.emissiveColor = new BABYLON.Color3(1, 0.97, 0.9);
    dm.disableLighting = true;
    dm.alphaMode = BABYLON.Engine.ALPHA_ADD;
    sunDisk.material = dm;
    sunDisk.isPickable = false;
    sunDisk.applyFog = false;
    sunDisk.infiniteDistance = true;
    skyMeshes.push(glare, sunDisk);
  }

  function buildClouds() {
    const tex = canvasTex("cloudtex", 256, (ctx, w, h) => {
      for (let i = 0; i < 26; i++) {
        const x = w * (0.15 + Math.random() * 0.7);
        const y = h * (0.35 + Math.random() * 0.32);
        const r = w * (0.06 + Math.random() * 0.15);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,246,236,${0.25 + Math.random() * 0.3})`);
        g.addColorStop(1, "rgba(255,246,236,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    });
    const m = new BABYLON.StandardMaterial("cloudmat", scene);
    m.diffuseTexture = tex;
    m.opacityTexture = tex;
    m.emissiveColor = new BABYLON.Color3(1, 0.95, 0.9);
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.alphaMode = BABYLON.Engine.ALPHA_ADD;

    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
      const r = 900 + Math.random() * 500;
      const cloud = BABYLON.MeshBuilder.CreatePlane("cloud" + i,
        { width: 420 + Math.random() * 480, height: 130 + Math.random() * 110 }, scene);
      cloud.position.set(Math.cos(a) * r, 210 + Math.random() * 260, Math.sin(a) * r);
      cloud.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
      cloud.material = m;
      cloud.isPickable = false;
      cloud.applyFog = false;
      skyMeshes.push(cloud);
      cloudMeshes.push(cloud);
    }
  }

  // -------------------------------------------------------------- water --
  const WATER_PATCH = 460;
  const PARTICLE_GROUP = 1;

  function buildWater() {
    chopTex = Tex.chopNormals(scene);

    /* Open water is mostly sky. Looking straight down you see through it into
     * the green, and looking out toward the horizon you get the sky back
     * almost whole, with the sun's glitter path laid over the chop. Both of
     * those are Fresnel curves against the view angle, so the material is a
     * pair of them plus a normal map and a hard specular.
     *
     * A planar mirror was tried here and taken out: the surface is displaced
     * by a quarter of a metre while the mirror plane is flat, so at 700 m the
     * Sands came back at the wrong scale and smeared across the bay, and it
     * cost a second pass over the scenery every frame to do it. The Fresnel
     * reads the same at this distance and costs nothing.
     */
    waterMat = new BABYLON.StandardMaterial("watermat", scene);
    waterMat.diffuseColor = C3(WATER_DIFFUSE);
    waterMat.specularColor = C3(WATER_SPECULAR);
    waterMat.specularPower = 420;
    waterMat.bumpTexture = Tex.aniso(chopTex, 16, 170);
    waterMat.bumpTexture.level = 0.55;   // visuals.js owns this from here on

    /* Open water is mostly sky at a grazing angle and mostly its own dark
     * green looking straight down, so the colour is a Fresnel blend between
     * those two. Measured against this Babylon build rather than assumed:
     *
     *   F     = pow(bias + |dot(viewDirection, normal)|, power)
     *   colour = leftColor * (1 - F) + rightColor * F
     *
     * so F goes to 1 looking straight down and leftColor is the GRAZING
     * colour, which is the opposite of the naming. Getting that pair round the
     * wrong way paints the sky onto the water directly under the camera.
     *
     * power well under 1 keeps the sky in the last few degrees above the
     * horizon instead of spreading it across the whole bay.
     *
     * The two colours are set against a measured frame rather than picked:
     * open water in daylight has to sit around (30, 110, 150) in the overview,
     * and both of them need real red in them or the tone curve clips red to
     * zero and the whole bay comes out as flat cyan.
     */
    waterMat.emissiveColor = C3("#ffffff");
    waterMat.emissiveFresnelParameters = new BABYLON.FresnelParameters();
    waterMat.emissiveFresnelParameters.bias = 0.0;
    waterMat.emissiveFresnelParameters.power = 0.25;
    waterMat.emissiveFresnelParameters.leftColor = C3(WATER_SKY);    // grazing: sky
    waterMat.emissiveFresnelParameters.rightColor = C3("#204759");   // looking down

    /* Opaque. Marina Bay is a working harbour and you cannot see the bottom
     * through six metres of it, and a translucent surface put the whole
     * seabed on screen from the air, which made the course read as a field
     * rather than as water. The submerged ROV gets a surface marker instead,
     * and the dive camera is how you look at what it is doing.
     */
    waterMat.alpha = 1.0;

    /* Two meshes, one material.
     *
     * The inner patch is dense and its vertices are displaced every frame,
     * which is what gives the swell around the vehicles. The far plane is flat
     * and only carries the material, which is what gives the bay its size. The
     * patch fades its displacement to nothing at the rim, and the far plane
     * sits below the deepest trough so it cannot poke through.
     *
     * They share one material instance on purpose. Two materials, however
     * carefully matched, shaded differently enough that the patch read as a
     * lighter rectangle laid on the bay with a hard edge round it. Sharing
     * means the far plane cannot have its own texture tiling, so its UVs are
     * scaled by the size ratio instead and the world-space wave size matches
     * across the join.
     */
    water = BABYLON.MeshBuilder.CreateGround("water",
      { width: WATER_PATCH, height: WATER_PATCH, subdivisions: 120, updatable: true }, scene);
    water.material = waterMat;
    water.isPickable = false;
    waterVerts = water.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    waterBase = Float32Array.from(waterVerts);

    /* 32 subdivisions on a flat plane is not about shape. Fog distance is a
     * varying, so with two quads across 4.6 km it interpolates linearly over
     * hundreds of metres and the triangle diagonals show up as bright creases
     * running across the bay.
     */
    const FAR = 4600;
    waterFar = BABYLON.MeshBuilder.CreateGround("water-far",
      { width: FAR, height: FAR, subdivisions: 32 }, scene);
    // just under the deepest wave trough render.js can produce (0.167 m)
    waterFar.position.y = -0.18;
    const uv = waterFar.getVerticesData(BABYLON.VertexBuffer.UVKind);
    const ratio = FAR / WATER_PATCH;
    for (let i = 0; i < uv.length; i++) uv[i] *= ratio;
    waterFar.setVerticesData(BABYLON.VertexBuffer.UVKind, uv);
    waterFar.material = waterMat;
    waterFar.isPickable = false;
    waterFar.freezeWorldMatrix();
  }

  // ------------------------------------------------------- course props --
  let _flareTex = null;
  function flareTexture() {
    if (!_flareTex) {
      _flareTex = Tex.sprite(scene, "flare", "rgba(255,255,255,1)", "rgba(255,255,255,0.5)");
    }
    return _flareTex;
  }

  /* RoboBuoy with a Light Beacon on top (3.5.1, 3.5.2): a foam-collared marker
   * hull, a junction box carrying RGB LEDs around its sides, and an 8x8 panel
   * on the lid that is the part the UAV reads from above.
   */
  function robobuoy(id, pos, beaconState) {
    const root = new BABYLON.TransformNode("buoy-" + id, scene);
    root.position.set(pos[0], 0, pos[1]);

    const hullMat = mat("buoy-hull", "#eceff2", { spec: 48 });
    const hull = BABYLON.MeshBuilder.CreateCylinder("bh-" + id, {
      diameterTop: 0.40, diameterBottom: 0.54, height: 0.62, tessellation: 20,
    }, scene);
    hull.position.y = 0.16;
    hull.material = hullMat;
    hull.parent = root;

    // submerged counterweight and the skirt that keeps it upright
    const keel = BABYLON.MeshBuilder.CreateCylinder("bk-" + id, {
      diameterTop: 0.5, diameterBottom: 0.22, height: 0.55, tessellation: 14,
    }, scene);
    keel.position.y = -0.42;
    keel.material = mat("buoy-keel", "#3b444a");
    keel.parent = root;

    const collar = BABYLON.MeshBuilder.CreateTorus("bc-" + id,
      { diameter: 0.66, thickness: 0.17, tessellation: 22 }, scene);
    collar.position.y = 0.09;
    collar.material = mat("buoy-collar", "#fa5252");
    collar.parent = root;

    // reflective band, the way a real Sur-Mark marker is taped
    const band = BABYLON.MeshBuilder.CreateCylinder("bband-" + id,
      { diameterTop: 0.415, diameterBottom: 0.45, height: 0.09, tessellation: 20 }, scene);
    band.position.y = 0.34;
    band.material = mat("buoy-band", "#dee2e6", { emissive: "#2a3138" });
    band.parent = root;

    const boxMesh = BABYLON.MeshBuilder.CreateBox("bb-" + id,
      { width: 0.24, height: 0.22, depth: 0.24 }, scene);
    boxMesh.position.y = 0.62;
    boxMesh.material = mat("beacon-body", "#1b2026", { spec: 24 });
    boxMesh.parent = root;

    const side = BABYLON.MeshBuilder.CreateCylinder("bs-" + id,
      { diameter: 0.30, height: 0.12, tessellation: 18 }, scene);
    side.position.y = 0.62;
    side.material = mat("beacon-side-" + id, BEACON_COLORS[beaconState] || "#15181d",
      { unlit: true, alpha: 0.95 });
    side.parent = root;

    // the 8x8 top panel, drawn as a grid so it reads as a panel from the UAV
    const top = BABYLON.MeshBuilder.CreateBox("bt-" + id,
      { width: 0.2, height: 0.02, depth: 0.2 }, scene);
    top.position.y = 0.745;
    top.material = mat("beacon-top-" + id, BEACON_COLORS[beaconState] || "#15181d", { unlit: true });
    top.parent = root;
    const grid = BABYLON.MeshBuilder.CreateBox("btg-" + id,
      { width: 0.21, height: 0.004, depth: 0.21 }, scene);
    grid.position.y = 0.757;
    const gm = new BABYLON.StandardMaterial("beacon-grid-mat", scene);
    gm.diffuseTexture = Tex.canvas(scene, "tex-led-grid", 64, 64, (ctx, w, h) => {
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(10,12,16,0.85)";
      ctx.lineWidth = 2;
      for (let i = 0; i <= 8; i++) {
        ctx.beginPath(); ctx.moveTo((i * w) / 8, 0); ctx.lineTo((i * w) / 8, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (i * h) / 8); ctx.lineTo(w, (i * h) / 8); ctx.stroke();
      }
    });
    gm.opacityTexture = gm.diffuseTexture;
    gm.disableLighting = true;
    gm.emissiveColor = new BABYLON.Color3(0.05, 0.06, 0.07);
    grid.material = gm;
    grid.parent = root;

    // radar reflector, which is what makes a buoy read as a buoy at distance
    const mastMat = mat("buoy-mast", "#adb5bd");
    for (let i = 0; i < 3; i++) {
      const fin = BABYLON.MeshBuilder.CreateBox("bfin-" + id + i,
        { width: 0.18, height: 0.18, depth: 0.006 }, scene);
      fin.position.y = 0.9;
      fin.rotation.y = (i * Math.PI) / 3;
      fin.rotation.x = Math.PI / 4;
      fin.material = mastMat;
      fin.parent = root;
    }
    const mast = BABYLON.MeshBuilder.CreateCylinder("bmast-" + id,
      { diameter: 0.022, height: 0.34, tessellation: 6 }, scene);
    mast.position.y = 0.86;
    mast.material = mastMat;
    mast.parent = root;

    const flare = BABYLON.MeshBuilder.CreatePlane("bf-" + id, { size: 1.0 }, scene);
    flare.position.set(pos[0], 1.15, pos[1]);
    flare.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    flare.material = mat("beacon-flare-" + id, BEACON_COLORS[beaconState] || "#15181d",
      { unlit: true, alpha: 0.9 });
    flare.material.diffuseTexture = flareTexture();
    flare.material.opacityTexture = flareTexture();
    flare.material.alphaMode = BABYLON.Engine.ALPHA_ADD;
    flare.isPickable = false;
    flare.applyFog = false;

    // ripple ring where the hull meets the water
    const ripple = BABYLON.MeshBuilder.CreateDisc("brip-" + id, { radius: 0.75, tessellation: 20 }, scene);
    ripple.rotation.x = Math.PI / 2;
    ripple.position.set(pos[0], 0.03, pos[1]);
    ripple.material = rippleMaterial();
    ripple.isPickable = false;

    glow.addIncludedOnlyMesh(side);
    glow.addIncludedOnlyMesh(top);
    glow.addIncludedOnlyMesh(flare);
    if (shadows) [hull, boxMesh, collar].forEach(m => shadows.addShadowCaster(m));
    return { root, side, top, flare, state: beaconState };
  }

  let _rippleMat = null;
  function rippleMaterial() {
    if (_rippleMat) return _rippleMat;
    const tex = canvasTex("tex-ripple", 128, (ctx, w, h) => {
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = `rgba(220,245,255,${0.5 - i * 0.13})`;
        ctx.lineWidth = 3 - i * 0.6;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, w * (0.24 + i * 0.11), 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    _rippleMat = new BABYLON.StandardMaterial("ripple-mat", scene);
    _rippleMat.diffuseTexture = tex;
    _rippleMat.opacityTexture = tex;
    _rippleMat.emissiveColor = new BABYLON.Color3(0.8, 0.93, 1);
    _rippleMat.disableLighting = true;
    _rippleMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
    _rippleMat.backFaceCulling = false;
    return _rippleMat;
  }

  /* Color Indicator (3.5.3): a 135 mm x 128 mm actuated red/green cylinder,
   * visible through 360 degrees, on a buoy that also hangs an acoustic pinger.
   */
  function colorIndicator(id, pos, color) {
    const root = new BABYLON.TransformNode("ci-" + id, scene);
    root.position.set(pos[0], 0, pos[1]);
    const hull = BABYLON.MeshBuilder.CreateCylinder("cih-" + id, {
      diameterTop: 0.40, diameterBottom: 0.54, height: 0.62, tessellation: 20,
    }, scene);
    hull.position.y = 0.16;
    hull.material = mat("ci-hull", "#eceff2", { spec: 48 });
    hull.parent = root;
    const collar = BABYLON.MeshBuilder.CreateTorus("cic-collar-" + id,
      { diameter: 0.66, thickness: 0.17, tessellation: 22 }, scene);
    collar.position.y = 0.09;
    collar.material = mat("ci-collar", "#fab005");
    collar.parent = root;
    const post = BABYLON.MeshBuilder.CreateCylinder("cipost-" + id,
      { diameter: 0.05, height: 0.24, tessellation: 8 }, scene);
    post.position.y = 0.48;
    post.material = mat("ci-post", "#495057");
    post.parent = root;
    const cylMesh = BABYLON.MeshBuilder.CreateCylinder("cic-" + id, {
      diameter: 0.128, height: 0.135, tessellation: 20,
    }, scene);
    cylMesh.position.y = 0.66;
    cylMesh.material = mat("ci-mat-" + id, color === "GREEN" ? "#22dd55" : "#ff2d2d", { unlit: true });
    cylMesh.parent = root;
    const cap = BABYLON.MeshBuilder.CreateCylinder("cicap-" + id,
      { diameter: 0.145, height: 0.02, tessellation: 20 }, scene);
    cap.position.y = 0.74;
    cap.material = mat("ci-cap", "#212529");
    cap.parent = root;

    const ripple = BABYLON.MeshBuilder.CreateDisc("cirip-" + id, { radius: 0.75, tessellation: 20 }, scene);
    ripple.rotation.x = Math.PI / 2;
    ripple.position.set(pos[0], 0.03, pos[1]);
    ripple.material = rippleMaterial();
    ripple.isPickable = false;

    glow.addIncludedOnlyMesh(cylMesh);
    if (shadows) shadows.addShadowCaster(hull);
    return { root, cyl: cylMesh, color };
  }

  function buildTask1() {
    cfg.task1.buoys.forEach(b => { buoys[b.id] = robobuoy(b.id, b.pos, b.state); });
  }

  /* Task 2 hardware (3.3.3, 3.5.4 to 3.5.6): two indicator buoys, one of them
   * hanging the active pinger, and a five-section PVC pipeline on a stand with
   * a magnetically activated light node on each section.
   */
  function buildTask2() {
    const t2 = cfg.task2;
    t2.buoys.forEach(b => {
      indicators[b.id] = colorIndicator(b.id, b.pos, b.indicator);

      const drop = cfg.seabed_depth_m - 1.4;
      const line = BABYLON.MeshBuilder.CreateCylinder("pinger-line-" + b.id, {
        diameter: 0.018, height: drop, tessellation: 6,
      }, scene);
      line.position.set(b.pos[0], -drop / 2, b.pos[1]);
      line.material = mat("pinger-line", "#5b666d");

      const body = BABYLON.MeshBuilder.CreateCylinder("pinger-" + b.id, {
        diameter: 0.09, height: 0.30, tessellation: 14,
      }, scene);
      body.position.set(b.pos[0], -(cfg.seabed_depth_m - 1.2), b.pos[1]);
      body.material = mat("pinger-mat-" + b.id, "#ffd43b",
        { emissive: b.pinger ? "#6b5a12" : "#000000" });
      // the transducer face, which is the part that lights when it pulses
      const face = BABYLON.MeshBuilder.CreateCylinder("pinger-face-" + b.id, {
        diameter: 0.075, height: 0.03, tessellation: 14,
      }, scene);
      face.position.set(b.pos[0], -(cfg.seabed_depth_m - 1.2) - 0.16, b.pos[1]);
      face.material = mat("pinger-face-mat-" + b.id, "#fff3bf", { unlit: true });
      glow.addIncludedOnlyMesh(face);

      // expanding ring, driven by render.js at the pulse rate
      const ring = BABYLON.MeshBuilder.CreateTorus("pinger-ring-" + b.id,
        { diameter: 1, thickness: 0.04, tessellation: 28 }, scene);
      ring.position.copyFrom(face.position);
      ring.rotation.x = 0;
      ring.material = mat("pinger-ring-mat-" + b.id, "#7a6a3a", { unlit: true, alpha: 0.16 });
      ring.setEnabled(false);
      glow.addIncludedOnlyMesh(ring);

      indicators[b.id].pinger = body;
      indicators[b.id].pingerFace = face;
      indicators[b.id].pingerRing = ring;
      indicators[b.id].pingerActive = b.pinger;
    });

    const y = -cfg.seabed_depth_m + t2.pipeline.height_above_bed_m;
    const nodes = t2.pipeline.nodes;
    const pvc = mat("pipe-mat", "#c3cad1", { spec: 64 });
    const flangeMat = mat("pipe-flange", "#8a939b");
    const standMat = mat("post-mat", "#7c858c");

    for (let i = 0; i < nodes.length - 1; i++) {
      const a = new BABYLON.Vector3(nodes[i][0], y + (i % 2) * 0.25, nodes[i][1]);
      const b = new BABYLON.Vector3(nodes[i + 1][0], y + ((i + 1) % 2) * 0.25, nodes[i + 1][1]);
      const pipe = BABYLON.MeshBuilder.CreateTube("pipe" + i, {
        path: [a, b], radius: 0.042, tessellation: 14,
      }, scene);
      pipe.material = pvc;
      pipe.receiveShadows = true;

      // flanged joint where two sections meet, so the five sections are five
      const joint = BABYLON.MeshBuilder.CreateSphere("pipe-joint" + i, { diameter: 0.11, segments: 8 }, scene);
      joint.position.copyFrom(a);
      joint.material = flangeMat;
      if (i === nodes.length - 2) {
        const end = joint.clone("pipe-joint-end");
        end.position.copyFrom(b);
      }

      const mid = BABYLON.Vector3.Center(a, b);
      const damaged = i === t2.pipeline.damaged_segment;

      // the light node: a magnet housing clamped round the pipe with a lit ring
      const clamp = BABYLON.MeshBuilder.CreateCylinder("pipe-clamp" + i,
        { diameter: 0.13, height: 0.12, tessellation: 14 }, scene);
      clamp.position.copyFrom(mid);
      clamp.rotation.z = Math.PI / 2;
      clamp.rotation.y = Math.atan2(b.z - a.z, b.x - a.x);
      clamp.material = mat("pipe-clamp-mat", "#495057");

      const ringMesh = BABYLON.MeshBuilder.CreateTorus("pipe-light" + i, {
        diameter: 0.24, thickness: 0.045, tessellation: 20,
      }, scene);
      ringMesh.position.copyFrom(mid);
      ringMesh.rotation.z = Math.PI / 2;
      ringMesh.rotation.y = Math.atan2(b.z - a.z, b.x - a.x);
      ringMesh.material = mat("pipe-light-mat" + i, damaged ? "#ff2d2d" : "#22dd55", { unlit: true });
      glow.addIncludedOnlyMesh(ringMesh);
      pipelineLights.push({ mesh: ringMesh, damaged, index: i, pos: mid });

      // stand: a saddle on a post on a footing, sat on the seabed relief
      const bedY = -cfg.seabed_depth_m;
      const groundY = bedY + (Underwater.bedHeight ? Underwater.bedHeight(mid.x, mid.z) : 0);
      const postH = mid.y - groundY;
      const post = BABYLON.MeshBuilder.CreateCylinder("pipe-post" + i,
        { diameter: 0.065, height: postH, tessellation: 10 }, scene);
      post.position.set(mid.x, groundY + postH / 2, mid.z);
      post.material = standMat;
      const foot = BABYLON.MeshBuilder.CreateCylinder("pipe-foot" + i,
        { diameter: 0.42, height: 0.1, tessellation: 14 }, scene);
      foot.position.set(mid.x, groundY + 0.05, mid.z);
      foot.material = standMat;
      foot.receiveShadows = true;
      const saddle = BABYLON.MeshBuilder.CreateCylinder("pipe-saddle" + i,
        { diameter: 0.16, height: 0.07, arc: 0.55, tessellation: 14 }, scene);
      saddle.position.copyFrom(mid);
      saddle.position.y -= 0.03;
      saddle.rotation.z = Math.PI / 2;
      saddle.material = standMat;
    }
  }

  function platformTexture(colors) {
    return canvasTex("plat", 512, (ctx, w, h) => {
      ctx.fillStyle = colors.background;
      ctx.fillRect(0, 0, w, h);
      // deck boards, so a 2 m platform reads at its real size next to a hull
      ctx.fillStyle = "rgba(120,126,133,0.30)";
      for (let y = 0; y < h; y += 42) ctx.fillRect(0, y, w, 2);
      const spots = [["RED", 0.27, 0.3], ["GREEN", 0.73, 0.3], ["BLUE", 0.5, 0.72]];
      spots.forEach(([name, cx, cy]) => {
        const r = (0.65 / 2 / 2) * w;      // 0.65 m circle on a 2 m platform
        ctx.fillStyle = "rgba(40,44,50,0.35)";
        ctx.beginPath(); ctx.arc(cx * w, cy * h + 4, r + 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = colors[name];
        ctx.beginPath(); ctx.arc(cx * w, cy * h, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(cx * w, cy * h, r, 0, Math.PI * 2); ctx.stroke();
      });
      ctx.strokeStyle = "rgba(60,66,74,0.7)";
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, w - 8, h - 8);
      // hazard corners
      ctx.fillStyle = "rgba(250,176,5,0.9)";
      [[0, 0], [w - 46, 0], [0, h - 46], [w - 46, h - 46]].forEach(([x, y]) => {
        ctx.fillRect(x + 6, y + 6, 40, 8);
        ctx.fillRect(x + 6, y + 6, 8, 40);
      });
    });
  }

  function buildPlatforms() {
    const size = cfg.platforms.size_m;
    const tex = platformTexture(cfg.platforms.colors);
    const floatMat = mat("plat-float-mat", "#f1f3f5");
    const frameMat = mat("plat-frame-mat", "#8a939b");
    cfg.platforms.items.forEach(p => {
      const root = new BABYLON.TransformNode("plat-root-" + p.id, scene);
      root.position.set(p.pos[0], 0, p.pos[1]);
      root.rotation.y = (p.yaw * Math.PI) / 180;

      const deck = BABYLON.MeshBuilder.CreateBox("plat-" + p.id, {
        width: size, height: 0.1, depth: size,
      }, scene);
      deck.position.y = 0.16;
      const m = new BABYLON.StandardMaterial("plat-mat-" + p.id, scene);
      m.diffuseTexture = tex;
      m.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
      deck.material = m;
      deck.parent = root;
      deck.receiveShadows = true;
      if (shadows) shadows.addShadowCaster(deck);

      // frame under the deck, tying the four floats together
      [[0, -0.8], [0, 0.8]].forEach(([sx, sz], i) => {
        const beam = BABYLON.MeshBuilder.CreateBox("plat-beam" + p.id + i,
          { width: size + 0.2, height: 0.08, depth: 0.12 }, scene);
        beam.position.set(sx, 0.06, sz);
        beam.material = frameMat;
        beam.parent = root;
      });

      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz], i) => {
        const float = BABYLON.MeshBuilder.CreateCylinder("plat-float" + p.id + i, {
          diameter: 0.42, height: 0.34, tessellation: 14,
        }, scene);
        float.position.set(sx * 0.8, -0.04, sz * 0.8);
        float.material = floatMat;
        float.parent = root;
        const rip = BABYLON.MeshBuilder.CreateDisc("plat-rip" + p.id + i,
          { radius: 0.5, tessellation: 16 }, scene);
        rip.rotation.x = Math.PI / 2;
        rip.position.set(sx * 0.8, 0.035, sz * 0.8);
        rip.material = rippleMaterial();
        rip.parent = root;
      });

      // three tins waiting on the platform, in a rack
      ["RED", "GREEN", "BLUE"].forEach((c, i) => {
        const tin = BABYLON.MeshBuilder.CreateCylinder("tin-" + p.id + c, {
          diameter: 0.084, height: 0.062, tessellation: 14,
        }, scene);
        tin.position.set(-0.7 + i * 0.24, 0.24, 0.75);
        tin.material = mat("tin-mat-" + c, cfg.platforms.colors[c], { spec: 96 });
        tin.parent = root;
        const lid = BABYLON.MeshBuilder.CreateCylinder("tin-lid-" + p.id + c, {
          diameter: 0.088, height: 0.008, tessellation: 14,
        }, scene);
        lid.position.set(-0.7 + i * 0.24, 0.272, 0.75);
        lid.material = mat("tin-lid-mat", "#dee2e6");
        lid.parent = root;
      });
    });
  }

  /* Docking bay structure (3.3.4, 3.5.7): three bays, each with a building
   * carrying two 25 cm windows and a colour indicator at its base. The dock
   * faces west, so a vehicle drives in from -x.
   */
  function buildTask3() {
    const t3 = cfg.task3;
    const base = t3.dock.pos;
    const yaw = (t3.dock.yaw * Math.PI) / 180;
    const root = new BABYLON.TransformNode("dock", scene);
    root.position.set(base[0], 0, base[1]);
    root.rotation.y = yaw;

    // one tile over the whole pontoon: repeating it put a hazard stripe every
    // two metres and the deck read as a solid yellow slab from any distance
    const deckTex = Tex.deckTread(scene, "dock", "#b6bec6", "#f2b705");
    const deckMat = texMat("dock-mat", "#ffffff", deckTex);
    const fingerMat = mat("dock-finger", "#ced4da");
    const wallMat = mat("bldg-mat", "#f2f4f6", { spec: 32 });
    const roofMat = mat("roof-mat", "#39424b");
    const trimMat = mat("dock-trim", "#495057");

    const pontoon = BABYLON.MeshBuilder.CreateBox("dock-deck", {
      width: 4.0, height: 0.42, depth: t3.bay_spacing_m * 3 + 2,
    }, scene);
    pontoon.position.set(1.6, 0.21, 0);
    pontoon.material = deckMat;
    pontoon.parent = root;
    pontoon.receiveShadows = true;
    if (shadows) shadows.addShadowCaster(pontoon);

    // floats under the pontoon and a fender strip along its face
    for (let i = 0; i < 8; i++) {
      const f = BABYLON.MeshBuilder.CreateCylinder("dock-float" + i,
        { diameter: 0.6, height: 3.6, tessellation: 12 }, scene);
      f.rotation.z = Math.PI / 2;
      f.position.set(1.6, -0.06, -6.5 + i * 1.9);
      f.material = fingerMat;
      f.parent = root;
    }

    dockLights = [];
    for (let bay = 1; bay <= 3; bay++) {
      const z = (bay - 2) * t3.bay_spacing_m;
      [-1, 1].forEach((s, i) => {
        const finger = BABYLON.MeshBuilder.CreateBox(`bay${bay}-finger${i}`, {
          width: 3.2, height: 0.36, depth: 0.7,
        }, scene);
        finger.position.set(-1.2, 0.18, z + s * (t3.bay_spacing_m / 2));
        finger.material = fingerMat;
        finger.parent = root;
        finger.receiveShadows = true;
        // fenders down the inside face of each finger
        for (let k = 0; k < 4; k++) {
          const fend = BABYLON.MeshBuilder.CreateCylinder(`bay${bay}-fend${i}${k}`,
            { diameter: 0.16, height: 0.4, tessellation: 8 }, scene);
          fend.position.set(-2.4 + k * 0.85, 0.2, z + s * (t3.bay_spacing_m / 2 - 0.42));
          fend.material = trimMat;
          fend.parent = root;
        }
        // bay number board at the head of each finger
        if (i === 0) {
          const sign = BABYLON.MeshBuilder.CreatePlane(`bay${bay}-sign`, { width: 0.5, height: 0.34 }, scene);
          sign.position.set(-2.6, 0.75, z);
          sign.rotation.y = -Math.PI / 2;
          const sm = new BABYLON.StandardMaterial(`bay${bay}-sign-mat`, scene);
          sm.diffuseTexture = Tex.canvas(scene, "tex-bay-" + bay, 128, 96, (ctx, w, h) => {
            ctx.fillStyle = "#111417"; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = "#f8f9fa";
            ctx.font = "bold 66px Segoe UI, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(String(bay), w / 2, h / 2 + 24);
          });
          sm.emissiveColor = new BABYLON.Color3(0.7, 0.7, 0.7);
          sm.backFaceCulling = false;
          sign.material = sm;
          sign.parent = root;
        }
      });

      const building = BABYLON.MeshBuilder.CreateBox(`bay${bay}-bldg`, {
        width: 1.1, height: 1.4, depth: 1.6,
      }, scene);
      building.position.set(1.2, 0.92, z);
      building.material = wallMat;
      building.parent = root;
      building.receiveShadows = true;
      if (shadows) shadows.addShadowCaster(building);

      const roof = BABYLON.MeshBuilder.CreateCylinder(`bay${bay}-roof`, {
        diameterTop: 0, diameterBottom: 2.05, height: 0.62, tessellation: 4,
      }, scene);
      roof.rotation.y = Math.PI / 4;
      roof.position.set(1.2, 1.93, z);
      roof.material = roofMat;
      roof.parent = root;
      if (shadows) shadows.addShadowCaster(roof);
      // ridge and gutter, so the roof is not one flat pyramid
      const ridge = BABYLON.MeshBuilder.CreateBox(`bay${bay}-ridge`,
        { width: 0.1, height: 0.08, depth: 0.1 }, scene);
      ridge.position.set(1.2, 2.26, z);
      ridge.material = trimMat;
      ridge.parent = root;
      const gutter = BABYLON.MeshBuilder.CreateBox(`bay${bay}-gutter`,
        { width: 1.3, height: 0.07, depth: 1.8 }, scene);
      gutter.position.set(1.2, 1.63, z);
      gutter.material = trimMat;
      gutter.parent = root;

      const wins = [];
      [-0.4, 0.4].forEach((dz, wi) => {
        const frame = BABYLON.MeshBuilder.CreateBox(`bay${bay}-win${wi}`, {
          width: 0.05, height: t3.window_size_m + 0.09, depth: t3.window_size_m + 0.09,
        }, scene);
        frame.position.set(0.655, 1.0, z + dz);
        frame.material = mat("win-frame", "#1b2026");
        frame.parent = root;

        const pane = BABYLON.MeshBuilder.CreateBox(`bay${bay}-pane${wi}`, {
          width: 0.03, height: t3.window_size_m, depth: t3.window_size_m,
        }, scene);
        pane.position.set(0.628, 1.0, z + dz);
        pane.material = mat(`pane-mat-${bay}-${wi}`, "#15181d", { unlit: true });
        pane.parent = root;
        glow.addIncludedOnlyMesh(pane);
        wins.push(pane);

        // sill, so the target the USV sprays at has a shadow line under it
        const sill = BABYLON.MeshBuilder.CreateBox(`bay${bay}-sill${wi}`,
          { width: 0.12, height: 0.04, depth: t3.window_size_m + 0.14 }, scene);
        sill.position.set(0.68, 0.86, z + dz);
        sill.material = trimMat;
        sill.parent = root;
      });

      const indicator = BABYLON.MeshBuilder.CreateCylinder(`bay${bay}-ind`, {
        diameter: 0.128, height: 0.135, tessellation: 20,
      }, scene);
      indicator.position.set(0.66, 0.42, z);
      const safe = bay === t3.safe_bay;
      indicator.material = mat(`bay-ind-mat-${bay}`, safe ? "#22dd55" : "#ff2d2d", { unlit: true });
      indicator.parent = root;
      glow.addIncludedOnlyMesh(indicator);

      dockLights.push({ bay, indicator, windows: wins, safe, z });
    }
    return root;
  }

  function buildUavPad() {
    const pad = cfg.uav_pad;
    const tex = canvasTex("pad", 512, (ctx, w, h) => {
      ctx.fillStyle = "#CCCED0";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(120,126,133,0.22)";
      for (let y = 0; y < h; y += 48) ctx.fillRect(0, y, w, 2);
      ctx.strokeStyle = "#111417";
      [0.42, 0.31, 0.2].forEach((r, i) => {
        ctx.lineWidth = 10 - i * 2;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, r * w, 0, Math.PI * 2);
        ctx.stroke();
      });
      // approach chevrons, which is what tells the UAV which way is upwind
      ctx.fillStyle = "#111417";
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(w / 2, 40 + i * 26);
        ctx.lineTo(w / 2 - 34, 74 + i * 26);
        ctx.lineTo(w / 2 - 26, 74 + i * 26);
        ctx.lineTo(w / 2, 50 + i * 26);
        ctx.lineTo(w / 2 + 26, 74 + i * 26);
        ctx.lineTo(w / 2 + 34, 74 + i * 26);
        ctx.closePath();
        ctx.fill();
      }
      ctx.font = "bold 54px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("RoboNation", w / 2, h / 2 + 18);
      ctx.strokeStyle = "rgba(20,24,28,0.8)";
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, w - 8, h - 8);
    });
    const deck = BABYLON.MeshBuilder.CreateBox("uav-pad", {
      width: pad.size_m, height: 0.14, depth: pad.size_m,
    }, scene);
    deck.position.set(pad.pos[0], 0.14, pad.pos[1]);
    const m = new BABYLON.StandardMaterial("pad-mat", scene);
    m.diffuseTexture = tex;
    m.specularColor = BABYLON.Color3.Black();
    deck.material = m;
    deck.receiveShadows = true;
    if (shadows) shadows.addShadowCaster(deck);

    const floatMat = mat("pad-float-mat", "#f1f3f5");
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz], i) => {
      const float = BABYLON.MeshBuilder.CreateCylinder("pad-float" + i, {
        diameter: 0.46, height: 0.36, tessellation: 14,
      }, scene);
      float.position.set(pad.pos[0] + sx * 0.8, -0.04, pad.pos[1] + sz * 0.8);
      float.material = floatMat;
      const rip = BABYLON.MeshBuilder.CreateDisc("pad-rip" + i, { radius: 0.55, tessellation: 16 }, scene);
      rip.rotation.x = Math.PI / 2;
      rip.position.set(pad.pos[0] + sx * 0.8, 0.035, pad.pos[1] + sz * 0.8);
      rip.material = rippleMaterial();
    });
    // wind sock on a mast beside the pad, the pilot's cue at landing
    const mast = BABYLON.MeshBuilder.CreateCylinder("pad-mast",
      { diameter: 0.04, height: 2.4, tessellation: 6 }, scene);
    mast.position.set(pad.pos[0] - 1.4, 1.2, pad.pos[1] - 1.2);
    mast.material = mat("pad-mast-mat", "#adb5bd");
    const sock = BABYLON.MeshBuilder.CreateCylinder("pad-sock",
      { diameterTop: 0.1, diameterBottom: 0.24, height: 0.7, tessellation: 10 }, scene);
    sock.position.set(pad.pos[0] - 1.05, 2.3, pad.pos[1] - 1.2);
    sock.rotation.z = -Math.PI / 2.2;
    sock.material = mat("pad-sock-mat", "#fa5252", { emissive: "#3a1010" });
  }

  function buildBoundary() {
    const pts = cfg.boundary.map(p => new BABYLON.Vector3(p[0], 0.3, p[1]));
    const line = BABYLON.MeshBuilder.CreateLines("boundary", { points: pts }, scene);
    line.color = C3("#74c0fc");
    line.alpha = 0.6;
    line.isPickable = false;

    const edgeMat = mat("edge-mat", "#fab005", { emissive: "#6b4d02" });
    const step = 18;
    const marks = [];
    for (let i = 0; i < cfg.boundary.length - 1; i++) {
      const a = cfg.boundary[i], b = cfg.boundary[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const n = Math.max(1, Math.round(Math.hypot(dx, dz) / step));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const x = a[0] + dx * t, z = a[1] + dz * t;
        const buoy = BABYLON.MeshBuilder.CreateCylinder(`edge${i}-${k}`, {
          diameterTop: 0.24, diameterBottom: 0.42, height: 0.62, tessellation: 12,
        }, scene);
        buoy.position.set(x, 0.14, z);
        marks.push(buoy);
        const cone = BABYLON.MeshBuilder.CreateCylinder(`edge-top${i}-${k}`, {
          diameterTop: 0, diameterBottom: 0.26, height: 0.3, tessellation: 10,
        }, scene);
        cone.position.set(x, 0.58, z);
        marks.push(cone);
      }
    }
    const merged = BABYLON.Mesh.MergeMeshes(marks, true, true, undefined, false, false);
    if (merged) { merged.name = "edge-marks"; merged.material = edgeMat; }
  }

  /* Firefighting monitor spray (3.3.4). Water leaving a nozzle, not a fog
   * machine: a tight cone, high emit power, gravity pulling the arc down.
   */
  function buildSpray() {
    const src = new BABYLON.TransformNode("spray-src", scene);
    const ps = new BABYLON.ParticleSystem("spray", 1400, scene);
    ps.particleTexture = Tex.sprite(scene, "droplet", "rgba(255,255,255,0.95)", "rgba(170,215,242,0.5)");
    ps.emitter = src;
    ps.minSize = 0.04; ps.maxSize = 0.16;
    ps.minLifeTime = 0.3; ps.maxLifeTime = 0.75;
    ps.emitRate = 700;
    ps.gravity = new BABYLON.Vector3(0, -9.8, 0);
    ps.direction1 = new BABYLON.Vector3(1, 0.6, -0.2);
    ps.direction2 = new BABYLON.Vector3(1, 1.0, 0.2);
    ps.minEmitPower = 4; ps.maxEmitPower = 7;
    ps.color1 = new BABYLON.Color4(0.9, 0.97, 1, 0.85);
    ps.color2 = new BABYLON.Color4(0.72, 0.88, 1, 0.55);
    ps.colorDead = new BABYLON.Color4(0.72, 0.88, 1, 0);
    ps.renderingGroupId = PARTICLE_GROUP;
    spray = { ps, src };
  }

  /* Wake and bow spray for a surface craft, plus a foam disc at its waterline.
   *
   * Sized off the hull. The first pass used one size for every craft, and a
   * 1.2 m BlueBoat came with a 2.4 m patch of foam that hid the transom the
   * moment a camera came close to it.
   */
  function buildWake(id, color, size) {
    const length = (size && size[0]) || 1.2;
    const beam = (size && size[2]) || 0.9;
    const src = new BABYLON.TransformNode("wake-src-" + id, scene);
    const ps = new BABYLON.ParticleSystem("wake-" + id, 600, scene);
    ps.particleTexture = Tex.sprite(scene, "foam", "rgba(255,255,255,0.85)", "rgba(205,235,250,0.35)");
    ps.emitter = src;
    // local to the emitter, which render.js turns onto the hull's heading:
    // a strip across the transom, throwing foam astern whichever way it points
    ps.isLocal = true;
    ps.minEmitBox = new BABYLON.Vector3(-0.08, 0, -beam / 2);
    ps.maxEmitBox = new BABYLON.Vector3(0.08, 0, beam / 2);
    ps.minSize = 0.035 * length; ps.maxSize = 0.10 * length;
    ps.minLifeTime = 0.5; ps.maxLifeTime = 1.4;
    ps.emitRate = 0;
    ps.gravity = new BABYLON.Vector3(0, -0.25, 0);
    ps.direction1 = new BABYLON.Vector3(-0.4, 0.2, -0.25);
    ps.direction2 = new BABYLON.Vector3(-0.9, 0.45, 0.25);
    ps.minEmitPower = 0.3; ps.maxEmitPower = 1.1;
    ps.color1 = new BABYLON.Color4(1, 1, 1, 0.24);
    ps.color2 = new BABYLON.Color4(0.82, 0.92, 0.98, 0.15);
    ps.colorDead = new BABYLON.Color4(0.82, 0.92, 0.98, 0);
    ps.renderingGroupId = PARTICLE_GROUP;
    ps.start();

    const foam = BABYLON.MeshBuilder.CreateDisc("wake-foam-" + id,
      { radius: length * 0.62, tessellation: 22 }, scene);
    foam.rotation.x = Math.PI / 2;
    foam.material = rippleMaterial();
    foam.isPickable = false;
    void color;
    wakes[id] = { ps, src, foam };
    return wakes[id];
  }

  /* Where the submerged ROV is, seen from the air. The water is opaque, so
   * without this the operator loses the vehicle the moment it goes under.
   */
  function buildDiveMarker() {
    diveMarker = BABYLON.MeshBuilder.CreateDisc("dive-marker",
      { radius: 1.6, tessellation: 40 }, scene);
    diveMarker.rotation.x = Math.PI / 2;
    diveMarker.material = rippleMaterial();
    diveMarker.isPickable = false;
    diveMarker.setEnabled(false);
  }

  function buildIncidentMarkers() {
    incidentMarker = BABYLON.MeshBuilder.CreateCylinder("incident", {
      diameterTop: 0, diameterBottom: 2.4, height: 4, tessellation: 18,
    }, scene);
    incidentMarker.material = mat("incident-mat", "#ff922b", { unlit: true, alpha: 0.8 });
    incidentMarker.setEnabled(false);
    glow.addIncludedOnlyMesh(incidentMarker);

    keepoutRing = BABYLON.MeshBuilder.CreateTorus("keepout", {
      diameter: 2, thickness: 0.5, tessellation: 56,
    }, scene);
    keepoutRing.material = mat("keepout-mat", "#ff6b6b", { unlit: true, alpha: 0.6 });
    keepoutRing.setEnabled(false);

    movingObject = BABYLON.MeshBuilder.CreateBox("moving-object", {
      width: 4.5, height: 1.4, depth: 1.6,
    }, scene);
    movingObject.material = mat("moving-mat", "#f76707");
    movingObject.setEnabled(false);
    const cabin = BABYLON.MeshBuilder.CreateBox("moving-object-cabin", {
      width: 1.4, height: 0.9, depth: 1.2,
    }, scene);
    cabin.position.set(-0.9, 1.1, 0);
    cabin.material = mat("moving-cabin-mat", "#e8e8e8");
    cabin.parent = movingObject;
  }

  // ---------------------------------------------------------------- init --
  /* `opts.mode` picks what gets built on the water.
   *
   *   "course"     (default) the competition course from handbook 3.3 and 3.5
   *   "readiness"  the three proof of readiness courses from 3.1, on a test
   *                site with a bank along the north side
   *
   * Everything else is shared: the water, the sky, the world below the
   * surface, the three vehicles, the post chain, the cameras and the picture
   * settings. Only the props on the water change.
   */
  function init(canvas, config, opts = {}) {
    cfg = config;
    mode = opts.mode === "readiness" ? "readiness" : "course";
    engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.05, 0.08, 0.12, 1);
    scene.ambientColor = new BABYLON.Color3(0.22, 0.26, 0.31);
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.00062;
    scene.fogColor = C3("#93bad9");

    // opens looking north east across the course, the view from the promontory
    camera = new BABYLON.ArcRotateCamera("cam", -Math.PI * 0.72, 1.36, 245,
      new BABYLON.Vector3(0, 0, 30), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 2.5;
    camera.upperRadiusLimit = 1200;
    camera.wheelPrecision = 1.2;
    camera.panningSensibility = 40;
    camera.minZ = 0.08;
    camera.maxZ = 6000;

    sun = new BABYLON.DirectionalLight("sun", SUN_DIR.clone(), scene);
    sun.intensity = 2.0;
    sun.diffuse = C3("#ffe6bf");
    sun.specular = C3("#fff3dd");
    sun.position = SUN_DIR.clone().scale(-160);
    skyLight = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
    skyLight.intensity = 0.75;
    skyLight.diffuse = C3("#a8cbe8");
    skyLight.groundColor = C3("#1e3340");

    shadows = new BABYLON.ShadowGenerator(1024, sun);
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
    shadows.darkness = 0.42;
    sun.autoCalcShadowZBounds = true;
    sun.shadowOrthoScale = 0.35;

    glow = new BABYLON.GlowLayer("glow", scene);
    glow.intensity = 0.85;

    /* Every particle system in this scene runs in rendering group 1.
     *
     * In group 0 the glow layer composites over them and they come back as
     * solid black sprites: a wake of black cannonballs behind the BlueBoat,
     * which is what this looked like before. Group 1 draws after that
     * composite. The depth buffer has to survive the group change or the
     * particles would also draw through the hulls, hence the auto-clear call.
     */
    scene.setRenderingAutoClearDepthStencil(1, false, false, false);

    buildSky();
    buildWater();
    Underwater.build(scene, cfg, api);
    if (mode === "course") {
      const land = Landmarks.build(scene, cfg, api);
      skyMeshes.push(...land.meshes);
      buildBoundary();
      buildTask1();
      buildTask2();
      buildPlatforms();
      buildTask3();
      buildUavPad();
    } else {
      // The proof of readiness courses are filmed at the team's own site, so
      // the Marina Bay skyline stays out of the frame.
      Por.build(scene, cfg, api);
      // and the layer that moves over them while a rehearsal is flying
      PorViz.build(scene, cfg, api);
    }
    /* These three are render.js's, not the course's: the spray, the marker
     * over a submerged ROV and the Task 4 markers are driven per frame
     * whatever is being shown, so they are built in both modes and simply
     * stay disabled when nothing is using them.
     */
    buildSpray();
    buildDiveMarker();
    buildIncidentMarkers();

    cfg.vehicles.forEach(spec => {
      vehicles[spec.id] = Vehicles.build(scene, spec, { mat, texMat, C3, glow });
      if (spec.id !== "uav") buildWake(spec.id, spec.color, spec.size);
      if (shadows) {
        vehicles[spec.id].root.getChildMeshes().forEach(m => shadows.addShadowCaster(m));
      }
    });
    Underwater.attachBubbles("uuv", vehicles.uuv.root);

    buildPostProcess();
    Cameras.init(scene, camera, canvas);

    /* Last: the operator's picture settings. They are applied after the world
     * is built because most of them are a property on something that has to
     * exist first, and because a display set up on the course keeps its
     * settings across a reload.
     */
    Visuals.init();

    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
    return scene;
  }

  /* Post processing. Tone mapping plus a little bloom is what turns a set of
   * flat-shaded primitives into a photograph of a bay at five in the evening,
   * and FXAA is what stops the buoy field from crawling when the camera moves.
   */
  function buildPostProcess() {
    pipeline = new BABYLON.DefaultRenderingPipeline("rx", true, scene, [camera]);
    pipeline.samples = 1;
    pipeline.fxaaEnabled = true;
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.85;
    pipeline.bloomWeight = 0.30;
    pipeline.bloomKernel = 56;
    pipeline.bloomScale = 0.5;
    pipeline.imageProcessingEnabled = true;
    const ip = pipeline.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.vignetteStretch = 0.4;
    ip.vignetteBlendMode = BABYLON.ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    // exposure, contrast, vignette weight, bloom and the light levels all
    // come from GRADE, so there is one place they can be changed from
    applyGrade();
  }

  /** Keep the post chain on whichever camera is rendering, POV included. */
  function attachPipeline(cam) {
    if (pipeline && cam && pipeline.cameras.indexOf(cam) === -1) pipeline.addCamera(cam);
  }

  /* The grade, in one place.
   *
   * Two things move it: the operator, through visuals.js, and the waterline.
   * GRADE holds what the operator asked for and SEA_RATIO is how much of each
   * one survives the crossing, measured against the tuned underwater pass
   * rather than picked. Keeping them apart is what lets someone turn the
   * bloom down in air without the seabed going flat when the camera dives.
   */
  const GRADE = {
    exposure: 1.2, contrast: 1.18, vignette: 1.4,
    bloom: 0.30, glow: 0.85, sun: 2.0, sky: 0.75,
  };
  const SEA_RATIO = {
    exposure: 0.875, contrast: 1.136, vignette: 1.357,
    bloom: 1.50, glow: 0.647, sun: 0.31, sky: 0.773,
  };
  let vignetteOn = true;
  let fogScale = 1.0;

  function graded(key) {
    return GRADE[key] * (underwater ? SEA_RATIO[key] : 1);
  }

  /** Push GRADE into the pipeline and the lights for the current medium. */
  function applyGrade() {
    if (!pipeline) return;
    const ip = pipeline.imageProcessing;
    ip.exposure = graded("exposure");
    ip.contrast = graded("contrast");
    ip.vignetteEnabled = vignetteOn;
    ip.vignetteWeight = graded("vignette");
    ip.vignetteColor = underwater
      ? new BABYLON.Color4(0.0, 0.05, 0.09, 0)
      : new BABYLON.Color4(0.02, 0.05, 0.09, 0);
    pipeline.bloomWeight = graded("bloom");
    pipeline.bloomEnabled = graded("bloom") > 0.001;
    if (sun) sun.intensity = graded("sun");
    // under water everything emissive sits against a dark field, so the same
    // glow that reads as a beacon in daylight reads as a flare down here
    if (glow) glow.intensity = graded("glow");
    if (skyLight) {
      // under water the whole hemisphere is a light source and the bed bounces
      // some of it back, so nothing is allowed to fall to black the way it can
      // in air with a single low sun
      skyLight.intensity = graded("sky");
      skyLight.diffuse = underwater ? C3("#9fdcea") : C3("#a8cbe8");
      skyLight.groundColor = underwater ? C3("#2c5a58") : C3("#1e3340");
    }
  }

  /** Fog, clear colour, sky visibility and the grade, for the current side. */
  function applyMedium() {
    /* Everything that lives in the air comes out of the scene the moment the
     * camera goes under. The sky, the sun and the clouds ignore fog by design,
     * and the skyline is far enough away that fog should bury it but does not
     * quite, so the Flyer ends up hanging over the seabed. Hiding is cheaper
     * and more certain than fogging.
     */
    skyMeshes.forEach(m => m.setEnabled(!underwater && m._rxHidden !== true));
    scene.fogMode = fogScale > 0 ? BABYLON.Scene.FOGMODE_EXP2 : BABYLON.Scene.FOGMODE_NONE;
    scene.fogDensity = (underwater ? FOG_SEA : FOG_AIR) * fogScale;
    scene.fogColor = C3(underwater ? "#0d4359" : "#93bad9");
    scene.clearColor = underwater
      ? new BABYLON.Color4(0.04, 0.18, 0.25, 1)
      : new BABYLON.Color4(0.05, 0.08, 0.12, 1);
    applyGrade();
  }

  /* ------------------------------------------------------ visual settings --
   *
   * visuals.js calls these; nothing else does. Each one is the smallest
   * change that turns its effect down, so a setting at 0 costs nothing per
   * frame rather than drawing something invisible.
   */

  function setGrade(key, value) {
    if (!(key in GRADE)) return;
    GRADE[key] = value;
    applyGrade();
  }

  function setVignette(on) {
    vignetteOn = Boolean(on);
    applyGrade();
  }

  function setFogScale(scale) {
    fogScale = Math.max(0, scale);
    applyMedium();
  }

  /** The halo around the sun, which is most of what washes out a low view. */
  function setGlare(level) {
    if (!sunGlare) return;
    const on = level > 0.001;
    sunGlare._rxHidden = !on;
    sunGlare.setEnabled(on && !underwater);
    sunGlare.material.emissiveColor = new BABYLON.Color3(1, 0.88, 0.68).scale(level);
    // the disk stays: without it the light has no source and the sky reads
    // as painted rather than lit
    if (sunDisk) sunDisk.material.emissiveColor =
      new BABYLON.Color3(1, 0.97, 0.9).scale(Math.max(0.35, Math.min(1, level + 0.35)));
  }

  /* How bright the bay itself is.
   *
   * This is the one that decides whether an operator can read the course.
   * A low sun on a flat plane lights the water to about (0.24, 0.53, 0.61)
   * and the Fresnel emissive adds most of that again on top, so the near
   * water arrives at the tone curve already close to white and everything
   * floating on it loses its edge. Scaling the diffuse and the emissive
   * together keeps the colour and takes the level down.
   */
  function setWaterTone(level) {
    if (!waterMat) return;
    const t = Math.max(0.05, level);
    waterMat.diffuseColor = C3(WATER_DIFFUSE).scale(t);
    waterMat.emissiveColor = new BABYLON.Color3(t, t, t);
  }

  /** The sun's specular path across the chop. */
  function setGlitter(level) {
    if (!waterMat) return;
    waterMat.specularColor = C3(WATER_SPECULAR).scale(Math.max(0, level));
  }

  /** How much sky the water returns where it meets the horizon. */
  function setSkyMirror(level) {
    if (!waterMat || !waterMat.emissiveFresnelParameters) return;
    const t = Math.max(0, Math.min(1, level));
    waterMat.emissiveFresnelParameters.leftColor =
      BABYLON.Color3.Lerp(C3(WATER_SKY_CALM), C3(WATER_SKY), t);
  }

  /* Surface detail.
   *
   * At level 0 Babylon still runs the perturbation and hands the shader a
   * zero normal, which takes the diffuse, the specular and the Fresnel with
   * it and leaves the bay black. Flat calm means no bump texture at all.
   */
  function setChop(level) {
    if (!waterMat) return;
    if (level <= 0.001) {
      waterMat.bumpTexture = null;
      return;
    }
    if (!waterMat.bumpTexture) waterMat.bumpTexture = Tex.aniso(chopTex, 16, 170);
    waterMat.bumpTexture.level = level;
  }

  /* Swell height. render.js displaces the inner patch by this much; the far
   * plane has to drop with it or the deepest troughs cut through it and leave
   * a lit line running round the patch.
   */
  function setWaves(scale) {
    waveScale = Math.max(0, scale);
    if (!waterFar) return;
    waterFar.unfreezeWorldMatrix();
    waterFar.position.y = -0.18 * Math.max(1, waveScale);
    waterFar.freezeWorldMatrix();
  }

  function setClouds(on) {
    cloudMeshes.forEach(m => {
      m._rxHidden = !on;
      m.setEnabled(Boolean(on) && !underwater);
    });
  }

  function setShadows(on) {
    if (sun) sun.shadowEnabled = Boolean(on);
  }

  function setFxaa(on) {
    if (pipeline) pipeline.fxaaEnabled = Boolean(on);
  }

  return { init, vehicles, buoys, indicators, pipelineLights, clock,
           get mode() { return mode; },
           get scene() { return scene; },
           get camera() { return camera; },
           get glow() { return glow; },
           get engine() { return engine; },
           _internal: {
             get water() { return water; },
             get waterVerts() { return waterVerts; },
             get waterBase() { return waterBase; },
             get waterMat() { return waterMat; },
             get chopTex() { return chopTex; },
             get dockLights() { return dockLights; },
             get spray() { return spray; },
             get wakes() { return wakes; },
             get sun() { return sun; },
             get shadows() { return shadows; },
             get incidentMarker() { return incidentMarker; },
             get keepoutRing() { return keepoutRing; },
             get movingObject() { return movingObject; },
             get diveMarker() { return diveMarker; },
             get patchSize() { return WATER_PATCH; },
             mat, texMat, C3, BEACON_COLORS, rippleMaterial,
             attachPipeline, applyMedium, applyGrade,
             setGrade, setVignette, setFogScale, setGlare, setGlitter,
             setSkyMirror, setWaterTone, setChop, setWaves, setClouds,
             setShadows, setFxaa,
             get waveScale() { return waveScale; },
             get grade() { return GRADE; },
             isUnderwater() { return underwater; },
             setUnderwater(v) { underwater = Boolean(v); applyMedium(); },
             cfg() { return cfg; },
           } };
})();
