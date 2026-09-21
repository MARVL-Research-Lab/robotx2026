/* camera.js: every way of looking at the course.
 *
 * Five ways in, and they all end up as one of two Babylon cameras:
 *
 *   orbit   the arc-rotate camera around the middle of the operating area
 *   free    a fly camera, WASD to move and drag to look, for getting close
 *           to anything the fixed views do not frame
 *   chase   third person behind USV, UUV or UAV, one set of offsets each
 *   top     plan view of the whole course
 *   pov     the camera each vehicle carries, first person
 *
 * Chase and top drive the same arc-rotate camera the operator can grab with
 * the mouse, so a drag or a scroll during either one hands control back for a
 * few seconds rather than fighting the follow. That is the difference between
 * a camera you can look around with and one that snaps back.
 */
"use strict";

const Cameras = (() => {
  const TAU = Math.PI * 2;
  const MODES = ["orbit", "free", "chase", "top"];
  const FOLLOWS = ["usv", "uuv", "uav"];

  /* Third-person offsets per vehicle. The UUV sits close and low because the
   * pipeline it works on is 1.5 m off the bed and the water is opaque past
   * about 40 m; the UAV sits high and far enough back to hold the buoy field
   * in frame while it flies the survey.
   */
  const CHASE = {
    usv: { radius: 14.0, beta: 1.15, height: 1.0, lead: 0.0 },
    uuv: { radius: 4.6, beta: 1.30, height: 0.15, lead: 1.6 },
    uav: { radius: 10.0, beta: 1.10, height: 0.4, lead: 0.0 },
  };

  const POV = {
    usv: { eye: 0.9, ahead: 0.0, pitch: 0.4, fov: 1.15 },
    uuv: { eye: 0.03, ahead: 0.2, pitch: -1.2, fov: 1.35 },
    uav: { eye: 0.0, ahead: 0.0, pitch: -9.0, fov: 1.15 },
  };

  // How long the operator keeps the camera after a drag or a scroll before
  // the follow takes it back.
  const HANDBACK_S = 5.0;

  let scene = null, canvas = null, orbit = null, free = null;
  let mode = "orbit";
  let follow = "usv";
  let pov = null;
  const povCameras = {};

  let flySpeed = 14.0;          // m/s, wheel adjusts it
  let grabbed = false;          // pointer is down on the canvas
  let handback = 0;             // seconds of operator control left
  let now = 0;

  const keys = { has: () => false };
  let keyset = keys;

  function init(babylonScene, orbitCamera, element) {
    scene = babylonScene;
    orbit = orbitCamera;
    canvas = element;
    if (!canvas || !canvas.addEventListener) return;

    canvas.addEventListener("pointerdown", () => { grabbed = true; });
    canvas.addEventListener("pointerup", () => {
      grabbed = false;
      if (mode === "chase" || mode === "top") handback = HANDBACK_S;
    });
    canvas.addEventListener("wheel", ev => {
      if (mode === "free") {
        // In free flight the wheel is a throttle, not a zoom: the camera has
        // no orbit radius to give away.
        flySpeed = Math.max(0.6, Math.min(90, flySpeed * (ev.deltaY < 0 ? 1.15 : 0.87)));
        if (ev.preventDefault) ev.preventDefault();
      } else if (mode === "chase" || mode === "top") {
        handback = HANDBACK_S;
      }
    }, { passive: false });
  }

  /** The keys main.js is holding, so free flight and manual driving agree. */
  function bindKeys(set) { keyset = set || keys; }

  function held(code) { return keyset.has ? keyset.has(code) : false; }

  // ------------------------------------------------------------- cameras --
  function freeCamera() {
    if (free) return free;
    free = new BABYLON.UniversalCamera("free", orbit.position.clone(), scene);
    free.minZ = 0.05;
    free.maxZ = 6000;
    free.inertia = 0.82;
    free.angularSensibility = 900;
    free.speed = 0;               // movement is applied in frame(), not by Babylon
    free.checkCollisions = false;
    // Babylon's own WASD handler would fight the mission's manual driving
    // keys and ignores the boost modifier, so the keyboard input is removed
    // and frame() moves the camera instead. The mouse input stays: that is
    // the drag-to-look.
    if (free.inputs && free.inputs.attached && free.inputs.attached.keyboard) {
      free.inputs.removeByType("FreeCameraKeyboardMoveInput");
    }
    World._internal.attachPipeline(free);
    return free;
  }

  function povCamera(id) {
    if (povCameras[id]) return povCameras[id];
    const cam = new BABYLON.UniversalCamera("pov-" + id, BABYLON.Vector3.Zero(), scene);
    cam.minZ = 0.05;
    cam.maxZ = 4000;
    cam.fov = POV[id] ? POV[id].fov : 1.15;
    povCameras[id] = cam;
    World._internal.attachPipeline(cam);
    return cam;
  }

  /** Whichever camera the scene should be rendering right now. */
  function activate() {
    if (pov) {
      scene.activeCamera = povCamera(pov);
      return;
    }
    if (mode === "free") {
      const cam = freeCamera();
      if (scene.activeCamera !== cam) {
        // Take over from wherever the last camera was looking, so switching
        // into free flight never teleports the operator.
        const from = scene.activeCamera;
        if (from) {
          cam.position.copyFrom(from.position);
          const look = from.getTarget ? from.getTarget() : null;
          if (look) cam.setTarget(look.clone());
        }
        if (orbit.detachControl) orbit.detachControl(canvas);
        scene.activeCamera = cam;
        if (canvas) cam.attachControl(canvas, true);
      }
      return;
    }
    if (scene.activeCamera !== orbit) {
      if (free && free.detachControl) free.detachControl(canvas);
      scene.activeCamera = orbit;
      if (canvas) orbit.attachControl(canvas, true);
    }
  }

  function setMode(m) {
    if (MODES.indexOf(m) === -1) return;
    mode = m;
    handback = 0;
    // A camera mode is a request to look through that camera, so it clears
    // any POV that was rendering over it.
    pov = null;
    activate();
  }

  function setFollow(id) {
    if (FOLLOWS.indexOf(id) === -1) return;
    follow = id;
    handback = 0;
  }

  function setPov(id) {
    pov = id || null;
    activate();
  }

  function setFlySpeed(v) { flySpeed = Math.max(0.6, Math.min(90, v)); }

  /* Third person is framed for the course it is watching. The competition
   * course is hundreds of metres across and the proof of readiness site is
   * tens, so the page that knows which one it is sets the offsets.
   */
  function setChase(id, opts) {
    if (!CHASE[id] || !opts) return;
    Object.assign(CHASE[id], opts);
  }

  // --------------------------------------------------------------- frame --
  function flyFrame(dt) {
    const cam = free;
    if (!cam) return;
    const boost = held("ShiftLeft") || held("ShiftRight") ? 4.0 : 1.0;
    const crawl = held("ControlLeft") || held("ControlRight") ? 0.25 : 1.0;
    const step = flySpeed * boost * crawl * dt;
    const fwd = (held("KeyW") ? 1 : 0) - (held("KeyS") ? 1 : 0);
    const side = (held("KeyD") ? 1 : 0) - (held("KeyA") ? 1 : 0);
    const rise = (held("KeyE") ? 1 : 0) - (held("KeyQ") ? 1 : 0);
    if (!fwd && !side && !rise) return;
    const forward = cam.getDirection(BABYLON.Axis.Z);
    const right = cam.getDirection(BABYLON.Axis.X);
    // Up is world up rather than camera up: pitched down over the course,
    // pressing E should still climb rather than fly backwards.
    cam.position.addInPlace(forward.scale(fwd * step));
    cam.position.addInPlace(right.scale(side * step));
    cam.position.y += rise * step;
  }

  function chaseFrame(state, dt) {
    const v = state.vehicles[follow] || state.vehicles.usv;
    if (!v) return;
    const set = CHASE[follow] || CHASE.usv;
    const target = new BABYLON.Vector3(
      v.x + Math.cos(v.heading) * set.lead,
      v.y + set.height,
      v.z + Math.sin(v.heading) * set.lead);
    /* The target follows even while the operator is looking around, so a drag
     * orbits the vehicle rather than being left behind by it.
     *
     * In place, not by assignment. Assigning to camera.target runs Babylon's
     * setTarget, which calls rebuildAnglesAndRadius and derives alpha, beta
     * and radius back out of the camera's last known position: the lerps
     * below are then overwritten every frame by whatever the camera used to
     * be. In the browser that only costs a frame of lag, because render()
     * refreshes the position in between; anywhere the scene is stepped
     * without rendering, the chase never closes at all.
     */
    BABYLON.Vector3.LerpToRef(orbit.target, target, Math.min(1, dt * 2.5), orbit.target);
    if (handback <= 0) {
      orbit.radius += (set.radius - orbit.radius) * Math.min(1, dt * 1.8);
      orbit.beta += (set.beta - orbit.beta) * Math.min(1, dt * 1.8);
      /* Behind the vehicle, looking the way it is going. An arc-rotate camera
       * sits at target + r * (cos a sin b, cos b, sin a sin b), so the eye is
       * astern when alpha is the heading plus half a turn. The error is
       * wrapped before it is applied, or a run that crosses the +/-PI seam
       * sends the camera the long way round the vehicle.
       */
      const want = v.heading + Math.PI;
      const err = ((want - orbit.alpha + Math.PI) % TAU + TAU) % TAU - Math.PI;
      orbit.alpha += err * Math.min(1, dt * 1.3);
    }
    if (follow === "uuv") holdUnderWater(v);
  }

  /* The water is opaque, so a camera watching the ROV has to be under it with
   * it. At 1.4 m transit depth the tuned offsets put the eye within a few
   * centimetres of the surface, which is the one place it cannot be: the
   * frame comes back half sky and half nothing, with the vehicle behind the
   * water plane. beta is raised until the eye is clear of the surface, which
   * also holds through an operator drag.
   */
  function holdUnderWater(v) {
    if (v.y > -0.35) return;
    const EYE = -0.45;
    const rise = EYE - orbit.target.y;
    const cosMax = Math.max(-0.95, Math.min(0.95, rise / Math.max(0.6, orbit.radius)));
    const betaMin = Math.acos(cosMax);
    if (orbit.beta < betaMin) orbit.beta = betaMin;
  }

  function topFrame(dt) {
    BABYLON.Vector3.LerpToRef(
      orbit.target, BABYLON.Vector3.Zero(), Math.min(1, dt * 2), orbit.target);
    if (handback > 0) return;
    orbit.beta += (0.06 - orbit.beta) * Math.min(1, dt * 2);
    orbit.radius += (185 - orbit.radius) * Math.min(1, dt * 2);
  }

  function povFrame(state) {
    const v = state.vehicles[pov];
    const cam = povCameras[pov];
    if (!v || !cam) return;
    const set = POV[pov] || POV.usv;
    cam.position.set(
      v.x + Math.cos(v.heading) * set.ahead,
      v.y + set.eye,
      v.z + Math.sin(v.heading) * set.ahead);
    const look = new BABYLON.Vector3(
      v.x + Math.cos(v.heading) * 12,
      pov === "uav" ? Math.max(0, v.y + set.pitch) : v.y + set.pitch,
      v.z + Math.sin(v.heading) * 12);
    cam.setTarget(look);
  }

  function frame(state, dt) {
    now += dt;
    if (handback > 0 && !grabbed) handback = Math.max(0, handback - dt);
    if (grabbed && (mode === "chase" || mode === "top")) handback = HANDBACK_S;

    if (!pov) {
      if (mode === "free") flyFrame(dt);
      else if (mode === "chase") chaseFrame(state, dt);
      else if (mode === "top") topFrame(dt);
    }
    if (pov) povFrame(state);
  }

  return {
    init, frame, setMode, setFollow, setPov, setFlySpeed, setChase, bindKeys, activate,
    get mode() { return mode; },
    get follow() { return follow; },
    get pov() { return pov; },
    get flySpeed() { return flySpeed; },
    get chase() { return CHASE; },
    get modes() { return MODES.slice(); },
    get follows() { return FOLLOWS.slice(); },
    get handback() { return handback; },
    get freeCamera() { return free; },
  };
})();
