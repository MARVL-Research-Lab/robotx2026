/* tex.js: procedural textures, shared by the scene, the landmarks and the
 * underwater world.
 *
 * The course network has no internet (handbook 3.4.2) and this app ships no
 * image files, so every surface in the scene is painted here at boot: wave
 * normal maps, sand, caustics, building facades, hull decals. Everything goes
 * through BABYLON.DynamicTexture, which the headless harness can stub.
 *
 * Pixel-level generators build an ImageData buffer and blit it once, rather
 * than drawing thousands of canvas primitives, because a 512 x 512 normal map
 * costs a quarter of a million reads either way and this way it is one call.
 */
"use strict";

const Tex = (() => {
  const cache = new Map();

  /** Draw once, keep forever: textures here are all view independent. */
  function once(key, build) {
    if (!cache.has(key)) cache.set(key, build());
    return cache.get(key);
  }

  function canvas(scene, name, w, h, draw) {
    const tex = new BABYLON.DynamicTexture(name, { width: w, height: h }, scene, true);
    draw(tex.getContext(), w, h);
    tex.update(false);
    return tex;
  }

  /** An ImageData the caller fills by hand; falls back flat when stubbed. */
  function pixels(ctx, w, h) {
    if (!ctx.createImageData) return null;
    const img = ctx.createImageData(w, h);
    if (!img || !img.data || img.data.length < w * h * 4) return null;
    return img;
  }

  // ------------------------------------------------------- wave normals --
  /* A tile of open water, as a tangent-space normal map.
   *
   * Heights are a sum of directional sines whose wave numbers are integers in
   * tile space, which is what makes the tile seamless: every component comes
   * back to its own phase at the edge. Steepening the crests (the |sin|^p
   * term) gives the short chop its sharp tops and long flat troughs, which is
   * what makes sun glitter read as water rather than as plastic.
   */
  function waveNormals(scene, name, size, components, strength) {
    return once(name, () => canvas(scene, name, size, size, (ctx, w, h) => {
      const height = new Float32Array(w * h);
      for (const c of components) {
        const [kx, ky, amp, sharp, phase] = c;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const a = 2 * Math.PI * ((kx * x) / w + (ky * y) / h) + phase;
            let s = Math.sin(a);
            if (sharp > 1) s = Math.sign(s) * Math.pow(Math.abs(s), sharp);
            height[y * w + x] += amp * s;
          }
        }
      }

      const img = pixels(ctx, w, h);
      if (!img) { ctx.fillStyle = "#8080ff"; ctx.fillRect(0, 0, w, h); return; }
      const d = img.data;
      const at = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
          const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
          // normalise (-dx, -dy, 1) and pack into 0..255
          const len = Math.sqrt(dx * dx + dy * dy + 1);
          const i = (y * w + x) * 4;
          d[i] = ((-dx / len) * 0.5 + 0.5) * 255;
          d[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
          d[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }));
  }

  /** Short chop: many components, steepened crests. */
  function chopNormals(scene) {
    return waveNormals(scene, "tex-chop", 256, [
      [4, 2, 0.55, 2.2, 0.3],
      [3, -5, 0.45, 2.2, 1.9],
      [7, 3, 0.30, 2.6, 0.8],
      [2, 8, 0.26, 2.6, 2.4],
      [11, -6, 0.16, 3.0, 1.2],
      [9, 12, 0.12, 3.0, 0.5],
    ], 44);
  }

  // ------------------------------------------------------------ caustics --
  /* Caustics on the seabed. Voronoi-ish cell edges lit brightly: the light
   * that misses one cell piles up on the boundary between two, which is why
   * real caustics are a net of bright lines rather than bright blobs.
   * Two of these scrolling over each other at different scales is the cheap
   * trick that sells the whole underwater picture.
   */
  function caustics(scene, seed) {
    const name = "tex-caustic-" + seed;
    return once(name, () => canvas(scene, name, 256, 256, (ctx, w, h) => {
      const n = 26;
      const sites = [];
      let s = seed * 9781 + 1;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      for (let i = 0; i < n; i++) sites.push([rnd(), rnd()]);

      const img = pixels(ctx, w, h);
      if (!img) { ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, w, h); return; }
      const d = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const u = x / w, v = y / h;
          let d1 = 9, d2 = 9;
          for (const [sx, sy] of sites) {
            // wrap in both axes so the tile repeats without a visible seam
            let dx = Math.abs(u - sx); if (dx > 0.5) dx = 1 - dx;
            let dy = Math.abs(v - sy); if (dy > 0.5) dy = 1 - dy;
            const dd = dx * dx + dy * dy;
            if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) { d2 = dd; }
          }
          const edge = Math.sqrt(d2) - Math.sqrt(d1);       // 0 on a cell border
          // A thin net on black. A thick one has a high average, and once the
          // texture minifies that average becomes a flat wash that lifts the
          // whole seabed and takes the sand ripples with it.
          let k = 1 - Math.min(1, edge / 0.042);
          k = Math.pow(Math.max(0, k), 3.0);
          const i = (y * w + x) * 4;
          d[i] = 210 * k + 45 * k * k;
          d[i + 1] = 245 * k;
          d[i + 2] = 225 * k;
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }));
  }

  // -------------------------------------------------------------- seabed --
  /** Silty sand with ripples running one way, shell grit and darker patches. */
  function seabed(scene) {
    return once("tex-seabed", () => canvas(scene, "tex-seabed", 512, 512, (ctx, w, h) => {
      const img = pixels(ctx, w, h);
      if (img) {
        const d = img.data;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x / w) * Math.PI * 2, v = (y / h) * Math.PI * 2;
            // sand ripples: one dominant direction, bent slowly along its length
            const ripple = Math.sin(u * 9 + Math.sin(v * 2) * 1.4) * 0.5 + 0.5;
            const coarse = Math.sin(u * 2 + 1.1) * Math.sin(v * 3 - 0.4) * 0.5 + 0.5;
            const k = 0.42 + ripple * 0.42 + coarse * 0.24;
            const i = (y * w + x) * 4;
            d[i] = 132 * k + 44;
            d[i + 1] = 138 * k + 50;
            d[i + 2] = 112 * k + 44;
            d[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      } else {
        ctx.fillStyle = "#54604f";
        ctx.fillRect(0, 0, w, h);
      }
      // shell grit and weed shadows on top of the ripples
      for (let i = 0; i < 1800; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        const r = 0.6 + Math.random() * 2.2;
        ctx.fillStyle = Math.random() < 0.62
          ? `rgba(${150 + Math.random() * 60},${160 + Math.random() * 50},${140 + Math.random() * 40},0.35)`
          : `rgba(${30 + Math.random() * 30},${44 + Math.random() * 30},${34 + Math.random() * 24},0.4)`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = `rgba(38,52,42,${0.06 + Math.random() * 0.1})`;
        ctx.beginPath();
        ctx.arc(Math.random() * w, Math.random() * h, 20 + Math.random() * 70, 0, Math.PI * 2);
        ctx.fill();
      }
    }));
  }

  // ---------------------------------------------------------- structures --
  /** Glazed tower facade: floor bands, mullions, a scatter of lit rooms. */
  function facade(scene, key, base, glass, lit) {
    const name = "tex-facade-" + key;
    return once(name, () => canvas(scene, name, 128, 256, (ctx, w, h) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      const floors = 32, cols = 10;
      const fh = h / floors, cw = w / cols;
      for (let f = 0; f < floors; f++) {
        for (let c = 0; c < cols; c++) {
          const r = Math.random();
          ctx.fillStyle = r < 0.16 ? lit : glass;
          ctx.globalAlpha = r < 0.16 ? 0.55 + Math.random() * 0.45 : 0.75 + Math.random() * 0.25;
          ctx.fillRect(c * cw + 1, f * fh + 1.5, cw - 2, fh - 3);
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(12,16,22,0.55)";
      for (let f = 0; f <= floors; f++) ctx.fillRect(0, f * fh - 0.5, w, 1);
      for (let c = 0; c <= cols; c++) ctx.fillRect(c * cw - 0.5, 0, 1, h);
    }));
  }

  /** Brushed metal or moulded plastic: fine grain plus a few panel lines. */
  function panel(scene, key, base, grain, lines) {
    const name = "tex-panel-" + key;
    return once(name, () => canvas(scene, name, 256, 256, (ctx, w, h) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        ctx.fillStyle = grain;
        ctx.globalAlpha = 0.02 + Math.random() * 0.06;
        const x = Math.random() * w, y = Math.random() * h;
        ctx.fillRect(x, y, 1 + Math.random() * 14, 1);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = lines;
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const y = Math.random() * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y + (Math.random() - 0.5) * 8);
        ctx.stroke();
      }
      return undefined;
    }));
  }

  /** Non-slip deck: dark tread over the hull colour, with a hazard stripe. */
  function deckTread(scene, key, base, stripe) {
    const name = "tex-deck-" + key;
    return once(name, () => canvas(scene, name, 256, 256, (ctx, w, h) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(10,12,16,0.30)";
      for (let y = 20; y < h - 20; y += 7) ctx.fillRect(18, y, w - 36, 3);
      ctx.fillStyle = stripe;
      ctx.fillRect(0, 0, w, 12);
      ctx.fillRect(0, h - 12, w, 12);
      ctx.fillStyle = "rgba(10,12,16,0.5)";
      for (let x = -h; x < w; x += 26) {
        ctx.beginPath();
        ctx.moveTo(x, 0); ctx.lineTo(x + 12, 0);
        ctx.lineTo(x + 12 + 12, 12); ctx.lineTo(x + 12, 12);
        ctx.closePath(); ctx.fill();
      }
    }));
  }

  /** Soft round sprite, used for spray, bubbles, marine snow and beacon glare. */
  function sprite(scene, key, inner, outer) {
    const name = "tex-sprite-" + key;
    return once(name, () => canvas(scene, name, 64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, inner);
      g.addColorStop(0.45, outer);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }));
  }

  /** A bubble: bright rim, hollow middle, one specular dot. */
  function bubble(scene) {
    return once("tex-bubble", () => canvas(scene, "tex-bubble", 64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.16, w / 2, h / 2, w / 2);
      g.addColorStop(0.00, "rgba(210,240,255,0.06)");
      g.addColorStop(0.72, "rgba(210,240,255,0.14)");
      g.addColorStop(0.90, "rgba(235,250,255,0.85)");
      g.addColorStop(1.00, "rgba(235,250,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const s = ctx.createRadialGradient(w * 0.36, h * 0.34, 0, w * 0.36, h * 0.34, w * 0.16);
      s.addColorStop(0, "rgba(255,255,255,0.9)");
      s.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = s;
      ctx.fillRect(0, 0, w, h);
    }));
  }

  /* Ground planes are looked at almost edge on, and at that angle a tiled
   * texture drops to a high mip level and averages itself into one flat
   * colour. Anisotropic filtering is what keeps the sand and the caustics
   * legible out to the fog rather than only under the camera.
   */
  function aniso(texture, level, scale) {
    texture.anisotropicFilteringLevel = level;
    if (scale !== undefined) texture.uScale = texture.vScale = scale;
    return texture;
  }

  return {
    canvas, aniso, chopNormals, caustics, seabed,
    facade, panel, deckTread, sprite, bubble,
  };
})();
