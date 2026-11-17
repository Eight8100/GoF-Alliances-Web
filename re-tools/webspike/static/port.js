/* "Original look": the planet screen rebuilt as a port of the final-release UI. Everything is positioned in the screenshot's own pixel
   space (stage 2048 x 1536) and the stage is scaled to fit the window. Images are the owner's extracted UI textures (relay /art/ui/, local only);
   the planet is a stand-in until the 3D scene (docs/ART_3D.md) is rendered. Data comes from the same state the plain interface uses. */
(function () {
  "use strict";
  const A = () => window.GoFA.api, W = 2048, H = 1536;
  const art = (n) => (window.GoFAArt && window.GoFAArt.url(n)) || "/art/ui/" + n + ".png";   // imported from the owner's IPA in the browser (art.js), else the local relay
  const fmt = (n) => Math.floor(n).toLocaleString("en-US");
  // Avatars: the commander's own sex (S.female, from the server's stored portrait) and the ADJUTANT's, the opposite sex ("opp": Discord, 2026-11-07).
  // Female pictures: the big aua images commander_<species>_lvl_<rank>_alt, the menu portraits commander_menu_<species>1_<rank> (male: no suffix / no "1").
  const speciesName = () => ({ 2: "vossk", 3: "nivellian" }[A().S.race] || "terran");
  const isFem = (opp) => !!A().S.female !== !!opp;
  const bigPortrait = (rank, opp) => "commander_" + speciesName() + "_lvl_" + rank + (isFem(opp) ? "_alt" : "");
  const menuPortrait = (rank, opp) => "commander_menu_" + speciesName() + (isFem(opp) ? "1" : "") + "_" + rank;
  let stage, scaleBox, ready = false, timer = null, planetLayer = null, clockIcon = null;

  if (!document.getElementById("pNoSelectCss")) { const st = document.createElement("style"); st.id = "pNoSelectCss"; st.textContent = "#port{user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}#port input,#port textarea,#port .psel,#port .psel *{user-select:text;-webkit-user-select:text}"; document.head.append(st); }   // game text is not selectable, only text fields and chat lines
  function el(tag, css, parent) { const e = document.createElement(tag); if (css) Object.assign(e.style, css); (parent || stage).append(e); return e; }
  function image(name, x, y, opts = {}) {   // top-left in stage pixels, natural size (the high tier is 1:1 with the 2048 x 1536 screen)
    const i = el("img", { position: "absolute", left: x + "px", top: y + "px", pointerEvents: opts.click ? "auto" : "none", userSelect: "none" }, opts.parent); i.src = art(name); i.draggable = false;
    if (opts.w) i.style.width = opts.w + "px";
    if (opts.click) { i.style.cursor = "pointer"; i.onclick = opts.click; }
    return i;
  }
  function pressButton(base, cx, cy, w, h, click, title, parent) {   // centred button with normal (_0) and pressed / lit (_1) states
    // the game's tap feedback (Random2.MP4): the lit state shows for MOTION.press ms, then the action runs
    const i = image(base + "_0", cx - w / 2, cy - h / 2, { click: click && ((ev) => { i.src = art(base + "_1"); setTimeout(() => { if (!i.matches(":hover")) i.src = art(base + "_0"); click(ev); }, MOTION.press); }), parent });
    const hi = new Image(); hi.src = art(base + "_1");
    i.title = title || "";
    i.onpointerenter = () => (i.src = art(base + "_1")); i.onpointerleave = () => (i.src = art(base + "_0"));
    return i;
  }
  function text(str, x, y, size, color, extra = {}, parent) {
    return Object.assign(el("div", { position: "absolute", left: x + "px", top: y + "px", font: size + "px Klavika, system-ui, sans-serif", color, whiteSpace: "nowrap", textShadow: "0 0 6px rgba(0,0,0,.8)", ...extra }, parent), { textContent: str });
  }

  /* ---- Shared motion helper: every animated transition of the Original look goes through tween(), with the timings measured on the final-release
     recordings (Random2.MP4 at 30 fps, frame by frame):
       press      a pressed button shows its lit (_1) state ~0.1 s before the action happens (starmap button 27.90 -> 28.03 s, next-mode arrow 39.63 -> 39.70 s)
       cut        views switch with a hard cut (system view -> galaxy map: no fade, no camera move; the map opens at its closest zoom on the start system)
       bar        the galaxy map's bottom bar slides up from its collapsed place (112 px lower) in 0.27 s, ease-out quad (offset 112, 77, 56, 42, 32, 18, 11, 4, 0
                  per 1/30 s); the collapse arrow flips at the end; collapsing / expanding with the arrow uses the same move
       lock       after a mode change both arrows are greyed and ignore taps for 0.4 s (12 frames), the new mode name, icon and legend appear at once
       panel      slides in from the right 0.30 s (sine ease-out), out 0.27 s; dialogs grow from / shrink to the screen centre (0.13 s / 0.20 s): see motionIn
       level      LEVEL n REACHED! (Random.MP4 64.0-68.3 s): box grows 0.33 s ease-out cubic, laurel at 0.30 s (0.13 s), laurel off at 4.1 s, box shrinks 0.13 s: see levelBanner
       page       a panel -> panel switch (mission <-> mission list) pushes two whole panels leftwards, 0.30 s ease-out quad: see pushPage
       rank       top right: portrait <-> rank chevron when a side panel opens / closes, the XP bar moves 98 px, 0.30 s ease-out quad, 0.25 s cross-fade (Random.MP4 58.23 s and 74.2 s): see rankMode
       reward     GET REWARD: lit 0.1 s, then greyed (x .5) with the spinner arc (button_pending, 288 deg/s) while the server answers (0.3 s in the footage), then a hard cut to
                  the next mission while the top-bar credits count up: see rewardButton, creditsTo
     tween(ms, ease, step, done): step(e) gets the eased 0..1 value every frame; returns a cancel function. ---- */

  const EASE = { linear: (t) => t, outQuad: (t) => 1 - (1 - t) * (1 - t), inQuad: (t) => t * t, smooth: (t) => t * t * (3 - 2 * t), outCubic: (t) => 1 - Math.pow(1 - t, 3),
    outSine: (t) => Math.sin(t * Math.PI / 2), outPow: (t) => 1 - Math.pow(1 - t, 1.32) };
  const MOTION = { press: 100, bar: 270, barOffset: 112, lock: 400, panelIn: 300, panelOut: 270, dialogIn: 130, dialogContent: 200, dialogOut: 200, sysIn: 670, sysOut: 330,
    lvGrow: 330, lvLaurelAt: 300, lvLaurel: 130, lvHold: 4100, lvLaurelOut: 70, lvShrink: 130,
    page: 300, busyMin: 300, spin: 288, creditLin: 0.049, creditExp: 0.0909, rank: 300, rankFade: 250 };
  function tween(ms, ease, step, done) {
    const t0 = performance.now(); let live = true, raf = 0;
    const f = (now) => { if (!live) return; const t = Math.max(0, Math.min(1, (now - t0) / ms)); step((EASE[ease] || EASE.linear)(t)); if (t < 1) raf = requestAnimationFrame(f); else { live = false; if (done) done(); } };
    step(0); raf = requestAnimationFrame(f);
    const to = setTimeout(() => { if (live) { live = false; cancelAnimationFrame(raf); step(1); if (done) done(); } }, ms + 80);   // a background tab gets no animation frames: still end in the final state
    return () => { live = false; cancelAnimationFrame(raf); clearTimeout(to); };
  }
  function pressThen(img, base, fn) {   // the game's tap feedback: lit state for MOTION.press ms, then the action
    if (img) img.src = art(base + "_1"); setTimeout(() => { if (img && !img.matches(":hover")) img.src = art(base + "_0"); fn(); }, MOTION.press);
  }

  /* ---- top-right slot of the top bar (Final.PNG, Random_TutorialMission.PNG, Random_Structures.PNG; Random.MP4 58.2-58.6 s and 74.2-74.6 s, frame by frame): the commander's
     portrait with the XP bar under it (bar top 226) while nothing covers the right side (planet, system view, galaxy map, the chat on the left, dialogs: the dialog dims the
     portrait). While a side panel is open (TUTORIAL MISSIONS, STRUCTURES / NEW STRUCTURE, a structure, the system view's PLANET panel: panel({ rank: true })) the portrait is
     replaced by the rank chevron in its ring (button_menu_commander_0, 172 x 132 at 1837,12) and the bar sits 98 px higher (top 128). The change is one move: the bar eases out
     over 0.30 s (quad: 42 / 68 / 80 / 89 / 95 / 99 % per 1/30 s, from 58.23 s) while portrait and chevron cross-fade (~0.25 s); closing the panel plays it backwards at once.
     The bar = xp_bar_bg_* (dark green back) + the fill (the bright middle of progress-bar2, 184 px at 100 %, from x 8) + a mark every 32 px (xp_bar_seperator at 17 + 32 k) + the frame
     xp_bar_corner / xp_bar_mid (cyan outline, glow and the black vignette at both ends), 200 x 28 at x 1822. A level-up moves the fill with a hard cut to the new level's fraction at
     the moment the reward is paid (Random.MP4 64.07 s: 58 % of level 1 -> 33 % of level 2, with the credits count-up and the LEVEL n REACHED! banner). ---- */
  const RK = { want: 0, vb: 0, va: 0, cancel: null, bar: null, fill: null, frac: -1 };
  const XP_BAR_X = 1822, XP_BAR_Y = 226, XP_BAR_UP = 98, XP_BAR_W = 200, XP_FILL_W = 184;
  function xpBar(parent, x0, y0) {
    const root = el("div", { position: "absolute", left: x0 + "px", top: y0 + "px", width: XP_BAR_W + "px", height: "28px", pointerEvents: "none" }, parent);
    image("xp_bar_bg_corner", 0, 0, { parent: root }); strip(root, "xp_bar_bg_mid", 32, 0, XP_BAR_W - 64, 28); image("xp_bar_bg_corner", XP_BAR_W - 32, 0, { parent: root }).style.transform = "scaleX(-1)";
    const clip = el("div", { position: "absolute", left: 0, top: 0, width: XP_BAR_W + "px", height: "28px", clipPath: "polygon(7px 7px, 193px 7px, 193px 12px, 185px 21px, 15px 21px, 7px 12px)" }, root);   // the outline's inside: 45 degree corners at the bottom
    const fill = el("div", { position: "absolute", left: "8px", top: "8px", width: 0, height: "12px", background: "url(" + art("progress-bar2") + ") 50% -8px no-repeat", display: "none" }, clip);   // only the bright band (rows 8-19), not the asset's drop shadow
    for (let k = 0; k < 6; k++) image("xp_bar_seperator", 17 + 32 * k, 0, { parent: root });
    image("xp_bar_corner", 0, 0, { parent: root }); strip(root, "xp_bar_mid", 32, 0, XP_BAR_W - 64, 28); image("xp_bar_corner", XP_BAR_W - 32, 0, { parent: root }).style.transform = "scaleX(-1)";
    RK.bar = root; RK.fill = fill; return root;
  }
  function xpSet(frac) {   // hard cut: the footage shows no run-up of the fill
    if (!RK.fill) return; const f = Math.max(0, Math.min(1, frac || 0)); if (f === RK.frac) return; RK.frac = f;
    const w = Math.round(XP_FILL_W * f); RK.fill.style.display = w > 0 ? "" : "none"; RK.fill.style.width = w + "px"; RK.fill.style.backgroundSize = Math.max(1, w * 5) + "px 28px";   // the window shows the flat middle of the 300 px gradient
  }
  function rankApply() {
    const pp = document.getElementById("pPortrait"), ch = document.getElementById("pRank"); if (!pp || !ch || !RK.bar) return;
    pp.style.opacity = String(1 - RK.va); ch.style.opacity = String(RK.va); pp.style.pointerEvents = RK.want ? "none" : "auto"; ch.style.pointerEvents = RK.want ? "auto" : "none";
    RK.bar.style.top = (XP_BAR_Y - XP_BAR_UP * RK.vb) + "px";
  }
  function rankMode(on) {   // on: a side panel is open
    on = on ? 1 : 0; if (RK.want === on) return; RK.want = on;
    if (RK.cancel) RK.cancel(); const b0 = RK.vb, a0 = RK.va;
    RK.cancel = tween(MOTION.rank, "linear", (t) => { RK.vb = b0 + (on - b0) * EASE.outQuad(t); RK.va = a0 + (on - a0) * Math.min(1, t * MOTION.rank / MOTION.rankFade); rankApply(); });
  }
  const rankSync = () => rankMode(panels.some((p) => p.rank));

  /* ---- panel kit: the game's stretchable box (box-basic_*), measured on IMG_4226 (chat), IMG_4225 (dialog) and the Messages recording frame.
     Box corner = 64 x 64 (grey frame at 9..15, cyan line at 23..24, fill inside); edges are 4 x 64 slices; the serial-number strip (268 x 20) sits
     in the top edge right before the right corner, where the grey frame is left out (frame2 slice). The blue light is basic_glow_blue stretched to the
     inner width (height = width / 2). Header: icon 100 x 100 at x 60, line with a 45 degree rise at x 152, second line from x 193 to 279 before the
     right edge; headY = the header line's y inside the box (148 on full panels, 140 on dialogs). ---- */
  const CYAN = "#01d4fd", FILL = "#002337", SKY = "#35b6e6";
  const panels = [];
  function strip(parent, name, x, y, len, h, tf) {   // a 4 px wide slice stretched to len (h = slice height); tf turns it for the other three sides
    return el("div", { position: "absolute", left: x + "px", top: y + "px", width: len + "px", height: h + "px", background: "url(" + art(name) + ") 0 0 / 100% " + h + "px no-repeat", transformOrigin: "0 0", transform: tf || "none", pointerEvents: "none" }, parent);
  }
  const hline = (parent, x, y, len) => strip(parent, "line-blue_mid", x, y - 100, len, 108);   // the 2 px cyan line (with its soft shadow) at y
  function panel(o) {
    const { x, y, w, h, icon, title, headY = 148, closeDx = 113, closeDy = headY - 47.5, titleX = 246, crossY = [], dim = false, ref = null, onClose } = o;
    let shade = null;
    if (dim) shade = el("div", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px", background: "rgba(2,14,24,.62)", zIndex: 10 + panels.length });
    const root = el("div", { position: "absolute", left: x + "px", top: y + "px", width: w + "px", height: h + "px", zIndex: 10 + panels.length });
    el("div", { position: "absolute", left: "64px", top: "64px", width: (w - 128) + "px", height: (h - 128) + "px", background: FILL }, root);
    strip(root, "box-basic_mid", 64, 0, w - 128 - 268, 64); strip(root, "box-basic_frame2_mid", w - 332, 0, 268, 64);
    strip(root, "box-basic_mid", 64, h, w - 128, 64, "scaleY(-1)");
    strip(root, "box-basic_mid", 0, h - 64, h - 128, 64, "rotate(-90deg)"); strip(root, "box-basic_mid", w, 64, h - 128, 64, "rotate(90deg)");
    [[0, 0, "none"], [w - 64, 0, "scaleX(-1)"], [0, h - 64, "scaleY(-1)"], [w - 64, h - 64, "scale(-1,-1)"]].forEach(([cx, cy, tf]) => (image("box-basic_corner", cx, cy, { parent: root }).style.transform = tf));
    image("box-basic_numbers", w - 332, 2, { parent: root });
    const inner = el("div", { position: "absolute", left: "25px", top: "25px", width: (w - 50) + "px", height: (h - 50) + "px", overflow: "hidden", borderRadius: "14px", pointerEvents: "none" }, root);
    const glow = image("basic_glow_blue", 0, 0, { parent: inner }); glow.style.width = (w - 50) + "px"; glow.style.height = (w - 50) / 2 + "px";
    for (const sy of crossY) {   // the "+" grid: fixed to the screen in x (12 + 250 k) on the big panels, centred on the panel on the structure panel (crossCenter)
      const xs = []; if (o.crossCenter) for (let k = -4; k <= 4; k++) xs.push(x + w / 2 + 250 * k - 10); else for (let sx = 12; sx < W; sx += 250) xs.push(sx);
      for (const sx of xs) if (sx - x > 40 && sx - x < w - 60) image("basic_cross-pattern_blue", sx - x - 25, sy - y - 25, { parent: inner });
    }
    // header
    const hs = o.headSplit || 152;   // x of the first rise in the header line (the fleets screen has a long first part with icons and a switch)
    const h1 = image("list_bg_head1", 37, headY - 46, { parent: root }); if (hs !== 152) h1.style.width = hs - 37 + 20 + "px"; image("list_bg_head2", hs + 41, headY - 46, { parent: root });
    hline(root, 37, headY, hs - 37); image("line-blue_corner_head", hs, headY - 100, { parent: root });
    hline(root, hs + 41, headY, w - 279 - (hs + 41)); image("line-blue_corner_head", w - 279, headY - 100, { parent: root });
    if (icon) image(icon, 60, headY - 100, { parent: root });
    const ttl = text(title || "", titleX, headY - 84, 58, "#fff", { lineHeight: "68px", textShadow: "none" }, root);
    const self = { root, w, h, headY, ref, title: ttl, close() {
      const i = panels.indexOf(self); if (i < 0) return; panels.splice(i, 1); if (shade) shade.remove(); if (onClose) onClose(); rankSync();
      root.style.pointerEvents = "none"; motionOut(root, dim, x, y);   // removes root at the end
    } };
    pressButton("button_small_close", w - closeDx, closeDy, 128, 128, () => self.close(), "Close", root).style.zIndex = 5;   // above content layers added later (they covered it: the X did nothing)
    self.rank = !!o.rank; panels.push(self); setRef(); motionIn(root, dim, x, y); rankSync();
    return self;
  }
  /* ---- panel and dialog motion (Random.MP4, 15 fps, frame by frame): a panel slides in from the right edge in 0.30 s, sine ease-out (remaining offset
     62 / 33 / 14 / 0 % per 1/15 s; the PLANET LIST at 119.0 s) and out to the right in ~0.27 s (the PLANET side panel at 121.7 s); a dialog (dim: the
     information box) grows from the screen centre in ~0.13 s (23 % then 100 %), its content appears one frame later; closing hides the content and the
     dimming at once and shrinks the box to the centre in 0.20 s, remaining scale (1 - t)^1.32 (58 / 24 % per frame, JUMPGATE OPENED at 125.9 s). ---- */
  const fromLeft = (root, x) => { const w = root.offsetWidth || parseFloat(root.style.width) || W; return w < W * 0.8 && x + w / 2 < W / 2; };   // a side panel on the left (chat) comes from the left edge
  function motionIn(root, dialogLike, x, y) {
    if (dialogLike) {
      root.style.transformOrigin = (W / 2 - x) + "px " + (H / 2 - y) + "px"; const n0 = root.children.length; root.dataset.frameN = n0 - 1;   // the close button is the last frame piece
      setTimeout(() => { const kids = [...root.children].slice(n0); kids.forEach((k) => (k.style.visibility = "hidden")); setTimeout(() => kids.forEach((k) => (k.style.visibility = "")), MOTION.dialogContent); }, 0);   // content = what the caller adds after panel()
      tween(MOTION.dialogIn, "outPow", (e) => (root.style.transform = e < 1 ? "scale(" + e + ")" : ""));
    } else { const off = fromLeft(root, x) ? -(x + root.offsetWidth) : W - x; tween(MOTION.panelIn, "outSine", (e) => (root.style.transform = e < 1 ? "translateX(" + off * (1 - e) + "px)" : "")); }
  }
  function motionOut(root, dialogLike, x, y) {
    if (dialogLike) {
      const n = Number(root.dataset.frameN) || 0; [...root.children].forEach((k, i) => { if (i >= n) k.style.visibility = "hidden"; });   // keep the frame pieces, hide the content and the X
      root.style.transformOrigin = (W / 2 - x) + "px " + (H / 2 - y) + "px";
      tween(MOTION.dialogOut, "outPow", (e) => (root.style.transform = "scale(" + (1 - e) + ")"), () => root.remove());
    } else { const off = fromLeft(root, x) ? -(x + root.offsetWidth) : W - x; tween(MOTION.panelOut, "smooth", (e) => (root.style.transform = "translateX(" + off * e + "px)"), () => root.remove()); }
  }
  /* ---- page push (Random.MP4 at 30 fps, frame by frame: MISSION LIST 60.2-60.6 s, the list's forward button 62.3-62.6 s, again at 70.3 s): switching between the mission
     and the mission list moves two whole panels, both LEFTwards (the old one out, the new one in from the right), one screen width apart. The shift s goes 0 -> W in 0.30 s,
     ease-out quad: 21 / 40 / 56 / 69 / 80 / 89 / 95 / 99 % per 1/30 s (1 - (1 - n / 9)^2). pushPage(p, rebuild): the old panel is a frozen copy of p.root, rebuild() redraws p.root. ---- */
  function pushPage(p, rebuild) {
    if (p.pushEnd) p.pushEnd();
    const root = p.root, old = root.cloneNode(true); old.style.transform = ""; old.removeAttribute("id"); old.style.pointerEvents = "none"; old.querySelectorAll("*").forEach((e) => (e.style.pointerEvents = "none")); root.parentNode.insertBefore(old, root);   // the frozen copy takes no taps (its buttons had their own pointer-events)
    rebuild();
    const end = () => { if (p.pushEnd !== end) return; p.pushEnd = null; cancel(); old.remove(); root.style.transform = ""; };
    const cancel = tween(MOTION.page, "outQuad", (e) => { old.style.transform = "translateX(" + (-W * e) + "px)"; root.style.transform = e < 1 ? "translateX(" + (W * (1 - e)) + "px)" : ""; }, () => { p.pushEnd = null; old.remove(); });
    p.pushEnd = end;
  }

  /* ---- reward button (GET REWARD): the confirm button with a GOLD ring (the same sprite, cyan -> gold: red and blue swapped on the cyan pixels), disc white; after a tap it is lit
     for 0.1 s, then greyed (colours x 0.5, measured disc 125 of 249) with the spinner arc (button_pending, 120 px, clockwise 288 deg/s, starting at its own angle) until the server
     has answered (0.3 s in the footage, Random.MP4 63.77-64.05 s); a button that cannot be used is the same grey without the arc (Random_AchievementDetail.PNG). ---- */
  const goldCache = new Map();
  function gold(name) {
    if (!goldCache.has(name)) goldCache.set(name, (async () => {
      const im = new Image(); await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = art(name); }); const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;   // onload, not decode(): decode() never settles in a hidden pane
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height), v = d.data;
      for (let i = 0; i < v.length; i += 4) if (v[i + 2] > v[i] + 30) { const r = v[i]; v[i] = v[i + 2]; v[i + 2] = r; }
      g.putImageData(d, 0, 0); return await new Promise((r) => c.toBlob((b) => r(URL.createObjectURL(b))));
    })().catch(() => art(name)));
    return goldCache.get(name);
  }
  function rewardButton(parent, cx, cy, enabled, click, title) {   // -> { img, label(el), busy(on) }
    if (!document.getElementById("pSpinCss")) { const st = document.createElement("style"); st.id = "pSpinCss"; st.textContent = "@keyframes pspin{to{transform:rotate(360deg)}}"; document.head.append(st); }
    const img = image("button_confirm_0", cx - 78, cy - 78, { parent }); img.style.visibility = "hidden"; img.title = title || ""; img.draggable = false;   // the 156 px sprite: its radial profile (ring at r 44, disc r 28) matches the frames, the small 128 px one does not
    let u0 = null, u1 = null, busy = false, spin = null; const self = { img, label: null };
    Promise.all([gold("button_confirm_0"), gold("button_confirm_1")]).then(([a0, a1]) => { u0 = a0; u1 = a1; img.src = u0; img.style.visibility = ""; });
    const look = () => { img.style.filter = busy || !enabled ? "brightness(.5)" : ""; if (self.label) self.label.style.color = busy || !enabled ? "#808080" : "#fff"; };
    self.busy = (on) => {
      busy = on; look(); if (u0) img.src = u0;
      if (on && !spin) { spin = image("button_pending", cx - 60, cy - 60, { parent }); spin.style.zIndex = 6; spin.style.animation = "pspin " + 360 / MOTION.spin + "s linear infinite"; }
      if (!on && spin) { spin.remove(); spin = null; }
    };
    if (enabled) {
      img.style.cursor = "pointer"; img.style.pointerEvents = "auto";
      img.onpointerenter = () => { if (!busy && u1) img.src = u1; }; img.onpointerleave = () => { if (!busy && u0) img.src = u0; };
      img.onclick = (ev) => { if (busy || !u1) return; img.src = u1; setTimeout(() => { if (!busy && u0 && !img.matches(":hover")) img.src = u0; click(ev, self); }, MOTION.press); };
    }
    look(); return self;
  }
  /* ---- top-bar credits count up (Random.MP4 64.07-65.8 s, 901 -> 1,000 on a 100 credit reward): at first a steady 4.9 per 1/30 s (4.9 % of the reward), then 9.09 % of what is left
     per frame (a long tail: 999 for six frames, then the end). Frame-rate independent below; going down (spending) or the first value is a cut. ---- */
  const cr = { shown: null, target: null, from: 0, raf: 0, hold: false };   // hold: a reward is being collected, the number waits for the cut to the next mission
  function creditsTo(v) {
    const e = document.getElementById("pCredits"); if (!e || v == null || (cr.hold && cr.shown != null)) return;
    if (cr.target === v) return; cr.target = v;
    const show = (x) => { const t = fmt(Math.round(x)); if (e.textContent !== t) e.textContent = t; };
    if (cr.shown == null || v <= cr.shown) { cancelAnimationFrame(cr.raf); cr.raf = 0; cr.shown = v; show(v); return; }
    cr.from = cr.shown; if (cr.raf) return;
    setTimeout(() => { if (cr.target === v && cr.shown < v) { cancelAnimationFrame(cr.raf); cr.raf = 0; cr.shown = v; show(v); } }, 4500);   // a background tab gets no animation frames: still end on the final number
    let last = performance.now();
    const f = (now) => {
      const k = Math.min(10, (now - last) * 0.03), r = cr.target - cr.shown; last = now;
      const lin = MOTION.creditLin * Math.max(1, cr.target - cr.from) * k, exp = r * (1 - Math.pow(1 - MOTION.creditExp, k));
      cr.shown += Math.min(r, lin, exp); if (cr.target - cr.shown < 0.5) cr.shown = cr.target;
      show(cr.shown); cr.raf = cr.shown < cr.target ? requestAnimationFrame(f) : 0;
    };
    cr.raf = requestAnimationFrame(f);
  }
  function scroller(parent, x, y, w, h, barX) {   // scrolling area with the game's scrollbar (black track, orange slider, 20 px wide) at barX
    if (!document.getElementById("pScrollCss")) { const st = document.createElement("style"); st.id = "pScrollCss"; st.textContent = ".pscroll::-webkit-scrollbar{display:none}"; document.head.append(st); }
    const view = el("div", { position: "absolute", left: x + "px", top: y + "px", width: w + "px", height: h + "px", overflowY: "auto", overflowX: "hidden", scrollbarWidth: "none" }, parent); view.className = "pscroll";
    const inner = el("div", { position: "relative", width: w + "px" }, view);
    const track = el("div", { position: "absolute", left: barX + "px", top: y + "px", width: "20px", height: h + "px" }, parent);
    image("scrollbar_bg_corner", 0, 0, { parent: track }); strip(track, "scrollbar_bg_mid", 0, 12, 20, h - 24).style.backgroundSize = "20px 100%";
    image("scrollbar_bg_corner", 0, h - 12, { parent: track }).style.transform = "scaleY(-1)";
    const sl = el("div", { position: "absolute", left: 0, top: 0, width: "20px" }, track);
    image("scrollbar_slider_top", 0, 0, { parent: sl }); const mid = el("div", { position: "absolute", left: 0, top: "8px", width: "20px", background: "url(" + art("scrollbar_slider_mid") + ") 0 0 / 20px 100% no-repeat" }, sl); const bot = image("scrollbar_slider_bottom", 0, 0, { parent: sl });
    const refresh = () => {
      const sh = view.scrollHeight, need = sh > h + 1; sl.style.display = need ? "block" : "none"; track.style.display = need ? "block" : "none"; if (!need) return;
      const len = Math.max(48, Math.round(h * h / sh)), top = Math.round(view.scrollTop / (sh - h) * (h - len));
      sl.style.top = top + "px"; mid.style.height = (len - 16) + "px"; bot.style.top = (len - 8) + "px";
    };
    view.addEventListener("scroll", refresh);
    return { view, inner, refresh, setHeight(px) { inner.style.height = px + "px"; refresh(); } };
  }
  function dialog(title, body) {   // the information dialog of IMG_4225: box 127,168 1792 x 1200, dimmed screen behind
    const p = panel({ x: 127, y: 168, w: 1792, h: 1200, icon: "headline_icon_info", title, headY: 140, closeDx: 97, titleX: 239, crossY: [383, 661, 937, 1215], dim: true, ref: "IMG_4225.PNG" });
    hline(p.root, 36, 162, 1792 - 73);
    text(body, 57, 192, 43, "#fff", { whiteSpace: "pre-wrap", width: "1060px", lineHeight: "49px", textShadow: "none" }, p.root);
    return p;
  }

  /* ---- Messages: full panel 16,16 2016 x 1504 (frame from the owner's recording "Spy Report", 28/06/19). The opened message follows that frame
     (kind icon, kind, subject, date; scrolling body; DELETE bar). No final-release picture of the message LIST exists, so the list repeats the
     same row for every message (an assumption, marked in the README). ---- */
  const KIND = { 1: ["Message", "icon_filter_player_big"], 3: ["Battle Report", "icon_filter_battle_big"], 4: ["Mission Report", "icon_filter_mission_big"], 5: ["Server Message", "icon_filter_server_big"], 6: ["Spy Report", "icon_filter_spyreport_big"] };
  const SPY_NOTE = "Note: To increase the chances and results of successful espionage, we should upgrade our scanning array and/or use more spy drones per attempt! If we spy on a planet or an incoming fleet, an increased number of drones will also result in a higher amount of identified objects (partaking attackers and different places of departure). However, this will also increase the chance of detection!";
  /* ---- battle report (kind 3): texts are the game's own (data/loca_en.tsv INFO_BATTLE_RESULT_*, CAPTION_*); layout from the final-release iPad frames
     in reference/discord-20261107 (2015-10-09_21.33.33: result text, LOCATION + EXPERIENCE POINTS, PARTICIPANTS, BATTLE OUTCOME; 2015-10-09_22.47.04 and
     2015-10-02_09.32.25: the ship table, Before: / After: for the attacker then the defender) at 2 x their pixels. The part between BATTLE OUTCOME and
     the table was never seen: the outcome lines there are built from the game's captions. ---- */
  const BR = { ongoing: "The fleets are gathering again and the battle is continued soon. We can use the break to send reinforcements or retreat our fleets.",
    winS: "We have won the space battle without a ground battle taking place.", winSG: "We have won the space and ground battle.", winSLG: "We have won the space battle but lost the ground battle.",
    winSB: "We have won the space battle and finished planetary bombardment.", lost: "We have lost the space battle.", lostWG: "You've lost the space battle but won the ground battle" };
  const BATTLE_XP = { 1: 6, 2: 30, 3: 54, 4: 270, 5: 18, 6: 90, 8: 36, 9: 180 };   // XP per destroyed ship (statics s9 ship field 14 = ruleset SHIP_XP): the original client summed these over the destroyed enemy ships
  const BR_ROWS = [[1, "Fighter MK I:", "ship-icon_fighterI"], [2, "Fght. MK II:", "ship-icon_fighterII"], [3, "Interceptor MK I:", "ship-icon_interceptorI"], [4, "Incpt. MK II:", "ship-icon_interceptorII"],
    [5, "Bomber MK I:", "ship-icon_bomberI"], [6, "Bmbr. MKII:", "ship-icon_bomberII"], [8, "Freighter MK I:", "ship-icon_freighterI"], [9, "Freigh. MK II:", "ship-icon_freighterII"]];
  const stamp = (t) => { const d = new Date(t * 1000), z = (n) => String(n).padStart(2, "0"), hh = d.getHours();
    return z(d.getDate()) + "/" + z(d.getMonth() + 1) + "/" + z(d.getFullYear() % 100) + ", " + (hh % 12 || 12) + ":" + z(d.getMinutes()) + (hh < 12 ? " am" : " pm"); };
  let msg = null;   // { p, mode: "list" | "open", id, sig, parts: [] }
  function mailRow(parent, m, x, y, w, click) {   // content centre 64 below y, cyan line 112 below y
    const a = A(), k = KIND[m.kind] || ["Message " + m.kind, "icon_filter_inbox_big"];
    const row = el("div", { position: "absolute", left: x + "px", top: y + "px", width: w + "px", height: "114px", cursor: click ? "pointer" : "default" }, parent);
    image("list_bg_bar1", 0, 42, { parent: row }).style.width = "700px";
    image(k[1], 10, 22, { parent: row });
    const T = { lineHeight: "60px", textShadow: "none" };
    text(k[0], 104, 30, 44, "#fff", T, row);
    el("div", { position: "absolute", left: "713px", top: "45px", width: "2px", height: "37px", background: "#cfe6f2" }, row);
    text(a.mailTitle(m), 725, 28, 44, "#fff", { ...T, maxWidth: (w - 725 - 420) + "px", overflow: "hidden", textOverflow: "ellipsis" }, row);
    text(stamp(m.time), 0, 30, 44, "#fff", { ...T, left: "auto", right: "0px" }, row);
    hline(row, 0, 112, w - 17);
    if (click) { row.onclick = click; row.onpointerenter = () => (row.style.background = "rgba(1,212,253,.10)"); row.onpointerleave = () => (row.style.background = "none"); }
    return row;
  }
  function msgClear() { for (const e of msg.parts) e.remove(); msg.parts = []; }
  const MSG_TABS = ["MESSAGES", "REPORTS", "BATTLES"];
  const MSG_FILT = [[["INBOX", "icon_filter_inbox_big", [1]], ["OUTBOX", "icon_filter_outbox_big", []], ["SERVER", "icon_filter_server_big", [5]]], [["REPORTS", "icon_filter_report_big", [2]], ["ESPIONAGE", "icon_filter_spyreport_big", [6]], ["MISSIONS", "icon_filter_mission_big", [4]]], []];
  function msgVisible() {   // the mails the open tab and its ticked filters show (kinds: 1 player mail, 2 / 4 reports, 3 battle, 5 server, 6 spy report; there is no outbox data yet)
    const S = A().S, tab = msg.tab || 0, kinds = tab === 2 ? [3] : MSG_FILT[tab].flatMap((f, k) => (msg.flt[tab][k] ? f[2] : []));
    return [...S.mail.values()].filter((m) => kinds.includes(m.kind)).sort((x, y) => y.time - x.time);
  }
  const msgSig = () => (msg.tab || 0) + "|" + JSON.stringify(msg.flt) + "|" + msgVisible().map((m) => m.id).join(",");
  function msgList() {
    const a = A(), p = msg.p; msg.tab = msg.tab || 0; msg.flt = msg.flt || [[true, true, true], [true, true, true], []]; const tab = msg.tab, all = msgVisible();
    msgClear(); msg.mode = "list"; msg.id = null; msg.sig = msgSig(); p.ref = "Lb_messages_list.PNG"; setRef();
    const ct = el("div", { position: "absolute", left: 0, top: 0, width: p.w + "px", height: p.h + "px" }, p.root); msg.parts.push(ct);
    tabBar(ct, MSG_TABS, tab, (i) => { msg.tab = i; msgList(); }, { faces: [[41, 657], [723, 609], [1366, 600]], top: 173 });
    hline(ct, 35, 286, 1945); const T = { textShadow: "none", lineHeight: "56px" }; let top = 288;
    if (MSG_FILT[tab].length) {
      MSG_FILT[tab].forEach(([lab, icon, kinds], k) => {
        const x0 = [192, 815, 1476][k], im = image(icon, 0, 0, { parent: ct }); im.onload = () => { im.style.left = x0 - im.naturalWidth / 2 + "px"; im.style.top = 344 - im.naturalHeight / 2 + "px"; };
        text(lab, x0 + 94, 316, 44, "#fff", T, ct);
        const cx = [506, 1166, 1823][k], cb = pressButton("checkbox", cx, 344, 128, 128, () => { msg.flt[tab][k] = !msg.flt[tab][k]; msgList(); }, lab, ct); if (!msg.flt[tab][k]) { cb.src = art("checkbox_0"); cb.onpointerenter = cb.onpointerleave = null; cb.style.opacity = ".55"; }
        else { cb.src = art("checkbox_1"); cb.onpointerenter = cb.onpointerleave = null; }
      });
      [674, 1334].forEach((x) => el("div", { position: "absolute", left: x + "px", top: "310px", width: "2px", height: "68px", background: "rgba(120,200,230,.3)" }, ct));
      hline(ct, 35, 408, 1945); top = 410;
    }
    const sc = scroller(ct, 37, top, p.w - 37 - 63, 1338 - top, p.w - 53);
    all.forEach((m, i) => mailRow(sc.inner, m, 0, i * 112, p.w - 37 - 63 - 14, () => msgOpen(m.id)));
    if (!all.length) text("No messages", 32, 34, 42, SKY, { textShadow: "none" }, sc.inner);
    sc.setHeight(Math.max(1, all.length) * 112 + 6);
    // bottom bar: DELETE ALL (of what is shown) and NEW MESSAGE
    hline(ct, 35, 1338, 1945);
    const del = pressButton("button_small_trash", 112, 1407, 128, 128, async () => {
      if (!all.length || !confirm("Delete the " + all.length + " messages shown?")) return;
      for (const m of all) { try { await a.call([[117, a.W.v(1, m.id)]]); a.S.mail.delete(m.id); } catch (e) { a.log(e.message, true); break; } }
      a.S.mailShown = ""; if (msg) msgList();
    }, "Delete all shown", ct); if (!all.length) { del.style.opacity = ".5"; del.style.cursor = "default"; del.onpointerenter = del.onpointerleave = null; }
    text("DELETE ALL", 197, 1379, 44, all.length ? "#fff" : "#8fa3b2", T, ct);
    text("NEW MESSAGE", 0, 1379, 44, "#fff", { ...T, left: "auto", right: "189px" }, ct);
    pressButton("button_small_new-message", 1904, 1407, 128, 128, () => dialog("NEW MESSAGE", "Writing messages has not been rebuilt in the original look yet."), "New message", ct);
  }
  async function msgOpen(id) {
    const a = A(), S = a.S, p = msg.p, m = S.mail.get(id); if (!m) return msgList();
    msgClear(); msg.mode = "open"; msg.id = id; p.ref = "Messages_SpyReport.PNG"; setRef(); msg.retry = 0;
    msg.parts.push(mailRow(p.root, m, 37, 158, p.w - 37 - 48, null));
    const sw = p.w - 37 - 63, sc = scroller(p.root, 37, 275, sw, p.h - 275 - 180, p.w - 53); msg.parts.push(sc.view, sc.view.nextSibling);
    const body = () => {   // positions are the recording frame's, relative to the scrolling area (screen 53,291): section line L, heading L + 57, sub line L + 104, rows from L + 185 every 82
      sc.inner.textContent = ""; let y = 34;
      const T = { textShadow: "none", lineHeight: "52px" }, F = 44;
      const para = (t, color, size) => { const z = size || F, e = text(t, size ? 16 : 32, y, z, color || "#fff", { ...T, whiteSpace: "pre-wrap", width: (size ? 1850 : sw - 80) + "px", lineHeight: (size ? 32 : Math.round(z * 1.14)) + "px" }, sc.inner); y += e.offsetHeight + 30; };
      const lead = (t) => { image("list_bg_bar1", 0, y, { parent: sc.inner }); text(t, 32, y - 4, F, "#fff", T, sc.inner); y += 96; };   // first line on its striped bar
      const section = (t) => { const L = y; image("line-blue_corner_list", 0, L - 100, { parent: sc.inner }); hline(sc.inner, 32, L, sw - 49);
        image("list_bar_head2", 0, L + 56, { parent: sc.inner }).style.width = "818px"; text(t, 15, L + 31, F, "#fff", T, sc.inner);
        hline(sc.inner, 0, L + 104, 818); image("line-blue_corner_subhead", 818, L + 4, { parent: sc.inner }); y = L + 144; };
      const item = (icon, label, value) => { image("list_bg_bar2", 0, y + 19, { parent: sc.inner }).style.width = "818px";
        if (icon) { const im = image(icon, 0, 0, { parent: sc.inner }); im.onload = () => { const k = Math.min(1, 84 / im.naturalHeight); im.style.height = im.naturalHeight * k + "px"; im.style.left = (69 - im.naturalWidth * k / 2) + "px"; im.style.top = (y0 + 41 - im.naturalHeight * k / 2) + "px"; }; }
        const y0 = y; text(label, 155, y + 15, F, SKY, T, sc.inner); text(value, 0, y + 15, F, "#fff", { ...T, left: "auto", right: (sw - 811) + "px" }, sc.inner); y += 82; };
      const endSection = () => { y += 26; };
      const d = S.details.get(id), RI = { 1: "res_icon_metal", 2: "res_icon_gas", 3: "res_icon_crystal" }, fmtN = (n) => fmt(n);
      if (m.from) para("From: " + m.from, SKY);
      if (d && d.variant === 6) {
        // the spied player's copy: details field 4 picks the lead (real client, iPad sweep 2026-11-15): 2 "Someone spied on planet P, and got classified information" (anonymous),
            // 3 "<USER> spied on planet P, and obtained classified information.", 4 "<USER> spied on planet P, but did not obtain any information." (USER = field 2); the own report (1) has none
            const meta = planetMeta(d.planet), pl = meta ? meta.name : String(d.planet), who = d.spier || "Someone";   // the planet's name from field 1 (real client: Bywedi2), not the owner's name
            if (!meta && (msg.retry = (msg.retry || 0) + 1) <= 8) setTimeout(() => { if (msg && msg.mode === "open" && msg.id === id) body(); }, 500);   // it comes with its sector
            if (d.f4 === 2) lead("Someone spied on planet " + pl + ", and got classified information"); else if (d.f4 === 3) lead(who + " spied on planet " + pl + ", and obtained classified information."); else if (d.f4 === 4) lead(who + " spied on planet " + pl + ", but did not obtain any information.");
        y = 167; text("LOCATION:", 32, y, F, SKY, T, sc.inner); text(pl, 431, y, F, "#fff", T, sc.inner);
        y = 300; para(SPY_NOTE, SKY, 30); y = Math.max(y, 417);
        const res = d.resources.filter((r) => r.type < 4), troops = d.resources.filter((r) => r.type === 4);
        section("RESOURCES:"); res.forEach((r) => item(RI[r.type], (a.RES[r.type] || "Type " + r.type) + ":", fmtN(r.amount))); endSection();
        if (troops.length) { section("UNITS:"); troops.forEach((r) => item("marines-icon", "Troops", fmtN(r.amount))); endSection(); }
        if (d.ships.length) { section("CARRIERS AND SHIPS:"); d.ships.forEach((x) => item(null, a.SHIP[x.type] || a.CARRIER[x.type] || "Type " + x.type, fmtN(x.count))); endSection(); }
        if (d.structures.length) { section("PLANETARY STRUCTURES"); d.structures.forEach((x) => item(null, a.STRUCT[x.type] || "Type " + x.type, "LEVEL " + x.level)); endSection(); }
      } else if (d && d.variant === 4) {
        lead((a.MISSION[d.type] || "Mission " + d.type) + " \u00b7 level " + d.level + " \u00b7 at " + d.loc); y += 20;
        section("REWARD:");
        d.resources.filter((r) => r.earned).forEach((r) => item(RI[r.type], (a.RES[r.type] || "Type " + r.type) + ":", fmtN(r.earned)));
        if (d.credits) item("credits_icon", "Credits:", fmtN(d.credits)); if (d.xp) item(null, "Experience points:", fmtN(d.xp)); endSection();
        const left = d.resources.filter((r) => r.left);
        if (left.length) { section("LEFT BEHIND (NO CARGO SPACE):"); left.forEach((r) => item(RI[r.type], (a.RES[r.type] || "Type " + r.type) + ":", fmtN(r.left))); endSection(); }
        if (d.ships.length) { section("SHIPS BACK:"); d.ships.forEach((x) => item(null, a.SHIP[x.type] || "Type " + x.type, fmtN(x.count))); endSection(); }
        if (d.items.length) { section("ITEMS FOUND:"); d.items.forEach((x) => item(null, "Item " + x.type, fmtN(x.count))); endSection(); }
      } else if (d && d.variant === 3) {   // battle report
        const me = Number(S.me.player), meAtt = d.before.att.some((x) => x.player.id === me);
        const sum = (ph, side) => { const o = {}; for (const pt of ph[side]) for (const q of pt.ships) o[q.type] = (o[q.type] || 0) + q.count; return o; };
        const A0 = sum(d.before, "att"), A1 = sum(d.after, "att"), D0 = sum(d.before, "def"), D1 = sum(d.after, "def");
        const res = d.result, ongoing = res === 4, won = meAtt ? res === 1 || res === 3 : res === 2, gr = d.ground ? d.ground.result : 0;   // result and ground result are the attacker's view
        const [E0, E1] = meAtt ? [D0, D1] : [A0, A1];
        const xp = Object.keys(E0).reduce((t, k) => t + Math.max(0, E0[k] - (E1[k] || 0)) * (BATTLE_XP[k] || 0), 0);
        const gWon = d.ground ? (meAtt ? gr === 1 : gr !== 1) : false;   // did we win the ground battle (the result is the attacker's view)
        para(BR[ongoing ? "ongoing" : won ? (d.ground ? (gWon ? "winSG" : "winSLG") : meAtt && d.bombed ? "winSB" : "winS") : (gWon ? "lostWG" : "lost")], "#fff");
        const ly = y, meta = planetMeta(d.planet);
        if (!meta && (msg.retry = (msg.retry || 0) + 1) <= 8) setTimeout(() => { if (msg && msg.mode === "open" && msg.id === id) body(); }, 500);   // the planet's name comes with its sector
        text("LOCATION:", 32, ly + 38, F, SKY, T, sc.inner);
        if (meta) image("button_empty_0", 327 - 78, ly + 52 - 78, { parent: sc.inner });   // the ring around the planet: the grey outer ring of the plain round button, the planet covers its centre (probable match, by eye on 2015-10-09_21.33.33)
        if (meta) { const pic = image("planet_list_" + (PTYPE[meta.type] || "ice"), 0, 0, { parent: sc.inner }); pic.onload = () => { const k = 140 / pic.naturalHeight; pic.style.width = pic.naturalWidth * k + "px"; pic.style.left = 327 - pic.naturalWidth * k / 2 + "px"; pic.style.top = ly + 52 - pic.naturalHeight * k / 2 + "px"; }; }
        text(meta ? meta.name : String(d.planet), 431, ly + 38, F, "#fff", T, sc.inner);
        image("list_bg_bar2", 977, ly + 27, { parent: sc.inner }).style.width = "860px";
        const xi = image("xp_icon", 0, 0, { parent: sc.inner }); xi.onload = () => { xi.style.left = 1030 - xi.naturalWidth / 2 + "px"; xi.style.top = ly + 52 - xi.naturalHeight / 2 + "px"; };
        text("EXPERIENCE POINTS", 1121, ly + 38, F, SKY, T, sc.inner); text(fmt(xp), 0, ly + 38, F, "#38e038", { ...T, left: "auto", right: (sw - 1846) + "px" }, sc.inner);
        y = ly + 126;
        if (ongoing) {   // next battle slot: the next quarter hour after the report (battles run at :00 / :15 / :30 / :45)
          const next = (Math.floor(m.time / 900) + 1) * 900, left = Math.max(0, next - Date.now() / 1000), hh = new Date(next * 1000).getHours();
          text("The battles continues:", 32, y, F, "#fff", T, sc.inner); text(Math.floor(left / 60) + "m " + String(Math.floor(left % 60)).padStart(2, "0") + "s", 480, y, F, "#ffdd33", T, sc.inner);
          image("fleet_icon_gathering", 0, 0, { parent: sc.inner }).style.cssText += ";left:700px;top:" + (y + 4) + "px;height:44px;width:auto";
          text((hh % 12 || 12) + ":" + String(new Date(next * 1000).getMinutes()).padStart(2, "0") + " " + (hh < 12 ? "AM" : "PM"), 760, y, F, "#ffdd33", T, sc.inner); y += 90;
        }
        section("PARTICIPANTS");
        const py = y;   // (the onload callbacks below run later, after y has moved on)
        const uniq = (l) => l.filter((pt, i) => l.findIndex((q) => q.player.id === pt.player.id) === i);   // one row per player: a defender with 3 stationed carriers has 3 entries (allies come with their carriers)
        const PA = uniq(d.before.att), PD = uniq(d.before.def);
        [[PA, 7, "icon_attack", "ATTACKER" + (meAtt ? " (YOU)" : "") + ":"], [PD, 977, "icon_defend", "DEFENDER" + (!meAtt ? " (YOU)" : "") + ":"]].forEach(([list, x0, icon, label]) => {
          image("list_bg_bar2", x0, py + 19, { parent: sc.inner }).style.width = "820px"; const ic = image(icon, 0, 0, { parent: sc.inner }); ic.onload = () => { const k = Math.min(1, 52 / ic.naturalHeight); ic.style.height = ic.naturalHeight * k + "px"; ic.style.left = x0 + 18 + "px"; ic.style.top = py + 60 - ic.naturalHeight * k / 2 + "px"; };
          text(label, x0 + 100, y + 33, F, SKY, T, sc.inner);
          list.forEach((pt, i) => { text(pt.player.name || "?", x0 + 134, y + 126 + i * 120, F, "#fff", T, sc.inner);
            pressButton("button_small_player-profile", x0 + 810 - 64, y + 152 + i * 120, 128, 128, () => dialog("PLAYER DETAIL", "The player profile has not been rebuilt in the original look yet."), "Player detail", sc.inner); });
        });
        y += 130 + Math.max(PA.length, PD.length, 1) * 120 + 10;
        section("BATTLE OUTCOME");
        const lines = [[ongoing ? "THE BATTLE CONTINUES" : won ? "SHIP BATTLE WON" : "SHIP BATTLE LOST"]];
        // line 2: the carriers destroyed per side (details field 2), the client's rule (GOFA_FINDINGS "Battle report carrier lines"; FUN_10063825c case 1)
        const lc = d.lostCarriers || { att: 0, def: 0 }, mine = meAtt ? lc.att : lc.def, theirs = meAtt ? lc.def : lc.att;
        lines.push([!mine && !theirs ? (meAtt ? "ALL CARRIERS ESCAPED" : "NO CARRIERS DESTROYED")
          : !theirs ? (mine === 1 ? "1 CARRIER LOST" : mine + " CARRIER LOST")
          : !mine ? (theirs === 1 ? "1 CARRIER DESTROYED" : theirs + " CARRIER DESTROYED")
          : won ? theirs + " CARRIER DESTROYED, BUT " + mine + " CARRIER LOST" : mine + " CARRIER LOST, BUT " + theirs + " CARRIER DESTROYED"]);
        if (d.ground && !ongoing) lines.push([gWon ? "GROUND BATTLE WON" : "GROUND BATTLE LOST"]);
        if (meAtt && d.bombedSent) lines.push(d.bombed ? ["WE BOMBED", fmt(d.bombed), "marines-icon"] : ["WE BOMBED NO MARINES"]);   // details field 5 {1 n} (CAPTION_BATTLE_RESULT_YOU_BOMBED / NO_MARINES_BOMBED)
        lines.forEach(([t, v, icon]) => { const ry = y; image("list_bg_bar2", 0, y + 19, { parent: sc.inner }).style.width = "1830px"; text(t, 155, y + 15, F, "#fff", T, sc.inner);
          if (v) { text(v, 0, y + 15, F, "#fff", { ...T, left: "auto", right: (sw - 1811) + "px" }, sc.inner);
            const im = image(icon, 0, 0, { parent: sc.inner }); im.onload = () => { const k = Math.min(1, 76 / im.naturalHeight); im.style.height = im.naturalHeight * k + "px"; im.style.left = 77 - im.naturalWidth * k / 2 + "px"; im.style.top = ry + 41 - im.naturalHeight * k / 2 + "px"; }; }
          y += 82; });
        endSection(); y += 10;
        // the fleets: Before: / After: for the attacker, then the defender; the Carrier row counts the side's entries with a carrier (battle v2: one per stationed carrier); Troops = the ground battle's marines
        const X = [481, 862, 1244, 1625], rule = (yy) => el("div", { position: "absolute", left: "0px", top: yy + "px", width: (sw - 60) + "px", height: "2px", background: "rgba(120,200,230,.22)" }, sc.inner);
        ["Before:", "After:", "Before:", "After:"].forEach((t, i) => text(t, X[i], y, F, "#fff", T, sc.inner)); y += 70;
        const fleets = BR_ROWS.map(([t, label, icon]) => [label, icon, A0[t] || 0, A1[t] || 0, D0[t] || 0, D1[t] || 0]);
        const car = (ph, side) => ph[side].filter((q) => q.carrier).length, gm = (ph, side) => d.ground ? ph[side].reduce((s, q) => s + q.marines, 0) : 0;
        fleets.push(["Carrier:", "ship-icon_carrierI", car(d.before, "att"), car(d.after, "att"), car(d.before, "def"), car(d.after, "def")]);   // entries with a carrier, as the client counts them (FUN_1003904b8)
        fleets.push(["Troops:", "marines-icon", d.ground ? gm(d.ground.before, "att") : 0, d.ground ? gm(d.ground.after, "att") : 0, d.ground ? gm(d.ground.before, "def") : 0, d.ground ? gm(d.ground.after, "def") : 0]);
        fleets.forEach(([label, icon, ...v], i) => { const ry = y; rule(y + 4); const im = image(icon, 0, 0, { parent: sc.inner }); im.onload = () => { const k = Math.min(1, 76 / im.naturalHeight); im.style.height = im.naturalHeight * k + "px"; im.style.left = 77 - im.naturalWidth * k / 2 + "px"; im.style.top = ry + 50 - im.naturalHeight * k / 2 + "px"; };
          text(label, 155, y + 22, F, SKY, T, sc.inner); v.forEach((n, k) => text(typeof n === "number" ? fmt(n) : n, X[k], y + 22, F, "#fff", T, sc.inner)); y += 100; });
        rule(y + 4); y += 20;
      } else {   // plain text and kinds without a faithful view yet: the lines of the plain interface
        const tmp = document.createElement("div"); a.mailBody(tmp, m); [...tmp.children].forEach((c) => { if (!/^From: /.test(c.textContent)) para(c.textContent); });
      }
      sc.setHeight(y + 20);
    };
    body();
    // bottom bar: line, DELETE (trash button), BACK to the list
    const bar = el("div", { position: "absolute", left: 0, top: (p.h - 166) + "px", width: p.w + "px", height: "140px" }, p.root); msg.parts.push(bar);
    hline(bar, 37, 0, p.w - 78);
    const del = async () => { try { await a.call([[117, a.W.v(1, id)]]); S.mail.delete(id); S.mailShown = ""; } catch (e) { a.log(e.message, true); } if (msg) msgList(); };
    pressButton("button_small_trash", 112, 64, 128, 128, del, "Delete", bar); text("DELETE", 201, 36, 44, "#fff", { textShadow: "none", lineHeight: "56px" }, bar);
    if (m.kind === 3) {   // battle report: SHOW BATTLE (the 3D replay is not built); BACK to the list is my addition, in the middle
      pressButton("button_small_battle-report", p.w - 113, 64, 128, 128, () => dialog("SHOW BATTLE", "The battle replay (3D) has not been rebuilt in the original look yet."), "Show battle", bar);
      text("SHOW BATTLE", 0, 36, 44, "#fff", { textShadow: "none", lineHeight: "56px", left: "auto", right: "266px" }, bar);
      pressButton("button_small_back", p.w / 2, 64, 128, 128, () => msgList(), "Back to the list", bar); text("BACK", p.w / 2 + 80, 36, 44, "#fff", { textShadow: "none", lineHeight: "56px" }, bar);
    } else {
    pressButton("button_small_back", p.w - 113, 64, 128, 128, () => msgList(), "Back to the list", bar); text("BACK", 0, 36, 44, "#fff", { textShadow: "none", lineHeight: "56px", left: "auto", right: "200px" }, bar); }
    if (!S.details.has(id) && m.kind !== 1) { try { await a.call([[105, a.W.v(1, id)]]); } catch (e) { a.log(e.message, true); } if (msg && msg.mode === "open" && msg.id === id) body(); }
  }
  function openMessages() {
    if (msg) return;
    const p = panel({ x: 16, y: 16, w: 2016, h: 1504, icon: "headline_icon_messages", title: "MESSAGES", crossY: [469, 746, 1021, 1298], crossCenter: true, ref: "Lb_messages_list.PNG", onClose: () => (msg = null) });
    msg = { p, mode: "list", id: null, sig: "", parts: [] }; msgList();
  }
  /* ---- Commander, PROFILE tab: Random_CommanderProfile.PNG (final release, recording frame; the SKILLS / ITEMS / ACHIEVEMENTS tabs are not rebuilt). Box 16,16 like Messages;
     header icon + title, copy-link and close buttons, four tabs, PLAYER INFORMATION (NAME / RANK / SPECIES / LEVEL / ALLIANCE / POSITION with the edit, info and
     alliance buttons), the portrait + XP bar on the right, YOUR POSSESSIONS (CITADELS / OUTER PLANETS / CARRIERS / SHIPS: have / limit, natural limit) and the NATURAL
     LIMIT bars (the level of the next step in yellow, the size of the step: "Level 4 ... +1"). Data: the player's level / rank / limit steps come from the server's read-only
     quote (/debug/quote?commander=1, S.lv); the counts from the planets the page knows. ---- */
  const RANKS = ["Private", "Sergeant", "Lieutenant", "Captain", "Colonel", "General", "Star General"], SPECIES_NAME = { 1: "Terran", 2: "Vossk", 3: "Nivelian" };
  let cmd = null;
  function gbar(parent, x, y, w, frac, fillArt) {   // the green bar (xp_bar_*, 28 px high): dark background, green fill, segment marks
    image("xp_bar_bg_corner", x, y, { parent }); strip(parent, "xp_bar_bg_mid", x + 32, y, w - 64, 28); image("xp_bar_bg_corner", x + w - 32, y, { parent }).style.transform = "scaleX(-1)";
    const fw = Math.max(0, Math.min(w, Math.round(w * frac)));
    if (fw > 26) {   // fill = progress-bar2 (a 300 x 28 green gradient) squeezed to 14 px, with the dark segment marks (xp_bar_seperator) over it
      el("div", { position: "absolute", left: x + 12 + "px", top: y + 7 + "px", width: fw - 24 + "px", height: "14px", background: "url(" + art(fillArt || "progress-bar2") + ") 0 0 / 100% 100% no-repeat", pointerEvents: "none" }, parent);
      for (let sx = x + 36; sx < x + fw - 16; sx += 24) { const m = image("xp_bar_seperator", sx, y + 7, { parent }); m.style.height = "14px"; m.style.width = "3px"; }
    }
  }
  const SKILL_ROWS = [[13, "PLANETARY CONSTRUCTION"], [14, "ENGINEER"], [25, "GOVERNANCE"], [26, "SUPREME COMMAND"], [27, "SQUADRON"], [29, "CARTOGRAPHY"], [24, "SHARPSHOOTER"], [28, "SMUGGLER"], [23, "STORAGE SPECIALIST"], [30, "BARGAINING"], [16, "METAL SPECIALIST"], [17, "GAS SPECIALIST"], [18, "CRYSTAL SPECIALIST"]];   // id -> caption from the client (FUN_1005b13e4: CAPTION_UPPER_SKILL_*, texts from loca); order: the first seven as in frame Random_CommanderSkills2, the rest a guess
  const SKILL_INFO = { 13: "Next skillpoint reduces the construction times and costs of structures and upgrades.", 14: "Next skillpoint reduces the construction times and costs of ships, carriers, troops, spy drones and techs.", 16: "Next skillpoint increases the metal extraction rate.", 17: "Next skillpoint increases the gas extraction rate.", 18: "Next skillpoint increases the crystal extraction rate.", 23: "Next skillpoint increases storage capacity on all planets.", 24: "Next skillpoint increases the accuracy of all ship types.", 25: "Next skillpoint increases our planet limit.", 26: "Next skillpoint increases our carrier limit.", 27: "Next skillpoint increases our ship limit.", 28: "Next skillpoint increases the capacity of our fleets.", 29: "Next skillpoint reduces the travel time of our fleets.", 30: "Next skillpoint increases the exchange rate of our trade centers." };   // loca DESC_INFOSCREEN_SKILLPOINT_* (id -> key as in the client)
  const PORTRAIT_X = 1702, PORTRAIT_Y = 554;   // centre of the big profile portrait, 1:1 pixels (pixel-matched on Random_CommanderProfile: commander_nivellian_lvl_1 at stage 1468,320, mean error 7)
  const SKILL_ICON = { 13: "skills_icon_construction", 14: "skills_icon_production", 16: "sm_icon_metal", 17: "sm_icon_gas", 18: "sm_icon_crystal", 23: "skills_icon_silo", 24: "skills_icon_crossfire", 25: "sm_icon_planet_management", 26: "sm_icon_shipproduction", 27: "sm_icon_ship_management", 28: "sm_icon_logistic", 29: "sm_icon_navigation", 30: "sm_icon_bargaining" };   // the client's glyph table 0x100ae6860 (index = skill id - 13; CRC32 of the names)
  let cmdTab = 0;
  const CMD_REF = ["Random_CommanderProfile.PNG", "Random_CommanderSkills.PNG", "Random_CommanderItems_40.PNG", "Random_CommanderAchievements_49.PNG"], CMD_FACES = [[[41, 456], [522, 409], [962, 394], [1392, 579]], [[51, 435], [511, 425], [962, 394], [1392, 579]], [[51, 435], [522, 404], [955, 412], [1392, 579]], [[51, 435], [522, 404], [962, 394], [1382, 594]]];
  // ACHIEVEMENTS tab (frames Random_CommanderAchievements_49 / 50 / 51): the star achievements in two columns (names from the frames; the page does not read the server's progress yet: stars and bars stay empty)
  const ACH_LIST = [["CREDIT KING", 0, "CREDIT_KING"], ["BIG SPENDER", 1, "BIG_SPENDER"], ["SCIENTIST", 2, "SCIENTIST"], ["ARCHAEOLOGIST", 3, "ARCHAEOLOGIST"], ["RULER OF WORLDS", 4, "RULER_OF_WORLDS"], ["FLEET ADMIRAL", 5, "FLEET_ADMIRAL"], ["REPEATER", 6, "REPEATER"], ["FANATIC", 7, "FANATIC"], ["FAST CLIMBER", 8, "FAST_CLIMBER"], ["CHIEF ENGINEER", 9, "CHIEF_ENGINEER"], ["ARCHITECT", 10, "ARCHITECT"], ["EXTRACTOR", 11, "EXTRACTOR"], ["COMMANDER-IN-CHIEF", 12, "ACHIEV_COMMANDER_IN_CHIEF"], ["KING OF TRADERS", 13, "ACHIEV_KING_OF_TRADERS"], ["SPACE ACE", 14, "ACHIEV_SPACE_ACE"], ["RED BARON", 15, "ACHIEV_RED_BARON"], ["DESTROYER OF WORLDS", 16, "ACHIEV_DESTROYER_OF_WORLDS"], ["RAIDER", 17, "RAIDER"], ["SOCIALIZER", -1, "ACHIEV_SOCIALIZER"], ["VOID HUNTER", 18, "VOID_CRYSTALS"]];   // [name on the tab (frames 49 / 51 / 52), the server's row in /debug/quote?achievements=1 (-1 = none: Socializer has no server row), the loca key of its texts]
  // the client's achievement glyph table 0x100ae6c20 (index = achievement id - 56; one per star id): the glyph of each ACH_LIST row (by its first star id)
  const ACH_ICON = ["creditking", "salesman", "scientist", "archeologist", "planetrush", "fleetadmiral", "active", "fanatic", "commander", "upgrade", "headquarter", "extractor", "carrier_mk3", "freighter_mk2", "fighter_mk2", "interceptor_mk2", "bomber_mk2", "raider", "facebook", "void_hunter"];
  function achGlyph(parent, i, cx, cy) { const g = image("ac_icon_" + ACH_ICON[i], 0, 0, { parent }); g.onload = () => { const k = 1; g.style.height = g.naturalHeight * k + "px"; g.style.left = cx - g.naturalWidth * k / 2 + "px"; g.style.top = cy - g.naturalHeight * k / 2 + "px"; }; return g; }
  const ACH_DESC = {"ARCHAEOLOGIST":["Excavate or acquire 100 artifacts","Excavate or acquire 250 artifacts","Excavate or acquire 1,000 artifacts","Excavate or acquire 5,000 artifacts","Excavate or acquire 10,000 artifacts"],"ARCHITECT":["Upgrade your headquarters to level 4","Upgrade your headquarters to level 8","Upgrade your headquarters to level 12","Upgrade your headquarters to level 16","Upgrade your headquarters to level 20"],"BIG_SPENDER":["Spend 500 credits","Spend 2,500 credits","Spend 12,500 credits","Spend 50,000 credits","Spend 250,000 credits"],"CHIEF_ENGINEER":["Use 10 artifacts","Use 50 artifacts","Use 100 artifacts","Use 250 artifacts","Use 1,000 artifacts"],"ACHIEV_COMMANDER_IN_CHIEF":["","","","",""],"CREDIT_KING":["Earn or acquire 1,000 credits","Earn or acquire 5,000 credits","Earn or acquire 25,000 credits","Earn or acquire 100,000 credits","Earn or acquire 500,000 credits"],"ACHIEV_DESTROYER_OF_WORLDS":["","","","",""],"EXTRACTOR":["Upgrade one or more extractors to level 4","Upgrade one or more extractors to level 8","Upgrade one or more extractors to level 12","Upgrade one or more extractors to level 16","Upgrade one or more extractors to level 20"],"FANATIC":["Log in 3 days in a row","Log in 14 days in a row","Log in 30 days in a row","Log in 90 days in a row","Log in 180 days in a row"],"FAST_CLIMBER":["Reach commander level 25","Reach commander level 50","Reach commander level 100","Reach commander level 200","Reach commander level 300"],"FLEET_ADMIRAL":["Command 3 carriers","Command 5 carriers","Command 10 carriers","Command 15 carriers","Command 30 carriers"],"ACHIEV_KING_OF_TRADERS":["","","","",""],"RAIDER":["Raid 5,000 resources","Raid 25,000 resources","Raid 100,000 resources","Raid 500,000 resources","Raid 2,000,000 resources"],"ACHIEV_RED_BARON":["","","","",""],"REPEATER":["Log in 3 days after registration","Log in 14 days after registration","Log in 30 days after registration","Log in 90 days after registration","Log in 180 days after registration"],"RULER_OF_WORLDS":["Own 3 planets","Own 5 planets","Own 10 planets","Own 15 planets","Own 30 planets"],"SCIENTIST":["Find or acquire 20 blueprints","Find or acquire 50 blueprints","Find or acquire 100 blueprints","Find or acquire 500 blueprints","Find or acquire 1,000 blueprints"],"ACHIEV_SOCIALIZER":["","","","",""],"ACHIEV_SPACE_ACE":["","","","",""],"VOID_CRYSTALS":["Loot 50 void crystals","Loot 250 void crystals","Loot 1,000 void crystals","Loot 5,000 void crystals","Loot 20,000 void crystals"]};   // loca DESC_ACHIEV_<key>_1..5 (one text for the single achievements): the requirement of each star
  // ITEMS tab (frames Random_CommanderItems_40 / 41 / 42): the game's texts (loca HEADER_ / DESC_INVENTORY_ITEM_*) for the 18 item types the server has; the order is the frames' for the first
  // seven (XP boost, red, blue, yellow, freighter blueprint, ... ship extender, group extender) and a guess for the rest
  const ITEMS = { 13: ["DOUBLE XP BOOST", "Doubles the amount of XP gained through your actions.", "SHOP"], 10: ["ARTIFACT - RED", "Red artifacts enable us to build a carrier (red) with increased attack rating and accuracy of bombers and fighters.", "GET MORE"],
    12: ["ARTIFACT - BLUE", "Blue artifacts enable us to build a carrier (blue) with increased defense rating and hitpoints for interceptors and fighters.", "GET MORE"], 11: ["ARTIFACT - YELLOW", "Yellow artifacts enable us to build a carrier (yellow) with increased speed and reduced travel time.", "GET MORE"],
    6: ["BLUEPRINT - FREIGHTER MK II", "Activates the production of freighters MK II in a planet's shipyard.", "SHOP"], 7: ["BLUEPRINT - FIGHTER MK II", "Activates the production of fighters MK II in a planet's shipyard.", "SHOP"],
    8: ["BLUEPRINT - INTERCEPTOR MK II", "Activates the production of interceptors MK II in a planet's shipyard.", "SHOP"], 9: ["BLUEPRINT - BOMBER MK II", "Activates the production of bombers MK II in a planet's shipyard.", "SHOP"],
    4: ["BLUEPRINT - CARRIER MK II", "Activates the production of carriers MK II in a planet's shipyard.", "SHOP"], 5: ["BLUEPRINT - CARRIER MK III", "Activates the production of carriers MK III in a planet's shipyard.", "SHOP"],
    14: ["CREDIT BOOSTER L", "Increases the daily credit bonus by +100% for the duration of one month.", "SHOP"], 15: ["CREDIT BOOSTER XL", "Increases the daily credit bonus by +150% for the duration of three months.", "SHOP"], 16: ["CREDIT BOOSTER XXL", "Increases the daily credit bonus by +200% for the duration of six months.", "SHOP"],
    17: ["VOID CRYSTALS", "Enables the production of Void carriers in a planet's shipyard.", "GET MORE"], 1: ["LIMIT EXTENDER - PLANETS", "Increases our current outer planet limit by 1.", "SHOP"], 2: ["LIMIT EXTENDER  - CARRIERS", "Increases our current carrier limit by 1.", "SHOP"],
    3: ["LIMIT EXTENDER - SHIPS", "Increases our current ship limit by 150.", "SHOP"], 18: ["LIMIT EXTENDER - GROUPS", "Increases the number of carrier groups we can create.", "SHOP"] };
  const CARD_X = 1359, CARD_DY = 107;   // card picture position inside the frame (pixel-matched on Random_CommanderItems_40: cards at stage 1412,414 / 1412,854)
  const ITEM_ORDER = [13, 10, 12, 11, 6, 7, 8, 9, 4, 5, 14, 15, 16, 17, 1, 2, 3, 18], ITEM_ICON = { 13: "headline_icon_commander", 10: "icon_artifact", 11: "icon_artifact", 12: "icon_artifact" };
  function openCommander(tab) {
    if (cmd) return;
    const a = A(), S = a.S; if (tab !== undefined) cmdTab = tab;
    const p = panel({ x: 16, y: 16, w: 2016, h: 1504, icon: "headline_icon_commander", title: "COMMANDER", crossY: [469, 746, 1021, 1298], crossCenter: true, ref: CMD_REF[cmdTab], onClose: () => (cmd = null) });
    cmd = { p }; const ct = el("div", { position: "absolute", left: 0, top: 0, width: p.w + "px", height: p.h + "px" }, p.root); const T = { textShadow: "none", lineHeight: "56px" };
    pressButton("button_small_copy-link", p.w - 257, p.headY - 47.5, 128, 128, () => dialog("COPY LINK", "Copying a link to the profile is not available in the browser version."), "Copy link", p.root).style.zIndex = 5;
    const sub = (x, line, w, label) => { image("list_bar_head2", x, line - 48, { parent: ct }).style.width = w + "px"; text(label, x + 15, line - 73, 44, "#fff", T, ct); hline(ct, x, line, w); image("line-blue_corner_subhead", x + w, line - 100, { parent: ct }); };
    const row = (cy, label, value, color) => { text(label, 69, cy - 28, 44, SKY, T, ct); if (value !== null) text(value, 0, cy - 28, 44, color || "#fff", { ...T, left: "auto", right: (p.w - 826) + "px" }, ct); };
    const L = S.lv, lv = L ? L.level : 1, home = S.planets.get(S.order[0]);
    const xp0 = L ? L.xp_level : 0, xp1 = L ? L.xp_next : 100, xp = L ? L.xp : (S.xp || 0);
    const stepFrac = (st) => (st && st.next_xp != null ? Math.max(0, Math.min(1, (xp - st.from_xp) / Math.max(1, st.next_xp - st.from_xp))) : 1);   // the bars show XP progress to the level of the next step (frame: 60 XP -> Level 2 60 %, Level 4 about 10 %)
    const draw = (tab) => {
      ct.textContent = ""; cmdTab = tab; p.ref = CMD_REF[tab]; setRef();
      tabBar(ct, ["PROFILE", "SKILLS", "ITEMS", "ACHIEVEMENTS"], tab, (i) => draw(i),
        { faces: CMD_FACES[tab], top: 173 });
      hline(ct, 35, 280, 1945);
      const bdg = el("div", { position: "absolute", left: "1389px", top: "163px", width: "40px", height: "40px", borderRadius: "20px", background: "#7fe619", color: "#1c4a00", font: "bold 34px Klavika, system-ui, sans-serif", textAlign: "center", lineHeight: "40px" }, ct); bdg.textContent = "!";
      if (tab === 1) return skillsTab();
      if (tab === 2) return itemsTab();
      if (tab === 3) return achTab();
      sub(37, 388, 820, "PLAYER INFORMATION");
      row(466, "NAME:", S.alias || "?"); row(542, "RANK:", RANKS[(L ? L.rank : 1) - 1] || "Private"); row(619, "SPECIES:", SPECIES_NAME[S.race] || "?"); row(695, "LEVEL:", String(lv));
      const al = L && L.alliance;   // from the commander quote; rank 1 Leader .. 5 Member (captions SERVER_ALLIANCE_*)
      row(770, "ALLIANCE:", al ? al.name : "-"); row(846, "POSITION:", al ? ["Leader", "Senior Officer", "Officer", "Senior Member", "Member"][al.rank - 1] || "Member" : "-");
      pressButton("button_small_edit", 885, 465, 128, 128, () => dialog("NAME", "Changing the commander name has not been rebuilt in the original look yet."), "Change name", ct);
      pressButton("button_small_info", 885, 618, 128, 128, () => dialog(SPECIES_NAME[S.race] || "SPECIES", "The species information has not been rebuilt in the original look yet."), "Species", ct);
      pressButton("button_small_alliances", 885, 770, 128, 128, () => dialog("ALLIANCE", "The alliance screens have not been rebuilt in the original look yet."), "Alliance", ct);
      // portrait: the big 500 x 500 picture commander_<species>_lvl_<rank> from the .aua file (client FUN_1001bf7b4; the male set, like the menu portraits used here) and the XP bar
      const pi = image(bigPortrait(Math.min(6, (L ? L.rank : 1))), 0, 0, { parent: ct }); pi.onload = () => { pi.style.left = PORTRAIT_X - pi.naturalWidth / 2 + "px"; pi.style.top = PORTRAIT_Y - pi.naturalHeight / 2 + "px"; };
      const xv = text(fmt(xp) + "/" + fmt(xp1), 0, 765, 44, "#fff", { ...T, left: "auto", right: (p.w - 1955) + "px" }, ct);
      text("XP:", 0, 765, 44, SKY, { ...T, left: "auto", right: (p.w - 1955 + xv.offsetWidth + 40) + "px" }, ct);   // the label sits just left of the value (short values: as in the frame)
      gbar(ct, 1408, 818, 478, (xp - xp0) / Math.max(1, xp1 - xp0));
      hline(ct, 69, 891, 1913); image("line-blue_corner_list", 37, 791, { parent: ct });
      sub(37, 1016, 820, "YOUR POSSESSIONS"); sub(1000, 1016, 820, "NATURAL LIMIT");
      const lim = L ? L.limits : [{ now: 1 }, { now: 1 }, { now: 50 }], carriers = home ? home.carriers.length : 0;
      const cit = [...S.planets.values()].reduce((n, q) => n + q.structures.filter((x) => x.type === 11 && x.level > 0).length, 0);
      const shipsN = [...S.planets.values()].reduce((n, q) => n + q.ships.reduce((m, x) => m + x.count, 0) + q.carriers.reduce((m, c) => m + c.ships.reduce((k, x) => k + x.count, 0), 0), 0);
      row(1093, "CITADELS:", null); text(String(cit), 0, 1065, 44, "#fff", { ...T, left: "auto", right: (p.w - 969) + "px" }, ct);
      [["OUTER PLANETS:", Math.max(0, S.order.length - 1), lim[0]], ["CARRIERS:", carriers, lim[1]], ["SHIPS:", shipsN, lim[2]]].forEach(([lab, have, l], i) => {
        const cy = 1170 + i * 76; row(cy, lab, null);
        text(fmt(have) + "/" + fmt(l.now), 0, cy - 28, 44, "#fff", { ...T, left: "auto", right: (p.w - 969) + "px" }, ct); text(fmt(l.now), 988, cy - 28, 44, "#fff", T, ct);
        gbar(ct, 1160, cy + 5 - 14, 573, stepFrac(l));
        text(l.next_level ? "Level " + l.next_level : "MAX", 1160, cy - 56, 44, "#f2e418", { ...T, width: "573px", textAlign: "center" }, ct);
        if (l.step) text("+" + l.step, 1748, cy - 28, 44, "#f2e418", T, ct);
      });
    };
    // SKILLS tab: Random_CommanderSkills.PNG / 2 (recording): SKILLPOINT MANAGEMENT, NEXT SKILLPOINT bar, AVAILABLE SKILLPOINTS, then one row per skill (180 px apart):
    // info button, name on the striped bar, glyph ring, level bar with "n/10" above it, the skill-point cost (green), the + button
    function skillsTab() {
      const np = L && L.next_point ? L.next_point : { level: 6, step: 1, from_xp: 0, next_xp: 1400 };
      sub(37, 388, 820, "SKILLPOINT MANAGEMENT");
      text("NEXT SKILLPOINT:", 69, 430, 44, SKY, T, ct); const av = text("AVAILABLE SKILLPOINTS:", 69, 500, 44, SKY, T, ct);
      text(String(S.skillPoints || 0), 69 + av.offsetWidth + 12, 500, 44, "#fff", T, ct);
      gbar(ct, 993, 451, 691, stepFrac(np)); text(np.level ? "Level " + np.level : "MAX", 993, 375, 44, "#f2e418", { ...T, width: "691px", textAlign: "center" }, ct); if (np.step) text("+" + np.step, 1704, 429, 44, "#f2e418", T, ct);
      hline(ct, 69, 592, 1913); image("line-blue_corner_list", 37, 492, { parent: ct });
      const sw = p.w - 37 - 63, sc = scroller(ct, 37, 624, sw, 835, p.w - 53);
      SKILL_ROWS.forEach(([id, name], i) => {
        const cy = 34 + i * 180, cur = S.skills.get(id) || 0, max = 10, I = sc.inner;
        const bar = image("list_bg_bar2", 70, 0, { parent: I }); bar.style.width = "726px"; bar.onload = () => { bar.style.top = cy - bar.naturalHeight / 2 + "px"; };
        pressButton("button_small_info", 58, cy, 128, 128, () => dialog(name, SKILL_INFO[id] || "The description of this skill is not known."), "Information", I);
        text(name + ":", 128, cy - 28, 44, SKY, T, I);
        { const gi = image(SKILL_ICON[id], 0, 0, { parent: I }); gi.onload = () => { gi.style.left = 837 - gi.naturalWidth / 2 + "px"; gi.style.top = cy - gi.naturalHeight / 2 + "px"; }; }   // the glyph with its own ring, 1:1 (pixel-matched on Random_CommanderSkills: centre x 890 on the stage)
        gbar(I, 894, cy + 6, 784, cur / max); text(cur + "/" + max, 894, cy - 43, 44, "#fff", { ...T, width: "784px", textAlign: "center" }, I);
        const cost = text("1", 1706, cy - 18, 44, "#38e038", T, I), plus = pressButton("button_plus", 1841, cy, 156, 156, () => {}, "Learn level " + (cur + 1), I);
        fetch("/debug/quote?planet=" + S.order[0] + "&skill=" + id + "&level=" + (cur + 1) + "&player=" + a.me16()).then((r) => (r.ok ? r.json() : null)).then((q) => {
          if (!q) return; cost.textContent = String(q.cost); const why = cur + 1 > q.max_level ? "Maximum skill level reached." : (S.skillPoints || 0) < q.cost ? "Not enough skill points available." : "";
          if (why) { plus.style.opacity = ".45"; plus.style.cursor = "default"; plus.onpointerenter = plus.onpointerleave = null; plus.title = why; plus.onclick = () => dialog(name, why); }
          else plus.onclick = async () => { try { await a.call([[212, a.W.concat([a.W.v(1, id), a.W.v(2, cur + 1)])]]); await a.refreshAccount(); } catch (e) { dialog(name, "The server refused: " + (e.message || e)); return; } if (cmd && cmd.p === p) setTimeout(() => cmd && cmd.p === p && draw(1), 600); };
        });
      });
      sc.setHeight(SKILL_ROWS.length * 180 + 20);
    }
    // ITEMS tab: no heading under the tabs; one block per item (440 px apart): name on the striped bar, the text, NOT PURCHASED / Amount n, SHOP / GET MORE with its round button, and the framed card (inventory_frame_*) on the right
    function itemsTab() {
      if (!S.inventory) { a.call([[272, new Uint8Array(0)]]).then(() => cmd && cmd.p === p && cmdTab === 2 && draw(2)).catch(() => {}); }
      const sw = p.w - 37 - 63, sc = scroller(ct, 37, 291, sw, 1162, p.w - 53), I = sc.inner;
      ITEM_ORDER.forEach((id, i) => {
        const [name, desc, act] = ITEMS[id], T0 = i * 440, n = S.inventory ? (S.inventory.get(id) || 0) : 0, boost = id >= 13 && id <= 16, ln = T0 + 130;
        image("list_bar_head2", 0, ln - 48, { parent: I }).style.width = "876px"; text(name, 17, ln - 88, 44, "#fff", T, I); hline(I, 0, ln, 876); image("line-blue_corner_subhead", 876, ln - 100, { parent: I });
        text(desc, 17, T0 + 158, 44, SKY, { ...T, whiteSpace: "normal", width: "1150px", lineHeight: "45px" }, I);
        if (boost && !n) text("NOT PURCHASED", 17, T0 + 300, 44, "#f0586a", T, I); else { text("Amount", 17, T0 + 309, 44, SKY, T, I); text(String(n), 175, T0 + 309, 44, "#fff", T, I); }
        text(act, 0, T0 + 318, 44, "#fff", { ...T, left: "auto", right: (sw - 959) + "px" }, I);
        pressButton("button_small_confirm", 1050, T0 + 346, 128, 128, () => itemOffer(id, () => cmd && cmd.p === p && cmdTab === 2 && draw(2)), act, I);
        image("item_card_" + id, CARD_X, T0 + CARD_DY, { parent: I });   // the card picture (380 x 288, .aua file; client table 0x100ae6b60 = item type 1..18), under the frame
        image("inventory_frame_end", 1186, T0 + 87, { parent: I }); strip(I, "inventory_frame_mid", 1246, T0 + 87, 605, 340); image("inventory_frame_end", 1851, T0 + 87, { parent: I }).style.transform = "scaleX(-1)";
        if (ITEM_ICON[id]) { const ic = image(ITEM_ICON[id], 0, 0, { parent: I }); ic.onload = () => { const k = Math.min(1, 70 / ic.naturalHeight); ic.style.height = ic.naturalHeight * k + "px"; ic.style.left = 1261 - ic.naturalWidth * k / 2 + "px"; ic.style.top = T0 + 145 - ic.naturalHeight * k / 2 + "px"; }; }
        image("line-blue_corner_list", 0, T0 + 332, { parent: I }); hline(I, 32, T0 + 432, sw - 49);
      });
      sc.setHeight(ITEM_ORDER.length * 440 + 20);
    }
    // ACHIEVEMENTS tab: VIEW IN GAME CENTER, then 2 columns x 6 rows (236 px apart, columns 978 apart): round icon, name on the striped bar, 5 stars, the progress bar, the forward button
    function achTab() {
      if (!cmd.ach) fetch("/debug/quote?planet=" + S.order[0] + "&achievements=1&player=" + a.me16()).then((r) => (r.ok ? r.json() : null)).then((j) => { cmd && cmd.p === p && (cmd.ach = j || []); if (cmd && cmd.p === p && cmdTab === 3) draw(3); }).catch(() => {});
      const rows = cmd.ach || [], sw = p.w - 37 - 63, sc = scroller(ct, 37, 291, sw, 1162, p.w - 53), I = sc.inner;
      text("VIEW IN GAME CENTER", 0, 80, 44, "#fff", { ...T, left: "auto", right: (sw - 1729) + "px" }, I);
      pressButton("button_gamecenter", 1821, 107, 156, 156, () => dialog("GAME CENTER", "Game Center is not available in the browser version."), "View in Game Center", I);   // the game's Game Center button (pixel-matched on frame 49, 1:1)
      for (let i = 0; i < ACH_LIST.length; i++) {
        const col = i % 2, row = Math.floor(i / 2), X = col * 978, ln = 228 + row * 236, cy = ln + 56, [name, srow, dkey] = ACH_LIST[i], stars = srow >= 0 ? (rows[srow] || []) : [];
        const n = stars.length || ACH_DESC[dkey].filter(Boolean).length, got = stars.filter((x) => x.done).length, nxt = stars.find((x) => !x.done), k = stars.indexOf(nxt), prev = k > 0 ? stars[k - 1].target : 0;
        const frac = !stars.length ? 0 : nxt ? Math.max(0, Math.min(1, (nxt.current - prev) / Math.max(1, nxt.target - prev))) : 1;   // the bar = progress to the next star (all stars: full, green)
        image("line-blue_corner_list", X, ln - 100, { parent: I }); hline(I, X + 32, ln, 903);
        el("div", { position: "absolute", left: X + 28 + "px", top: cy + 23 - 41 + "px", width: "82px", height: "82px", borderRadius: "41px", border: "3px solid #fff", boxSizing: "border-box", background: "#022338" }, I);
        achGlyph(I, i, X + 69, cy + 23);
        image("list_bg_bar2", X + 157, cy - 22, { parent: I }).style.width = "568px"; text(name, X + 167, cy - 28, 44, "#fff", T, I);
        for (let q = 0; q < n; q++) text("★", X + 172 + q * 48, cy + 17, 52, q < got ? "#f2c818" : "rgba(120,150,175,.45)", { ...T, textShadow: "none" }, I);   // the single achievements (frame 51 / 52) have one star and no bar
        if (n > 1) gbar(I, X + 164, cy + 108 - 14, 576, frac, nxt ? "progress-bar1" : "progress-bar2");
        pressButton("button_next", X + 846, cy + 59, 156, 156, () => achDetail(i), name, I);
      }
      sc.setHeight(228 + Math.ceil(ACH_LIST.length / 2) * 236 + 20);
    }
    // detail dialog (frame Random_AchievementDetail.PNG, Random.MP4 at 54 s): the star the player works on (the first not yet collected), its requirement text, the stars, progress "n / target" with its bar,
    // the reward list on the right and GET REWARD (request 282) when the target is reached; "Other players with this achievement: n %" is left out (the server has no such figure)
    function achDetail(i) {
      const [name, srow, dkey] = ACH_LIST[i], stars = srow >= 0 && cmd.ach ? (cmd.ach[srow] || []) : [], n = stars.length || ACH_DESC[dkey].filter(Boolean).length;
      let cur = stars.findIndex((x) => !x.claimed); if (cur < 0) cur = Math.max(0, n - 1);
      const st = stars[cur] || { current: 0, target: 0, done: false, claimed: false, reward: {}, id: 0 }, got = stars.filter((x) => x.done).length;
      const d = panel({ x: 94, y: 272, w: 1857, h: 990, title: name, headY: 145, closeDx: 102, titleX: 232, dim: true, ref: "Random_AchievementDetail.PNG" }), R = d.root, T = { textShadow: "none", lineHeight: "56px" };
      el("div", { position: "absolute", left: "60px", top: "53px", width: "82px", height: "82px", borderRadius: "41px", border: "3px solid #fff", boxSizing: "border-box", background: "#022338" }, R);
      achGlyph(R, i, 101, 94);
      const sub = (x, line, w, label) => { image("list_bar_head2", x, line - 48, { parent: R }).style.width = w + "px"; text(label, x + 15, line - 73, 44, "#fff", T, R); hline(R, x, line, w); image("line-blue_corner_subhead", x + w, line - 100, { parent: R }); };
      sub(27, 268, 657, "REQUIREMENTS"); sub(964, 268, 657, "REWARD");
      el("div", { position: "absolute", left: "929px", top: "178px", width: "2px", height: "605px", background: "rgba(160,220,240,.45)" }, R);
      text((ACH_DESC[dkey][cur] || ACH_DESC[dkey][0] || ""), 36, 308, 44, "#fff", T, R);
      for (let q = 0; q < n; q++) text("★", 28 + q * 48, 381, 52, q < got ? "#f2c818" : "rgba(120,150,175,.45)", { ...T, textShadow: "none" }, R);
      if (st.target) { text(fmt(Math.min(st.current, st.target)) + " / " + fmt(st.target), 32, 444, 44, "#fff", { ...T, width: "857px", textAlign: "center" }, R); gbar(R, 32, 508, 857, Math.max(0, Math.min(1, st.current / st.target)), "progress-bar1"); }
      const rw = st.reward || {}, list = [];
      for (const [t, c] of Object.entries(rw.items || {})) list.push([(ITEMS[t] ? ITEMS[t][0] : "ITEM " + t), null, c]);
      if (rw.credits) list.push(["CREDITS", "credits_icon", rw.credits]);
      for (const [t, c] of Object.entries(rw.ships || {})) list.push([(a.SHIP[t] || "SHIP " + t).toUpperCase(), null, c]);
      if (rw.xp) list.push(["EXPERIENCE POINTS", "xp_icon", rw.xp]);
      list.forEach(([lab, icon, c], r) => {
        const cy = 347 + r * 82, bar = image("list_bg_bar2", 964, 0, { parent: R }); bar.style.width = "846px"; bar.onload = () => { bar.style.top = cy - bar.naturalHeight / 2 + "px"; };
        if (icon) { const im = image(icon, 0, 0, { parent: R }); im.onload = () => { const k = Math.min(1, 70 / im.naturalHeight); im.style.height = im.naturalHeight * k + "px"; im.style.left = 1022 - im.naturalWidth * k / 2 + "px"; im.style.top = cy - im.naturalHeight * k / 2 + "px"; }; }
        text(lab, 1109, cy - 28, 44, SKY, T, R); text(fmt(c), 0, cy - 28, 44, "#f2a516", { ...T, left: "auto", right: (d.w - 1806) + "px" }, R);
      });
      hline(R, 27, 791, 1804);
      const can = st.done && !st.claimed;
      const lab = text("GET REWARD", 0, 850, 44, "#fff", { ...T, left: "auto", right: (d.w - 1623) + "px" }, R);
      const gb = rewardButton(R, 1726, 877, can, async () => {   // gold ring; a button that cannot be used is the same grey (Random_AchievementDetail.PNG), busy = spinner (see rewardButton)
        gb.busy(true); cr.hold = true; const t0 = performance.now();
        try { await a.call([[282, a.W.v(1, st.id)]]); await a.refreshAccount(); } catch (e) { cr.hold = false; gb.busy(false); dialog(name, "The server refused: " + (e.message || e)); return; }
        const left = MOTION.busyMin - (performance.now() - t0); if (left > 0) await new Promise((r) => setTimeout(r, left));
        cr.hold = false; update(); d.close(); if (cmd) { cmd.ach = null; draw(3); }
      }, "Get reward"); gb.label = lab; gb.busy(false);
    }
    draw(cmdTab);
    if (!L) setTimeout(() => { if (cmd && cmd.p === p) { p.close(); openCommander(); } }, 900);   // the level quote has not arrived yet
  }
  /* ---- GAME SETTINGS: Random_GameSettings.PNG (recording frame, Random.MP4 at 2 s; the options button of the top bar). A full-screen overlay over the dimmed planet: the header (gear, title, credits
     bar, close), four round buttons with their labels on the left (PRIVACY POLICY, TERMS OF SERVICE, SUPPORT, CREDITS) and four on the right (VISIT GAME CENTER, INVITE FRIENDS, CONNECT TO [f],
     REPLAY INTRO) and the two white pills YOUR ACCOUNTS / OPTIONS in the middle. The GALAXY ON FIRE ALLIANCES logo is not among the extracted art (left out); every button opens a note. ---- */
  let settings = null;
  function settingsFrame(title, ref, onClose) {   // the shared full-screen frame: header (gear, title, credits bar, close) over the dimmed planet
    const a = A(), T = { textShadow: "none", lineHeight: "56px" };
    const root = el("div", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px", background: "rgba(2,14,24,.8)", zIndex: 10 + panels.length });
    const self = { root, w: W, h: H, ref, close() { const i = panels.indexOf(self); if (i >= 0) panels.splice(i, 1); root.remove(); if (onClose) onClose(); setRef(); } };
    panels.push(self);
    hline(root, 37, 144, 115); image("line-blue_corner_head", 152, 44, { parent: root }); image("list_bg_head1", 37, 98, { parent: root }); image("list_bg_head2", 193, 98, { parent: root });
    hline(root, 193, 144, 1357 - 193); image("line-blue_corner_head", 1357, 44, { parent: root }); hline(root, 1393, 144, 378); image("line-blue_corner_head", 1771, 44, { parent: root });
    image("headline_icon_options", 60, 44, { parent: root }); text(title, 242, 60, 58, "#fff", { ...T, lineHeight: "68px" }, root);
    image("credits_icon", 1457, 46, { parent: root }); text(fmt(a.S.credits || 0), 1613, 62, 44, "#e0b24a", T, root);
    pressButton("button_small_close", 1935, 97, 128, 128, () => self.close(), "Close", root);
    return { root, self, T, a };
  }
  // YOUR ACCOUNTS (frames Random_YourAccounts / 2, Random.MP4 at 11 / 15 s): one block per account (416 px apart): SERVER / STATUS / FILL LEVEL on the heading, the portrait, PLAYER NAME / LEVEL / PLAYER ID,
  // CONNECT (CONNECTED for the current one) and ABANDON GAME. The page knows one account (the one logged in), so there is one block; the server list of the game is not available here.
  let accounts = null;
  function openAccounts() {
    if (accounts) return;
    const f = settingsFrame("YOUR ACCOUNTS", "Random_YourAccounts.PNG", () => (accounts = null)), { root, T, a } = f, S = a.S; accounts = f.self;
    const sc = scroller(root, 37, 154, 1963, 1317, 2000), I = sc.inner, H0 = 205 - 154, L = S.lv;
    const live = S.info && !S.info.sandbox, name = live ? "Game server" : "Sandbox";
    [[name, "OPEN", "-"]].forEach(([server, status, fill], i) => {
      const hy = H0 + i * 416, line = hy + 48, put = (lab, val, x, color) => { const l = text(lab, x, hy - 28, 44, SKY, T, I); const v = text(val, x + l.offsetWidth + 14, hy - 28, 44, color || "#fff", T, I); return x + l.offsetWidth + 14 + v.offsetWidth; };
      let x = put("SERVER:", server, 33); x = put("STATUS:", status, x + 40, "#2fd02f"); x = put("FILL LEVEL:", fill, Math.max(x + 40, 903), "#2fd02f");
      const w = x - 33 + 40; image("list_bar_head2", 0, line - 48, { parent: I }).style.width = w + "px"; hline(I, 0, line, w); image("line-blue_corner_subhead", w, line - 100, { parent: I });
      const pi = image(menuPortrait(Math.min(6, (L ? L.rank : 1))), 0, 0, { parent: I }); pi.onload = () => { pi.style.width = pi.naturalWidth * 1.1 + "px"; pi.style.left = 137 - pi.naturalWidth * 0.55 + "px"; pi.style.top = hy + 191 - pi.naturalHeight * 0.55 + "px"; };
      [["PLAYER NAME:", S.alias || "?"], ["LEVEL:", String(L ? L.level : 1)], ["PLAYER ID:", S.me ? String(S.me.player) : "?"]].forEach(([lab, val], r) => { text(lab, 297, hy + 96 + r * 76, 44, SKY, T, I); text(val, 614, hy + 96 + r * 76, 44, "#fff", T, I); });
      text("CONNECTED", 0, hy + 22, 44, "#2fd02f", { ...T, left: "auto", right: (1963 - 1750) + "px" }, I);
      pressButton("button_confirm", 1842, hy + 50, 156, 156, () => dialog("CONNECT", "This is the account you are playing with."), "Connected", I);
      text("ABANDON GAME", 0, hy + 230, 44, "#fff", { ...T, left: "auto", right: (1963 - 1750) + "px" }, I);
      pressButton("button_kick", 1842, hy + 258, 156, 156, () => dialog("ABANDON GAME", "Abandoning the game is not offered in the browser version."), "Abandon game", I);
      image("line-blue_corner_list", 0, hy + 253, { parent: I }); hline(I, 32, hy + 353, 1880);
    });
    sc.setHeight(H0 + 416 + 20); setRef();
  }
  function openSettings() {
    if (settings) return;
    const f = settingsFrame("GAME SETTINGS", "Random_GameSettings.PNG", () => (settings = null)), { root, T, a } = f; settings = f.self;
    const note = (t, msg) => () => dialog(t, msg + "\nThis is not available in the browser version.");
    [[908, 258, "button_credits", "PRIVACY POLICY", 373, 1789, "button_gamecenter", "VISIT GAME CENTER", 1698, 330, 1370],
     [1078, 140, "button_credits", "TERMS OF SERVICE", 240, 1906, "button_inviteFriends", "INVITE FRIENDS", 1798, 215, 1650],
     [1248, 140, "button_support", "SUPPORT", 256, 1906, "button_facebook_connect", "CONNECT TO", 1813, 215, 1650],
     [1418, 258, "button_credits", "CREDITS", 356, 1789, "button_replay", "REPLAY INTRO", 1682, 330, 1370]].forEach(([cy, lx, lb, ll, llx, rx, rb, rl, rlx, bx, bw]) => {
      const bar = image("list_bg_bar2", bx, 0, { parent: root }); bar.style.width = bw + "px"; bar.style.opacity = ".5"; bar.onload = () => { bar.style.top = cy - bar.naturalHeight / 2 + "px"; };
      pressButton(lb, lx, cy, 156, 156, note(ll, ll), ll, root); text(ll, llx, cy - 28, 44, "#e8f4fa", T, root);
      pressButton(rb, rx, cy, 156, 156, note(rl, rl), rl, root); text(rl, 0, cy - 28, 44, "#e8f4fa", { ...T, left: "auto", right: (W - rlx) + "px" }, root);
    });
    [[1073, "YOUR ACCOUNTS"], [1243, "OPTIONS"]].forEach(([cy, lab]) => {   // the white pills (button_basic_*: 100 x 156 corners, 4 px mid; the mainmenu_button_* pills are the dark blue ones)
      image("button_basic_corner_0", 712, cy - 78, { parent: root }); strip(root, "button_basic_mid_0", 812, cy - 78, 424, 156); image("button_basic_corner_0", 1236, cy - 78, { parent: root }).style.transform = "scaleX(-1)";
      text(lab, 712, cy - 30, 46, "#000", { ...T, width: "624px", textAlign: "center", lineHeight: "60px" }, root);
      el("div", { position: "absolute", left: "744px", top: cy - 40 + "px", width: "560px", height: "80px", cursor: "pointer" }, root).onclick = lab === "YOUR ACCOUNTS" ? openAccounts : lab === "OPTIONS" ? openOptions : note(lab, lab);
    });
    setRef();
  }
  /* ---- TUTORIAL MISSIONS + MISSION LIST (frames Random_MissionList.PNG, Random.MP4 at 60 s: the mission; Random_MissionListAll.PNG at 62 s: the list). The server's tutorial missions (26, read-only
     /debug/quote?tutorial=1: id, done, claimed, reward) with the game's own texts (loca ACHIEVEMENT_<X> name, ACHIEVEMENT_<X>_DESC text, TUTORIAL_<Y> requirement; the id -> key table is in
     GOFA_FINDINGS.md "Tutorial missions"). The panel shows the first mission that is ready, else the first open one; GET REWARD sends request 282; MISSION LIST lists the uncollected ones, ready first.
     Opened by the second portrait under the commander's. ---- */
  const TUT_TEXT = {"2":["Economy start","Greetings, Commander. Before we start our endeavors in the Shroud Nebula, we need a solid economic foundation. While our planets produce resources on their own, the extraction rate is too low for sustained production or construction. To boost this planet's resource production rate, we need to build extractors. Let's start with a metal extractor.","- Build 1 metal extractor"],"3":["Headquarters","Upgrading our buildings improves their basic stats. The only limiting factors are upgrade costs and the level of our headquarters. If our headquarters currently sits at level 3, for example, all other buildings on the respective planet have a maximum level cap of 3. As an added bonus, each additional level of our headquarters reduces the travel time of each proprietary fleet that starts its journey from the respective planet. I'd recommend we level up our headquarters now.","- Upgrade headquarters to level 2"],"4":["Economy boost","With our headquarters upgraded, we can now improve our resource extraction rate. Each structure level also grants higher resource storage capacities. Let's upgrade our metal extractor to level 2 to be able to win and store even more metal.","- Upgrade metal extractor to level 2"],"5":["Shipyard","For our actions in the Shroud Nebula, we need a more specialized space fleet. On the one hand, it has to be capable of exchanging huge amounts of resources between our planets and on the other hand, it also has to be strong enough to prevail in skirmishes and battles. We should build a shipyard to start the production of such a fleet.","- Build 1 shipyard"],"6":["Carrier","With the shipyard constructed, we are now able to assemble our own space fleet. With their ability to hold combat units as well as freighters in their hangar bays, carriers are the backbone of every fleet. Let's construct a MK I carrier.","- Start production of 1 carrier"],"8":["Regular ships","As our carriers don't have any military or cargo capabilities of their own, we need to produce military ships and freighters to enable them to transport resources and carry out attacks.","- Build regular ships"],"10":["Colonize","To increase our reach and economic growth, we need to colonize more planets. But this is only possible by constantly gaining new XP. The higher the commander level, the more planets, carriers and ships we can command.","- Colonize a planet"],"11":["Transfer resources","To make sure that the economy of our planets thrives after their colonization, we should always carry enough resources with us to get things into motion right away. We can do this by advising carriers with freighters to deliver unspent resources to the planets that need them most.","- Transfer resources to a carrier"],"12":["Deliver","Once our other planets are generating enough resources, we should deliver them to our shipyards to produce bigger fleets and additional ships. Let's give it a try and transfer resources from one planet to another. |  | If you choose \"Deliver Cargo\", our carrier returns to where it came from after the delivery of the resources. If we choose \"Relocate Fleet\", our carrier will stay at its destination and await further orders.","- Deliver resources to another planets"],"14":["Battle","Not every planet in the Shroud Nebula will be available for colonization. Sometimes, a little demonstration of power is needed. Let's load enough military units onto our carriers and launch an attack. There is a planet held by another commander in our system, which does not pose a serious threat according to our scans. 30 fighters should be sufficient to gain a victory. |  | Whenever an attacking fleet arrives at a planet, it will wait a certain amount of time to gather with other incoming fleets. All fleets arriving during the gathering time will attack together. |  | To teach the outlaws in this system a lesson, we'd better produce 25 fighters or more.","- Start a battle"],"16":["Scanning Array","We need to know our enemies, and sometimes even our allies. To achieve this, we have to build a scanning array and produce spy drones.","- Build 1 scanning array"],"17":["Spy Drones","With the scanning array in place, we can now produce spy drones. These automated drones can spy on other planets or fleets, reporting back their structures, fleet sizes and resource situations.","- Build spy drones"],"18":["Espionage","We are ready to spy! Let's select a neutral or enemy planet and engage in espionage. With several spy drones working in conjunction, we can increase our chance of success.","- Spy on an enemy planet"],"19":["Barracks","To conquer enemy planets and keep the enemy from conquering ours, we need to train troops for ground combat. Troops are trained in barracks. Let's go ahead and construct them.","- Build 1 barracks"],"20":["Troops","With the barracks in place, we can start training our troops - Keep in mind that we are not ordering the training of each unit individually. Instead, we will be training whole regiments at once. To defeat the outlaws in this system, we'd need at least 20 troops.","- Build troops"],"21":["Transfer troops","Let's transfer a sufficient number of troops to one of our carriers. This undertaking will require freighters as well. To give the outlaws in this system hell, we'd need at least 20 troops.","- Transfer troops onto a carrier"],"23":["Scan for mission","We can gain experience and low amounts of resources by taking on smaller side missions. They are available in every orbit and can be obtained by carrying out quick scans in the scanning array. If we're extremely lucky, we might even find an artifact or a blueprint. Send out the drones!","- Scan for a mission"],"24":["Finish mission","Now that we have successfully scanned for a mission, we should command a carrier to carry it out. If the mission entails the gathering of resources, we'd better put some freighters on that carrier as well. We should also add some military units, just to be on the safe side. |  | As rewards we can expect resources, artifacts, blueprints or credits.","- Complete a mission"],"26":["Laboratory","Techs and blueprints can improve our planetary capabilities, but we need a laboratory first. Let's construct one, preferably on a planet with resource extractors or shipyards.","- Build a laboratory"],"28":["Research tech","With the laboratory in place, we can research techs to improve our planets' economy or enable blueprints to construct better ships in the shipyard. We have to keep in mind, however, that each laboratory can only handle a limited number of techs. Let's start a science project and research a new technology.","- Research a new tech"],"29":["Trade Center","We can increase the storage capacity of our planets by constructing trade centers. As an added bonus, we can use them to exchange one type of resource for another.","- Build a trade center"],"30":["Exchange resources","Depending on a planet's abundances, we can easily end up with too much stock of one resource and not enough of another. In such cases, we can use the trade center to exchange resources. By upgrading it, we can also improve its exchange rate.","- Exchange resources in the trade center"],"37":["Skills","Each level increase gains skill points that can be used to improve the individual talents of the commander. Allocating skill points will bring forth various effects, ranging from improving our military units' accuracy in combat to planetary storage bonuses and production time improvements. Let's use a skillpoint now.","- Increase commander skills"],"42":["Jumpgate","While we are safe within the borders of our own home system, we need to go ahead and reach out to the Shroud Nebula. The jumpgate has been configured and is awaiting activation.","- Open the jumpgate"],"49":["Level up","It is always recommended to level up as a commander. A higher level will not only increase our planet, carrier and ship limits but it will also grant us additional benefits in combat.","- Reach level 20"],"51":["Jump","Now that the jumpgate is open, we can send ships through and colonize additional planets. Each time the jumpgate is used, it needs to cool down a bit before it can be used again. The more we send through, the longer the cooldown will last.","- Send a carrier through the jumpgate"]};
  let tut = null;
  function openTutorial(mode) {
    if (tut) return;
    const a = A(), S = a.S, T = { textShadow: "none", lineHeight: "56px" };
    const p = panel({ rank: true, x: 26, y: 174, w: 1996, h: 1342, icon: "headline_icon_info", title: "TUTORIAL MISSIONS", headY: 141, closeDx: 104, titleX: 232, ref: "Random_MissionList.PNG", onClose: () => (tut = null) });
    tut = { p, mode: mode || "detail", data: null, id: null }; const ct = el("div", { position: "absolute", left: 0, top: 0, width: p.w + "px", height: p.h + "px" }, p.root);
    const fetchData = () => fetch("/debug/quote?planet=" + S.order[0] + "&tutorial=1&player=" + a.me16()).then((r) => (r.ok ? r.json() : [])).catch(() => null);
    const reload = () => fetchData().then((j) => { if (j && tut && tut.p === p) { tut.data = j; draw(); } });
    const uncollected = () => (tut.data || []).filter((x) => !x.claimed).sort((x, y) => (y.done ? 1 : 0) - (x.done ? 1 : 0));
    const sub = (x, line, w, label) => { image("list_bar_head2", x, line - 48, { parent: ct }).style.width = w + "px"; text(label, x + 15, line - 73, 44, "#fff", T, ct); hline(ct, x, line, w); image("line-blue_corner_subhead", x + w, line - 100, { parent: ct }); };
    const draw = () => {
      ct.textContent = ""; const list = uncollected(), cur = list.find((x) => x.id === tut.id) || list[0], listMode = tut.mode === "list";
      p.title.textContent = listMode ? "MISSION LIST" : "TUTORIAL MISSIONS"; p.ref = listMode ? "Random_MissionListAll.PNG" : "Random_MissionList.PNG"; setRef();
      if (!tut.data) return;
      if (listMode) {   // rows 164 px apart: name on the striped bar, "Ready to collect a reward!" (orange) or "Open", the forward button
        const sw = 1944, sc = scroller(ct, 25, 169, sw, 1132, p.w - 41), I = sc.inner;
        list.forEach((m, i) => {
          const cy = 78 + i * 164, tx = TUT_TEXT[m.id] || ["Mission " + m.id, "", ""], bar = image(m.done ? "list_bg_bar1" : "list_bg_bar2", 0, 0, { parent: I }); bar.style.width = "958px"; bar.onload = () => { bar.style.top = cy - bar.naturalHeight / 2 + "px"; };
          text(tx[0], 19, cy - 28, 44, "#fff", T, I); el("div", { position: "absolute", left: "958px", top: cy - 44 + "px", width: "2px", height: "88px", background: "rgba(200,230,245,.5)" }, I);
          if (m.done) text("Ready to collect a reward!", 958, cy - 28, 44, "#f2a516", { ...T, width: "906px", textAlign: "center" }, I); else text("Open", 958, cy - 28, 44, "#fff", { ...T, width: "906px", textAlign: "center" }, I);
          pressButton("button_next", 1811, cy - 6, 156, 156, () => pushPage(p, () => { tut.id = m.id; tut.mode = "detail"; draw(); }), tx[0], I);
          image("line-blue_corner_list", 0, cy + 76 - 100, { parent: I }); hline(I, 32, cy + 76, 1890);
          if (m === cur) { const mk = image("list_highlight_marker", 0, 0, { parent: I }); mk.onload = () => { mk.style.left = "2px"; mk.style.top = cy - mk.naturalHeight / 2 + "px"; }; }
        });
        sc.setHeight(list.length * 164 + 20); return;
      }
      if (!cur) { text("All tutorial missions are done.", 44, 313, 44, "#fff", T, ct); return; }
      const tx = TUT_TEXT[cur.id] || ["Mission " + cur.id, "", ""], rw = cur.reward || {};
      sub(25, 266, 886, tx[0]);
      const dt = text(tx[1].replace(/\s*\|\s*/g, "\n"), 44, 312, 44, "#fff", { ...T, whiteSpace: "pre-line", width: "1330px", lineHeight: "44px" }, ct), reqY = Math.max(597, 312 + dt.offsetHeight + 62);   // long texts push the rest down (the frame's 5-line text: 597)
      const rb = image("list_bg_bar2", 25, 0, { parent: ct }); rb.style.width = "850px"; rb.onload = () => { rb.style.top = reqY - rb.naturalHeight / 2 + "px"; };
      text("REQUIREMENTS:", 59, reqY - 28, 44, SKY, T, ct); text(tx[2], 404, reqY - 28, 44, "#2fd02f", T, ct);
      sub(25, reqY + 169, 886, "REWARD:");
      const rows = []; if (rw.credits) rows.push(["CREDITS", "credits_icon", rw.credits]); if (rw.xp) rows.push(["EXPERIENCE POINTS", "xp_icon", rw.xp * (cur.xp_mult || 1)]);   // what the server pays: a new commander owns the double-XP item
      for (const [t, n] of Object.entries(rw.res || {})) rows.push([(a.RES[t] || "Resource " + t).toUpperCase(), { 1: "res_icon_metal", 2: "res_icon_gas", 3: "res_icon_crystal" }[t] || null, n]);
      for (const [t, n] of Object.entries(rw.ships || {})) rows.push([(a.SHIP[t] || "Ship " + t).toUpperCase(), null, n]);
      rows.forEach(([lab, icon, n], i) => {
        const gap = Math.min(80, Math.max(56, (1090 - (reqY + 249)) / Math.max(1, rows.length - 1))), cy = reqY + 249 + i * gap, bar = image("list_bg_bar2", 25, 0, { parent: ct }); bar.style.width = "850px"; bar.onload = () => { bar.style.top = cy - bar.naturalHeight / 2 + "px"; };
        if (icon) { const im = image(icon, 0, 0, { parent: ct }); im.onload = () => { const k = Math.min(1, 70 / im.naturalHeight); im.style.height = im.naturalHeight * k + "px"; im.style.left = 81 - im.naturalWidth * k / 2 + "px"; im.style.top = cy - im.naturalHeight * k / 2 + "px"; }; }
        text(lab, 171, cy - 28, 44, SKY, T, ct); text(fmt(n), 593, cy - 28, 44, "#f2a516", T, ct);
      });
      const pi = image(bigPortrait(1, true), 0, 0, { parent: ct }); pi.onload = () => { const k = 0.85; pi.style.width = pi.naturalWidth * k + "px"; pi.style.left = 1679 - pi.naturalWidth * k / 2 + "px"; pi.style.top = 430 - pi.naturalHeight * k / 2 + "px"; };   // the 500 x 500 commander portrait (aua art found by the Opus session); the scale 0.85 is by eye against the frame
      hline(ct, 25, 1141, 1944);
      pressButton("button_small_list", 131, 1229, 128, 128, () => pushPage(p, () => { tut.mode = "list"; draw(); }), "Mission list", ct); text("MISSION LIST", 232, 1201, 44, "#fff", T, ct);
      if (list.some((x) => x.done)) { const b = el("div", { position: "absolute", left: "70px", top: "1166px", width: "40px", height: "40px", borderRadius: "20px", background: "#7fe619", color: "#1c4a00", font: "bold 34px Klavika, system-ui, sans-serif", textAlign: "center", lineHeight: "40px" }, ct); b.textContent = "!"; }
      if (!cur.done) {   // an open mission (frame Random_TutorialMission.PNG, 66 s): the HINTS checkbox in the middle and START (it closes the panel: the in-world hints are not built)
        image(tut.hints === false ? "checkbox_0" : "checkbox_1", 995, 1165, { parent: ct, click: () => { tut.hints = tut.hints === false; draw(); } }).title = "Hints";
        text("\u2193", 1124, 1198, 52, "#2fc8f0", { ...T, textShadow: "none" }, ct); text("HINTS", 1172, 1201, 44, "#fff", T, ct);
        text("START", 0, 1201, 44, "#fff", { ...T, left: "auto", right: (p.w - 1773) + "px" }, ct);
        pressButton("button_confirm", 1861, 1229, 156, 156, () => p.close(), "Start", ct);   // the 156 px confirm sprite, ring and disc as in Random_TutorialMission.PNG
      } else {
        const lab = text("GET REWARD", 0, 1201, 44, "#fff", { ...T, left: "auto", right: (p.w - 1761) + "px" }, ct);
        const rb = rewardButton(ct, 1861, 1229, true, async () => {   // Random.MP4 63.7-64.1 s: greyed with the spinner while the server answers, then a hard cut to the next mission and the credits count up
          rb.busy(true); cr.hold = true; const t0 = performance.now(); let j = null;
          try { await a.call([[282, a.W.v(1, cur.id)]]); await a.refreshAccount(); j = await fetchData(); } catch (e) { cr.hold = false; rb.busy(false); dialog("TUTORIAL MISSIONS", "The server refused: " + (e.message || e)); return; }
          const left = MOTION.busyMin - (performance.now() - t0); if (left > 0) await new Promise((r) => setTimeout(r, left));
          cr.hold = false; if (!(tut && tut.p === p)) return update(); tut.id = null; if (j) tut.data = j; update(); draw();
        }, "Get reward"); rb.label = lab;
      }
    };
    reload();
  }
  /* ---- "LEVEL n REACHED!" banner (frame Random_TutorialMission.PNG, 66 s; motion from Random.MP4 64.0-68.3 s at 30 fps): a box with the text and the rank chevron
     (level-up_icon) across the screen centre, the laurel burst (aua_95aa9311, 1179 px at its own size, centred ~(1024, 754)) behind it. Only the box frame moves:
     it grows from its centre (width 0 -> 1, height .5 -> 1) in 0.33 s ease-out cubic while the text and chevron stand at full size from the first frame; the
     laurel fades in growing from .7 at 0.30 s (0.13 s); at ~4.1 s the laurel goes (2 frames), then the box shrinks back to its centre in 0.13 s (ease-out quad)
     and everything goes with it. Triggered from update() when S.lv.level goes up. ---- */
  let lastLevel = 0; const unpremulCache = new Map();
  function unpremul(name) {   // the .aua images keep premultiplied colour (laurel glow 38,143,145 at alpha 208): divide it out once so the normal blend equals the game's ONE, 1-SRC_ALPHA
    if (!unpremulCache.has(name)) unpremulCache.set(name, (async () => {
      const im = new Image(); await new Promise((ok, no) => { im.onload = ok; im.onerror = no; im.src = art(name); });   // onload, not decode(): decode() never settles in a hidden pane
      const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height), v = d.data;
      for (let i = 0; i < v.length; i += 4) { const a = v[i + 3]; if (a && a < 255) { const k = 255 / a; v[i] = Math.min(255, v[i] * k); v[i + 1] = Math.min(255, v[i + 1] * k); v[i + 2] = Math.min(255, v[i + 2] * k); } }
      g.putImageData(d, 0, 0); return await new Promise((r) => c.toBlob((b) => r(URL.createObjectURL(b))));
    })().catch(() => art(name)));
    return unpremulCache.get(name);
  }
  function levelBanner(level, hold) {   // hold: stay up (checking with R)
    const w = 1317, h = 234, M = MOTION, root = el("div", { position: "absolute", left: "367px", top: "655px", width: w + "px", height: h + "px", zIndex: 900, pointerEvents: "none" });
    const laurel = image("aua_95aa9311", 1024 - 589 - 367, 754 - 589 - 655, { parent: root }); laurel.style.opacity = 0; unpremul("aua_95aa9311").then((u) => (laurel.src = u));
    const box = el("div", { position: "absolute", left: 0, top: 0, width: w + "px", height: h + "px", transformOrigin: "50% 50%", transform: "scale(0, .5)" }, root);
    el("div", { position: "absolute", left: "64px", top: "64px", width: (w - 128) + "px", height: (h - 128) + "px", background: FILL }, box);
    strip(box, "box-basic_mid", 64, 0, w - 128, 64); strip(box, "box-basic_mid", 64, h, w - 128, 64, "scaleY(-1)");
    strip(box, "box-basic_mid", 0, h - 64, h - 128, 64, "rotate(-90deg)"); strip(box, "box-basic_mid", w, 64, h - 128, 64, "rotate(90deg)");
    [[0, 0, "none"], [w - 64, 0, "scaleX(-1)"], [0, h - 64, "scaleY(-1)"], [w - 64, h - 64, "scale(-1,-1)"]].forEach(([cx, cy, tf]) => (image("box-basic_corner", cx, cy, { parent: box }).style.transform = tf));
    const inner = el("div", { position: "absolute", left: "25px", top: "25px", width: (w - 50) + "px", height: (h - 50) + "px", overflow: "hidden", borderRadius: "14px" }, box);
    const glow = image("basic_glow_blue", 0, 0, { parent: inner }); glow.style.width = (w - 50) + "px"; glow.style.height = (w - 50) / 2 + "px";
    text("LEVEL " + level + " REACHED!", 329, 84, 58, "#fff", { lineHeight: "68px", textShadow: "none" }, root);
    image("level-up_icon", 835, 23, { parent: root });
    const sc = (e) => (box.style.transform = "scale(" + e + "," + (0.5 + 0.5 * e) + ")");
    tween(M.lvGrow, "outCubic", sc);
    setTimeout(() => tween(M.lvLaurel, "outQuad", (e) => { laurel.style.opacity = e; laurel.style.transform = "scale(" + (0.7 + 0.3 * e) + ")"; }), M.lvLaurelAt);
    if (hold) return root;
    setTimeout(() => tween(M.lvLaurelOut, "linear", (e) => (laurel.style.opacity = 1 - e)), M.lvHold);
    setTimeout(() => tween(M.lvShrink, "outQuad", (e) => sc(1 - e), () => root.remove()), M.lvHold + M.lvLaurelOut);
    return root;
  }
  /* ---- LEADERBOARDS (frame Lb_rec_171.PNG, Leaderboards.MP4 at 171 s; the alliance boards at 195 s). Header, the three column heads, the player's own row (collapse ring), the list (172 px rows: rank, name,
     points, forward ring), the footer with the two arrows, the board name and the page dots, and the info button. Data: read-only /debug/quote?leaderboard=1&type=N (1 players, 2 alliance size, 4 alliance
     level, 3 alliance warfare: the server's boards, ranking() / alliance_ranking()). The arrows cycle the boards; the game's 18 dots are 4 here. The texts are the game's (loca). ---- */
  const LB_INFO = {"1":"\"Commander Progress\" is calculated on the basis of the age of an account in relation to the amount of XP gained in that time.\n\nThe higher a commander's rank, the more efficiently he or she has played so far.","2":"\"Alliance Size\" is calculated on the basis of the collective amount of planets held by the members of the respective alliances.\n\nPlanets located in the home systems of the players are ignored in this calculation.","3":"\"Alliance Warfare\" is calculated on the basis of the collective amount of XP gained through battles by the members of the respective alliances.\n\nThe more agressive an alliance plays, the higher their rank will be here.","4":"\"Alliance Level\" is calculated on the basis of the ratio between the cumulative amount of XP of an alliance and the actual amount of members of that alliance.\n\nThe exact formula is a well-kept secret, though."};
  const LB_BOARDS = [[1, "POINTS", "PLAYER", "POINTS"], [2, "ALLIANCE SIZE", "ALLIANCE", "PLANETS"], [4, "ALLIANCE LEVEL", "ALLIANCE", "LEVEL"], [3, "ALLIANCE WARFARE", "ALLIANCE", "POINTS"]];   // [type, footer, column 2, column 3]
  let lb = null;
  function openLeaderboards(idx) {
    if (lb) return;
    const a = A(), S = a.S, T = { textShadow: "none", lineHeight: "56px" };
    const p = panel({ x: 16, y: 16, w: 2016, h: 1504, icon: "headline_icon_leaderboards", title: "LEADERBOARDS", crossY: [469, 746, 1021, 1298], crossCenter: true, ref: "Lb_rec_171.PNG", onClose: () => (lb = null) });
    lb = { p, i: idx || 0, cache: {} }; const ct = el("div", { position: "absolute", left: 0, top: 0, width: p.w + "px", height: p.h + "px" }, p.root);
    const load = (t) => fetch("/debug/quote?planet=" + S.order[0] + "&leaderboard=1&type=" + t + "&player=" + a.me16()).then((r) => (r.ok ? r.json() : { rows: [], own: null })).then((j) => { if (lb && lb.p === p) { lb.cache[t] = j; draw(); } }).catch(() => {});
    const seg = (x, w, label, corner) => { image("list_bar_head2", x, 208, { parent: ct }).style.width = w + "px"; text(label, x, 205, 44, "#fff", { ...T, width: w - 30 + "px", textAlign: "center" }, ct); hline(ct, x, 256, w); if (corner) image("line-blue_corner_subhead", x + w - 20, 156, { parent: ct }); };
    const draw = () => {
      ct.textContent = ""; const [type, foot, c2, c3] = LB_BOARDS[lb.i], data = lb.cache[type];
      seg(35, 266, "RANK", true); seg(288, 879, c2, true); seg(1148, 828, c3, false);
      const own = data && data.own, rowTexts = (rank, name, score, cy, parent, dx) => {
        text(String(rank), 0, cy - 28, 44, "#fff", { ...T, left: "auto", right: (p.w - 255 - dx) + "px" }, parent); text(name, 399 - dx, cy - 28, 44, "#fff", { ...T, maxWidth: "700px", overflow: "hidden" }, parent); text(fmt(score), 1290 - dx, cy - 28, 44, "#fff", T, parent);
        [286, 1146].forEach((x) => el("div", { position: "absolute", left: x - dx + "px", top: cy - 36 + "px", width: "2px", height: "72px", background: "rgba(200,230,245,.5)" }, parent)); };
      const ob = image("list_bg_bar2", 35, 0, { parent: ct }); ob.style.width = "830px"; ob.style.opacity = ".6"; ob.onload = () => { ob.style.top = 325 - ob.naturalHeight / 2 + "px"; };
      if (own) rowTexts(own.rank, own.name, own.score, 325, ct, 0); else if (data) text("You have not yet been ranked.", 399, 297, 44, "#fff", T, ct);
      pressButton("button_arrow-down", 1902, 325, 128, 128, () => dialog(foot, "The player's own place stays at the top of the list."), "Your place", ct);
      hline(ct, 35, 385, 1890); image("line-blue_corner_list", 35, 316, { parent: ct }); hline(ct, 67, 416, 1858);
      const rows = data ? data.rows : [], sc = scroller(ct, 37, 417, 1916, 859, 1955), I = sc.inner;
      rows.forEach((r, i) => {
        const cy = 88 + i * 172, bar = image("list_bg_bar2", 0, 0, { parent: I }); bar.style.width = "830px"; bar.style.opacity = ".55"; bar.onload = () => { bar.style.top = cy - bar.naturalHeight / 2 + "px"; };
        rowTexts(r.rank, r.name, r.score, cy, I, 37);
        pressButton("button_next", 1826, cy, 156, 156, () => dialog(r.name, (type === 1 ? "The player profile" : "The alliance profile") + " has not been rebuilt in the original look yet.\n" + c3 + ": " + fmt(r.score)), r.name, I);
        image("line-blue_corner_list", 0, cy + 82 - 100, { parent: I }); hline(I, 32, cy + 82, 1880);
      });
      if (!rows.length && data) text("Nobody is listed yet.", 40, 60, 44, SKY, T, I);
      sc.setHeight(Math.max(1, rows.length) * 172 + 20);
      hline(ct, 35, 1279, 1918);
      el("div", { position: "absolute", left: "557px", top: "1327px", width: "953px", height: "86px", background: "rgba(0,10,20,.72)" }, ct);
      text(foot, 557, 1342, 44, "#fff", { ...T, width: "953px", textAlign: "center" }, ct);
      el("div", { position: "absolute", left: "596px", top: "1342px", width: "70px", height: "56px", borderRadius: "28px", border: "3px solid #35b6e6", background: "#02202f" }, ct); const ic = image("headline_icon_commander", 0, 0, { parent: ct }); ic.onload = () => { ic.style.width = "46px"; ic.style.left = "608px"; ic.style.top = "1347px"; };
      pressButton("button_back", 487, 1370, 156, 156, () => { lb.i = (lb.i + LB_BOARDS.length - 1) % LB_BOARDS.length; show(); }, "Previous board", ct);
      pressButton("button_next", 1525, 1370, 156, 156, () => { lb.i = (lb.i + 1) % LB_BOARDS.length; show(); }, "Next board", ct);
      pressButton("button_small_info", 1902, 1370, 128, 128, () => dialog(foot, LB_INFO[type]), "Information", ct);
      LB_BOARDS.forEach((b, k) => el("div", { position: "absolute", left: 1011 - LB_BOARDS.length * 16 + k * 32 + "px", top: "1426px", width: "14px", height: "14px", borderRadius: "7px", background: k === lb.i ? "#fff" : "#4d7a96" }, ct));
    };
    const show = () => { const t = LB_BOARDS[lb.i][0]; draw(); if (!lb.cache[t]) load(t); };
    show();
  }
  /* ---- ALLIANCE (the top bar's squad button). References: Lb_rec_123.PNG (SEARCH tab, tabs SEARCH / CREATE / OFFERS, the ! on OFFERS) and Lb_rec_135 / 150.PNG (the ALLIANCE PROFILE of another alliance: Alliance
     information NAME / TAG / MEMBER COUNT / LEADER / STANDING, DESCRIPTION, REPORT and CANCEL APPLICATION at the bottom). Without an alliance the tabs are SEARCH / CREATE / OFFERS (invitations received, own
     applications); in an alliance they are ALLIANCE / MEMBERS / OFFERS (my own guess: no frame of them). Data: read-only /debug/quote ?alliances=1&q= (search), ?alliance=1 (my bundle: mine, invites, applied,
     create) and ?alliance=1&id=N (a profile); actions: 215 create {name, tag, desc}, 232 apply {id}, 226 cancel an application {alliance id} / kick {member id}, 305 answer an offer {id, 1 / 0}, 306 cancel an
     invitation {player id}, 218 rank {player id, rank 1-5}, 228 edit {2 desc}, 230 leave, 227 delete. Rank badges = alliance_ranks_*. ---- */
  let squad = null;
  const RANK_ART = { 1: "leader", 2: "senior-officer", 3: "officer", 4: "senior-member", 5: "member" }, RANK_NAME = { 1: "LEADER", 2: "SENIOR OFFICER", 3: "OFFICER", 4: "SENIOR MEMBER", 5: "MEMBER" };
  const alq = (qs) => fetch("/debug/quote?planet=" + A().S.order[0] + "&" + qs + "&player=" + A().me16()).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const bangBadge = (parent, x, y) => { const b = el("div", { position: "absolute", left: x + "px", top: y + "px", width: "40px", height: "40px", borderRadius: "20px", background: "#7fe619", color: "#1c4a00", font: "bold 34px Klavika, system-ui, sans-serif", textAlign: "center", lineHeight: "40px" }, parent); b.textContent = "!"; return b; };
  function confirmBox(title, body, yes) {   // the information dialog with a confirm button
    const d = dialog(title, body); pressButton("button_confirm", 1660, 1085, 156, 156, async () => { d.close(); await yes(); }, "Confirm", d.root); return d;
  }
  function subhead(B, x, line, w, label) { image("list_bar_head2", x, line - 48, { parent: B }).style.width = w + "px"; text(label, x + 15, line - 73, 44, "#fff", { textShadow: "none", lineHeight: "56px" }, B); hline(B, x, line, w); image("line-blue_corner_subhead", x + w, line - 100, { parent: B }); }
  const standIcon = (parent, cx, cy, st) => { const c = { neutral: "#f2a516", nap: "#3fd05a", war: "#e8433a", own: "#27d0f0" }[st] || "#f2a516"; const d = el("div", { position: "absolute", left: cx - 32 + "px", top: cy - 32 + "px", width: "64px", height: "64px", borderRadius: "32px", background: c, boxShadow: "0 0 0 5px rgba(255,255,255,.18)" }, parent); if (st !== "war") el("div", { position: "absolute", left: "16px", top: "27px", width: "32px", height: "10px", borderRadius: "4px", background: "#fff" }, d); if (st === "nap") el("div", { position: "absolute", left: "27px", top: "16px", width: "10px", height: "32px", borderRadius: "4px", background: "#fff" }, d); };

  /* the profile layout of Lb_rec_135 (stage pixels minus the panel's 16): used by ALLIANCE PROFILE and by the ALLIANCE tab of a member. o = { w, oy (shift down), buttons: [{ cx, label, art, fn, dim, right }], editing, onEdit } */
  function profileView(B, d, o) {
    const T = { textShadow: "none", lineHeight: "56px" }, oy = o.oy || 0, w = o.w, cyan = "#27d0f0";
    subhead(B, 25, 268 + oy, 886, "Alliance information");
    const lab = (l, x, y) => text(l, x, y - 28, 44, cyan, T, B), val = (v, rightX, y, col) => text(v, 0, y - 28, 44, col || "#fff", { ...T, left: "auto", right: (w - rightX) + "px" }, B);
    lab("NAME:", 68, 314 + oy); val(d.name, 919, 314 + oy); lab("TAG:", 68, 393 + oy); val("[" + d.tag + "]", 860, 393 + oy); lab("MEMBER COUNT:", 68, 473 + oy); val(String(d.members), 810, 473 + oy);
    const mi = image("sm_icon_alliance", 0, 0, { parent: B }); mi.onload = () => { const k = Math.min(1, 56 / mi.naturalHeight); mi.style.height = mi.naturalHeight * k + "px"; mi.style.left = 866 - mi.naturalWidth * k / 2 + "px"; mi.style.top = 473 + oy - mi.naturalHeight * k / 2 + "px"; };
    lab("LEADER:", 1059, 314 + oy); val(d.leader || "?", 1781, 314 + oy); pressButton("button_player-profile", 1870, 314 + oy, 156, 156, () => dialog(d.leader || "LEADER", "The player profile has not been rebuilt in the original look yet."), "Leader", B);
    if (d.standing && d.standing !== "own") { lab("STANDING:", 1059, 473 + oy); val(d.standing.toUpperCase(), 1836, 473 + oy); standIcon(B, 1875, 473 + oy, d.standing); }
    hline(B, 25, 548 + oy, 1944); subhead(B, 25, 625 + oy, 886, "DESCRIPTION");
    const top = 665 + oy, h = 1290 - top;
    if (o.editing) {
      const ta = el("textarea", { position: "absolute", left: "60px", top: top + 10 + "px", width: "1850px", height: h - 20 + "px", background: "rgba(4,32,48,.7)", border: "3px solid #2a6a88", borderRadius: "14px", outline: "0", color: "#fff", font: "38px Klavika, system-ui, sans-serif", padding: "14px", resize: "none", boxSizing: "border-box" }, B);
      ta.value = d.desc || ""; ta.maxLength = 500; ta.onkeydown = (e) => e.stopPropagation(); ta.onkeyup = (e) => e.stopPropagation(); ta.oninput = () => (o.onText && o.onText(ta.value)); o.ta = ta;
    } else {
      const sc = scroller(B, 37, top, 1916, h, w - 53);
      text(d.desc || "No description.", 38, 18, 38, d.desc ? "#fff" : "#7e96a6", { ...T, whiteSpace: "pre-wrap", width: "1800px", lineHeight: "48px" }, sc.inner); sc.setHeight(Math.max(h, 40 + (d.desc || "").split("\n").length * 48 + Math.ceil((d.desc || "").length / 70) * 48));
    }
    hline(B, 35, 1304, 1890);
    for (const b of o.buttons || []) {
      const ring = pressButton(b.art, b.cx, 1393, 156, 156, b.fn, b.label, B); if (b.dim) dimmed(ring);
      if (b.right) text(b.label, 0, 1393 - 28, 44, b.dim ? "#7e96a6" : "#fff", { ...T, left: "auto", right: (w - (b.cx - 91)) + "px" }, B); else text(b.label, b.cx + 98, 1393 - 28, 44, b.dim ? "#7e96a6" : "#fff", T, B);
    }
  }

  function openAllianceProfile(id) {   // another alliance (the ring of a SEARCH row): the layout of Lb_rec_135 / 150
    const a = A(), p = panel({ x: 16, y: 16, w: 2016, h: 1504, icon: "headline_icon_alliance", title: "ALLIANCE PROFILE", crossY: [469, 746, 1021, 1298], crossCenter: true, ref: "Lb_rec_135.PNG" });
    pressButton("button_small_copy-link", p.w - 257, p.headY - 47.5, 128, 128, () => dialog("COPY LINK", "Copying a link is not available in the browser version."), "Copy link", p.root).style.zIndex = 5;
    const B = el("div", { position: "absolute", left: 0, top: 0, width: p.w + "px", height: p.h + "px" }, p.root);
    const load = () => alq("alliance=1&id=" + id).then((d) => {
      if (!p.root.isConnected) return; B.textContent = ""; if (!d) { text("This alliance does not exist any more.", 69, 320, 44, "#ff7a66", { textShadow: "none", lineHeight: "56px" }, B); return; }
      profileView(B, d, { w: p.w, buttons: [{ cx: 125, label: "REPORT", art: "button_report", fn: () => dialog("REPORT", "Reporting is not available in the browser version.") },
        d.mine ? { cx: 1870, right: true, label: "YOUR ALLIANCE", art: "button_alliance", fn: () => {}, dim: true }
        : d.applied ? { cx: 1870, right: true, label: "CANCEL APPLICATION", art: "button_cancel-alliance", fn: async () => { try { await a.call([[226, a.W.v(1, d.id)]]); } catch (e) { dialog("CANCEL APPLICATION", "The server refused: " + (e.message || e)); } load(); if (squad) squad.load(); } }
        : { cx: 1870, right: true, label: "APPLY", art: "button_apply", fn: async () => { try { await a.call([[232, a.W.v(1, d.id)]]); dialog("APPLY", "Your application to " + d.name + " was sent."); } catch (e) { dialog("APPLY", "The server refused: " + (e.message || e)); } load(); if (squad) squad.load(); } }] });
    });
    load();
  }

  function openSquad(tab0) {
    if (squad) return;
    const a = A(), S = a.S, W = a.W, T = { textShadow: "none", lineHeight: "56px" };
    const p = panel({ x: 16, y: 16, w: 2016, h: 1504, icon: "headline_icon_alliance", title: "ALLIANCE", crossY: [469, 746, 1021, 1298], crossCenter: true, ref: "Lb_rec_123.PNG", onClose: () => { squad = null; } });
    squad = { p, tab: tab0 || 0, me: null, rows: null, q: "", form: { name: "", tag: "", desc: "" }, edit: false, draft: "", sig: "", at: 0, member: null };
    pressButton("button_small_copy-link", p.w - 257, p.headY - 47.5, 128, 128, () => dialog("COPY LINK", "Copying a link is not available in the browser version."), "Copy link", p.root).style.zIndex = 5;
    const body = el("div", { position: "absolute", left: 0, top: 0, width: p.w + "px", height: p.h + "px" }, p.root);
    const act = async (label, ext, bytes, after) => { try { await a.call([[ext, bytes]]); } catch (e) { dialog(label, "The server refused: " + (e.message || e)); } await squad.load(); if (after) after(); };
    squad.load = async () => { squad.at = Date.now(); const me = await alq("alliance=1"); if (!me || !squad || squad.p !== p) return; squad.me = me; draw(); };
    squad.tick = () => { if (Date.now() - squad.at > 8000) squad.load(); };
    const loadRows = (q) => alq("alliances=1&q=" + encodeURIComponent(q || "")).then((j) => { if (squad && squad.p === p) { squad.rows = j || { rows: [], mine: null }; draw(true); } });
    const draw = (force) => {
      const me = squad.me; if (!me) return;
      const member = !!me.mine; if (squad.member !== member) { squad.member = member; squad.tab = 0; force = true; }
      const sig = JSON.stringify([squad.tab, squad.edit, me, squad.tab === 0 && !member ? squad.rows : null]); if (sig === squad.sig && !force) return; squad.sig = sig;
      body.textContent = ""; const labels = member ? ["ALLIANCE", "MEMBERS", "OFFERS"] : ["SEARCH", "CREATE", "OFFERS"], ct = el("div", { position: "absolute", left: 0, top: 0, width: p.w + "px", height: p.h + "px" }, body);
      tabBar(ct, labels, squad.tab, (i) => { squad.tab = i; squad.edit = false; squad.sig = ""; if (!member && i === 0 && !squad.rows) loadRows(squad.q); draw(true); }, { faces: [[41, 637], [704, 611], [1354, 611]], top: 173 }); hline(ct, 35, 288, 1945);
      const offersN = member ? (me.mine.offers || []).filter((o) => o.type === 1).length : me.invites.length; if (offersN) bangBadge(ct, 1374, 163);
      if (!member && squad.tab === 0) return searchTab(ct); if (!member && squad.tab === 1) return createTab(ct, me);
      if (member && squad.tab === 0) return ownTab(ct, me.mine); if (member && squad.tab === 1) return membersTab(ct, me.mine); offersTab(ct, me, member);
    };
    const listBar = (I, cy, w) => { const bar = image("list_bg_bar2", 0, 0, { parent: I }); bar.style.width = w + "px"; bar.onload = () => { bar.style.top = cy - bar.naturalHeight / 2 + "px"; }; };
    const rowEnd = (I, cy) => { image("line-blue_corner_list", 0, cy + 76 - 100, { parent: I }); hline(I, 32, cy + 76, 1880); };
    const searchTab = (ct) => {   // the reference frame: the search box, the rows with the profile ring, the member count and APPLY
      text("SEARCH FOR ALLIANCES", 69, 320, 44, "#fff", T, ct);
      image("alliance_search_bg_corner", 1010, 299, { parent: ct }); strip(ct, "alliance_search_bg_mid", 1040, 299, 762, 98); image("alliance_search_bg_corner", 1802, 299, { parent: ct }).style.transform = "scaleX(-1)";
      const box = el("input", { position: "absolute", left: "1030px", top: "311px", width: "740px", height: "74px", background: "transparent", border: "0", outline: "0", color: "#fff", font: "44px Klavika, system-ui, sans-serif", padding: "0" }, ct); box.placeholder = "search"; box.maxLength = 30; box.value = squad.q;
      text("✎", 1795, 322, 44, "#35b6e6", T, ct); const go = () => { squad.q = box.value.trim(); loadRows(squad.q); };
      box.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") go(); }; box.onkeyup = (e) => e.stopPropagation(); box.oninput = () => (squad.q = box.value.trim());
      pressButton("button_small_search", 1902, 348, 128, 128, go, "Search", ct); hline(ct, 35, 414, 1890);
      if (!squad.rows) { loadRows(squad.q); return; }
      const d = squad.rows, sc = scroller(ct, 37, 417, 1916, 1042, p.w - 53), I = sc.inner, applied = new Set(squad.me.applied.map((x) => x.id));
      d.rows.forEach((r, i) => {
        const cy = 84 + i * 172; listBar(I, cy, 760); text("[" + r.tag + "] " + r.name, 32, cy - 28, 44, "#fff", { ...T, maxWidth: "690px", overflow: "hidden" }, I);
        pressButton("button_small_alliances", 856, cy - 7, 128, 128, () => openAllianceProfile(r.id), "Alliance profile", I);
        [957, 1437].forEach((x) => el("div", { position: "absolute", left: x + "px", top: cy - 36 + "px", width: "2px", height: "72px", background: "rgba(200,230,245,.5)" }, I));
        const mi = image("sm_icon_alliance", 0, 0, { parent: I }); mi.onload = () => { const k = Math.min(1, 64 / mi.naturalHeight); mi.style.height = mi.naturalHeight * k + "px"; mi.style.left = 1201 - mi.naturalWidth * k / 2 + "px"; mi.style.top = cy - mi.naturalHeight * k / 2 + "px"; };
        text(String(r.members), 1263, cy - 28, 44, "#fff", T, I); const done = applied.has(r.id);
        text(done ? "APPLIED" : "APPLY", 0, cy - 28, 44, done ? "#7e96a6" : "#fff", { ...T, left: "auto", right: (1916 - 1743) + "px" }, I);
        const b = pressButton("button_apply", 1841, cy - 7, 156, 156, () => { if (!done) act("APPLY", 232, W.v(1, r.id), () => dialog("APPLY", "Your application to " + r.name + " was sent.")); }, done ? "Already applied" : "Apply", I); if (done) dimmed(b);
        rowEnd(I, cy);
      });
      if (!d.rows.length) text("No alliance found.", 32, 56, 44, SKY, T, I); sc.setHeight(Math.max(1, d.rows.length) * 172 + 20);
    };
    const field = (ct, label, y, h, key, max, multi) => {   // a bordered input; the value is kept in squad.form
      text(label, 69, y - 8, 40, SKY, T, ct);
      const box = el("div", { position: "absolute", left: "560px", top: y - 14 + "px", width: "1360px", height: h + "px", boxSizing: "border-box", border: "3px solid #2a6a88", borderRadius: "14px", background: "rgba(4,32,48,.7)" }, ct);
      const f = el(multi ? "textarea" : "input", { position: "absolute", left: "14px", top: "8px", width: "1330px", height: h - 22 + "px", background: "transparent", border: "0", outline: "0", color: "#fff", font: "42px Klavika, system-ui, sans-serif", padding: "0", resize: "none" }, box);
      f.value = squad.form[key]; f.maxLength = max; f.onkeydown = (e) => e.stopPropagation(); f.onkeyup = (e) => e.stopPropagation(); f.oninput = () => { squad.form[key] = f.value; refreshCreate(); };
    };
    let refreshCreate = () => {};
    const createTab = (ct, me) => {
      const c = me.create, lvOk = c.level >= c.need, arOk = c.artifacts.red > 0 && c.artifacts.blue > 0 && c.artifacts.yellow > 0;
      text("CREATE AN ALLIANCE", 69, 320, 44, "#fff", T, ct); hline(ct, 35, 414, 1890);
      text("COMMANDER LEVEL " + c.need + "  (YOURS: " + c.level + ")", 69, 440, 40, lvOk ? "#7fe619" : "#ff7a66", T, ct);
      text("1 ARTIFACT OF EACH COLOUR  (RED " + c.artifacts.red + " · BLUE " + c.artifacts.blue + " · YELLOW " + c.artifacts.yellow + ")", 69, 496, 40, arOk ? "#7fe619" : "#ff7a66", T, ct);
      field(ct, "NAME", 640, 100, "name", 24, false); field(ct, "TAG", 790, 100, "tag", 5, false); field(ct, "DESCRIPTION", 940, 300, "desc", 500, true);
      const lab = text("CREATE", 0, 1359, 44, "#fff", { ...T, left: "auto", right: (p.w - 1780) + "px" }, ct), btn = pressButton("button_confirm", 1870, 1393, 156, 156, async () => {
        const f = squad.form; if (!ok()) return;
        await act("CREATE ALLIANCE", 215, W.concat([W.ld(1, f.name.trim()), W.ld(2, f.tag.trim()), W.ld(3, f.desc)]), () => { if (squad && squad.me && !squad.me.mine) dialog("CREATE ALLIANCE", "The alliance could not be created."); });
      }, "Create the alliance", ct);
      const ok = () => lvOk && arOk && squad.form.name.trim().length >= 3 && squad.form.tag.trim().length >= 2;
      refreshCreate = () => { const on = ok(); btn.style.opacity = on ? "1" : ".4"; lab.style.opacity = on ? "1" : ".4"; btn.title = on ? "Create the alliance" : !lvOk ? "Level " + c.need + " needed" : !arOk ? "One artifact of each colour needed" : "Name (3+ letters) and tag (2+) needed"; }; refreshCreate();
    };
    const offerRow = (I, cy, name, sub, buttons) => { listBar(I, cy, 1100); text(name, 32, cy - 28, 44, "#fff", { ...T, maxWidth: "1040px", overflow: "hidden" }, I); text(sub, 1130, cy - 28, 40, SKY, T, I); buttons(cy); rowEnd(I, cy); };
    const offersTab = (ct, me, member) => {
      const sc = scroller(ct, 37, 300, 1916, 1160, p.w - 53), I = sc.inner;
      if (!member) {
        let y = 10; text("INVITATIONS", 32, y, 40, SKY, T, I); y += 60;
        for (const x of me.invites) { offerRow(I, y + 76, "[" + x.tag + "] " + x.name, x.members + " MEMBERS", (cy) => {
          text("ACCEPT", 0, cy - 28, 40, "#fff", { ...T, left: "auto", right: (1916 - 1560) + "px" }, I); pressButton("button_apply", 1650, cy - 7, 156, 156, () => confirmBox("ACCEPT", "Join " + x.name + "?", () => act("ACCEPT", 305, W.concat([W.v(1, x.id), W.v(2, 1)]))), "Accept the invitation", I);
          pressButton("button_cancel", 1830, cy - 7, 156, 156, () => act("REJECT", 305, W.concat([W.v(1, x.id), W.v(2, 0)])), "Reject", I); }); y += 172; }
        if (!me.invites.length) { text("No invitations.", 32, y, 44, "#7e96a6", T, I); y += 70; }
        y += 20; text("YOUR APPLICATIONS", 32, y, 40, SKY, T, I); y += 60;
        for (const x of me.applied) { offerRow(I, y + 76, "[" + x.tag + "] " + x.name, x.members + " MEMBERS", (cy) => { text("CANCEL", 0, cy - 28, 40, "#fff", { ...T, left: "auto", right: (1916 - 1740) + "px" }, I); pressButton("button_cancel", 1830, cy - 7, 156, 156, () => act("CANCEL APPLICATION", 226, W.v(1, x.id)), "Cancel the application", I); }); y += 172; }
        if (!me.applied.length) { text("No applications sent.", 32, y, 44, "#7e96a6", T, I); y += 70; }
        sc.setHeight(y + 40); return;
      }
      const offers = me.mine.offers || [];
      if (me.mine.rank > 2) text("Only the leader and the senior officers answer applications.", 32, 20, 44, "#7e96a6", T, I);
      offers.forEach((o, k) => offerRow(I, 84 + k * 172, o.name, o.type === 1 ? "APPLIED" : "INVITED", (cy) => {
        if (o.type === 1) { text("ACCEPT", 0, cy - 28, 40, "#fff", { ...T, left: "auto", right: (1916 - 1560) + "px" }, I); pressButton("button_apply", 1650, cy - 7, 156, 156, () => act("ACCEPT", 305, W.concat([W.v(1, o.pid), W.v(2, 1)])), "Accept " + o.name, I); pressButton("button_cancel", 1830, cy - 7, 156, 156, () => act("REJECT", 305, W.concat([W.v(1, o.pid), W.v(2, 0)])), "Reject " + o.name, I); }
        else { text("CANCEL", 0, cy - 28, 40, "#fff", { ...T, left: "auto", right: (1916 - 1740) + "px" }, I); pressButton("button_cancel", 1830, cy - 7, 156, 156, () => act("CANCEL INVITATION", 306, W.v(1, o.pid)), "Cancel the invitation", I); } }));
      if (!offers.length && me.mine.rank <= 2) text("No applications or invitations.", 32, 20, 44, "#7e96a6", T, I);
      sc.setHeight(Math.max(1, offers.length) * 172 + 20);
    };
    const ownTab = (ct, m) => {
      const lead = m.rank === 1, can = m.rank <= 2, bt = [];
      if (squad.edit) {
        bt.push({ cx: 125, label: "CANCEL", art: "button_cancel", fn: () => { squad.edit = false; draw(true); } }, { cx: 1870, right: true, label: "SAVE", art: "button_confirm", fn: () => { const t = squad.draft; squad.edit = false; act("EDIT", 228, W.ld(2, t)); } });
      } else {
        bt.push(lead ? { cx: 125, label: "DELETE ALLIANCE", art: "button_trash", fn: () => confirmBox("DELETE ALLIANCE", "Delete " + m.name + "? All members are removed and this cannot be undone.", () => act("DELETE", 227, new Uint8Array(0))) }
          : { cx: 125, label: "LEAVE ALLIANCE", art: "button_leave", fn: () => confirmBox("LEAVE ALLIANCE", "Leave " + m.name + "?", () => act("LEAVE", 230, new Uint8Array(0))) });
        if (can) bt.push({ cx: 1870, right: true, label: "EDIT", art: "button_edit", fn: () => { squad.edit = true; squad.draft = m.desc; draw(true); } });
      }
      profileView(ct, { ...m, members: m.members.length, standing: "own" }, { w: p.w, oy: 130, buttons: bt, editing: squad.edit, onText: (t) => (squad.draft = t) });
    };
    const membersTab = (ct, m) => {
      const sc = scroller(ct, 37, 300, 1916, 1160, p.w - 53), I = sc.inner, lead = m.rank === 1, myId = (S.me && Number(S.me.player)) || 0;
      m.members.forEach((x, i) => {
        const cy = 84 + i * 172; listBar(I, cy, 1100); const im = image("alliance_ranks_" + RANK_ART[x.rank], 0, 0, { parent: I }); im.onload = () => { const k = Math.min(1, 80 / im.naturalHeight); im.style.height = im.naturalHeight * k + "px"; im.style.left = 70 - im.naturalWidth * k / 2 + "px"; im.style.top = cy - im.naturalHeight * k / 2 + "px"; };
        text(x.name, 140, cy - 28, 44, "#fff", { ...T, maxWidth: "700px", overflow: "hidden" }, I); text(RANK_NAME[x.rank] || "RANK " + x.rank, 900, cy - 28, 40, SKY, T, I);
        const me = String(x.id) === String(myId) || x.name === S.alias;
        if (lead && !me) {
          const rk = (r, why) => confirmBox("CHANGE RANK", r === 1 ? "Promoting " + x.name + " to leader will result in demoting yourself to senior officer. Are you sure?" : "Change the rank of " + x.name + " to " + RANK_NAME[r] + "?", () => act("CHANGE RANK", 218, W.concat([W.v(1, x.id), W.v(2, r)])));
          if (x.rank > 1) pressButton("button_arrow-up", 1330, cy - 7, 156, 156, () => rk(x.rank - 1), "Promote to " + RANK_NAME[x.rank - 1], I);
          if (x.rank < 5) pressButton("button_arrow-down", 1500, cy - 7, 156, 156, () => rk(x.rank + 1), "Demote to " + RANK_NAME[x.rank + 1], I);
        }
        if (m.rank <= 2 && m.rank < x.rank && !me) pressButton("button_kick", 1830, cy - 7, 156, 156, () => confirmBox("KICK", "Remove " + x.name + " from the alliance?", () => act("KICK", 226, W.v(1, x.id))), "Kick " + x.name, I);
        rowEnd(I, cy);
      });
      sc.setHeight(m.members.length * 172 + 20);
    };
    squad.load();
  }
  /* ---- OPTIONS (frame Lb_rec_291.PNG, Leaderboards.MP4 at 291 s; opened by the OPTIONS pill of the game settings). SOUND: MUSIC / SOUND EFFECTS / VOICES with minus / plus rings, the slider (track, segmented fill, knob), ON and a
     checkbox; Push Messages: six checkboxes. The values are kept in localStorage (gofa.options); the browser version plays no sound and sends no push messages yet, so they change nothing else. ---- */
  const OPT_DEFAULT = { music: 0.5, sfx: 0.9, voices: 0.5, on: { music: true, sfx: true, voices: true }, push: { ship: true, structure: true, fleet: true, research: true, attack: true, messages: true } };
  let options = null;
  const optLoad = () => { try { const o = JSON.parse(localStorage.getItem("gofa.options") || "{}"); return { ...OPT_DEFAULT, ...o, on: { ...OPT_DEFAULT.on, ...(o.on || {}) }, push: { ...OPT_DEFAULT.push, ...(o.push || {}) } }; } catch (e) { return JSON.parse(JSON.stringify(OPT_DEFAULT)); } };
  const optSave = (o) => { try { localStorage.setItem("gofa.options", JSON.stringify(o)); } catch (e) { /* private window */ } };
  function openOptions() {
    if (options) return;
    const f = settingsFrame("OPTIONS", "Lb_rec_291.PNG", () => (options = null)), { root, T } = f; options = f.self; const o = optLoad();
    const sc = scroller(root, 37, 190, 1963, 1281, 2000), I = sc.inner;
    const sub = (line, label) => { image("list_bar_head2", 0, line - 48, { parent: I }).style.width = "886px"; text(label, 16, line - 73, 44, "#fff", T, I); hline(I, 0, line, 886); image("line-blue_corner_subhead", 886, line - 100, { parent: I }); };
    const draw = () => {
      I.textContent = ""; sub(94, "SOUND");
      [["music", "MUSIC:", 240], ["sfx", "SOUND EFFECTS:", 422], ["voices", "VOICES:", 604]].forEach(([k, lab, cy]) => {
        const bar = image("list_bg_bar2", -6, 0, { parent: I }); bar.style.width = "1930px"; bar.style.opacity = ".35"; bar.onload = () => { bar.style.top = cy - bar.naturalHeight / 2 + "px"; };
        text(lab, 16, cy - 28, 44, SKY, T, I);
        const step = (d) => { o[k] = Math.max(0, Math.min(1, Math.round((o[k] + d) * 10) / 10)); optSave(o); draw(); };
        pressButton("button_minus", 488, cy, 156, 156, () => step(-0.1), "Lower", I);
        const tr = el("div", { position: "absolute", left: "583px", top: cy - 20 + "px", width: "806px", height: "40px", border: "2px solid #1fa0cf", borderRadius: "20px", boxSizing: "border-box", background: "#02192a", overflow: "hidden", cursor: "pointer" }, I);
        el("div", { position: "absolute", left: "10px", top: "13px", width: Math.max(0, o[k] * 786) + "px", height: "10px", background: "repeating-linear-gradient(90deg," + (o[k] > 0.6 ? "#34e028" : "#d8e818") + " 0 86px, transparent 86px 98px)", pointerEvents: "none" }, tr);
        tr.onclick = (e) => { const r = tr.getBoundingClientRect(); o[k] = Math.max(0, Math.min(1, Math.round(((e.clientX - r.left) / r.width) * 10) / 10)); optSave(o); draw(); };
        const kb = pressButton("button_small_slider", 603 + o[k] * 766, cy, 128, 128, () => {}, "", I); kb.style.pointerEvents = "none";
        pressButton("button_plus", 1485, cy, 156, 156, () => step(0.1), "Raise", I);
        text(o.on[k] ? "ON" : "OFF", 0, cy - 28, 44, "#fff", { ...T, left: "auto", right: (1963 - 1804) + "px" }, I);
        const cb = image(o.on[k] ? "checkbox_1" : "checkbox_0", 1883 - 64, cy - 64, { parent: I, click: () => { o.on[k] = !o.on[k]; optSave(o); draw(); } });
      });
      image("line-blue_corner_list", 0, 719 - 100, { parent: I }); hline(I, 32, 719, 1900); sub(827, "Push Messages");
      [[953, "ship", "SHIP CONSTRUCTION", "structure", "STRUCTURE CONSTRUCTION"], [1093, "fleet", "FLEET MOVEMENT", "research", "RESEARCH"], [1233, "attack", "UNDER ATTACK", "messages", "MESSAGES"]].forEach(([cy, lk, ll, rk, rl]) => {
        const bar = image("list_bg_bar2", -6, 0, { parent: I }); bar.style.width = "1930px"; bar.style.opacity = ".35"; bar.onload = () => { bar.style.top = cy - bar.naturalHeight / 2 + "px"; };
        [[lk, 91], [rk, 1883]].forEach(([k, x]) => image(o.push[k] ? "checkbox_1" : "checkbox_0", x - 64, cy - 64, { parent: I, click: () => { o.push[k] = !o.push[k]; optSave(o); draw(); } }));
        text(ll, 176, cy - 28, 44, SKY, T, I); text(rl, 0, cy - 28, 44, SKY, { ...T, left: "auto", right: (1963 - 1806) + "px" }, I);
      });
      sc.setHeight(1360);
    };
    draw(); setRef();
  }
  /* ---- Chat panel: IMG_4226 (final release). Box 0,168 1300 x 1351, header line 148 down, title "GLOBAL CHAT", channel buttons (alliance 915, global
     1039 across, 100.5 down), close; text box 33,345 1090 x 94 (cyan 2 px frame, 16 px corner / 4 px edge slices) with the placeholder "Type here", the pencil
     and the check button (centre 1188, 391); a line at y 458; the log below, NEWEST FIRST: a yellow "Name, 3:31 pm:" line and the white text under it, 134 px
     per one-line message. The chat servers are Photon (UDP): a browser cannot reach them, so this panel only shows messages typed here (and a demo with
     openChat({ demo: true })). ---- */
  const chatLog = { global: [], alliance: [] };
  const CHAT_DEMO = [["Galipoly", "Greetings to everyone"], ["Pilot", "Anyone near Murana?"], ["Lunar", "Wish someone would buy the code and keep it alive."], ["Galipoly", "Right"], ["Pilot", "Both friends or enemies"], ["Lunar", "Hello"]];
  const clock12 = (t) => { const d = new Date(t * 1000), hh = d.getHours(); return (hh % 12 || 12) + ":" + String(d.getMinutes()).padStart(2, "0") + " " + (hh < 12 ? "am" : "pm"); };
  let chat = null;   // { p, channel, sc, input }
  function chatRender() {
    const sc = chat.sc, log = chatLog[chat.channel]; sc.inner.textContent = ""; let y = 14;
    const T = { textShadow: "none", lineHeight: "56px" };
    if (!log.length) { text(chat.channel === "global" ? "No messages here yet. The global chat is not connected in the browser." : "No messages here yet. The alliance chat is not connected in the browser.", 4, 14, 36, SKY, { ...T, whiteSpace: "normal", width: "1150px", lineHeight: "46px" }, sc.inner); y = 90; }
    for (const m of log) {   // newest first
      text(m.name + ", " + clock12(m.time) + ":", 0, y, 44, "#fefea4", T, sc.inner); y += 56;
      const e = text(m.text, 6, y, 40, "#fff", { ...T, whiteSpace: "pre-wrap", width: "1190px" }, sc.inner); y += Math.max(56, e.offsetHeight) + 22;
    }
    sc.setHeight(y + 4); sc.view.scrollTop = 0;
  }
  function chatChannel(ch) {
    chat.channel = ch; chat.p.title.textContent = ch === "global" ? "GLOBAL CHAT" : "ALLIANCE CHAT";
    chatRender();
  }
  function chatSend() {
    const v = chat.input.value.trim(); if (!v) return;
    chatLog[chat.channel].unshift({ name: A().S.alias || "You", time: Date.now() / 1000, text: v }); chat.input.value = ""; chatRender();
  }
  function openChat(opts = {}) {
    if (chat) return;
    if (opts.demo && !chatLog.global.length) CHAT_DEMO.forEach(([name, t], i) => chatLog.global.push({ name, time: Date.now() / 1000 - i * 60, text: t }));
    const p = panel({ x: 0, y: 168, w: 1300, h: 1351, icon: "headline_icon_chat", title: "GLOBAL CHAT", ref: "IMG_4226.PNG", onClose: () => (chat = null) });
    chat = { p, channel: "global", sc: null, input: null, btnA: null, btnG: null };
    chat.btnA = pressButton("button_small_chat_alliance", 915, 100.5, 128, 128, () => chatChannel("alliance"), "Alliance chat", p.root); chat.btnG = pressButton("button_small_chat_global", 1039, 100.5, 128, 128, () => chatChannel("global"), "Global chat", p.root);
    // text box
    const bx = 33, by = 177, bw = 1090, bh = 94, box = el("div", { position: "absolute", left: bx + "px", top: by + "px", width: bw + "px", height: bh + "px", background: "#092235" }, p.root);
    strip(box, "text-input_mid", 16, 0, bw - 32, 16); strip(box, "text-input_mid", 16, bh, bw - 32, 16, "scaleY(-1)");
    strip(box, "text-input_mid", 0, bh - 16, bh - 32, 16, "rotate(-90deg)"); strip(box, "text-input_mid", bw, 16, bh - 32, 16, "rotate(90deg)");
    [[0, 0, "none"], [bw - 16, 0, "scaleX(-1)"], [0, bh - 16, "scaleY(-1)"], [bw - 16, bh - 16, "scale(-1,-1)"]].forEach(([cx, cy, tf]) => (image("text-input_corner", cx, cy, { parent: box }).style.transform = tf));
    if (!document.getElementById("pInputCss")) { const st = document.createElement("style"); st.id = "pInputCss"; st.textContent = ".pinput{background:transparent;border:0;outline:0;color:#fff;font:40px Klavika,system-ui,sans-serif;padding:0}.pinput::placeholder{color:#aaa;opacity:1}"; document.head.append(st); }
    const inp = el("input", { position: "absolute", left: "12px", top: "17px", width: "1010px", height: "60px" }, box); inp.className = "pinput"; inp.placeholder = "Type here"; inp.maxLength = 300; inp.autocomplete = "off"; inp.spellcheck = false;
    inp.onkeydown = (e) => { if (e.key === "Enter") chatSend(); };
    image("edit_icon", 1100 - 24 - bx, 391 - 24 - 345, { parent: box }); chat.input = inp;
    pressButton("button_small_confirm", 1188, 223, 128, 128, chatSend, "Send", p.root);
    hline(p.root, 37, 291, 1228);
    const sc = scroller(p.root, 37, 297, 1204, 1005, 1247); chat.sc = sc; sc.inner.classList.add("psel");
    chatChannel("global");
  }

  /* ---- Structure panel (headquarters, shipyard, ...): frames from the owner's recordings (Nice.MP4 = headquarters, Random.MP4 = shipyard), box 733,152
     1300 x 1381 (cyan frame at x 756 / 2008, y 175 / 1509 in the 2048 x 1536 frame). Header (HQ icon or headline icon, title, close), two or three tabs
     (the active one orange and wider), then the DETAIL tab: NEXT LEVEL badge + info + UPGRADE (156 px button), the cost row (metal, gas, crystal, time
     with the blue slashes between), the demolish row. Positions below are panel-relative (frame pixel minus 733, 152). The "+" grid is centred on the
     panel. Not faithful / unknown: the INFO tab (no reference), the SHIPS / CARRIERS lists of the shipyard (reference frames cut, not built), the demolish
     button does nothing, an upgrade in progress shows a timer line of my own. ---- */
  const SICON = { 1: "HQ_icon_white", 2: "headline_icon_shipyard-fleets", 3: "headline_icon_metal", 4: "headline_icon_gas", 5: "headline_icon_crystal", 6: "headline_icon_barracks-marines", 7: "headline_icon_research", 8: "headline_icon_scanner", 9: "headline_icon_defence", 10: "headline_icon_trade", 11: "headline_icon_artifacts" };
  const durTxt = (n) => { n = Math.max(0, Math.round(n)); const z = (v) => String(v).padStart(2, "0"), h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60); return h ? h + "h " + z(m) + "m" : z(m) + "m " + z(n % 60) + "s"; };
  let sp = null;   // { p: panel, planet, slot, tab, q, sig, body }
  function tabBar(parent, labels, active, pick, opts = {}) {   // faces start at 43; active one wider (orange, _1), the others white (_0); total 1201 wide, 35 gap; opts.faces = [[x, width], ...] and opts.top for other panels
    const n = labels.length, g = 35, T = 1201, o = n === 2 ? 553 : 345, A = T - (n - 1) * g - (n - 1) * o, top = opts.top || 172; let x = 43;
    labels.forEach((lab, i) => {
      const on = i === active, w = opts.faces ? opts.faces[i][1] : on ? A : o, k = on ? "_1" : "_0", l = on ? 11 : 21, r = on ? 24 : 14;   // sprite offsets of the face inside the 36 px corner
      if (opts.faces) x = opts.faces[i][0];
      image("tab_corner" + k, x - l, top, { parent }); const rc = image("tab_corner" + k, x + w - r, top, { parent }); rc.style.transform = "scaleX(-1)";
      strip(parent, "tab_mid" + k, x - l + 36, top, (x + w - r) - (x - l + 36), 100);
      text(lab, x, top + 21, 40, "#000", { width: w + "px", textAlign: "center", lineHeight: "52px", textShadow: "none" }, parent);
      const hit = el("div", { position: "absolute", left: x + "px", top: top + "px", width: w + "px", height: "100px", cursor: "pointer" }, parent); hit.onclick = () => pick(i);
      x += w + g;
    });
  }
  function openStructure(type, slotWant) {
    const a = A(), S = a.S, p0 = S.planets.get(S.selected); if (!p0) return;
    const st = p0.structures.find((s) => s.type === type && (slotWant == null || s.slot === slotWant)) || p0.structures.find((s) => s.type === type); if (!st) return;
    if (sp) sp.p.close();
    const name = (a.STRUCT[type] || "Structure " + type).toUpperCase();
    const p = panel({ rank: true, x: 733, y: 152, w: 1300, h: 1381, icon: null, title: name, headY: 148, closeDx: 114, crossY: [606, 883, 1158, 1434], crossCenter: true, ref: type === 1 ? "Nice_HQ_Panel.PNG" : "Random_ShipyardDetail.PNG", onClose: () => { if (sp && sp.p.extra) sp.p.extra.remove(); sp = null; if (p3 && p3.focusOff) p3.focusOff(); } });
    const big = type !== 1; image(SICON[type] || "headline_icon_structure", big ? 60 : 76, big ? 48 : 62, { parent: p.root });
    sp = { p, planet: p0.id, slot: st.slot, type, tab: 0, q: null, sig: "", body: null, draw: null, sel: null, qty: 1, qv: 0 };
    if (p3 && p3.focusOn) p3.focusOn(st.slot);   // the 3D planet zooms into this building (and back out on close)
    const bb = image("button_back_0", 108 - 78, 1425 - 78, { click: () => p.close() }); bb.title = "Back"; bb.onpointerenter = () => (bb.src = art("button_back_1")); bb.onpointerleave = () => (bb.src = art("button_back_0")); bb.style.zIndex = 40; p.extra = bb;
    if (type === 2) { const cb = p.root.querySelector('img[title="Close"]'); if (cb) { cb.src = art("button_small_list_0"); cb.title = "Structures"; cb.onclick = () => dialog("STRUCTURES", "The structure list has not been rebuilt in the original look yet."); cb.onpointerenter = cb.onpointerleave = null; } }
    const tabs = type === 2 ? ["DETAIL", "SHIPS", "CARRIERS"] : type === 7 ? ["DETAIL", "RESEARCH"] : type === 8 ? ["DETAIL", "SCAN", "MISSIONS"] : type === 6 ? ["DETAIL", "TROOPS"] : type === 10 ? ["DETAIL", "TRADE"] : type === 11 ? ["DETAIL", "ARTIFACTS"] : ["DETAIL", "INFO"];
    // the body is rebuilt each second while a countdown runs: a click whose press and release straddled a rebuild was lost (2026-11-16, shipyard tabs and
    // the carrier rows "did nothing"), so the timed rebuilds wait while a pointer is down in the panel and 250 ms after; rebuilds a click asks for (sig "") still run
    const me = sp; p.root.addEventListener("pointerdown", () => (me.hold = Date.now() + 5000), true);
    const up = () => { if (sp !== me) return document.removeEventListener("pointerup", up, true); me.hold = Date.now() + 250; }; document.addEventListener("pointerup", up, true);
    sp.draw = () => {
      if (sp.sig && sp.hold > Date.now()) return;
      const S2 = A().S, pl = S2.planets.get(sp.planet); if (!pl) return; const cur = pl.structures.find((s) => s.slot === sp.slot); if (!cur) return sp.p.close();
      const bld = pl.builds.find((b) => b.slot === sp.slot), lvl = cur.level, nxt = lvl + 1, q = sp.q && sp.q.level === nxt ? sp.q.v : null;
      const short = q ? [1, 2, 3].map((t, i) => A().curAmount(pl, t) < q.cost[i]) : [false, false, false];
      const sig = JSON.stringify([sp.tab, lvl, !!bld, q && q.cost, short, bld && Math.round((bld.end - A().nowSrv()) / 1), sp.sel, sp.qty, sp.qv, pl.ships, pl.carriers.length, [1, 2, 3].map((t) => Math.floor(A().curAmount(pl, t) / 10)), jobSig(pl), pl.techs, S2.missions.map((m) => m.id), pl.carriers.map((c) => [c.id, c.travel && c.travel.end, c.ships.map((x) => x.count)]), [5, 4].map((t) => (pl.resources.find((r) => r.type === t) || {}).amount), sp.tr, S2.inventory ? [...S2.inventory] : null]);
      if (sig === sp.sig) return; sp.sig = sig;
      if (sp.type === 2) { sp.p.ref = sp.tab === 0 ? "Random_ShipyardDetail.PNG" : sp.sel ? "Random_Shipyard.PNG" : sp.tab === 2 ? "Random_ShipyardCarriers.PNG" : "Random_Shipyard2.PNG"; setRef(); }
      if (sp.body) sp.body.remove(); const B = el("div", { position: "absolute", left: 0, top: 0, width: "1300px", height: "1381px" }, sp.p.root); sp.body = B;
      tabBar(B, tabs, sp.tab, (i) => { sp.tab = i; sp.scrollTop = 0; sp.qty = 1; sp.sig = ""; sp.draw(); }); hline(B, 35, 286, 1227);
      const T = { textShadow: "none", lineHeight: "52px" }, TS = { ...T, letterSpacing: "3.5px" };   // the labels are about 3.5 px wider per letter than the plain font
      if (sp.tab === 0) {
        image("list_bg_bar1", 35, 355, { parent: B }); text("NEXT LEVEL:", 51, 347, 38, "#fff", TS, B);
        if (lvl >= 20) text("MAX LEVEL", 340, 345, 38, "#fff", T, B);
        else { image("structure_next_level", 315, 312, { parent: B }); text(String(nxt), 411, 331, 44, "#000", { ...T, width: "0px", whiteSpace: "nowrap", transform: "translateX(-50%)", fontWeight: "bold" }, B); }
        const infoBtn = pressButton("button_small_info", 560.5, 372.5, 128, 128, () => dialog(name, "Level " + lvl + (bld ? " (upgrading to " + bld.level + ")" : "") + ".\nNo reference exists for this text yet."), "Information", B);
        text("UPGRADE", 0, 347, 38, "#fff", { ...TS, left: "auto", right: "218.5px" }, B);
        const can = q && !bld && lvl < 20 && !short.some(Boolean);
        const ub = pressButton("button_upgrade", 1172, 370, 156, 156, async () => { if (!can) return; try { await A().buildOrUpgrade(pl.id, cur.type, cur.slot, nxt); sp.sig = ""; } catch (e) { A().log(e.message, true); } }, can ? "Upgrade to level " + nxt : bld ? "Upgrade in progress" : short.some(Boolean) ? "Not enough resources" : "", B);
        if (!can) { ub.style.opacity = ".45"; ub.style.cursor = "default"; ub.onpointerenter = ub.onpointerleave = null; }
        // cost row
        image("list_bg_bar2", 35, 503, { parent: B });
        [[47, "res_icon_metal"], [355, "res_icon_gas"], [664, "res_icon_crystal"], [971, "res_icon_time"]].forEach(([x, n]) => image(n, x, 482, { parent: B }));
        [311, 617, 925].forEach((x) => image("line-blue_seperator", x, 499, { parent: B }));
        [230, 539, 848].forEach((x, i) => text(q ? fmt(q.cost[i]) : "", x, 498, 38, short[i] ? "#ff7a66" : "#fff", { ...T, width: "0px", transform: "translateX(-50%)" }, B));
        text(q ? durTxt(q.seconds) : "", 0, 498, 38, "#fff", { ...T, left: "auto", right: "74px" }, B);
        image("line-blue_corner_list", 24, 490, { parent: B }); hline(B, 56, 590, 1206);
        if (bld) { text("Upgrading to level " + bld.level + ": " + durTxt(bld.end - A().nowSrv()), 56, 405, 38, SKY, T, B); speedUp(B, 800, 372, bld); }   // my addition
        // demolish row
        image("list_bg_bar2", 35, 675, { parent: B });
        text("Regain resources by demolishing this building.", 44, 615, 44, "#12d4f4", { ...T, lineHeight: "48px", whiteSpace: "normal", width: "700px" }, B);
        text("DEMOLISH", 0, 671, 38, "#fff", { ...TS, left: "auto", right: "219.5px" }, B);
        pressButton("button_demolish", 1174, 693, 156, 156, () => dialog("DEMOLISH", "Demolishing is not available in the browser version yet."), "Demolish", B);
        image("line-blue_corner_list", 24, 678, { parent: B }); hline(B, 56, 778, 1206);
        if (sp.type === 2) queueRows(B, 810, [...pl.shipJobs.map((j) => ({ label: j.count + " × " + (A().SHIP[j.ship] || "ship " + j.ship), job: j })), ...pl.carrierJobs.map((j) => ({ label: j.count + " × " + (A().CARRIER[j.type] || "carrier " + j.type), job: j }))]);
      } else if (tabs[sp.tab] === "RESEARCH") labTab(B, pl);
      else if (tabs[sp.tab] === "SCAN") scanTab(B, pl);
      else if (tabs[sp.tab] === "TROOPS") troopTab(B, pl);
      else if (tabs[sp.tab] === "TRADE") tradeTab(B, pl);
      else if (tabs[sp.tab] === "ARTIFACTS") digTab(B, pl);
      else if (tabs[sp.tab] === "MISSIONS") missionTab(B, pl);
      else if (tabs[sp.tab] === "INFO") text("No reference for this tab yet.", 56, 345, 38, SKY, T, B);
      else shipyardTab(B, pl, sp.tab === 1 ? "s" : "c");
    };
    sp.draw();
    if (!a.S.mail) return;
    a.quote(p0.id, type, st.level + 1).then((v) => { if (sp && sp.planet === p0.id && v) { sp.q = { level: st.level + 1, v }; sp.sig = ""; sp.draw(); } });
  }

  const SHIP_UI = [[1, "icon_terran_fighter", "ship-icon_fighterI", "FIGHTER MK I", "Good vs Interceptors"], [8, "icon_terran_freighter", "ship-icon_freighterI", "FREIGHTER MK I", "Good for cargo"],
    [5, "icon_terran_bomber", "ship-icon_bomberI", "BOMBER MK I", "Good vs Fighters"], [3, "icon_terran_interceptor", "ship-icon_interceptorI", "INTERCEPTOR MK I", "Good vs Bombers"],
    [2, "icon_terran_fighter_advanced", "ship-icon_fighterII", "FIGHTER MK II", "Best vs Interceptors"], [9, "icon_terran_freighter_advanced", "ship-icon_freighterII", "FREIGHTER MK II", "Best for cargo"],
    [6, "icon_terran_bomber_advanced", "ship-icon_bomberII", "BOMBER MK II", "Best vs Fighters"], [4, "icon_terran_interceptor_advanced", "ship-icon_interceptorII", "INTERCEPTOR MK II", "Best vs Bombers"]];
  const CARRIER_UI = [[1, "icon_terran_commandship", "ship-icon_carrierI", "CARRIER MK I", "The backbone of our navy"], [5, "icon_terran_commandship_2", "ship-icon_carrierII", "CARRIER MK II", "More capacity"],
    [9, "icon_terran_commandship_3", "ship-icon_carrierIII", "CARRIER MK III", "Doubled capacity"], [13, "icon_void_commandship", "ship-icon_carrier_void", "VOID CARRIER", "Superior alien technology"]];
  const qcache = new Map();
  function getQ(url) { if (!qcache.has(url)) qcache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).then((q) => (q && !q.error ? q : null)).catch(() => null).then((q) => { if (sp) { sp.qv++; } return q; })); return qcache.get(url); }
  const yardOf = (pl) => pl.structures.find((x) => x.type === 2 && x.level > 0);
  function unitQ(pl, kind, t) {   // the server's price / gates for one unit (read-only /debug/quote), cached; resolved value kept on the cache entry
    const y = yardOf(pl); if (!y) return null; const me = A().S.me.player.toString(16).toUpperCase();
    const url = "/debug/quote?planet=" + pl.id + (kind === "c" ? "&carrier=" + t + "&level=1" : "&ship=" + t) + "&yard=" + y.id + "&yl=" + y.level + "&player=" + me;
    const pr = getQ(url); if (!pr.done) pr.then((q) => { pr.done = true; pr.val = q; }); return pr.val || null;
  }
  const gate = (q, kind) => !q ? "" : q.yard_level < q.yard_needed ? "Requires shipyard level " + q.yard_needed : (kind === "s" && q.blueprint_ok === false) ? "Requires the blueprint research (technology " + q.blueprint_tech + ")" : "";
  function shipyardTab(B, pl, kind) {
    const a = A(), T = { textShadow: "none", lineHeight: "56px" }, list = kind === "s" ? SHIP_UI : CARRIER_UI, y = yardOf(pl);
    const count = (t) => kind === "s" ? ((pl.ships.find((x) => x.type === t) || {}).count || 0) : pl.carriers.filter((c) => c.type === t).length;
    if (!y) { text("No shipyard on this planet.", 56, 345, 38, SKY, T, B); return; }
    if (sp.sel && sp.sel.kind === kind) return orderView(B, pl, kind, list.find((r) => r[0] === sp.sel.t), y, count);
    const sc = scroller(B, 17, 286, 1245, 1070, 1247), I = sc.inner;
    list.forEach((r, i) => {
      const [t, pic, badge, name, desc] = r, R = i * 171.5, q = unitQ(pl, kind, t), ok = t !== 13 && (!q || !gate(q, kind)), open = () => { sp.sel = { kind, t }; sp.qty = 1; sp.sig = ""; sp.draw(); };
      image("list_bg_bar2", 18, R + 63, { parent: I });
      const im = image(pic, 0, 0, { parent: I }); im.onload = () => { im.style.left = 163 - 17 - im.naturalWidth / 2 + "px"; im.style.top = R + 85 - im.naturalHeight / 2 + "px"; };
      text(String(count(t)), 291 - 17, R + 57, 44, "#fff", T, I);
      const bd = image(badge, 0, 0, { parent: I }); bd.onload = () => { bd.style.left = 427 - 17 - bd.naturalWidth / 2 + "px"; bd.style.top = R + 84 - bd.naturalHeight / 2 + "px"; };
      text(name, 516 - 17, R + 36, 40, ok ? "#fff" : "#7e96a6", { ...T, letterSpacing: "2px" }, I); text(desc, 516 - 17, R + 79, 44, "#fff", T, I);
      pressButton("button_next", 1174 - 17, R + 84, 156, 156, open, "Order", I);
      image("line-blue_corner_list", 7, R + 171 - 100, { parent: I }); hline(I, 39, R + 171, 1206);
      const hit = el("div", { position: "absolute", left: "0px", top: R + "px", width: "1060px", height: "171px", cursor: "pointer" }, I); hit.onclick = open;
    });
    sc.setHeight(list.length * 171.5 + 6);
  }
  function orderView(B, pl, kind, r, y, count) {
    const a = A(), T = { textShadow: "none", lineHeight: "56px" }, [t, pic, badge, name] = r, q = unitQ(pl, kind, t), why = t === 13 ? "Void carriers are made from artifacts: not rebuilt yet" : gate(q, kind);
    const per = q ? q.cost : [0, 0, 0], aff = q ? Math.min(...[1, 2, 3].map((rt, i) => per[i] > 0 ? Math.floor(a.curAmount(pl, rt) / per[i]) : 9999)) : 0, max = Math.max(1, Math.min(kind === "s" ? 9999 : 99, aff)), qty = Math.max(1, Math.min(max, sp.qty));
    const back = pressButton("button_back", 122, 370, 156, 156, () => { sp.sel = null; sp.sig = ""; sp.draw(); }, "Back", B);
    const im = image(pic, 0, 0, { parent: B }); im.onload = () => { im.style.left = 317 - im.naturalWidth / 2 + "px"; im.style.top = 375 - im.naturalHeight / 2 + "px"; };
    text(String(count(t)), 450, 347, 44, "#fff", T, B); const bd = image(badge, 0, 0, { parent: B }); bd.onload = () => { bd.style.left = 626 - bd.naturalWidth / 2 + "px"; bd.style.top = 373 - bd.naturalHeight / 2 + "px"; };
    text(name.charAt(0) + name.slice(1).toLowerCase().replace(/ mk /i, " MK ").replace(/\bi{1,3}\b/g, (m) => m.toUpperCase()), 693, 347, 44, "#fff", T, B);
    pressButton("button_small_info", 1184, 373, 128, 128, () => dialog(name, "Cost, build time and requirements are taken from the server.\nNo reference exists for this text yet."), "Information", B);
    image("line-blue_corner_list", 24, 457 - 100, { parent: B }); hline(B, 56, 457, 1206);
    // quantity row: minus, slider, plus, amount, confirm
    const setQ = (v) => { sp.qty = Math.max(1, Math.min(max, Math.round(v))); sp.sig = ""; sp.draw(); };
    pressButton("button_minus", 122, 546, 156, 156, () => setQ(qty - 1), "Less", B); pressButton("button_plus", 816, 546, 156, 156, () => setQ(qty + 1), "More", B);
    const tx = 219, tw = 502, track = el("div", { position: "absolute", left: tx + "px", top: "529px", width: tw + "px", height: "34px", border: "2px solid #0b4560", borderRadius: "17px", background: "#04202f", boxSizing: "border-box", cursor: "pointer" }, B);
    const thumbX = tx + 60 + (max > 1 ? (qty - 1) / (max - 1) : 0) * (tw - 120);
    pressButton("button_small_slider", thumbX, 546, 128, 128, () => {}, "", B).style.pointerEvents = "none";
    track.onpointerdown = (e) => { const k = A() && document.getElementById("port").firstChild.getBoundingClientRect(); const sx = k.width / 2048, f = ((e.clientX - k.left) / sx - 733 - tx - 60) / (tw - 120); setQ(1 + Math.max(0, Math.min(1, f)) * (max - 1)); };
    text(String(qty), 936, 518, 44, "#fff", T, B);
    const can = !!q && !why && qty <= aff;
    const ok = pressButton("button_confirm", 1170, 544, 156, 156, async () => { if (!can) return; try { if (kind === "s") await a.orderShips(pl.id, y.id, t, qty); else await a.simpleOrder("order " + qty + " × carrier", [[202, a.W.concat([a.W.v(1, y.id), a.W.ld(2, a.W.concat([a.W.v(1, t), a.W.v(2, 1), a.W.v(3, qty)]))])]]); sp.sel = null; sp.sig = ""; sp.draw(); } catch (e) { a.log(e.message, true); } }, can ? "Order" : why || "Not enough resources", B);
    if (!can) { ok.style.opacity = ".45"; ok.style.cursor = "default"; ok.onpointerenter = ok.onpointerleave = null; }
    // cost row (the same pieces as the headquarters' detail tab)
    image("list_bg_bar2", 35, 675, { parent: B });
    [[47, "res_icon_metal"], [355, "res_icon_gas"], [664, "res_icon_crystal"], [971, "res_icon_time"]].forEach(([x, n]) => image(n, x, 654, { parent: B }));
    [311, 617, 925].forEach((x) => image("line-blue_seperator", x, 651, { parent: B }));
    [230, 539, 848].forEach((x, i) => text(q ? fmt(per[i] * qty) : "", x, 670, 38, q && a.curAmount(pl, i + 1) < per[i] * qty ? "#ff7a66" : "#fff", { ...T, width: "0px", transform: "translateX(-50%)" }, B));
    text(q ? durTxt(q.seconds * qty) : "", 0, 670, 38, "#fff", { ...T, left: "auto", right: "74px" }, B);
    image("line-blue_corner_list", 24, 762 - 100 + 0, { parent: B }); hline(B, 56, 762, 1206);
    text(why || "No requirements needed", 50, 835, 44, why ? "#ff7a66" : "#12d4f4", T, B);
    image("line-blue_corner_list", 24, 935 - 100, { parent: B }); hline(B, 56, 935, 1206);
  }

  /* ---- Structures list (the wrench tab on the right): frame Random_Structures.PNG (recording Random.MP4 at 75.8 s), box 748,167 1300 x 1351 (flush with the right edge),
     header line 148, a line at 171 under the header, rows 172 apart (the first, NEW STRUCTURE, 169): round icon at x 90, two text lines (white name, cyan LEVEL n) at x 153,
     UPGRADE (156 px, dimmed when it cannot be paid or one is running) at x 982 and the forward button at x 1174. Not faithful: the round structure icons are rings I draw
     (the recording's ring sprites were not found), NEW STRUCTURE only opens a note (no reference for the build list; use the plain interface), slot order is a guess. ---- */
  const RINGS = { 1: "#17b2e8", 2: "#e8315a", 3: "#2fd060", 4: "#2fd060", 5: "#2fd060" };
  const GLYPH = { 1: "HQ_icon_white", 2: "headline_icon_shipyard-fleets", 3: "res_icon_metal", 4: "res_icon_gas", 5: "res_icon_crystal", new: "res_icon_resources" };
  function ringIcon(parent, cx, cy, type) {
    if (BTN[type]) return image("button_structure_" + BTN[type] + "_0", cx - 78, cy - 78, { parent });   // the original round button (white disc, glyph, blue glow)
    const c = el("div", { position: "absolute", left: cx - 40 + "px", top: cy - 40 + "px", width: "80px", height: "80px", boxSizing: "border-box", borderRadius: "50%", border: "3px solid " + (type === "new" ? "#f1e23a" : RINGS[type] || "#17b2e8"), background: "#04141f" }, parent);
    const im = image(GLYPH[type] || SICON[type] || "headline_icon_structure", 0, 0, { parent: c }); im.onload = () => { const k = Math.min(1, 50 / Math.max(im.naturalWidth, im.naturalHeight)); im.style.width = im.naturalWidth * k + "px"; im.style.left = (74 - im.naturalWidth * k) / 2 + "px"; im.style.top = (74 - im.naturalHeight * k) / 2 + "px"; };
  }
  const sqCache = new Map();
  function structQ(pl, type, level) { const k = pl.id + ":" + type + ":" + level; if (!sqCache.has(k)) { const pr = A().quote(pl.id, type, level); sqCache.set(k, { v: null }); pr.then((v) => { sqCache.get(k).v = v; if (sl) sl.sig = ""; }); } return sqCache.get(k).v; }
  let sl = null;
  function openStructureList() {
    const a = A(), S = a.S, p0 = S.planets.get(S.selected); if (!p0 || sl) return;
    const p = panel({ rank: true, x: 748, y: 167, w: 1300, h: 1351, icon: "headline_icon_structure-list", title: "STRUCTURES", headY: 148, crossY: [623, 897, 1173], crossCenter: true, ref: "Random_Structures.PNG", onClose: () => { sl = null; } });
    sl = { p, planet: p0.id, sig: "", body: null, draw: null };
    const bb = image("button_back_0", 108 - 78, 1425 - 78, { click: () => p.close() }); bb.title = "Back"; bb.onpointerenter = () => (bb.src = art("button_back_1")); bb.onpointerleave = () => (bb.src = art("button_back_0")); bb.style.zIndex = 40; p.extra = bb;
    p.close0 = p.close; p.close = () => { bb.remove(); p.close0(); };
    sl.scrollTop = 0;
    sl.draw = () => {
      const pl = A().S.planets.get(sl.planet); if (!pl) return;
      const list = [...pl.structures.filter((x) => x.level > 0), ...pl.builds.filter((b) => !pl.structures.some((x) => x.slot === b.slot && x.level > 0)).map((b) => ({ type: b.type, slot: b.slot, level: 0 }))].sort((x, y) => x.slot - y.slot);   // a structure that is only being built shows as LEVEL 0 -> 1
      const sig = JSON.stringify([list.map((x) => [x.type, x.slot, x.level]), pl.builds.map((b) => [b.slot, Math.round(b.end - A().nowSrv())]), [1, 2, 3].map((t) => Math.floor(A().curAmount(pl, t) / 10)), list.map((x) => !!structQ(pl, x.type, x.level + 1))]);
      if (sig === sl.sig) return; sl.sig = sig;
      if (sl.body) sl.body.remove(); const B = el("div", { position: "absolute", left: 0, top: 0, width: "1300px", height: "1351px" }, sl.p.root); sl.body = B;
      hline(B, 35, 171, 1229);
      const sk = scrollKeep(sl, B, 17, 172, 1245, 1180, 1247), I = sk.I, dx = 17;   // the rows scroll: 12 slots do not fit
      const used = new Set([...pl.structures.map((x) => x.slot), ...pl.builds.map((b) => b.slot)]), left = Math.max(0, 12 - used.size);
      row(I, 0, dx, { ring: "new", name: "NEW STRUCTURE", nameColor: "#f5ee4a", sub: left + " SLOT" + (left === 1 ? "" : "S") + " LEFT", subColor: "#f5ee4a", buttons: (y) => pressButton("button_structure_construct", 1174 - dx, y, 156, 156, () => { p.close(); openBuildList(pl.id); }, "New structure", I) });
      list.forEach((st, i) => {
        const bld = pl.builds.find((b) => b.slot === st.slot), q = structQ(pl, st.type, st.level + 1);
        const short = q ? [1, 2, 3].some((t, k) => A().curAmount(pl, t) < q.cost[k]) : true, can = !!q && !bld && !short && st.level < 20;
        row(I, (i + 1) * 172, dx, { ring: st.type, name: (A().STRUCT[st.type] || "Structure " + st.type).toUpperCase(), sub: "LEVEL " + st.level + (bld ? " → " + bld.level : ""),
          buttons: (y) => {
            if (bld) speedUp(I, 982 - dx, y, bld); else { const ub = pressButton("button_upgrade", 982 - dx, y, 156, 156, async () => { if (!can) return; try { await A().buildOrUpgrade(pl.id, st.type, st.slot, st.level + 1); sl.sig = ""; } catch (e) { A().log(e.message, true); } }, can ? "Upgrade to level " + (st.level + 1) : "Cannot upgrade", I); if (!can) dimmed(ub); }
            pressButton("button_next", 1174 - dx, y, 156, 156, () => { p.close(); openStructure(st.type, st.slot); }, "Open", I);
          } });
      });
      sk.done((list.length + 1) * 172 + 10);
    };
    sl.draw();
  }

  /* ---- The pieces the 12 home tutorial missions need (2026-11-13). No recording shows them, so they are built from the game's own parts and the layouts of the screens that exist:
     NEW STRUCTURE (the structure list's rows with the round button_structure_* sprites and the wrench button), the laboratory's RESEARCH tab and the scanner's SCAN / MISSIONS tabs (the
     shipyard list's rows), SPEED UP (the game's button_speedup, the price from the read-only /debug/quote ?speedup=, request 501), the shipyard's running orders, SEND A CARRIER and LOAD SHIPS
     (dialog box). Not faithful: positions, texts of my own (cost lines, "IN PRODUCTION"), the carrier / mission screens of the original are unknown. ---- */
  const BTN = { 1: "hq", 2: "shipyard", 3: "metal", 4: "gas", 5: "crystal", 6: "barracks", 7: "research", 8: "scanner", 9: "shield", 10: "trade", 11: "citadel" };   // the game's round structure buttons (button_structure_*)
  const syncCache = new Map();
  function cq(key, mk) {   // a server answer (a promise) kept as a plain value for the redraws; the open panels redraw when it arrives
    let e = syncCache.get(key);
    if (!e) { e = { v: undefined }; syncCache.set(key, e); Promise.resolve(mk()).then((v) => { e.v = v || null; if (sp) sp.qv++; if (bl) bl.sig = ""; }); }
    return e.v;
  }
  const bumpAll = () => { if (sp) sp.sig = ""; if (sl) sl.sig = ""; if (bl) bl.sig = ""; update(); };
  const spCache = new Map();
  function speedQ(job) {
    const now = Date.now(); let e = spCache.get(job.id);
    if (!e || now - e.t > 8000) { const n = e || { v: null }; n.t = now; spCache.set(job.id, n); e = n; A().quoteJson("planet=" + A().S.order[0] + "&speedup=" + job.id).then((q) => { n.v = q; if (sp) sp.sig = ""; if (sl) sl.sig = ""; if (bl) bl.sig = ""; }); }
    return e.v;
  }
  function speedUp(parent, cx, cy, job) {   // the game's round button_speedup and the price in credits left of it; request 501 {1 job}
    const a = A(); if (!job || !job.id || job.end <= a.nowSrv()) return null;
    const q = speedQ(job), price = q && q.left > 0 ? q.price : null, ok = price != null && price <= q.credits;
    const b = pressButton("button_speedup", cx, cy, 156, 156, async () => {
      if (!ok) return; try { await a.call([[501, a.W.v(1, job.id)]]); await a.refreshAccount(); await a.refreshPlanets(a.S.order); } catch (e) { dialog("SPEED UP", "The server refused: " + (e.message || e)); } bumpAll();
    }, price == null ? "Speed up" : "Speed up for " + fmt(price) + " credits", parent);
    if (!ok) { b.style.opacity = ".5"; b.style.cursor = "default"; }
    if (price != null) text(fmt(price), cx - 92, cy - 28, 38, "#f2a516", { textShadow: "none", lineHeight: "56px", transform: "translateX(-100%)" }, parent);
    return b;
  }
  const jobSig = (pl) => [pl.builds, pl.shipJobs, pl.carrierJobs, pl.droneJobs, pl.troopJobs, pl.digJobs, pl.research, pl.scans].map((l) => l.map((j) => [j.id, Math.round(j.end - A().nowSrv())]));
  function scrollKeep(owner, B, x, y, w, h, barX) {   // a scroller that keeps its position over the redraws
    const keep = owner.scrollTop || 0, sc = scroller(B, x, y, w, h, barX);
    sc.view.addEventListener("scroll", () => (owner.scrollTop = sc.view.scrollTop));
    return { I: sc.inner, done(height) { sc.setHeight(height); sc.view.scrollTop = keep; } };
  }
  const costLine = (q, n = 1) => q ? q.cost.map((c) => fmt(c * n)).join(" / ") + " · " + durTxt(q.seconds * n) : "…";
  const shortOf = (a, pl, cost) => [1, 2, 3].filter((t, i) => a.curAmount(pl, t) < cost[i]).map((t) => a.RES[t].toLowerCase());
  const RT = { textShadow: "none", lineHeight: "56px" };
  function row(I, top, dx, o) {   // one 172 px row: optional round structure sprite, a white name, a second line, the buttons from o.buttons(y)
    const x0 = (o.ring ? 153 : 56) - dx;
    image("list_bg_bar2", (o.ring ? 135 : 35) - dx, top + 78, { parent: I }).style.width = (o.barW || 800) + "px";
    if (o.ring) ringIcon(I, 90 - dx, top + 90, o.ring);
    text(o.name, x0, top + 28, 44, o.dim ? "#7e96a6" : o.nameColor || "#fff", { ...RT, letterSpacing: "2px" }, I);
    text(o.sub, x0, top + 89, 40, o.subColor || "#27d0f0", RT, I);
    if (o.buttons) o.buttons(top + 87);
    image("line-blue_corner_list", 24 - dx, top + 172 - 100, { parent: I }); hline(I, 56 - dx, top + 172, 1206);
  }
  const dimmed = (b) => { b.style.opacity = ".4"; b.style.cursor = "default"; b.onpointerenter = b.onpointerleave = null; return b; };

  /* NEW STRUCTURE: the build list. Slot = the first free one of the 12; the server prices come from /debug/quote. */
  let bl = null;
  const BUILD_ORDER = [3, 4, 5, 2, 6, 7, 8, 9, 10, 11];
  function openBuildList(planetId) {
    const a = A(); if (bl) return;
    const p = panel({ rank: true, x: 748, y: 167, w: 1300, h: 1351, icon: "headline_icon_structure-list", title: "NEW STRUCTURE", headY: 148, crossY: [623, 897, 1173], crossCenter: true, ref: "Random_Structures.PNG", onClose: () => { if (bl && bl.bb) bl.bb.remove(); bl = null; } });
    const bb = image("button_back_0", 108 - 78, 1425 - 78, { click: () => { p.close(); openStructureList(); } }); bb.title = "Back"; bb.onpointerenter = () => (bb.src = art("button_back_1")); bb.onpointerleave = () => (bb.src = art("button_back_0")); bb.style.zIndex = 40;
    bl = { p, planet: planetId, sig: "", body: null, bb, citadel: false, scrollTop: 0 };
    a.quoteJson("planet=" + planetId + "&dig=0").then((q) => { if (bl) { bl.citadel = !!(q && q.item); bl.sig = ""; } });   // the game offers a Citadel on citadel planets only
    bl.draw = () => {
      const pl = a.S.planets.get(bl.planet); if (!pl) return;
      const used = new Set([...pl.structures.map((x) => x.slot), ...pl.builds.map((b) => b.slot)]); let free = -1; for (let s = 0; s < 12; s++) if (!used.has(s)) { free = s; break; }
      const types = BUILD_ORDER.filter((t) => t !== 11 || bl.citadel), qs = types.map((t) => cq("b:" + pl.id + ":" + t, () => a.quote(pl.id, t, 1)));
      const sig = JSON.stringify([free, types, qs.map((q) => q && q.cost), [1, 2, 3].map((t) => Math.floor(a.curAmount(pl, t) / 10))]);
      if (sig === bl.sig) return; bl.sig = sig; if (bl.body) bl.body.remove();
      const B = el("div", { position: "absolute", left: 0, top: 0, width: "1300px", height: "1351px" }, bl.p.root); bl.body = B; hline(B, 35, 171, 1229);
      const sk = scrollKeep(bl, B, 17, 172, 1245, 1180, 1247), I = sk.I, dx = 17;
      types.forEach((t, i) => {
        const q = qs[i], short = q ? shortOf(a, pl, q.cost) : ["?"], can = !!q && free >= 0 && !short.length, top = i * 172;
        row(I, top, dx, { ring: t, name: (a.STRUCT[t] || "Structure " + t).toUpperCase(), sub: free < 0 ? "NO FREE SLOT" : q ? costLine(q) + (short.length ? " — NOT ENOUGH " + short.join(", ").toUpperCase() : "") : "…", subColor: free < 0 || short.length ? "#ff7a66" : "#27d0f0",
          buttons: (y) => { const b = pressButton("button_structure_construct", 1174 - dx, y, 156, 156, async () => { if (!can) return; try { await a.buildOrUpgrade(pl.id, t, free, 1); } catch (e) { a.log(e.message, true); return; } p.close(); openStructureList(); }, can ? "Build " + (a.STRUCT[t] || "") : (free < 0 ? "No free slot" : "Not enough resources") + ": " + (a.STRUCT[t] || ""), I); if (!can) dimmed(b); } });
      });
      sk.done(types.length * 172 + 10);
    };
    bl.draw();
  }

  /* running orders of the shipyard (DETAIL tab, below the demolish row) */
  function queueRows(B, y, jobs) {
    const a = A(); if (!jobs.length) return;
    text("IN PRODUCTION", 44, y, 44, "#12d4f4", RT, B); y += 76;
    jobs.forEach((j) => { image("list_bg_bar2", 35, y + 5, { parent: B }).style.width = "850px"; text(j.label + "   " + durTxt(j.job.end - a.nowSrv()), 56, y, 38, "#fff", RT, B); speedUp(B, 1100, y + 26, j.job); y += 130; });
  }

  /* LABORATORY, RESEARCH tab: the 14 technologies of the home laboratory (request 206; price, gates and time from /debug/quote ?tech=) */
  function labTab(B, pl) {
    const a = A(), lab = pl.structures.find((x) => x.type === 7 && x.level > 0); if (!lab) return;
    if (pl.id !== a.S.order[0]) { text("Research is done at the home planet's laboratory.", 56, 345, 38, SKY, RT, B); return; }
    const have = new Map(pl.techs.map((t) => [t.tech, t.level])), busy = new Map(pl.research.map((j) => [j.tech, j])), used = new Set([...have.keys(), ...busy.keys()]);
    text(used.size + " OF 3 LABORATORY SLOTS IN USE", 56, 295, 38, SKY, RT, B);
    const sk = scrollKeep(sp, B, 17, 352, 1245, 1004, 1247), I = sk.I, dx = 17;
    a.TECH_ORDER.forEach((id, i) => {
      const level = have.get(id) || 0, job = busy.get(id), t = a.TECH[id] || ["Technology " + id, ""], q = job ? null : cq("t:" + pl.id + ":" + id + ":" + (level + 1) + ":" + lab.level, () => a.quoteTech(pl.id, id, level + 1, lab.id, lab.level));
      let why = ""; if (q) { if (q.level > q.max_level) why = "MAXIMUM LEVEL"; else if (!used.has(id) && used.size >= q.slots) why = "ALL " + q.slots + " LABORATORY SLOTS IN USE"; else if (q.lab_level < q.lab_needed) why = "NEEDS LABORATORY LEVEL " + q.lab_needed; else if (q.item && !q.item_owned) why = "NEEDS A BLUEPRINT ITEM"; else { const s = shortOf(a, pl, q.cost); if (s.length) why = "NOT ENOUGH " + s.join(", ").toUpperCase(); } }
      const can = !!q && !why;
      row(I, i * 172, dx, { name: t[0].toUpperCase() + (level ? "   LEVEL " + level : ""), sub: job ? "RESEARCHING LEVEL " + job.level + " · " + durTxt(job.end - a.nowSrv()) : why ? why : q ? "LEVEL " + q.level + ": " + costLine(q) : "…", subColor: why ? "#ff7a66" : "#27d0f0", dim: !job && !!why,
        buttons: (y) => { if (job) { speedUp(I, 1174 - dx, y, job); return; } const b = pressButton("button_upgrade", 1174 - dx, y, 156, 156, async () => { if (!can) return; try { await a.orderResearch(lab.id, id, level + 1); } catch (e) { a.log(e.message, true); dialog("RESEARCH", "The server refused: " + (e.message || e)); } bumpAll(); }, can ? "Research" : why, I); if (!can) dimmed(b); } });
    });
    sk.done(a.TECH_ORDER.length * 172 + 10);
  }

  /* SCANNER, SCAN tab: spy drones (211), quick / deep scan (204), running scans (210 collect, 501 speed up) */
  function scanTab(B, pl) {
    const a = A(), sc = pl.structures.find((x) => x.type === 8 && x.level > 0); if (!sc) return;
    const drones = (pl.resources.find((r) => r.type === 5) || {}).amount || 0, sk = scrollKeep(sp, B, 17, 286, 1245, 1070, 1247), I = sk.I, dx = 17; let top = 0;
    const dq = cq("d:" + pl.id + ":" + sc.id, () => a.quoteJson("planet=" + pl.id + "&unit=drone&yard=" + sc.id)), n = Math.max(1, sp.qty), cost = dq ? dq.cost.map((c) => c * n) : [0, 0, 0], dShort = dq ? shortOf(a, pl, cost) : ["?"];
    row(I, top, dx, { name: "SPY DRONES   " + fmt(drones) + " IN STOCK", sub: (dq ? costLine(dq, n) : "…") + (dShort.length && dq ? " — NOT ENOUGH " + dShort.join(", ").toUpperCase() : ""), subColor: dShort.length && dq ? "#ff7a66" : "#27d0f0", barW: 640,
      buttons: (y) => {
        pressButton("button_minus", 770 - dx, y, 156, 156, () => { sp.qty = Math.max(1, sp.qty - 1); sp.sig = ""; sp.draw(); }, "Fewer", I); text(String(n), 868 - dx, y - 28, 44, "#fff", { ...RT, width: "100px", textAlign: "center" }, I); pressButton("button_plus", 1010 - dx, y, 156, 156, () => { sp.qty = Math.min(9999, sp.qty + 1); sp.sig = ""; sp.draw(); }, "More", I);
        const b = pressButton("button_confirm", 1174 - dx, y, 156, 156, async () => { if (dShort.length || !dq) return; try { await a.simpleOrder("order " + n + " spy drones", [[211, a.W.concat([a.W.v(1, sc.id), a.W.v(2, n)])]]); } catch (e) { dialog("SPY DRONES", "The server refused: " + (e.message || e)); } bumpAll(); }, "Build spy drones", I); if (dShort.length || !dq) dimmed(b); } });
    top += 172;
    for (const j of pl.droneJobs) { row(I, top, dx, { name: j.count + " SPY DRONES", sub: "READY IN " + durTxt(j.end - a.nowSrv()), buttons: (y) => speedUp(I, 1174 - dx, y, j) }); top += 172; }
    [[0, "QUICK SCAN"], [1, "DEEP SCAN"]].forEach(([range, name]) => {
      const q = cq("s:" + pl.id + ":" + range, () => a.quoteJson("planet=" + pl.id + "&scan=" + range)), why = q && drones < q.drones ? "NEEDS " + q.drones + " SPY DRONE" + (q.drones > 1 ? "S" : "") : "", can = !!q && !why;
      row(I, top, dx, { name, sub: q ? q.drones + " DRONE" + (q.drones > 1 ? "S" : "") + " · " + durTxt(q.seconds) + (why ? " — " + why : "") : "…", subColor: why ? "#ff7a66" : "#27d0f0",
        buttons: (y) => { const b = pressButton("button_confirm", 1174 - dx, y, 156, 156, async () => { if (!can) return; try { await a.simpleOrder("start a " + name.toLowerCase(), [[204, a.W.concat([a.W.v(1, sc.id), a.W.v(2, range)])]]); } catch (e) { dialog(name, "The server refused: " + (e.message || e)); } bumpAll(); }, can ? "Start the scan" : why, I); if (!can) dimmed(b); } });
      top += 172;
    });
    for (const j of pl.scans) {
      const done = j.end <= a.nowSrv();
      row(I, top, dx, { name: (j.range ? "DEEP SCAN" : "QUICK SCAN") + " RUNNING", sub: done ? "READY TO COLLECT" : durTxt(j.end - a.nowSrv()) + " LEFT", subColor: done ? "#7fe619" : "#27d0f0",
        buttons: (y) => { if (!done) { speedUp(I, 1174 - dx, y, j); return; } pressButton("button_job-ready", 1174 - dx, y, 156, 156, async () => { try { await a.simpleOrder("collect the scan", [[210, a.W.v(1, j.id)]]); } catch (e) { dialog("SCAN", "The server refused: " + (e.message || e)); } bumpAll(); }, "Collect the scan", I); } });
      top += 172;
    }
    sk.done(top + 10);
  }

  /* BARRACKS, TROOPS tab: train troops (request 209 {1 barracks, 2 count}; price and time from /debug/quote ?unit=troop), the running orders with SPEED UP. The step of minus / plus grows with the count. */
  const stepOf = (n) => (n >= 200 ? 100 : n >= 20 ? 10 : 1);
  function troopTab(B, pl) {
    const a = A(), br = pl.structures.find((x) => x.type === 6 && x.level > 0); if (!br) return;
    const stock = (pl.resources.find((r) => r.type === 4) || {}).amount || 0, sk = scrollKeep(sp, B, 17, 286, 1245, 1070, 1247), I = sk.I, dx = 17; let top = 0;
    const q = cq("tr:" + pl.id + ":" + br.id, () => a.quoteJson("planet=" + pl.id + "&unit=troop&yard=" + br.id)), n = Math.max(1, sp.qty), cost = q ? q.cost.map((c) => c * n) : [0, 0, 0], short = q ? shortOf(a, pl, cost) : ["?"];
    row(I, top, dx, { name: "TROOPS   " + fmt(stock) + " IN STOCK", sub: (q ? costLine(q, n) : "…") + (short.length && q ? " — NOT ENOUGH " + short.join(", ").toUpperCase() : ""), subColor: short.length && q ? "#ff7a66" : "#27d0f0", barW: 640,
      buttons: (y) => {
        pressButton("button_minus", 770 - dx, y, 156, 156, () => { sp.qty = Math.max(1, sp.qty - stepOf(sp.qty - 1)); sp.sig = ""; sp.draw(); }, "Fewer troops", I); text(String(n), 868 - dx, y - 28, 44, "#fff", { ...RT, width: "100px", textAlign: "center" }, I); pressButton("button_plus", 1010 - dx, y, 156, 156, () => { sp.qty = Math.min(9999, sp.qty + stepOf(sp.qty)); sp.sig = ""; sp.draw(); }, "More troops", I);
        const b = pressButton("button_confirm", 1174 - dx, y, 156, 156, async () => { if (short.length || !q) return; try { await a.simpleOrder("train " + n + " troops", [[209, a.W.concat([a.W.v(1, br.id), a.W.v(2, n)])]]); } catch (e) { dialog("TROOPS", "The server refused: " + (e.message || e)); } bumpAll(); }, "Train troops", I); if (short.length || !q) dimmed(b); } });
    top += 172;
    for (const j of pl.troopJobs) { row(I, top, dx, { name: j.count + " TROOPS", sub: "READY IN " + durTxt(j.end - a.nowSrv()), buttons: (y) => speedUp(I, 1174 - dx, y, j) }); top += 172; }
    sk.done(top + 10);
  }

  /* SCANNER, MISSIONS tab: the planet's missions (expected enemy, time left), SEND opens the carrier chooser (request 205) */
  function missionTab(B, pl) {
    const a = A(), S = a.S, mine = S.missions.filter((m) => m.planet === pl.id), home = S.planets.get(S.order[0]), sk = scrollKeep(sp, B, 17, 286, 1245, 1070, 1247), I = sk.I, dx = 17;
    if (!mine.length) text("No missions yet: build spy drones and run a scan.", 56 - dx, 40, 38, SKY, RT, I);
    mine.forEach((m, i) => {
      const away = (home ? home.carriers : []).find((c) => c.travel && c.travel.mission === m.id), enemy = m.enemy.length ? m.enemy.map((e) => (a.SHIP[e.ship] || "ship " + e.ship) + " (threat " + e.threat + ")").join(", ") : "no enemy fleet";
      row(I, i * 172, dx, { name: (a.MISSION[m.type] || "Mission " + m.type).toUpperCase() + "   LEVEL " + m.level, sub: away ? "CARRIER #" + away.id + " BACK IN " + durTxt(away.travel.end - a.nowSrv()) : "EXPIRES IN " + durTxt(m.expires - a.nowSrv()) + " · " + enemy.toUpperCase(), subColor: away ? "#7fe619" : "#27d0f0", barW: 1000,
        buttons: (y) => { if (away) return; pressButton("button_next", 1174 - dx, y, 156, 156, () => sendCarrier(pl, m), "Send a carrier", I); } });
    });
    sk.done(Math.max(1, mine.length) * 172 + 10);
  }
  function sendCarrier(pl, m) {   // the carriers that stand here with ships aboard; 205 {1 carrier, 2 mission, 4 speed}
    const a = A(), idle = a.carriersAt(pl.id).filter((c) => !c.travel && !c.move && c.ships.length);
    const p = panel({ x: 127, y: 168, w: 1792, h: 1200, icon: "headline_icon_missions", title: "SEND A CARRIER", headY: 140, closeDx: 97, titleX: 239, crossY: [383, 661, 937, 1215], dim: true });
    hline(p.root, 36, 162, 1792 - 73);
    text((a.MISSION[m.type] || "Mission").toUpperCase() + "   LEVEL " + m.level, 57, 192, 44, "#fff", RT, p.root);
    if (!idle.length) { text("No carrier with ships aboard is here.\nBuild a carrier, then load fighters into it:\nFLEETS → the carrier → LOAD SHIPS.", 57, 292, 44, SKY, { ...RT, whiteSpace: "pre-line", lineHeight: "60px" }, p.root); return; }
    idle.slice(0, 6).forEach((c, i) => {
      const y = 290 + i * 150, band = Math.min(3, Math.floor(((c.type || 1) - 1) / 4));
      image("list_bg_bar2", 40, y + 44, { parent: p.root }).style.width = "1500px";
      text("CARRIER #" + c.id + "   MK " + ["I", "II", "III", "VOID"][band] + " · LEVEL " + (c.level || 1) + "   " + c.ships.map((x) => x.count + " × " + (a.SHIP[x.type] || x.type)).join(", "), 57, y, 40, "#fff", RT, p.root);
      pressButton("button_confirm", 1660, y + 25, 156, 156, async () => { p.close(); try { await a.simpleOrder("send carrier #" + c.id + " on " + (a.MISSION[m.type] || "a mission"), [[205, a.sendRequest(c.id, m.id)]]); if (a.S.sent) a.S.sent.add(m.id); } catch (e) { dialog("SEND A CARRIER", "The server refused: " + (e.message || e)); } bumpAll(); }, "Send carrier #" + c.id, p.root);
    });
  }

  /* LOAD SHIPS (carrier detail, left column): what is aboard becomes the chosen counts (request 110, the cargo stays as it is) */
  function loadShips(c) {
    const a = A(), W = a.W, aboard = Object.fromEntries(c.ships.map((x) => [x.type, x.count]));
    const atRec = () => a.S.planets.get(c.at) || (c.at ? null : a.S.planets.get(a.S.order[0]));   // the planet the carrier stands at (a colony's record is fetched when it is not loaded yet)
    const onP = () => Object.fromEntries((atRec() || { ships: [] }).ships.map((x) => [x.type, x.count])), typesNow = () => [...new Set([...Object.keys(onP()), ...Object.keys(aboard)])].map(Number).sort((x, y) => x - y).slice(0, 8);
    const want = { ...aboard }, cargo = { 1: 0, 2: 0, 3: 0, 4: 0 }, now = { 1: 0, 2: 0, 3: 0, 4: 0 }; let cap = null, perShip = null;
    if (c.travel || c.move || c.moving || !a.S.order.includes(c.at || a.S.order[0])) {   // the server loads from the own planet the carrier stands at (handle_110)
      dialog("LOAD SHIPS", c.travel || c.move || c.moving ? "Carrier #" + c.id + " is in flight. Ships and cargo can be loaded when it has landed." : "Carrier #" + c.id + " is not at one of your planets. Relocate it to one of your planets to load or unload ships and cargo."); return;
    }
    const stock = (t) => { const r = atRec(); return r ? Math.floor(t < 4 ? a.curAmount(r, t) : (r.resources.find((x) => x.type === 4) || {}).amount || 0) : 0; };
    const p = panel({ x: 127, y: 168, w: 1792, h: 1200, icon: "headline_icon_fleets", title: "LOAD SHIPS", headY: 140, closeDx: 97, titleX: 239, crossY: [383, 661, 937, 1215], dim: true }), body = el("div", { position: "absolute", left: 0, top: 0, width: "1792px", height: "1200px" }, p.root);
    hline(p.root, 36, 162, 1792 - 73);
    const small = (base, cx, cy, click, title) => { const b = pressButton(base, cx, cy, 84, 84, click, title, body); b.style.width = "84px"; b.style.height = "84px"; return b; };
    if (!atRec()) a.refreshPlanets([c.at]).then(() => draw()).catch(() => {});
    a.quoteMove(c.id, c.at || a.S.order[0]).then((q) => { if (q) { cap = q.capacity; perShip = q.per_ship || null; for (const t of [1, 2, 3, 4]) now[t] = cargo[t] = (q.cargo && q.cargo[t]) || 0; } draw(); });   // what is aboard now (the load sets it, so it is kept) and the space
    const draw = () => {
      if (!p.root.isConnected) return;
      body.textContent = ""; const onPlanet = onP(), types = typesNow(); text("CARRIER #" + c.id + " AT " + (a.planetLabel ? a.planetLabel(c.at) : c.at), 57, 188, 44, "#fff", RT, body);
      if (!types.length) text(atRec() ? "There are no ships on this planet. Build some at the shipyard first." : "Loading the planet …", 57, 262, 40, SKY, RT, body);
      const rowAt = (y, label, val, dec, inc, all) => {
        image("list_bg_bar2", 40, y + 22, { parent: body }).style.width = "1130px"; text(label, 57, y, 36, "#fff", RT, body);
        small("button_minus", 1230, y + 30, dec, "Fewer"); text(fmt(val), 1285, y - 2, 40, "#fff", { ...RT, width: "190px", textAlign: "center" }, body); small("button_plus", 1530, y + 30, inc, "More"); small("button_next", 1640, y + 30, all, "All");
      };
      types.forEach((t, i) => { const max = (onPlanet[t] || 0) + (aboard[t] || 0), w = want[t] || 0; rowAt(262 + i * 72, (a.SHIP[t] || "Ship " + t).toUpperCase() + "   (MAX " + fmt(max) + ")", w, () => { want[t] = Math.max(0, w - 1); draw(); }, () => { want[t] = Math.min(max, w + 1); draw(); }, () => { want[t] = max; draw(); }); });
      // the space of the NEW loadout (one ship's space from the server's quote); keeping or lowering what is aboard is always allowed
      const space = perShip ? Object.entries(want).reduce((s, [t, n]) => s + (n || 0) * (perShip[t] || 0), 0) : cap;
      const y0 = 262 + types.length * 72 + 18, total = cargo[1] + cargo[2] + cargo[3] + cargo[4], over = space != null && total > space && total > now[1] + now[2] + now[3] + now[4];
      text("CARGO", 57, y0, 40, SKY, RT, body); if (space != null) text(fmt(total) + " OF " + fmt(space) + " SPACE", 700, y0, 36, over ? "#ff7a66" : "#27d0f0", RT, body);
      [1, 2, 3, 4].forEach((t, k) => { const max = stock(t) + now[t], step = t === 4 ? 10 : 100; rowAt(y0 + 56 + k * 72, (a.RES[t] || "Resource " + t).toUpperCase() + "   (MAX " + fmt(max) + ")", cargo[t], () => { cargo[t] = Math.max(0, cargo[t] - step); draw(); }, () => { cargo[t] = Math.min(max, cargo[t] + step); draw(); }, () => { cargo[t] = Math.max(0, Math.min(max, cap == null ? max : Math.max(0, cap - (total - cargo[t])))); draw(); }); });
      const ok = pressButton("button_confirm", 1690, 1085, 156, 156, async () => {
        if (over || cap == null) return; const ts = typesNow();
        p.close(); const req = [W.v(1, c.id), W.ld(2, W.concat(ts.filter((t) => (want[t] || 0) > 0).map((t) => W.ld(1, W.concat([W.v(1, t), W.v(2, want[t])]))))), W.ld(3, W.concat([1, 2, 3, 4].filter((t) => cargo[t] > 0).map((t) => W.ld(1, W.concat([W.v(1, t), W.v(2, cargo[t])])))))];
        try { await a.simpleOrder("load carrier #" + c.id, [[110, W.concat(req)]]); } catch (e) { dialog("LOAD SHIPS", "The server refused: " + (e.message || e)); return; }
        const f = freshCarrier(c.id); if (f && cv3 && cv3.c && cv3.c.id === c.id) openCarrier(f);   // the carrier view shows the new load
      }, over ? "More than the carrier can hold" : "Load", body); if (over || cap == null) dimmed(ok);
    };
    draw();
  }

  /* ---- JUMPGATE (system view, the button_jumpgate at the bottom right): closed until the 12 home missions are done (the server answers 9241; the page asks the read-only quote first),
     then request 241 gives the start planet and the game's OPENED_JUMPGATE dialog (frame Random2.MP4 at about 112 s: the box with the advisor on the right); once open the button goes to the start planet. ---- */
  async function openJumpgate() {
    const a = A(), S = a.S, start = S.jumpgate && S.jumpgate.planet;
    if (start) { S.selected = start; try { await a.refreshPlanets([start]); } catch (e) { /* the poll catches up */ } showView("planet"); return; }
    const q = await a.quoteJson("planet=" + S.order[0] + "&jumpgate=1");
    if (q && q.locked) { dialog("JUMPGATE", "The jumpgate is still closed. Finish the tutorial missions of the home system first:\n" + q.left.map((x) => "- " + x.text).join("\n")); return; }
    try { await a.call([[241, new Uint8Array(0)]]); await a.refreshAccount(); } catch (e) { dialog("JUMPGATE", "Unable to open jumpgate.\n" + (e.message || e)); return; }
    const d = dialog("JUMPGATE OPENED", "Now that we've opened the jumpgate for the first time, there's some important information you should know.\n\n- Our home system is always safe from enemy attacks. No other commander can see or access it.\n\n- Alliances will now be an essential part of our operations. Let's create one ourselves or join an existing one.\n\n- The amount of planets we can hold outside of our home system is limited, as is the number of ships and carriers. The limit increases with every new commander level (the current limits are displayed in the commander profile).\n\n- When a fleet passes through a jumpgate, it will be put on a cooldown before it can be used again.");
    const pi = image(bigPortrait(1, true), 0, 0, { parent: d.root }); pi.onload = () => { const k = 0.7; pi.style.width = pi.naturalWidth * k + "px"; pi.style.left = 1420 - pi.naturalWidth * k / 2 + "px"; pi.style.top = 560 - pi.naturalHeight * k / 2 + "px"; };
  }

  /* ---- PLANET ORDERS (2026-11-13): what tapping a planet that is not yours does after the tutorial. No recording shows the original's screen for it, so it is built from the dialog box and the
     rows of the lists: the planet's quality and resource levels, then for a free planet COLONISE, for an own one RELOCATE HERE (request 203, order 6 / 2), for a pirate base or another player the
     INTEL (latest spy report), SPY DRONES (327, success / detection from /debug/quote ?spy=) and ATTACK (203, order 1) with the odds from /debug/quote ?attack= (two taps: the second confirms).
     Opened from a planet in the system view and from a system on the galaxy map (the list of its planets). Same rules and quotes as the plain interface (app.js openAttack, galaxy.js renderOrders). ---- */
  let ord = null;
  function openOrders(t) {   // t = { id, name, quality, res, label: "free" | "yours" | "pirate base" | "another player", owner }
    const a = A(), S = a.S; if (ord) ord.p.close();
    const p = panel({ x: 127, y: 168, w: 1792, h: 1200, icon: "headline_icon_planet", title: t.name.toUpperCase(), headY: 140, closeDx: 97, titleX: 239, crossY: [383, 661, 937, 1215], dim: true, onClose: () => { ord = null; } });
    hline(p.root, 36, 162, 1792 - 73);
    ord = { p, t, body: null, q: {}, armed: null, note: "", noteBad: false, qty: 3 };
    const get = (key, fn) => { if (!(key in ord.q)) { ord.q[key] = undefined; fn().then((v) => { if (ord && ord.p === p) { ord.q[key] = v || null; ord.draw(); } }); } return ord.q[key]; };
    const attack = t.label === "pirate base" || t.label === "another player";
    ord.draw = () => {
      if (ord.body) ord.body.remove(); const B = el("div", { position: "absolute", left: 0, top: 0, width: "1792px", height: "1200px" }, p.root); ord.body = B;
      const home = S.planets.get(S.order[0]), res = t.res || {}, sub = (s, y) => text(s, 57, y, 40, SKY, RT, B);
      text("QUALITY " + (t.quality == null ? "?" : t.quality) + "   METAL " + (res[1] || "?") + "   GAS " + (res[2] || "?") + "   CRYSTAL " + (res[3] || "?"), 57, 192, 44, "#fff", RT, B);
      text(t.label === "free" ? "UNCLAIMED" : t.label === "yours" ? "YOUR PLANET" : (t.owner || t.label).toUpperCase(), 57, 248, 44, t.label === "free" ? "#7fe619" : t.label === "yours" ? "#27d0f0" : "#ff7a66", RT, B);
      if (ord.note) text(ord.note, 1735, 192, 40, ord.noteBad ? "#ff7a66" : "#7fe619", { ...RT, transform: "translateX(-100%)" }, B);
      const row = (c, y, order, line, color, can, label) => {   // one carrier: name and ships, a line of numbers, the send button (an attack asks twice)
        const key = c.id + ":" + order, armed = ord.armed === key;
        image("list_bg_bar2", 40, y + 52, { parent: B }).style.width = "1500px";
        text("CARRIER #" + c.id + "   " + (c.ships.length ? c.ships.map((x) => x.count + " × " + (a.SHIP[x.type] || x.type)).join(", ") : "NO SHIPS"), 57, y, 40, "#fff", RT, B);
        text(armed ? "TAP AGAIN TO CONFIRM THE " + label : line, 57, y + 46, 36, armed ? "#f2a516" : color, RT, B);
        const b = pressButton("button_confirm", 1660, y + 40, 156, 156, async () => {
          if (!can) return;
          if (order === 1 && !armed) { ord.armed = key; setTimeout(() => { if (ord && ord.armed === key) { ord.armed = null; ord.draw(); } }, 6000); ord.draw(); return; }
          ord.armed = null;
          try { await a.simpleOrder(label.toLowerCase() + " planet " + t.id + " with carrier #" + c.id, [[203, a.W.concat([a.W.v(1, c.id), a.W.v(2, order), a.W.v(3, t.id), a.W.dbl(5, 1.0)])]]); await a.refreshPlanets(a.S.order); ord.q = {}; ord.note = "CARRIER #" + c.id + " IS ON ITS WAY"; ord.noteBad = false; }
          catch (e) { ord.note = "THE SERVER REFUSED: " + (e.message || e); ord.noteBad = true; }
          bumpAll(); if (ord) ord.draw();
        }, can ? label + " with carrier #" + c.id : "Not possible", B); if (!can) dimmed(b);
      };
      if (!attack) {   // COLONISE a free planet / RELOCATE a carrier to an own one
        const order = t.label === "free" ? 6 : 2, label = order === 6 ? "COLONISE" : "RELOCATE", idle = home ? home.carriers.filter((c) => !c.travel && !c.move) : [];
        sub(order === 6 ? "COLONISE WITH A CARRIER" : "MOVE A CARRIER HERE", 308);
        if (!idle.length) text("No idle carrier: build one at the shipyard or wait until one is back.", 57, 372, 40, "#ff7a66", RT, B);
        idle.slice(0, 6).forEach((c, i) => {
          const q = get("m:" + c.id + ":" + t.id, () => a.quoteMove(c.id, t.id)), full = q && order === 6 && q.outer_limit != null && q.outer >= q.outer_limit;
          row(c, 370 + i * 140, order, q ? "TRIP " + durTxt(q.seconds) + (order === 6 && q.outer_limit != null ? " · PLANETS " + q.outer + "/" + q.outer_limit : "") + (full ? " — PLANET LIMIT REACHED" : "") : "…", full ? "#ff7a66" : "#27d0f0", !!q && !full, label);
        });
        return;
      }
      // ---- a pirate base / another player: intel, spy drones, attack
      const seen = a.latestSpy(t.id), d = seen && seen.d, troops = d ? (d.resources.find((x) => x.type === 4) || {}).amount : undefined, resl = d ? d.resources.filter((r) => r.type !== 4) : [];
      sub("INTEL", 308);
      if (!d) text("No spy report for this planet yet. An attack without intel is blind.", 57, 358, 40, "#fff", RT, B);
      else {
        text("Spy report " + durTxt(Math.max(0, a.nowSrv() - seen.time)) + " ago", 57, 358, 40, "#fff", RT, B);
        text("Fleet: " + a.shipsText(Object.fromEntries(d.ships.map((x) => [x.type, x.count]))) + " · troops: " + (troops == null ? "unknown" : fmt(troops)), 57, 404, 40, "#fff", RT, B);
        text("Resources: " + (resl.length ? resl.map((r) => fmt(r.amount) + " " + (a.RES[r.type] || r.type).toLowerCase()).join(", ") : "not found"), 57, 450, 40, "#fff", RT, B);
      }
      const sc = S.order.map((id) => S.planets.get(id)).find((x) => x && x.structures.some((s) => s.type === 8 && s.level > 0));
      if (!sc) text("No scanner yet: build one to send spy drones.", 57, 530, 40, "#ff7a66", RT, B);
      else {
        const scanner = sc.structures.find((s) => s.type === 8 && s.level > 0), have = (sc.resources.find((r) => r.type === 5) || {}).amount || 0, n = Math.max(1, ord.qty);
        const q = get("s:" + sc.id + ":" + n, () => a.quoteJson("planet=" + sc.id + "&spy=" + t.id + "&drones=" + n)), short = !q || q.have < q.drones;
        image("list_bg_bar2", 40, 538, { parent: B }).style.width = "1500px";
        text("SPY DRONES   " + n + "   (" + fmt(have) + " READY)", 57, 486, 40, "#fff", RT, B);
        text(q ? "SUCCESS " + a.pct(q.chance) + " · DETECTED " + a.pct(q.detect) + " · IDENTIFIES ABOUT " + q.limits.ships + " SHIPS" + (q.have < q.drones ? " — NEEDS " + q.drones + " DRONES" : "") : "…", 57, 532, 36, q && q.have < q.drones ? "#ff7a66" : "#27d0f0", RT, B);
        pressButton("button_minus", 1230, 526, 156, 156, () => { ord.qty = Math.max(1, ord.qty - 1); ord.draw(); }, "Fewer drones", B); pressButton("button_plus", 1390, 526, 156, 156, () => { ord.qty = Math.min(99, ord.qty + 1); ord.draw(); }, "More drones", B);
        const b = pressButton("button_confirm", 1660, 526, 156, 156, async () => {
          if (short) return;
          try { await a.simpleOrder("spy on planet " + t.id + " with " + n + " drones", [[327, a.W.concat([a.W.v(1, scanner.id), a.W.v(2, t.id), a.W.v(3, n)])]]); await a.loadSpyReports(); ord.q = {}; ord.note = "SPY DRONES SENT"; ord.noteBad = false; }
          catch (e) { ord.note = "THE SERVER REFUSED: " + (e.message || e); ord.noteBad = true; }
          bumpAll(); if (ord) ord.draw();
        }, short ? "Not enough spy drones" : "Send spy drones", B); if (short) dimmed(b);
      }
      sub("ATTACK", 650);
      const war = home ? home.carriers.filter((c) => !c.travel && !c.move && c.ships.some((x) => x.count > 0 && x.type !== 8 && x.type !== 9)) : [];
      if (!war.length) text("No idle carrier with warships: build ships, load a carrier or wait until one is back.", 57, 706, 40, "#ff7a66", RT, B);
      const idents = d ? d.ships.map((x) => x.type + ":" + x.count).join(",") : "";
      war.slice(0, 3).forEach((c, i) => {
        const q = get("a:" + c.id + ":" + t.id + ":" + idents + ":" + troops, () => a.quoteJson("planet=" + S.order[0] + "&attack=" + t.id + "&fleet=" + c.id + (idents ? "&seen=" + idents : "") + (troops != null ? "&troops=" + troops : "")));
        let line = "…", color = "#27d0f0";
        if (q) {
          line = "TRIP " + durTxt(q.seconds) + (q.ratio === null ? " · UNKNOWN DEFENCE: SPY FIRST" : " · " + fmt(q.mine) + " VS " + fmt(q.theirs) + " · WIN " + a.pct(q.chance)) + (q.conquer ? " · CONQUEST" : q.conquer === null ? "" : " · RAID ONLY") + (q.conquer !== false && !q.room ? " — PLANET LIMIT" : "");
          color = q.chance === 0 ? "#ff7a66" : q.ratio !== null && q.chance < 0.9 ? "#f2a516" : "#27d0f0";
        }
        row(c, 706 + i * 140, 1, line, color, !!q, "ATTACK");
      });
    };
    ord.draw();
    if (attack) a.loadSpyReports().then(() => { if (ord && ord.p === p) ord.draw(); });
  }
  function ordersFor(p, rec, label) {   // a map planet -> the dialog's planet; a planet with an owner record that the map calls free is another commander's (Home3 "Terran Outlaws")
    return { id: p.id, name: p.name || "Planet " + p.id, quality: p.quality, res: p.res, label: label === "free" && rec && rec.owner ? "another player" : label, owner: rec && rec.owner ? rec.owner.name : label === "pirate base" ? "Pirates" : "" };
  }
  async function openSystemPlanets(s, sec) {   // the galaxy map: the planets of the tapped system, each opens the orders
    const a = A(), G = window.GoFAGalaxy;
    try { await a.call([[103, a.W.concat([...s.planets.map((q) => a.W.v(1, q.id)), a.W.v(2, 1)])]]); } catch (e) { /* owners from the overlay only */ }
    const d = dialog(s.name.toUpperCase(), "");
    s.planets.forEach((q, i) => {
      const rec = a.S.planets.get(q.id), o = ordersFor({ ...q, name: s.name + q.number }, rec, G.ownerOf(sec, q).label), y = 200 + i * 130;
      image("list_bg_bar2", 40, y + 52, { parent: d.root }).style.width = "1500px";
      text("#" + q.number + "   QUALITY " + q.quality + "   METAL " + (q.res[1] || "?") + "   GAS " + (q.res[2] || "?") + "   CRYSTAL " + (q.res[3] || "?"), 57, y, 40, "#fff", RT, d.root);
      text(o.label === "free" ? "UNCLAIMED" : o.label === "yours" ? "YOUR PLANET" : (o.owner || o.label).toUpperCase(), 57, y + 46, 36, o.label === "free" ? "#7fe619" : o.label === "yours" ? "#27d0f0" : "#ff7a66", RT, d.root);
      pressButton("button_next", 1660, y + 40, 156, 156, () => { d.close(); openOrders(o); }, "Orders for " + o.name, d.root);
    });
  }

  /* ---- TRADE CENTRE (TRADE tab), CITADEL (ARTIFACTS tab) and the ITEM OFFER dialog (2026-11-13). No recording shows these screens: they are built from the panel kit, the round buttons and
     the lists of the screens that exist. Same requests and server quotes as the plain interface: exchange 208 {1 trade centre, 2 from, 3 amount, 4 to} with the rate and the storage from
     /debug/quote ?trade=; dig 240 {1 citadel} / collect 210 {1 job} with the cost and the artifact from ?dig=; BUY 278 {1 item, 2 amount} with the price from ?itemlist=. ---- */
  function tradeTab(B, pl) {
    const a = A(), tc = pl.structures.find((x) => x.slot === sp.slot && x.type === 10 && x.level > 0); if (!tc) return;
    const tr = sp.tr || (sp.tr = { from: 1, to: 2, amt: 1000 }), q = cq("tc:" + pl.id + ":" + tc.id + ":" + tc.level, () => a.quoteJson("planet=" + pl.id + "&trade=" + tc.id));
    const have = (t) => Math.floor((pl.resources.find((r) => r.type === t) || {}).amount || 0), icons = { 1: "res_icon_metal", 2: "res_icon_gas", 3: "res_icon_crystal" };
    const redraw = () => { sp.sig = ""; sp.draw(); };
    const pick = (label, y, key, other) => {
      text(label, 56, y - 58, 40, SKY, RT, B);
      [1, 2, 3].forEach((t, i) => {
        const x = 56 + i * 400, on = tr[key] === t;
        const box = el("div", { position: "absolute", left: x + "px", top: y + "px", width: "370px", height: "110px", boxSizing: "border-box", border: (on ? "4px solid #35d6ff" : "2px solid #2a6a88") + "", borderRadius: "14px", background: on ? "rgba(20,110,150,.55)" : "rgba(4,32,48,.7)", cursor: "pointer" }, B);
        box.onclick = () => { if (tr[other] === t) tr[other] = tr[key]; tr[key] = t; redraw(); };
        const im = image(icons[t], 0, 0, { parent: box }); im.onload = () => { const k = Math.min(1, 70 / im.naturalHeight); im.style.height = im.naturalHeight * k + "px"; im.style.left = 60 - im.naturalWidth * k / 2 + "px"; im.style.top = 55 - im.naturalHeight * k / 2 + "px"; };
        text(a.RES[t].toUpperCase(), 118, 8, 36, "#fff", RT, box); text(fmt(have(t)), 118, 52, 36, on ? "#fff" : SKY, RT, box);
      });
    };
    pick("GIVE", 380, "from", "to"); pick("GET", 600, "to", "from");
    const n = Math.max(0, tr.amt), step = (v) => (v > 10000 ? 10000 : v > 1000 ? 1000 : 100), maxN = have(tr.from);
    text("AMOUNT", 56, 742, 40, SKY, RT, B);
    const small = (base, cx, cy, click, title) => { const b = pressButton(base, cx, cy, 100, 100, click, title, B); b.style.width = "100px"; b.style.height = "100px"; return b; };
    small("button_minus", 130, 850, () => { tr.amt = Math.max(0, n - step(n - 1)); redraw(); }, "Less"); text(fmt(n), 190, 820, 52, "#fff", { ...RT, width: "400px", textAlign: "center", lineHeight: "60px" }, B); small("button_plus", 650, 850, () => { tr.amt = Math.min(maxN, n + step(n)); redraw(); }, "More");
    const mx = el("div", { position: "absolute", left: "740px", top: "812px", width: "150px", height: "76px", boxSizing: "border-box", border: "3px solid #35d6ff", borderRadius: "14px", cursor: "pointer" }, B); text("MAX", 0, 6, 42, "#fff", { ...RT, width: "150px", textAlign: "center" }, mx); mx.onclick = () => { tr.amt = maxN; redraw(); };
    const give = Math.min(n, maxN), get = q ? Math.floor(give * 100 / q.percent) : 0, over = q && have(tr.to) + get > q.capacity;
    hline(B, 56, 960, 1206);
    text(q ? "GIVE " + fmt(give) + " " + a.RES[tr.from].toUpperCase() + "  →  ABOUT " + fmt(get) + " " + a.RES[tr.to].toUpperCase() : "…", 56, 985, 40, "#fff", RT, B);
    text(q ? "RATE " + (q.percent / 100).toFixed(2).replace(/\.?0+$/, "") + " : 1   (TRADE CENTRE LEVEL " + q.level + ")" : "", 56, 1038, 36, SKY, RT, B);
    if (over) text("STORAGE FULL AT " + fmt(q.capacity) + ": THE REST IS LOST", 56, 1086, 36, "#ff7a66", RT, B);
    const can = !!q && give > 0, ok = pressButton("button_confirm", 1172, 1150, 156, 156, async () => {
      if (!can) return; try { await a.simpleOrder("exchange " + give + " " + a.RES[tr.from] + " for " + a.RES[tr.to], [[208, a.W.concat([a.W.v(1, tc.id), a.W.v(2, tr.from), a.W.v(3, give), a.W.v(4, tr.to)])]]); } catch (e) { dialog("TRADE CENTRE", "The server refused: " + (e.message || e)); }
      bumpAll();
    }, can ? "Exchange" : "Nothing to exchange", B); if (!can) dimmed(ok);
  }

  function digTab(B, pl) {
    const a = A(), cit = pl.structures.find((x) => x.slot === sp.slot && x.type === 11 && x.level > 0); if (!cit) return;
    const q = cq("dig:" + pl.id + ":" + cit.id, () => a.quoteJson("planet=" + pl.id + "&dig=" + cit.id)), job = pl.digJobs.find((j) => j.sid === cit.id), sk = scrollKeep(sp, B, 17, 286, 1245, 1070, 1247), I = sk.I, dx = 17;
    if (!q) { text("…", 56, 40, 40, SKY, RT, B); return; }
    if (!q.item) { text("This is not a citadel planet: there is nothing to dig here.", 56, 345, 38, "#ff7a66", RT, B); return; }
    const own = a.S.inventory ? a.S.inventory.get(q.item) || 0 : 0, nm = (ITEMS[q.item] || ["ARTIFACT"])[0].toUpperCase(), short = shortOf(a, pl, q.cost);
    row(I, 0, dx, { name: nm, sub: "YOU HOLD " + fmt(own) + " · CITADEL LEVEL " + cit.level, barW: 700 });
    if (job) {
      const done = job.end <= a.nowSrv();
      row(I, 172, dx, { name: "DIGGING", sub: done ? "READY TO COLLECT" : durTxt(job.end - a.nowSrv()) + " LEFT", subColor: done ? "#7fe619" : "#27d0f0",
        buttons: (y) => { if (!done) return; pressButton("button_job-ready", 1174 - dx, y, 156, 156, async () => { try { await a.simpleOrder("collect the dig", [[210, a.W.v(1, job.id)]]); } catch (e) { dialog("ARTIFACTS", "The server refused: " + (e.message || e)); } bumpAll(); }, "Collect the artifact", I); } });
      sk.done(2 * 172 + 10); return;
    }
    row(I, 172, dx, { name: "START DIGGING", sub: costLine(q) + (short.length ? " — NOT ENOUGH " + short.join(", ").toUpperCase() : ""), subColor: short.length ? "#ff7a66" : "#27d0f0",
      buttons: (y) => { const b = pressButton("button_confirm", 1174 - dx, y, 156, 156, async () => { if (short.length) return; try { await a.simpleOrder("start digging", [[240, a.W.v(1, cit.id)]]); } catch (e) { dialog("ARTIFACTS", "The server refused: " + (e.message || e)); } bumpAll(); }, short.length ? "Not enough resources" : "Start digging", I); if (short.length) dimmed(b); } });
    sk.done(2 * 172 + 10);
  }

  /* ITEM OFFER: the commander's ITEMS tab buttons (SHOP / GET MORE) open it: the card picture, the effect text, what is owned, the price, the amount and BUY (278). onDone redraws the tab. */
  function itemOffer(id, onDone) {
    const a = A(), S = a.S, [name, desc] = ITEMS[id] || ["ITEM " + id, ""], p = panel({ x: 127, y: 168, w: 1792, h: 1200, icon: "headline_icon_inventory", title: "ITEM OFFER", headY: 140, closeDx: 97, titleX: 239, crossY: [383, 661, 937, 1215], dim: true });
    hline(p.root, 36, 162, 1792 - 73); const body = el("div", { position: "absolute", left: 0, top: 0, width: "1792px", height: "1200px" }, p.root); let qty = 1, Q = undefined;
    a.quoteJson("planet=" + S.order[0] + "&itemlist=1").then((q) => { Q = q; draw(); });
    const draw = () => {
      if (!p.root.isConnected) return; body.textContent = ""; const q = Q && Q.items ? Q.items[id] : null, own = S.inventory ? S.inventory.get(id) || 0 : 0, cost = q ? q.price * qty : 0;
      text(name, 57, 190, 52, "#fff", RT, body); text(desc, 57, 262, 40, SKY, { ...RT, whiteSpace: "normal", width: "1060px", lineHeight: "46px" }, body);
      image("item_card_" + id, 1330, 190, { parent: body }); text("YOU OWN   " + fmt(own), 57, 640, 44, "#fff", RT, body);
      if (Q === undefined) { text("…", 57, 720, 44, SKY, RT, body); return; }
      if (!q) { text("There is no offer for this item on this server.", 57, 720, 44, "#ff7a66", RT, body); return; }
      if (!q.buy) { text("NOT FOR SALE: carrier blueprints are only found on missions.", 57, 720, 44, "#ff7a66", RT, body); return; }
      text("PRICE   " + fmt(q.price) + " CREDIT" + (q.price === 1 ? "" : "S") + " EACH", 57, 720, 44, "#fff", RT, body);
      const small = (base, cx, cy, click, title) => { const b = pressButton(base, cx, cy, 100, 100, click, title, body); b.style.width = "100px"; b.style.height = "100px"; return b; };
      text("AMOUNT", 57, 842, 44, SKY, RT, body); small("button_minus", 420, 870, () => { qty = Math.max(1, qty - 1); draw(); }, "Less"); text(String(qty), 480, 840, 52, "#fff", { ...RT, width: "200px", textAlign: "center", lineHeight: "60px" }, body); small("button_plus", 740, 870, () => { qty = Math.min(999, qty + 1); draw(); }, "More");
      const short = (S.credits || 0) < cost; text("TOTAL   " + fmt(cost) + " CREDITS" + (short ? "  — NOT ENOUGH" : ""), 57, 970, 44, short ? "#ff7a66" : "#f2a516", RT, body);
      const ok = pressButton("button_buy", 1660, 1085, 156, 156, async () => {
        if (short) return; try { await a.simpleOrder("buy " + qty + " × " + name, [[278, a.W.concat([a.W.v(1, id), a.W.v(2, qty)])]]); } catch (e) { dialog("ITEM OFFER", "The server refused: " + (e.message || e)); return; }
        if (onDone) onDone(); draw();
      }, short ? "Not enough credits" : "Buy", body); if (short) dimmed(ok);
    };
    draw();
  }

  /* ---- Galaxy map (Original look), measured on Random2.MP4 (final release; frames Random2_GalDiplomacy / GalDipFar / GalTop10 / GalHeat / GalOwners in
     Recording Frames, R overlays the frame of the current mode). The recording's galaxy is the same map data as the server's sector files, so positions are
     exact: the stage centre (1024, 768) is the LOCATION ("x - y", map units, y grows down). Zoom k = stage px per map unit: the map opens at 222 on the start
     system (Seyz in the recording, 466.40 - 589.50) and pinches out to 23.2 (sector = 30 units = 696 px). System markers (k >= ~112): a thin grey ring of radius
     0.22 units (49 px at k 222), a darker segmented inner ring, two diagonal ticks (NW, SE) and a glowing centre in the mode's colour, the name 40 px white,
     100 px right of the centre (the owner below it in yellow); they cross-fade into 6 px coloured dots between k 112 and 90. Sector lines (3 px, #4b4d5e) with the label (40 px, letter =
     column - 1 with AA after Z, number = row) at the cell's top-left. The home system: a blue-white swirl 0.69 k wide, 0.5 / -0.5 units from the start
     system; when it is out of view an arrow (sm_wormhole-marker) on the ellipse centre (1024, 680) radii 892 x 540 points at it. Bottom bar: arrows at
     x 576 / 1469, y 1326, mode icon (sm_filter-icon_*) at 723, name centred at 1027, seven pager dots from 926 every 34 px at y 1391, collapse arrow at
     1983, line at y 1424 to x 1888 then up to (1933, 1379), the legend row below (text 36 px, swatch sm_legend_color_item tinted + gold border, glyph
     icons without their disc, diagonal separators; it runs off the right edge: drag it). Modes in the game's order (next arrow): DIPLOMACY, COLONIZATION,
     PLANET OWNERS, FLEET, RESOURCES, TOP 10, HEAT MAP. The marker centre is the STAR's colour, the same in every mode; the mode shows as territories
     (Random.MP4 168 / 172 s): the Voronoi cell of each system in the mode's category, filled with the legend colour and outlined olive (see galaxyDraw).
     Not known / approximated: the star's white core (0x100619834, a fixed colour not read yet), the swirl is drawn (no sprite in the atlas), alliance / friend /
     top-10 owners and other players' names are not in the data the server sends here (only own / other / pirate), colonization's rule (no territory
     in its frame), the legend's icon entries are not drawn on the map, the selected-system highlight. A tap on a system keeps the planets dialog (no recording
     shows the game's answer). ---- */
  let gal = null;
  const sectorName = (sx, sy) => (sx < 26 ? String.fromCharCode(65 + sx) : "A" + String.fromCharCode(65 + sx - 26)) + sy;
  const GCOL = { free: "#4a7fe0", own: "#04b1d5", ally: "#7b01d6", friend: "#02d501", neutral: "#737173", red: "#e05a50", orange: "#d8885a", green: "#8ed868" };
  const OWNERS_LEGEND = [["YOUR OWN SYSTEM", "#04b1d5"], ["ALLIANCE CONTROLLED", "#7b01d6"], ["FRIEND CONTROLLED", "#02d501"], ["NEUTRAL CONTROLLED", "#737173"]];
  const TOP10_COL = ["#d8103c", "#e85a10", "#e8a000", "#d8d800", "#80d010", "#10c060", "#10b8b0", "#1090e0", "#5050e8", "#a040e0"];   // 1-4 read off the frame, 5-10 guessed (cut off in the recording)
  const GAL_MODES = [
    { name: "DIPLOMACY MODE", icon: "sm_filter-icon_diplomacy", ref: "Random2_GalDiplomacy.PNG", legend: OWNERS_LEGEND },
    { name: "COLONIZATION MODE", icon: "sm_filter-icon_colonization", legend: [["HIGH VALUE SYSTEM", "#02d501"], ["LOW VALUE SYSTEM", "#e01010"], ["PLANETS", null, "sm_icon_planets"], ["ARTIFACT PLANETS", null, "sm_icon_artifact-planets"], ["EMPTY PLANETS", null, "sm_icon_empty-planets"]] },
    { name: "PLANET OWNERS MODE", icon: "sm_filter-icon_planet-owners", ref: "Random2_GalOwners.PNG", legend: OWNERS_LEGEND },
    { name: "FLEET MODE", icon: "sm_filter-icon_fleets", legend: [["STATIONED OWN FLEETS", "#04b1d5"], ["STATIONED ALLIED FLEETS", "#7b01d6"], ["PLANETS", null, "sm_icon_planets"], ["YOUR FLEETS", null, "sm_icon_own-planets"]] },
    { name: "RESOURCES MODE", icon: "sm_filter-icon_resources", legend: [["OWN PLANET WITHIN", "#04b1d5"], ["PLANETS", null, "sm_icon_planets"], ["METAL", null, "sm_icon_metal"], ["GAS", null, "sm_icon_gas"], ["CRYSTAL", null, "sm_icon_crystal"], ["SPY DRONES", null, "sm_icon_spydrones"]] },
    { name: "TOP 10 MODE", icon: "sm_filter-icon_top-ten", ref: "Random2_GalTop10.PNG", legend: null },
    { name: "HEAT MAP", icon: "sm_filter-icon_battle", ref: "Random2_GalHeat.PNG", legend: [["MANY BATTLES", "#e01010"], ["FEW BATTLES", "#02d501"], ["PLANETS", null, "sm_icon_planets"], ["PLANETS UNDER ATTACK", null, "sm_icon_attackedplanets"], ["BATTLES IN SYSTEM", null, "sm_icon_battle"]] },
  ];
  const spriteCache = new Map();
  function spriteFx(name, fx) {   // a sprite run through a pixel filter (tint, glyph only) once, as a data URL
    const key = name + "|" + fx; if (!spriteCache.has(key)) spriteCache.set(key, new Promise((res) => {
      const im = new Image(); im.onload = () => {
        const cv = document.createElement("canvas"); cv.width = im.naturalWidth; cv.height = im.naturalHeight; const c = cv.getContext("2d"); c.drawImage(im, 0, 0);
        const d = c.getImageData(0, 0, cv.width, cv.height), p = d.data, tint = fx[0] === "#" ? [1, 3, 5].map((i) => parseInt(fx.substr(i, 2), 16)) : null;
        for (let i = 0; i < p.length; i += 4) {
          if (tint) { p[i] = p[i] * tint[0] / 255; p[i + 1] = p[i + 1] * tint[1] / 255; p[i + 2] = p[i + 2] * tint[2] / 255; }
          else if (fx === "glyph") { const l = (p[i] + p[i + 1] + p[i + 2]) / 3; p[i + 3] = l > 200 ? p[i + 3] : 0; }   // the sm_icon_* glyphs sit on a 40 % grey disc the legend does not show
        }
        c.putImageData(d, 0, 0); res(cv.toDataURL());
      }; im.onerror = () => res(art(name)); im.src = art(name);
    }));
    return spriteCache.get(key);
  }
  function fxImage(name, fx, x, y, w, parent) { const i = el("img", { position: "absolute", left: x + "px", top: y + "px", width: w ? w + "px" : "", pointerEvents: "none" }, parent); spriteFx(name, fx).then((u) => (i.src = u)); return i; }

  function galaxyLayerBuild() {
    const L = el("div", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px", display: "none", overflow: "hidden", background: "radial-gradient(ellipse at 45% 40%, #0a1626 0%, #040b16 45%, #01050d 100%)" });
    const cv = el("canvas", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px", cursor: "grab", touchAction: "none" }, L); cv.width = W; cv.height = H;
    gal = { layer: L, cv, ctx: cv.getContext("2d"), cx: 450, cy: 600, k: 222, drag: null, sel: null, mode: 0, collapsed: false, barOff: 0, lockUntil: 0, raf: 0, vx: 0, vy: 0 };
    const T = { textShadow: "none", lineHeight: "56px" };
    gal.loc = text("", 54, 160, 44, "#fff", { ...T, letterSpacing: "1px" }, L);
    gal.arrow = image("sm_wormhole-marker", 0, 0, { parent: L, click: () => galaxyGoHome() }); Object.assign(gal.arrow.style, { width: "104px", height: "104px", display: "none", padding: "20px", boxSizing: "border-box" }); gal.arrow.title = "Back to the home system";   // 64 px sprite + 20 px tap margin
    // bottom bar: one group, so it slides as one piece (collapse, opening)
    const B = el("div", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px", pointerEvents: "none" }, L); gal.bar = B;
    el("div", { position: "absolute", left: "650px", top: "1284px", width: "735px", height: "88px", background: "linear-gradient(90deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.55) 85%, rgba(0,0,0,0) 100%)" }, B);
    const arrowBtn = (base, cx, dir, title) => { const b = pressButton(base, cx, 1326, 156, 156, () => galaxyStep(dir, b, base), title, B); b.style.pointerEvents = "auto"; return b; };
    gal.prev = arrowBtn("button_back", 576, -1, "Previous mode"); gal.next = arrowBtn("button_next", 1469, 1, "Next mode");
    gal.icon = image(GAL_MODES[0].icon, 723 - 42, 1326 - 42, { parent: B });
    gal.name = text("", 656, 1298, 44, "#fff", { ...T, width: "742px", textAlign: "center", left: "656px" }, B);
    gal.dots = []; for (let i = 0; i < 7; i++) gal.dots.push(el("div", { position: "absolute", left: 926 + i * 34 - 3 + "px", top: "1388px", width: "6px", height: "6px", borderRadius: "50%", background: "#55636e" }, B));
    gal.col = image("button_arrow-down_0", 1983 - 78, 1326 - 78, { parent: B, click: () => galaxyCollapse(!gal.collapsed) }); gal.col.style.pointerEvents = "auto"; gal.col.title = "Hide / show the bar";
    B.insertAdjacentHTML("beforeend", '<svg width="2048" height="1536" style="position:absolute;left:0;top:0;pointer-events:none"><polyline points="18,1424 1888,1424 1933,1379" fill="none" stroke="rgba(235,242,248,.92)" stroke-width="2.5"/></svg>');
    const strip = el("div", { position: "absolute", left: 0, top: "1426px", width: W + "px", height: "110px", overflow: "hidden", pointerEvents: "auto", touchAction: "none" }, B);
    gal.legend = el("div", { position: "absolute", left: 0, top: 0, height: "110px", width: "4000px" }, strip); gal.legendX = 0;
    strip.onpointerdown = (e) => { strip.setPointerCapture(e.pointerId); const x0 = e.clientX, l0 = gal.legendX, s = 2048 / L.getBoundingClientRect().width; strip.onpointermove = (m) => { gal.legendX = Math.min(0, Math.max(-(gal.legendW - W + 20), l0 + (m.clientX - x0) * s)); gal.legend.style.left = gal.legendX + "px"; }; };
    strip.onpointerup = strip.onpointercancel = () => (strip.onpointermove = null);
    // pan (drag with a glide after release), zoom (wheel / pinch about the pointer), tap = the system under the pointer
    const pts = new Map(), toStage = (e) => { const r = L.getBoundingClientRect(), s = 2048 / r.width; return [(e.clientX - r.left) * s, (e.clientY - r.top) * s]; };
    const zoomAt = (f, px, py) => { const wx = gal.cx + (px - W / 2) / gal.k, wy = gal.cy + (py - H / 2) / gal.k; gal.k = Math.min(222, Math.max(23.2, gal.k * f)); gal.cx = wx - (px - W / 2) / gal.k; gal.cy = wy - (py - H / 2) / gal.k; galaxyClamp(); galaxyDraw(); };
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, toStage(e)); gal.vx = gal.vy = 0; gal.zt = 0; const [x, y] = toStage(e); gal.drag = pts.size === 1 ? { x, y, cx: gal.cx, cy: gal.cy, moved: false, hist: [[performance.now(), x, y]] } : null; cv.style.cursor = "grabbing"; };
    cv.onpointermove = (e) => {
      if (!pts.has(e.pointerId)) return; const [x, y] = toStage(e);
      if (pts.size === 2) { const [a0, b0] = [...pts.values()], d0 = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]); pts.set(e.pointerId, [x, y]); const [a1, b1] = [...pts.values()], d1 = Math.hypot(a1[0] - b1[0], a1[1] - b1[1]); if (d0 > 0 && d1 > 0) zoomAt(d1 / d0, (a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2); return; }
      pts.set(e.pointerId, [x, y]); const d = gal.drag; if (!d) return; const dx = x - d.x, dy = y - d.y; if (Math.hypot(dx, dy) > 24) d.moved = true;
      gal.cx = d.cx - dx / gal.k; gal.cy = d.cy - dy / gal.k; galaxyClamp(); d.hist.push([performance.now(), x, y]); if (d.hist.length > 6) d.hist.shift(); galaxyDraw();
    };
    cv.onpointerup = cv.onpointercancel = (e) => {
      pts.delete(e.pointerId); const d = gal.drag; gal.drag = null; cv.style.cursor = "grab"; if (!d) return;
      if (!d.moved) { galaxyClick(...toStage(e)); return; }
      const h = d.hist, a = h[0], b = h[h.length - 1], dt = (b[0] - a[0]) / 1000; if (dt > 0 && performance.now() - b[0] < 80) { gal.vx = -(b[1] - a[1]) / dt / gal.k; gal.vy = -(b[2] - a[2]) / dt / gal.k; galaxyLoop(); }   // glide: map units per second, decays (time constant 0.3 s)
    };
    cv.onwheel = (e) => {   // smooth: the wheel moves a target zoom, the frames ease toward it (time constant 0.08 s) about the pointer
      e.preventDefault(); const [x, y] = toStage(e); const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY; gal.zt = Math.min(222, Math.max(23.2, (gal.zt || gal.k) * Math.pow(e.ctrlKey ? 1.025 : 1.005, -dy)));   // ctrlKey = trackpad pinch gal.zp = [x, y]; galaxyLoop();
    };
    gal.zoomAt = zoomAt;
    galaxySetMode(0, true);
    return L;
  }
  function galaxyClamp() { gal.cx = Math.max(0, Math.min(1200, gal.cx)); gal.cy = Math.max(0, Math.min(1200, gal.cy)); }
  function galaxyLoop() {   // frames while something moves: the glide after a flick and the home swirl's slow turn
    if (gal.raf) return; let last = performance.now();
    const f = (now) => {
      if (view !== "galaxy") { gal.raf = 0; return; } const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (gal.zt) { const f = Math.pow(gal.zt / gal.k, 1 - Math.exp(-dt / 0.05)); if (Math.abs(gal.zt / gal.k - 1) < 0.002) { gal.zoomAt(gal.zt / gal.k, ...gal.zp); gal.zt = 0; } else gal.zoomAt(f, ...gal.zp); }
      if (gal.vx || gal.vy) { gal.cx += gal.vx * dt; gal.cy += gal.vy * dt; galaxyClamp(); const q = Math.exp(-dt / 0.3); gal.vx *= q; gal.vy *= q; if (Math.hypot(gal.vx, gal.vy) * gal.k < 20) gal.vx = gal.vy = 0; }
      gal.raf = -1; galaxyDraw(); gal.raf = gal.vx || gal.vy || gal.zt || gal.swirlVis ? requestAnimationFrame(f) : 0;
    };
    gal.raf = requestAnimationFrame(f);
  }
  function galaxySetMode(i, quiet) {
    const m = GAL_MODES[i]; gal.mode = i; gal.icon.src = art(m.icon); gal.name.textContent = m.name;
    gal.dots.forEach((d, j) => (d.style.background = j === i ? "#ffffff" : "#55636e"));
    galaxyLegend(m.legend || galaxyTop10Legend()); if (!quiet) { galaxyDraw(); setRef(); }
  }
  function galaxyStep(dir, btn, base) {
    if (performance.now() < gal.lockUntil) return;
    galaxySetMode((gal.mode + dir + GAL_MODES.length) % GAL_MODES.length); gal.lockUntil = performance.now() + MOTION.lock;   // pressButton already showed the lit state
    for (const b of [gal.prev, gal.next]) { b.style.filter = "grayscale(1) brightness(.55)"; } setTimeout(() => { for (const b of [gal.prev, gal.next]) b.style.filter = ""; }, MOTION.lock);
  }
  function galaxyCollapse(on, fromOpen) {
    gal.collapsed = on; const a = fromOpen ? MOTION.barOffset : gal.barOff, b = on ? MOTION.barOffset : 0;
    if (gal.barCancel) gal.barCancel();
    gal.barCancel = tween(MOTION.bar, "outQuad", (e) => { gal.barOff = a + (b - a) * e; gal.bar.style.transform = "translateY(" + gal.barOff + "px)"; moveClock(1385 + gal.barOff); },
      () => { gal.col.src = art(on ? "button_arrow-up_0" : "button_arrow-down_0"); gal.barCancel = null; });
    if (fromOpen) gal.col.src = art("button_arrow-up_0");
  }
  let top10Names = null;
  function galaxyTop10Legend() {
    if (!top10Names) { top10Names = []; const a = A(); fetch("/debug/quote?planet=" + a.S.order[0] + "&leaderboard=1&type=4&player=" + a.me16()).then((r) => (r.ok ? r.json() : { rows: [] })).then((j) => { top10Names = (j.rows || []).slice(0, 10).map((r) => r.name || r.alias || "?"); if (gal && GAL_MODES[gal.mode].legend === null) galaxyLegend(galaxyTop10Legend()); }).catch(() => {}); }
    return top10Names.map((n, i) => [(i + 1) + ") " + n, TOP10_COL[i]]);
  }
  const measure = (() => { const c = document.createElement("canvas").getContext("2d"); return (s, px) => { c.font = px + "px Klavika, system-ui, sans-serif"; return c.measureText(s).width; }; })();
  function galaxyLegend(items) {   // measured on Random2_GalDiplomacy: text 32 px (YOUR OWN SYSTEM = 275 px), swatch sprite 11 px after the text, separator 20 px after the
    // swatch (a 50 x 72 px diagonal), the next entry 80 px after the separator's left; glyph icons ~66 px, 14 px after the text
    const Lg = gal.legend; Lg.textContent = ""; let x = 21;
    for (const [label, colour, icon] of items) {
      text(label, x, 23, 32, "#fff", { textShadow: "none", lineHeight: "50px" }, Lg); x += measure(label, 32);
      if (colour) { x += 11; fxImage("sm_legend_color_item", colour, x, 8, 0, Lg); fxImage("sm_legend_color_item_border", "#e0d020", x, 8, 0, Lg); x += 120; }
      else { x += 14; fxImage(icon, "glyph", x, 15, 66, Lg); x += 66; }
      x += 20; el("div", { position: "absolute", left: x + 24 + "px", top: "2px", width: "2px", height: "88px", background: "rgba(220,230,240,.45)", transform: "rotate(-34.8deg)" }, Lg); x += 80;
    }
    gal.legendW = x; gal.legendX = 0; Lg.style.left = "0px";
  }
  function galaxyVisible() { const SEC = 30, x0 = Math.floor((gal.cx - W / 2 / gal.k) / SEC), x1 = Math.floor((gal.cx + W / 2 / gal.k) / SEC), y0 = Math.floor((gal.cy - H / 2 / gal.k) / SEC), y1 = Math.floor((gal.cy + H / 2 / gal.k) / SEC), out = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]); return out; }
  // the system's own star colour: the same in every mode (Random2 48.4-51 s: Zeuc red, Nucope blue in TOP 10, HEAT MAP, DIPLOMACY and COLONIZATION), not the system type:
  // the star colour (client 0x1006194a8, the galaxy map's star pass): a java.util.Random-style LCG (0x1009677d4 / 0x1009677fc: multiplier 0x5DEECE66D, + 0xB,
  // 48 bits; the constructor already steps once) seeded with system record field 4 (+0x1c), then nextInt(8) into this table (RGBA from the static at
  // 0x100d6f2c8). A second pass (0x100619834) draws a half-size core in one fixed colour over it. Checked on Random2_GalOwners: Syrame blue, Polpola yellow
  const STAR_COL = ["#fc634a", "#d38444", "#fec93c", "#8dd45d", "#51d1ae", "#517bd1", "#8be8bb", "#c8c8c8"];
  function starColour(s) {
    if (s.col) return s.col; const M = 0x5DEECE66Dn, MASK = (1n << 48n) - 1n;
    let st = (((BigInt(s.seed || 0) & 0xfffffffffn) ^ M) * M + 0xBn) & MASK; st = (st * M + 0xBn) & MASK;
    return (s.col = STAR_COL[Number((8n * ((st >> 17n) & 0x7fffffffn)) >> 31n)]);
  }
  // the mode's category of a system = the colour of its territory (Voronoi cell + glow), null = none. Only what the map data tells: own / other players / pirates,
  // stationed carriers (request 274), battles (273). Alliance, friend and top-10 owners are not in it; colonization's value rule is unknown (no glow in its frame)
  function galaxyColour(mode, sec, s, own) {
    let mine = false, other = false, ownF = 0, allyF = 0;
    for (const p of s.planets) {
      if (own.has(p.id)) mine = true; else { const w = sec.owners && sec.owners.get(p.id); if (w && w.kind !== 4) other = true; }
      const f = sec.fleets && sec.fleets.get(p.id); if (f) { ownF += f.own; allyF += f.allied; }
    }
    switch (GAL_MODES[mode].name) {
      case "DIPLOMACY MODE": {   // Garuda4321 (Discord, 2026-11-14): relations only, a system counts for whoever holds the MAJORITY of its planets; cyan = you, purple = your
        // alliance, green friendly, grey neutral, red hostile. The map data only knows you / other players / pirates: others -> neutral, pirates -> hostile (my reading)
        let nOwn = 0, nOther = 0, nPirate = 0; for (const q of s.planets) { if (own.has(q.id)) nOwn++; else { const w = sec.owners && sec.owners.get(q.id); if (w) { if (w.kind === 4) nPirate++; else nOther++; } } }
        const half = s.planets.length / 2; return nOwn > half ? GCOL.own : nOther > half ? "#a6aaae" : nPirate > half ? "#e01010" : null;
      }
      case "PLANET OWNERS MODE": return mine ? GCOL.own : other ? "#a6aaae" : null;
      case "FLEET MODE": return ownF ? GCOL.own : allyF ? GCOL.ally : null;
      case "RESOURCES MODE": return mine ? GCOL.own : null;
      case "HEAT MAP": { const h = sec.heat && sec.heat.get(s.id); return !h ? null : h.heat >= 0.5 ? "#e01010" : "#02d501"; }
      default: return null;
    }
  }
  function voronoiCell(s, near) {   // the system's Voronoi cell among its neighbours (map units), bounded by an octagon of radius 3.2
    let poly = []; for (let i = 0; i < 8; i++) { const a = (i + 0.5) * Math.PI / 4; poly.push([s.x + 3.2 * Math.cos(a), s.y + 3.2 * Math.sin(a)]); }
    for (const q of near) {
      if (q === s) continue; const nx = q.x - s.x, ny = q.y - s.y, d2 = nx * nx + ny * ny; if (d2 > 41 || d2 === 0) continue; const mx = (q.x + s.x) / 2, my = (q.y + s.y) / 2;
      const inside = (pt) => (pt[0] - mx) * nx + (pt[1] - my) * ny <= 0, out = [];
      for (let i = 0; i < poly.length; i++) {
        const A = poly[i], B = poly[(i + 1) % poly.length], ia = inside(A), ib = inside(B);
        if (ia) out.push(A); if (ia !== ib) { const da = (A[0] - mx) * nx + (A[1] - my) * ny, db = (B[0] - mx) * nx + (B[1] - my) * ny, t = da / (da - db); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); }
      }
      poly = out; if (poly.length < 3) return null;
    }
    return poly;
  }
  function galaxyHome() {   // the home swirl (client 0x1003484e4): the start system (jumpgate state field 2) + (0.5, -0.5) map units; before the first jump the fixed point (10.5, 9.5) in sector 0_0
    const a = A(), G = window.GoFAGalaxy, st = a.S.jumpgate && a.S.jumpgate.planet, id = st || a.S.order.find((p) => p > 1e9); let s = null;
    if (id) { const sec = G.sectors.get(Math.floor(id / 1e11) + "_" + (Math.floor(id / 1e7) % 1e4)); s = sec && sec.systems.find((q) => q.planets.some((p) => p.id === id)); if (!sec) G.loadSector(Math.floor(id / 1e11), Math.floor(id / 1e7) % 1e4).then(() => galaxyDraw()); if (!s) return null; }
    const hid = a.S.order.find((p) => p < 1e9), h0 = G.sectors.get("0_0"), hs = hid && h0 && h0.systems.find((q) => q.planets.some((p) => p.id === hid));   // its label is the home system's own name (Home / A'Belarr / Ninarah: Random2 "Home", Random "Ninarah")
    if (!h0) G.loadSector(0, 0); const bx = s ? s.x : 10, by = s ? s.y : 10;
    return { start: s, x: bx + 0.5, y: by - 0.5, name: hs ? hs.name : "Home" };
  }
  // where the galaxy map opens (client 0x100346594, zoom 6.0 in both cases): on the start system; with no start planet while at home, on the centre of the sector grid (40 x 40 sectors of 30 units -> 600, 600)
  function galaxyStartView() { const h = galaxyHome(); if (!h) return null; return h.start ? [h.start.x, h.start.y] : [600, 600]; }
  function drawSwirl(c, x, y, R, t) {
    const g = c.createRadialGradient(x, y, 0, x, y, R); g.addColorStop(0, "#ffffff"); g.addColorStop(0.5, "#ffffff"); g.addColorStop(0.62, "rgba(190,225,255,.95)"); g.addColorStop(0.8, "rgba(80,150,255,.55)"); g.addColorStop(1, "rgba(40,90,220,0)");
    c.fillStyle = g; c.beginPath(); c.arc(x, y, R, 0, 6.283); c.fill();
    if (R < 20) return; c.save(); c.translate(x, y); c.rotate(t * 0.6); c.lineCap = "round";
    for (let i = 0; i < 14; i++) { const a = i / 14 * 6.283, r = R * (0.62 + 0.08 * ((i * 7) % 3)); c.strokeStyle = i % 2 ? "rgba(120,180,255,.55)" : "rgba(210,235,255,.6)"; c.lineWidth = Math.max(1.5, R * 0.05); c.beginPath(); c.arc(0, 0, r, a, a + 0.55); c.stroke(); }
    c.restore();
  }
  function drawSelect(c, x, y, r) {   // the selected system (Random 129.6 s: a bright ring with four ticks over the home glow)
    c.save(); c.strokeStyle = "rgba(170,235,255,.95)"; c.lineWidth = 3; c.shadowColor = "#3cc8ff"; c.shadowBlur = 12; c.beginPath(); c.arc(x, y, r, 0, 6.283); c.stroke();
    c.beginPath(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; c.moveTo(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55); c.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85); } c.stroke(); c.restore();
  }
  function drawMarker(c, x, y, k, col, alpha) {   // k-scaled: every length below is in px at k 222
    const s = k / 222; c.save(); c.globalAlpha = alpha; c.translate(x, y); c.scale(s, s);
    c.fillStyle = "rgba(0,0,0,.45)"; c.beginPath(); c.arc(0, 0, 36, 0, 6.283); c.fill();
    c.strokeStyle = "rgba(140,146,152,.62)"; c.lineWidth = 12; for (let i = 0; i < 4; i++) { const a = -0.35 + i * Math.PI / 2; c.beginPath(); c.arc(0, 0, 30, a, a + 1.22); c.stroke(); }
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 22); g.addColorStop(0, col); g.addColorStop(0.4, col); g.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 22, 0, 6.283); c.fill();
    c.strokeStyle = "rgba(200,206,212,.75)"; c.lineWidth = 2.2; c.beginPath(); c.arc(0, 0, 49, 0, 6.283); c.stroke();
    c.beginPath(); for (const sg of [-1, 1]) { c.moveTo(sg * 26, sg * 26); c.lineTo(sg * 47, sg * 47); } c.stroke();
    c.restore();
  }
  function galaxyDraw() {
    if (!gal || gal.layer.style.display === "none") return;
    if (!gal.placed) { const v = galaxyStartView(); if (v) { gal.placed = true; [gal.cx, gal.cy] = v; gal.k = 222; } }
    const G = window.GoFAGalaxy, c = gal.ctx, k = gal.k, SEC = 30, own = new Set(A().S.order), now = performance.now() / 1000;
    c.clearRect(0, 0, W, H); const sx = (x) => (x - gal.cx) * k + W / 2, sy = (y) => (y - gal.cy) * k + H / 2;
    gal.loc.textContent = "LOCATION: " + gal.cx.toFixed(2) + " - " + gal.cy.toFixed(2);
    const mA = Math.max(0, Math.min(1, (k - 90) / 22)), vis = galaxyVisible();
    c.strokeStyle = "#4b4d5e"; c.lineWidth = 3; c.beginPath();   // sector lines + labels
    for (const [x, y] of vis) { if (x < 0 || y < 0 || x > 39 || y > 39) continue; c.moveTo(sx(x * SEC), sy(y * SEC)); c.lineTo(sx(x * SEC + SEC), sy(y * SEC)); c.moveTo(sx(x * SEC), sy(y * SEC)); c.lineTo(sx(x * SEC), sy(y * SEC + SEC)); }
    c.stroke(); c.font = "40px Klavika, system-ui"; c.fillStyle = "#cfd3dc"; c.textBaseline = "top";
    for (const [x, y] of vis) if (x >= 1 && y >= 0 && x <= 39 && y <= 39) c.fillText(sectorName(x - 1, y), sx(x * SEC) + 18, sy(y * SEC) + 14);
    c.textBaseline = "middle"; const labels = [], list = [], near = [], m = 4 * k;   // near: every loaded system around the view (Voronoi neighbours)
    for (const [x, y] of vis) {
      if (x < 0 || y < 0 || x > 39 || y > 39) continue;
      const sec = G.sectors.get(x + "_" + y); if (!sec) { G.loadSector(x, y).then(() => galaxyDraw()); continue; }
      for (const s of sec.systems) { const px = sx(s.x), py = sy(s.y); if (px < -m || py < -m || px > W + m || py > H + m) continue; near.push(s); if (px > -120 && py > -120 && px < W + 120 && py < H + 120) list.push([s, sec, px, py]); }
    }
    // territories (Random.MP4 at 168 / 172 s, k 155): the Voronoi cell of each system in the mode's category, filled with its colour (alpha .65 at the star,
    // .36 at ~1.2 units, fading to .1 at the cell's far corners) and outlined olive #98a301
    for (const [s, sec] of near.map((q) => [q, G.sectors.get(q.sx + "_" + q.sy)])) {
      const col = sec && galaxyColour(gal.mode, sec, s, own); if (!col) continue; const cell = voronoiCell(s, near); if (!cell) continue;
      c.beginPath(); cell.forEach(([u, v], i) => (i ? c.lineTo(sx(u), sy(v)) : c.moveTo(sx(u), sy(v)))); c.closePath();
      const g = c.createRadialGradient(sx(s.x), sy(s.y), 0, sx(s.x), sy(s.y), 3.2 * k), rgb = [1, 3, 5].map((i) => parseInt(col.substr(i, 2), 16)).join(",");
      g.addColorStop(0, "rgba(" + rgb + ",.65)"); g.addColorStop(0.11, "rgba(" + rgb + ",.55)"); g.addColorStop(0.38, "rgba(" + rgb + ",.36)"); g.addColorStop(0.65, "rgba(" + rgb + ",.22)"); g.addColorStop(1, "rgba(" + rgb + ",.1)");
      c.fillStyle = g; c.fill(); c.strokeStyle = "#98a301"; c.lineWidth = 2; c.stroke();
    }
    const alias = A().S.alias;
    for (const [s, sec, px, py] of list) {
      const col = starColour(s);
      if (mA < 1) { c.globalAlpha = 1 - mA; c.fillStyle = col; c.beginPath(); c.arc(px, py, 3, 0, 6.283); c.fill(); c.globalAlpha = 1; }
      if (gal.sel && gal.sel.id === s.id) drawSelect(c, px, py, Math.max(30, 58 * k / 222));
      if (mA > 0) { drawMarker(c, px, py, k, col, mA); labels.push([s.name, px + 100, py, s.planets.some((p) => own.has(p.id)) ? alias : null]); }
    }
    if (mA > 0) { c.globalAlpha = mA; for (const [t, x, y, o] of labels) { c.fillStyle = "#fff"; c.fillText(t, x, o ? y - 21 : y); if (o) { c.fillStyle = "#e6dc8c"; c.fillText(o, x, y + 22); } } c.globalAlpha = 1; }
    c.textBaseline = "alphabetic";
    const hm = galaxyHome(); gal.arrow.style.display = "none"; gal.swirlVis = false;
    if (hm) {
      const hx = sx(hm.x), hy = sy(hm.y);
      if (k < 90) {   // zoomed out the game's home dot is ~12 px and easy to lose (owner, 2026-11-14): a soft halo and the name stay readable (my addition, not in the recordings)
        const g = c.createRadialGradient(hx, hy, 0, hx, hy, 70); g.addColorStop(0, "rgba(140,200,255,.55)"); g.addColorStop(0.35, "rgba(80,150,255,.22)"); g.addColorStop(1, "rgba(40,90,220,0)");
        c.fillStyle = g; c.beginPath(); c.arc(hx, hy, 70, 0, 6.283); c.fill(); c.globalAlpha = 1 - mA; c.font = "36px Klavika, system-ui"; c.fillStyle = "#e8f4ff"; c.textBaseline = "middle"; c.fillText(hm.name, hx + 34, hy); c.textBaseline = "alphabetic"; c.globalAlpha = 1;
      }
      drawSwirl(c, hx, hy, Math.max(14, 0.345 * k), now); if (gal.sel && gal.sel.home) drawSelect(c, hx, hy, Math.max(30, 0.3 * k));
      if (mA > 0) { c.globalAlpha = mA; c.font = "40px Klavika, system-ui"; c.fillStyle = "#fff"; c.textBaseline = "middle"; c.fillText(hm.name, hx + 100, hy); c.textBaseline = "alphabetic"; c.globalAlpha = 1; }
      const dx = hx - 1024, dy = hy - 680, e = Math.hypot(dx / 892, dy / 540);
      if (e > 1) { const ax = 1024 + dx / e, ay = 680 + dy / e; Object.assign(gal.arrow.style, { display: "block", left: ax - 52 + "px", top: ay - 52 + "px", transform: "rotate(" + (Math.atan2(dy, dx) + Math.PI / 2) + "rad)" }); }
      else { gal.swirlVis = true; if (!gal.raf) galaxyLoop(); }   // the swirl turns while it is in view
    }
  }
  function galaxyClick(px, py) {   // Random 129.6-130.3 s: a tap selects (highlight ring), a tap on the selected system cuts to its system view
    const G = window.GoFAGalaxy, k = gal.k, wx = gal.cx + (px - W / 2) / k, wy = gal.cy + (py - H / 2) / k, hm = galaxyHome();
    let best = null, bd = Math.max(80, 0.3 * k) / k;
    if (hm && Math.hypot(hm.x - wx, hm.y - wy) < Math.max(90, 0.4 * k) / k) best = { home: true, id: "home", x: hm.x, y: hm.y };
    else for (const [x, y] of galaxyVisible()) { const sec = G.sectors.get(x + "_" + y); if (!sec) continue; for (const s of sec.systems) { const d = Math.hypot(s.x - wx, s.y - wy); if (d < bd) { bd = d; best = s; } } }
    if (best && gal.sel && gal.sel.id === best.id) { galaxyEnter(best); return; }
    gal.sel = best; galaxyDraw();
  }
  function galaxyEnter(s) {   // hard cut to the system view of the tapped system (home: the player's home system in sector 0_0)
    const a = A(); sys.focusId = s.home ? a.S.order.find((p) => p < 1e9) || a.S.order[0] : s.planets[0].id; gal.sel = null; showView("system");
  }
  function galaxyGoHome() {   // tap on the home arrow: glide back to the home system (0.6 s, smoothstep)
    const hm = galaxyHome(); if (!hm) return; const x0 = gal.cx, y0 = gal.cy; gal.vx = gal.vy = 0;
    tween(600, "smooth", (e) => { gal.cx = x0 + (hm.x - x0) * e; gal.cy = y0 + (hm.y - y0) * e; galaxyDraw(); }, () => { gal.sel = { home: true, id: "home", x: hm.x, y: hm.y }; galaxyDraw(); });
  }

  function openGalaxy(arg) {   // arg (dev links, R-overlay checks): "mode,x,y,k", e.g. 0,466.36,589.61,222 = frame Random2_GalDiplomacy
    if (!(gal && window.GoFAGalaxy)) return; showView("galaxy");
    if (arg) { const [m, x, y, k] = String(arg).split(",").map(Number); gal.placed = true; if (!isNaN(x) && !isNaN(y)) { gal.cx = x; gal.cy = y; } if (k) gal.k = k; galaxySetMode(m || 0); }
  }
  function closeGalaxy() { showView("system"); }
  function moveClock(cy) { const t = document.getElementById("pClock"); if (clockIcon) clockIcon.style.top = cy - 30 + "px"; if (t) t.style.top = cy - 24 + "px"; }

  /* ---- System view (first version): frame Random2_t14.PNG (recording Random2.MP4): "SYSTEM:  HOME" label, star with a horizontal flare, two orbit ellipses, planets
     (stand-in spheres, the 3D globes are not rendered) with the name and the owner beside each; the round button at the bottom left goes on to the galaxy map. Planets
     come from the galaxy sector data (system of the selected planet; the home system shows only Home1, the server keeps Home2 / Home3 private). Click an own planet to
     open it on the planet screen, any other planet shows its data in a dialog. Not faithful / unknown: sphere look and size, positions on the orbits, the space station
     and ship badge, the owner colours (yellow for pirates is read off the frame), the second portrait and the Game Center button. ---- */
  let sys = null, view = "planet";
  const PCOL = ["#6f7a86", "#8aa0b8", "#a58f6a", "#6fae7a", "#b08aa8", "#6fa3b3", "#b3996f", "#e0a23a", "#d9534f", "#5b8def"];
  function sysLayerBuild() {
    const L = el("div", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px", display: "none", overflow: "hidden",
      background: "radial-gradient(ellipse at 72% 14%, rgba(48,150,128,.42) 0%, transparent 46%), radial-gradient(ellipse at 20% 30%, rgba(40,120,120,.30) 0%, transparent 50%), radial-gradient(ellipse at 50% 58%, #0d4348 0%, #07242d 38%, #02090e 85%)" });
    L.insertAdjacentHTML("beforeend", '<svg width="2048" height="1536" style="position:absolute;left:0;top:0" fill="none" stroke="rgba(150,225,235,.28)" stroke-width="2"><ellipse cx="1030" cy="815" rx="924" ry="165"/><ellipse cx="1090" cy="815" rx="590" ry="100"/></svg>');
    const decor = [L.lastChild];   // the CSS stand-ins (orbit ellipses, flare, star): hidden when the 3D system is drawn (sys3d)
    decor.push(el("div", { position: "absolute", left: "0px", top: "745px", width: W + "px", height: "140px", background: "radial-gradient(ellipse at 50% 50%, rgba(190,255,248,.9) 0%, rgba(90,210,200,.35) 28%, transparent 70%)" }, L));
    decor.push(el("div", { position: "absolute", left: "694px", top: "520px", width: "660px", height: "660px", borderRadius: "50%", background: "radial-gradient(circle, #fff 0%, #fffbd0 10%, rgba(255,240,170,.75) 22%, rgba(120,230,210,.35) 46%, transparent 70%)" }, L));
    const T = { textShadow: "none", lineHeight: "56px", letterSpacing: "1px" };
    const sysLbl = text("SYSTEM:", 54, 160, 44, "#fff", T, L); const nm = text("", 269, 160, 44, "#fff", T, L);
    const items = el("div", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px" }, L);
    const bk = pressButton("button_starmap_big", 108, 1425, 156, 156, () => showView("galaxy"), "Galaxy map", L);
    pressButton("button_jumpgate", 1936, 1425, 156, 156, () => openJumpgate(), "Jumpgate", L);   // my placement: in the game the gate itself is tapped
    sys = { layer: L, nm, hdr: [sysLbl, nm], items, bk, decor, bg: L.style.background, yaw: -Math.PI, pitch: -0.5, marks: [], layout: null };   // start yaw fitted to the real client's start view (Real_SystemStart.png); pitch -0.5 = the decoded start
    // drag on the background turns the 3D system about the sun (the game: 2 pi x 0.00015 rad per point; a stage pixel is half an iPad point)
    // zoom: the game's two-finger pinch moves the camera within [242011, 610022] (0x10032ecb4); here the wheel or a two-pointer pinch
    const pts = new Map(), zoomBy = (f) => (sys.dist = Math.max(242011, Math.min(610022, (sys.dist || 610022) * f)));
    L.onwheel = (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 0.92 : 1.08); };
    L.onpointerdown = (e) => { if (e.target !== L && e.target !== items) return; pts.set(e.pointerId, [e.clientX, e.clientY]); sys.drag = pts.size === 1 ? { x: e.clientX, y: e.clientY, yaw: sys.yaw, pitch: sys.pitch, k: 2048 / L.getBoundingClientRect().width, hist: [] } : null; sys.spin = null; L.setPointerCapture(e.pointerId); };
    L.onpointermove = (e) => {
      if (pts.has(e.pointerId) && pts.size === 2) { const [a0, b0] = [...pts.values()], d0 = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]); pts.set(e.pointerId, [e.clientX, e.clientY]); const [a1, b1] = [...pts.values()], d1 = Math.hypot(a1[0] - b1[0], a1[1] - b1[1]); if (d0 > 0 && d1 > 0) zoomBy(d0 / d1); return; }
      // 0x10032c954: yaw += dx x C, pitch (+0x700) += dy x C, clamped to [-1, 0.5]; C = 2 pi x 0.00015 per point (2048 stage px = 1024 points)
      if (sys.drag && !sys.focused) { const C = sys.drag.k * 0.5 * 2 * Math.PI * 0.00015; sys.yaw = sys.drag.yaw + (e.clientX - sys.drag.x) * C; sys.pitch = Math.max(-1, Math.min(0.5, sys.drag.pitch - (e.clientY - sys.drag.y) * C)); const h = sys.drag.hist, now = performance.now(); h.push([now, sys.yaw, sys.pitch]); while (h.length > 2 && now - h[0][0] > 80) h.shift(); }   // owner's recording 01.32: with yaw -= the front planet moved against the pointer, so yaw keeps the game's sign; pitch is flipped (drag down = more top-down, the grab feel)
    };
    L.onpointerup = L.onpointercancel = (e) => {
      pts.delete(e.pointerId); const d = sys.drag; sys.drag = null; if (!d || d.hist.length < 2) return;
      const a = d.hist[0], b = d.hist[d.hist.length - 1], dt = (b[0] - a[0]) / 1000; if (dt <= 0 || performance.now() - b[0] > 80) return;   // a pause before letting go: no glide
      const cap = (v) => Math.max(-5, Math.min(5, v)); sys.spin = { vy: cap((b[1] - a[1]) / dt), vp: cap((b[2] - a[2]) / dt) };   // rad / s
    };
    return L;
  }
  /* ---- planet focus in the system view (frame Random_SystemPlanetPanel = Random.MP4 121.2 s; the owner's iPad video trimmmmm.mp4): a tap on a planet flies the
     camera in (0.67 s ease-out quad) while the PLANET side panel slides in from the right (box 1020,176 996 x 1328, rows PLANET STATS / VIEW PLANET /
     RELOCATE FLEET / DELIVER CARGO at y 426 + 172 n: icon x 1114, label x 1176, arrow x 1904); the top left shows the planet's name, its owner in cyan and
     OWN / ALLIED carriers, the bottom left a back button. The X or back slides the panel out and pulls the camera back (0.33 s), the system name returns. ---- */
  function sysFocus(i, p) {
    if (sys.focused) return; const a = A(); sys.focused = { i, p }; sysFly(i, 0, 1, MOTION.sysIn);
    sys.hdr.forEach((e) => (e.style.display = "none")); sys.bk.style.display = "none"; sys.items.style.visibility = "hidden";   // planet labels off: the name is at the top left
    const F = el("div", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px", pointerEvents: "none" }, sys.layer); sys.focusUi = F;
    image("button_small_copy-link_0", 80 - 50, 216 - 50, { parent: F });
    text(p.name, 166, 160, 44, "#fff", { textShadow: "none", lineHeight: "56px" }, F); if (p.owner) text(p.owner, 166, 214, 44, "#35b6e6", { textShadow: "none", lineHeight: "56px" }, F);
    const home = a.S.planets.get(a.S.order[0]), own = home ? home.carriers.filter((c) => c.at === p.id && !c.moving).length : 0;
    image("fleets_icon_own", 74 - 30, 326 - 30, { parent: F, w: 60 }); text("OWN: ", 132, 302, 40, "#35b6e6", { textShadow: "none", lineHeight: "48px" }, F); text(String(own), 236, 302, 40, "#fff", { textShadow: "none", lineHeight: "48px" }, F);
    image("fleets_icon_friendly", 74 - 30, 392 - 30, { parent: F, w: 60 }); text("ALLIED: ", 132, 368, 40, "#b07cff", { textShadow: "none", lineHeight: "48px" }, F); text("0", 280, 368, 40, "#fff", { textShadow: "none", lineHeight: "48px" }, F);
    const back = pressButton("button_back", 108, 1424, 156, 156, () => pp.close(), "Back", F); back.style.pointerEvents = "auto";
    const pp = panel({ rank: true, x: 1020, y: 176, w: 996, h: 1328, icon: "headline_icon_planet", title: "PLANET", headY: 140, closeDx: 96, titleX: 230, crossY: [], onClose: () => sysUnfocus() });
    const rec = a.S.planets.get(p.id), go = (fn) => () => { fn(); };
    const orders = () => openOrders(ordersFor(p, rec, p.npc ? "pirate base" : (p.own && p.own.label) || "free"));
    const rows = [["pa_icon_info", "PLANET STATS", orders], ["planet_icon_white", "VIEW PLANET", async () => {
      if (!p.mine) { orders(); return; } a.S.selected = p.id; try { await a.refreshPlanets([p.id]); } catch (e) { /* the poll catches up */ } pp.close(); showView("planet"); }],
      ["pa_icon_relocate", "RELOCATE FLEET", orders], ["pa_icon_deliver", "DELIVER CARGO", () => openFleets()]];
    rows.forEach(([ic, label, fn], n) => {
      const cy = 426 + 172 * n - 176;
      const bar = image("list_bg_bar1", 1076 - 1020, cy - 22, { parent: pp.root }); bar.style.width = "820px"; bar.style.opacity = ".55";
      const ring = el("div", { position: "absolute", left: 1114 - 1020 - 38 + "px", top: cy - 38 + "px", width: "76px", height: "76px", borderRadius: "50%", border: "3px solid #fff", boxSizing: "border-box", background: "#0b2a40" }, pp.root);
      const g = image(ic, 0, 0, { parent: ring }); Object.assign(g.style, { left: "50%", top: "50%", width: ic === "planet_icon_white" ? "44px" : "60px", transform: "translate(-50%,-50%)" });
      text(label, 1176 - 1020, cy - 28, 44, "#fff", { textShadow: "none", lineHeight: "56px" }, pp.root);
      hline(pp.root, 30, cy + 84, 940);
      pressButton("button_next", 1904 - 1020, cy, 156, 156, go(fn), label, pp.root);
    });
    sys.focusPanel = pp;
  }
  function sysUnfocus() {
    const f = sys.focused; if (!f) return; sys.focused = null; sys.focusPanel = null;
    if (sys.focusUi) { sys.focusUi.remove(); sys.focusUi = null; } sys.hdr.forEach((e) => (e.style.display = "")); sys.bk.style.display = ""; sys.items.style.visibility = "";
    if (view === "system") sysFly(f.i, sys.fly ? sys.fly.e : 1, 0, MOTION.sysOut); else sys.fly = null;
  }
  const SYS_VIEW_SHIFT = -0.095;   // lens shift (NDC y) of the system overview, see the camera note in the frame loop
  let SYS_FOCUS_SUNFADE = 0.3, SYS_FOCUS_DIST = 20, SYS_FOCUS_SX = -1, SYS_FOCUS_PITCH = -0.06, SYS_FOCUS_OFF = -0.3; const SYS_FOCUS_YAW = (a) => SYS_FOCUS_OFF - a;   // Random_SystemPlanetPanel: planet centre (530, 840) r ~370, lit from the front right, the sun off to the right behind the panel (orange glow in the frame's top right corner; sun projects to ~1820,870); the camera turns to this angle on focus and back on close   // tuned on the frame: planet radius ~372 px; SX = sign of the sideways shift in the mirrored render
  function sysFly(i, from, to, ms, done) {   // camera between the system overview (0) and planet i close up (1)
    if (sys.flyCancel) sys.flyCancel(); if (from === 0 || !sys.flyFrom) sys.flyFrom = { yaw: sys.yaw, pitch: sys.pitch }; sys.fly = { i, e: from };   // (a pull-back that starts at the planet, planet screen -> system view, also returns to the overview angles; before, it ended at the focus angles, pitch -0.06)
    sys.flyCancel = tween(ms, "outQuad", (e) => { if (sys.fly) sys.fly.e = from + (to - from) * e; }, () => { sys.flyCancel = null; if (to === 0) { sys.fly = null; if (sys.flyFrom) { sys.yaw = sys.flyFrom.yaw; sys.pitch = sys.flyFrom.pitch; } sys.flyFrom = null; } if (done) done(); });
  }
  async function sysDraw() {
    const a = A(), G = window.GoFAGalaxy, id = sys.focusId || a.S.selected; let d = null;   // focusId: a system entered from the galaxy map
    {   // home planets (1101 ...) are map records too (sector 0_0), so every system comes from the map; the old one-planet HOME stand-in is the fallback below
      const sx = Math.floor(id / 1e11), sy = Math.floor(id / 1e7) % 1e4; if (G) await G.loadSector(sx, sy); const sec = G && G.sectors.get(sx + "_" + sy), sm = sec && sec.systems.find((s) => s.planets.some((p) => p.id === id));
      if (sm) d = { name: sm.name.toUpperCase(), sec, type: sm.type, seed: sm.seed, planets: sm.planets.map((p) => { const rec = a.S.planets.get(p.id), mine = a.S.order.includes(p.id), o = G.ownerOf(sec, p); return { ...p, name: sm.name + p.number, mine, own: o, owner: mine ? a.S.alias : rec && rec.owner ? rec.owner.name : o.label === "pirate base" ? "Pirates" : o.label === "free" ? "" : "Another player", npc: o.label === "pirate base" }; }) };
    }
    if (!d && id < 1e9) d = { name: "HOME", planets: [{ id, number: 1, type: 0, name: "Home1", mine: true, owner: a.S.alias }] };
    sys.items.textContent = ""; sys.marks = []; sys.layout = null; if (!d) { sys.nm.textContent = "UNKNOWN"; return; }
    sys.nm.textContent = d.name; const n = d.planets.length;
    // the real 3D system (gofa3d.js systemLayout: the game's orbits, angles and sizes) when the 3D planet runs; the planets below become click targets + labels
    const use3d = !!(p3 && window.GoFA3D && d.type && d.planets.every((p) => p.type >= 1 && p.type <= 9));
    if (use3d) {
      sys.layout = GoFA3D.systemLayout(d.planets.map((p) => ({ type: p.type, pads: p.pads, seed: p.padSeed })), d.seed || d.type); sys.type = d.type; sys.seed = d.seed;
      if (sys.pullBack) { const pi = d.planets.findIndex((q) => q.id === sys.pullBack); sys.pullBack = null; if (pi >= 0) sysFly(pi, 1, 0, MOTION.sysOut); }   // planet screen -> system view: start on the planet, pull back
      const own = d.planets.findIndex((p) => p.mine); sys.gate = own >= 0 ? { species: { 1: "terran", 2: "vossk", 3: "nivelian" }[a.S.race] || "terran", i: own } : null;   // the player's jumpgate by their planet
    }
    sys.decor.forEach((e) => (e.style.display = use3d ? "none" : "")); sys.layer.style.background = use3d ? "transparent" : sys.bg;
    d.planets.forEach((p, i) => {
      const th = 2 * Math.PI * (i + 0.55) / n + 0.5, x = 1030 + (n === 1 ? 420 : 640) * Math.cos(th), y = 815 + 150 * Math.sin(th), r = 70 + (p.id * 7) % 45, col = PCOL[p.type] || PCOL[0];
      const ball = el("div", { position: "absolute", left: x - r + "px", top: y - r + "px", width: 2 * r + "px", height: 2 * r + "px", borderRadius: "50%", cursor: "pointer",
        background: "radial-gradient(circle at 34% 30%, " + col + " 0%, " + col + "cc 35%, #10161c 85%)", boxShadow: (p.mine ? "0 0 40px 10px rgba(80,220,255,.45)" : "0 0 30px 6px rgba(255,170,90,.25)") + ", inset -26px -18px 50px rgba(0,0,0,.65)" }, sys.items);
      const T = { textShadow: "none", lineHeight: "44px" };
      if (use3d) Object.assign(ball.style, { background: "transparent", boxShadow: "none" });
      const nmEl = text(p.name, x + r + 20, y - r * 0.2 - 30, 36, p.mine ? "#9fb6c4" : "#fff", T, sys.items), owEl = !p.owner ? null : text(p.owner, x + r + 20, y - r * 0.2 + 6, 36, p.npc ? "#f2ee8a" : "#9fb6c4", T, sys.items);
      // fleet badge (Random2_t14 / t20: fleets_icon_own, a cyan disc with the carrier glyph, centred ~0.2 r below the planet's top): shown here when
      // own carriers are stationed at the planet (assumed meaning; the frames only show it on the owner's planet holding carriers)
      const home = a.S.planets.get(a.S.order[0]), docked = home ? home.carriers.filter((c) => c.at === p.id && !c.moving).length : 0;
      const badge = docked ? image("fleets_icon_own", x - 42, y - r - 42 + 0.2 * r, { parent: sys.items }) : null;
      if (badge) badge.title = docked + " carrier" + (docked > 1 ? "s" : "") + " stationed here";
      sys.marks.push({ ball, nmEl, owEl, i, badge });
      ball.onclick = async () => {
        if (sys.layout) { sysFocus(i, p); return; }   // 3D: the game's planet focus (camera flies in, PLANET side panel)
        if (p.mine) { a.S.selected = p.id; try { await a.refreshPlanets([p.id]); } catch (e) { /* the poll catches up */ } showView("planet"); return; }
        try { await a.call([[103, a.W.concat([a.W.v(1, p.id), a.W.v(2, 1)])]]); } catch (e) { /* owners from the overlay only */ } openOrders(ordersFor(p, a.S.planets.get(p.id), p.npc ? "pirate base" : (p.own && p.own.label) || "free"));
      };
    });
  }
  /* ---- Carrier detail (frame Lb_t75.PNG, first version): the carrier in 3D on the planet canvas (gofa3d.js R.ship: the server's carrier type 1-16 IS
     the game's look value: tier band 1 / 5 / 9 / 13 = MK I / II / III / Void, +1 blue, +2 red, +3 yellow overlay on the top stage), the player's species,
     the system nebula, "MANAGE FLEETS", the carrier's name and "MK I - LEVEL: n" in cyan; drag turns the ship, the X goes back to the fleet list.
     Placed by eye on Lb_t75; not done: the hangar camera / light from the code, the carrier's own buttons (group, avoid combat, info, delete, upgrade). ---- */
  let cv3 = null, topBar = [];
  function openCarrier(c) {
    if (!cv3) {
      const L = el("div", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px", display: "none" });
      const T = { textShadow: "none", lineHeight: "56px" };
      text("MANAGE FLEETS", 262, 60, 48, "#fff", T, L); image("headline_icon_shipyard-fleets", 78, 42, { parent: L });
      const nm = text("", 178, 172, 40, "#fff", T, L), mk = text("", 178, 216, 40, "#38d6f2", T, L);
      pressButton("button_small_close", 1950, 92, 128, 128, () => { showView("planet"); openFleets(); }, "Back to the fleet list", L);
      // previous / next carrier (Lb_t75: round arrows at the sides, centres about (110, 766) and (1936, 766)), in the fleet list's order (home planet, by id)
      const step = (k) => { const prev = cv3.c ? { sp: cv3.void ? "void" : (SPECIES[A().S.race] || "terran"), mk: cv3.mkNum, colour: cv3.colour } : null; const S = A().S, home = S.planets.get(S.order[0]), list = home ? [...home.carriers].sort((x, y) => x.id - y.id) : []; if (!list.length) return; const i = list.findIndex((x) => x.id === cv3.c.id); openCarrier(list[(i + k + list.length) % list.length]); if (prev && cv3.c) cv3.slide = { from: prev, dir: k, p: 0, v: 0 };   /* same tick as the switch: no frame of the new ship at the centre */ };
      // info (Lb_t75: the round "i" at about (1484, 516)): the carrier's data as a dialog until the game's info panel is rebuilt
      pressButton("button_small_info", 1484, 516, 128, 128, () => { const c = cv3.c, pm = planetMeta(c.at), t = c.type || 1; dialog("CARRIER #" + c.id, (MKNAME[t - (t - 1) % 4] || "MK") + " - level " + (c.level || 1) + (cv3.colour ? ", " + cv3.colour + " upgrades" : "") + "\n" + (c.moving ? "in flight" : "at " + (pm ? pm.name : c.at)) + "\nShips: " + (c.ships && c.ships.length ? c.ships.map((x) => x.count + " x " + (A().SHIP[x.type] || x.type)).join(", ") : "none") + "\n\nOrders (load, relocate, upgrade) are in the plain interface for now."); }, "Carrier information", L);
      pressButton("button_back", 110, 766, 156, 156, () => step(-1), "Previous carrier", L); pressButton("button_next", 1936, 766, 156, 156, () => step(1), "Next carrier", L);
      L.onpointerdown = (e) => { if (e.target !== L) return; cv3.drag = { x: e.clientX, y: e.clientY, yaw: cv3.yaw, pitch: cv3.pitch, k: 2048 / L.getBoundingClientRect().width }; L.setPointerCapture(e.pointerId); };
      L.onpointermove = (e) => { const d = cv3.drag; if (!d) return; const C = d.k * 0.5 * 0.001; cv3.yaw = d.yaw + (e.clientX - d.x) * C; cv3.pitch = Math.max(0.2, Math.min(1, d.pitch + (e.clientY - d.y) * C)); };
      // the game's hangar orbit (0x100375694, called by the scene update 0x100374cc0 with the drag x 0.001): yaw -= dx, pitch -= dy (fmod 2 pi), pitch
      // clamped to [-1, -0.2] in its sign = 0.2 .. 1 rad above the ship here; 0.001 rad per point (2048 stage px = 1024 points). Was yaw only at 0.008 rad per point
      L.onpointerup = () => (cv3.drag = null);
      // upgrade (Lb_t75 bottom right: "UPGRADE 2, COSTS 2/0" + the artifact icon, the upgrade button): request 213 {1 carrier, 2 new level, 3 colour
      // 1 red / 2 blue / 3 yellow} (server handle_213); a plain carrier first gets a colour (picked here), a coloured one goes up one level (max 20).
      // The artifacts needed and owned come from the server's read-only quote (/debug/quote carrier=TYPE&level=L), not from rules in the page.
      const upT = text("", 0, 1392, 40, "#fff", { ...T, left: "auto", right: "300px" }, L), upX = text("", 0, 1455, 40, "#22b8ea", { ...T, left: "auto", right: "210px" }, L), upI = el("div", { position: "absolute", left: "1788px", top: "1388px", width: "56px", height: "56px", WebkitMaskImage: "url(" + art("icon_artifact") + ")", maskImage: "url(" + art("icon_artifact") + ")", WebkitMaskSize: "contain", maskSize: "contain", pointerEvents: "none" }, L), pick = text("", 1336, 1330, 36, "#9fb6c4", T, L);
      const upB = pressButton("button_upgrade", 1938, 1420, 156, 156, () => upgradeCarrier(), "Upgrade the carrier", L);
      // avoid combat (Lb_t75 top left: checkbox ~(92, 356), the running-man icon, "AVOID COMBAT"): request 254 {1 carrier, 2 behaviour 1 engage /
      // 2 avoid} (client 0x100365044: checked -> 2); the state is carrier record field 9 (app.js c.behaviour)
      const avB = image("checkbox_0", 28, 292, { parent: L, click: () => setBehaviour() }); avB.title = "Avoid combat";
      image("icon_avoid_combat", 160, 334, { parent: L }); text("AVOID COMBAT", 238, 328, 38, "#fff", T, L);
      // group (Lb_t75 bottom left: button_group ~(110, 1204), the group name or "NO GROUP" in cyan, "CHANGE CARRIER GROUP"): 330 creates a group
      // {1 0, 2 "Group n"}, 329 {1 carrier, 2 group} puts the carrier in it; the groups come from 109 field 2 (app.js S.groups)
      pressButton("button_group", 110, 1204, 156, 156, () => chooseGroup(), "Change carrier group", L);
      pressButton("button_next", 110, 520, 156, 156, () => cv3.c && loadShips(cv3.c), "Load ships into the carrier", L); text("LOAD SHIPS", 210, 492, 38, "#fff", T, L); text("INTO THE CARRIER", 210, 540, 38, "#38d6f2", T, L);   // my addition: the original screen for this is not known
      const grT = text("", 210, 1150, 38, "#38d6f2", T, L); text("CHANGE CARRIER GROUP", 210, 1204, 38, "#fff", T, L);
      // demolish (Lb_t75: the trash can above the upgrade button ~(1936, 1206)): the game's confirm text, then request 247 {1 carrier}
      pressButton("button_trash", 1936, 1206, 156, 156, () => demolishCarrier(), "Demolish the carrier", L);
      const ld = text("LOADING THE CARRIER …", 0, 740, 40, "#38d6f2", { ...T, width: W + "px", textAlign: "center" }, L);   // the ship's textures take seconds the first time: say so instead of an empty sky
      cv3 = { layer: L, nm, mk, ld, yaw: 0.9, c: null, upT, upX, upI, upB, pick, col: 1, avB, grT };
    }
    const t = c.type || 1, band = Math.min(3, Math.floor((t - 1) / 4)), off = (t - 1) % 4;
    const entering = view !== "carrier"; if (entering) cv3.pop = { x: 1, v: 0 };   // entering the screen: the reset (0x10037670c) sets the pop spring to 1 (prev / next and reloads of the same view do not: the game swipes its carousel there)
    cv3.c = c; cv3.mkNum = band + 1; cv3.void = t >= 13; cv3.colour = [null, "blue", "red", "yellow"][off]; if (entering) { cv3.yaw = 0.625; cv3.pitch = 0.343; }   /* only on entering (the reset 0x10037670c): the carousel keeps the camera, so prev / next no longer snap the view back */ cv3.fovV = Math.PI / 4;   /* 45 degrees VERTICAL: with the game's own camera (2000 from the origin, ship x 0.44) only this gives Lb_t75's ship size (61 % of the width vs 63 %; horizontal 45 made it ~30 % too big) */ cv3.fit = null;   // the hangar camera from the game (0x100377620 + scene reset 0x10037670c): start turn 0.625 rad, 0.343 rad down, fov 45 degrees (horizontal, as the system view's 20), clip 150 / 6000; mirrored render (left-handed engine). Was 0.9 / 0.45 / 0.7 by eye; a hull-mask fit on Lb_t75 prefers the game's values (IoU 0.42 vs 0.40; best 0.46 at 0.68 / 0.40)
    cv3.nm.textContent = "Carrier #" + c.id; cv3.mk.textContent = (MKNAME[t - off] || "MK I") + " - LEVEL: " + (c.level || 1);
    cv3.avB.src = art(c.behaviour === 2 ? "checkbox_1" : "checkbox_0"); cv3.grT.textContent = c.group ? (A().S.groups.get(c.group) || "GROUP " + c.group).toUpperCase() : "NO GROUP";
    if (fl) fl.p.close(); showView("carrier"); carrierUpgradeInfo(); return true;
  }
  const COL_NAME = { 1: "RED", 2: "BLUE", 3: "YELLOW" }, COL_CSS = { 1: "#ff5a4a", 2: "#4aa8ff", 3: "#ffd23a" }, OFF_COL = { 1: 2, 2: 1, 3: 3 }, COL_OFF = { 1: 2, 2: 1, 3: 3 };   // type offset <-> colour (ruleset COLOUR_OFFSET)
  const UPG_TEXT = { 1: "increases attack and accuracy of bombers and fighters by <VALUE>%", 2: "increases defense and hitpoints for interceptors and fighters by <VALUE>%",
    3: "increases the carrier's speed by <VALUE>%" };   // data/loca_en.tsv INFO_UPGRADE_ARTIFACT_RED / BLUE / YELLOW
  function carrierNext() {   // -> { colour, type, level } of the next upgrade, or null at the top level
    const c = cv3.c, t = c.type || 1, off = (t - 1) % 4, tier = Math.floor((t - 1) / 4);
    if (off) { const lv = (c.level || 1) + 1; return lv > 20 ? null : { colour: OFF_COL[off], type: t, level: lv }; }
    return { colour: cv3.col, type: tier * 4 + 1 + COL_OFF[cv3.col], level: 1 };
  }
  async function carrierUpgradeInfo() {
    const c = cv3.c, nx = carrierNext(), a = A(), plain = !((c.type - 1) % 4);
    cv3.pick.textContent = ""; cv3.pick.onclick = null;
    if (plain) {   // colour choice: click the word to cycle red -> blue -> yellow
      cv3.pick.textContent = "COLOUR: " + COL_NAME[cv3.col] + "  (click to change)"; cv3.pick.style.pointerEvents = "auto"; cv3.pick.style.cursor = "pointer";
      cv3.pick.onclick = () => { cv3.col = cv3.col % 3 + 1; carrierUpgradeInfo(); };
    }
    cv3.upX.textContent = "";
    if (!nx) { cv3.upT.textContent = "MAXIMUM LEVEL"; cv3.upI.style.display = "none"; cv3.upB.style.opacity = ".4"; return; }
    cv3.upB.style.opacity = ""; cv3.upI.style.display = ""; cv3.upI.style.background = COL_CSS[nx.colour]; cv3.upT.textContent = "UPGRADE " + nx.level + ", COSTS ...";
    const me = a.S.me.player.toString(16).toUpperCase(), q = await fetch("/debug/quote?planet=" + a.S.order[0] + "&carrier=" + nx.type + "&level=" + nx.level + "&player=" + me).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (cv3.c !== c) return;
    const [item, need] = q && q.items ? Object.entries(q.items)[0] || [] : [], have = item && q.inventory ? q.inventory[item] || 0 : 0;
    // Lb_t75: both lines right-aligned before the icon / button, "UPGRADE 2, COSTS" white, only "2/0" red (not enough artifacts; white assumed when enough), the bonus line cyan
    cv3.upT.textContent = "UPGRADE " + nx.level + ", COSTS "; const nh = el("span", { color: need != null && have >= need ? "#fff" : "#f2606a" }, cv3.upT); nh.textContent = need != null ? need + "/" + have : "?";
    // the bonus line under it (Lb_t75 "increases ... by 7%"): the game's INFO_UPGRADE_ARTIFACT_* text, the next level's bonus from the quote (server carrier_bonus)
    if (q && q.bonus) { cv3.upX.textContent = UPG_TEXT[nx.colour].replace("<VALUE>", +q.bonus.toFixed(1)); } cv3.upB.style.opacity = need != null && have >= need ? "" : ".4";
  }
  const freshCarrier = (id) => { const S = A().S, home = S.planets.get(S.order[0]); return home && home.carriers.find((x) => x.id === id); };
  async function carrierCmd(label, ext, body, title) {   // send one carrier request, reopen the view with the fresh record
    const a = A(), id = cv3.c.id;
    try { await a.simpleOrder(label, [[ext, a.W.concat(body)]]); } catch (e) { dialog(title, "The server refused: " + (e.message || e)); return false; }
    const f = freshCarrier(id); if (f) openCarrier(f); return true;
  }
  async function setBehaviour() {
    const a = A(), c = cv3.c, nb = c.behaviour === 2 ? 1 : 2;
    await carrierCmd((nb === 2 ? "avoid combat" : "engage") + " with carrier #" + c.id, 254, [a.W.v(1, c.id), a.W.v(2, nb)], "AVOID COMBAT");
  }
  function chooseGroup() {   // the game's own group screen is not rebuilt: a list in the information dialog (NO GROUP, the groups, CREATE GROUP)
    const a = A(), c = cv3.c, S = a.S, p = dialog("CHANGE CARRIER GROUP", "");
    const opts = [[0, "NO GROUP"], ...[...S.groups].map(([id, n]) => [id, n.toUpperCase()]), [-1, "CREATE GROUP"]];
    opts.forEach(([id, label], i) => { const t = text((id === (c.group || 0) ? "> " : "  ") + label, 57, 200 + i * 70, 43, id === -1 ? "#38d6f2" : "#fff", { textShadow: "none", cursor: "pointer", pointerEvents: "auto" }, p.root);
      t.onclick = async () => {
        p.close(); let gid = id;
        if (id === -1) {   // the client names a new group "Group <n>" (0x1006de7f4)
          const before = new Set(S.groups.keys());
          try { await a.simpleOrder("create a carrier group", [[330, a.W.concat([a.W.v(1, 0), a.W.ld(2, "Group " + (S.groups.size + 1))])]]); } catch (e) { dialog("CREATE GROUP", "The server refused: " + (e.message || e)); return; }
          gid = [...S.groups.keys()].find((k) => !before.has(k)); if (!gid) return;
        }
        if (gid !== (c.group || 0)) await carrierCmd("carrier #" + c.id + " to group " + gid, 329, [a.W.v(1, c.id), a.W.v(2, gid)], "CHANGE CARRIER GROUP");
      }; });
  }
  function demolishCarrier() {   // confirm with the game's text (INFO_REALLY_DEMOLISH_CARRIER), then 247
    const a = A(), c = cv3.c, p = dialog("DEMOLISH", "Demolishing the carrier will also destroy all ships, troops, resources and artifacts on board. Are you sure you want to proceed?");
    const yes = text("DEMOLISH", 57, 900, 48, "#f2606a", { textShadow: "none", cursor: "pointer", pointerEvents: "auto" }, p.root);
    yes.onclick = async () => {
      p.close();
      try { await a.simpleOrder("demolish carrier #" + c.id, [[247, a.W.v(1, c.id)]]); } catch (e) { dialog("DEMOLISH", "Unable to demolish carrier. " + (e.message || e)); return; }
      const S = a.S, home = S.planets.get(S.order[0]), list = home ? [...home.carriers].filter((x) => x.id !== c.id).sort((x, y) => x.id - y.id) : [];
      if (home) home.carriers = home.carriers.filter((x) => x.id !== c.id);   // the planet merge keeps an emptied list (app.js mergePlanet)
      if (list.length) openCarrier(list[0]); else { showView("planet"); openFleets(); }
    };
  }
  async function upgradeCarrier() {
    const c = cv3.c, nx = carrierNext(), a = A(); if (!nx) return;
    try { await a.simpleOrder("upgrade carrier #" + c.id + " to " + COL_NAME[nx.colour].toLowerCase() + " level " + nx.level, [[213, a.W.concat([a.W.v(1, c.id), a.W.v(2, nx.level), a.W.v(3, nx.colour)])]]); }
    catch (e) { dialog("UPGRADE", "The server refused the upgrade: " + (e.message || e)); return; }
    const S = a.S, home = S.planets.get(S.order[0]), fresh = home && home.carriers.find((x) => x.id === c.id);
    if (fresh && (fresh.type !== c.type || fresh.level !== c.level)) openCarrier(fresh); else { dialog("UPGRADE", "Not upgraded: not enough artifacts (or resources)."); carrierUpgradeInfo(); }
  }
  function showView(v) {
    if (cv3) cv3.layer.style.display = v === "carrier" ? "block" : "none";
    topBar.forEach((e) => (e.style.visibility = v === "carrier" ? "hidden" : ""));
    view = v; planetLayer.style.display = v === "planet" ? "block" : "none";
    if (sys) sys.layer.style.display = v === "system" ? "block" : "none";
    const wasGalaxy = gal && gal.layer.style.display === "block";
    if (gal) gal.layer.style.display = v === "galaxy" ? "block" : "none";
    moveClock(v === "galaxy" ? 1385 + (gal ? gal.barOff : 0) : 1496);
    if (v === "system") sysDraw();
    if (v === "galaxy") {   // hard cut (Random2 28.03 s), then the bar slides up from its collapsed place; the first opening centres on the start system at the closest zoom
      const v0 = galaxyStartView(); if (!gal.placed && v0) { gal.placed = true; [gal.cx, gal.cy] = v0; gal.k = 222; }
      else if (!gal.placed) { const own = A().S.order.find((p) => p > 1e9); if (own) { gal.cx = (Math.floor(own / 1e11) + .5) * 30; gal.cy = (Math.floor(own / 1e7) % 1e4 + .5) * 30; } }
      if (!wasGalaxy && !gal.collapsed) galaxyCollapse(false, true); galaxyDraw(); setRef();
    } else if (wasGalaxy) setRef();
  }

  /* ---- Planet list (first button of the top bar): frame Lb_t73.PNG (recording Leaderboards.MP4 at 73 s; the file is really a build session), full panel 16,16 2016 x 1504,
     header line 148, a line at 170, rows 170 apart: planet picture (planet_list_<type>) at x 115, name (38 px), a small second line, three resource columns (icon, amount,
     and below it an orange badge with the ship / troop / spy drone count in yellow) between white separators, forward button at x 1867. Numbers are floored to "74k".
     The marker at the left of the open planet and the stripes are placed by eye. Planet names and types come from the galaxy sector data (the home planet is Home1,
     ocean: the Terran home). Not faithful / unknown: the second line (a dash in the frame) shows the system name, rows are not sorted like the game's. ---- */
  const PTYPE = { 1: "ocean", 2: "jungle", 3: "ice", 4: "mountain", 5: "volcano", 6: "desert", 7: "citadel_blue", 8: "citadel_red", 9: "citadel_yellow" };
  const metaCache = new Map();   // planet id -> { name, type, system }
  function planetMeta(id) {
    if (metaCache.has(id)) return metaCache.get(id);
    // home planets (1101 ...) are map records too, in sector 0_0 (systems Home 1001 type 3, A'Belarr 2001 type 4, Ninarah 3001 type 1), with their pads and seed
    metaCache.set(id, null);   // loading
    const G = window.GoFAGalaxy, sx = Math.floor(id / 1e11), sy = Math.floor(id / 1e7) % 1e4;
    if (G) G.loadSector(sx, sy).then(() => { const sec = G.sectors.get(sx + "_" + sy), sm = sec && sec.systems.find((s) => s.planets.some((q) => q.id === id)); if (sm) { const q = sm.planets.find((r) => r.id === id); metaCache.set(id, { name: sm.name + q.number, type: q.type, system: sm.name, systemType: sm.type, systemSeed: sm.seed, pads: q.pads, padSeed: q.padSeed }); if (pl) pl.sig = ""; } else metaCache.delete(id); }).catch(() => metaCache.delete(id));
    return null;
  }
  const kfmt = (n) => (n >= 1e6 ? Math.floor(n / 1e5) / 10 + "M" : n >= 1000 ? Math.floor(n / 1000) + "k" : String(Math.floor(n)));
  const shieldCache = new Map();   // the orange shield with a dark glyph (the recording's troop / drone badges): drawn from the white glyph sprite
  function shieldGlyph(name) {
    if (!shieldCache.has(name)) shieldCache.set(name, new Promise((res) => {
      const im = new Image(); im.onload = () => {
        const cv = document.createElement("canvas"); cv.width = 92; cv.height = 84; const c = cv.getContext("2d"), g = c.createLinearGradient(0, 0, 0, 84); g.addColorStop(0, "#ff6a00"); g.addColorStop(1, "#ffb400");
        c.fillStyle = g; c.beginPath(); c.moveTo(8, 10); c.lineTo(46, 2); c.lineTo(84, 10); c.lineTo(84, 56); c.lineTo(46, 82); c.lineTo(8, 56); c.closePath(); c.fill();
        const t = document.createElement("canvas"); t.width = t.height = 84; const tc = t.getContext("2d"); tc.drawImage(im, 0, 0); const d = tc.getImageData(0, 0, 84, 84);
        for (let i = 0; i < d.data.length; i += 4) { const l = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3, a = d.data[i + 3]; if (a > 128 && l > 140) { d.data[i] = 11; d.data[i + 1] = 42; d.data[i + 2] = 64; d.data[i + 3] = Math.min(255, (l - 140) * 3); } else d.data[i + 3] = 0; }
        tc.putImageData(d, 0, 0); c.drawImage(t, 14, 8, 64, 64); res(cv.toDataURL());
      }; im.src = art(name);
    }));
    return shieldCache.get(name);
  }
  let pl = null;
  function openPlanetList() {
    if (pl) return; const a = A();
    const p = panel({ x: 16, y: 16, w: 2016, h: 1504, icon: "headline_icon_planet", title: "PLANET LIST", headY: 148, crossY: [469, 746, 1021, 1298], crossCenter: true, ref: "Lb_t73.PNG", onClose: () => { pl = null; } });
    pl = { p, sig: "", sc: null };
    hline(p.root, 35, 170, 1945);
    const sc = scroller(p.root, 17, 171, 1963, 1300, 1963); pl.sc = sc;
    pl.draw = () => {
      const S = A().S, ids = S.order.filter((id) => S.planets.has(id));
      const sig = JSON.stringify([ids, S.selected, ids.map((id) => { const q = S.planets.get(id); return [[1, 2, 3].map((t) => Math.floor(A().curAmount(q, t) / 1000)), q.ships.map((x) => x.count), (q.resources.find((r) => r.type === 4) || {}).amount, (q.resources.find((r) => r.type === 5) || {}).amount, !!metaCache.get(id)]; })]);
      if (sig === pl.sig) return; pl.sig = sig;
      const I = sc.inner; I.textContent = ""; const T = { textShadow: "none", lineHeight: "52px" };
      const go = async (id) => { const a2 = A(); a2.S.selected = id; try { await a2.refreshPlanets([id]); } catch (e) { /* the poll catches up */ } pl.p.close(); showView("planet"); };
      ids.forEach((id, i) => {
        const q = S.planets.get(id), R = i * 170, m = planetMeta(id), here = id === S.selected;
        image("list_bg_bar2", 60, R + 70, { parent: I }).style.width = "740px";
        const pic = image("planet_list_" + (PTYPE[m && m.type] || "ice"), 0, 0, { parent: I }); pic.onload = () => { pic.style.left = 115.5 - pic.naturalWidth / 2 + "px"; pic.style.top = R + 87 - pic.naturalHeight / 2 + "px"; };
        if (here) { const mk = image("list_highlight_marker", 0, 0, { parent: I }); mk.onload = () => { mk.style.left = "22px"; mk.style.top = R + 87 - mk.naturalHeight / 2 + "px"; }; }
        text(m ? m.name.toUpperCase() : String(id), 225, R + 32, 38, "#fff", T, I); text(m ? m.system : "", 225, R + 99, 30, "#9fd2e6", { ...T, lineHeight: "40px" }, I);
        const tr = q.resources.find((r) => r.type === 4), dr = q.resources.find((r) => r.type === 5), ships = q.ships.reduce((s, x) => s + x.count, 0);
        [[811, "res_icon_metal", 1, 41.5, 38.5, 1004, "sm_icon_ships", ships], [1138, "res_icon_gas", 2, 42, 36, 1332, "sm_icon_marines", tr ? tr.amount : 0], [1466.5, "res_icon_crystal", 3, 41.5, 40.5, 1659, "sm_icon_spydrones", dr ? dr.amount : 0]].forEach(([ix, icon, rt, cx, cy, nx, badge, cnt], k) => {
          image(icon, ix, R + 5, { parent: I }); text(":", ix + 110, R + 30, 38, "#27d0f0", T, I);
          text(kfmt(A().curAmount(q, rt)), nx, R + 30, 38, "#fff", { ...T, width: "0px", transform: "translateX(-50%)" }, I);
          const bd = image("ship-icon", ix + 42 - 46, R + 120 - 42, { parent: I }); if (badge !== "sm_icon_ships") shieldGlyph(badge).then((u) => (bd.src = u));
          text(":", ix + 110, R + 88, 38, "#27d0f0", T, I); text(kfmt(cnt), nx, R + 88, 38, "#d9a21c", { ...T, width: "0px", transform: "translateX(-50%)" }, I);
        });
        [778, 1090, 1418, 1747].forEach((x) => el("div", { position: "absolute", left: x + "px", top: R + 33 + "px", width: "2px", height: "108px", background: "rgba(220,235,245,.55)" }, I));
        pressButton("button_next", 1867, R + 86, 156, 156, () => go(id), "Open", I);
        image("line-blue_corner_list", 7, R + 169 - 100, { parent: I }); hline(I, 39, R + 169, 1924);
        const hit = el("div", { position: "absolute", left: "0px", top: R + "px", width: "1760px", height: "169px", cursor: "pointer" }, I); hit.onclick = () => go(id);
      });
      sc.setHeight(ids.length * 170 + 6);
    };
    pl.draw();
  }

  /* ---- Manage fleets (list view): frame Lb_fleets_list.PNG (recording Leaderboards.MP4 at 117 s), full panel 16,16 2016 x 1504: header with the fleet icon, a switch and a
     faded second fleet icon, title at x 650; a line at 171, the group band "NO GROUP" (stripes, sub line at 274 with the rise), then one row per carrier, 170 apart: shield badge
     (ship-icon_carrier*), name, "MK I - LEVEL: n" in cyan, the ship picture, a separator, the planet name and picture, a separator, ships and cargo counters, forward button.
     Not faithful / unknown: carriers have no names in our data (shows "Carrier #id"), groups do not exist (everything is NO GROUP, the switch does nothing), the hangar
     capacity is not known to the page (ships show without "/77"), the ship picture is the Terran icon whatever the species, the ring around it and the red triangles are
     missing, the forward button shows a text dialog (the carrier detail screen with the rotating 3D ship, frames Lb_t75, is not built). ---- */
  const cBase = (c) => { const t = c.type || 1; return t - (t - 1) % 4; };   // coloured carriers (type +1 blue / +2 red / +3 yellow) share their tier's name and pictures
  const MKNAME = { 1: "MK I", 5: "MK II", 9: "MK III", 13: "VOID" }, CBADGE = { 1: "ship-icon_carrierI", 5: "ship-icon_carrierII", 9: "ship-icon_carrierIII", 13: "ship-icon_carrier_void" }, CPIC = { 1: "icon_terran_commandship", 5: "icon_terran_commandship_2", 9: "icon_terran_commandship_3", 13: "icon_void_commandship" };
  let fl = null; const cargoQ = new Map();
  function openFleets() {
    if (fl) return;
    const p = panel({ x: 16, y: 16, w: 2016, h: 1504, icon: "headline_icon_shipyard-fleets", title: "MANAGE FLEETS", titleX: 650, headY: 148, headSplit: 527, crossY: [469, 746, 1021, 1298], crossCenter: true, ref: "Lb_fleets_list.PNG", onClose: () => { fl = null; } });
    fl = { p, sig: "" };
    image("button_small_toggle_bg", 179, 102 - 32, { parent: p.root }); pressButton("button_small_toggle", 223, 102, 128, 128, () => {}, "Groups (not available)", p.root); const f2 = image("headline_icon_fleets", 435 - 50, 99 - 50, { parent: p.root }); f2.style.opacity = ".45";
    hline(p.root, 35, 171, 1945);
    const L = 170; image("list_bar_head2", 35, L + 56, { parent: p.root }).style.width = "886px"; text("NO GROUP", 183, L + 30, 44, "#fff", { textShadow: "none", lineHeight: "52px" }, p.root);
    hline(p.root, 35, L + 104, 851); image("line-blue_corner_subhead", 886, L + 4, { parent: p.root });
    const sc = scroller(p.root, 17, 274, 1963, 1190, 1963); fl.sc = sc;
    fl.draw = () => {
      const S = A().S, home = S.planets.get(S.order[0]); if (!home) return; const list = [...home.carriers].sort((x, y) => x.id - y.id);
      const sig = JSON.stringify([list.map((c) => [c.id, c.type, c.level, String(c.at), c.moving, c.ships, (cargoQ.get(c.id) || {}).done]), list.map((c) => !!planetMeta(c.at))]); if (sig === fl.sig) return; fl.sig = sig;
      const I = sc.inner; I.textContent = ""; const T = { textShadow: "none", lineHeight: "52px" };
      list.forEach((c, i) => {
        const R = i * 170; if (!cargoQ.has(c.id)) { cargoQ.set(c.id, { done: false }); A().quoteMove(c.id, c.at || home.id).then((q) => { cargoQ.set(c.id, { done: true, q }); fl && (fl.sig = ""); }); }
        const cq = (cargoQ.get(c.id) || {}).q, used = cq ? Object.values(cq.cargo).reduce((s, n) => s + n, 0) : 0, ships = c.ships.reduce((s, x) => s + x.count, 0), m = c.moving ? null : planetMeta(c.at);
        image("list_bg_bar2", 18, R + 91, { parent: I }).style.width = "720px";
        const mk = image("list_highlight_marker", 22, R + 89 - 14, { parent: I }); mk.style.opacity = i === 0 ? "1" : "0";
        const bd = image(CBADGE[cBase(c)] || "ship-icon_carrierI", 97 - 17 - 46, R + 89 - 42, { parent: I });
        text("Carrier #" + c.id, 146, R + 32, 42, "#fff", T, I); text((MKNAME[cBase(c)] || "MK") + " - LEVEL: " + c.level, 146, R + 85, 42, "#27d0f0", T, I);
        const pic = image(CPIC[cBase(c)] || CPIC[1], 0, 0, { parent: I }); pic.onload = () => { const k = 230 / pic.naturalWidth; pic.style.width = "230px"; pic.style.left = 593 - 17 - 115 + "px"; pic.style.top = R + 84 - pic.naturalHeight * k / 2 + "px"; };
        el("div", { position: "absolute", left: 729 - 17 + "px", top: R + 48 + "px", width: "2px", height: "87px", background: "rgba(220,235,245,.55)" }, I);
        text(c.moving ? "IN FLIGHT" : m ? m.name.toUpperCase() : String(c.at), 739 - 17, R + 32, 42, "#fff", T, I);
        const ps = image("planet_list_" + (PTYPE[m && m.type] || "ice"), 0, 0, { parent: I }); ps.onload = () => { ps.style.left = 1233 - 17 - ps.naturalWidth / 2 + "px"; ps.style.top = R + 84 - ps.naturalHeight / 2 + "px"; };
        el("div", { position: "absolute", left: 1330 - 17 + "px", top: R + 48 + "px", width: "2px", height: "87px", background: "rgba(220,235,245,.55)" }, I);
        const i1 = image("fleet-stats_icon_ships", 0, 0, { parent: I }); i1.onload = () => { i1.style.left = 1382 - 17 - i1.naturalWidth / 2 + "px"; i1.style.top = R + 63 - i1.naturalHeight / 2 + "px"; };
        const i2 = image("fleet-stats_icon_cargo", 0, 0, { parent: I }); i2.onload = () => { i2.style.left = 1382 - 17 - i2.naturalWidth / 2 + "px"; i2.style.top = R + 118 - i2.naturalHeight / 2 + "px"; };
        text(String(ships), 1418 - 17, R + 29, 32, "#fff", { ...T, lineHeight: "44px" }, I); text(cq ? used + "/" + cq.capacity : "", 1418 - 17, R + 83, 32, "#fff", { ...T, lineHeight: "44px" }, I);
        pressButton("button_next", 1889 - 17, R + 84, 156, 156, () => (p3 ? openCarrier(c) : 0) || dialog("CARRIER #" + c.id, (MKNAME[cBase(c)] || "MK") + " - level " + c.level + "\n" + (c.moving ? "in flight" : "at " + (m ? m.name : c.at)) + "\nShips: " + (c.ships.length ? c.ships.map((x) => x.count + " x " + (A().SHIP[x.type] || x.type)).join(", ") : "none") + "\nCargo: " + used + (cq ? " of " + cq.capacity : "") + "\n\nThe carrier screen (loading, orders) is in the plain interface for now."), "Open", I);
        image("line-blue_corner_list", 7, R + 170 - 100, { parent: I }); hline(I, 39, R + 170, 1924);
      });
      sc.setHeight(Math.max(1, list.length) * 170 + 6);
    };
    fl.draw();
  }
  function setRef() { const r = document.getElementById("pRef"); if (r) r.src = "/art/ref/" + ((panels.length && panels[panels.length - 1].ref) || (view === "galaxy" && gal && (GAL_MODES[gal.mode].ref || "Random2_GalDiplomacy.PNG")) || (view === "system" && "Random2_t14.PNG") || "Final.PNG"); }

  /* ---- 3D planet behind the planet screen: gofa3d.js runs the game's own planet + atmosphere shaders (data: re-tools/ae3/export_viewer.py, served
     under /art/3d/, local only). Placement = the stand-in's circle (centre 1030, 840, radius 560 stage px): camera on +Z, fov 0.7, distance chosen
     so the 512-unit sphere projects to 560 px, the 2048 x 1536 canvas shifted so its centre is the planet centre. Light from the right and a little
     behind, calibrated on Final.PNG (docs/ART_3D.md). Compositing: the halo must ADD onto the starfield (it is additive in the game; Chrome clamps premultiplied colour to alpha, so instead: the canvas is opaque black and composited with mix-blend-mode plus-lighter = additive,
     and the stand-in div becomes a black disc just inside the planet's silhouette so the stars do not show through the planet). Types: map type 1-9 -> planetCube materials (citadels 7 / 8 / 9 = blue / red / yellow rim = citadel_a / b / c). Falls back to the
     CSS globe when WebGL or the export is missing. Drag on the planet turns it as an arcball (the grabbed surface point follows the pointer, eased by about 0.05 s so it
     does not feel rigid), a flick keeps the cursor's speed at release (last 80 ms of movement, capped at 5 rad/s) and glides out (time constant 0.4 s) and settles back into the slow spin; a release
     anywhere (window, lost capture, a move with no button) ends the drag. Clouds drift slowly over the surface.
     Pads: the game's own layout (padLayout below, ported from its code). Each pad: the species' socket, and where a structure stands its building
     (types 1-11 -> building_<species>_<name>) and the ground ring (half size 45: the hexagon frames around the pads in Final.PNG). Not yet: the
     nebula background, the citadel artifact on citadel planets (it stands at the surface point padLayout avoids). ---- */
  const SPECIES = { 1: "terran", 2: "vossk", 3: "nivelian" };   // the player's species from response 111 (app.js S.race)
  const PAD_BLD = { 1: "hq", 2: "spaceport", 3: "metal_extractor", 4: "gas_extractor", 5: "crystal_extractor", 6: "barracks", 7: "research", 8: "scanner", 9: "planetary_shield", 10: "trade_center", 11: "artifact_center_type_a" };
  /* Pad layout, ported from the game (planet scene 0x1002d8250, read with Ghidra; docs/ART_3D.md "Pad layout"): a java.util.Random-style generator
     (multiplier 0x5DEECE66D, + 0xB, 48 bits; seeded with (playerId XOR planet field 6) masked to 36 bits, XOR the multiplier, then one step;
     nextFloat = bits 24-47 / 2^24) places as many pads as planet field 5 says (5-12). Normal planets: y = f * 1.8126 - 0.9063 (within +-65 degrees),
     longitude = f * 2 pi, x = r cos, z = r sin. Citadels (types 7-9): a random point in the cone of cos >= -0.7986 around the direction opposite the
     artifact (the surface point (7.58, -82.38, -505.27)), kept only within +-65 degrees. A candidate closer than sqrt(0.2384) (about 28 degrees) to a
     placed pad is rejected; after 2000 rejections the whole layout starts again. A second generator with the same seed gives each pad a turn about its
     normal (f * 2 pi). Pad matrix = Ry(atan2(x, z)) * Rx(-asin(y)) * Rz(turn) * Rx(90) * T(0, R, 0), R = 512 (Vossk 510). Float maths in doubles
     (the game uses floats: a borderline rejection could differ). Slot n stands on pad n. */
  const MUL = 0x5DEECE66Dn, M48 = (1n << 48n) - 1n;
  function gameRandom(seed) {
    let s = ((((BigInt(seed) & 0xFFFFFFFFFn) ^ MUL) * MUL) + 0xBn) & M48;
    return () => { s = (s * MUL + 0xBn) & M48; return Number((s >> 24n) & 0xFFFFFFn) * 5.960464477539063e-08; };
  }
  const ART_DIR = (() => { const v = [7.57985258102417, -82.37578582763672, -505.2729797363281], l = Math.hypot(...v); return v.map((c) => -c / l); })();   // opposite the citadel artifact
  function padLayout(player, padSeed, count, type, radius) {
    const seed = BigInt.asUintN(64, BigInt(player || 0)) ^ BigInt(padSeed || 0), A = gameRandom(seed), B = gameRandom(seed), cit = type >= 7 && type <= 9, out = [];
    const TAU = 6.2831854820251465;
    // citadel: rotation that takes +Z to ART_DIR (quaternion from the half-way vector, as the game builds it)
    const d = ART_DIR, q = (() => { const w = 1 + d[2], v = [-d[1], d[0], 0], l = Math.hypot(v[0], v[1], v[2], w); return [v[0] / l, v[1] / l, v[2] / l, w / l]; })();
    const qrot = (v) => { const [x, y, z, w] = q, t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])]; return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])]; };
    for (let guard = 0; count > 0 && guard < 20; guard++) {
      out.length = 0; let rejects = 0;
      while (rejects < 2001 && out.length < count) {
        let x, y, z;
        if (cit) {
          for (;;) {
            const c = (1 + 0.7986354827880859) * A() - 0.7986354827880859, ph = A() * TAU, sn = Math.sqrt(Math.max(0, 1 - c * c));
            [x, y, z] = qrot([sn * Math.cos(ph), sn * Math.sin(ph), c]);
            if (Math.abs(y) <= 0.9063077569007874) break;
          }
        } else {
          y = A() * 1.8126155138015747 - 0.9063077569007874; const lon = A() * TAU, r = Math.sqrt(1 - y * y); x = r * Math.cos(lon); z = r * Math.sin(lon);
        }
        if (out.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2 >= 0.2384185791015625)) out.push({ x, y, z, turn: B() * TAU });
        else rejects++;
      }
      if (rejects < 2001) break;
    }
    const M = GoFA3D.M, rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); };
    return out.map((p) => M.mul(M.mul(M.mul(M.mul(M.rotY(Math.atan2(p.x, p.z)), M.rotX(-Math.asin(p.y))), rotZ(p.turn)), M.rotX(Math.PI / 2)), M.trans(0, radius, 0)));
  }
  const ART_FRAME = (() => {   // the citadel artifact's frame: at the surface point, up along its normal (0x1002d7034)
    const D = [7.57985258102417, -82.37578582763672, -505.2729797363281], l = Math.hypot(...D), Y = D.map((c) => c / l);
    let X = [Y[1] * 0 - Y[2] * 1, Y[2] * 0 - Y[0] * 0, Y[0] * 1 - Y[1] * 0]; const lx = Math.hypot(...X); X = X.map((c) => c / lx);
    const Z = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
    return new Float32Array([...X, 0, ...Y, 0, ...Z, 0, ...D, 1]);
  })();
  /* The nebula's look per star system, ported from the game (0x10048152c, read with Ghidra): the generator seeded with the system record's seed (map field 4,
     e.g. 122842 for Home; NOT the type 1-12 as first read, corrected 2026-11-15 on Real_SystemStart.png and Nice_HQ.PNG) gives
     two saturated hues (hue = f * 6, as HSV) for ColorRamp0.Min / Max, then the star offsets; a second one with the same seed gives a random axis
     (z = 2f - 1, longitude f * 2 pi) and angle (f * 2 pi) for Rotation0 = (axis * sin(a / 2), cos(a / 2)). */
  let skyFovLast = 95;   // the skybox material's Fov is shared: the system view sets it (lerp 90-95 by zoom) and the planet screen keeps the last value (Real_PlanetStart.PNG: 95, star-exact)
  /* Planet-screen sky (measured 2026-11-15 on the owner's iPad, Home1 planet screen: Real_PlanetStart.PNG at the start view and Real_PlanetDrag.PNG after a drag, both star-exact,
     100 / 100 dots): at the start view the sky maps view -> cube local by SKY_PLANET_R0 (row-major); after the planet is turned, the sky turns about the same on-screen axis by
     SKY_TURN of the angle (45.1 vs 58.6 degrees measured: 0.77; the system view's yaw law gives 0.765). */
  const SKY_PLANET_R0 = [-0.9244, 0.11962, -0.36219, 0.00014, 0.94966, 0.31328, 0.38144, 0.28954, -0.87788], SKY_TURN = 0.7653;
  function planetSkyWorld(orient, orient0) {
    const M = GoFA3D.M, d = M.mul(orient, M.inv(orient0));   // the planet's turn since the start, in our (mirrored-render) world
    const g = (r, c) => d[c * 4 + r] * ((r === 0) !== (c === 0) ? -1 : 1);   // seen unmirrored on screen: S_x d S_x
    const tr = g(0, 0) + g(1, 1) + g(2, 2), ang = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
    let ax = [g(2, 1) - g(1, 2), g(0, 2) - g(2, 0), g(1, 0) - g(0, 1)]; const l = Math.hypot(...ax);
    const R = SKY_PLANET_R0, R0T = new Float32Array([R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1]);
    if (!(l > 1e-9) || ang < 1e-6) return R0T;
    ax = ax.map((v) => v / l); const a = ang * SKY_TURN, c = Math.cos(a), s = Math.sin(a), t = 1 - c, [x, y, z] = ax;
    const Q = new Float32Array([t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1]);
    return M.mul(Q, R0T);
  }
  const SKY_YAW_K = 0.2347;   // system-view sky lag per radian of camera yaw (least squares over Real_SystemStart / Random2_t14 / Random2_t20, +-0.003)
  function skyParams(sysType) {
    const A = gameRandom(sysType || 1), hue = (f) => { const h = f * 6, i = Math.floor(h), t = h - i, u = 1 - t, c = (v) => Math.trunc(v * 255 + 0.5) / 255;
      const [r, g, b] = i === 0 ? [1, t, 0] : i === 1 ? [u, 1, 0] : i === 2 ? [0, 1, t] : i === 3 ? [0, u, 1] : i === 4 ? [t, 0, 1] : [1, 0, u]; return [c(r), c(g), c(b)]; };
    const lo = hue(A()), hi = hue(A()), so = [A(), A(), 0];
    const B = gameRandom(sysType || 1), z = 2 * B() - 1, lon = B() * 6.2831854820251465, r = Math.sqrt(Math.max(0, 1 - z * z)), ang = B() * 6.2831854820251465, sh = Math.sin(ang / 2);
    // as the game builds it (0x100260a38, 0x1009a483c), no sign changes: the old x flip compensated for drawing the sky mirrored (gofa3d.js now draws the
    // skybox unmirrored, proven on Real_SystemStart.png's star dots 2026-11-15)
    const q = [r * Math.cos(lon) * sh, r * Math.sin(lon) * sh, z * sh, Math.cos(ang / 2)];
    // the third colour (0x10048152c, kept at skybox +0x50): 20 % from Min to Max, then 85 % towards black, in bytes; the planet scene's ambient light
    // is built from it every frame (0x1002db90c, see planetLight)
    const c3 = lo.map((a, i) => { const A8 = Math.round(a * 255), B8 = Math.round(hi[i] * 255), m = Math.trunc((B8 - A8) * 0.2 + A8); return Math.trunc(m - m * 0.85 + 1e-4) / 255; });
    return { "ColorRamp0.Min": lo, "ColorRamp0.Max": hi, StarOffset0: so, Rotation0: q, _c3: c3 };
  }
  /* Cloud motion, from the game (0x1002d7034 -> 0x100260a38, applied each frame by 0x1002db90c): a generator seeded with the planet's map field 6
     alone gives a random unit axis (z = 2f - 1, longitude f * 2 pi); the clouds turn about it at 0.01 rad per second of device uptime, mod 2 pi
     (CloudsQuaternion = (axis sin(a/2), cos(a/2))). The planet itself never turns; each planet's clouds drift their own way. gofa3d.js R.cloudAxis */
  const cloudCache = new Map();
  function cloudAxis(seed) {
    const k = String(seed || 0); if (!cloudCache.has(k)) { const B = gameRandom(BigInt(seed || 0)), z = 2 * B() - 1, lon = B() * 6.2831854820251465, r = Math.sqrt(Math.max(0, 1 - z * z)); cloudCache.set(k, [r * Math.cos(lon), r * Math.sin(lon), z]); }
    return cloudCache.get(k);
  }
  const padCache = new Map();
  function padFrames(planetId, meta, species, minCount) {   // meta from planetMeta (pads, padSeed, type); the home planet has no map record: 12 pads, seed 0
    const count = Math.max((meta && meta.pads) || 12, minCount || 0), key = [planetId, String(A().S.me && A().S.me.player), count, species].join(":");
    if (!padCache.has(key)) padCache.set(key, padLayout(A().S.me ? A().S.me.player : 0, meta ? meta.padSeed : 0, count, meta ? meta.type : 1, species === "vossk" ? 510 : 512));
    return padCache.get(key);
  }
  const P3TYPE = { 1: "ocean", 2: "jungle", 3: "ice", 4: "mountain", 5: "volcano", 6: "desert", 7: "citadel_a", 8: "citadel_b", 9: "citadel_c" };
  /* Structure labels (frame Nice_HQ.PNG): structure-label_0 (white triangle; _1 when hovered), the type icon (structure-label_icon_*, 84 x 72) and the
     level in black below it; the tip points at the building. One per built structure, kept by slot; a click opens that structure's panel. */
  const LABEL_ICON = { 1: "hq", 2: "shipyard", 3: "metal", 4: "gas", 5: "crystal", 6: "barracks", 7: "research", 8: "scanner", 9: "planetary-shield", 10: "trade", 11: "artifacts" };
  const labels = new Map(); let labelLayer = null;   // labels live in a layer right above the planet canvas, under the 2D interface (the top bar covers them, as in the game)
  function label(slot, st, x, y, show) {
    let L = labels.get(slot);
    if (!st) { if (L) L.box.style.display = "none"; return; }
    if (!L) {
      const box = el("div", { position: "absolute", width: "185px", height: "194px", pointerEvents: "auto", cursor: "pointer" }, labelLayer);
      const lab = el("img", { position: "absolute", left: 0, top: 0, width: "185px", height: "194px", pointerEvents: "none" }, box); lab.src = art("structure-label_0");
      const icon = el("img", { position: "absolute", left: "50px", top: "28px", width: "84px", height: "72px", pointerEvents: "none" }, box);
      const lvl = el("div", { position: "absolute", left: 0, width: "185px", top: "84px", textAlign: "center", font: "44px Klavika, system-ui, sans-serif", color: "#111", pointerEvents: "none" }, box);
      box.onpointerenter = () => (lab.src = art("structure-label_1")); box.onpointerleave = () => (lab.src = art("structure-label_0"));
      L = { box, icon, lvl, type: 0, level: -1 }; labels.set(slot, L);
    }
    if (L.type !== st.type) { L.type = st.type; L.icon.src = art("structure-label_icon_" + (LABEL_ICON[st.type] || "hq")); L.box.title = A().STRUCT[st.type] || ""; L.box.onclick = () => openStructure(st.type); }
    if (L.level !== st.level) { L.level = st.level; L.lvl.textContent = String(st.level); }
    L.box.style.left = (x - 92.5) + "px"; L.box.style.top = (y - 180) + "px"; L.box.style.display = show && y - 180 > 200 ? "" : "none";   // not under the top bar (its icons end at about y 212)
  }
  let p3 = null;
  async function planet3d(globe) {
    if (!window.GoFA3D) return;
    // the canvas covers the stage and is opaque: the starfield is drawn inside it (R.setBackground), so the camera can move freely (zoom into a
    // structure) and the planet still hides the stars; the planet centre (1030, 840) comes from a lens shift, not from moving the canvas
    const starsCv = stage.querySelector("canvas");
    const cv = el("canvas", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px", pointerEvents: "none" });
    labelLayer = el("div", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px", pointerEvents: "none" });
    cv.width = W; cv.height = H; cv.id = "pPlanet3d";
    try {
      const src = window.GoFAArt && GoFAArt.source3d ? await GoFAArt.source3d() : null;   // the 3D scene from the imported IPA, else the relay's /art/3d/
      const R = await GoFA3D.create(cv, src ? { source: src } : {});
      { const b = document.createElement("canvas"); b.width = W; b.height = H; const c = b.getContext("2d");   // the stage's CSS background (a circle: farthest-corner of an ellipse at 85% 20% whose closest sides are equal) + the stars
        const g = c.createRadialGradient(0.85 * W, 0.2 * H, 0, 0.85 * W, 0.2 * H, Math.hypot(0.85 * W, 0.8 * H)); g.addColorStop(0, "#14405c"); g.addColorStop(0.38, "#08101c"); g.addColorStop(1, "#03060c");
        c.fillStyle = g; c.fillRect(0, 0, W, H); if (starsCv) c.drawImage(starsCv, 0, 0); R.setBackground(b); }
      const SHIFT = [(1030 - W / 2) / (W / 2), -(840 - H / 2) / (H / 2)];
      const d = 512 / Math.sin(Math.atan(560 / (H / 2) * Math.tan(0.35)));
      const M = GoFA3D.M;
      // drawn mirrored like the game (cam.mirror; left-handed engine): the start orientation and the light are the mirror images of the ones
      // calibrated on Final.PNG before the mirror, so the light stays on the same side of the screen
      // the sun is fixed in the planet scene (0x1002db90c keeps the /planet_sun node's position, set at setup; the camera orbits). Measured on the owner's
      // iPad (Real_PlanetStart.PNG, Home1 start view): the sun disc at (1556, 362) of 2048 x 1536 = world direction (-0.3455, 0.3140, -0.8843) with the
      // planet at its start orientation: behind the planet, up and to the right, so the start view shows the night side with a lit rim
      const L0 = M.xform(M.inv(M.rotY(-0.6)), [-0.3455038, 0.3139749, -0.8843342], 0);
      p3 = { R, cv, orient: M.rotY(-0.6), orient0: M.rotY(-0.6), L0, S0: L0.slice(), w: [0, 0, 0], drag: null, type: null, species: "terran", last: performance.now() };
      ["pHqLabel", "pHqIcon"].forEach((id) => { const e = document.getElementById(id); if (e) e.style.display = "none"; });   // replaced by the projected labels
      Object.assign(globe.style, { background: "transparent", boxShadow: "none", left: (1030 - 556) + "px", top: (840 - 556) + "px", width: "1112px", height: "1112px", cursor: "grab", touchAction: "none" });   // only the drag area now
      // turning: rotate(axis, angle) about a world axis, re-orthonormalised so hours of spinning do not drift
      const rotate = (ax, ang) => {
        const l = Math.hypot(...ax); if (!(l > 1e-9) || !ang) return; const [x, y, z] = ax.map((v) => v / l), c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
        const Rm = new Float32Array([t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1]);
        const o = M.mul(Rm, p3.orient), X = [o[0], o[1], o[2]], Y = [o[4], o[5], o[6]];
        const nx = Math.hypot(...X); X.forEach((v, i) => (X[i] = v / nx)); const dp = X[0] * Y[0] + X[1] * Y[1] + X[2] * Y[2]; Y.forEach((v, i) => (Y[i] = v - dp * X[i]));
        const ny = Math.hypot(...Y); Y.forEach((v, i) => (Y[i] = v / ny)); const Z = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
        o.set([...X, 0, ...Y, 0, ...Z, 0, 0, 0, 0, 1]); p3.orient = o;
      };
      // arcball: the surface point under the pointer stays under the pointer. Pointer -> stage px -> ray from the camera -> hit on the 512 sphere
      // (outside the disc: the nearest point of the silhouette), as a unit vector in world space.
      const tanH = Math.tan(0.35), onSphere = (e) => {
        const r = globe.getBoundingClientRect(), k = r.width / 1112, sx = (e.clientX - (r.left + r.width / 2)) / k, sy = (e.clientY - (r.top + r.height / 2)) / k;
        const dir = [-sx / (W / 2) * tanH * (W / H), -sy / (H / 2) * tanH, -1], dl = Math.hypot(...dir);   // -sx: the view is mirrored dir.forEach((v, i) => (dir[i] = v / dl));
        const b = d * dir[2], cc = d * d - 512 * 512, disc = b * b - cc, tt = disc > 0 ? -b - Math.sqrt(disc) : -b;
        const p = [dir[0] * tt, dir[1] * tt, d + dir[2] * tt], pl = Math.hypot(...p); return p.map((v) => v / pl);
      };
      const cross3 = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      p3.w = [0, 0, 0];   // angular velocity (world axis * rad/s) of a flick; at rest the planet stands still
      // zoom into a structure when its panel opens (frame Nice_HQ_Panel.PNG: the building low on the left, the panel on the right): the planet turns
      // the pad towards the camera and up, the camera flies down to look at the building from the side; back out when the panel closes
      p3.focus = { slot: -1, u: 0, target: 0 };
      p3.focusOn = (slot) => { p3.focus.slot = slot; p3.focus.target = 1; p3.w = [0, 0, 0]; p3.pend = [0, 0, 0]; p3.drag = null; };
      p3.focusOff = () => { p3.focus.target = 0; p3.focus.ang = null; };
      p3.pend = [0, 0, 0];   // turn the pointer asked for but not yet applied (axis * angle): the planet eases after the pointer (about 0.1 s) instead of locking rigidly (0.05 s: owner found 0.09 a bit heavy)
      const endDrag = () => {
        const g = p3.drag; p3.drag = null; globe.style.cursor = "grab"; if (!g) return;
        // flick: the cursor's own speed at release = the turn of its last 80 ms of movement over that time (only if it was still moving: the last
        // move less than 50 ms before the release), capped at 5 rad/s (8 with a 1.4 s glide was "overboard")
        const now = performance.now(), last = g.hist.length ? g.hist[g.hist.length - 1][0] : 0, recent = g.hist.filter((h) => last - h[0] < 80);
        if (recent.length >= 2 && now - last < 50) {
          const span = Math.max(0.016, (last - recent[0][0]) / 1000), sum = [0, 0, 0]; recent.slice(1).forEach((h) => h[1].forEach((v, i) => (sum[i] += v)));
          let w = sum.map((v) => v / span); const m = Math.hypot(...w); if (m > 5) w = w.map((v) => v * 5 / m); p3.w = w;
        }
      };
      globe.onpointerdown = (e) => { if (e.button !== 0 || p3.focus.target) return; try { globe.setPointerCapture(e.pointerId); } catch (_) {} p3.drag = { p: onSphere(e), hist: [] }; p3.w = [0, 0, 0]; globe.style.cursor = "grabbing"; };
      globe.onpointermove = (e) => {
        const g = p3.drag; if (!g) return;
        if (!(e.buttons & 1)) return endDrag();   // the button was released somewhere we did not hear about: stop, do not keep turning on hover
        const q = onSphere(e), ax = cross3(g.p, q), ang = Math.atan2(Math.hypot(...ax), g.p[0] * q[0] + g.p[1] * q[1] + g.p[2] * q[2]), l = Math.hypot(...ax);
        if (!(l > 1e-9)) return; const v = ax.map((c) => c / l * ang); g.p = q; p3.pend = p3.pend.map((c, i) => c + v[i]);
        const now = performance.now(); g.hist.push([now, v]); while (g.hist.length && now - g.hist[0][0] > 100) g.hist.shift();
      };
      globe.onpointerup = globe.onpointercancel = globe.onlostpointercapture = endDrag;
      window.addEventListener("pointerup", () => { if (p3.drag) endDrag(); });
      window.addEventListener("blur", () => { if (p3.drag) endDrag(); });
      const loop = (now) => {
        requestAnimationFrame(loop);
        const dt = Math.min(0.1, (now - p3.last) / 1000); p3.last = now;
        const shown = !document.getElementById("port").hidden, onPlanet = shown && view === "planet", onSystem = shown && view === "system" && sys && sys.layout;
        labelLayer.style.display = onPlanet ? "" : "none"; cv.style.display = onPlanet || onSystem ? "" : "none";
        if (onSystem) {   // the star system in 3D (gofa3d.js R.system + systemCamera, from the game's code), the nebula of its type, labels by projection
          if (sys.spin && !sys.drag && !sys.focused) {   // flick glide (time constant 0.4 s)
            sys.yaw += sys.spin.vy * dt; sys.pitch = Math.max(-1, Math.min(0.5, sys.pitch + sys.spin.vp * dt)); const q = Math.exp(-dt / 0.4); sys.spin.vy *= q; sys.spin.vp *= q;
            if (Math.abs(sys.spin.vy) + Math.abs(sys.spin.vp) < 0.01) sys.spin = null;
          }
          R.time += dt; R.system(sys.layout, sys.gate);
          if (sys.fly) { const k = 1 - SYS_FOCUS_SUNFADE * sys.fly.e; for (const it of R.items) if (/system_sun_(glow|flare)|system_fx_glow/.test(it.node)) { const m = it.mat.uniforms["Multiplier.Value"] || [1, 1, 1, 1]; it.over = Object.assign({}, it.over, { "Multiplier.Value": m.map((v) => v * k) }); it.depthTest = sys.fly.e > 0.5; } }   // and hidden where the planet covers it   // unlit.ush has no opacity variant: scale its colour multiplier   // focused: the sun is behind the planet in the game, its glare mostly hidden (ours draws over it)
          // the system's nebula; the system view sets the sky's own Fov by zoom (0x10032b2a8 / 0x10032f534 -> 0x100481fd8): lerp(90, 95, (dist - 242011) / 368011),
          // i.e. 95 degrees at the start distance (the material's 70 stays on the planet screen). Proven by the star dots of Real_SystemStart.png (2026-11-15)
          const skyFov = 90 + 5 * Math.max(0, Math.min(1, ((sys.dist || 610022) - 242011) / 368011)); skyFovLast = skyFov;
          // sky frame (measured 2026-11-15 on three real frames whose stars match exactly: Real_SystemStart, Random2_t14, Random2_t20): sky local = rotY(a) x world,
          // a = pi - SKY_YAW_K (yaw + pi), i.e. a half turn at the start view and the sky turning at ~0.765 of the camera's yaw rate (pitch is followed fully).
          // Predicts t14 / t20 to 0.3 / 0.8 degrees (their cameras fitted on the planets); no code found yet that turns the skybox (empirical law)
          R.skybox(Object.assign(skyParams(sys.seed || sys.type), { Fov: skyFov }), M.rotY(-(Math.PI - SKY_YAW_K * (sys.yaw + Math.PI))), true);
          let cam;
          if (sys.fly && sys.layout[sys.fly.i]) {   // fly to / from a planet: target from the sun to the planet, distance from the view's to ~16 planet radii (the planet ~half the screen height, Random 120.8 s)
            // framing (Random_SystemPlanetPanel): the planet ~372 px in radius, its centre at (530, 840) beside the panel: the target moves off the planet
            // along the camera's right / up axes by the matching world distance (px -> world at distance d: d tan(fov / 2) / 384 per stage px vertically)
            const Lf = sys.layout[sys.fly.i], e = sys.fly.e, F0 = sys.flyFrom || { yaw: sys.yaw, pitch: sys.pitch }, fy = SYS_FOCUS_YAW(Lf.angle), dy = Math.atan2(Math.sin(fy - F0.yaw), Math.cos(fy - F0.yaw));
            sys.yaw = F0.yaw + dy * e; sys.pitch = F0.pitch + (SYS_FOCUS_PITCH - F0.pitch) * e;   // the game's focus angle: sun to the right of the planet (Random_SystemPlanetPanel)
            const P = [Lf.radius * Math.cos(Lf.angle), 0, Lf.radius * Math.sin(Lf.angle)], d0 = sys.dist || 610022, d1 = SYS_FOCUS_DIST * 3720 * (Lf.scale || 1), d = d0 * Math.pow(d1 / d0, e);
            const cp = Math.cos(-sys.pitch), bx = cp * Math.sin(sys.yaw), by = Math.sin(-sys.pitch), bz = cp * Math.cos(sys.yaw), rl = Math.hypot(bx, bz) || 1;   // b = target -> eye
            const right = [bz / rl, 0, -bx / rl], up = [-bx * by / rl, (bx * bx + bz * bz) / rl, -by * bz / rl];   // right = up0 x b, up = b x right
            const px = d * Math.tan(10 * Math.PI / 180) / (W / H) / (H / 2), ox = (1024 - 530) * px * e * SYS_FOCUS_SX, oy = (840 - 768) * px * e;   // move the target right / up so the planet sits left / low
            const c = [P[0] * e + right[0] * ox + up[0] * oy, up[1] * oy, P[2] * e + right[2] * ox + up[2] * oy];
            cam = GoFA3D.systemCamera(sys.yaw, sys.pitch, W / H, d, c);
          } else cam = GoFA3D.systemCamera(sys.yaw, sys.pitch, W / H, sys.dist || 610022);
          // Overview camera measured on the REAL client (Real_SystemStart.png, iPad snap at the start view, 2026-11-15): the 20 degree FOV is VERTICAL (planet spacing at the start
          // distance 610022 matches to 1 %; the old horizontal reading fitted t14 at 323700 = 242775 here, the pinch minimum 242011) and the 3D view is lens-shifted so the sun sits
          // 0.545 down the frame (t14 0.552, ~ -0.095 NDC). The planet focus (tuned on Random_SystemPlanetPanel with the old FOV) is blended back in by the fly progress.
          const ke = sys.fly ? sys.fly.e : 0, tn = Math.tan(10 * Math.PI / 180); cam.fov = 2 * Math.atan(tn + (tn / (W / H) - tn) * ke);
          R.frame({ ...cam, shift: [0, SYS_VIEW_SHIFT * (1 - ke)], up: [0, 1, 0], clearColor: [0, 0, 0, 1], mirror: true }, 0);
          for (const mk of sys.marks) {
            const L = sys.layout[mk.i]; if (!L) continue; const c = [L.radius * Math.cos(L.angle), 0, L.radius * Math.sin(L.angle)], q = R.project(c), q2 = R.project([c[0], c[1] + 3720 * L.scale, c[2]]);
            if (!q || !q2) continue; const r = Math.max(30, Math.abs(q[1] - q2[1]));
            Object.assign(mk.ball.style, { left: q[0] - r + "px", top: q[1] - r + "px", width: 2 * r + "px", height: 2 * r + "px" });
            if (mk.badge) { mk.badge.style.left = q[0] - 42 + "px"; mk.badge.style.top = q[1] - r - 42 + 0.2 * r + "px"; }
            mk.nmEl.style.left = q[0] + r + 20 + "px"; mk.nmEl.style.top = q[1] - r * 0.2 - 30 + "px"; if (mk.owEl) { mk.owEl.style.left = q[0] + r + 20 + "px"; mk.owEl.style.top = q[1] - r * 0.2 + 6 + "px"; }
          }
          if (p3.onFrame) { const f = p3.onFrame; p3.onFrame = null; f(cv); }
          return;
        }
        if (shown && view === "carrier" && cv3 && cv3.c) {   // the carrier detail: R.ship on the planet canvas, framed on its hull (Lb_t75 placement by eye)
          cv.style.display = ""; R.time += dt;
          const sp = cv3.void ? "void" : (SPECIES[A().S.race] || "terran"); const pp = cv3.pop || { x: 0, v: 0 }, sz = 0.4 * (1.1 + pp.x * (2 - 1.1));   // pop-in: the 1.1 factor is lerped towards 2.0 by the spring value (0x100374cc0)
          // carrier carousel (0x100375aa0 on the list +0x230 of the scene): the carriers sit 10000 units apart (0x100ae7a80) along the camera's right axis
          // (the camera node's first row, 0x100374cc0: translation += row x offset), the position springs to the new index (critically damped,
          // k = 0.00667 per ms, 0x100ae74b8, the pop spring's formula) and only the NEAREST carrier is drawn: the old one slides out, the new one in
          let look = { sp, mk: cv3.mkNum, colour: cv3.colour }, off = 0; const sl = cv3.slide;
          if (sl) {
            const k = 0.006667, h = Math.min(dt, 0.1) * 1000, kh = k * h, f = 1 / (1 + kh + 0.48 * kh * kh + 0.235 * kh * kh * kh), x = sl.p - sl.dir * 10000, tt = (sl.v + k * x) * h;
            sl.v = f * (sl.v - k * tt); sl.p = sl.dir * 10000 + f * (x + tt);
            if (Math.abs(sl.p - sl.dir * 10000) < 2 && Math.abs(sl.v) < 0.01) cv3.slide = null;
            else if (Math.abs(sl.p) < 5000) { look = sl.from; off = -sl.p; } else off = sl.dir * 10000 - sl.p;
          }
          const rx = Math.cos(cv3.yaw), rz = -Math.sin(cv3.yaw);   // the camera's right axis in the world (unmirrored); the sign below puts "next" coming in from the right on screen
          R.ship(look.sp, look.mk, look.colour, cv3.oldCam ? M.ident() : M.mul(M.trans(-rx * off, -50, -rz * off), M.scale(sz)));   // the scene update (0x100374cc0) sets the ship root (/ships_*_command_ship, node +0x88; Void +0x108) every frame: the carousel branch scales it 0.4 and moves it to y = +0x274 (springs to -50, 0x100ae80ac), then x 1.1 (3x3 only)
          if (!cv3.fit) { const all = R.items; R.items = all.filter((it) => /mesh/.test(it.node)); cv3.fit = R.bounds(); R.items = all; }
          const rdy = R.ready(); cv3.ld.style.display = rdy ? "none" : ""; if (!rdy) R.items = [];
          if (rdy && cv3.pop && cv3.pop.x) {   // the game's critically damped spring (k = 0.01 per ms, 0x100ae74c0; dt in ms), stepped only once the ship is visible
            const k = 0.01, h = Math.min(dt, 0.1) * 1000, kh = k * h, f = 1 / (1 + kh + 0.48 * kh * kh + 0.235 * kh * kh * kh), P = cv3.pop, tt = (P.v + k * P.x) * h;
            P.v = f * (P.v - k * tt); P.x = f * (P.x + tt); if (Math.abs(P.x) < 1e-4 && Math.abs(P.v) < 1e-6) P.x = P.v = 0;
          }   // R.ready() starts the texture loads; until then only the nebula (no grey placeholder hull)
          const m2 = planetMeta(A().S.selected); R.skybox(skyParams(m2 && (m2.systemSeed || m2.systemType)), M.rotY(2 * (cv3.yaw - 0.625)), true);   // the sky is drawn unmirrored (V0) while the ship is mirrored, so with a still sky the two turned opposite ways (owner 2026-11-16); turning the sky by 2 x yaw gives exactly the mirrored view's motion (S Ry(-y) = Ry(y) S), the start frame unchanged
          // the game's hangar camera (0x100375694): the camera node = rotation x translate(0, 0, 2000), i.e. 2000 units from the ship's origin looking
          // at it, fov 45 degrees, clip 150 / 6000, no lens shift. cv3.oldCam: the earlier by-eye framing (hull-bounds distance + shift), for comparison
          const og = !cv3.oldCam, b = og ? { center: [0, 0, 0], radius: 0 } : cv3.fit, fovV = cv3.fovV || 0.7, pt = cv3.pitch ?? 0.45, dd = og ? 2000 : b.radius / Math.sin(0.35) * 0.95 * Math.tan(0.35) / Math.tan(fovV / 2), pc = Math.cos(pt), eye = [b.center[0] + dd * pc * Math.sin(cv3.yaw), b.center[1] + dd * Math.sin(pt), b.center[2] + dd * pc * Math.cos(cv3.yaw)];   // distance scaled with the fov: same on-screen size
          // the carrier scene's own light (0x100373bd0): directional, ambient 0.6, diffuse 0.8, shininess 25, direction (-1, 0.15, 0) (its z column,
          // used as is = towards the light: the near side dark under lit decks as in Lb_t75; the other sign lit the near side). Was: the planet's light.
          { const n = Math.hypot(1, 0.15); Object.assign(R.L, { pos: null, dir: [-1 / n, 0.15 / n, 0], ambient: [0.6, 0.6, 0.6], diffuse: [0.8, 0.8, 0.8], shininess: 25 }); }
          R.frame({ eye, target: b.center, up: [0, 1, 0], fov: fovV, near: og ? 150 : dd / 100, far: og ? 6000 : dd * 50, shift: og ? null : [0, 0.08], clearColor: [0, 0, 0, 1], mirror: true }, 0);
          if (p3.onFrame) { const f = p3.onFrame; p3.onFrame = null; f(cv); }
          return;
        }
        if (!onPlanet) return;
        const F0 = p3.focus; F0.u = Math.max(0, Math.min(1, F0.u + (F0.target ? 1 : -1) * dt / 0.9)); const e = F0.u * F0.u * (3 - 2 * F0.u);   // eased 0 -> 1 in 0.9 s
        const m = planetMeta(A().S.selected); p3.type = P3TYPE[(m && m.type) || 1] || "ocean"; p3.species = SPECIES[A().S.race] || "terran";
        { const k = 1 - Math.exp(-dt / 0.05), st = p3.pend.map((v) => v * k); p3.pend = p3.pend.map((v, i) => v - st[i]); rotate(st, Math.hypot(...st)); }   // ease after the pointer
        if (F0.target && F0.slot >= 0) {   // focused: turn the pad's normal towards nT (facing the camera, tilted up) instead of spinning
          const Wf = M.mul(p3.orient, (p3.pads || [])[F0.slot] || M.ident()), n = [Wf[4], Wf[5], Wf[6]], nT = [0, 0.55, 0.835], ax = cross3(n, nT), ang = Math.atan2(Math.hypot(...ax), n[0] * nT[0] + n[1] * nT[1] + n[2] * nT[2]);
          rotate(ax, ang * (1 - Math.exp(-dt / 0.22))); p3.w = [0, 0, 0];
        } else if (!p3.drag && !F0.u) {   // a flick glides out (time constant 0.4 s) to a stop: the planet does not turn on its own (owner: it did not in the original game)
          const f = Math.exp(-dt * 2.5); p3.w = p3.w.map((v) => v * f); if (Math.hypot(...p3.w) < 1e-3) p3.w = [0, 0, 0]; else rotate(p3.w, Math.hypot(...p3.w) * dt);
        }
        R.setPlanet(p3.type, p3.orient); R.cloudAxis = cloudAxis(m && m.padSeed);
        { const l = M.xform(p3.orient, p3.L0, 0), n = Math.hypot(...l); R.L.dir = l.map((c) => c / n); }   // the game orbits the camera round a still planet with a fixed sun: the light turns with the planet (dragging shows the night side)
        const skyP = skyParams(m && (m.systemSeed || m.systemType));
        R.skybox(Object.assign({}, skyP, { Fov: skyFovLast }), planetSkyWorld(p3.orient, p3.orient0));   // the system's nebula: the measured start frame, turning at 0.765 of the planet's turn (see SKY_PLANET_R0)
        if (/^citadel_/.test(p3.type)) R.addRoot("/planet_artifact_type_" + p3.type.slice(-1) + "_scene", M.mul(p3.orient, ART_FRAME));   // the citadel's artifact at its surface point
        const pl = A().S.planets.get(A().S.selected), built = (pl ? pl.structures : []).filter((x) => x.level > 0), bySlot = new Map(built.map((x) => [x.slot, x]));
        const PADS = padFrames(A().S.selected, m, p3.species, built.reduce((a, x) => Math.max(a, x.slot + 1), 0));
        const want = [], focusW = { Wp: null, root: null };
        p3.pads = PADS;
        PADS.forEach((F, i) => {
          const Wp = M.mul(p3.orient, F), st = bySlot.get(i); R.addRoot("/building_" + p3.species + "_socket", Wp, null, i * 1370);
          if (st && PAD_BLD[st.type]) { R.addRoot("/building_" + p3.species + "_" + PAD_BLD[st.type], Wp, null, i * 1370); R.ring(p3.species, Wp, 45); }   // animation offset per pad
          if (st && PAD_BLD[st.type]) {   // its label: above the building's roof, projected after the frame with the real camera; hidden when the pad faces away or while zoomed
            const root = "/building_" + p3.species + "_" + PAD_BLD[st.type], top = R.rootTop(root); want.push([i, st, M.xform(Wp, [0, top + 12, 0], 1), Wp[6] > 0.15 && e < 0.02]);
            if (i === F0.slot) { focusW.Wp = Wp; focusW.top = top; }
          } else { label(i, null); if (i === F0.slot) { focusW.Wp = Wp; focusW.top = 60; } }
        });
        // camera: the overview (eye on +Z, lens shift to the measured planet centre) blended with the close-up of the focused building
        let cam = { eye: [0, 0, d], target: [0, 0, 0], up: [0, 1, 0], shift: SHIFT, near: d - 800 };
        if (e > 0 && focusW.Wp) {
          // the game's zoom camera (0x1002de86c): on a circle of radius 210 round the pad's up axis, 100 above the pad, looking at the point 40 up the
          // building, circling at 0.08 rad/s while the panel is open; the circle starts on the viewer's side
          const Wf = focusW.Wp, n = [Wf[4], Wf[5], Wf[6]], P = [Wf[12], Wf[13], Wf[14]], X = [Wf[0], Wf[1], Wf[2]], Z = [Wf[8], Wf[9], Wf[10]], top = Math.max(40, focusW.top);
          if (F0.ang == null) F0.ang = Math.atan2(Z[2], X[2]); F0.ang += dt * 0.08;
          const ca = Math.cos(F0.ang), sa = Math.sin(F0.ang), T = P.map((c, j) => c + n[j] * 40), E = P.map((c, j) => c + n[j] * 100 + (X[j] * ca + Z[j] * sa) * 210), lerp = (a, b) => a.map((c, j) => c + (b[j] - c) * e);
          const up = lerp([0, 1, 0], n), lu = Math.hypot(...up);
          cam = { eye: lerp(cam.eye, E), target: lerp([0, 0, 0], T), up: up.map((c) => c / lu), shift: lerp(SHIFT, [-0.55, 0.05]), near: (d - 800) + (top * 0.2 - (d - 800)) * e };
        }
        { // the sun (/planet_sun: two additive glow quads + the lens-flare streak): the planet scene puts it at 4000 x the light direction (0x1002d7034);
          // its quads lie in the XY plane, so they are turned to face the camera; the streak (no depth test) fades out while the planet hides the sun
          const sd = M.xform(p3.orient, p3.S0, 0), sl = Math.hypot(...sd), sp = sd.map((c) => c / sl * 4000), bz = sp.map((c, j) => cam.eye[j] - c), lz = Math.hypot(...bz), Z = bz.map((c) => c / lz), u0 = cam.up;
          let X = [u0[1] * Z[2] - u0[2] * Z[1], u0[2] * Z[0] - u0[0] * Z[2], u0[0] * Z[1] - u0[1] * Z[0]]; const lx = Math.hypot(...X) || 1; X = X.map((c) => c / lx);
          const Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
          const n0 = R.items.length; R.addRoot("/planet_sun", new Float32Array([...X, 0, ...Y, 0, ...Z, 0, ...sp, 1]));
          const dir = Z.map((c) => -c), tc = -(cam.eye[0] * dir[0] + cam.eye[1] * dir[1] + cam.eye[2] * dir[2]), cl = cam.eye.map((c, j) => c + dir[j] * Math.max(0, Math.min(lz, tc)));
          const hidden = Math.hypot(...cl) < 512 && tc > 0;   // the line from the eye to the sun passes through the planet
          // sun occlusion, as the game does it every frame (0x1002db90c): 10 points on a circle of radius 250 round the sun in its camera-facing plane,
          // n = how many the camera sees past the planet (sphere r 512 at the origin); v = n / 10 eased (smooth-damp), tri = 2v folded at 1, h = hidden part
          let n = 0; const e0 = cam.eye, cc = e0[0] * e0[0] + e0[1] * e0[1] + e0[2] * e0[2] - 512 * 512;
          for (let k = 0; k < 10; k++) { const a = k * 0.6283185482, P = sp.map((c, j) => c + (X[j] * Math.cos(a) + Y[j] * Math.sin(a)) * 250), D = P.map((c, j) => c - e0[j]), l = Math.hypot(...D);
            const b = (D[0] * e0[0] + D[1] * e0[1] + D[2] * e0[2]) / l; if (cc > 0 && (b > 0 || b * b - cc < 0)) n++; }
          const pl3 = p3.sunL || (p3.sunL = { v: n / 10, tri: 0, h: 1 - n / 10 }), kk = 1 - Math.exp(-dt / 0.12), v = n / 10, tri = 2 * v <= 1 ? 2 * v : 2 - 2 * v;
          pl3.v += (v - pl3.v) * kk; pl3.tri += (tri - pl3.tri) * kk; pl3.h += ((10 - n) * 0.1 - pl3.h) * kk;
          const vf = cam.target.map((c, j) => c - e0[j]), lv = Math.hypot(...vf), ts = sp.map((c, j) => c - e0[j]), lt = Math.hypot(...ts);
          const cosT = (vf[0] * ts[0] + vf[1] * ts[1] + vf[2] * ts[2]) / (lv * lt), fb = (pl3.tri * 0.2 + 0.8) * Math.max(0, Math.min(1, cosT * 1.25)), gs = pl3.tri * 1.4 + 0.5;
          for (let i = n0; i < R.items.length; i++) {
            const it = R.items[i];
            if (/lens_flare/.test(it.matName)) {   // planet_sun_glare (0x1002db90c, node +0x218): node scale (fb - 0.5) x 0.5 (~0.15 in the start view, NOT 1),
              // material Opacity = horizontal screen-edge fade (10 % ramps) x eased visible part; hidden while that part <= 0.001
              const q = R.project(sp), f = q ? q[0] / cv.width : -1, ef = f < 0.1 ? Math.max(0, Math.min(f, 1)) * 10 : f > 0.9 ? Math.max(0, (1 - f) * 10) : 1, s = (fb - 0.5) * 0.5;
              const w = it.world.slice(); for (const j of [0, 1, 2, 4, 5, 6, 8, 9, 10]) w[j] *= s; it.world = w; it.over = { Opacity: ef * pl3.v }; if (!(pl3.v > 0.001) || !q) it.drop = true;
            }
            else if (/glow_back/.test(it.matName)) { const w = it.world.slice(); for (const j of [0, 1, 2, 4, 5, 6, 8, 9, 10]) w[j] *= gs; it.world = w; it.over = { "Multiplier.Value": [fb, fb, fb, 1] }; }   // node scale 1.4 tri + 0.5 (half size while fully visible)
            else if (/glow_front/.test(it.matName)) { if (!n || tc <= 0) it.drop = true; it.over = { "Multiplier.Value": [n ? pl3.v : 0, n ? pl3.v : 0, n ? pl3.v : 0, pl3.v * 0.4 + 0.6] }; }   // shown only while part of the sun is visible
          }
          { // the lens flare ghosts (/planets_lens_flare: _right +0x210, _left +0x208) and the lens dirt (/lensdirt +0x228), same routine: both live in screen
            // space, built from the camera. Game camera: fov 45 deg, near 50, aspect 4:3; the dirt (a 600-unit quad, lensdirt.ush) sits 0.5 past the near plane
            // scaled 2 halfWidth / 580, AspectRatio.Value 0.4 (the shader uses it as intensity), Opacity.Value (fadeX + fadeY + 2 v) / 4; the ghosts sit at
            // the near plane on the right / left screen edge, moved along the camera's up axis by +/- (1 - 2 x) halfHeight with x the sun's PORTRAIT-buffer
            // x fraction; in landscape that is (2 sunY - 1) with sunY from the top (the other sign scored 9.2 vs 5.3 mean background error on
            // Real_PlanetStart: right ghost low, left ghost high), scaled (fb - 0.5) x 0.5 like the glare. The
            // engine's screen x / y are the portrait buffer's, i.e. landscape y / x. Here: the same screen fractions at a distance past our own near plane,
            // in the engine's left-handed camera basis (screen right = -X of our right-handed view, which cam.mirror flips back)
            const q = R.project(sp), fx = q ? q[0] / cv.width : -1, fy = q ? q[1] / cv.height : -1;
            const ef = (f) => (f < 0.1 ? Math.max(0, Math.min(f, 1)) * 10 : f > 0.9 ? Math.max(0, (1 - f) * 10) : 1);
            const D = cam.near * 1.02, hH = D * Math.tan(0.35), hW = hH * cv.width / cv.height, k = hH / (50 * Math.tan(Math.PI / 8));
            const fw = cam.target.map((c, j) => c - cam.eye[j]), lf = Math.hypot(...fw), Zb = fw.map((c) => -c / lf);
            let Xg = [cam.up[1] * Zb[2] - cam.up[2] * Zb[1], cam.up[2] * Zb[0] - cam.up[0] * Zb[2], cam.up[0] * Zb[1] - cam.up[1] * Zb[0]]; const lx2 = Math.hypot(...Xg); Xg = Xg.map((c) => c / lx2);
            const Yb = [Zb[1] * Xg[2] - Zb[2] * Xg[1], Zb[2] * Xg[0] - Zb[0] * Xg[2], Zb[0] * Xg[1] - Zb[1] * Xg[0]], Xb = Xg.map((c) => -c);
            const sh = cam.shift || [0, 0], at = (dx, dy, dz) => cam.eye.map((c, j) => c + Xb[j] * dx + Yb[j] * dy - Zb[j] * dz);   // shift: the projection's lens shift, taken back out
            const mat = (sx, pos) => new Float32Array([...Xb.map((c) => c * sx), 0, ...Yb.map((c) => c * sx), 0, ...Zb, 0, ...pos, 1]);
            if (pl3.v > 0.001 && q) {
              const sd = 2 * hW / 580, n1 = R.items.length; R.addRoot("/lensdirt", mat(sd, at(-sh[0] * hW, -sh[1] * hH, D * 1.01)));
              for (let i = n1; i < R.items.length; i++) {   // the mirrored basis + cam.mirror give the engine's image but invert our cull test: drawn unculled (it faces the camera)
                const it = R.items[i]; it.mat = p3.dirtMat || (p3.dirtMat = { ...it.mat, states: { ...it.mat.states, doublesided: 1 } });
                it.over = { "AspectRatio.Value": 0.4, "Opacity.Value": (ef(fx) + ef(fy) + 2 * pl3.v) * 0.25 };
                it.frame = M.inv(p3.orient);   // lensdirt.ush mirrors the sun (-x, -y, z) in WORLD axes: the game's world is the still planet's frame (its camera orbits), ours turns the planet
              }
              const off = (2 * fy - 1) * hH, s = (fb - 0.5) * 0.5 * k, n2 = R.items.length;
              R.addRoot("/planets_lens_flare/planet_lens_flare_right", mat(s, at(hW - sh[0] * hW, off - sh[1] * hH, D)));
              R.addRoot("/planets_lens_flare/planet_lens_flare_left", mat(s, at(-hW - sh[0] * hW, -off - sh[1] * hH, D)));
              for (let i = n2; i < R.items.length; i++) R.items[i].over = { Opacity: ef(fx) * pl3.v };
            }
          }
          if (R.items.some((it) => it.drop)) R.items = R.items.filter((it) => !it.drop);
          // the planet light's ambient (same routine): (c3 + (0.7 - c3) x 0.1) x (h + 0.5), c3 = the system nebula's third colour; diffuse 0.8 / specular 1 stay
          const c3 = skyP._c3 || [0.3, 0.3, 0.3]; R.L.ambient = c3.map((c) => (c + (0.7 - c) * 0.1) * (pl3.h + 0.5));
        }
        R.frame({ eye: cam.eye, target: cam.target, up: cam.up, shift: cam.shift, fov: 0.7, near: cam.near, far: d + 6000, clearColor: [0, 0, 0, 1], mirror: true }, dt);
        for (const [i, st, a, show] of want) { const q = R.project(a); if (q) label(i, st, q[0], q[1], show); else label(i, st, 0, 0, false); }
        if (p3.onFrame) { const f = p3.onFrame; p3.onFrame = null; f(cv); }   // test hook: read the canvas right after drawing
      };
      requestAnimationFrame(loop);
    } catch (e) { cv.remove(); console.warn("3D planet not available:", e.message || e); }
  }

  function build() {
    const font = new FontFace("Klavika", window.GoFAArt && window.GoFAArt.font ? window.GoFAArt.font : "url(/art/font/klavika.ttf)"); font.load().then((f) => document.fonts.add(f)).catch(() => {});
    const root = document.getElementById("port");
    scaleBox = el("div", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px", transformOrigin: "0 0" }, root);
    stage = scaleBox;
    // background: starfield + planet stand-in (the 3D scene is not rendered yet)
    stage.style.background = "radial-gradient(ellipse at 85% 20%, #14405c 0%, #08101c 38%, #03060c 100%)";
    const stars = el("canvas", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px" }); stars.width = W; stars.height = H;
    const c = stars.getContext("2d"); let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 420; i++) { c.fillStyle = "rgba(255,255,255," + (0.15 + rnd() * 0.7) + ")"; const r = rnd() < 0.05 ? 3 : 1.5; c.beginPath(); c.arc(rnd() * W, rnd() * H, r, 0, 6.283); c.fill(); }
    const globe = el("div", { position: "absolute", left: (1030 - 560) + "px", top: (840 - 560) + "px", width: "1120px", height: "1120px", borderRadius: "50%",
      background: "radial-gradient(circle at 62% 38%, #cfd8de 0%, #7f8e98 22%, #3b4650 52%, #12181f 82%)", boxShadow: "0 0 70px 26px rgba(120,190,255,.55), inset -60px -40px 140px rgba(0,0,0,.65)" });
    planet3d(globe);   // the original 3D planet replaces this CSS stand-in when WebGL and the exported 3D data are there
    galaxyLayerBuild(); sysLayerBuild();
    // top bar: seven round menu buttons (topBar: these elements, hidden by full-screen views like the carrier detail)
    const nTop0 = stage.children.length;
    const bar = [["planetlist", "Planets"], ["fleets", "Fleets"], ["messages", "Messages"], ["squad", "Squad"], ["bookmarks", "Missions"], ["leaderboards", "Leaderboards"], ["options", "Options"]];
    bar.forEach(([n, t], i) => pressButton("button_menu_" + n, 90 + i * 188, 80, 148, 132, () => (n === "messages" ? openMessages() : n === "planetlist" ? openPlanetList() : n === "fleets" ? openFleets() : n === "options" ? openSettings() : n === "leaderboards" ? openLeaderboards() : n === "squad" ? openSquad() : dialog(t, "This screen has not been rebuilt in the original look yet.\nUse the plain interface for it (Esc closes the original look).")), t));
    // lines of the top bar
    const svg = el("div", { position: "absolute", left: 0, top: 0, width: W + "px", height: "300px", pointerEvents: "none" });
    svg.innerHTML = '<svg width="2048" height="300" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#d7ecf8" stroke-width="2"><path d="M30 148 H1250 L1336 60"/><path d="M1296 148 H1736 L1810 210"/></svg>';
    image("credits_icon", 1372, 36);
    text("0", 1566, 56, 34, "#e0b24a", { id: "pCredits" }).id = "pCredits";
    // commander portrait (top right)
    { const pp = image("commander_menu_terran_1", 1818, 34, { click: () => openCommander() }); pp.id = "pPortrait"; pp.title = "Commander"; }   // switched to the player's species in update()
    { const p2 = image("commander_menu_terran_1", 1818, 262, { click: () => openTutorial() }); p2.id = "pPortrait2"; p2.title = "Tutorial missions"; }   // the second portrait under the commander's (frames: the advisor, opens TUTORIAL MISSIONS)
    { const ch = pressButton("button_menu_commander", 1837 + 86, 12 + 66, 172, 132, () => openCommander(), "Commander"); ch.id = "pRank"; ch.style.opacity = "0"; ch.style.pointerEvents = "none"; }   // shown instead of the portrait while a side panel is open (rankMode)
    xpBar(stage, XP_BAR_X, XP_BAR_Y);   // under the portrait, 98 px higher under the chevron
    [[2000, 72, "pBadge1", "Skill points to spend"], [2000, 326, "pBadge2", "A mission reward is ready"]].forEach(([bx, by, id, tip]) => { const b = el("div", { position: "absolute", left: bx - 21 + "px", top: by - 21 + "px", width: "42px", height: "42px", borderRadius: "21px", background: "#7fe619", boxShadow: "0 0 0 4px rgba(10,40,20,.55)", color: "#1c4a00", font: "bold 34px Klavika, system-ui, sans-serif", textAlign: "center", lineHeight: "42px", pointerEvents: "none", display: "none" }); b.id = id; b.title = tip; b.textContent = "!"; });   // the green ! on the commander (skill points) and the advisor (a tutorial reward is ready), as in Random2_t14
    image("swiper_0", 0, 700); const ci = image("chat_icon_0", 18, 780, { click: () => openChat() }); ci.title = "Chat"; ci.onpointerenter = () => (ci.src = art("chat_icon_1")); ci.onpointerleave = () => (ci.src = art("chat_icon_0"));
    topBar = [...stage.children].slice(nTop0);
    // planet name + resource rows (a layer of their own: the galaxy map hides it)
    planetLayer = el("div", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px", pointerEvents: "none" }); const keep = stage; stage = planetLayer;
    text("", 54, 190, 36, "#ffffff").id = "pName";
    [["res_icon_metal", 300], ["res_icon_gas", 356], ["res_icon_crystal", 412]].forEach(([n, y], i) => {
      image(n, 66, y - 14);
      text("", 148, y - 2, 24, "#6cb6ec").id = "pRate" + i;
      text("", 244, y - 10, 36, "#ffffff").id = "pAmt" + i;
    });
    // side tabs, HQ label, clock
    image("swiper_1", W - 119, 700); const wi = image("structurelist_icon_0", 1951, 763, { click: () => openStructureList() }); wi.title = "Structures"; wi.onpointerenter = () => (wi.src = art("structurelist_icon_1")); wi.onpointerleave = () => (wi.src = art("structurelist_icon_0"));
    image("structure-label_0", 602 - 92, 1080 - 97, { click: () => openStructure(1) }).id = "pHqLabel"; image("structure-label_icon_hq", 602 - 42, 1080 - 50).id = "pHqIcon";
    { const bl = image("button_systemview_big_0", 108 - 78, 1425 - 78, { click: () => pressThen(bl, "button_systemview_big", () => { if (sys) { sys.focusId = null; sys.pullBack = A().S.selected; } showView("system"); }) }); bl.title = "System view"; bl.onpointerenter = () => (bl.src = art("button_systemview_big_1")); bl.onpointerleave = () => (bl.src = art("button_systemview_big_0")); }
    stage = keep;
    clockIcon = image("server_clock_icon", 262, 1466); text("", 330, 1472, 34, "#ffffff").id = "pClock";
    // reference overlay for alignment work
    const ref = el("img", { position: "absolute", left: 0, top: 0, width: W + "px", height: H + "px", opacity: 0.45, pointerEvents: "none", display: "none", zIndex: 50 }); ref.src = "/art/ref/Final.PNG"; ref.id = "pRef";
    ready = true;
  }

  function fit() {
    const root = document.getElementById("port"); if (!scaleBox) return;
    const k = Math.min(root.clientWidth / W, root.clientHeight / H);
    scaleBox.style.transform = "scale(" + k + ")";
    scaleBox.style.left = Math.max(0, (root.clientWidth - W * k) / 2) + "px"; scaleBox.style.top = Math.max(0, (root.clientHeight - H * k) / 2) + "px";
  }

  function update() {
    if (!ready) return;
    const a = A(), S = a.S, p = S.planets.get(S.selected);
    const set = (id, t) => { const e = document.getElementById(id); if (e && e.textContent !== t) e.textContent = t; };
    if (S.credits == null) set("pCredits", ""); else creditsTo(S.credits);   // counts up after a reward (Random.MP4 64.07 s)
    { const show = (id, on) => { const b = document.getElementById(id); if (b) b.style.display = on ? "block" : "none"; }; show("pBadge1", (S.skillPoints || 0) > 0); show("pBadge2", (S.tut || []).some((x) => x.done && !x.claimed)); }
    { const L = S.lv; xpSet(L ? (L.xp - L.xp_level) / Math.max(1, L.xp_next - L.xp_level) : 0); }   // hard cut on a level-up (Random.MP4 64.07 s); the fill follows the server's xp / xp_level / xp_next
    { const lvNow = S.lv && S.lv.level; if (lvNow && lastLevel && lvNow > lastLevel) levelBanner(lvNow); if (lvNow) lastLevel = lvNow; }
    // The commander's picture follows the real rank (client 0x1005798e8: 6-frame list of the own species + sex, frame = rank from the own level); the second portrait is the adjutant: the opposite sex, always the rank-1 picture (client 0x1002ac6d4 passes rank index 0 and isMale ^ 1). docs/FORUM_NOTES.md 'Commander rank'.
    for (const [pid, opp] of [["pPortrait", false], ["pPortrait2", true]]) { const pi = document.getElementById(pid), want = art(menuPortrait(opp ? 1 : Math.max(1, Math.min(6, (S.lv && S.lv.rank) || 1)), opp)); if (pi && pi.src !== want && !pi.src.endsWith(want)) pi.src = want; }
    { const m = planetMeta(S.selected); set("pName", m ? m.name : S.selected === S.order[0] ? "Home1" : String(S.selected)); }
    if (p) [1, 2, 3].forEach((t, i) => {
      const r = p.resources.find((x) => x.type === t); if (!r) return;
      set("pRate" + i, fmt(r.perDay / 24) + "/h"); set("pAmt" + i, fmt(a.curAmount(p, t)));
    });
    set("pClock", new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase());
    if (sl) sl.draw();
    if (squad && squad.tick) squad.tick();
    if (bl) bl.draw();
    if (pl) pl.draw();
    if (fl) fl.draw();
    if (sp) { sp.draw(); if (sp && sp.q && sp.q.level !== (A().S.planets.get(sp.planet).structures.find((x) => x.slot === sp.slot) || {}).level + 1) { const pl = A().S.planets.get(sp.planet), st = pl.structures.find((x) => x.slot === sp.slot); if (st) A().quote(pl.id, st.type, st.level + 1).then((v) => { if (sp && v) { sp.q = { level: st.level + 1, v }; sp.sig = ""; } }); } }
    if (msg && msg.mode === "list" && msg.sig !== msgSig()) msgList();   // new mail arrived or one was deleted elsewhere
  }

  async function open() {
    if (window.GoFAArt) await window.GoFAArt.ready;
    const root = document.getElementById("port"); root.hidden = false; document.body.style.overflow = "hidden";
    if (!ready) build();
    fit(); update(); timer = setInterval(update, 1000);
  }
  function close() { while (panels.length) panels[panels.length - 1].close(); document.getElementById("port").hidden = true; document.body.style.overflow = ""; clearInterval(timer); }
  window.addEventListener("resize", fit);
  window.GoFAPort = { rankMode, xpSet, xpState: () => ({ want: RK.want, vb: RK.vb, va: RK.va, frac: RK.frac, top: RK.bar && RK.bar.style.top }), focusTune: (o) => { if (o.sun != null) SYS_FOCUS_SUNFADE = o.sun; if (o.off != null) SYS_FOCUS_OFF = o.off; if (o.pitch != null) SYS_FOCUS_PITCH = o.pitch; if (o.dist != null) SYS_FOCUS_DIST = o.dist; }, planet3d: () => p3, systemState: () => sys, carrierState: () => cv3, galaxyHome, galaxyStartView, open, close, fit, update, openMessages, openCommander, openSettings, openAccounts, openTutorial, openLeaderboards, openSquad, openAllianceProfile, openOptions, openChat, openStructure, openStructureList, openBuildList, loadShips: (c) => loadShips(c), openPlanetList, openFleets, openCarrier: (c) => openCarrier(c), openGalaxy, closeGalaxy, showView, levelBanner, dialog, panel, panels, toggleRef: () => { const r = document.getElementById("pRef"); if (r) r.style.display = r.style.display === "none" ? "block" : "none"; } };
  window.addEventListener("keydown", (e) => { if (!document.getElementById("port").hidden) { if (e.key === "Escape") { if (panels.length) panels[panels.length - 1].close(); else if (view === "galaxy") showView("system"); else if (view === "system") showView("planet"); else if (view === "carrier") { showView("planet"); openFleets(); } else close(); } if (e.key === "r" && !(e.target && e.target.tagName === "INPUT")) window.GoFAPort.toggleRef(); } });
})();
