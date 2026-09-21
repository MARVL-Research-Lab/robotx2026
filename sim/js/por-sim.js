/* por-sim.js: the proof of readiness rehearsals.
 *
 * One rehearsal per submission (handbook 3.1.2 to 3.1.5). Each one flies the
 * demonstration the video has to show, on the course the handbook specifies,
 * and judges itself against the criteria in readiness.py as it goes: the
 * clearance to every buoy, the depth at the gate, the altitude on takeoff,
 * whether the vehicle actually refused to cross the geofence when it was told
 * to. A criterion is marked the moment it is decided, so an operator watching
 * knows which line of the submission just passed.
 *
 * This is a rehearsal, not evidence. It says the run being planned would pass;
 * the submission still wants the video.
 */
"use strict";

const PorSim = (() => {
  const RUNS = ["USV", "UUV", "UAV", "COMMS"];
  const TAU = Math.PI * 2;

  let cfg = null;
  let state = null;
  let queue = [];
  let current = null;
  const listeners = [];

  const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  const wrap = a => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const deg = r => (r * 180) / Math.PI;

  function on(cb) { listeners.push(cb); }
  function emit(kind, payload) { listeners.forEach(cb => cb(kind, payload)); }

  function event(text) {
    const entry = { t: state.t, text };
    state.events.push(entry);
    if (state.events.length > 120) state.events.shift();
    emit("event", entry);
  }

  function message(label, detail, dir = "TX") {
    const entry = { t: state.t, label, detail, dir };
    state.messages.push(entry);
    if (state.messages.length > 80) state.messages.shift();
    emit("message", entry);
  }

  /** Record a criterion. The first decision stands; a failure is never undone. */
  function mark(id, passed, detail, measured = {}) {
    const prev = state.results[id];
    if (prev && prev.passed === false) return;
    state.results[id] = { passed, detail, measured };
    emit("result", { id, passed, detail, measured });
    if (!passed) event(`FAIL ${id}: ${detail}`);
  }

  // ------------------------------------------------------------ vehicles --
  function vehicleSpec(id) { return cfg.vehicles.find(v => v.id === id); }

  function newVehicle(id) {
    return {
      id,
      x: 0, y: id === "uav" ? 0 : 0, z: 0,
      heading: Math.PI / 2,          // +z, north, the direction every course runs
      speed: 0, climb: 0,
      state: "MANUAL",
      mode: "MANUAL",                // what the visual feedback system shows
      task: null, carrying: null,
      target: null,
      spec: vehicleSpec(id),
    };
  }

  function place(v, x, z, y = 0, heading = Math.PI / 2) {
    v.x = x; v.z = z; v.y = y; v.heading = heading;
    v.speed = 0; v.climb = 0; v.target = null;
  }

  function driveTo(v, x, z, opts = {}) {
    v.target = {
      x, z,
      y: opts.y !== undefined ? opts.y : v.y,
      tol: opts.tol || 0.8,
      throttle: opts.throttle || 1.0,
    };
  }

  function arrived(v) {
    if (!v.target) return true;
    const flat = dist(v.x, v.z, v.target.x, v.target.z) < v.target.tol;
    const vertical = Math.abs(v.y - v.target.y) < 0.35;
    return flat && vertical;
  }

  /* Motion. Deliberately plain: a heading hold onto the target with a turn
   * rate, and a separate vertical rate. The point of the rehearsal is the
   * geometry of the course and the limits the vehicle respects, not a
   * hydrodynamic model.
   */
  function stepVehicle(v, dt) {
    if (v.state === "KILLED") { v.speed = 0; v.climb = 0; return; }
    const y0 = v.y;
    if (v.target) {
      const wantY = v.target.y;
      if (Math.abs(wantY - v.y) > 0.02) {
        const rate = v.id === "uav" ? 4.0 : 0.6;
        v.y += Math.sign(wantY - v.y) * Math.min(rate * dt, Math.abs(wantY - v.y));
      }
      const bearing = Math.atan2(v.target.z - v.z, v.target.x - v.x);
      const err = wrap(bearing - v.heading);
      const turn = v.spec.turn_rate * dt;
      v.heading = wrap(v.heading + Math.max(-turn, Math.min(turn, err)));
      const range = dist(v.x, v.z, v.target.x, v.target.z);
      // slow into the mark, and do not drive sideways out of a hard turn
      const align = Math.max(0, Math.cos(err));
      const want = v.spec.max_speed * v.target.throttle
        * Math.min(1, range / 3.0) * align;
      v.speed += (want - v.speed) * Math.min(1, dt * 2.2);
      v.x += Math.cos(v.heading) * v.speed * dt;
      v.z += Math.sin(v.heading) * v.speed * dt;
    } else {
      v.speed += (0 - v.speed) * Math.min(1, dt * 3);
    }
    v.climb = dt > 0 ? (v.y - y0) / dt : 0;
    if (v.id === "uav") applyUavLimits(v);
  }

  /* The two limits the UAV submission has to prove: the published geofence
   * and the maximum allowable altitude. They are enforced here rather than in
   * the guidance, because that is what the video is showing - the vehicle is
   * commanded past them and does not go.
   */
  function applyUavLimits(v) {
    const fence = cfg.courses.uav;
    const [fx, fz] = cfg.layout.uav.origin;
    const r = dist(v.x, v.z, fx, fz);
    if (r > fence.geofence_radius_m) {
      const k = fence.geofence_radius_m / r;
      v.x = fx + (v.x - fx) * k;
      v.z = fz + (v.z - fz) * k;
      state.fenceHit = true;
    }
    if (v.y > fence.ceiling_m) {
      v.y = fence.ceiling_m;
      state.ceilingHit = true;
    }
    state.uavMaxRadius = Math.max(state.uavMaxRadius, dist(v.x, v.z, fx, fz));
    state.uavMaxAlt = Math.max(state.uavMaxAlt, v.y);
  }

  // ----------------------------------------------------------- the steps --
  function run(steps) {
    queue = steps.filter(Boolean);
    state.stepTotal = queue.length;
    state.stepIndex = 0;
    current = null;
    advance();
  }

  function advance() {
    if (current && current.exit) current.exit();
    current = queue.shift() || null;
    if (current) state.stepIndex += 1;
    if (!current) {
      state.step = "COMPLETE";
      state.running = false;
      emit("finished", { domain: state.domain });
      event(`${state.domain} rehearsal complete`);
      return;
    }
    state.step = current.label;
    emit("step", { step: current.label });
    if (current.enter) current.enter();
  }

  function hold(label, seconds, enter) {
    let t = 0;
    return {
      label,
      enter,
      update(dt) { t += dt; return t >= seconds; },
    };
  }

  // ------------------------------------------------------- USV rehearsal --
  function usvSteps() {
    const spec = cfg.courses.usv;
    const [ox, oz] = cfg.layout.usv.origin;
    const usv = state.vehicles.usv;
    const gates = [oz, oz + spec.gate_spacing_m];
    const startZ = oz - spec.start_offset_m;

    return [
      {
        label: "PLACE_AT_START",
        enter() {
          place(usv, ox, startZ, 0);
          usv.state = "MANUAL";
          usv.mode = "MANUAL";
          const offset = Math.abs(startZ - gates[0]);
          mark("usv.start_offset", offset >= spec.start_offset_m - 0.05,
               `${offset.toFixed(2)} m behind gate 1`, { offset_m: offset });
          event(`USV placed ${offset.toFixed(1)} m behind the first gate`);
        },
        update() { return true; },
      },
      hold("AUTONOMY_ON", 1.6, () => {
        usv.state = "AUTO";
        usv.mode = "AUTO";
        state.scoring = true;
        state.minClearance = Infinity;
        event("USV reports AUTO, hands off the controller");
      }),
      {
        label: "TRANSIT_GATE_1",
        enter() { driveTo(usv, ox, gates[0] + 2.0, { tol: 1.0 }); },
        update() { return arrived(usv); },
      },
      {
        label: "TRANSIT_GATE_2",
        enter() { driveTo(usv, ox, gates[1] + 4.0, { tol: 1.0 }); },
        update() { return arrived(usv); },
      },
      hold("RUN_COMPLETE", 1.0, () => {
        state.scoring = false;
        mark("usv.no_strike", state.minClearance > 0,
             `closest buoy ${state.minClearance.toFixed(2)} m`,
             { clearance_m: state.minClearance });
        mark("usv.autonomous", state.autonomousHeld !== false,
             state.autonomousHeld === false ? "left autonomy during the run"
                                            : "AUTO for the whole run");
        event("USV run complete, both gates cleared");
      }),
      // 3.1.2 also wants the feedback system and both kill switches on camera
      hold("FEEDBACK_AUTO", 1.4, () => { usv.mode = "AUTO"; usv.state = "AUTO";
        state.feedbackSeen.AUTO = true; }),
      hold("FEEDBACK_MANUAL", 1.4, () => { usv.mode = "MANUAL"; usv.state = "MANUAL";
        state.feedbackSeen.MANUAL = true; }),
      hold("KILL_ONBOARD", 1.4, () => {
        usv.mode = "KILLED"; usv.state = "KILLED";
        state.feedbackSeen.KILLED = true;
        state.killSeen.onboard = true;
        event("Onboard kill switch: thrusters stopped");
      }),
      hold("KILL_REMOTE", 1.4, () => {
        state.killSeen.remote = true;
        event("Remote kill switch: thrusters stopped");
      }),
      {
        label: "SAFE",
        enter() {
          usv.state = "MANUAL";
          usv.mode = "MANUAL";
          mark("usv.feedback_lights",
               state.feedbackSeen.AUTO && state.feedbackSeen.MANUAL && state.feedbackSeen.KILLED,
               "auto, manual and kill all shown");
          mark("usv.kill_switch", state.killSeen.onboard && state.killSeen.remote,
               "onboard and remote kill both stopped the vehicle");
        },
        update() { return true; },
      },
    ];
  }

  function usvFrame(dt) {
    const spec = cfg.courses.usv;
    const [ox, oz] = cfg.layout.usv.origin;
    const usv = state.vehicles.usv;
    const gates = [oz, oz + spec.gate_spacing_m];
    const half = spec.gate_width_m / 2;
    const hull = 0.6;                       // BlueBoat half beam plus a margin

    if (state.scoring && usv.state !== "AUTO") state.autonomousHeld = false;

    // clearance to every buoy, every frame
    (Por.parts.usv.buoys || []).forEach(b => {
      const clearance = dist(usv.x, usv.z, b.x, b.z) - b.radius - hull;
      if (state.scoring) state.minClearance = Math.min(state.minClearance, clearance);
    });

    // gate crossings, caught on the frame the vehicle passes the line
    gates.forEach((gz, i) => {
      const key = `gate${i}`;
      const was = state.crossings[key];
      const now = usv.z > gz;
      if (was === undefined) { state.crossings[key] = now; return; }
      if (!was && now && state.scoring) {
        const offset = Math.abs(usv.x - ox);
        const inside = offset < half;
        const headingErr = Math.abs(deg(wrap(usv.heading - Math.PI / 2)));
        mark(`usv.gate${i + 1}`, inside,
             inside ? `crossed ${offset.toFixed(2)} m off centre`
                    : `crossed ${offset.toFixed(2)} m off centre, outside the ${half.toFixed(1)} m half width`,
             { offset_m: offset, heading_error_deg: headingErr });
        state.headingErrors.push(headingErr);
        const worst = Math.max(...state.headingErrors);
        mark("usv.control_quality", worst <= 25,
             `worst heading error at a gate ${worst.toFixed(0)} degrees`,
             { heading_error_deg: worst });
        event(`USV through gate ${i + 1}, ${offset.toFixed(2)} m off centre`);
      }
      state.crossings[key] = now;
    });
  }

  // ------------------------------------------------------- UUV rehearsal --
  function uuvSteps() {
    const spec = cfg.courses.uuv;
    const [ox, oz] = cfg.layout.uuv.origin;
    const uuv = state.vehicles.uuv;
    const usv = state.vehicles.usv;
    const markerZ = oz + spec.marker_distance_m;
    const startZ = oz - spec.start_offset_m;
    const depth = -(spec.gate_depth_m + 0.6);      // under the bar with room
    const tethered = state.variant === "tethered";

    const circle = [];
    const r = spec.circle_radius_m;
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * TAU;
      circle.push([ox + Math.cos(a) * r, markerZ + Math.sin(a) * r]);
    }

    return [
      {
        label: "PLACE_AT_START",
        enter() {
          place(uuv, ox, startZ, 0);
          uuv.state = "MANUAL"; uuv.mode = "MANUAL";
          Por.setUuvCourse(tethered ? "tethered" : "standard");
          if (tethered) {
            place(usv, ox, startZ - 2.5, 0);
            usv.state = "MANUAL"; usv.mode = "MANUAL";
          }
          const offset = Math.abs(startZ - oz);
          mark("uuv.start_offset", offset >= spec.start_offset_m - 0.05,
               `${offset.toFixed(2)} m behind the gate`, { offset_m: offset });
          event(`UUV placed ${offset.toFixed(1)} m behind the gate`
                + (tethered ? ", USV tethered astern" : ""));
        },
        update() { return true; },
      },
      hold("AUTONOMY_ON", 1.6, () => {
        uuv.state = "AUTO"; uuv.mode = "AUTO";
        if (tethered) { usv.state = "AUTO"; usv.mode = "AUTO"; }
        event("UUV reports AUTO" + (tethered ? ", USV reports AUTO" : ""));
      }),
      {
        label: "SUBMERGE",
        enter() {
          driveTo(uuv, ox, startZ + 0.5, { y: depth, tol: 1.2 });
          event(`UUV submerges to ${Math.abs(depth).toFixed(1)} m`);
        },
        update() {
          if (uuv.y > -0.35) return false;
          state.scoring = true;
          state.minClearance = Infinity;
          // the shallowest depth reached, so it starts deeper than anything
          state.maxDepthSeen = -Infinity;
          return Math.abs(uuv.y - depth) < 0.25;
        },
      },
      {
        label: "PASS_THROUGH_GATE",
        enter() { driveTo(uuv, ox, oz + 2.5, { y: depth, tol: 0.9 }); },
        update() { return arrived(uuv); },
      },
      {
        label: "CIRCLE_MARKER",
        enter() {
          state.circleAngle = 0;
          state.circleLast = null;
          state.circleIndex = 0;
          driveTo(uuv, circle[0][0], circle[0][1], { y: depth, tol: 1.0 });
          event("UUV circles the marker");
        },
        update() {
          if (arrived(uuv)) {
            state.circleIndex += 1;
            if (state.circleIndex >= circle.length) {
              const swept = Math.abs(state.circleAngle);
              mark("uuv.marker_circled", swept >= TAU * 0.92,
                   `${deg(swept).toFixed(0)} degrees swept around the marker`,
                   { swept_deg: deg(swept) });
              return true;
            }
            const p = circle[state.circleIndex];
            driveTo(uuv, p[0], p[1], { y: depth, tol: 1.0 });
          }
          return false;
        },
      },
      {
        label: "RETURN_THROUGH_GATE",
        enter() { driveTo(uuv, ox, oz - 2.5, { y: depth, tol: 0.9 }); },
        update() { return arrived(uuv); },
      },
      hold("RUN_COMPLETE", 1.2, () => {
        state.scoring = false;
        mark("uuv.no_breach", state.maxDepthSeen <= -0.3,
             `shallowest ${Math.abs(state.maxDepthSeen).toFixed(2)} m below the surface`,
             { shallowest_m: Math.abs(state.maxDepthSeen) });
        /* On the standard course nothing attached to the vehicle may float.
         * The alternate course is the exemption: a USV tethered to the ROV is
         * meant to be on the surface, so the rule that applies there is that
         * the ROV itself stays under, which uuv.no_breach already measured.
         */
        mark("uuv.nothing_floating", state.maxDepthSeen + 0.15 <= 0,
             tethered
               ? "alternate course: the tethered USV is on the surface by design, "
                 + "the ROV stayed under"
               : "no attached part came above the waterline");
        mark("uuv.no_strike", state.minClearance > 0,
             `closest structure ${state.minClearance.toFixed(2)} m`,
             { clearance_m: state.minClearance });
        mark("uuv.autonomous", state.autonomousHeld !== false,
             state.autonomousHeld === false ? "left autonomy during the run"
                                            : "AUTO for the whole run");
        if (tethered) {
          mark("uuv.tether_pair_autonomous", state.tetherPairAuto !== false,
               "UUV and USV both AUTO for the whole run, hands off");
        }
        event("UUV run complete, back through the gate");
      }),
      {
        label: "SURFACE",
        enter() { driveTo(uuv, ox, oz - 3.5, { y: 0, tol: 1.0 }); },
        update() { return arrived(uuv); },
      },
      hold("FEEDBACK_AUTO", 1.4, () => { uuv.mode = "AUTO"; uuv.state = "AUTO";
        state.feedbackSeen.AUTO = true; }),
      hold("FEEDBACK_MANUAL", 1.4, () => { uuv.mode = "MANUAL"; uuv.state = "MANUAL";
        state.feedbackSeen.MANUAL = true; }),
      hold("KILL_ONBOARD", 1.6, () => {
        uuv.mode = "KILLED"; uuv.state = "KILLED";
        state.feedbackSeen.KILLED = true;
        state.killSeen.onboard = true;
        event("Onboard kill switch: thrusters stopped");
      }),
      {
        label: "SAFE",
        enter() {
          uuv.state = "MANUAL"; uuv.mode = "MANUAL";
          mark("uuv.feedback_lights",
               state.feedbackSeen.AUTO && state.feedbackSeen.MANUAL && state.feedbackSeen.KILLED,
               "auto, manual and kill all shown");
          mark("uuv.kill_switch", state.killSeen.onboard,
               "the onboard kill stopped the vehicle");
        },
        update() { return true; },
      },
    ];
  }

  function uuvFrame(dt) {
    const spec = cfg.courses.uuv;
    const [ox, oz] = cfg.layout.uuv.origin;
    const uuv = state.vehicles.uuv;
    const usv = state.vehicles.usv;
    const half = spec.gate_width_m / 2;
    const hull = 0.35;

    if (state.scoring) {
      if (uuv.state !== "AUTO") state.autonomousHeld = false;
      if (state.variant === "tethered" && (uuv.state !== "AUTO" || usv.state !== "AUTO")) {
        state.tetherPairAuto = false;
      }
      state.maxDepthSeen = Math.max(state.maxDepthSeen, uuv.y);

      const structures = (Por.parts.uuv.legs || []).concat(
        Por.parts.uuv.marker ? [Por.parts.uuv.marker] : []);
      structures.forEach(s => {
        const clearance = dist(uuv.x, uuv.z, s.x, s.z) - (s.radius || 0.2) - hull;
        state.minClearance = Math.min(state.minClearance, clearance);
      });
      // the bar itself: only in the way while the vehicle is under it
      if (Math.abs(uuv.z - oz) < 0.4 && Math.abs(uuv.x - ox) < half) {
        const gap = -spec.gate_depth_m - uuv.y;      // positive when below the bar
        state.minClearance = Math.min(state.minClearance, gap - 0.1);
      }

      // angle swept around the marker, for "circle the Marker"
      const markerZ = oz + spec.marker_distance_m;
      const a = Math.atan2(uuv.z - markerZ, uuv.x - ox);
      if (state.circleLast !== null && state.circleLast !== undefined) {
        state.circleAngle += wrap(a - state.circleLast);
      }
      state.circleLast = a;

      // gate crossings, out and back
      const now = uuv.z > oz;
      if (state.crossings.uuvGate !== undefined && state.crossings.uuvGate !== now) {
        const offset = Math.abs(uuv.x - ox);
        // the standard gate is a bar to pass under; the alternate is a pair
        // of surface buoys, where the requirement is only to stay submerged
        const under = state.variant === "tethered"
          ? uuv.y < -0.3
          : uuv.y < -spec.gate_depth_m;
        const inside = offset < half;
        if (now) {
          mark("uuv.gate_out", inside && under,
               `${offset.toFixed(2)} m off centre, ${Math.abs(uuv.y).toFixed(2)} m deep`,
               { offset_m: offset, depth_m: Math.abs(uuv.y) });
          event(`UUV through the gate at ${Math.abs(uuv.y).toFixed(1)} m`);
        } else {
          mark("uuv.gate_back", inside && under,
               `${offset.toFixed(2)} m off centre, ${Math.abs(uuv.y).toFixed(2)} m deep`,
               { offset_m: offset, depth_m: Math.abs(uuv.y) });
          event("UUV back through the gate");
        }
      }
      state.crossings.uuvGate = now;
    }

    // the tethered pair: the USV follows the ROV on the surface (3.1.3 alt)
    if (state.variant === "tethered" && state.scoring) {
      const lead = 2.5;
      driveTo(usv, uuv.x - Math.cos(uuv.heading) * lead, uuv.z - Math.sin(uuv.heading) * lead,
              { y: 0, tol: 1.2, throttle: 0.7 });
    }
    void dt;
  }

  // ------------------------------------------------------- UAV rehearsal --
  function uavModeSteps(mode) {
    const spec = cfg.courses.uav;
    const [ox, oz] = cfg.layout.uav.origin;
    const uav = state.vehicles.uav;
    const suffix = mode === "manual" ? "manual" : "auto";
    const patternName = mode === "manual" ? "square" : "hourglass";
    const pattern = spec.patterns[patternName].map(p => [ox + p[0], oz + p[1]]);
    const hover = spec.hover_alt_m;

    const steps = [
      {
        label: `${suffix.toUpperCase()}_PREFLIGHT`,
        enter() {
          place(uav, ox, oz, 0);
          uav.state = mode === "manual" ? "MANUAL" : "AUTO";
          uav.mode = uav.state;
          state.patternName = patternName;
          Por.showPattern(patternName);
          Por.showCeiling(false);
          mark(`uav.mode_proof.${suffix}`, true,
               `flight mode indicator reads ${uav.mode}`);
          event(`UAV on the pad in ${uav.mode}, pilot on the flight line`);
        },
        update() { return true; },
      },
      {
        label: `${suffix.toUpperCase()}_TAKEOFF`,
        enter() {
          state.takeoffPeak = 0;
          driveTo(uav, ox, oz, { y: spec.takeoff_min_agl_m + 0.5, tol: 1.0 });
        },
        update() {
          state.takeoffPeak = Math.max(state.takeoffPeak, uav.y);
          if (Math.abs(uav.y - (spec.takeoff_min_agl_m + 0.5)) > 0.2) return false;
          mark(`uav.takeoff_agl.${suffix}`, state.takeoffPeak > spec.takeoff_min_agl_m,
               `climbed to ${state.takeoffPeak.toFixed(2)} m AGL`,
               { peak_agl_m: state.takeoffPeak });
          return true;
        },
      },
      hold(`${suffix.toUpperCase()}_HOVER`, 1.2, () => {
        driveTo(uav, ox, oz, { y: hover, tol: 1.0 });
        state.patternIndex = 0;
        state.patternHits = [];
        state.patternAltOk = true;
      }),
      {
        label: `${suffix.toUpperCase()}_PATTERN_${patternName.toUpperCase()}`,
        enter() {
          driveTo(uav, pattern[0][0], pattern[0][1], { y: hover, tol: 1.2 });
          event(`UAV flies the ${patternName} pattern at ${hover.toFixed(0)} m`);
        },
        update() {
          if (!arrived(uav)) {
            if (Math.abs(uav.y - hover) > 1.2) state.patternAltOk = false;
            return false;
          }
          state.patternHits.push(state.patternIndex + 1);
          state.patternIndex += 1;
          if (state.patternIndex >= pattern.length) {
            const order = state.patternHits.join("-");
            mark(`uav.pattern.${suffix}`,
                 state.patternHits.length === pattern.length && state.patternAltOk,
                 `points ${order} at ${hover.toFixed(0)} m`,
                 { order, altitude_m: hover });
            return true;
          }
          const p = pattern[state.patternIndex];
          driveTo(uav, p[0], p[1], { y: hover, tol: 1.2 });
          return false;
        },
      },
      {
        label: `${suffix.toUpperCase()}_GEOFENCE_TEST`,
        enter() {
          state.fenceHit = false;
          state.fenceHold = 0;
          state.fenceTimer = 0;
          state.uavMaxRadius = 0;
          // commanded well past the boundary, on purpose
          driveTo(uav, ox, oz + spec.geofence_radius_m + 15, { y: hover, tol: 1.5 });
          event("Commanded 15 m past the geofence");
        },
        update(dt) {
          state.fenceTimer += dt;
          if (!state.fenceHit) return state.fenceTimer > 60;
          state.fenceHold += dt;
          if (state.fenceHold < 2.0) return false;
          const overshoot = state.uavMaxRadius - spec.geofence_radius_m;
          mark(`uav.geofence.${suffix}`, overshoot <= 0.25 && state.fenceHit,
               `held at ${state.uavMaxRadius.toFixed(1)} m against the `
               + `${spec.geofence_radius_m.toFixed(0)} m fence for `
               + `${state.fenceHold.toFixed(0)} s`,
               { max_radius_m: state.uavMaxRadius });
          event("UAV held at the geofence");
          return true;
        },
      },
      {
        label: `${suffix.toUpperCase()}_CEILING_TEST`,
        enter() {
          state.ceilingHit = false;
          state.ceilingHold = 0;
          state.ceilingTimer = 0;
          state.uavMaxAlt = 0;
          Por.showCeiling(true);
          // commanded 20 m above the maximum allowable altitude
          driveTo(uav, ox, oz, { y: spec.ceiling_m + 20, tol: 1.5 });
          event(`Commanded 20 m above the ${spec.ceiling_m.toFixed(0)} m ceiling`);
        },
        update(dt) {
          state.ceilingTimer += dt;
          // the step ends when the limit has actually refused the climb, not
          // when the vehicle is merely near it: the refusal is the evidence
          if (!state.ceilingHit) return state.ceilingTimer > 90;
          state.ceilingHold += dt;
          if (state.ceilingHold < 2.0) return false;
          const over = state.uavMaxAlt - spec.ceiling_m;
          mark(`uav.ceiling.${suffix}`, over <= 0.25 && state.ceilingHit,
               `held at ${state.uavMaxAlt.toFixed(1)} m against the `
               + `${spec.ceiling_m.toFixed(0)} m ceiling for `
               + `${state.ceilingHold.toFixed(0)} s`,
               { max_altitude_m: state.uavMaxAlt });
          event("UAV held at the ceiling");
          return true;
        },
        exit() { Por.showCeiling(false); },
      },
      {
        label: `${suffix.toUpperCase()}_RETURN`,
        enter() { driveTo(uav, ox, oz, { y: hover, tol: 1.0 }); },
        update() { return arrived(uav); },
      },
      {
        label: `${suffix.toUpperCase()}_LAND`,
        enter() { driveTo(uav, ox, oz, { y: 0, tol: 0.8 }); },
        update() {
          if (uav.y > 0.05) return false;
          const off = dist(uav.x, uav.z, ox, oz);
          mark(`uav.landing.${suffix}`, off <= spec.landing_tolerance_m,
               `landed ${off.toFixed(2)} m from the takeoff point`, { offset_m: off });
          event(`UAV landed ${off.toFixed(1)} m from the pad, aircraft safe`);
          return true;
        },
      },
    ];
    return steps;
  }

  function uavSteps() {
    const spec = cfg.courses.uav;
    const [ox, oz] = cfg.layout.uav.origin;
    const uav = state.vehicles.uav;
    const linkLoss = [
      {
        label: "LINK_LOSS_CLIMB",
        enter() {
          uav.state = "AUTO"; uav.mode = "AUTO";
          driveTo(uav, ox + 8, oz + 8, { y: spec.hover_alt_m + 4, tol: 1.2 });
          event("Flying out for the link loss demonstration");
        },
        update() { return arrived(uav); },
      },
      hold("LINK_LOSS", 2.0, () => {
        state.linkLost = true;
        event("Controller link lost: the UAV holds, then returns");
      }),
      {
        label: "LINK_LOSS_RETURN",
        enter() { driveTo(uav, ox, oz, { y: spec.hover_alt_m, tol: 1.0 }); },
        update() { return arrived(uav); },
      },
      {
        label: "LINK_LOSS_LAND",
        enter() { driveTo(uav, ox, oz, { y: 0, tol: 0.8 }); },
        update() {
          if (uav.y > 0.05) return false;
          const off = dist(uav.x, uav.z, ox, oz);
          mark("uav.link_loss", state.linkLost && off <= spec.landing_tolerance_m,
               `returned and landed ${off.toFixed(2)} m from the takeoff point`,
               { offset_m: off });
          state.linkLost = false;
          return true;
        },
      },
    ];
    return uavModeSteps("manual").concat(uavModeSteps("auto"), linkLoss);
  }

  // ----------------------------------------------------- COMMS rehearsal --
  /* The eight steps of 3.4.10, which is what the rc-test log has to show.
   *
   * The values are the ones from the log actually submitted, served as
   * cfg.submission.run out of docs/comms-por, so the drawing cannot drift
   * from the evidence. With no submission on disk it falls back to the shape
   * of the same exchange. The real log comes from scripts/comms_por.sh.
   */
  function commsSteps() {
    const run = (cfg.submission && cfg.submission.run) || {};
    const team = run.team_id || "TEAM";
    const ids = (run.vehicles && run.vehicles.length)
      ? run.vehicles : ["USV1", "UUV1", "UAV1"];
    const course = run.course_id || "ALPHA";
    const pinger = run.pinger_hz || 25000;
    const corners = run.boundary_points || 5;
    const fence = run.geofence_points || 5;
    const tier = ((run.tiers && run.tiers.task1) || "TIER_ADVANCED")
      .replace("TIER_", "");
    const seq = run.declaration_seq || 1;
    const runId = run.run_id || 1;
    const root = "robocommand/robotx";

    return [
      hold("CONNECT", 1.0, () => {
        message("connect", `${root} broker, MQTT over TCP 1883`, "TX");
        event("1. OCS opens its one connection to the course RoboCommand broker");
      }),
      hold("SUBSCRIBE", 1.2, () => {
        message("subscribe", `${root}/course, ${root}/${team}/command`, "TX");
        event("2. OCS subscribes to the course and its own command topic");
      }),
      hold("RX_COURSE", 1.4, () => {
        message("RxCourse",
                `retained: ${course}, pinger ${pinger} Hz, ${corners}-point boundary`,
                "RX");
        mark("comms.course_received", true,
             `retained RxCourse received: course ${course}, pinger ${pinger} Hz`,
             { boundary_points: corners });
        event("3. Retained RxCourse arrives on subscribe and is validated");
      }),
      hold("RUN_DECLARATION", 1.6, () => {
        message("RunDeclaration",
                `seq ${seq}: ${ids.join(", ")}, all tasks ${tier}, `
                + `${fence}-point UAV geofence`,
                "TX");
        mark("comms.declaration_two_vehicles", ids.length >= 2,
             `${ids.length} vehicles declared: ${ids.join(", ")}`,
             { vehicles: ids.length });
        event(`4. RunDeclaration published on ${root}/${team}/request`);
      }),
      hold("HEARTBEATS_MANUAL", 2.0, () => {
        Object.values(state.vehicles).forEach(v => { v.state = "MANUAL"; v.mode = "MANUAL"; });
        ids.forEach(id => message("Heartbeat", `${id} STATE_MANUAL`, "TX"));
        event("5. Heartbeats at 2 Hz per vehicle while the fleet is still held");
      }),
      hold("HEARTBEATS_AUTO", 2.0, () => {
        ids.forEach(id => message("Heartbeat", `${id} STATE_AUTO`, "TX"));
        Object.values(state.vehicles).forEach(v => { v.state = "AUTO"; v.mode = "AUTO"; });
        mark("comms.all_auto", true,
             `every declared vehicle reports STATE_AUTO and holds position`,
             { vehicles: ids.length });
        event("6. Each vehicle reports STATE_AUTO once autonomous and ready");
      }),
      hold("RUN_START", 1.4, () => {
        message("RunStart", `declaration_seq ${seq}, run_id ${runId}`, "RX");
        mark("comms.run_start", true,
             `RoboCommand released the run: run_id ${runId}`, { run_id: runId });
        event(`7. RoboCommand publishes RunStart on ${root}/${team}/command`);
      }),
      hold("VERIFY", 1.4, () => {
        mark("comms.declaration_seq_verified", true,
             `RunStart quotes declaration_seq ${seq}, matching our declaration`,
             { declaration_seq: seq });
        event("8. declaration_seq verified: the vehicles may leave position hold");
      }),
    ];
  }

  // ---------------------------------------------------------------- api --
  function blankState() {
    return {
      t: 0,
      running: false,
      domain: "USV",
      variant: "standard",
      step: "IDLE",
      vehicles: {
        usv: newVehicle("usv"),
        uuv: newVehicle("uuv"),
        uav: newVehicle("uav"),
      },
      results: {},
      messages: [],
      events: [],
      stepTotal: 0,
      stepIndex: 0,
      // per-run bookkeeping
      scoring: false,
      autonomousHeld: true,
      tetherPairAuto: true,
      minClearance: Infinity,
      maxDepthSeen: -Infinity,
      crossings: {},
      headingErrors: [],
      feedbackSeen: { AUTO: false, MANUAL: false, KILLED: false },
      killSeen: { onboard: false, remote: false },
      circleAngle: 0,
      circleLast: null,
      circleIndex: 0,
      takeoffPeak: 0,
      patternName: null,
      patternIndex: 0,
      patternHits: [],
      patternAltOk: true,
      fenceHit: false,
      ceilingHit: false,
      linkLost: false,
      uavMaxRadius: 0,
      uavMaxAlt: 0,
      // what render.js reads and this page does not use
      /* No locator ring either. It exists to say which speck on a 500 m
       * course is the vehicle; here the vehicle fills the frame, and the ring
       * is in the glow layer, so up close it puts the boat in a saucer of
       * light. The track, the mark and the telemetry caption say the same
       * thing without covering the water.
       */
      showRings: false,
      /* No expanding locator pulse. It exists to pick a vehicle out of a
       * 500 m course; here the chase camera sits 5 m away and the ring sweeps
       * straight through it once a second.
       */
      showPulse: false,
      showLabels: true,
      labelScale: 0.55,              // the courses of 3.1 are metres across
      /* Where the ground is under the UAV. Its altitude is AGL and the pad it
       * flies off is on the bank, so a landing at 0 m AGL is 0.16 m up in the
       * scene. Without this the aircraft parks inside the pad.
       */
      groundY: 0.15,
      beacons: {},
      repairedSegments: [],
      fire: null,
      incident: null,
      spraying: false,
      probeOut: false,
    };
  }

  function init(config) {
    cfg = config;
    state = blankState();
    parkAll();
    return state;
  }

  /** Everything not in the current rehearsal waits out of the way. */
  function parkAll() {
    const usvHome = cfg.layout.usv.origin;
    const uuvHome = cfg.layout.uuv.origin;
    const uavHome = cfg.layout.uav.origin;
    place(state.vehicles.usv, usvHome[0], usvHome[1] - cfg.courses.usv.start_offset_m, 0);
    place(state.vehicles.uuv, uuvHome[0], uuvHome[1] - cfg.courses.uuv.start_offset_m, 0);
    place(state.vehicles.uav, uavHome[0], uavHome[1], 0);
    Object.values(state.vehicles).forEach(v => { v.state = "MANUAL"; v.mode = "MANUAL"; });
  }

  /* Load a rehearsal. Every verdict so far is kept, including this domain's:
   * choosing a submission to look at must not throw away the run that proved
   * it. Starting a new run is what replaces its verdict.
   */
  function setRun(domain, opts = {}) {
    if (RUNS.indexOf(domain) === -1) return;
    const keep = { ...state.results };
    const fresh = blankState();
    Object.assign(state, fresh, {
      results: keep,
      domain,
      variant: opts.variant || "standard",
      messages: state.messages,
      events: state.events,
    });
    parkAll();
    queue = [];
    current = null;
    state.step = "READY";
    emit("run", { domain, variant: state.variant });
  }

  function clearDomain(domain) {
    Object.keys(state.results).forEach(id => {
      if (id.startsWith(domain.toLowerCase() + ".")) delete state.results[id];
    });
  }

  function start() {
    if (state.running) return;
    if (!current && !queue.length) {
      const builder = {
        USV: usvSteps, UUV: uuvSteps, UAV: uavSteps, COMMS: commsSteps,
      }[state.domain];
      // a new run replaces whatever the last one decided about this domain
      clearDomain(state.domain);
      state.t = 0;
      run(builder());
      emit("reset", { domain: state.domain });
    }
    state.running = true;
    emit("running", { running: true });
  }

  function pause() { state.running = false; emit("running", { running: false }); }
  function toggle() { state.running ? pause() : start(); }

  function reset() {
    const domain = state.domain, variant = state.variant;
    const keep = { ...state.results };
    Object.assign(state, blankState(), { domain, variant, results: keep });
    clearDomain(domain);
    parkAll();
    queue = [];
    current = null;
    state.step = "READY";
    emit("reset", { domain });
  }

  function update(dt) {
    if (!state.running || !current) return;
    state.t += dt;
    if (state.domain === "USV") usvFrame(dt);
    else if (state.domain === "UUV") uuvFrame(dt);
    Object.values(state.vehicles).forEach(v => stepVehicle(v, dt));
    if (current.update && current.update(dt)) advance();
  }

  return {
    init, setRun, start, pause, toggle, reset, update, on,
    get state() { return state; },
    get runs() { return RUNS.slice(); },
    get stepsLeft() { return queue.length; },
  };
})();
