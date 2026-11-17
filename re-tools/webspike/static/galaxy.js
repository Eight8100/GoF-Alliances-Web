/* Galaxy map for the spike: system positions and planets come from the map sector files (relay: /relay/sector, a local copy of the
   server's own data/map_x), the overlays from the server (273 owners + heat map, 274 stationed carriers). Pan with the mouse (or one finger),
   zoom with the wheel, click a system. Four overlay modes like the original galaxy screen (owners, heat map, fleets, resources) and a finder
   for free planets / pirate bases / other players. Nothing here computes a game rule: levels, owners, battles and carriers are the server's numbers. */
(function () {
  "use strict";
  const W = window.Wire, A = () => window.GoFA.api, SEC = 30;   // map units per sector (measured: docs/GALAXY_SPEC.md)
  const TYPE_COLOUR = ["", "#8aa0b8", "#a58f6a", "#7fae8a", "#b08aa8", "#6fa3b3", "#b3996f", "#e0a23a", "#d9534f", "#5b8def"];   // planet / system tints; 7-9 = citadels
  const GREEN = "#4cc38a", RED = "#ff6b6b", AMBER = "#f0b24d", BLUE = "#4aa3ff", PURPLE = "#b07cff";
  const LEVELS = {   // resource modes: the best map level (1..9) of resource `key` among a system's planets; quality is planet field 7 (1..10). The ramp starts at `lo`: the best of ~4 planets is high, a full 1..max ramp would be one colour
    metal: { key: 1, colour: "#9fb4c8", lo: 3, max: 9 }, gas: { key: 2, colour: "#5bd68a", lo: 3, max: 9 }, crystal: { key: 3, colour: "#c58bff", lo: 3, max: 9 }, quality: { key: 0, colour: AMBER, lo: 5, max: 10 },
  };
  const MODES = [["owners", "Owners"], ["heat", "Heat map"], ["fleets", "Fleets"], ["metal", "Metal"], ["gas", "Gas"], ["crystal", "Crystal"], ["quality", "Quality"]];
  const MIN_SCALE = 1.6, MAX_SCALE = 24;
  const G = { cx: 0, cy: 0, scale: 5, sectors: new Map(), pending: new Set(), loads: new Map(), queue: [], active: 0, sel: null, hover: null, mode: "owners", finder: "free", sort: "near", minQ: 0,
    canvas: null, ctx: null, w: 0, h: 0, dpr: 1, drag: null, inited: false, moved: false, home: null, homeSys: null, selTok: 0, dirty: false, stamp: 0, nSystems: 0 };
  window.GoFAGalaxy = G;
  const dblOf = (v) => (v && typeof v === "object" ? v.dbl : v);
  const $ = (id) => document.getElementById(id);
  const save = (k, v) => { try { localStorage.setItem("gofa.galaxy." + k, v); } catch (e) { /* private window */ } };
  const load = (k) => { try { return localStorage.getItem("gofa.galaxy." + k); } catch (e) { return null; } };

  // ---- colours ------------------------------------------------------------------------------------------------------------------------
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.substr(i, 2), 16));
  const mix = (a, b, t) => { const x = hex(a), y = hex(b); return "rgb(" + x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",") + ")"; };
  const heatColour = (t) => (t < 0.5 ? mix("#4a8fe0", "#f0c24d", t * 2) : mix("#f0c24d", "#ff4d4d", (t - 0.5) * 2));   // few battles -> many
  const levelT = (L, v) => Math.max(0, Math.min(1, (v - L.lo) / (L.max - L.lo)));
  const levelColour = (L, v) => mix("#2d3647", L.colour, levelT(L, v));

  // ---- map data -----------------------------------------------------------------------------------------------------------------------
  function parseSector(u8, x, y) {   // {3: {1: system, ...}}; system {1 id, 2 type, 3 name, 4 star seed, 5 {1 x, 2 y}, 6 {1: planet}}; planet {1 id, 3 type, 4 number, 5 pads, 6 pad layout seed, 7 quality, 8 {1 res, 2 level}}
    const systems = [];
    for (const top of W.decode(u8)) {
      if (top.f !== 3) continue;
      for (const sy of W.decode(top.v)) {
        const s = W.decode(sy.v), pos = W.msg(W.get(s, 5) || new Uint8Array(0)), planets = [];
        const pc = W.get(s, 6);
        for (const pl of pc ? W.all(W.msg(pc), 1) : []) {
          const p = W.msg(pl), res = {};
          for (const r of W.all(p, 8)) { const q = W.msg(r); res[W.get(q, 1)] = W.get(q, 2); }
          planets.push({ id: W.num(W.get(p, 1)), type: W.get(p, 3), number: W.get(p, 4), pads: W.get(p, 5), padSeed: W.get(p, 6), quality: W.get(p, 7), res });   // 5 = number of structure pads, 6 = seed of their layout (the game's planet scene, docs/ART_3D.md)
        }
        const best = { 1: 0, 2: 0, 3: 0 }; let qmax = 0;   // the best level among the planets (the resource modes colour by it)
        for (const p of planets) { for (const k of [1, 2, 3]) best[k] = Math.max(best[k], p.res[k] || 0); qmax = Math.max(qmax, p.quality || 0); }
        systems.push({ id: W.num(W.get(s, 1)), type: W.get(s, 2), seed: W.num(W.get(s, 4)) || 0, name: W.get(s, 3) ? W.str(W.get(s, 3)) : "?", x: dblOf(W.get(pos, 1)), y: dblOf(W.get(pos, 2)), planets, sx: x, sy: y, best, qmax });
      }
    }
    return systems;
  }

  // sectors load through a small queue (8 at a time): the zoomed-out map asks for ~100 of them at once
  function loadSector(x, y) {   // resolves when the sector's map data AND its overlays are in (or it does not exist)
    const key = x + "_" + y;
    if (x < 0 || y < 0 || x > 39 || y > 39) return Promise.resolve();
    if (G.loads.has(key)) return G.loads.get(key);
    G.pending.add(key);
    const p = new Promise((resolve) => G.queue.push({ x, y, key, resolve }));
    G.loads.set(key, p); pump(); return p;
  }
  function pump() {
    while (G.active < 8 && G.queue.length) {
      const job = G.queue.shift(); G.active++;
      fetchSector(job).catch(() => { /* the sector stays empty */ }).finally(() => { G.active--; G.pending.delete(job.key); job.resolve(); pump(); scheduleDraw(); });
    }
  }
  async function fetchSector(job) {
    let systems = [];
    try { const r = await fetch("/relay/sector?x=" + job.x + "&y=" + job.y); if (r.ok) systems = parseSector(new Uint8Array(await r.arrayBuffer()), job.x, job.y); } catch (e) { /* offline: empty */ }
    const sec = { x: job.x, y: job.y, systems, owners: new Map(), heat: new Map(), fleets: new Map() };
    G.sectors.set(job.key, sec); G.nSystems += systems.length; noteHome(); scheduleDraw();
    await loadOverlay(sec); scheduleDraw(); scheduleFinder();
  }
  // overlays of one sector: 273 {1 x, 2 y} -> {3 {1 system {1 id, 2 planet {1 id, 2 owner, 4 kind}, 6 battles in 24 h, 7 heat 0..1 (double), 8 {1 planet under attack}}}};
  // 274 -> {3 {1 system {1 id, 2 planet {1 id, 2 own carriers stationed, 3 allied carriers stationed}}}}; one call for both
  async function loadOverlay(sec) {
    if (!sec.systems.length) return;
    const rq = W.concat([W.v(1, sec.x), W.v(2, sec.y)]);
    let got; try { got = await A().callRaw([[273, rq], [274, rq]]); } catch (e) { return; }   // the map still works without the overlays
    const owners = new Map(), heat = new Map(), fleets = new Map(), e3 = got.find((q) => q.ext === 273), e4 = got.find((q) => q.ext === 274);
    const c3 = e3 && W.get(W.msg(e3.payload), 3);
    for (const sy of c3 ? W.all(W.msg(c3), 1) : []) {
      const s = W.msg(sy);
      for (const pr of W.all(s, 2)) { const q = W.msg(pr); if (W.get(q, 2)) owners.set(W.num(W.get(q, 1)), { owner: W.num(W.get(q, 2)), kind: W.get(q, 4) }); }
      const battles = W.get(s, 6) || 0;
      if (battles) heat.set(W.num(W.get(s, 1)), { battles, heat: Math.max(0, Math.min(1, dblOf(W.get(s, 7)) || 0)), hot: W.all(s, 8).map((u) => W.num(W.get(W.msg(u), 1))) });
    }
    const c4 = e4 && W.get(W.msg(e4.payload), 3);
    for (const sy of c4 ? W.all(W.msg(c4), 1) : []) for (const pr of W.all(W.msg(sy), 2)) { const q = W.msg(pr); fleets.set(W.num(W.get(q, 1)), { own: W.get(q, 2) || 0, allied: W.get(q, 3) || 0 }); }
    sec.owners = owners; sec.heat = heat; sec.fleets = fleets; G.stamp = Date.now();
  }

  function noteHome() {   // the start planet's system: distances are measured from it; the first view centres on it
    const id = A().S.order.find((p) => p > 10 ** 9); if (!id) return;
    const sec = G.sectors.get(Math.floor(id / 1e11) + "_" + (Math.floor(id / 1e7) % 1e4)); if (!sec) return;
    const sys = sec.systems.find((s) => s.planets.some((p) => p.id === id));
    if (sys && sys !== G.homeSys) { G.homeSys = sys; G.home = [sys.x, sys.y]; if (!G.moved) { G.cx = sys.x; G.cy = sys.y; } }
  }

  // ---- drawing ------------------------------------------------------------------------------------------------------------------------
  function visibleSectors() {
    const x0 = Math.floor((G.cx - G.w / 2 / G.scale) / SEC), x1 = Math.floor((G.cx + G.w / 2 / G.scale) / SEC);
    const y0 = Math.floor((G.cy - G.h / 2 / G.scale) / SEC), y1 = Math.floor((G.cy + G.h / 2 / G.scale) / SEC);
    const out = []; for (let x = Math.max(0, x0); x <= Math.min(39, x1); x++) for (let y = Math.max(0, y0); y <= Math.min(39, y1); y++) out.push([x, y]); return out;
  }
  const toScreen = (x, y) => [(x - G.cx) * G.scale + G.w / 2, (G.h / 2) - (y - G.cy) * G.scale];   // y up
  const toWorld = (px, py) => [G.cx + (px - G.w / 2) / G.scale, G.cy - (py - G.h / 2) / G.scale];
  const ownPlanetSet = () => new Set(A().S.order);
  function scheduleDraw() { if (G.dirty) return; G.dirty = true; setTimeout(() => { G.dirty = false; draw(); }, 30); }   // a timer, not requestAnimationFrame: it must also run in a background tab

  // what the overlays say about one system (filled into `o`, reused: this runs for every system on every frame)
  function state(sec, s, own, o) {
    o.mine = o.pirate = o.other = false; o.ownF = o.allyF = 0;
    for (const p of s.planets) {
      if (own.has(p.id)) o.mine = true; else { const w = sec && sec.owners.get(p.id); if (w) { if (w.kind === 4) o.pirate = true; else o.other = true; } }
      const f = sec && sec.fleets.get(p.id); if (f) { o.ownF += f.own; o.allyF += f.allied; }
    }
    const h = sec && sec.heat.get(s.id); o.battles = h ? h.battles : 0; o.heat = h ? h.heat : 0; o.hot = h ? h.hot.length : 0;
    return o;
  }

  function draw() {
    if (!G.ctx) return;
    const c = G.ctx, st = getComputedStyle(document.documentElement), ink = st.getPropertyValue("--ink") || "#ddd", muted = st.getPropertyValue("--muted") || "#889";
    c.setTransform(G.dpr, 0, 0, G.dpr, 0, 0); c.clearRect(0, 0, G.w, G.h);
    c.fillStyle = st.getPropertyValue("--bg") || "#111"; c.fillRect(0, 0, G.w, G.h);
    const own = ownPlanetSet(), mode = G.mode, L = LEVELS[mode], vis = visibleSectors(), S = {}, r0 = Math.max(1.6, G.scale * 0.34), ringR = Math.max(4, G.scale * 0.6);
    c.strokeStyle = st.getPropertyValue("--line") || "#333"; c.lineWidth = 1; c.font = "10px system-ui";
    for (const [sx, sy] of vis) {   // sector grid; a sector that is still loading is shaded
      const [px, py] = toScreen(sx * SEC, (sy + 1) * SEC), k = sx + "_" + sy;
      if (G.pending.has(k)) { c.fillStyle = "rgba(140,150,170,.07)"; c.fillRect(px, py, SEC * G.scale, SEC * G.scale); }
      c.strokeRect(px, py, SEC * G.scale, SEC * G.scale);
      if (G.scale >= 3.2) { c.fillStyle = muted; c.globalAlpha = 0.55; c.fillText(k, px + 4, py + 11); c.globalAlpha = 1; }
    }
    for (const [sx, sy] of vis) {
      const sec = G.sectors.get(sx + "_" + sy); if (!sec) { loadSector(sx, sy); continue; }
      for (const s of sec.systems) {
        const [px, py] = toScreen(s.x, s.y); if (px < -10 || py < -10 || px > G.w + 10 || py > G.h + 10) continue;
        const o = state(sec, s, own, S), picked = G.sel && G.sel.id === s.id;
        let fill = TYPE_COLOUR[s.type] || "#888", r = r0, ring = null, w = 2, alpha = 1, text = null, hot = false;
        if (mode === "owners") ring = o.mine ? GREEN : o.pirate ? RED : o.other ? AMBER : null;
        else if (mode === "heat") { alpha = o.battles ? 1 : 0.4; if (o.battles) { ring = heatColour(o.heat); w = 2 + 2 * o.heat; hot = o.hot > 0; } else if (o.mine) { ring = GREEN; w = 1.5; alpha = 0.8; } }
        else if (mode === "fleets") {
          alpha = o.ownF || o.allyF || o.mine ? 1 : 0.4; ring = o.ownF ? BLUE : o.allyF ? PURPLE : o.mine ? GREEN : null; if (o.ownF || o.allyF) text = o.ownF + (o.allyF ? "+" + o.allyF : "");
        } else {   // resources: colour ramp and dot size by the best level among the planets
          const v = L.key ? s.best[L.key] : s.qmax, t = levelT(L, v);
          fill = levelColour(L, v); r = r0 * (0.75 + 0.9 * t); text = v; ring = o.mine ? GREEN : null; w = 1.5;
        }
        c.globalAlpha = alpha; c.beginPath(); c.arc(px, py, r, 0, 6.283); c.fillStyle = fill; c.fill(); c.globalAlpha = 1;
        if (ring) { c.beginPath(); c.arc(px, py, Math.max(ringR, r + 2), 0, 6.283); c.lineWidth = w; c.strokeStyle = ring; c.stroke(); }
        if (hot) { c.beginPath(); c.setLineDash([3, 3]); c.arc(px, py, Math.max(ringR, r + 2) + 4, 0, 6.283); c.lineWidth = 1.5; c.strokeStyle = "#ffffff"; c.stroke(); c.setLineDash([]); }   // a planet fought over in the last hour
        if (picked || (G.hover && G.hover.id === s.id)) { c.beginPath(); c.arc(px, py, Math.max(ringR, r + 2) + (hot ? 7 : 2), 0, 6.283); c.lineWidth = picked ? 2 : 1; c.strokeStyle = picked ? "#ffffff" : muted; c.stroke(); }
        c.fillStyle = ink;
        if (G.scale >= 12 || picked || (G.hover && G.hover.id === s.id)) { c.font = "11px system-ui"; c.fillText(s.name, px + 7, py - 6); }   // names of every system only when they cannot overlap (spacing >= 2.5 units)
        if (text !== null && G.scale >= 6) { c.font = "10px system-ui"; c.fillText(String(text), px + Math.max(ringR, r + 2) + 2, py + 4); }
      }
    }
    if (G.homeSys) { const [px, py] = toScreen(G.homeSys.x, G.homeSys.y); c.strokeStyle = GREEN; c.lineWidth = 1; c.beginPath(); c.moveTo(px - 11, py); c.lineTo(px - 6, py); c.moveTo(px + 6, py); c.lineTo(px + 11, py); c.moveTo(px, py - 11); c.lineTo(px, py - 6); c.moveTo(px, py + 6); c.lineTo(px, py + 11); c.stroke(); }   // crosshair: your start planet
    updateStatus();
  }

  function systemAt(px, py) {
    const [wx, wy] = toWorld(px, py); let best = null, bd = Math.max(1.2, 10 / G.scale);
    for (const [sx, sy] of visibleSectors()) { const sec = G.sectors.get(sx + "_" + sy); if (!sec) continue; for (const s of sec.systems) { const d = Math.hypot(s.x - wx, s.y - wy); if (d < bd) { bd = d; best = s; } } }
    return best;
  }

  function updateStatus() {
    const el = $("galaxyStatus"); if (!el) return;
    const sx = Math.floor(G.cx / SEC), sy = Math.floor(G.cy / SEC), n = G.pending.size;
    el.textContent = "Centre " + G.cx.toFixed(0) + ", " + G.cy.toFixed(0) + " (sector " + sx + "_" + sy + ") · " + G.nSystems.toLocaleString("en") + " systems in " + G.sectors.size + " sectors" + (n ? " · loading " + n : "")
      + (G.stamp ? " · overlays from " + new Date(G.stamp).toLocaleTimeString("en-GB") : "");
  }

  function resize() {
    const box = $("galaxy"); if (!G.canvas) return;
    G.w = Math.max(300, box.clientWidth); G.h = Math.round(Math.min(560, G.w * 0.72)); G.dpr = Math.min(2, window.devicePixelRatio || 1);
    G.canvas.width = Math.round(G.w * G.dpr); G.canvas.height = Math.round(G.h * G.dpr); G.canvas.style.height = G.h + "px"; draw();
    if (!G.mineAt || Date.now() - G.mineAt > 10000) refreshMine();
  }

  function zoomAt(f, px, py) {
    const [wx, wy] = toWorld(px, py); G.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, G.scale * f)); const [nx, ny] = toWorld(px, py); G.cx += wx - nx; G.cy += wy - ny; G.moved = true; draw();
  }
  function focusSystem(s, scroll) {   // centre, mark and open the panel of a system
    G.sel = s; G.cx = s.x; G.cy = s.y; G.moved = true; draw(); select(s);
    if (scroll) $("systemPanel").scrollIntoView({ block: "nearest" });
  }

  // ---- tooltip --------------------------------------------------------------------------------------------------------------------------
  function tipLines(s) {
    const sec = G.sectors.get(s.sx + "_" + s.sy), o = state(sec, s, ownPlanetSet(), {}), lines = [s.name + " · " + s.planets.length + " planet" + (s.planets.length === 1 ? "" : "s")];
    lines.push("best levels: metal " + s.best[1] + " · gas " + s.best[2] + " · crystal " + s.best[3] + " · quality " + s.qmax);
    const who = []; if (o.mine) who.push("yours"); if (o.pirate) who.push("pirate base"); if (o.other) who.push("another player"); if (who.length) lines.push(who.join(", "));
    if (o.battles) lines.push(o.battles + " battle" + (o.battles === 1 ? "" : "s") + " in 24 h" + (o.hot ? ", " + o.hot + " planet" + (o.hot === 1 ? "" : "s") + " under attack" : ""));
    if (o.ownF || o.allyF) lines.push("carriers stationed: yours " + o.ownF + (o.allyF ? ", allies " + o.allyF : ""));
    return lines;
  }
  function showTip(s, px, py) {
    const tip = $("galaxyTip"); if (!tip) return;
    if (!s) { tip.hidden = true; return; }
    tip.textContent = tipLines(s).join("\n"); tip.hidden = false;
    tip.style.left = Math.min(G.w - tip.offsetWidth - 4, px + 14) + "px"; tip.style.top = Math.max(4, Math.min(G.h - tip.offsetHeight - 4, py + 14)) + "px";
  }

  // ---- page ------------------------------------------------------------------------------------------------------------------------------
  const CSS = `#galaxy .gtools { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 10px 0 4px; align-items: center; } #galaxy .gmodes { display: flex; flex-wrap: wrap; gap: 4px; }
    #galaxy .gmodes button { padding: 4px 10px; font-size: 13px; } #galaxy .gmodes button.on { border-color: var(--accent); box-shadow: inset 0 -2px 0 var(--accent); }
    #galaxy .gnav { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; } #galaxy .gnav input[type=text] { width: 200px; } #galaxy .gnav select { width: auto; max-width: 210px; } #galaxy .gnav button { padding: 5px 10px; font-size: 13px; }
    .glegend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--muted); align-items: center; margin: 2px 0 0; } .glegend .sw { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
    .glegend .ramp { display: inline-block; width: 130px; height: 8px; border-radius: 4px; vertical-align: middle; margin: 0 6px; }
    #galaxyWrap { position: relative; } #galaxyCanvas { touch-action: none; outline: none; }
    #galaxyTip { position: absolute; pointer-events: none; z-index: 5; background: var(--panel); border: 1px solid var(--line); border-radius: 7px; padding: 6px 9px; font-size: 12px; line-height: 1.45; white-space: pre-line; max-width: 300px; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
    #galaxyStatus { margin-top: 6px; } #gSearchResults { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    #systemPanel .planetrow { grid-template-columns: minmax(0, 1fr); gap: 6px; } #systemPanel .planetrow .orders select { width: auto; max-width: 100%; } .lvgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px 16px; margin: 5px 0 3px; max-width: 330px; }
    .lv { display: flex; align-items: center; gap: 6px; font-size: 12px; } .lv .k { width: 48px; } .lv .bar { flex: 1; margin: 0; min-width: 30px; } .lv b { width: 12px; text-align: right; font-variant-numeric: tabular-nums; }
    #galaxyFinder .fopts { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin-bottom: 6px; } #galaxyFinder .fopts select { width: auto; } #galaxyFinder .fopts button.on { border-color: var(--accent); box-shadow: inset 0 -2px 0 var(--accent); }
    #galaxyFinder .frow { display: flex; gap: 4px 10px; align-items: baseline; flex-wrap: wrap; padding: 4px 0; border-bottom: 1px solid var(--line); font-size: 13px; } #galaxyFinder .frow .grow { min-width: 220px; }`;

  function init() {
    if (G.inited) return; G.inited = true;
    const st = document.createElement("style"); st.textContent = CSS; document.head.append(st);
    const a = A(), h = a.h, box = $("galaxy");
    if (LEVELS[load("mode")] || ["owners", "heat", "fleets"].includes(load("mode"))) G.mode = load("mode");
    box.replaceChildren();
    box.append(h("div", "muted small", "Drag to pan, wheel (or the + / − buttons) to zoom, click a system for its planets and orders; the arrow keys also pan. The overlays are the server's numbers; the green crosshair is your start planet."));
    const tools = h("div", "gtools"), modes = h("div", "gmodes"), nav = h("div", "gnav");
    for (const [m, label] of MODES) { const b = h("button", m === G.mode ? "on" : "", label); b.dataset.mode = m; b.onclick = () => setMode(m); modes.append(b); }
    const search = h("input"); search.type = "text"; search.id = "gSearch"; search.placeholder = "Find a system, or x,y"; search.title = "A system name (loaded sectors only), or map units like 480,650"; search.autocomplete = "off";
    search.onkeydown = (e) => { if (e.key === "Enter") gotoText(search.value); };
    const go = h("button", "", "Go"); go.onclick = () => gotoText(search.value);
    const mine = h("select"); mine.id = "galaxyMine"; mine.title = "Jump to one of your planets"; mine.append(new Option("My planets…", "")); mine.onchange = () => { if (mine.value) { goPlanet(Number(mine.value)); mine.value = ""; } };
    const mk = (label, title, fn) => { const b = h("button", "", label); b.title = title; b.onclick = fn; return b; };
    nav.append(search, go, mine, mk("Start planet", "Centre on your start planet in the outer galaxy", () => G.homeSys && focusSystem(G.homeSys)),
      mk("+", "Zoom in", () => zoomAt(1.4, G.w / 2, G.h / 2)), mk("−", "Zoom out", () => zoomAt(1 / 1.4, G.w / 2, G.h / 2)),
      mk("Load wider", "Load the 9 × 9 sectors around the centre (the finder and the name search only see loaded sectors)", loadWide), mk("Refresh", "Fetch owners, battles and carriers again", () => refreshOverlays(true)));
    tools.append(modes, nav);
    const wrap = h("div"); wrap.id = "galaxyWrap"; const cv = h("canvas"); cv.id = "galaxyCanvas"; cv.tabIndex = 0; const tip = h("div"); tip.id = "galaxyTip"; tip.hidden = true; wrap.append(cv, tip);
    const legend = h("div", "glegend"); legend.id = "galaxyLegend";
    const status = h("div", "muted small"); status.id = "galaxyStatus";
    const found = h("div"); found.id = "gSearchResults";
    const panel = h("div"); panel.id = "systemPanel"; const finder = h("div"); finder.id = "galaxyFinder";
    box.append(tools, legend, wrap, status, found, panel, finder);
    G.canvas = cv; G.ctx = cv.getContext("2d");
    const own = a.S.order.find((p) => p > 10 ** 9);   // an outer planet, if any, centres the map (its system is found once the sector is in)
    const sx = own ? Math.floor(own / 1e11) : 15, sy = own ? Math.floor(own / 1e7) % 1e4 : 21;
    G.cx = sx * SEC + SEC / 2; G.cy = sy * SEC + SEC / 2; G.home = [G.cx, G.cy];
    cv.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse" && e.button !== 0) return; G.drag = { x: e.offsetX, y: e.offsetY, cx: G.cx, cy: G.cy, moved: false }; cv.setPointerCapture(e.pointerId); showTip(null); });
    cv.addEventListener("pointermove", (e) => {
      if (G.drag) { const dx = e.offsetX - G.drag.x, dy = e.offsetY - G.drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) G.drag.moved = true; if (G.drag.moved) { G.moved = true; G.cx = G.drag.cx - dx / G.scale; G.cy = G.drag.cy + dy / G.scale; draw(); } return; }
      if (e.pointerType !== "mouse") return;
      const s = systemAt(e.offsetX, e.offsetY); if ((s && s.id) !== (G.hover && G.hover.id)) { G.hover = s; cv.style.cursor = s ? "pointer" : "grab"; draw(); } showTip(s, e.offsetX, e.offsetY);
    });
    cv.addEventListener("pointerup", (e) => { const d = G.drag; G.drag = null; if (!d || d.moved) return; const s = systemAt(e.offsetX, e.offsetY); G.sel = s; draw(); select(s); });
    cv.addEventListener("pointerleave", () => { if (G.hover) { G.hover = null; draw(); } showTip(null); });
    cv.addEventListener("dblclick", (e) => zoomAt(1.8, e.offsetX, e.offsetY));
    cv.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.offsetX, e.offsetY); }, { passive: false });
    cv.addEventListener("keydown", (e) => {
      const step = 60 / G.scale, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (d) { G.cx += d[0]; G.cy += d[1]; G.moved = true; draw(); e.preventDefault(); } else if (e.key === "+" || e.key === "=") zoomAt(1.4, G.w / 2, G.h / 2); else if (e.key === "-") zoomAt(1 / 1.4, G.w / 2, G.h / 2);
    });
    window.addEventListener("pointerup", () => { G.drag = null; });
    window.addEventListener("resize", resize);
    setInterval(() => { if (!box.hidden) refreshOverlays(false); }, 30000);   // heat map and carriers change on their own
    renderLegend(); renderFinder(); resize();
  }

  function setMode(m) {
    G.mode = m; save("mode", m);
    for (const b of document.querySelectorAll("#galaxy .gmodes button")) b.classList.toggle("on", b.dataset.mode === m);
    renderLegend(); draw();
  }
  function renderLegend() {
    const box = $("galaxyLegend"); if (!box) return; const h = A().h; box.replaceChildren();
    const chip = (colour, text) => { const e = h("span"), sw = h("span", "sw"); sw.style.background = colour; e.append(sw, text); return e; };
    const ramp = (L, from, to) => { const e = h("span"), r = h("span", "ramp"); r.style.background = "linear-gradient(90deg," + levelColour(L, L.lo) + "," + levelColour(L, L.max) + ")"; e.append(from, r, to); return e; };
    if (G.mode === "owners") box.append(chip(GREEN, "ring: yours"), chip(RED, "pirate base"), chip(AMBER, "another player"), chip("#e0a23a", "tint = system type (amber / red / blue = citadel planets)"));
    else if (G.mode === "heat") { const e = h("span"), r = h("span", "ramp"); r.style.background = "linear-gradient(90deg," + heatColour(0) + "," + heatColour(0.5) + "," + heatColour(1) + ")"; e.append("battles in the last 24 h:  few", r, "10 or more"); box.append(e, chip("#ffffff", "dashed ring: a planet fought over in the last hour"), chip(GREEN, "your planets (thin)")); }
    else if (G.mode === "fleets") box.append(chip(BLUE, "your carriers stationed (number at zoom)"), chip(PURPLE, "alliance mates' carriers"), chip(GREEN, "your planets without carriers"));
    else { const L = LEVELS[G.mode]; box.append(ramp(L, (G.mode === "quality" ? "quality" : G.mode + " level") + " of the system's best planet:  " + L.lo + " or less", String(L.max)), chip(GREEN, "ring: your planets"), h("span", "", "dot size grows with the level")); }
  }

  // ---- search and navigation ---------------------------------------------------------------------------------------------------------
  function gotoText(text) {
    const box = $("gSearchResults"), a = A(), q = (text || "").trim(); box.replaceChildren(); if (!q) return;
    const xy = /^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/.exec(q);
    if (xy) { G.cx = Number(xy[1]); G.cy = Number(xy[2]); G.moved = true; draw(); return; }
    const low = q.toLowerCase(), hits = [];
    for (const sec of G.sectors.values()) for (const s of sec.systems) { const n = s.name.toLowerCase(); if (n.includes(low)) hits.push({ s, rank: n.startsWith(low) ? 0 : 1, d: Math.hypot(s.x - G.cx, s.y - G.cy) }); }
    hits.sort((p, r) => p.rank - r.rank || p.d - r.d);
    if (!hits.length) { box.append(a.h("span", "muted small", "No system named like that in the " + G.sectors.size + " loaded sectors: pan or use Load wider, or type map units like 480,650.")); return; }
    if (hits.length === 1) { focusSystem(hits[0].s); return; }
    for (const x of hits.slice(0, 10)) { const b = a.h("button", "", x.s.name + " (" + x.s.sx + "_" + x.s.sy + ")"); b.onclick = () => { focusSystem(x.s); box.replaceChildren(); }; box.append(b); }
    if (hits.length > 10) box.append(a.h("span", "muted small", "+ " + (hits.length - 10) + " more: type more letters"));
  }
  async function goPlanet(id) {
    const sx = Math.floor(id / 1e11), sy = Math.floor(id / 1e7) % 1e4; await loadSector(sx, sy);
    const sec = G.sectors.get(sx + "_" + sy), s = sec && sec.systems.find((y) => y.planets.some((p) => p.id === id)); if (s) focusSystem(s, true);
  }
  async function refreshMine() {   // "My planets…" lists every own planet by its system name (the sectors load through the queue)
    const sel = $("galaxyMine"); if (!sel) return; G.mineAt = Date.now();
    const ids = A().S.order.slice(), rows = [];
    for (const id of ids) {
      const sx = Math.floor(id / 1e11), sy = Math.floor(id / 1e7) % 1e4; await loadSector(sx, sy);
      const sec = G.sectors.get(sx + "_" + sy), s = sec && sec.systems.find((y) => y.planets.some((p) => p.id === id)), p = s && s.planets.find((q) => q.id === id);
      if (s) rows.push([id, s.name + " #" + p.number + (id === ids[0] ? " (home)" : id === (ids.find((i) => i > 10 ** 9)) ? " (start planet)" : "")]);
    }
    const keep = sel.value; sel.replaceChildren(new Option("My planets…", "")); for (const [id, label] of rows) sel.append(new Option(label, String(id))); sel.value = keep;
  }
  function loadWide() {
    const sx = Math.floor(G.cx / SEC), sy = Math.floor(G.cy / SEC);
    for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) loadSector(sx + dx, sy + dy).then(() => scheduleFinder());
    scheduleDraw();
  }
  function refreshOverlays(all) {   // heat map / carriers / owners of the sectors in view (at most 24, nearest the centre first)
    const list = visibleSectors().map(([x, y]) => G.sectors.get(x + "_" + y)).filter(Boolean).sort((p, r) => Math.hypot(p.x * SEC + 15 - G.cx, p.y * SEC + 15 - G.cy) - Math.hypot(r.x * SEC + 15 - G.cx, r.y * SEC + 15 - G.cy));
    Promise.all(list.slice(0, all ? 60 : 24).map(loadOverlay)).then(() => { draw(); scheduleFinder(); });
  }

  // ---- system panel: planets of the clicked system (map data) + owners (request 103) + orders --------------------------------------
  const TYPE_NAME = (t) => (t >= 7 ? "Citadel planet (" + ["", "", "", "", "", "", "", "blue", "red", "yellow"][t] + ")" : "Planet type " + t);
  function ownerOf(sec, p) {
    const A_ = A(), mine = A_.S.order.includes(p.id), o = sec && sec.owners.get(p.id);
    if (mine) return { label: "yours", cls: "ok" };
    if (o) return o.kind === 4 ? { label: "pirate base", cls: "bad" } : { label: "another player", cls: "warn" };
    return { label: "free", cls: "muted" };
  }
  function levelBar(h, label, v, max, colour) {   // a small labelled bar for a map level
    const e = h("span", "lv"), bar = h("span", "bar"), fill = h("i");
    fill.style.width = Math.min(100, (100 * (v || 0)) / max) + "%"; fill.style.background = colour; bar.append(fill); e.append(h("span", "muted k", label), bar, h("b", "", v == null ? "?" : String(v))); return e;
  }
  async function select(s) {
    const panel = $("systemPanel"), tok = ++G.selTok; panel.replaceChildren();
    if (!s) return;
    const a = A(), h = a.h, sec = G.sectors.get(s.sx + "_" + s.sy), o = state(sec, s, ownPlanetSet(), {});
    panel.append(h("h3", "", s.name + " · system " + s.id));
    const dist = G.home ? Math.hypot(s.x - G.home[0], s.y - G.home[1]) : null, bits = ["sector " + s.sx + "_" + s.sy, "position " + s.x.toFixed(1) + ", " + s.y.toFixed(1)];
    if (dist !== null) bits.push(dist < 0.05 ? "your start system" : dist.toFixed(1) + " map units from your start planet");
    if (o.battles) bits.push(o.battles + " battle" + (o.battles === 1 ? "" : "s") + " in the last 24 h" + (o.hot ? ", " + o.hot + " planet" + (o.hot === 1 ? "" : "s") + " under attack" : ""));
    if (o.ownF || o.allyF) bits.push("carriers stationed here: yours " + o.ownF + (o.allyF ? ", allies " + o.allyF : ""));
    panel.append(h("div", "muted small", bits.join(" · ")));
    try { await a.call([[103, a.W.concat([...s.planets.map((p) => a.W.v(1, p.id)), a.W.v(2, 1)])]]); } catch (e) { /* owners from the overlay only */ }
    if (tok !== G.selTok) return;   // another system was clicked while the planets loaded
    const list = h("div", "ships");
    for (const p of s.planets) {
      const rec = a.S.planets.get(p.id), own = ownerOf(sec, p), row = h("div", "ship planetrow"), f = sec && sec.fleets.get(p.id);
      const nm = h("div"), head = h("div", "name", "#" + p.number + " " + TYPE_NAME(p.type) + " ");
      head.append(h("span", "small " + own.cls, "· " + own.label + (rec && rec.owner && !a.S.order.includes(p.id) ? " (" + rec.owner.name + ")" : ""))); nm.append(head);
      const lv = h("div", "lvgrid"); lv.append(levelBar(h, "quality", p.quality, 10, AMBER), levelBar(h, "metal", p.res[1], 9, LEVELS.metal.colour), levelBar(h, "gas", p.res[2], 9, LEVELS.gas.colour), levelBar(h, "crystal", p.res[3], 9, LEVELS.crystal.colour), levelBar(h, "drones", p.res[5], 9, "#7a8aa0")); nm.append(lv);
      nm.append(h("div", "muted small", "planet " + p.id + (p.pads ? " · " + p.pads + " structure pads" : "") + (f && (f.own || f.allied) ? " · carriers here: yours " + f.own + (f.allied ? ", allies " + f.allied : "") : ""))); row.append(nm);
      const act = h("div", "orders"); row.append(act);
      const host = h("div", "attackhost");   // the attack screen opens here (app.js openAttack)
      renderOrders(act, p, own, rec, host);
      list.append(row, host);
    }
    panel.append(list);
  }
  G.select = select;

  // ---- orders from the map: pick an idle carrier, see the trip, send it (203: 6 colonise, 1 attack, 2 relocate) -----------------------
  function renderOrders(box, p, own, rec, host) {
    const a = A(), home = a.S.planets.get(a.S.order[0]);
    const idle = home ? home.carriers.filter((c) => !c.travel && !c.move) : [];
    const orders = own.label === "free" ? [[6, "Colonise"]] : own.label === "yours" ? [[2, "Relocate here"]] : [[1, "Attack"]];
    if (orders[0][0] === 1) {   // an enemy planet: the attack screen (intel, spy drones, odds, carrier) instead of a bare button
      const b = a.h("button", "act", "Attack…"); b.onclick = () => a.openAttack(host, p.id, rec && rec.owner && rec.owner.name ? rec.owner.name : own.label);
      box.append(b); return;
    }
    if (!idle.length) { box.append(a.h("span", "muted small", "no idle carrier")); return; }
    const sel = a.h("select"); for (const c of idle) { const o = a.h("option", "", "#" + c.id + " (" + (c.ships.length ? c.ships.map((x) => x.count + " × " + (a.SHIP[x.type] || x.type)).join(", ") : "no ships") + ")"); o.value = c.id; sel.append(o); }
    const eta = a.h("span", "muted small"); const btns = [];
    const upd = () => a.quoteMove(Number(sel.value), p.id).then((q) => {
      eta.textContent = q ? "trip " + a.fmtDur(q.seconds) + (q.outer_limit != null && orders[0][0] === 6 ? " · planets " + q.outer + "/" + q.outer_limit : "") : "";
      const full = q && orders[0][0] === 6 && q.outer_limit != null && q.outer >= q.outer_limit;   // the server only checks the planet limit when the carrier arrives
      for (const b of btns) { b.disabled = !!full; b.title = full ? "planet limit reached (commander level and the Governance skill raise it)" : ""; }
      if (full) eta.append(" — planet limit reached");
    });
    sel.onchange = upd; upd();
    box.append(sel, eta);
    for (const [order, label] of orders) {
      const btn = a.h("button", "act", label); btns.push(btn);
      btn.onclick = () => a.run(btn, async () => {
        if (order === 1 && !confirm("Attack " + own.label + " planet " + p.id + " with carrier #" + sel.value + "?")) return;
        await a.simpleOrder(label.toLowerCase() + " planet " + p.id + " with carrier #" + sel.value, [[203, a.W.concat([a.W.v(1, Number(sel.value)), a.W.v(2, order), a.W.v(3, p.id), a.W.dbl(5, 1.0)])]]);
        select(G.sel);
      });
      box.append(btn);
    }
  }

  // ---- finder: free planets / pirate bases / other players in the loaded sectors, nearest to the start planet first ----------------------
  let finderTimer = 0;
  function scheduleFinder() { if (!finderTimer) finderTimer = setTimeout(() => { finderTimer = 0; renderFinder(); }, 300); }
  function candidates(kind) {
    const own = ownPlanetSet(), out = [], home = G.home || [G.cx, G.cy];
    for (const sec of G.sectors.values()) for (const s of sec.systems) for (const p of s.planets) {
      if (own.has(p.id) || (sec.x === 0 && sec.y === 0)) continue;   // sector 0_0 holds the three species' home-system templates: not colony targets
      const w = sec.owners.get(p.id), k = w ? (w.kind === 4 ? "pirate" : "player") : "free";
      if (k === kind) out.push({ s, p, w, d: Math.hypot(s.x - home[0], s.y - home[1]) });
    }
    return out;
  }
  function renderFinder() {
    const box = $("galaxyFinder"); if (!box || !G.home) return; const a = A(), h = a.h; box.replaceChildren();
    const head = h("div", "fopts"); head.append(h("h3", "", "Find"));
    for (const [k, label] of [["free", "Free planets"], ["pirate", "Pirate bases"], ["player", "Other players"]]) { const b = h("button", k === G.finder ? "on" : "", label); b.onclick = () => { G.finder = k; renderFinder(); }; head.append(b); }
    box.append(head);
    const list = candidates(G.finder), opts = h("div", "fopts");
    if (G.finder === "free") {
      const sort = h("select"); for (const [v, t] of [["near", "nearest first"], ["quality", "best quality first"], ["metal", "best metal first"], ["gas", "best gas first"], ["crystal", "best crystal first"]]) sort.append(new Option(t, v)); sort.value = G.sort; sort.onchange = () => { G.sort = sort.value; renderFinder(); };
      const minq = h("select"); for (const v of [0, 5, 7, 9]) minq.append(new Option(v ? "quality " + v + "+" : "any quality", String(v))); minq.value = String(G.minQ); minq.onchange = () => { G.minQ = Number(minq.value); renderFinder(); };
      opts.append(sort, minq);
    }
    let rows = list.filter((x) => !G.minQ || G.finder !== "free" || x.p.quality >= G.minQ);
    if (G.finder === "free" && G.sort !== "near") { const key = { quality: (x) => x.p.quality, metal: (x) => x.p.res[1] || 0, gas: (x) => x.p.res[2] || 0, crystal: (x) => x.p.res[3] || 0 }[G.sort]; rows.sort((p, r) => key(r) - key(p) || p.d - r.d); } else rows.sort((p, r) => p.d - r.d);
    opts.append(h("span", "muted small", rows.length.toLocaleString("en") + " in the " + G.sectors.size + " loaded sectors" + (rows.length ? " · showing the first " + Math.min(rows.length, 15) : "")));
    box.append(opts);
    if (!rows.length) { box.append(h("p", "muted small", G.sectors.size < 20 ? "None found yet: pan and zoom the map or use Load wider." : "None in the loaded sectors: pan, zoom out or use Load wider.")); return; }
    for (const x of rows.slice(0, 15)) {
      const row = h("div", "frow"), rec = a.S.planets.get(x.p.id), who = G.finder === "player" ? " · " + (rec && rec.owner && rec.owner.name ? rec.owner.name : "player #" + x.w.owner) : "";
      row.append(h("span", "grow", x.s.name + " #" + x.p.number + " · " + TYPE_NAME(x.p.type) + " · quality " + x.p.quality + " · metal " + (x.p.res[1] || "?") + " gas " + (x.p.res[2] || "?") + " crystal " + (x.p.res[3] || "?") + who), h("span", "muted small", x.d.toFixed(1) + " units away"));
      const b = h("button", "", "Select"); b.onclick = () => focusSystem(x.s, true); row.append(b); box.append(row);
    }
  }
  G.updatePirates = scheduleFinder;
  G.init = init; G.draw = draw; G.resize = resize; G.loadSector = loadSector; G.ownerOf = ownerOf; G.SEC = SEC; G.refreshOverlays = refreshOverlays;
})();
