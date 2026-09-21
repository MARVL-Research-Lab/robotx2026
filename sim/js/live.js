/* live.js: mirror something real instead of simulating it.
 *
 * The server sends the same messages whichever feed is attached: RoboCommand
 * traffic off the course broker (`--broker`), MAVLink telemetry straight off
 * SITL or a vehicle (`--mavlink`), or the running ground station itself
 * (`robotx dashboard --viz`). Vehicles then move because a real vehicle moved,
 * which is what makes this a ground station view rather than an animation.
 */
"use strict";

const Live = (() => {
  let ws = null;
  let onState = null;
  let connected = false;
  let source = "live";
  const seen = {};

  function attach(state, callbacks) {
    onState = callbacks;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws/live`);
    ws.onopen = () => { connected = true; callbacks.status(true, "waiting for traffic"); };
    ws.onclose = () => { connected = false; callbacks.status(false, "socket closed"); };
    ws.onerror = () => callbacks.status(false, "socket error");
    ws.onmessage = ev => handle(JSON.parse(ev.data), state, callbacks);
  }

  function detach() {
    if (ws) { ws.close(); ws = null; }
    connected = false;
  }

  function vehicleKey(id) {
    // The declared ids are USV1/UUV1/UAV1; the scene keys them usv/uuv/uav.
    const lower = id.toLowerCase();
    if (lower.startsWith("usv")) return "usv";
    if (lower.startsWith("uuv")) return "uuv";
    if (lower.startsWith("uav")) return "uav";
    return null;
  }

  function applyVehicle(state, v, callbacks) {
    const key = vehicleKey(v.id);
    if (!key || !state.vehicles[key]) return;
    const target = state.vehicles[key];
    const prev = seen[key];
    target.x = v.pos[0];
    target.z = v.pos[1];
    target.y = key === "uuv" ? -Math.abs(v.depth_m || 0) : (key === "uav" ? (v.altitude_m || 0) : 0);
    target.heading = ((90 - v.heading_deg) * Math.PI) / 180;
    target.speed = v.speed_mps || 0;
    target.state = v.state === "AUTO" ? "AUTO" : (v.state === "KILLED" ? "KILLED" : "MANUAL");
    target.task = v.task || null;
    seen[key] = v;
    if (!prev) callbacks.event(`${v.id} appeared on the wire`);
  }

  function handle(msg, state, callbacks) {
    if (msg.type === "snapshot") {
      source = msg.source || source;
      callbacks.status(msg.connected, msg.connected ? source : `${source} unreachable`);
      Object.values(msg.vehicles || {}).forEach(v => applyVehicle(state, v, callbacks));
      (msg.events || []).forEach(e => callbacks.message(e.label, e.detail));
      if (msg.course_id) callbacks.course(msg.course_id, msg.run_id);
    } else if (msg.type === "vehicle") {
      applyVehicle(state, msg.vehicle, callbacks);
    } else if (msg.type === "event") {
      callbacks.message(msg.event.label, msg.event.detail);
    } else if (msg.type === "incident") {
      if (msg.kind === "ALL_CLEAR") {
        state.incident = null;
      } else {
        state.incident = {
          kind: msg.kind,
          pos: msg.pos || [0, 0],
          radius_m: msg.radius_m || 10,
          heading_deg: msg.heading_deg || 0,
          speed_mps: msg.speed_mps || 0,
        };
      }
      callbacks.event(`RoboCommand: ${msg.kind}`);
    } else if (msg.type === "link") {
      callbacks.status(msg.connected, msg.reason || (msg.connected ? source : "disconnected"));
    } else if (msg.type === "step") {
      // the orchestrator feed reports the step the mission is actually on
      state.step = msg.step;
    }
  }

  return { attach, detach, get connected() { return connected; } };
})();
