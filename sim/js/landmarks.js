/* landmarks.js: the Marina Bay skyline the course sits in.
 *
 * The team works from the Promontory on the west side of the bay and looks
 * north east at Marina Bay Sands, so that is the view this builds: the
 * promontory deck and team village in the near field, the three MBS towers
 * and the SkyPark across the water, the ArtScience lotus beside them, the
 * Helix Bridge and the Esplanade to the north, the Flyer to the east, and the
 * CBD towers behind the camera.
 *
 * Positions come from course.SKYLINE and are roughly the real bearings and
 * distances. Sizes are the real ones where they are known. Nothing here is
 * course hardware: it exists so the operator can tell at a glance which way
 * the vehicle is pointing.
 */
"use strict";

const Landmarks = (() => {
  let built = [];
  let scene, cfg, api;
  const casters = [];

  const V3 = (x, y, z) => new BABYLON.Vector3(x, y, z);

  function box(name, w, h, d, x, y, z, material, ry) {
    const m = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    m.material = material;
    m.isPickable = false;
    return m;
  }

  function cyl(name, opts, x, y, z, material) {
    const m = BABYLON.MeshBuilder.CreateCylinder(name, opts, scene);
    m.position.set(x, y, z);
    m.material = material;
    m.isPickable = false;
    return m;
  }

  /** Glazed slab with a facade texture scaled to its real floor count. */
  function tower(name, w, h, d, x, z, material, ry) {
    const m = box(name, w, h, d, x, h / 2, z, material, ry);
    return m;
  }

  // ---------------------------------------------------------- promontory --
  /* The Promontory itself: a stone deck on the water with the team village on
   * it. This is where the operator stands, so it is the one piece of scenery
   * the camera gets close to and it carries the most detail per square metre.
   */
  function buildPromontory(p) {
    const stone = api.mat("prom-stone", "#7b8087");
    const stoneDark = api.mat("prom-stone-2", "#5f666e");
    const rail = api.mat("prom-rail", "#c2c8ce");
    const grass = api.mat("prom-grass", "#3d5537");
    const canvasMat = api.mat("tent-canvas", "#eef1f4");
    const tentTrim = api.mat("tent-trim", "#1971c2");

    const [px, pz] = p.pos;
    const [pw, pd] = p.size;

    // stepped stone edge down to the water, the way the real quay is built
    for (let i = 0; i < 3; i++) {
      const step = box("prom-step" + i, pw - i * 2.5, 1.1, pd - i * 3.0,
        px, 0.2 + i * 1.0, pz, i % 2 ? stoneDark : stone);
      step.receiveShadows = true;
    }
    const lawn = box("prom-lawn", pw - 16, 0.12, pd - 40, px - 4, 3.3, pz, grass);
    lawn.receiveShadows = true;

    // balustrade along the water edge, posts and a capping rail
    const edgeX = px + pw / 2 - 1.2;
    for (let i = 0; i < 40; i++) {
      const z = pz - pd / 2 + 2 + (i * (pd - 4)) / 39;
      box("prom-post" + i, 0.35, 1.1, 0.35, edgeX, 3.35, z, rail);
    }
    box("prom-caprail", 0.7, 0.22, pd - 2, edgeX, 4.0, pz, rail);

    // team village: four marquees with a peaked roof and a table under each
    for (let i = 0; i < 4; i++) {
      const tz = pz - 30 + i * 20;
      const tx = px - 6;
      for (const [dx, dz] of [[-3.6, -3.6], [-3.6, 3.6], [3.6, -3.6], [3.6, 3.6]]) {
        cyl("tent-leg" + i + dx + dz, { diameter: 0.16, height: 3.2 },
          tx + dx, 5.0, tz + dz, rail);
      }
      const roof = cyl("tent-roof" + i,
        { diameterTop: 0, diameterBottom: 11.4, height: 2.4, tessellation: 4 },
        tx, 7.8, tz, canvasMat);
      roof.rotation.y = Math.PI / 4;
      casters.push(roof);
      const skirt = cyl("tent-skirt" + i,
        { diameterTop: 11.4, diameterBottom: 11.4, height: 0.35, tessellation: 4 },
        tx, 6.6, tz, tentTrim);
      skirt.rotation.y = Math.PI / 4;
      box("tent-table" + i, 3.2, 0.12, 1.2, tx, 4.3, tz, canvasMat);
      box("tent-crate" + i, 1.0, 0.9, 1.0, tx + 4.2, 3.9, tz - 3.0, tentTrim);
    }

    // a crane on the quay, which is how the vehicles get in and out
    const craneBase = box("crane-base", 3.0, 0.8, 3.0, px + 4, 3.8, pz + 46, stoneDark);
    void craneBase;
    cyl("crane-mast", { diameter: 0.6, height: 12 }, px + 4, 10.2, pz + 46, rail);
    const jib = box("crane-jib", 0.5, 0.5, 11, px + 4, 16.0, pz + 51, rail);
    casters.push(jib);
    cyl("crane-cable", { diameter: 0.08, height: 8 }, px + 4, 12.0, pz + 55.5, rail);
  }

  // ------------------------------------------------------ Marina Bay Sands --
  /* Three towers, each a pair of legs that lean together and merge partway up,
   * carrying a 340 m SkyPark that overhangs the north tower. Modelled as a
   * split lower half plus a single upper slab, which is what reads at this
   * distance and keeps the mesh count down.
   */
  function buildMBS(mbs) {
    const h = mbs.tower_height;
    const glassMat = api.texMat("mbs-glass", "#5f7a92",
      Tex.facade(scene, "mbs", "#33465a", "#7d9ab4", "#ffd9a0"));
    const concrete = api.mat("mbs-concrete", "#c8ccd0");
    const parkTop = api.mat("mbs-park", "#9aa7a0");
    const pod = api.mat("mbs-pod", "#e2e6ea");

    [-58, 0, 58].forEach((dz, i) => {
      const cz = mbs.pos[1] + dz;
      // two legs that lean toward each other, joined by the upper slab
      [-1, 1].forEach(s => {
        const leg = BABYLON.MeshBuilder.CreateBox("mbs-leg" + i + (s > 0 ? "a" : "b"),
          { width: 24, height: h * 0.62, depth: 17 }, scene);
        leg.position.set(mbs.pos[0], h * 0.31, cz + s * 12.5);
        leg.rotation.x = s * 0.10;
        leg.material = glassMat;
        leg.isPickable = false;
      });
      const upper = BABYLON.MeshBuilder.CreateBox("mbs" + i,
        { width: 24, height: h * 0.42, depth: 44 }, scene);
      upper.position.set(mbs.pos[0], h * 0.79, cz);
      upper.material = glassMat;
      upper.isPickable = false;
      // the gap between the legs, seen as a dark slot from the water
      box("mbs-slot" + i, 25, h * 0.55, 6, mbs.pos[0], h * 0.28, cz,
        api.mat("mbs-slot-mat", "#22303c"));
    });

    // SkyPark: a 340 m deck with the prow cantilevered off the north tower
    const park = box("skypark", 34, 6, 190, mbs.pos[0], h + 3, mbs.pos[1], concrete);
    park.receiveShadows = true;
    box("skypark-top", 32, 0.6, 186, mbs.pos[0], h + 6.4, mbs.pos[1], parkTop);
    const prow = cyl("skypark-prow",
      { diameterTop: 0, diameterBottom: 34, height: 44, tessellation: 3 },
      mbs.pos[0], h + 3, mbs.pos[1] + 114, concrete);
    prow.rotation.set(Math.PI / 2, 0, 0);
    // the infinity pool and the palms along it
    box("skypark-pool", 12, 0.5, 120, mbs.pos[0] - 6, h + 6.9, mbs.pos[1] - 10,
      api.mat("mbs-pool", "#2f8fb5", { emissive: "#12384a" }));
    for (let i = 0; i < 14; i++) {
      cyl("skypark-palm" + i, { diameter: 1.2, height: 7 },
        mbs.pos[0] + 9, h + 10, mbs.pos[1] - 80 + i * 12, parkTop);
    }
    // the pods on the roof line
    for (let i = 0; i < 3; i++) {
      cyl("skypark-pod" + i, { diameter: 9, height: 5, tessellation: 12 },
        mbs.pos[0], h + 9.5, mbs.pos[1] - 60 + i * 60, pod);
    }
    // podium and the shopping mall along the waterfront
    box("mbs-podium", 70, 26, 210, mbs.pos[0] - 62, 13, mbs.pos[1] - 20, concrete);
    box("mbs-mall", 46, 16, 150, mbs.pos[0] - 128, 8, mbs.pos[1] - 60, pod);
  }

  // ------------------------------------------------- ArtScience Museum ----
  /* Ten fingers rising out of a round base, in a reflecting pond. */
  function buildArtScience(art) {
    const white = api.mat("art-white", "#eef1f4");
    const shade = api.mat("art-shade", "#c9d2da");
    const pond = api.mat("art-pond", "#2b6f8c", { emissive: "#0f2f3d" });

    const disc = cyl("art-pond", { diameter: art.radius * 3.4, height: 0.4, tessellation: 32 },
      art.pos[0], 0.2, art.pos[1], pond);
    disc.receiveShadows = true;
    const bowl = cyl("art-base", { diameterTop: 30, diameterBottom: 13, height: 14, tessellation: 28 },
      art.pos[0], 7, art.pos[1], white);
    bowl.receiveShadows = true;

    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.2;
      const lean = 0.30 + (i % 3) * 0.09;
      const len = 26 + (i % 4) * 9;
      const finger = cyl("art-finger" + i,
        { diameterTop: 3.4, diameterBottom: 10.5, height: len, tessellation: 10 },
        art.pos[0] + Math.cos(a) * art.radius * 0.52,
        13 + len * 0.42,
        art.pos[1] + Math.sin(a) * art.radius * 0.52,
        i % 2 ? white : shade);
      finger.rotation.x = Math.sin(a) * lean;
      finger.rotation.z = -Math.cos(a) * lean;
      casters.push(finger);
      // rounded tip, so the fingers do not end in a flat disc
      const tip = BABYLON.MeshBuilder.CreateSphere("art-tip" + i, { diameter: 3.4, segments: 8 }, scene);
      tip.position.copyFrom(finger.position);
      tip.position.addInPlace(V3(
        Math.cos(a) * Math.sin(lean) * len * 0.5, len * 0.5,
        Math.sin(a) * Math.sin(lean) * len * 0.5));
      tip.material = white;
      tip.isPickable = false;
    }
  }

  // ------------------------------------------------------ Singapore Flyer --
  function buildFlyer(fl) {
    const steel = api.mat("flyer-steel", "#d6dbe0", { emissive: "#1b2735" });
    const gold = api.mat("flyer-glass", "#c9a227", { emissive: "#3a2f0b" });
    const concrete = api.mat("flyer-concrete", "#9aa3ac");
    const hubY = fl.radius + 16;

    // the rim, doubled, with cross bracing between the two rings
    [-4, 4].forEach((dz, ri) => {
      const rim = BABYLON.MeshBuilder.CreateTorus("flyer" + (ri ? "-b" : ""),
        { diameter: fl.radius * 2, thickness: 2.6, tessellation: 56 }, scene);
      rim.rotation.x = Math.PI / 2;
      rim.rotation.y = Math.PI / 2.4;
      rim.position.set(fl.pos[0] + dz * 0.4, hubY, fl.pos[1] + dz);
      rim.material = steel;
      rim.isPickable = false;
    });
    // spokes, as a cable wheel rather than a solid disc
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const spoke = cyl("flyer-spoke" + i, { diameter: 0.6, height: fl.radius * 2, tessellation: 6 },
        fl.pos[0], hubY, fl.pos[1], steel);
      spoke.rotation.z = a;
      spoke.rotation.y = Math.PI / 2.4;
    }
    cyl("flyer-hub", { diameter: 7, height: 12, tessellation: 16 },
      fl.pos[0], hubY, fl.pos[1], steel).rotation.x = Math.PI / 2;

    // 28 capsules hung off the rim
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const capsule = BABYLON.MeshBuilder.CreateSphere("flyer-cap" + i,
        { diameterX: 5, diameterY: 4.4, diameterZ: 5, segments: 8 }, scene);
      capsule.position.set(
        fl.pos[0] + Math.cos(a) * fl.radius * 0.30,
        hubY + Math.sin(a) * fl.radius,
        fl.pos[1] + Math.cos(a) * fl.radius * 0.94);
      capsule.material = gold;
      capsule.isPickable = false;
    }

    // A-frame legs and the terminal building under the wheel
    [-1, 1].forEach((s, i) => {
      const leg = cyl("flyer-leg" + i, { diameter: 4.5, height: hubY + 6 },
        fl.pos[0] + s * 28, (hubY + 6) / 2, fl.pos[1] - 14, concrete);
      leg.rotation.z = -s * 0.24;
    });
    box("flyer-terminal", 70, 14, 46, fl.pos[0], 7, fl.pos[1] - 34, concrete);
  }

  // ---------------------------------------------------------- Helix Bridge --
  function buildHelix(hb) {
    const steel = api.mat("helix-steel", "#e3e7eb", { emissive: "#26384a" });
    const deckMat = api.mat("helix-deck-mat", "#a8b0b8");
    const pods = api.mat("helix-pod", "#cfd6dc", { emissive: "#2b3f52" });

    for (let strand = 0; strand < 2; strand++) {
      const pts = [];
      for (let i = 0; i <= 90; i++) {
        const u = i / 90;
        const phase = strand * Math.PI;
        pts.push(V3(
          hb.pos[0] - hb.span / 2 + u * hb.span,
          10 + Math.sin(u * Math.PI) * 3.4 + Math.sin(u * 15 + phase) * 3.6,
          hb.pos[1] + Math.cos(u * 15 + phase) * 5.4));
      }
      const tube = BABYLON.MeshBuilder.CreateTube("helix" + strand,
        { path: pts, radius: 0.85, tessellation: 8 }, scene);
      tube.material = steel;
      tube.isPickable = false;
      // the rungs that tie the two strands together
      if (strand === 0) {
        for (let i = 4; i < 90; i += 5) {
          const u = i / 90;
          const y1 = 10 + Math.sin(u * Math.PI) * 3.4 + Math.sin(u * 15) * 3.6;
          const y2 = 10 + Math.sin(u * Math.PI) * 3.4 + Math.sin(u * 15 + Math.PI) * 3.6;
          const z1 = hb.pos[1] + Math.cos(u * 15) * 5.4;
          const z2 = hb.pos[1] + Math.cos(u * 15 + Math.PI) * 5.4;
          const rung = BABYLON.MeshBuilder.CreateTube("helix-rung" + i, {
            path: [V3(hb.pos[0] - hb.span / 2 + u * hb.span, y1, z1),
                   V3(hb.pos[0] - hb.span / 2 + u * hb.span, y2, z2)],
            radius: 0.3, tessellation: 6,
          }, scene);
          rung.material = steel;
          rung.isPickable = false;
        }
      }
    }
    const road = box("helix-deck", hb.span, 0.9, 9, hb.pos[0], 9, hb.pos[1], deckMat);
    road.receiveShadows = true;
    // the four viewing pods that cantilever off the deck toward the Sands
    for (let i = 0; i < 4; i++) {
      box("helix-pod" + i, 7, 0.6, 5, hb.pos[0] - hb.span * 0.36 + i * hb.span * 0.24,
        9.2, hb.pos[1] + 7, pods);
    }
    // piers
    for (let i = 0; i < 5; i++) {
      cyl("helix-pier" + i, { diameter: 2.6, height: 18 },
        hb.pos[0] - hb.span / 2 + (i * hb.span) / 4, 4, hb.pos[1], deckMat);
    }
  }

  // ------------------------------------------------------------ Esplanade --
  /* The two spiked domes north of the bay. Cheap to build, instantly
   * recognisable, and they anchor the north bearing for the operator.
   */
  function buildEsplanade(pos) {
    const shellMat = api.mat("espl-shell", "#b6a189", { emissive: "#2a2114" });
    const spike = api.mat("espl-spike", "#8c7b66");
    [[-38, 0], [38, 26]].forEach(([dx, dz], k) => {
      const dome = BABYLON.MeshBuilder.CreateSphere("espl-dome" + k,
        { diameter: 62, segments: 14, slice: 0.55 }, scene);
      dome.position.set(pos[0] + dx, 4, pos[1] + dz);
      dome.material = shellMat;
      dome.isPickable = false;
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        const r = 20 + (i % 3) * 5;
        const sp = cyl("espl-spike" + k + i, { diameterTop: 0, diameterBottom: 3.4, height: 7, tessellation: 5 },
          pos[0] + dx + Math.cos(a) * r, 4 + Math.sqrt(Math.max(0, 900 - r * r)) * 0.9,
          pos[1] + dz + Math.sin(a) * r, spike);
        sp.rotation.x = Math.sin(a) * 0.7;
        sp.rotation.z = -Math.cos(a) * 0.7;
      }
      box("espl-base" + k, 66, 8, 66, pos[0] + dx, 4, pos[1] + dz, spike);
    });
  }

  // ------------------------------------------------------------------ CBD --
  function buildCBD(list) {
    const facades = ["a", "b", "c"].map((k, i) => api.texMat("cbd-glass-" + k,
      "#6d8296", Tex.facade(scene, k,
        ["#2c3b4a", "#33414d", "#293845"][i],
        ["#7f9bb4", "#8fa7bd", "#6e8ba6"][i],
        "#ffd9a0")));
    list.forEach((b, i) => {
      const mat = facades[i % facades.length];
      const t = tower("cbd" + i, b.size[0], b.size[1], b.size[2], b.pos[0], b.pos[1], mat);
      const uv = t.material.diffuseTexture;
      void uv;
      // crown: a setback and a mast, so the silhouette is not all flat tops
      box("cbd-crown" + i, b.size[0] * 0.6, 8, b.size[2] * 0.6,
        b.pos[0], b.size[1] + 4, b.pos[1], api.mat("cbd-crown", "#7d8894"));
      cyl("cbd-mast" + i, { diameter: 1.1, height: 16 },
        b.pos[0], b.size[1] + 16, b.pos[1], api.mat("cbd-mast", "#aab3bc"));
      // podium, so the towers do not appear to float on the water
      box("cbd-podium" + i, b.size[0] * 1.9, 18, b.size[2] * 1.9,
        b.pos[0], 9, b.pos[1], api.mat("cbd-podium", "#8a939c"));
    });
  }

  // ------------------------------------------------------------------ api --
  function build(babylonScene, config, helpers) {
    scene = babylonScene;
    cfg = config;
    api = helpers;
    casters.length = 0;
    const s = cfg.skyline;

    buildPromontory(s.promontory);
    buildMBS(s.marina_bay_sands);
    buildArtScience(s.artscience);
    buildFlyer(s.flyer);
    buildHelix(s.helix_bridge);
    buildEsplanade(s.esplanade || [-40.0, 980.0]);
    buildCBD(s.cbd);

    // Everything above is scenery: it never moves and it is never picked, so
    // freeze the world matrices and let Babylon skip them in the update loop.
    // The same list is what the scene hides when the camera goes under water,
    // where a skyline standing over the seabed reads as a bug.
    const meshes = scene.meshes.filter(m =>
      /^(prom|tent|crane|mbs|skypark|art|flyer|helix|espl|cbd)/.test(m.name));
    meshes.forEach(m => {
      m.isPickable = false;
      m.freezeWorldMatrix();
    });
    built = meshes;
    return { casters, meshes };
  }

  /* The skyline is scenery: on a slow machine, or when the operator wants the
   * course and nothing else, it comes out. scene.js reads _rxHidden when it
   * puts the sky back after a dive, so a landmark turned off here stays off.
   */
  function setVisible(on) {
    built.forEach(m => {
      m._rxHidden = !on;
      m.setEnabled(Boolean(on));
    });
  }

  return { build, setVisible, get meshes() { return built; } };
})();
