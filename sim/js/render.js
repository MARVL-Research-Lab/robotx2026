/* render.js: per-frame sync between the mission state and the Babylon scene.
 *
 * Everything time-varying lives here: the water surface, the 1 s on / 1 s off
 * beacon flashing from handbook 3.3.2, thruster and rotor spin, the visual
 * feedback lights (RED killed, YELLOW manual, GREEN autonomous, 5.3.1), task
 * lights, wakes and spray, Task 4 markers, and the cameras.
 *
 * It also owns the crossing of the waterline. The moment the active camera
 * goes under, the fog, the grade, the particle systems and the light all
 * change together, because a picture that is half above and half below reads
 * as a bug rather than as water.
 */
"use strict";

const Render = (() => {
  const V = World._internal;
  const STATUS_COLORS = { AUTO: "#22dd55", MANUAL: "#ffd43b", KILLED: "#ff2d2d" };
  let t = 0;
  let waterPhase = 0;
  let wasSubmerged = false;
  let flatWater = false;

  /** A visual setting, or its default when visuals.js is not loaded. */
  const vis = (key, fallback) =>
    (typeof Visuals === "undefined" ? fallback : Visuals.get(key));

  function setEmissive(mesh, hex) {
    if (!mesh || !mesh.material) return;
    const c = BABYLON.Color3.FromHexString(hex);
    mesh.material.diffuseColor = c;
    mesh.material.emissiveColor = c;
  }

  /* Swell on the inner water patch. Three components at different headings so
   * the surface never repeats visibly, faded to nothing at the rim so the
   * patch meets the far plane without a step.
   */
  function animateWater(dt) {
    const water = V.water, base = V.waterBase, verts = V.waterVerts;
    if (!water || !base) return;
    const amp = V.waveScale;
    if (amp <= 0 && flatWater) return;      // nothing to move on a flat calm
    flatWater = amp <= 0;
    waterPhase += dt;
    const half = V.patchSize / 2;
    const fadeFrom = half * 0.72;
    for (let i = 0; i < base.length; i += 3) {
      const x = base[i], z = base[i + 2];
      const r = Math.max(Math.abs(x), Math.abs(z));
      const fade = r <= fadeFrom ? 1 : Math.max(0, 1 - (r - fadeFrom) / (half - fadeFrom));
      /* Wavelengths of 10 to 50 m, which is chop in a sheltered basin. The
       * first pass used 120 to 350 m and the bay read as an ocean swell.
       *
       * The amplitudes sum to WAVE_MIN, and the far plane sits just under
       * that. Any more clearance and the step between the two shows up as a
       * lit line running round the patch at grazing angles.
       */
      verts[i + 1] = fade * amp * (
        Math.sin(x * 0.30 + waterPhase * 1.9) * 0.061 +
        Math.sin(z * 0.24 - waterPhase * 1.5) * 0.049 +
        Math.sin((x + z) * 0.092 + waterPhase * 0.9) * 0.041 +
        Math.sin((x - z) * 0.61 - waterPhase * 3.1) * 0.016);
    }
    water.updateVerticesData(BABYLON.VertexBuffer.PositionKind, verts);
    water.createNormals(false);

    // the chop rides on top of the swell, scrolling across it
    const bump = V.waterMat && V.waterMat.bumpTexture;
    if (bump) {
      bump.uOffset += dt * 0.011;
      bump.vOffset += dt * 0.0075;
    }
  }

  function flashPhase() {
    // 1 s on, 1 s off (3.3.2)
    return Math.floor(t) % 2 === 0;
  }

  function syncBuoys(state) {
    const on = flashPhase();
    const cam = World.scene.activeCamera;
    Object.entries(World.buoys).forEach(([id, buoy]) => {
      const desired = (state.beacons && state.beacons[id]) || buoy.state;
      buoy.state = desired;
      const lit = V.BEACON_COLORS[desired] || "#15181d";
      const flashing = desired.startsWith("FLASHING");
      const sideVisible = state.tier === "CORE" || !state.uavOnly;
      const color = (flashing && !on) ? "#15181d" : lit;
      setEmissive(buoy.side, sideVisible ? color : "#15181d");
      setEmissive(buoy.top, color);
      if (buoy.flare) {
        // The beacon meshes blink with the real 1 s cycle, but every flashing
        // buoy blinks in step, so following that on the flare would leave the
        // whole field dark half the time. The flare keeps its colour and dims
        // instead, which is what makes the configuration readable.
        setEmissive(buoy.flare, desired === "OFF" ? "#15181d" : lit);
        buoy.flare.material.alpha =
          desired === "OFF" ? 0.18 : (flashing && !on ? 0.3 : 0.85);
        const d = BABYLON.Vector3.Distance(cam.position, buoy.flare.position);
        const scale = Math.min(4, Math.max(0.6, d * 0.012));
        buoy.flare.scaling.set(scale, scale, scale);
      }
    });
  }

  function syncTask2(state) {
    World.pipelineLights.forEach(light => {
      const repaired = state.repairedSegments && state.repairedSegments.includes(light.index);
      setEmissive(light.mesh, light.damaged && !repaired ? "#ff2d2d" : "#22dd55");
    });
    Object.values(World.indicators).forEach(ind => {
      setEmissive(ind.cyl, ind.color === "GREEN" ? "#22dd55" : "#ff2d2d");
      if (!ind.pingerActive) return;
      // 1 Hz pulse, the middle of the handbook's 0.5 to 2 Hz range (3.5.4)
      const phase = t % 1;
      const pulse = phase < 0.12;
      if (ind.pingerFace) setEmissive(ind.pingerFace, pulse ? "#fff3bf" : "#4d4322");
      if (ind.pingerRing) {
        // a ring leaving the transducer once a second, so the acoustic cue the
        // UUV homes on is visible to someone watching the run
        const age = phase;
        ind.pingerRing.setEnabled(true);
        const r = 0.3 + age * 3.4;
        ind.pingerRing.scaling.set(r, r, r);
        ind.pingerRing.material.alpha = Math.max(0, 0.16 * (1 - age) * (1 - age));
      }
    });
  }

  function syncTask3(state) {
    V.dockLights.forEach(bay => {
      setEmissive(bay.indicator, bay.safe ? "#22dd55" : "#ff2d2d");
      bay.windows.forEach((pane, i) => {
        let color = "#15181d";
        if (state.fire && state.fire.bay === bay.bay && state.fire.window === i) {
          if (state.fire.out) {
            color = "#22dd55";
          } else if (state.fire.flashColor) {
            color = flashPhase() ? state.fire.flashColor : "#15181d";
          } else {
            // a fire flickers; a steady red square reads as an LED
            const f = 0.55 + 0.45 * Math.sin(t * 11.3) * Math.sin(t * 6.1);
            const c = new BABYLON.Color3(1, 0.25 + 0.2 * f, 0.1).scale(0.6 + 0.4 * f);
            pane.material.diffuseColor = c;
            pane.material.emissiveColor = c;
            return;
          }
        }
        setEmissive(pane, color);
      });
    });
  }

  function syncVehicles(state, dt) {
    const cam = World.scene.activeCamera;
    Object.entries(World.vehicles).forEach(([id, v]) => {
      const s = state.vehicles[id];
      if (!s) return;
      v.root.position.set(s.x, s.y, s.z);
      /* Yaw. Every hull in vehicles.js is drawn with its bow along local +x,
       * and a heading is the compass-free angle the sim steers on, measured
       * the same way: heading 0 is +x, heading PI/2 is +z. Babylon turns local
       * +x to (cos y, 0, -sin y), so the yaw that puts the bow on the heading
       * is -heading. Anything else drives the vehicle sideways across its own
       * track, which is what this used to do.
       */
      v.root.rotation.y = -s.heading;
      // an aircraft's altitude is above the ground it took off from, that
      // ground is not always the waterline, and the model stands on its gear
      if (id === "uav" && state.groundY) {
        v.root.position.y += state.groundY + (v.gearY || 0);
      }

      if (id === "uuv") {
        // a submerged hull trims bow-down as it descends and rolls a little
        // as the vectored thrusters work against each other
        const climb = s.climb || 0;
        v.root.rotation.z = Math.max(-0.35, Math.min(0.35, -climb * 0.5));
        v.root.rotation.x = Math.sin(t * 0.7 + s.z * 0.1) * 0.03;
      } else if (id === "uav") {
        // a quad leans into its acceleration, but 20 degrees in the cruise
        // reads as a stall rather than as forward flight
        v.root.rotation.z = -Math.min(0.2, Math.abs(s.speed) * 0.032);
        v.root.rotation.x = Math.sin(t * 1.6) * 0.015;
      } else {
        v.root.rotation.z = Math.sin(t * 1.3 + s.x * 0.1) * 0.035;
        v.root.rotation.x = Math.sin(t * 0.9 + s.z * 0.1) * 0.025;
      }

      setEmissive(v.statusLight, STATUS_COLORS[s.state] || "#495057");

      const rate = id === "uav" ? 40 : 9;
      const spin = s.state === "KILLED" ? 0 : (0.3 + Math.abs(s.speed)) * rate;
      v.props.forEach((p, i) => { p.rotation.y += spin * dt * (i % 2 ? 1 : -1); });

      if (v.tin) v.tin.setEnabled(Boolean(s.carrying));
      if (v.tinLine) v.tinLine.setEnabled(Boolean(s.carrying));
      if (v.tin && s.carrying) {
        const hex = V.cfg().platforms.colors[s.carrying] || "#E8282B";
        v.tin.material.diffuseColor = BABYLON.Color3.FromHexString(hex);
        v.tin.material.emissiveColor = BABYLON.Color3.FromHexString(hex).scale(0.3);
      }
      if (v.beacon) setEmissive(v.beacon, (t % 1) < 0.15 ? "#ffd43b" : "#3d3413");

      // rings sit on the water for surface craft and travel with the UUV
      const ringY = id === "uuv" ? s.y : 0.08;
      v.ring.position.set(s.x, ringY, s.z);
      v.ring.isVisible = state.showRings !== false;
      /* The ring is how a vehicle is found across a 500 m course, and it is
       * in the glow layer to be findable. Up close the bloom off it fills the
       * ring with light and the vehicle sits in a saucer, so it fades out
       * inside 4 m, where nothing needs help finding anything.
       */
      const ringDist = BABYLON.Vector3.Distance(cam.position, v.ring.position);
      const ringFade = Math.max(0, Math.min(1, (ringDist - 4) / 6));
      v.ring.material.alpha =
        (0.26 + 0.16 * Math.sin(t * 2 + (id === "usv" ? 0 : 2))) * ringFade;
      if (v.pulse) {
        const p = (t * 0.55 + (id === "usv" ? 0 : 0.4)) % 1;
        const scale = (v.pulse.ringDiameter || 1.4) * (1 + p * 2.0);
        v.pulse.position.set(s.x, ringY, s.z);
        v.pulse.scaling.set(scale, 1, scale);
        v.pulse.material.alpha = 0.16 * (1 - p);
        v.pulse.isVisible = state.showRings !== false && state.showPulse !== false;
      }

      // the nameplate rides the aircraft and floats over the water for the
      // two boats, which is where it can be read from above a submerged ROV
      v.label.position.set(
        s.x, (id === "uav" ? v.root.position.y : Math.max(s.y, 0)) + 2.2, s.z);
      v.label.isVisible = state.showLabels !== false;
      // hold the label at a readable size whether the camera is on top of the
      // vehicle or looking across the whole course
      const labelDist = BABYLON.Vector3.Distance(cam.position, v.label.position);
      // `labelScale` is the site: a nameplate sized for a boat crossing the
      // bay is wider than the same boat on a 15 m readiness course
      const labelScale = Math.min(4.5, Math.max(0.45, labelDist * 0.022))
        * (state.labelScale || 1);
      v.label.scaling.set(labelScale, labelScale, labelScale);
    });
  }

  /* The UUV under water: lamps on, beams visible, bubbles from the thrusters,
   * and the probe arm swung down while it is holding on to the pipeline.
   */
  function syncUuv(state, dt) {
    const v = World.vehicles.uuv;
    const s = state.vehicles.uuv;
    if (!v || !s) return;
    const submerged = s.y < -0.15;

    if (v.beams) v.beams.forEach(b => b.setEnabled(submerged));
    if (v.lamps) {
      const lit = submerged ? "#fff3bf" : "#5a5540";
      v.lamps.forEach(l => setEmissive(l, lit));
    }
    if (v.lumen) v.lumen.intensity = submerged ? 3.2 : 0;
    if (v.tether) v.tether.setEnabled(submerged);

    // the probe swings out for the mark and repair steps, and stows otherwise
    if (v.arm) {
      const wantOut = Boolean(state.probeOut);
      const target = wantOut ? -0.55 : 0.15;
      v.arm.rotation.z += (target - v.arm.rotation.z) * Math.min(1, dt * 2.5);
    }
    if (v.probe) {
      setEmissive(v.probe, state.probeOut && (t % 0.6) < 0.3 ? "#ff6b6b" : "#7a1d1d");
    }

    // a ring on the surface over the ROV, since the water above it is opaque
    const marker = V.diveMarker;
    if (marker) {
      marker.setEnabled(submerged);
      if (submerged) {
        marker.position.set(s.x, 0.05, s.z);
        const grow = 1 + 0.06 * Math.sin(t * 1.6);
        marker.scaling.set(grow, grow, grow);
      }
    }

    const bubbles = Underwater.bubblers.uuv;
    if (bubbles) {
      const want = submerged && vis("particles", true);
      if (want && !bubbles.isStarted()) bubbles.start();
      else if (!want && bubbles.isStarted()) bubbles.stop();
      if (want) bubbles.emitRate = 24 + Math.abs(s.speed) * 90 + Math.abs(s.climb || 0) * 120;
    }
  }

  function syncIncident(state) {
    const marker = V.incidentMarker, ring = V.keepoutRing, obj = V.movingObject;
    const inc = state.incident;
    marker.setEnabled(false);
    ring.setEnabled(false);
    obj.setEnabled(false);
    if (!inc) return;
    if (inc.kind === "ASSISTANCE_REQUEST") {
      marker.setEnabled(true);
      marker.position.set(inc.pos[0], 3 + Math.sin(t * 3) * 0.5, inc.pos[1]);
      marker.rotation.y = t;
    } else if (inc.kind === "KEEPOUT_ZONE") {
      ring.setEnabled(true);
      ring.position.set(inc.pos[0], 0.4, inc.pos[1]);
      ring.scaling.set(inc.radius_m, 1, inc.radius_m);
      ring.material.alpha = 0.4 + 0.2 * Math.sin(t * 3);
    } else if (inc.kind === "MOVING_OBJECT") {
      obj.setEnabled(true);
      obj.position.set(inc.pos[0], 0.7, inc.pos[1]);
      obj.rotation.y = -(inc.heading_deg * Math.PI) / 180;
      ring.setEnabled(true);
      ring.position.set(inc.pos[0], 0.35, inc.pos[1]);
      ring.scaling.set(10, 1, 10);       // the 10 m standoff from 3.3.5
      ring.material.alpha = 0.35;
    }
  }

  function syncSpray(state) {
    const s = V.spray;
    if (!s) return;
    if (state.spraying && vis("particles", true)) {
      const usv = state.vehicles.usv;
      s.src.position.set(
        usv.x + Math.cos(usv.heading) * 0.4, 1.0, usv.z + Math.sin(usv.heading) * 0.4);
      const dir = new BABYLON.Vector3(Math.cos(usv.heading), 0.62, Math.sin(usv.heading));
      s.ps.direction1 = dir.scale(0.9);
      s.ps.direction2 = dir.scale(1.2).add(new BABYLON.Vector3(0, 0.4, 0));
      if (!s.ps.isStarted()) s.ps.start();
    } else if (s.ps.isStarted()) {
      s.ps.stop();
    }
  }

  /** Wake behind each surface craft, and a foam patch at its waterline. */
  function syncWakes(state) {
    const particles = vis("particles", true);
    Object.entries(V.wakes).forEach(([id, w]) => {
      const s = state.vehicles[id];
      if (!s) return;
      // off means stopped, not emitting nothing: a stopped system is not
      // stepped at all, which is the point of the toggle on weak hardware
      if (!particles && w.ps.isStarted()) w.ps.stop();
      else if (particles && !w.ps.isStarted()) w.ps.start();
      const surfaced = s.y > -0.4;
      const speed = Math.abs(s.speed);
      w.src.position.set(
        s.x - Math.cos(s.heading) * 0.62, 0.02, s.z - Math.sin(s.heading) * 0.62);
      w.src.rotation.y = -s.heading;
      w.ps.emitRate = surfaced && particles ? speed * 38 : 0;
      w.ps.minEmitPower = 0.2 + speed * 0.3;
      w.ps.maxEmitPower = 0.6 + speed * 0.8;
      w.foam.setEnabled(surfaced && particles);
      w.foam.position.set(s.x, 0.045, s.z);
      const grow = 1 + speed * 0.35 + 0.05 * Math.sin(t * 3);
      w.foam.scaling.set(grow, grow, grow);
      w.foam.material.alpha = 1;
    });
  }

  // ------------------------------------------------------------ cameras --
  /* camera.js owns every camera in the scene. render.js only tells it what
   * moved, so the follow logic and the medium switch below cannot disagree
   * about which camera is rendering.
   */
  function setPov(id) { Cameras.setPov(id || null); }

  /* Crossing the waterline. One place, so the fog, the clear colour, the grade
   * and the underwater systems can never disagree about which side we are on.
   */
  function updateMedium() {
    const active = World.scene.activeCamera;
    const below = active.position.y < 0;
    if (below === wasSubmerged) return;
    wasSubmerged = below;
    V.setUnderwater(below);      // fog, clear colour and the grade follow
  }

  function frame(state, dt) {
    t += dt;
    World.clock.t = t;
    animateWater(dt);
    syncBuoys(state);
    syncTask2(state);
    syncTask3(state);
    syncVehicles(state, dt);
    syncUuv(state, dt);
    syncIncident(state);
    syncSpray(state);
    syncWakes(state);
    Cameras.frame(state, dt);
    updateMedium();
    Underwater.frame(t, dt, World.scene.activeCamera.position.y, state.vehicles.uuv);
  }

  return { frame, setPov, get pov() { return Cameras.pov; } };
})();
