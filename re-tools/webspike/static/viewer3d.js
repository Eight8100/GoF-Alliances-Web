/* 3D viewer for the original scene data, drawn by gofa3d.js with the ORIGINAL shaders and materials. Data: /art/3d/ (re-tools/ae3/export_viewer.py).
   Fishlabs material from the owner's own app copy: local use only. Drag = orbit, wheel = zoom. window.GoFAViewer for tests. */
(async function () {
  "use strict";
  const $ = (id) => document.getElementById(id), msg = (t) => ($("msg").textContent = t), cv = $("gl");
  const src = !/[?&]relay\b/.test(location.search) && window.GoFAArt ? await GoFAArt.source3d() : null;   // the imported IPA's scene first (?relay forces the relay's files)
  const R = await GoFA3D.create(cv, { preserve: true, source: src || undefined }), M = GoFA3D.M;
  const PLANETS = R.scene.planets.map((p) => p.name);
  const BLD = ["hq", "spaceport", "metal_extractor", "gas_extractor", "crystal_extractor", "barracks", "research", "scanner", "planetary_shield", "trade_center", "artifact_center_type_a"];
  const S = { mode: "planet", planet: "volcano", species: "terran", bld: "hq", shipV: 1, shipSp: "terran", shipCol: "red", sysType: 3, sysPlanets: [{ type: 2, pads: 12, seed: 11 }, { type: 4, pads: 9, seed: 22 }, { type: 6, pads: 7, seed: 33 }, { type: 3, pads: 10, seed: 44 }], yaw: 0.6, pitch: 0.2, zoom: 1, spin: true, rot: 0, cam: null, mirror: !/[?&]mirror=0\b/.test(location.search) };   // mirrored like the game by default (left-handed engine; confirmed on a building 2026-11-12: Random_Shipyard.PNG); ?mirror=0 = the raw right-handed render
  function build() {
    if (S.mode === "planet") R.setPlanet(S.planet, M.rotY(S.rot));
    else if (S.mode === "building") { R.setRoots(["/building_" + S.species + "_" + S.bld, "/building_" + S.species + "_socket"], null, M.rotY(S.rot)); R.ring(S.species, M.rotY(S.rot)); }
    else if (S.mode === "system") R.system(GoFA3D.systemLayout(S.sysPlanets, S.sysType));   // planets placed as the game does (gofa3d.js systemLayout)
    else R.ship(S.shipSp, S.shipV, S.shipCol, M.rotY(S.rot));   // stages add up; the colour's overlay on the top stage only (gofa3d.js R.ship)
  }
  function frameCam() {
    build(); const b = R.bounds(); S.cam = { center: b.center, dist: b.radius / Math.sin(0.35) * (S.mode === "planet" ? 1.25 : 1.05) };
    R.loading().then(() => msg(info()));
    msg("Loading textures ...");
  }
  function info() {
    const shaders = [...new Set(R.items.map((it) => it.mat._prog && it.mat._prog.file).filter(Boolean))].join(", ");
    return { planet: "Planet " + S.planet + ": planet_mesh with " + (R.planet && R.planet.material) + " + atmosphere " + (R.planet && R.planet.atmo),
      building: S.species + " " + S.bld + " on its socket (animation clips play)", system: "Star system (type " + S.sysType + ", " + S.sysPlanets.length + " planets, laid out as in the game)", ship: S.shipSp + " command ship MK " + S.shipV + ", " + (S.shipCol || "no") + " colour" }[S.mode] + ". Original shaders: " + shaders + (R.log.length ? " | " + R.log.slice(-3).join(" | ") : "");
  }
  const bar = $("bar");
  function ui() {
    bar.innerHTML = "";
    const btn = (label, on, f, parent = bar) => { const b = document.createElement("button"); b.textContent = label; if (on) b.className = "on"; b.onclick = f; parent.append(b); return b; };
    for (const [k, l] of [["planet", "Planet"], ["building", "Buildings"], ["ship", "Command ship"], ["system", "System"]]) btn(l, S.mode === k, () => { S.mode = k; frameCam(); ui(); });
    bar.append(document.createTextNode(" | "));
    if (S.mode === "planet") PLANETS.forEach((p) => btn(p, S.planet === p, () => { S.planet = p; frameCam(); ui(); }));
    if (S.mode === "building") { ["terran", "nivelian", "vossk"].forEach((s) => btn(s, S.species === s, () => { S.species = s; frameCam(); ui(); }));
      const sel = document.createElement("select"); BLD.forEach((b) => { const o = document.createElement("option"); o.value = o.textContent = b; if (b === S.bld) o.selected = true; sel.append(o); }); sel.onchange = () => { S.bld = sel.value; frameCam(); }; bar.append(sel); }
    if (S.mode === "ship") {
      ["terran", "vossk", "nivelian", "void"].forEach((v) => btn(v, S.shipSp === v, () => { S.shipSp = v; frameCam(); ui(); }));
      [1, 2, 3].forEach((v) => btn("MK " + v, S.shipV === v, () => { S.shipV = v; frameCam(); ui(); }));
      [null, "red", "blue", "yellow"].forEach((v) => btn(v || "plain", S.shipCol === v, () => { S.shipCol = v; frameCam(); ui(); }));
    }
    btn(S.spin ? "pause" : "spin", false, () => { S.spin = !S.spin; ui(); });
    const lights = document.createElement("details"); lights.innerHTML = "<summary>light</summary>"; bar.append(lights);
    const slider = (label, get, set, min, max, step) => { const l = document.createElement("label"), i = document.createElement("input"), o = document.createElement("span");
      i.type = "range"; i.min = min; i.max = max; i.step = step; i.value = get(); o.textContent = (+get()).toFixed(2); i.oninput = () => { set(+i.value); o.textContent = (+i.value).toFixed(2); }; l.append(label, i, o); lights.append(l); };
    slider("ambient", () => R.L.ambient[2], (v) => (R.L.ambient = [v * 0.7, v * 0.78, v]), 0, 1, 0.01);
    slider("diffuse", () => R.L.diffuse[0], (v) => (R.L.diffuse = [v, v * 0.97, v * 0.92]), 0, 2, 0.01);
    slider("shininess", () => R.L.shininess, (v) => (R.L.shininess = v), 1, 128, 1);
    slider("sun yaw", () => S.sunYaw ?? 1.62, (v) => { S.sunYaw = v; sun(); }, -3.14, 3.14, 0.01);
    slider("sun pitch", () => S.sunPitch ?? 0.3, (v) => { S.sunPitch = v; sun(); }, -1.5, 1.5, 0.01);
  }
  function sun() { const y = S.sunYaw ?? 1.62, p = S.sunPitch ?? 0.3; R.L.dir = [Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)]; }
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame); const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const w = cv.clientWidth * devicePixelRatio | 0, h = cv.clientHeight * devicePixelRatio | 0; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    if (!S.cam) return; if (S.spin) S.rot += dt * 0.08; build();   // rebuilt every frame: the buildings' animation clips move nodes and switch lights
    if (S.mode === "system") {   // the game's system camera (gofa3d.js systemCamera): drag turns it, pitch kept in [-1, 0.5] as in the game
      const sc = GoFA3D.systemCamera(S.yaw, Math.max(-1, Math.min(0.5, -0.5 - (S.pitch - 0.2))), w / h); R.frame({ ...sc, clearColor: [0.004, 0.012, 0.03, 1], mirror: S.mirror }, dt); return;
    }
    const d = S.cam.dist * S.zoom, c = S.cam.center, cp = Math.cos(S.pitch);
    const eye = [c[0] + d * cp * Math.sin(S.yaw), c[1] + d * Math.sin(S.pitch), c[2] + d * cp * Math.cos(S.yaw)];
    R.frame({ eye, target: c, fov: 0.7, near: d / 100, far: d * 50, clearColor: [0.004, 0.012, 0.03, 1], mirror: S.mirror }, dt);   // S.mirror: the game's left-handed look (cam.mirror, as port.js draws it)
  }
  let drag = null; cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, yaw: S.yaw, pitch: S.pitch }; };
  cv.onpointermove = (e) => { if (!drag) return; S.yaw = drag.yaw - (e.clientX - drag.x) * 0.006; S.pitch = Math.max(-1.45, Math.min(1.45, drag.pitch + (e.clientY - drag.y) * 0.006)); };
  cv.onpointerup = () => (drag = null);
  cv.onwheel = (e) => { e.preventDefault(); S.zoom = Math.max(0.2, Math.min(4, S.zoom * (e.deltaY < 0 ? 0.92 : 1.08))); };
  // dev aid: save the canvas as art/extracted/3d/previews/NAME.png through the relay (POST /snap/NAME), after the textures have loaded
  async function snap(name) { await R.loading(); await new Promise((r) => setTimeout(r, 300)); const b = await new Promise((r) => cv.toBlob(r, "image/png")); return (await fetch("/snap/" + name, { method: "POST", body: b })).status; }
  window.GoFAViewer = { S, R, ui, frameCam, sun, snap };
  sun(); frameCam(); ui(); requestAnimationFrame(frame);
})().catch((e) => { document.getElementById("msg").textContent = "Viewer error: " + (e.message || e); console.error(e); });
