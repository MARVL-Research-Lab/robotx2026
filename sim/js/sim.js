/* sim.js: the mission itself.
 *
 * Runs the four tasks at the selected tier, walking the same step sequences
 * the orchestrator dispatches (they come from robotx.models.tasks through
 * /api/course), and emitting the RoboCommand messages the real link would
 * publish: RxCourse, RunDeclaration, RunStart, heartbeats at 2 Hz, the task
 * reports from handbook 3.4.12, and the Task 4 command and response chains.
 */
"use strict";

const Sim = (() => {
  let cfg = null;
  let state = null;
  let queue = [];
  let current = null;
  let suspended = null;
  let hbAccum = 0;
  const listeners = [];

  const TAU = Math.PI * 2;
  // A UUV must not breach the surface during a scoring run (5.3.2), so once
  // RunStart lands the vehicle is held below this depth whatever a step asks
  // for. 0.55 m puts the whole 0.25 m frame and its foam under water with
  // room for the swell.
  const UUV_MIN_DEPTH = -0.55;
  const UUV_TRANSIT_DEPTH = -1.4;
  const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  const wrap = a => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

  function on(cb) { listeners.push(cb); }
  function emit(kind, payload) { listeners.forEach(cb => cb(kind, payload)); }

  function message(label, detail, dir = "TX") {
    const entry = { t: state.t, label, detail, dir };
    state.messages.push(entry);
    if (state.messages.length > 300) state.messages.shift();
    emit("message", entry);
  }

  function event(text) {
    const entry = { t: state.t, text };
    state.events.push(entry);
    if (state.events.length > 200) state.events.shift();
    emit("event", entry);
  }

  // ------------------------------------------------------------ vehicles --
  function vehicleSpec(id) { return cfg.vehicles.find(v => v.id === id); }

  function newVehicle(id) {
    const spec = vehicleSpec(id);
    const start = cfg.starts[id];
    return {
      id,
      x: start.pos[0], z: start.pos[1], y: id === "uav" ? 0.2 : 0,
      heading: (start.heading_deg * Math.PI) / 180,
      speed: 0,
      climb: 0,                   // m/s, positive up: drives trim and bubbles
      state: "MANUAL",            // becomes AUTO when the run is armed
      task: null,
      carrying: null,
      target: null,               // {x, z, y, tol, hold}
      orbit: null,                // {cx, cz, r, dir, remaining}
      spec,
      scoring: true,
    };
  }

  /** Hold the UUV under the surface once the run has started (5.3.2). */
  function legalDepth(v, y) {
    if (v.id !== "uuv" || !state.started) return y;
    return Math.min(y, UUV_MIN_DEPTH);
  }

  function driveTo(v, x, z, opts = {}) {
    v.target = {
      x, z,
      y: legalDepth(v, opts.y !== undefined ? opts.y : v.y),
      tol: opts.tol || (v.id === "uav" ? 2.5 : 3.0),
      throttle: opts.throttle || 1.0,
    };
    v.orbit = null;
  }

  function orbitAround(v, cx, cz, r, dir, turns = 1) {
    // Enter the circle at the nearest point and sweep the full turn.
    const a0 = Math.atan2(v.z - cz, v.x - cx);
    v.orbit = { cx, cz, r, dir, angle: a0, remaining: TAU * turns };
    v.target = null;
  }

  function holdPosition(v) { v.target = null; v.orbit = null; v.speed = 0; }

  function arrived(v) {
    if (v.orbit) return v.orbit.remaining <= 0;
    if (!v.target) return true;
    const flat = dist(v.x, v.z, v.target.x, v.target.z) < v.target.tol;
    const vertical = Math.abs(v.y - v.target.y) < 0.6;
    return flat && vertical;
  }

  function stepVehicle(v, dt) {
    if (v.state === "KILLED") { v.speed = 0; return; }

    // vertical motion: depth for the UUV, altitude for the UAV
    const y0 = v.y;
    const wantY = legalDepth(v, v.orbit ? v.y : (v.target ? v.target.y : v.y));
    if (Math.abs(wantY - v.y) > 0.02) {
      const rate = v.id === "uav" ? 3.0 : 0.7;
      v.y += Math.sign(wantY - v.y) * Math.min(rate * dt, Math.abs(wantY - v.y));
    }
    v.y = legalDepth(v, v.y);
    v.climb = dt > 0 ? (v.y - y0) / dt : 0;

    let desired = null;
    let throttle = 1;
    if (v.orbit) {
      const o = v.orbit;
      const rNow = dist(v.x, v.z, o.cx, o.cz);
      if (Math.abs(rNow - o.r) > o.r * 0.5) {
        // still closing on the circle
        const a = Math.atan2(v.z - o.cz, v.x - o.cx);
        desired = { x: o.cx + Math.cos(a) * o.r, z: o.cz + Math.sin(a) * o.r };
      } else {
        const sweep = (v.spec.max_speed * 0.55 * dt) / o.r;
        o.angle += o.dir * sweep;
        o.remaining -= sweep;
        desired = { x: o.cx + Math.cos(o.angle) * o.r, z: o.cz + Math.sin(o.angle) * o.r };
        throttle = 0.55;
      }
    } else if (v.target) {
      desired = v.target;
      throttle = v.target.throttle;
      if (dist(v.x, v.z, v.target.x, v.target.z) < v.target.tol) {
        v.speed *= 0.5;
        return;
      }
    } else {
      v.speed *= Math.max(0, 1 - dt * 2);
      v.x += Math.cos(v.heading) * v.speed * dt;
      v.z += Math.sin(v.heading) * v.speed * dt;
      return;
    }

    const bearing = Math.atan2(desired.z - v.z, desired.x - v.x);
    const err = wrap(bearing - v.heading);
    const turn = Math.max(-v.spec.turn_rate * dt, Math.min(v.spec.turn_rate * dt, err));
    v.heading = wrap(v.heading + turn);

    // slow down for hard turns, the way a real hull has to
    const align = Math.max(0.15, 1 - Math.abs(err) / Math.PI);
    const wanted = v.spec.max_speed * throttle * align;
    v.speed += (wanted - v.speed) * Math.min(1, dt * 1.5);
    v.x += Math.cos(v.heading) * v.speed * dt;
    v.z += Math.sin(v.heading) * v.speed * dt;
  }

  function driveManual(v, input, dt) {
    const accel = v.spec.max_speed * 1.2;
    const y0 = v.y;
    v.speed += (input.throttle * v.spec.max_speed - v.speed) * Math.min(1, dt * 2);
    v.heading = wrap(v.heading + input.steer * v.spec.turn_rate * dt);
    v.x += Math.cos(v.heading) * v.speed * dt;
    v.z += Math.sin(v.heading) * v.speed * dt;
    if (input.vertical && v.id !== "usv") {
      v.y += input.vertical * (v.id === "uav" ? 4 : 0.8) * dt;
      if (v.id === "uuv") {
        v.y = Math.max(-v.spec.max_depth_m, legalDepth(v, Math.min(0, v.y)));
      }
      if (v.id === "uav") v.y = Math.max(0, Math.min(v.spec.max_alt_m, v.y));
    }
    v.climb = dt > 0 ? (v.y - y0) / dt : 0;
    void accel;
  }

  // --------------------------------------------------------------- steps --
  function stepDef(label, enter, update) {
    return { label, enter, update: update || (() => true) };
  }

  function waitFor(seconds) {
    let left = seconds;
    return dt => { left -= dt; return left <= 0; };
  }

  function untilArrived(v) {
    return () => arrived(v);
  }

  const buoy = id => cfg.task1.buoys.find(b => b.id === id);

  function gateWaypoints() {
    const b = cfg.task1.buoys;
    const pairs = [["b-r1", "b-g1"], ["b-r2", "b-g2"], ["b-r3", "b-g3"]];
    return pairs.map(([r, g]) => {
      const rb = b.find(x => x.id === r), gb = b.find(x => x.id === g);
      return [(rb.pos[0] + gb.pos[0]) / 2, (rb.pos[1] + gb.pos[1]) / 2];
    });
  }

  function task1Steps(tier) {
    const usv = state.vehicles.usv, uav = state.vehicles.uav;
    const entry = buoy("b-entry"), exitB = buoy("b-exit");
    const steps = [];
    const named = cfg.steps.SAFE_PASSAGE[tier];

    if (named.includes("UAV_FLYOVER")) {
      steps.push(stepDef("UAV_FLYOVER", () => {
        uav.task = "SAFE_PASSAGE";
        state.uavOnly = true;   // side beacons are dark above Core (3.3.2)
        driveTo(uav, entry.pos[0] + 12, entry.pos[1], { y: uav.spec.cruise_alt_m, tol: 4 });
        event("UAV overflies the buoy field to read the top beacons");
      }, untilArrived(uav)));
      steps.push(stepDef("ROUTE_RELAY_TO_USV", () => {
        message("SafePassageReport", "entry, exit, and 10 buoys from the UAV");
        event("UAV relays the safe route to the USV");
      }, waitFor(1.5)));
    }
    if (named.includes("UAV_ON_STATION")) {
      steps.push(stepDef("UAV_ON_STATION", () => {
        uav.task = "SAFE_PASSAGE";
        state.uavOnly = true;
        driveTo(uav, entry.pos[0] + 26, entry.pos[1] + 6, { y: uav.spec.cruise_alt_m, tol: 4 });
        event("UAV holds station: the route can change during this attempt");
      }, untilArrived(uav)));
      steps.push(stepDef("DYNAMIC_ROUTE_UPDATE", () => {
        message("SafePassageReport", "initial route, Disruptive tier");
      }, waitFor(1.0)));
    }
    if (named.includes("APPROACH_ENTRY")) {
      steps.push(stepDef("APPROACH_ENTRY", () => {
        usv.task = "SAFE_PASSAGE";
        driveTo(usv, entry.pos[0] - 8, entry.pos[1]);
      }, untilArrived(usv)));
    }

    steps.push(stepDef("CIRCLE_ENTRY_BUOY_CW", () => {
      usv.task = "SAFE_PASSAGE";
      orbitAround(usv, entry.pos[0], entry.pos[1], 7, -1);
      event("USV circles the flashing blue entry buoy clockwise");
    }, () => arrived(usv)));

    gateWaypoints().forEach((wp, i) => {
      steps.push(stepDef("TRANSIT_PASSAGE", () => {
        driveTo(usv, wp[0], wp[1], { tol: 4 });
        if (i === 0) event("USV transits the passage, red to starboard, green to port");
      }, untilArrived(usv)));
      if (tier === "DISRUPTIVE" && i === 1) {
        steps.push(stepDef("ROUTE_RECHECK", () => {
          // the safe passage moves mid-transit, visible only to the UAV
          const b = cfg.task1.buoys;
          const r3 = b.find(x => x.id === "b-r3"), g3 = b.find(x => x.id === "b-g3");
          state.beacons["b-r3"] = "FLASHING_GREEN";
          state.beacons["b-g3"] = "FLASHING_RED";
          const tmp = r3.pos.slice();
          r3.pos = g3.pos.slice();
          g3.pos = tmp;
          message("SafePassageReport", "route changed, updated buoy states");
          event("Hazard appears: the UAV pushes a new route to the USV");
        }, waitFor(1.2)));
      }
    });

    steps.push(stepDef("CIRCLE_EXIT_BUOY_CCW", () => {
      orbitAround(usv, exitB.pos[0], exitB.pos[1], 7, 1);
      event("USV circles the solid blue exit buoy counterclockwise");
    }, () => arrived(usv)));

    steps.push(stepDef("EXIT_REPORT", () => {
      message("SafePassageReport", "passage complete, buoy states confirmed");
      completeTask("SAFE_PASSAGE", tier);
      usv.task = null;
      uav.task = null;
      state.uavOnly = false;
    }, waitFor(0.6)));
    return steps;
  }

  function task2Steps(tier) {
    const uuv = state.vehicles.uuv, uav = state.vehicles.uav;
    const named = cfg.steps.INFRASTRUCTURE_SURVEY[tier];
    const active = cfg.task2.buoys.find(b => b.pinger);
    const pipe = cfg.task2.pipeline;
    const depth = -(cfg.seabed_depth_m - pipe.height_above_bed_m - 0.6);
    const steps = [];

    steps.push(stepDef("HOME_ACOUSTIC_PINGER", () => {
      uuv.task = "INFRASTRUCTURE_SURVEY";
      uuv.state = "AUTO";
      driveTo(uuv, active.pos[0], active.pos[1] + 3, { y: depth, tol: 3 });
      event("UUV dives and homes on the active pinger under the green buoy");
    }, untilArrived(uuv)));

    pipe.nodes.forEach((node, i) => {
      steps.push(stepDef("FOLLOW_PIPELINE", () => {
        driveTo(uuv, node[0], node[1], { y: depth, tol: 2.0, throttle: 0.7 });
        if (i === 0) event("UUV picks up the pipeline and follows it");
      }, untilArrived(uuv)));
      if (i === pipe.damaged_segment) {
        steps.push(stepDef("IDENTIFY_DAMAGE", () => {
          event("Damaged segment found: the ring light is RED and it is leaking");
        }, waitFor(1.0)));
        steps.push(stepDef("MARK_SEGMENT", () => {
          holdPosition(uuv);
          state.probeOut = true;
          event("UUV swings the magnetic probe out and holds it on the segment");
        }, waitFor(2.2)));
        steps.push(stepDef("REPORT_PATTERN", () => {
          state.probeOut = false;
          state.repairedSegments.push(pipe.damaged_segment);
          message("PipelineSurveyReport", "5 segments, ordered from the active buoy");
        }, waitFor(0.6)));
      }
    });

    if (named.includes("REQUEST_SUPPLY") || named.includes("REQUEST_SUPPLY_WITH_DESTINATION")) {
      const wantColor = tier === "DISRUPTIVE" ? "BLUE" : "ANY";
      const circle = tier === "DISRUPTIVE" ? "GREEN" : "RED";
      steps.push(stepDef(tier === "DISRUPTIVE" ? "DECODE_TWO_COLOR_SEQUENCE" : "REQUEST_SUPPLY", () => {
        // up to the indicator on the active buoy, but still well under: the
        // colour is read from below the waterline, not by surfacing
        driveTo(uuv, active.pos[0] + 2, active.pos[1] + 2, { y: -1.1, tol: 2.5 });
        event(tier === "DISRUPTIVE"
          ? "Repair light flashes two colours: tin colour, then delivery circle"
          : "Repair light flashes the resource colour for 30 s");
      }, untilArrived(uuv)));
      steps.push(stepDef(tier === "DISRUPTIVE" ? "REQUEST_SUPPLY_WITH_DESTINATION" : "REQUEST_SUPPLY", () => {
        message("ResourceDeliveryRequest", `task 2, tin ${wantColor}, circle ${circle}`);
        event("UUV relays the request up the tether without breaching");
      }, waitFor(0.8)));
      steps.push(...deliverySteps(uav, wantColor === "ANY" ? "RED" : wantColor, circle,
        named.includes("UAV_DELIVER_CORRECT_TIN") ? "UAV_DELIVER_CORRECT_TIN" : "UAV_DELIVER_SUPPLY",
        "INFRASTRUCTURE_SURVEY"));
      steps.push(stepDef("CONFIRM_REPAIR", () => {
        message("PipelineSurveyReport", "repair confirmed");
        completeTask("INFRASTRUCTURE_SURVEY", tier);
        uuv.task = null;
      }, waitFor(0.5)));
    } else {
      steps.push(stepDef("REPORT_PATTERN", () => {
        completeTask("INFRASTRUCTURE_SURVEY", tier);
        uuv.task = null;
      }, waitFor(0.5)));
    }
    return steps;
  }

  function deliverySteps(uav, tinColor, circleColor, label, taskId) {
    const from = cfg.platforms.items[0], to = cfg.platforms.items[1];
    const alt = uav.spec.cruise_alt_m;
    return [
      stepDef(label, () => {
        uav.task = taskId;
        driveTo(uav, from.pos[0], from.pos[1] + 0.8, { y: alt, tol: 2 });
        event(`UAV heads for the ${tinColor} tin`);
      }, untilArrived(uav)),
      stepDef(label, () => {
        driveTo(uav, from.pos[0], from.pos[1] + 0.8, { y: 1.2, tol: 1.2 });
      }, () => arrived(uav)),
      stepDef(label, () => {
        uav.carrying = tinColor;
        event(`UAV lifts the ${tinColor} tin`);
        driveTo(uav, to.pos[0], to.pos[1], { y: alt, tol: 2 });
      }, untilArrived(uav)),
      stepDef(label, () => {
        driveTo(uav, to.pos[0], to.pos[1], { y: 1.4, tol: 1.0 });
      }, () => arrived(uav)),
      stepDef(label, () => {
        uav.carrying = null;
        message("ResourceDeliveryRequest", `delivered ${tinColor} tin to the ${circleColor} circle`);
        event(`UAV delivers to the ${circleColor} circle`);
        driveTo(uav, to.pos[0] - 6, to.pos[1] - 6, { y: alt, tol: 3 });
      }, untilArrived(uav)),
    ];
  }

  function task3Steps(tier) {
    const usv = state.vehicles.usv, uav = state.vehicles.uav;
    const named = cfg.steps.COORDINATED_LOGISTICS[tier];
    const t3 = cfg.task3;
    const dockPos = t3.dock.pos;
    const bayOffset = (t3.safe_bay - 2) * t3.bay_spacing_m;
    // the dock faces west, so the bay opens toward -x
    const approach = [dockPos[0] - 14, dockPos[1] + bayOffset];
    const inBay = [dockPos[0] - 3.2, dockPos[1] + bayOffset];
    const steps = [];

    steps.push(stepDef("LOCATE_SAFE_DOCK", () => {
      usv.task = "COORDINATED_LOGISTICS";
      driveTo(usv, approach[0], approach[1], { tol: 4 });
      event("USV looks for the bay with the green indicator");
    }, untilArrived(usv)));

    steps.push(stepDef("DOCK_IN_BAY", () => {
      driveTo(usv, inBay[0], inBay[1], { tol: 1.6, throttle: 0.45 });
    }, untilArrived(usv)));

    steps.push(stepDef("REPORT_DOCKED", () => {
      holdPosition(usv);
      message("DockingReport", `bay ${t3.safe_bay}`);
      state.fire = { bay: t3.safe_bay, window: t3.active_window, out: false, flashColor: null };
      event(`Docked in bay ${t3.safe_bay}; a window light comes up RED`);
    }, waitFor(1.0)));

    steps.push(stepDef("FIREFIGHT_SPRAY", () => {
      state.spraying = true;
      event("USV sprays water into the lit window");
    }, waitFor(3.0)));

    steps.push(stepDef("CONFIRM_FIRE_SUPPRESSED", () => {
      state.spraying = false;
      state.fire.out = true;
      message("FirefightingReport", `window ${t3.active_window + 1}`);
      event("Window light turns GREEN for 5 s");
    }, waitFor(1.4)));

    if (named.includes("RELAY_DELIVERY_ORDER_TO_UAV") || named.includes("RELAY_FULL_DELIVERY_ORDER")) {
      const tin = tier === "DISRUPTIVE" ? "GREEN" : "ANY";
      const circle = tier === "DISRUPTIVE" ? "BLUE" : "GREEN";
      steps.push(stepDef(named.includes("DECODE_TWO_COLOR_SEQUENCE")
        ? "DECODE_TWO_COLOR_SEQUENCE" : "RELAY_DELIVERY_ORDER_TO_UAV", () => {
        state.fire.flashColor = cfg.platforms.colors[circle];
        event(tier === "DISRUPTIVE"
          ? "Light flashes tin colour then receiving colour for 60 s"
          : "Light flashes the delivery circle colour for 60 s");
      }, waitFor(2.0)));
      steps.push(stepDef(named.includes("RELAY_FULL_DELIVERY_ORDER")
        ? "RELAY_FULL_DELIVERY_ORDER" : "RELAY_DELIVERY_ORDER_TO_UAV", () => {
        message("ResourceDeliveryRequest", `task 3, tin ${tin}, circle ${circle}`);
        event("USV relays the delivery order to the UAV");
        state.fire.flashColor = null;
      }, waitFor(0.8)));
      steps.push(...deliverySteps(uav, tin === "ANY" ? "BLUE" : tin, circle,
        named.includes("UAV_DELIVER_CORRECT_TIN_TO_CORRECT_BAY")
          ? "UAV_DELIVER_CORRECT_TIN_TO_CORRECT_BAY" : "UAV_DELIVER_TIN",
        "COORDINATED_LOGISTICS"));
      steps.push(stepDef("CONFIRM_DELIVERY", () => {
        completeTask("COORDINATED_LOGISTICS", tier);
        usv.task = null;
        uav.task = null;
        driveTo(usv, dockPos[0] - 20, dockPos[1] - 10, { tol: 4 });
      }, waitFor(0.6)));
    } else {
      steps.push(stepDef("CONFIRM_FIRE_SUPPRESSED", () => {
        completeTask("COORDINATED_LOGISTICS", tier);
        usv.task = null;
        driveTo(usv, dockPos[0] - 20, dockPos[1] - 10, { tol: 4 });
      }, waitFor(0.5)));
    }
    return steps;
  }

  // ------------------------------------------------------------- Task 4 --
  function task4Steps(kind) {
    const tierByKind = {
      ASSISTANCE_REQUEST: "CORE", KEEPOUT_ZONE: "ADVANCED", MOVING_OBJECT: "DISRUPTIVE",
    };
    const tier = tierByKind[kind];
    const named = cfg.steps.DYNAMIC_INCIDENT[tier];
    const steps = [];

    if (kind === "ASSISTANCE_REQUEST") {
      const v = state.vehicles.usv;
      const pos = state.incident.pos;
      steps.push(stepDef(named[0], () => {
        message("IncidentAck", "USV1 acknowledges the assistance request");
        event("USV acknowledges and breaks off its current task");
      }, waitFor(0.8)));
      steps.push(stepDef("ABORT_CURRENT_TASK", () => {
        v.task = "DYNAMIC_INCIDENT";
      }, waitFor(0.4)));
      steps.push(stepDef("TRANSIT_TO_INCIDENT_POSITION", () => {
        driveTo(v, pos[0], pos[1], { tol: 4 });
      }, untilArrived(v)));
      steps.push(stepDef("LOITER_AT_POSITION", () => {
        orbitAround(v, pos[0], pos[1], 6, -1, 0.6);
        event("USV loiters on station");
      }, () => arrived(v)));
      steps.push(stepDef("REPORT_READINESS", () => {
        message("ReadinessReport", "USV1 on station and ready");
      }, waitFor(1.0)));
      steps.push(stepDef("RESUME_MISSION", () => {
        message("ReadinessConfirm", "cleared to resume", "RX");
        event("RoboCommand confirms readiness; the mission resumes");
        v.task = null;
        state.incident = null;
        completeTask("DYNAMIC_INCIDENT", "CORE");
      }, waitFor(0.6)));
    } else if (kind === "KEEPOUT_ZONE") {
      steps.push(stepDef(named[0], () => {
        message("IncidentAck", "keep-out zone acknowledged");
        event("Keep-out zone received: vehicles route around it");
      }, waitFor(0.8)));
      steps.push(stepDef("AVOID_KEEPOUT_ZONE", () => {
        const v = state.vehicles.usv;
        const inc = state.incident;
        const away = Math.atan2(v.z - inc.pos[1], v.x - inc.pos[0]);
        driveTo(v, inc.pos[0] + Math.cos(away) * (inc.radius_m + 12),
                inc.pos[1] + Math.sin(away) * (inc.radius_m + 12), { tol: 4 });
      }, untilArrived(state.vehicles.usv)));
      steps.push(stepDef("REPORT_COMPLIANCE", () => {
        message("IncidentAck", "clear of the zone");
      }, waitFor(1.0)));
      steps.push(stepDef("AWAIT_ALL_CLEAR", () => {
        event("Holding clear until RoboCommand sends the all clear");
      }, waitFor(4.0)));
      steps.push(stepDef("RESUME_MISSION", () => {
        message("AllClear", "zone lifted", "RX");
        message("IncidentAck", "all clear acknowledged");
        state.incident = null;
        completeTask("DYNAMIC_INCIDENT", "ADVANCED");
      }, waitFor(0.6)));
    } else {
      steps.push(stepDef(named[0], () => {
        event("Moving object reported: keep 10 m clear of it");
      }, waitFor(0.6)));
      steps.push(stepDef("COMPUTE_OBJECT_TRAJECTORY", () => {}, waitFor(0.8)));
      steps.push(stepDef("MAINTAIN_10M_STANDOFF", () => {
        const v = state.vehicles.usv;
        const inc = state.incident;
        driveTo(v, inc.pos[0] - 24, inc.pos[1] + 18, { tol: 4 });
      }, untilArrived(state.vehicles.usv)));
      steps.push(stepDef("TRACK_OBJECT", () => {}, waitFor(3.0)));
      steps.push(stepDef("AWAIT_CLEARANCE", () => {}, waitFor(1.5)));
      steps.push(stepDef("RESUME_MISSION", () => {
        state.incident = null;
        completeTask("DYNAMIC_INCIDENT", "DISRUPTIVE");
      }, waitFor(0.5)));
    }
    return steps;
  }

  function injectIncident(kind) {
    if (!state.started) { event("Incidents arrive only after RunStart"); return; }
    if (state.incident) return;
    const usv = state.vehicles.usv;
    if (kind === "ASSISTANCE_REQUEST") {
      state.incident = { kind, pos: [usv.x + 26, usv.z + 22] };
      message("AssistanceRequest", `USV to ${state.incident.pos.map(n => n.toFixed(0)).join(", ")}`, "RX");
    } else if (kind === "KEEPOUT_ZONE") {
      state.incident = { kind, pos: [usv.x + 18, usv.z - 6], radius_m: 18 };
      message("KeepOutZone", "18 m radius, surface domain", "RX");
    } else {
      state.incident = {
        kind, pos: [usv.x + 30, usv.z + 4], heading_deg: 250, speed_mps: 2.2,
      };
      message("MovingObjectAlert", "surface contact, 2.2 m/s", "RX");
    }
    // Task 4 preempts whatever is running, the way suspend/resume works in
    // the orchestrator: the current step queue is parked and restored after.
    suspended = { queue, current };
    queue = task4Steps(kind);
    current = null;
    event("Task 4 interrupt: the active task is suspended");
    emit("task4", state.incident);
  }

  function moveIncident(dt) {
    const inc = state.incident;
    if (!inc || inc.kind !== "MOVING_OBJECT") return;
    const h = (inc.heading_deg * Math.PI) / 180;
    inc.pos[0] += Math.cos(h) * inc.speed_mps * dt;
    inc.pos[1] += Math.sin(h) * inc.speed_mps * dt;
  }

  // ------------------------------------------------------------ mission --
  function completeTask(task, tier) {
    state.completed[task] = tier;
    event(`${task} complete at ${tier}`);
    emit("progress", state.completed);
  }

  function buildMission(tier) {
    return [
      ...preRunSteps(),
      ...task1Steps(tier),
      ...task2Steps(tier),
      ...task3Steps(tier),
    ];
  }

  function preRunSteps() {
    return [
      stepDef("RxCourse", () => {
        message("RxCourse", `${cfg.course_id}, pinger ${cfg.pinger_freq_hz} Hz`, "RX");
        event("Retained course configuration received");
      }, waitFor(0.6)),
      stepDef("RunDeclaration", () => {
        const ids = cfg.vehicles.map(v => v.label).join(", ");
        message("RunDeclaration", `${ids}, tiers ${state.tier}`);
        event("Run declared; vehicles hold position until RunStart");
      }, waitFor(1.0)),
      stepDef("Heartbeats", () => {
        Object.values(state.vehicles).forEach(v => { v.state = "AUTO"; });
        event("All declared vehicles report STATE_AUTO");
      }, waitFor(1.2)),
      stepDef("RunStart", () => {
        state.started = true;
        state.runId = 1;
        message("RunStart", "run 1", "RX");
        event("RunStart received and matched: the run begins");
      }, waitFor(0.5)),
      // The UUV goes under on RunStart and stays under: breaching during a
      // scoring run is a rule violation (5.3.2), so nothing later in the run
      // is allowed to bring it back to the surface.
      stepDef("UUV_SUBMERGE", () => {
        const uuv = state.vehicles.uuv;
        driveTo(uuv, uuv.x + 4, uuv.z, { y: UUV_TRANSIT_DEPTH, tol: 3 });
        event("UUV submerges to transit depth and stays under for the run");
      }, untilArrived(state.vehicles.uuv)),
    ];
  }

  // ---------------------------------------------------------------- api --
  function init(config) {
    cfg = config;
    // keep the pristine buoy layout: the Disruptive tier moves buoys mid-run
    cfg.__originalBuoys = cfg.task1.buoys.map(b => ({ pos: b.pos.slice(), state: b.state }));
    reset("ADVANCED");
    return state;
  }

  function reset(tier) {
    const keepTier = tier || (state && state.tier) || "ADVANCED";
    const fresh = {
      t: 0,
      running: false,
      tier: keepTier,
      started: false,
      runId: null,
      vehicles: { usv: newVehicle("usv"), uuv: newVehicle("uuv"), uav: newVehicle("uav") },
      beacons: Object.fromEntries(cfg.task1.buoys.map(b => [b.id, b.state])),
      uavOnly: false,
      repairedSegments: [],
      probeOut: false,
      fire: null,
      spraying: false,
      incident: null,
      messages: [],
      events: [],
      completed: {},
      heartbeats: 0,
      manual: null,
      showRings: true,
      showLabels: true,
      step: null,
    };
    if (state) {
      // Callers hold this object, so refresh it in place rather than swapping
      // it out from under them.
      Object.keys(state).forEach(k => delete state[k]);
      Object.assign(state, fresh);
    } else {
      state = fresh;
    }
    // reset the buoys the Disruptive tier swaps around
    cfg.task1.buoys.forEach((b, i) => {
      const original = cfg.__originalBuoys[i];
      b.pos = original.pos.slice();
      state.beacons[b.id] = original.state;
    });
    queue = buildMission(state.tier);
    current = null;
    suspended = null;
    hbAccum = 0;
    emit("reset", state);
    return state;
  }

  function setTier(tier) {
    reset(tier);
  }

  function start() { state.running = true; }
  function pause() { state.running = false; }
  function toggle() { state.running = !state.running; }

  function setManual(id) {
    const v = state.vehicles[id];
    if (!v) return;
    if (state.manual === id) {
      state.manual = null;
      v.state = state.started ? "AUTO" : "MANUAL";
      event(`${v.spec.label} returns to autonomous control`);
      return;
    }
    state.manual = id;
    v.state = "MANUAL";
    v.scoring = false;
    holdPosition(v);
    event(`${v.spec.label} taken to manual: no further points this attempt (5.1)`);
  }

  function update(dt, input) {
    if (!state.running) return state;
    state.t += dt;

    // 2 Hz heartbeat per vehicle, as the OCS publishes them (3.4.11)
    hbAccum += dt;
    while (hbAccum >= 0.5) {
      hbAccum -= 0.5;
      state.heartbeats += Object.keys(state.vehicles).length;
    }

    if (current === null && queue.length) {
      current = queue.shift();
      state.step = current.label;
      if (current.enter) current.enter();
      emit("step", current.label);
    }
    if (current) {
      const done = current.update(dt);
      if (done) current = null;
      if (current === null && queue.length === 0 && suspended) {
        queue = suspended.queue;
        current = suspended.current;
        suspended = null;
        event("Resuming the suspended task from its checkpoint");
      }
    }

    Object.values(state.vehicles).forEach(v => {
      if (state.manual === v.id) {
        driveManual(v, input || { throttle: 0, steer: 0, vertical: 0 }, dt);
      } else {
        stepVehicle(v, dt);
      }
    });
    moveIncident(dt);
    return state;
  }

  return {
    init, reset, setTier, start, pause, toggle, update, on,
    injectIncident, setManual,
    get state() { return state; },
    get queueLength() { return queue.length; },
  };
})();
