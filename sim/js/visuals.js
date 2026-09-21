/* visuals.js: the picture settings, and the panel that drives them.
 *
 * The scene is graded like a photograph of a bay at five in the evening, and
 * that grade fights the job when the sun is behind the course: the glitter
 * path, the bloom around it, and the sky reflected off the water at a grazing
 * angle can put a white band exactly where the buoys are. An operator watching
 * a run needs to be able to turn that down without editing the scene.
 *
 * Every effect that costs contrast is a setting here. Each one carries what it
 * does to the scene, so the panel is generated from this list rather than
 * duplicated in index.html, and the values persist in localStorage so a
 * display set up on the course stays set up.
 *
 * Defaults are the BALANCED preset: the same picture as before with the glare
 * roughly halved, which is legible at a low camera angle and still reads as
 * water. CLEAR strips the glare for reading the course; CINEMATIC is the
 * original grade.
 */
"use strict";

const Visuals = (() => {
  const STORE_KEY = "rx-viz-visuals-v1";

  const V = () => World._internal;

  /* Every setting: what it is called, what it does, and the range it moves
   * over. `apply` is called with the value whenever it changes, and once at
   * boot. Anything without an `apply` is read per frame by render.js.
   */
  const DEFS = [
    // -- sun and reflections: the ones that cost visibility ---------------
    {
      key: "glare", label: "Sun glare", group: "Sun and reflections",
      type: "range", min: 0, max: 1.5, step: 0.05, def: 0.55,
      hint: "The halo around the sun. 0 removes it.",
      apply: v => V().setGlare(v),
    },
    {
      key: "glitter", label: "Water glitter", group: "Sun and reflections",
      type: "range", min: 0, max: 1, step: 0.02, def: 0.42,
      hint: "The sun's specular path across the chop.",
      apply: v => V().setGlitter(v),
    },
    {
      key: "skyMirror", label: "Sky in the water", group: "Sun and reflections",
      type: "range", min: 0, max: 1, step: 0.02, def: 0.72,
      hint: "How much sky the water returns at a grazing angle.",
      apply: v => V().setSkyMirror(v),
    },
    {
      key: "waterTone", label: "Water tone", group: "Sun and reflections",
      type: "range", min: 0.35, max: 1.3, step: 0.02, def: 0.78,
      hint: "How bright the bay itself is. The one that decides whether the "
        + "buoys stand out against it.",
      apply: v => V().setWaterTone(v),
    },
    {
      key: "bloom", label: "Bloom", group: "Sun and reflections",
      type: "range", min: 0, max: 0.8, step: 0.02, def: 0.18,
      hint: "Bleed around the brightest parts of the frame.",
      apply: v => V().setGrade("bloom", v),
    },
    {
      key: "glow", label: "Beacon glow", group: "Sun and reflections",
      type: "range", min: 0, max: 1.5, step: 0.05, def: 0.85,
      hint: "Halo on the light beacons and status lights.",
      apply: v => V().setGrade("glow", v),
    },

    // -- exposure ---------------------------------------------------------
    {
      key: "exposure", label: "Exposure", group: "Exposure",
      type: "range", min: 0.6, max: 1.8, step: 0.02, def: 1.08,
      apply: v => V().setGrade("exposure", v),
    },
    {
      key: "contrast", label: "Contrast", group: "Exposure",
      type: "range", min: 0.8, max: 1.6, step: 0.02, def: 1.14,
      apply: v => V().setGrade("contrast", v),
    },
    {
      key: "sunlight", label: "Sunlight", group: "Exposure",
      type: "range", min: 0, max: 3, step: 0.05, def: 1.75,
      hint: "The directional light, and what casts the shadows.",
      apply: v => V().setGrade("sun", v),
    },
    {
      key: "vignette", label: "Vignette", group: "Exposure",
      type: "check", def: true,
      apply: v => V().setVignette(v),
    },
    {
      key: "fog", label: "Haze", group: "Exposure",
      type: "range", min: 0, max: 2, step: 0.05, def: 1.0,
      hint: "Distance haze, in and out of the water.",
      apply: v => V().setFogScale(v),
    },

    // -- water ------------------------------------------------------------
    {
      key: "waves", label: "Swell", group: "Water",
      type: "range", min: 0, max: 2, step: 0.05, def: 1.0,
      hint: "Height of the swell under the vehicles.",
      apply: v => V().setWaves(v),
    },
    {
      key: "chop", label: "Chop", group: "Water",
      type: "range", min: 0, max: 1.5, step: 0.05, def: 0.55,
      hint: "Surface normal detail. 0 gives flat calm.",
      apply: v => V().setChop(v),
    },
    {
      key: "particles", label: "Wakes, spray, bubbles", group: "Water",
      type: "check", def: true,
    },
    {
      key: "underwaterFx", label: "Caustics and light shafts", group: "Water",
      type: "check", def: true,
      apply: v => Underwater.setEffects(v),
    },

    // -- world ------------------------------------------------------------
    {
      key: "skyline", label: "Marina Bay skyline", group: "World",
      type: "check", def: true,
      apply: v => Landmarks.setVisible(v),
    },
    { key: "clouds", label: "Clouds", group: "World", type: "check", def: true,
      apply: v => V().setClouds(v) },
    { key: "shadows", label: "Shadows", group: "World", type: "check", def: true,
      apply: v => V().setShadows(v) },
    { key: "fxaa", label: "Antialiasing", group: "World", type: "check", def: true,
      apply: v => V().setFxaa(v) },
  ];

  const BY_KEY = {};
  DEFS.forEach(d => { BY_KEY[d.key] = d; });

  /* Three points on the same dial. CINEMATIC is the grade the scene shipped
   * with, BALANCED is what the panel opens on, CLEAR is for reading the
   * course off the screen in daylight.
   */
  const PRESETS = {
    CLEAR: {
      glare: 0.0, glitter: 0.10, skyMirror: 0.40, waterTone: 0.55, bloom: 0.05,
      glow: 0.7, exposure: 1.0, contrast: 1.12, sunlight: 1.35, vignette: false,
      fog: 0.7, chop: 0.35,
    },
    BALANCED: {},          // the defaults above
    CINEMATIC: {
      glare: 1.0, glitter: 1.0, skyMirror: 1.0, waterTone: 1.0, bloom: 0.30,
      glow: 0.85, exposure: 1.2, contrast: 1.18, sunlight: 2.0, vignette: true,
      fog: 1.0, chop: 0.55,
    },
  };

  const values = {};
  let preset = "BALANCED";
  let onChange = null;

  DEFS.forEach(d => { values[d.key] = d.def; });

  // ------------------------------------------------------------ storage --
  function store() {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(STORE_KEY, JSON.stringify({ preset, values }));
    } catch (err) { void err; }   // private browsing, or no storage at all
  }

  function restore() {
    try {
      if (typeof localStorage === "undefined") return;
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved && saved.values) {
        Object.entries(saved.values).forEach(([k, v]) => {
          if (k in values && typeof v === typeof values[k]) values[k] = v;
        });
      }
      if (saved && saved.preset) preset = saved.preset;
    } catch (err) { void err; }
  }

  // ------------------------------------------------------------- values --
  function get(key) {
    return key in values ? values[key] : (BY_KEY[key] ? BY_KEY[key].def : undefined);
  }

  function applyOne(key) {
    const def = BY_KEY[key];
    if (!def || !def.apply) return;
    try {
      def.apply(values[key]);
    } catch (err) {
      // A setting that cannot reach the scene must not take the frame with
      // it: the panel stays usable and the rest of the settings still apply.
      console.warn(`visuals: ${key} did not apply`, err);
    }
  }

  function set(key, value, opts = {}) {
    if (!(key in values)) return;
    values[key] = value;
    applyOne(key);
    if (!opts.silent) {
      preset = matchPreset();
      refreshPresets();
      store();
      if (onChange) onChange(key, value);
    }
  }

  /** Which preset the current values are, or CUSTOM once they drift. */
  function matchPreset() {
    for (const name of Object.keys(PRESETS)) {
      const spec = presetValues(name);
      const same = Object.keys(spec).every(k => {
        const a = spec[k], b = values[k];
        return typeof a === "number" ? Math.abs(a - b) < 1e-6 : a === b;
      });
      if (same) return name;
    }
    return "CUSTOM";
  }

  function presetValues(name) {
    const spec = { ...PRESETS[name] };
    // A preset only names what it moves; everything else is the default.
    DEFS.forEach(d => { if (!(d.key in spec)) spec[d.key] = d.def; });
    return spec;
  }

  function usePreset(name) {
    if (!PRESETS[name]) return;
    const spec = presetValues(name);
    Object.entries(spec).forEach(([k, v]) => { values[k] = v; });
    applyAll();
    preset = name;
    store();
    refresh();
  }

  function applyAll() {
    DEFS.forEach(d => applyOne(d.key));
  }

  /** Called by World.init once the scene exists. */
  function init() {
    restore();
    applyAll();
  }

  // ---------------------------------------------------------------- panel --
  let root = null;

  function control(def) {
    const wrap = document.createElement("label");
    wrap.className = def.type === "check" ? "chk vis-row" : "vis-row";
    if (def.type === "check") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(values[def.key]);
      input.dataset.key = def.key;
      input.onchange = () => set(def.key, input.checked);
      wrap.appendChild(input);
      wrap.appendChild(document.createTextNode(" " + def.label));
    } else {
      const head = document.createElement("span");
      head.className = "vis-head";
      head.innerHTML = `<span>${def.label}</span><b data-val="${def.key}">${fmt(values[def.key])}</b>`;
      const input = document.createElement("input");
      input.type = "range";
      input.min = def.min; input.max = def.max; input.step = def.step;
      input.value = values[def.key];
      input.dataset.key = def.key;
      input.oninput = () => {
        set(def.key, parseFloat(input.value));
        const out = root.querySelector(`[data-val="${def.key}"]`);
        if (out) out.textContent = fmt(values[def.key]);
      };
      wrap.appendChild(head);
      wrap.appendChild(input);
    }
    if (def.hint) {
      const hint = document.createElement("span");
      hint.className = "vis-hint";
      hint.textContent = def.hint;
      wrap.appendChild(hint);
    }
    return wrap;
  }

  function fmt(v) {
    return typeof v === "number" ? v.toFixed(2).replace(/0$/, "") : (v ? "on" : "off");
  }

  /** Build the panel into `element`. Browser only; the harness never calls it. */
  function mount(element, callbacks = {}) {
    root = element;
    onChange = callbacks.onChange || null;
    root.innerHTML = "";

    const seg = document.createElement("div");
    seg.className = "seg";
    seg.id = "preset-seg";
    Object.keys(PRESETS).forEach(name => {
      const b = document.createElement("button");
      b.textContent = name.charAt(0) + name.slice(1).toLowerCase();
      b.dataset.preset = name;
      b.onclick = () => usePreset(name);
      seg.appendChild(b);
    });
    const label = document.createElement("h2");
    label.textContent = "Preset";
    root.appendChild(label);
    root.appendChild(seg);

    let group = null;
    DEFS.forEach(def => {
      if (def.group !== group) {
        group = def.group;
        const h = document.createElement("h2");
        h.textContent = group;
        root.appendChild(h);
      }
      root.appendChild(control(def));
    });
    refresh();
  }

  /* Only the preset row. set() calls this rather than refresh(): a slider
   * that has just been dragged off a preset must not have its own value
   * written back underneath the pointer, but the row above it has to stop
   * claiming a preset the settings no longer match.
   */
  function refreshPresets() {
    if (!root) return;
    root.querySelectorAll("#preset-seg button").forEach(b =>
      b.classList.toggle("active", b.dataset.preset === preset));
  }

  /** Push the current values back into the panel after a preset change. */
  function refresh() {
    if (!root) return;
    DEFS.forEach(def => {
      const input = root.querySelector(`input[data-key="${def.key}"]`);
      if (!input) return;
      if (def.type === "check") input.checked = Boolean(values[def.key]);
      else input.value = values[def.key];
      const out = root.querySelector(`[data-val="${def.key}"]`);
      if (out) out.textContent = fmt(values[def.key]);
    });
    refreshPresets();
  }

  return {
    init, mount, refresh, get, set, usePreset, applyAll,
    get defs() { return DEFS.slice(); },
    get presets() { return Object.keys(PRESETS); },
    get preset() { return preset; },
    get values() { return { ...values }; },
  };
})();
