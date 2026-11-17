/* Phase 0 spike client: logs in over the legacy protocol and shows / drives one player. Field numbers are those of the server's
   encoders (server/server.py planet_record, structure_msg, resource_msg, construction_msg); the game's messages have no names. */
(function () {
  "use strict";
  const W = window.Wire;

  // ---- names (our own wording) -------------------------------------------------------------------------------------
  const STRUCT = { 1: "Headquarters", 2: "Shipyard", 3: "Metal extractor", 4: "Gas extractor", 5: "Crystal extractor", 6: "Barracks",
    7: "Laboratory", 8: "Scanner", 9: "Planetary defence", 10: "Trade centre", 11: "Citadel" };
  const RES = { 1: "Metal", 2: "Gas", 3: "Crystal", 4: "Troops", 5: "Spy drones" };
  const SHIP = { 1: "Fighter Mk I", 2: "Fighter Mk II", 3: "Interceptor Mk I", 4: "Interceptor Mk II", 5: "Bomber Mk I", 6: "Bomber Mk II",
    8: "Freighter Mk I", 9: "Freighter Mk II" };
  const REFUSAL = { 104: "not enough resources, or the level is above the Headquarters level" };
  const TECH = {
    1: ["Metal extraction", "+10 % metal production per level"], 2: ["Crystal extraction", "+10 % crystal production per level"],
    3: ["Gas extraction", "+10 % gas production per level"], 5: ["Storage silo", "+10 % storage per level"],
    11: ["Freighter Mk II blueprint", "unlocks Freighter Mk II (uses one blueprint item)"], 13: ["Fighter Mk II blueprint", "unlocks Fighter Mk II (uses one blueprint item)"],
    15: ["Interceptor Mk II blueprint", "unlocks Interceptor Mk II (uses one blueprint item)"], 17: ["Bomber Mk II blueprint", "unlocks Bomber Mk II (uses one blueprint item)"],
    20: ["Carrier Mk II blueprint", "unlocks Carrier Mk II (uses one blueprint item)"], 22: ["Carrier Mk III blueprint", "unlocks Carrier Mk III (uses one blueprint item)"],
    30: ["Ship defence", "+5 % toughness of ships defending their planet per level"], 31: ["Ground battle", "+10 % troop strength per level"],
    32: ["Bomber defence", "fewer troops lost to enemy bombers"], 33: ["Ship production", "-1 % ship cost and build time per level"] };
  const TECH_ORDER = [1, 2, 3, 5, 33, 30, 31, 32, 13, 15, 17, 11, 20, 22];
  const REFUSAL_GATE = { 1: "the jumpgate stays closed until the home-system tutorial is done (a mail lists what is left)" };
  const REFUSAL_RESEARCH = { 105: "all laboratory slots are in use", 107: "laboratory level too low", 108: "maximum level reached" };
  const MISSION = { 1: "Quick harvest: metal", 2: "Quick harvest: gas", 3: "Quick harvest: crystal", 4: "Deep harvest: metal", 5: "Deep harvest: gas",
    6: "Deep harvest: crystal", 7: "Deep anomaly", 8: "Deep outpost", 9: "Deep ship wreck", 10: "Pirate fighters", 11: "Pirate bombers",
    12: "Pirate interceptors", 13: "Pirate hideout", 14: "Merchant under attack", 15: "Anomaly with guards", 16: "Anomaly", 17: "Wreck looting",
    18: "Unknown shipwreck", 19: "Deep rescue", 20: "Small outpost", 21: "Large outpost", 22: "Elite outpost" };
  const SKILLS = { 16: ["Metal specialist", "+10 % metal production per level"], 17: ["Gas specialist", "+10 % gas production per level"],
    18: ["Crystal specialist", "+10 % crystal production per level"], 24: ["Combat accuracy", "stronger fleets in battle"],
    25: ["Governance", "+1 planet limit per level"], 29: ["Navigation", "-3 % travel time per level"] };
  const SKILL_ORDER = [16, 17, 18, 25, 29, 24, 13, 14, 23, 26, 27, 28, 30];   // the 13 skills the server offers
  // items = the commander's inventory (request 272); BUY = 278 {1 type, 2 amount}. Names and effect wording are ours; prices and the numbers in the texts come from /debug/quote?itemlist=1
  const ITEM = { 1: "Planet limit extender", 2: "Carrier limit extender", 3: "Ship limit extender", 18: "Carrier group extender", 4: "Carrier Mk II blueprint", 5: "Carrier Mk III blueprint",
    6: "Freighter Mk II blueprint", 7: "Fighter Mk II blueprint", 8: "Interceptor Mk II blueprint", 9: "Bomber Mk II blueprint", 10: "Red artifact", 11: "Yellow artifact", 12: "Blue artifact",
    13: "Double XP", 14: "Credit booster L", 15: "Credit booster XL", 16: "Credit booster XXL", 17: "Void crystal" };
  const ITEM_ORDER = [10, 11, 12, 17, 1, 2, 3, 18, 6, 7, 8, 9, 4, 5, 13, 14, 15, 16];
  const ITEM_LIMIT = { 1: "planets you can own", 2: "carriers you can own", 3: "ships you can own", 18: "carrier groups" };
  const COLOUR = { 10: "red", 11: "yellow", 12: "blue" };   // artifact item -> citadel / carrier colour
  function itemText(t, q) {
    if (ITEM_LIMIT[t]) return "raises the limit of " + ITEM_LIMIT[t] + " by " + ((q && q.adds) || 1) + " while you own it";
    if (COLOUR[t]) return "upgrades carriers (red: offence, blue: defence, yellow: speed); found on missions and dug on " + COLOUR[t] + " citadel planets";
    if (t === 4 || t === 5) return "used up when the matching carrier blueprint research starts; only found on missions";
    if (t >= 6 && t <= 9) return "one is used up when the matching blueprint research starts";
    if (t === 13) return "doubles the XP of missions, battles and tutorial rewards while you own one";
    if (q && q.boost) return "+" + q.boost[0] + " % daily credit bonus while you own one; one is used up every " + q.boost[1] + " days";
    if (t === 17) return "one is used up for each Void carrier ordered";
    return "";
  }
  const CARRIER = { 1: "Carrier Mk I", 5: "Carrier Mk II", 9: "Carrier Mk III" };
  const carrierName = (t) => { t = t || 1; const base = t - (t - 1) % 4, col = ["", " (blue)", " (red)", " (yellow)"][(t - 1) % 4];   // types 1-16: tier 1/5/9/13 + colour offset
    return (CARRIER[base] || (base === 13 ? "Void carrier" : "Carrier type " + t)) + col; };
  const ORDERS = { 2: "Relocate", 3: "Deliver cargo" };
  const SLOTS = 12;
  const SHIP_ORDER = [1, 3, 5, 8, 2, 4, 6, 9];   // Mk I first, then Mk II (needs a blueprint research and a higher yard)

  // ---- state -------------------------------------------------------------------------------------------------------
  const S = { me: null, alias: "", planets: new Map(), groups: new Map(), order: [], selected: null, credits: null, xp: null, skillPoints: null,
    offset: 0, lastUpdate: 0, shown: "", pick: {}, yardPick: {}, shipCount: 1, techPick: {}, missions: [], skills: new Map(), troopCount: 5, sent: new Set(), mail: new Map(), details: new Map(), openMail: new Set(), droneCount: 5, info: { sandbox: false, upstream: "" }, busy: 0, colonies: null, coloniesMeta: null, coloniesSig: "", colonyView: false };

  // ---- network -----------------------------------------------------------------------------------------------------
  function parseReply(buf) {
    const top = W.decode(new Uint8Array(buf));
    const exts = [];
    for (const x of top) if (x.f === 10) for (const e of W.decode(x.v)) exts.push({ ext: e.f, payload: e.v });
    return exts;
  }

  // A banner over everything (both tabs) while the local game server cannot be reached, e.g. after its window was closed:
  // otherwise the Original look keeps showing the last state and every image that was not loaded yet comes up broken.
  function serverDown(on) {
    let b = document.getElementById("server-down");
    if (!on) { if (b) b.remove(); return; }
    if (b) return;
    b = document.createElement("div"); b.id = "server-down";
    b.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:99999;padding:12px 16px;background:#7a1d1d;color:#fff;" +
      "font:600 15px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;text-align:center;box-shadow:0 2px 8px #0008";
    b.textContent = "The game server is not running. Start Play GoFA again, then reload this page.";
    document.body.appendChild(b);
  }

  async function post(body) {
    S.busy++; render.busy();
    try {
      let r;
      try { r = await fetch("/action", { method: "POST", headers: { "Content-Type": "application/dominion-bin" }, body }); }
      catch (e) { serverDown(true); throw new Error("cannot reach the relay (" + location.origin + "): is it running? " + e.message); }
      serverDown(r.status === 502);
      if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 120));
      return parseReply(await r.arrayBuffer());
    } finally { S.busy--; render.busy(); }
  }

  async function call(exts) {      // exts: [[number, Uint8Array]]
    if (!S.me) throw new Error("not logged in");
    const parts = [W.f64(1, S.me.account), W.f64(2, S.me.player)];
    for (const [e, p] of exts) parts.push(W.ld(10, W.ld(e, p)));
    const got = await post(W.concat(parts));
    ingest(got);
    return got;
  }

  let newFemale = false;   // the gender picked on the login card for a new commander (sent as portrait 2 = female, 1 = male; the server keeps it, /debug/quote?portrait=1)
  function chooseSpecies(alias) {   // the login card asks: 1 Terran, 2 Vossk, 3 Nivelian (the game's species screen is not rebuilt); resolves 0 on cancel
    return new Promise((done) => {
      const box = document.createElement("div"); box.id = "speciesbox"; box.style.cssText = "margin:10px 0";
      const q = document.createElement("p"); q.textContent = "No commander named \u201c" + alias + "\u201d yet. Choose a species to start a new game (or Cancel and log in as Pilot):"; box.append(q);
      const gl = document.createElement("p"); gl.textContent = "Commander: ";
      [["m", "Male"], ["f", "Female"]].forEach(([v, t], i) => { const l = document.createElement("label"); l.style.marginRight = "12px"; const r = document.createElement("input"); r.type = "radio"; r.name = "gender"; r.value = v; r.checked = i === 0; l.append(r, " " + t); gl.append(l); }); box.append(gl);
      const pick = (n) => { newFemale = box.querySelector("input[name=gender]:checked").value === "f"; box.remove(); done(n); };
      [[1, "Terran"], [2, "Vossk"], [3, "Nivelian"], [0, "Cancel"]].forEach(([n, t]) => { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.style.marginRight = "8px"; b.onclick = () => pick(n); box.append(b); });
      const old = document.getElementById("speciesbox"); if (old) old.remove();
      document.getElementById("loginerr").after(box);
    });
  }

  async function login(alias) {
    const dev = localStorage.getItem("gofa.dev") || (() => { const d = crypto.randomUUID().toUpperCase(); localStorage.setItem("gofa.dev", d); return d; })();
    const info = W.concat([W.ld(1, dev), W.v(2, 1), W.ld(3, "Browser"), W.ld(4, "Web"), W.ld(5, "1")]);
    const payload = W.concat([W.ld(1, "G:WEB-" + alias), W.v(2, 1), W.ld(3, "0".repeat(64)), W.ld(4, "en"), W.ld(5, dev),
      W.ld(6, "00000000-0000-0000-0000-000000000000"), W.ld(8, alias)]);
    let got = await post(W.concat([W.f64(1, 0), W.f64(2, 0), W.ld(4, info), W.ld(10, W.ld(2013, payload))]));
    if (!got.find((e) => e.ext === 2005) && got.find((e) => e.ext === 92913)) {
      // unknown commander with species selection on: the game shows the species screen and creates the player with
      // 2700 {1 1, 2 {}, 3 language, 4 device id, 6 species 1-3, 7 portrait, 13 alias} (server.py handle_2700)
      const race = await chooseSpecies(alias);
      if (!race) throw new Error("unknown commander \u201c" + alias + "\u201d: no species chosen (log in as Pilot to use the existing save)");
      const create = W.concat([W.v(1, 1), W.ld(2, new Uint8Array(0)), W.ld(3, "en"), W.ld(4, dev), W.v(6, race), W.v(7, newFemale ? 2 : 1), W.ld(13, alias)]);
      got = await post(W.concat([W.f64(1, 0), W.f64(2, 0), W.ld(4, info), W.ld(10, W.ld(2700, create))]));
      log("new commander " + alias + " created (species " + race + ")");
    }
    const ids = got.find((e) => e.ext === 2005);
    if (!ids) {
      const err = got.find((e) => e.ext >= 9000);
      throw new Error(err ? "login refused (ext " + err.ext + ")" : "no 2005 in the login reply (got " + got.map((e) => e.ext).join(",") + ")");
    }
    const f = W.msg(ids.payload);
    S.me = { session: W.get(f, 1).big, account: W.get(f, 2).big, player: W.get(f, 3).big };
    S.alias = alias;
    log("login ok: player " + S.me.player.toString(16).toUpperCase());
    try { const r = await fetch("/debug/quote?portrait=1&player=" + S.me.player.toString(16).toUpperCase()); S.female = !!(await r.json()).female; } catch (e) { S.female = false; }   // the avatars (port.js): own sex, and the adjutant is the opposite
    await call([[150, W.ld(1, W.dbl(1, performance.now() / 1000))], [111, new Uint8Array(0)], [104, new Uint8Array(0)], [115, new Uint8Array(0)], [119, new Uint8Array(0)], [114, new Uint8Array(0)], [102, new Uint8Array(0)], [112, new Uint8Array(0)], [272, new Uint8Array(0)], [242, new Uint8Array(0)]]);
    if (!S.order.length) throw new Error("the server sent no planets");
    S.selected = S.order[0];
    await refreshPlanets();
  }

  // ---- message parsing ---------------------------------------------------------------------------------------------
  const tsOf = (u8) => (u8 ? (W.get(W.msg(u8), 1) || {}).dbl || 0 : 0);

  function parsePlanet(u8) {
    const f = W.msg(u8);
    const p = { id: W.num(W.get(f, 1)), state: W.get(f, 2), owner: null, structures: [], resources: [], builds: [], ships: [], carriers: [], shipJobs: [], techs: [], research: [], scans: [], droneJobs: [], troopJobs: [], carrierJobs: [], digJobs: [] };
    const own = W.get(f, 3);
    if (own) { const o = W.msg(own); p.owner = { id: W.num(W.get(o, 1)), name: W.get(o, 2) ? W.str(W.get(o, 2)) : "?" }; }
    const items = (fieldNo) => { const c = W.get(f, fieldNo); return c ? W.all(W.msg(c), 1) : []; };
    for (const s of items(14)) {
      const m = W.msg(s);
      p.structures.push({ type: W.get(m, 1), slot: W.get(m, 2), level: W.get(m, 3) || 0, id: W.num(W.get(m, 4)) });
    }
    for (const r of items(9)) {
      const m = W.msg(r);
      p.resources.push({ type: W.get(m, 1), amount: W.get(m, 2) || 0, perDay: W.get(m, 3) || 0, cap: W.get(m, 4) || 0, ts: tsOf(W.get(m, 5)) });
    }
    for (const b of items(15)) {
      const m = W.msg(b), timer = W.msg(W.get(m, 1)), st = W.msg(W.get(m, 2));
      p.builds.push({ id: W.get(timer, 1), start: tsOf(W.get(timer, 2)), end: tsOf(W.get(timer, 3)), type: W.get(st, 1), slot: W.get(st, 2), level: W.get(st, 3) });
    }
    for (const s of items(11)) { const m = W.msg(s); p.ships.push({ type: W.get(m, 1), count: W.get(m, 2) }); }
    for (const c of items(5)) {
      const m = W.msg(c);
      const aboard = W.get(m, 4);   // {4 {1 {1 type, 2 count}, ...}}
      let travel = null;   // {11 {1 timer, 2 mission, 3 carrier}}; stubs after a trip carry mission 0
      const tr = W.get(m, 11);
      if (tr) { const t = W.msg(tr), tt = W.msg(W.get(t, 1) || new Uint8Array(0)); if (W.get(t, 2)) travel = { mission: W.get(t, 2), end: tsOf(W.get(tt, 3)) }; }
      let move = null;   // {10 {1 timer, 2 carrier, 3 order, 4 target, 5 origin}}; stubs after a trip carry carrier 0 / target 0
      const mvf = W.get(m, 10);
      if (mvf) { const q = W.msg(mvf), tt = W.msg(W.get(q, 1) || new Uint8Array(0)); if (W.num(W.get(q, 4))) move = { end: tsOf(W.get(tt, 3)), order: W.get(q, 3), target: W.num(W.get(q, 4)), origin: W.num(W.get(q, 5)) }; }
      p.carriers.push({ id: W.num(W.get(m, 1)), type: W.get(m, 2), level: W.get(m, 3), at: W.get(m, 6), moving: !!(travel || move), travel, move,
        behaviour: W.get(m, 9) || 1, group: W.num(W.get(m, 16)) || 0,   // 9 = 1 engage / 2 avoid combat (not "moving": 2026-11-12), 16 = carrier group
        ships: aboard ? W.all(W.msg(aboard), 1).map((x) => { const q = W.msg(x); return { type: W.get(q, 1), count: W.get(q, 2) }; }) : [] });
    }
    for (const j of items(10)) {
      const m = W.msg(j), timer = W.msg(W.get(m, 1)), what = W.msg(W.get(m, 2));
      p.shipJobs.push({ id: W.get(timer, 1), end: tsOf(W.get(timer, 3)), ship: W.get(what, 1), count: W.get(what, 2) });
    }
    for (const j of items(8)) {   // scan jobs {1 timer, 2 range, 3 scanner structure id}
      const m = W.msg(j), timer = W.msg(W.get(m, 1));
      p.scans.push({ id: W.get(timer, 1), end: tsOf(W.get(timer, 3)), range: W.get(m, 2) || 0, scanner: W.get(m, 3) });
    }
    for (const j of items(12)) {   // spy drone queue {1 timer, 2 scanner id, 3 count}
      const m = W.msg(j), timer = W.msg(W.get(m, 1));
      p.droneJobs.push({ id: W.get(timer, 1), end: tsOf(W.get(timer, 3)), count: W.get(m, 3) });
    }
    for (const j of items(6)) {   // carrier production queue {1 timer, 2 {1 type, 2 level, 3 count}, 3 yard}
      const m = W.msg(j), timer = W.msg(W.get(m, 1)), what = W.msg(W.get(m, 2));
      p.carrierJobs.push({ id: W.get(timer, 1), end: tsOf(W.get(timer, 3)), type: W.get(what, 1), level: W.get(what, 2), count: W.get(what, 3) });
    }
    for (const j of items(7)) {   // troop training queue {1 timer, 2 barracks id, 3 count}
      const m = W.msg(j), timer = W.msg(W.get(m, 1));
      p.troopJobs.push({ id: W.get(timer, 1), end: tsOf(W.get(timer, 3)), count: W.get(m, 3) });
    }
    for (const j of items(4)) {   // artifact dig jobs {1 timer, 2 citadel structure id}
      const m = W.msg(j), timer = W.msg(W.get(m, 1));
      p.digJobs.push({ id: W.get(timer, 1), end: tsOf(W.get(timer, 3)), sid: W.num(W.get(m, 2)) });
    }
    for (const t of items(16)) { const m = W.msg(t); p.techs.push({ tech: W.get(m, 1), level: W.get(m, 2) || 0 }); }   // researched (home planet only)
    for (const j of items(17)) {   // research jobs {1 timer, 2 {1 tech, 2 level}, 3 lab}
      const m = W.msg(j), timer = W.msg(W.get(m, 1)), o = W.msg(W.get(m, 2));
      p.research.push({ id: W.get(timer, 1), end: tsOf(W.get(timer, 3)), tech: W.get(o, 1), level: W.get(o, 2) });
    }
    return p;
  }

  const MAILKIND = { 1: "Message", 3: "Battle", 4: "Mission", 5: "System", 6: "Spy report" };
  function parseMail(u8) {   // {1 id, 2 sender {1 id, 2 name}, 4 body, 5 time, 6 kind, 7 template {1 kind, 2 key}}
    const m = W.msg(u8), from = W.get(m, 2), tpl = W.get(m, 7);
    return { id: W.num(W.get(m, 1)), from: from ? W.str(W.get(W.msg(from), 2) || new Uint8Array(0)) : "", body: W.get(m, 4) ? W.str(W.get(m, 4)) : "",
      time: tsOf(W.get(m, 5)), kind: W.get(m, 6) || 1, key: tpl ? (W.get(W.msg(tpl), 2) ? W.str(W.get(W.msg(tpl), 2)) : "") : "" };
  }
  const list1 = (u8) => (u8 ? W.all(W.msg(u8), 1) : []);
  function parseDetails(u8) {   // the field number is the variant: 1 / 8 text, 4 mission report, 3 battle, 6 spy report
    const d = W.msg(u8);
    if (W.get(d, 4)) {
      const r = W.msg(W.get(d, 4)), res = W.msg(W.get(r, 2) || new Uint8Array(0));
      return { variant: 4, type: W.get(r, 1), level: W.get(r, 3), loc: W.num(W.get(r, 4)),
        resources: list1(W.get(res, 1)).map((x) => { const q = W.msg(x); return { type: W.get(q, 1), left: W.get(q, 2) || 0, earned: W.get(q, 3) || 0 }; }),
        credits: W.get(res, 3) ? W.get(W.msg(W.get(res, 3)), 1) || 0 : 0, xp: W.get(res, 4) || 0,
        ships: list1(W.get(res, 5)).map((x) => { const q = W.msg(x); return { type: W.get(q, 1), count: W.get(q, 2) }; }),
        items: W.all(res, 8).map((x) => { const q = W.msg(x); return { type: W.get(q, 1), count: W.get(q, 2) }; }) };
    }
    if (W.get(d, 6)) {
      const r = W.msg(W.get(W.msg(W.get(d, 6)), 1)), tgt = W.get(r, 3) ? W.msg(W.get(r, 3)) : [], spy = W.get(r, 2) ? W.msg(W.get(r, 2)) : [];
      return { variant: 6, f4: W.num(W.get(r, 4)), planet: W.num(W.get(r, 1)), target: W.get(tgt, 2) ? W.str(W.get(tgt, 2)) : "", spier: W.get(spy, 2) ? W.str(W.get(spy, 2)) : "",
        resources: list1(W.get(r, 5)).map((x) => { const q = W.msg(x); return { type: W.get(q, 1), amount: W.get(q, 2) || 0 }; }),
        ships: list1(W.get(r, 6)).map((x) => { const q = W.msg(x); return { type: W.get(q, 1), count: W.get(q, 2) }; }),
        structures: list1(W.get(r, 7)).map((x) => { const q = W.msg(x); return { type: W.get(q, 1), level: W.get(q, 3) }; }) };
    }
    if (W.get(d, 3)) {   // battle report {1 battle {1 before {1 attacker side, 2 defender side}, 2 after, 3 time, 4 result}, 3 ground {1 before {1 [att {1 player, 2 marines}], 2 [def]}, 2 after, 3 time, 4 result}, 5 {1 bombed}, 7 {1 planet, 9 resources}, 8 planet}
      const t = W.msg(W.get(d, 3)), none = new Uint8Array(0), b = W.msg(W.get(t, 1) || none);
      const player = (u) => { const pl = W.msg(u || none); return { id: W.num(W.get(pl, 1)), name: W.get(pl, 2) ? W.str(W.get(pl, 2)) : "", race: W.get(pl, 3) || 0 }; };
      const shipsOf = (u) => list1(u).map((x) => { const q = W.msg(x); return { type: W.get(q, 1), count: W.num(W.get(q, 2)) || 0 }; });
      const side = (u) => W.all(W.msg(u || none), 1).map((pu) => { const p = W.msg(pu); return { player: player(W.get(p, 1)), ships: shipsOf(W.get(p, 2)), carrier: !!W.get(p, 6) }; });
      const phase = (u) => { const q = W.msg(u || none); return { att: side(W.get(q, 1)), def: side(W.get(q, 2)) }; };
      const gphase = (u) => { const q = W.msg(u || none), one = (k) => W.all(q, k).map((x) => { const e = W.msg(x); return { player: player(W.get(e, 1)), marines: W.num(W.get(e, 2)) || 0 }; }); return { att: one(1), def: one(2) }; };
      const g = W.get(t, 3) ? W.msg(W.get(t, 3)) : null, bomb = W.get(t, 5) ? W.msg(W.get(t, 5)) : null;
      // field 13 = battle v2, what the client's report view really reads: participants carry a player id (resolved in list 5) and ONE
      // carrier id (field 6, resolved in list 7), so N stationed carriers = N defender entries (allies' carriers bring the ally along)
      let before = phase(W.get(b, 1)), after = phase(W.get(b, 2)), carriers = [];
      if (W.get(t, 13)) {
        const v = W.msg(W.get(t, 13)), names = new Map();
        for (const u of W.all(v, 5)) { const pl = player(u); names.set(pl.id, pl); }
        carriers = W.all(v, 7).map((u) => { const c = W.msg(u); return { id: W.num(W.get(c, 1)), type: W.get(c, 2) || 0, level: W.get(c, 3) || 1, owner: W.num(W.get(c, 5)) }; });
        const side2 = (u) => W.all(W.msg(u || none), 1).map((pu) => { const p = W.msg(pu), id = W.num(W.get(p, 1));
          return { player: names.get(id) || { id, name: "", race: 0 }, ships: shipsOf(W.get(p, 2)), carrier: W.get(p, 6) ? W.num(W.get(p, 6)) : 0 }; });
        const phase2 = (u) => { const q = W.msg(u || none); return { att: side2(W.get(q, 1)), def: side2(W.get(q, 2)) }; };
        before = phase2(W.get(v, 1)); after = phase2(W.get(v, 2));
      }
      const dead = W.get(t, 2) ? W.msg(W.get(t, 2)) : null;   // field 2 {1 [attacker carriers destroyed], 2 [defender carriers destroyed]}
      return { variant: 3, result: W.get(b, 4) || 0, before, after, carriers, planet: W.num(W.get(t, 8)),
        lostCarriers: { att: dead ? W.all(dead, 1).length : 0, def: dead ? W.all(dead, 2).length : 0 },
        ground: g ? { before: gphase(W.get(g, 1)), after: gphase(W.get(g, 2)), result: W.get(g, 4) || 0 } : null,
        bombed: bomb ? W.num(W.get(bomb, 1)) || 0 : 0, bombedSent: !!bomb };   // field 5 {1 marines bombed}
    }
    for (const v of [1, 8, 9]) if (W.get(d, v)) { const t = W.get(W.msg(W.get(d, v)), 1); return { variant: v, text: t && t.length ? W.str(t) : "" }; }
    return { variant: 0 };
  }

  function parseMission(u8) {   // {1 id, 2 type, 3 planet, 4 system, 5 level, 6 expires, 7 {1 {1 ship type, 2 threat class}}}
    const m = W.msg(u8), fl = W.get(m, 7);
    return { id: W.num(W.get(m, 1)), type: W.get(m, 2), planet: W.num(W.get(m, 3)), level: W.get(m, 5) || 1, expires: tsOf(W.get(m, 6)),
      enemy: fl ? W.all(W.msg(fl), 1).map((x) => { const q = W.msg(x); return { ship: W.get(q, 1), threat: W.get(q, 2) }; }) : [] };
  }

  function planetList(u8) {   // PlanetList {1 repeated Planet}
    return W.all(W.msg(u8), 1).map(parsePlanet);
  }

  function ingest(exts) {
    let changed = false;
    for (const { ext, payload } of exts) {
      try {
        if (ext === 102) {   // {1 PlanetList}
          const f = W.msg(payload), pl = W.get(f, 1);
          if (pl) {
            const ps = planetList(pl), was = S.order.join(","); S.order = ps.map((p) => p.id); for (const p of ps) S.planets.set(p.id, mergePlanet(p)); changed = true;
            if (!S.order.includes(S.selected)) { S.selected = S.order[0]; S.shown = ""; }   // the planet we were looking at was given up or lost
            if (was && was !== S.order.join(",")) loadColonies();   // a planet came or went: ask the server for the overview again
          }
        } else if (ext === 103) {   // {1 ids, 2 PlanetList}
          const pl = W.get(W.msg(payload), 2);
          if (pl) { for (const p of planetList(pl)) S.planets.set(p.id, mergePlanet(p)); changed = true; }
        } else if (ext === 104) {   // mail list {1 message, ...}; a push carries only the new ones
          for (const u of W.all(W.msg(payload), 1)) { const m = parseMail(u); S.mail.set(m.id, m); }
          changed = true;
        } else if (ext === 105) {   // {1 {1 id, 2 message, 3 details}, ..., 2 ids}
          for (const u of W.all(W.msg(payload), 1)) { const e = W.msg(u), id = W.num(W.get(e, 1)), dt = W.get(e, 3); if (dt) S.details.set(id, parseDetails(dt)); }
          changed = true;
        } else if (ext === 109 || ext === 330) {   // 109 {1 carriers, 2 {1 [{1 id, 2 name}]}} / 330 {1 echo, 2 {1 id, 2 name}}: carrier groups
          const f = W.msg(payload), grp = (u) => { const q = W.msg(u); S.groups.set(W.num(W.get(q, 1)), new TextDecoder().decode(W.get(q, 2) || new Uint8Array(0))); };
          if (ext === 109) { S.groups = new Map(); const g = W.get(f, 2); if (g) W.all(W.msg(g), 1).forEach(grp); } else if (W.get(f, 2)) grp(W.get(f, 2));
          changed = true;
        } else if (ext === 272) {   // inventory {1 {1 repeated {1 unique id, 2 item def {1 item type, ...}, 3 count}}}
          const lst = W.get(W.msg(payload), 1); S.inventory = new Map();
          for (const e of lst ? W.all(W.msg(lst), 1) : []) { const m = W.msg(e), d = W.get(m, 2) ? W.msg(W.get(m, 2)) : []; S.inventory.set(W.get(d, 1), (S.inventory.get(W.get(d, 1)) || 0) + (W.get(m, 3) || 0)); }
          changed = true;
        } else if (ext === 242) {   // jumpgate state {1 {1 timestamp, 2 {1 start planet id}, 3 int}}: a start planet means the gate has been opened
          const g = W.get(W.msg(payload), 1), m = g ? W.msg(g) : [], pf = W.get(m, 2);
          const was = S.jumpgate ? S.jumpgate.planet : null; S.jumpgate = { planet: pf ? W.num(W.get(W.msg(pf), 1)) : 0, ts: tsOf(W.get(m, 1)) }; if (was !== S.jumpgate.planet) S.shown = ""; changed = true;
        } else if (ext === 117) { changed = true;
        } else if (ext === 112) {   // {1 {1 mission, ...}}
          const c = W.get(W.msg(payload), 1);
          const now = c ? W.all(W.msg(c), 1).map(parseMission) : [];
          for (const id of S.sent) if (!now.some((m) => m.id === id)) { log("mission " + id + " finished: the report is in the Mail box"); S.sent.delete(id); }
          S.missions = now; changed = true; S.shown = "";
        } else if (ext === 114) {   // {1 commander {1 id, 2 name, 4 skills {1 {1 skill, 2 level}}}}
          const c = W.get(W.msg(payload), 1);
          if (c) { const sk = W.get(W.msg(c), 4); S.skills = new Map(sk ? W.all(W.msg(sk), 1).map((x) => { const q = W.msg(x); return [W.get(q, 1), W.get(q, 2) || 0]; }) : []); S.skillsShown = ""; changed = true; }
        } else if (ext === 111) {   // {1 Player {1 id, 2 name, 3 species 1 Terran / 2 Vossk / 3 Nivelian, ...}}
          const pl = W.get(W.msg(payload), 1); if (pl) { S.race = W.get(W.msg(pl), 3); changed = true; }
        } else if (ext === 115) { const c = W.get(W.msg(payload), 1); if (c) S.credits = W.get(W.msg(c), 1); changed = true;
        } else if (ext === 119) { const f = W.msg(payload); S.skillPoints = W.get(f, 1); S.xp = W.get(f, 2); changed = true; fetchLevel();
        } else if (ext === 150) { const f = W.msg(payload); S.offset = tsOf(W.get(f, 2)) - Date.now() / 1000;
        } else if (ext === 200) { log("construction started");
        } else if (ext >= 9000 && ext < 10000) {
          const f = W.msg(payload), code = W.get(f, 1);
          log("refused (" + ext + "): " + ((ext === 9206 ? REFUSAL_RESEARCH[code] : ext === 9241 ? REFUSAL_GATE[code] : REFUSAL[code]) || "code " + code), true);
        }
      } catch (e) { log("could not read ext " + ext + ": " + e.message, true); }
    }
    S.lastUpdate = Date.now();
    if (changed) render.all();
  }

  // a poll answers every few seconds; redraw the planet panel only when something other than the resource counters changed,
  // otherwise buttons and dropdowns would be replaced under the user's mouse
  function signature(p) {
    return JSON.stringify([S.order, p.id, p.owner, p.structures, p.builds, p.ships, p.carriers, p.shipJobs, p.techs, p.research, p.scans, p.droneJobs, p.troopJobs, p.carrierJobs, p.digJobs, p.resources.map((r) => [r.type, r.cap])]);
  }

  function mergePlanet(p) {   // a 103/102 for a planet we are not looking at carries empty parts: keep what we know
    const old = S.planets.get(p.id);
    if (!old) return p;
    for (const k of ["structures", "resources", "builds", "ships", "carriers", "shipJobs", "techs", "research", "scans", "droneJobs", "troopJobs", "carrierJobs", "digJobs"]) if (!p[k].length && old[k].length && p.id !== S.selected) p[k] = old[k];
    return p;
  }

  // ---- actions -----------------------------------------------------------------------------------------------------
  const flags = () => W.concat([W.v(2, 1), ...[4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((n) => W.v(n, 1))]);
  async function refreshPlanets(ids) {
    const want = ids || (S.colonyView ? S.order : [S.selected]);   // the Colonies tab shows every planet
    await call([[281, W.v(1, 11)], [103, W.concat([...want.map((i) => W.v(1, i)), flags()])]]);
  }
  async function refreshAccount() { await call([[115, new Uint8Array(0)], [109, new Uint8Array(0)], [119, new Uint8Array(0)], [114, new Uint8Array(0)], [102, new Uint8Array(0)], [112, new Uint8Array(0)], [104, new Uint8Array(0)], [272, new Uint8Array(0)], [242, new Uint8Array(0)]]); }

  async function buildOrUpgrade(planet, type, slot, level) {
    log((level === 1 ? "build " : "upgrade ") + (STRUCT[type] || "type " + type) + " in slot " + slot + " to level " + level);
    await call([[200, W.concat([W.v(1, planet), W.ld(2, W.concat([W.v(1, type), W.v(2, slot), W.v(3, level)]))])]]);
    await refreshAccount();
  }

  // what an order costs: asked from the server (read-only /debug/quote, sandbox only); species and planet-quality discounts are applied there
  const quotes = new Map();
  function quote(planet, type, level) {
    const key = planet + ":" + type + ":" + level;
    if (!quotes.has(key)) {
      const url = "/debug/quote?planet=" + planet + "&type=" + type + "&level=" + level + "&player=" + S.me.player.toString(16).toUpperCase();
      quotes.set(key, fetch(url).then((r) => (r.ok ? r.json() : null)).then((q) => (q && !q.error ? q : null)).catch(() => null));
    }
    return quotes.get(key);
  }
  function attachQuote(btn, info, p, type, level) {
    delete btn.dataset.cost; info.textContent = "";
    quote(p.id, type, level).then((q) => {
      if (!q) return;
      btn.dataset.cost = q.cost.join(","); btn.dataset.planet = p.id; btn.dataset.type = type; btn.dataset.level = level;
      info.dataset.text = q.cost.map(fmtNum).join(" / ") + " · " + fmtDur(q.seconds);
      info.textContent = "cost " + info.dataset.text;
      evalButtons();
    });
  }
  function curAmount(p, type) {
    const r = p.resources.find((x) => x.type === type);
    if (!r) return 0;
    return Math.max(r.amount, Math.min(r.cap, r.amount + r.perDay / 86400 * Math.max(0, nowSrv() - r.ts)));
  }
  function evalButtons() {
    evalShips(); evalTechs(); evalScanner(); evalCarriers(); evalDig();
    for (const btn of document.querySelectorAll("button[data-cost]")) {
      const p = S.planets.get(Number(btn.dataset.planet));
      let why = "";
      if (p) {
        const cost = btn.dataset.cost.split(",").map(Number), type = Number(btn.dataset.type), level = Number(btn.dataset.level);
        const hq = Math.max(1, ...p.structures.filter((s) => s.type === 1).map((s) => s.level));
        if (type !== 1 && level > hq) why = "needs Headquarters level " + level;
        else { const short = [1, 2, 3].filter((t, i) => curAmount(p, t) < cost[i]).map((t) => RES[t].toLowerCase()); if (short.length) why = "not enough " + short.join(", "); }
      }
      btn.disabled = !!btn.dataset.busy || !!why;
      btn.title = why;
      const info = btn.parentElement.querySelector(".cost");
      if (info) { info.classList.toggle("bad", !!why); info.textContent = info.dataset.text ? "cost " + info.dataset.text + (why ? " — " + why : "") : ""; }
    }
  }

  // ship orders: one ship's cost / time from the server (/debug/quote?ship=), multiplied by the count typed in the row
  const shipQuotes = new Map();
  const shipRows = [];   // {type, input, info, btn, q}, rebuilt with the planet panel
  function quoteShip(planet, ship, yard, yardLevel) {
    const key = [planet, ship, yard, yardLevel].join(":");
    if (!shipQuotes.has(key)) {
      const url = "/debug/quote?planet=" + planet + "&ship=" + ship + "&yard=" + yard + "&player=" + S.me.player.toString(16).toUpperCase();
      shipQuotes.set(key, fetch(url).then((r) => (r.ok ? r.json() : null)).then((q) => (q && !q.error ? q : null)).catch(() => null));
    }
    return shipQuotes.get(key);
  }
  function evalShips() {
    for (const row of shipRows) {
      const p = S.planets.get(row.planet);
      if (!row.q || !p) continue;
      const q = row.q, count = Math.max(1, Math.min(9999, parseInt(row.input.value, 10) || 1));
      const cost = q.cost.map((c) => c * count), secs = q.seconds * count;
      let why = "";
      if (q.yard_level < q.yard_needed) why = "needs Shipyard level " + q.yard_needed;
      else if (!q.blueprint_ok) why = "needs the blueprint research (technology " + q.blueprint_tech + ")";
      else { const short = [1, 2, 3].filter((t, i) => curAmount(p, t) < cost[i]).map((t) => RES[t].toLowerCase()); if (short.length) why = "not enough " + short.join(", "); }
      row.info.textContent = cost.map(fmtNum).join(" / ") + " · " + fmtDur(secs) + (why ? " — " + why : "");
      row.info.classList.toggle("bad", !!why);
      row.btn.disabled = !!row.btn.dataset.busy || !!why;
      row.btn.title = why;
    }
  }
  const carrierRows = [];
  function evalCarriers() {
    for (const row of carrierRows) {
      const p = S.planets.get(row.planet);
      if (!row.q || !p) continue;
      const q = row.q, count = Math.max(1, Math.min(99, parseInt(row.input.value, 10) || 1)), cost = q.cost.map((c) => c * count);
      let why = "";
      if (q.yard_level < q.yard_needed) why = "needs Shipyard level " + q.yard_needed;
      else { const short = [1, 2, 3].filter((t, i) => curAmount(p, t) < cost[i]).map((t) => RES[t].toLowerCase()); if (short.length) why = "not enough " + short.join(", "); }
      row.info.textContent = cost.map(fmtNum).join(" / ") + " · " + fmtDur(q.seconds * count) + (why ? " — " + why : "");
      row.info.classList.toggle("bad", !!why); row.btn.disabled = !!row.btn.dataset.busy || !!why; row.btn.title = why;
    }
  }
  const tripCache = new Map();   // not cached long: the cargo changes
  function quoteMove(fleet, target) {
    return fetch("/debug/quote?planet=" + S.order[0] + "&move=1&fleet=" + fleet + "&target=" + target + "&player=" + me16()).then((r) => (r.ok ? r.json() : null)).then((q) => (q && !q.error ? q : null)).catch(() => null);
  }
  async function orderShips(planet, yard, ship, count) {
    log("order " + count + " × " + (SHIP[ship] || "type " + ship));
    await call([[201, W.concat([W.v(1, yard), W.ld(2, W.concat([W.v(1, ship), W.v(2, count)]))])]]);
    await refreshAccount();
  }

  // research: price and gates from the server (/debug/quote?tech=); the server does not charge more than the stores hold, so the page enforces affordability
  const techQuotes = new Map();
  const techRows = [];
  function quoteTech(planet, tech, level, lab, labLevel) {
    const key = [planet, tech, level, lab, labLevel].join(":");
    if (!techQuotes.has(key)) {
      const url = "/debug/quote?planet=" + planet + "&tech=" + tech + "&level=" + level + "&lab=" + lab + "&player=" + S.me.player.toString(16).toUpperCase();
      techQuotes.set(key, fetch(url).then((r) => (r.ok ? r.json() : null)).then((q) => (q && !q.error ? q : null)).catch(() => null));
    }
    return techQuotes.get(key);
  }
  function evalTechs() {
    for (const row of techRows) {
      const p = S.planets.get(row.planet);
      if (!row.q || !p) continue;
      const q = row.q;
      const used = new Set([...p.techs.map((t) => t.tech), ...p.research.map((j) => j.tech)]);
      let why = "";
      if (q.level > q.max_level) why = "maximum level reached";
      else if (!used.has(row.tech) && used.size >= q.slots) why = "all " + q.slots + " laboratory slots are in use";
      else if (q.lab_level < q.lab_needed) why = "needs Laboratory level " + q.lab_needed;
      else if (q.item && !q.item_owned) why = "needs a blueprint item (none owned)";
      else { const short = [1, 2, 3].filter((t, i) => curAmount(p, t) < q.cost[i]).map((t) => RES[t].toLowerCase()); if (short.length) why = "not enough " + short.join(", "); }
      row.info.textContent = "level " + q.level + ": " + q.cost.map(fmtNum).join(" / ") + " · " + fmtDur(q.seconds) + (why ? " — " + why : "");
      row.info.classList.toggle("bad", !!why);
      row.btn.disabled = !!row.btn.dataset.busy || !!why;
      row.btn.title = why;
    }
  }
  async function orderResearch(lab, tech, level) {
    log("research " + (TECH[tech] ? TECH[tech][0] : "tech " + tech) + " to level " + level);
    await call([[206, W.concat([W.v(1, lab), W.ld(2, W.concat([W.v(1, tech), W.v(2, level)]))])]]);
    await refreshAccount();
  }

  // scanner, drones, missions: prices from /debug/quote (unit=, scan=); orders 211 (drones), 204 (scan), 210 (collect), 110 (load), 205 (send)
  const jsonCache = new Map();
  function getJson(url) {
    if (!jsonCache.has(url)) jsonCache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).then((q) => (q && !q.error ? q : null)).catch(() => null));
    return jsonCache.get(url);
  }
  const me16 = () => S.me.player.toString(16).toUpperCase();
  function fetchLevel() {
    if (S.xp == null || !S.me) return;
    const xp = S.xp;
    getJson("/debug/quote?planet=" + S.order[0] + "&commander=1&xp=" + xp + "&player=" + me16()).then((q) => {
      if (q && S.xp === xp) { S.lv = q; S.skillsShown = ""; render.header(); render.commander(); if (window.GoFAPort && window.GoFAPort.update) window.GoFAPort.update(); }   // the Original look shows its LEVEL n REACHED! banner at once
    });
  }
  const scanRows = [], droneRow = [];
  function evalScanner() {
    for (const row of droneRow) {
      const p = S.planets.get(row.planet);
      if (!row.q || !p) continue;
      const count = Math.max(1, Math.min(9999, parseInt(row.input.value, 10) || 1)), cost = row.q.cost.map((c) => c * count);
      const short = [1, 2, 3].filter((t, i) => curAmount(p, t) < cost[i]).map((t) => RES[t].toLowerCase());
      row.info.textContent = cost.map(fmtNum).join(" / ") + " · " + fmtDur(row.q.seconds * count) + (short.length ? " — not enough " + short.join(", ") : "");
      row.info.classList.toggle("bad", !!short.length);
      row.btn.disabled = !!row.btn.dataset.busy || !!short.length; row.btn.title = short.length ? "not enough " + short.join(", ") : "";
    }
    for (const row of scanRows) {
      const p = S.planets.get(row.planet);
      if (!row.q || !p) continue;
      const have = (p.resources.find((r) => r.type === 5) || {}).amount || 0;
      const why = have < row.q.drones ? "needs " + row.q.drones + " spy drone" + (row.q.drones > 1 ? "s" : "") : "";
      row.btn.disabled = !!row.btn.dataset.busy || !!why; row.btn.title = why;
      row.info.textContent = row.q.drones + " drone" + (row.q.drones > 1 ? "s" : "") + " · " + fmtDur(row.q.seconds) + (why ? " — " + why : "");
      row.info.classList.toggle("bad", !!why);
    }
    for (const b of document.querySelectorAll("button[data-collect-end]")) b.disabled = !!b.dataset.busy || Number(b.dataset.collectEnd) > nowSrv();
  }
  const digRows = [];   // artifact digging rows of the planet panel (rebuilt with it)
  function evalDig() {
    for (const r of digRows) {
      const p = S.planets.get(r.planet), q = r.q;
      if (!p) continue;
      const head = "Citadel in slot " + r.slot + " (level " + r.level + ")";
      if (!q) { r.info.textContent = head + " · asking the server …"; r.btn.disabled = true; continue; }
      const colour = COLOUR[q.item], own = S.inventory ? S.inventory.get(q.item) || 0 : 0;
      if (!q.item) { r.info.textContent = head + " · this is not a citadel planet, so there is nothing to dig here"; r.cost.textContent = ""; r.btn.disabled = true; r.btn.title = "not a citadel planet"; continue; }
      r.info.textContent = head + " · digs a " + colour + " artifact (you hold " + fmtNum(own) + ")";
      if (r.job) { r.cost.textContent = "the dig finishes in"; continue; }   // Collect is enabled by evalScanner's data-collect-end loop
      const short = [1, 2, 3].filter((t, i) => curAmount(p, t) < q.cost[i]).map((t) => RES[t].toLowerCase());
      r.cost.textContent = q.cost.map(fmtNum).join(" / ") + " · " + fmtDur(q.seconds) + (short.length ? " — not enough " + short.join(", ") : "");
      r.cost.classList.toggle("bad", !!short.length); r.btn.disabled = !!r.btn.dataset.busy || !!short.length; r.btn.title = short.length ? "not enough " + short.join(", ") : "";
    }
  }
  async function simpleOrder(label, exts) { log(label); await call(exts); await refreshAccount(); }
  const loadoutRequest = (carrier, counts) => W.concat([W.v(1, carrier), W.ld(2, W.concat(Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => W.ld(1, W.concat([W.v(1, Number(t)), W.v(2, n)])))))]);
  const sendRequest = (carrier, mission) => W.concat([W.v(1, carrier), W.v(2, mission), W.dbl(4, 1.0)]);
  const carriersAt = (planet) => { const home = S.planets.get(S.order[0]); return home ? home.carriers.filter((c) => c.at === planet) : []; };

  async function debug(path) {
    path += "&player=" + S.me.player.toString(16).toUpperCase();   // the debug endpoints act on the default player unless told which one
    const r = await fetch(path);
    const t = await r.text();
    log(path + " -> " + r.status + (t.length < 80 ? " " + t : ""), !r.ok);
    await refreshAccount(); await refreshPlanets();
  }

  // ---- helpers / rendering -----------------------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const nowSrv = () => Date.now() / 1000 + S.offset;
  const fmtNum = (n) => Math.floor(n).toLocaleString("en-GB");
  const fmtDur = (s) => { s = Math.max(0, Math.round(s)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (d ? d + "d " : "") + (h || d ? String(h).padStart(2, "0") + ":" : "") + String(m).padStart(2, "0") + ":" + String(x).padStart(2, "0"); };
  // the commander level is NOT computed here: the XP curve is a server rule (100 x L x ceil(L / 10) per level), so it is asked for (/debug/quote?commander=1&xp=)

  function mailTitle(m) {
    const k = /^DESC_MISSION_(SUCCESS|FAILURE)_(.+)$/.exec(m.key || m.body || "");
    if (k) return (k[1] === "SUCCESS" ? "Mission succeeded: " : "Mission failed: ") + k[2].toLowerCase().replace(/_/g, " ");
    if (m.kind === 6) return "Espionage report";
    return (m.body || "(empty)").split("\n")[0].slice(0, 70);
  }
  function mailBody(root, m) {
    const d = S.details.get(m.id), line = (t) => root.append(h("div", "", t));
    const named = (list, names) => list.map((x) => (x.count !== undefined ? x.count + " × " : "") + (names[x.type] || "type " + x.type)).join(", ");
    if (m.from) line("From: " + m.from);
    if (d && d.variant === 4) {
      line((MISSION[d.type] || "Mission " + d.type) + " · level " + d.level + " · at " + d.loc);
      const got = d.resources.filter((r) => r.earned), left = d.resources.filter((r) => r.left);
      line("Earned: " + (got.length ? got.map((r) => fmtNum(r.earned) + " " + (RES[r.type] || r.type).toLowerCase()).join(", ") : "nothing") + (d.credits ? " · " + fmtNum(d.credits) + " credits" : "") + (d.xp ? " · " + fmtNum(d.xp) + " XP" : ""));
      if (left.length) line("Left behind (no cargo space): " + left.map((r) => fmtNum(r.left) + " " + (RES[r.type] || r.type).toLowerCase()).join(", "));
      if (d.ships.length) line("Ships back: " + named(d.ships, SHIP));
      if (d.items.length) line("Items found: " + d.items.map((x) => x.count + " × item " + x.type).join(", "));
    } else if (d && d.variant === 6) {
      line("Target: " + (d.target || "?") + " · planet " + d.planet);
      if (d.resources.length) line("Resources: " + d.resources.map((r) => fmtNum(r.amount) + " " + (RES[r.type] || r.type).toLowerCase()).join(", "));
      if (d.ships.length) line("Fleet: " + named(d.ships, SHIP));
      if (d.structures.length) line("Buildings: " + d.structures.map((x) => (STRUCT[x.type] || "type " + x.type) + " " + x.level).join(", "));
    } else if (m.kind === 3 || (d && d.variant === 3)) {
      line(m.body || "Battle report");
      if (d && d.variant === 3) {   // the faithful view is on the Original look tab (Messages); here a summary
        const tot = (ph, k) => { const o = {}; for (const pt of ph[k]) for (const q of pt.ships) o[q.type] = (o[q.type] || 0) + q.count; return Object.entries(o).filter(([, n]) => n).map(([type, count]) => ({ type: +type, count })); };
        const nm = (k) => d.before[k].map((x) => x.player.name).join(", ") || "?";
        for (const [k, label] of [["att", "Attacker"], ["def", "Defender"]]) line(label + " " + nm(k) + ": " + (named(tot(d.before, k), SHIP) || "no ships") + " → " + (named(tot(d.after, k), SHIP) || "none"));
        if (d.ground) line("Ground battle: attacker " + d.ground.before.att.reduce((s, x) => s + x.marines, 0) + " → " + d.ground.after.att.reduce((s, x) => s + x.marines, 0) + " troops, defender " + d.ground.before.def.reduce((s, x) => s + x.marines, 0) + " → " + d.ground.after.def.reduce((s, x) => s + x.marines, 0));
      } else line("(No details for this battle report.)");
    } else if (d && d.text) line(d.text);
    else line(m.body || (S.details.has(m.id) ? "(no text)" : "loading…"));
  }

  function log(msg, bad) {
    const li = document.createElement("li");
    if (bad) li.className = "bad";
    li.textContent = new Date().toLocaleTimeString("en-GB") + "  " + msg;
    const ul = $("log");
    ul.prepend(li);
    while (ul.children.length > 60) ul.lastChild.remove();
  }

  function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  // tooltip in the game's own words (help.js; the texts come from the relay's /relay/loca, nothing is computed here); returns the element
  function tipped(e, kind, id, subs) { const t = window.GoFAHelp ? window.GoFAHelp.tip(kind, id, subs) : ""; if (t) e.title = t; return e; }

  function planetLabel(id) { return S.order.includes(id) ? planetName(id) : String(id); }
  // ---- colonies: names, the overview data from the server, switching, demolishing / giving a planet up --------------------------
  const planetType = (t) => (t >= 7 ? "citadel planet (" + ["", "", "", "", "", "", "", "blue", "red", "yellow"][t] + ")" : "type " + t + " planet");
  function planetName(id) {
    const c = S.colonies && S.colonies.get(id);
    if (id === S.order[0]) return "Home planet";
    return (S.jumpgate && S.jumpgate.planet === id ? "Start planet · " : "Colony · ") + (c && c.system_name ? c.system_name + " " + c.number : id);
  }
  function loadColonies() {   // /debug/quote?colonies=1: map facts (system, type, quality) and the rules the page must not compute (HQ / defence / raid levels, planet limit)
    if (!S.me || !S.order.length) return Promise.resolve();
    return fetch("/debug/quote?planet=" + S.order[0] + "&colonies=1&player=" + me16()).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((q) => {
      if (!q || q.error || !q.planets) return;
      S.colonies = new Map(q.planets.map((r) => [r.id, r])); S.coloniesMeta = q;
      const sig = JSON.stringify([q.planets, q.outer, q.outer_limit]);
      if (sig !== S.coloniesSig) { S.coloniesSig = sig; S.shown = ""; render.all(); }
    });
  }
  function planetNotes(p) {   // short status line under a planet's name: builds, production, full stores
    if (!p) return { text: "", bad: false };
    const parts = [], now = nowSrv();
    if (p.builds.length) parts.push(p.builds.length + (p.builds.length === 1 ? " build" : " builds"));
    const jobs = p.shipJobs.length + p.carrierJobs.length + p.droneJobs.length + p.troopJobs.length;
    if (jobs) parts.push(jobs + " in production");
    const full = p.resources.some((r) => r.type <= 3 && r.cap > 0 && Math.max(r.amount, Math.min(r.cap, r.amount + r.perDay / 86400 * Math.max(0, now - r.ts))) >= r.cap - 0.5);
    if (full) parts.push("stores full");
    return { text: parts.join(" · "), bad: full };
  }
  async function switchPlanet(id, view) {
    if (!S.order.includes(id)) return;
    S.selected = id; S.shown = "";
    if (view || S.colonyView) showView(view || "planet");
    render.all();
    await refreshPlanets();
  }
  function showView(view) {   // "planet" | "colonies" | "galaxy" | "help"
    S.colonyView = view === "colonies";
    $("planet").hidden = view !== "planet"; $("colonies").hidden = view !== "colonies"; $("galaxy").hidden = view !== "galaxy"; $("help").hidden = view !== "help";
    for (const [v, id] of [["planet", "tabPlanet"], ["colonies", "tabColonies"], ["galaxy", "tabGalaxy"], ["help", "tabHelp"]]) $(id).classList.toggle("on", view === v);
    if (view === "galaxy" && window.GoFAGalaxy) { window.GoFAGalaxy.init(); window.GoFAGalaxy.resize(); }
    if (view === "help" && window.GoFAHelp) window.GoFAHelp.render($("help"));
    if (view === "colonies") { render.colonies(); loadColonies(); refreshPlanets(S.order).catch(() => {}); }
  }
  // DEMOLISH = request 200 with target level 0 (the whole building goes, half the build time, part of the cost comes back); demolishing a colony's Headquarters
  // gives the planet up. The numbers and the refusal (the home planet's HQ) come from /debug/quote?demolish=SLOT, never from the page.
  async function demolishBuilding(p, s) {
    const r = await fetch("/debug/quote?planet=" + p.id + "&demolish=" + s.slot + "&player=" + me16());
    const q = r.ok ? await r.json() : null;
    if (!q || q.error) throw new Error("could not ask the server about the demolition");
    const name = STRUCT[s.type] || "building " + s.type, where = planetName(p.id);
    if (!q.building) throw new Error("nothing to demolish in slot " + s.slot);
    if (q.busy) throw new Error("the " + name + " is being built or demolished: wait until it is done");
    if (q.refused) throw new Error("the Headquarters of the home planet cannot be demolished");
    const back = q.refund.map((n, i) => fmtNum(n) + " " + RES[i + 1].toLowerCase()).join(", ");
    const text = q.hq
      ? "GIVE UP " + where + "?\nDemolishing the Headquarters takes " + fmtDur(q.seconds) + ". Then the planet is free again: its buildings, stores and ships there are gone for good."
        + (q.carriers_here ? (q.carriers_here === 1 ? " The carrier parked there flies home." : " The " + q.carriers_here + " carriers parked there fly home.") : "") + (q.gate ? " This is your start planet: the jumpgate moves to another outer planet." : "")
      : "Demolish the " + name + " (level " + s.level + ") on " + where + "?\nIt takes " + fmtDur(q.seconds) + " and returns " + back + ". The whole building goes, not one level.";
    if (!confirm(text)) return;
    log((q.hq ? "give up " : "demolish ") + (q.hq ? where : name + " on " + where));
    await call([[200, W.concat([W.v(1, p.id), W.ld(2, W.concat([W.v(1, s.type), W.v(2, s.slot), W.v(3, 0)]))])]]);
    await refreshAccount(); await refreshPlanets([p.id]);
  }
  function renderFleet(frag, home) {
    frag.append(h("h3", "", "Fleet"));
    frag.append(h("p", "muted small", "Carriers carry ships and cargo. Loading sets what is aboard (ships and cargo go back to the planet the carrier is at); Relocate moves it, Deliver also unloads its cargo at an own planet."));
    for (const c of home.carriers) {
      const here = S.order.includes(c.at) ? S.planets.get(c.at) : null;   // ships load from / unload to the own planet the carrier is at (server handle_110)
      const onHome = Object.fromEntries((here ? here.ships : []).map((x) => [x.type, x.count]));
      const card = h("div", "slot fleet");
      const busy = !!(c.travel || c.move);
      const title = h("div", "name", "#" + c.id + " · " + carrierName(c.type) + " · level " + c.level);
      tipped(title, "carrier", c.type); card.append(title);
      const st = h("div", "muted");
      if (c.travel) { st.append("on a mission, back in "); const t = h("span", "timer"); t.dataset.end = c.travel.end; st.append(t); }
      else if (c.move) { st.append("flying to " + planetLabel(c.move.target) + ", arrives in "); const t = h("span", "timer"); t.dataset.end = c.move.end; st.append(t); }
      else st.append("at " + planetLabel(c.at));
      card.append(st);
      card.append(h("div", "small", "Ships: " + (c.ships.length ? c.ships.map((x) => x.count + " × " + (SHIP[x.type] || x.type)).join(", ") : "none")));
      const cargoLine = h("div", "small", "Cargo: …"); card.append(cargoLine);
      const inputs = { ships: {}, cargo: {} };
      let capacity = null, perShip = null, aboardNow = 0;
      quoteMove(c.id, c.at || home.id).then((q) => {
        if (!q) { cargoLine.textContent = "Cargo: (not available on this server)"; return; }
        capacity = q.capacity; perShip = q.per_ship || null; aboardNow = Object.values(q.cargo).reduce((a, n) => a + n, 0); if (card.checkSpace) card.checkSpace();
        const have = Object.entries(q.cargo).filter(([, n]) => n);
        cargoLine.textContent = "Cargo: " + (have.length ? have.map(([t, n]) => fmtNum(n) + " " + (RES[t] || t).toLowerCase()).join(", ") : "empty") + " (space for " + fmtNum(q.capacity) + ")";
        for (const [t, n] of Object.entries(q.cargo)) if (inputs.cargo[t]) inputs.cargo[t].value = String(n);
      });
      if (!busy && !here) card.append(h("div", "muted small", "Loading and unloading only work at one of your planets: relocate the carrier to one first."));
      if (!busy && here) {
        const aboard = Object.fromEntries(c.ships.map((x) => [x.type, x.count]));
        const atHome = true;
        const form = h("div", "loader");
        for (const t of [...new Set([...(atHome ? Object.keys(onHome) : []), ...Object.keys(aboard)])]) {
          const lab = h("label", "small", (SHIP[t] || "type " + t) + " (max " + ((atHome ? onHome[t] || 0 : 0) + (aboard[t] || 0)) + ")");
          const inp = h("input"); inp.type = "number"; inp.min = "0"; inp.value = String(aboard[t] || 0); inputs.ships[t] = inp; lab.append(inp); form.append(lab);
        }
        for (const t of [1, 2, 3, 4]) {
          const lab = h("label", "small", RES[t] + " aboard"); const inp = h("input"); inp.type = "number"; inp.min = "0"; inp.value = "0"; inputs.cargo[t] = inp; lab.append(inp); form.append(lab);
        }
        const load = h("button", "act", "Load");
        const num = (i) => Math.max(0, parseInt(i.value, 10) || 0);
        const spaceNote = h("span", "muted small");   // the server loads any amount; the native client checks the space, so the page does
        const checkSpace = () => {
          // the space of the NEW loadout (one freighter's space from the server's quote); keeping or lowering what is aboard is always allowed
          const cap = perShip ? Object.entries(inputs.ships).reduce((a, [t, i]) => a + num(i) * (perShip[t] || 0), 0) : capacity;
          const total = Object.values(inputs.cargo).reduce((a, i) => a + num(i), 0), over = cap != null && total > cap && total > aboardNow;
          load.disabled = !!load.dataset.busy || over; load.title = over ? "more than the carrier can hold" : ""; spaceNote.textContent = over ? "over the cargo space (" + fmtNum(cap) + ")" : ""; spaceNote.className = "small" + (over ? " cost bad" : " muted");
        };
        for (const i of [...Object.values(inputs.cargo), ...Object.values(inputs.ships)]) i.oninput = checkSpace;
        card.checkSpace = checkSpace;
        load.onclick = () => run(load, () => simpleOrder("load carrier #" + c.id, [[110, W.concat([W.v(1, c.id),
          W.ld(2, W.concat(Object.entries(inputs.ships).filter(([, i]) => num(i) > 0).map(([t, i]) => W.ld(1, W.concat([W.v(1, Number(t)), W.v(2, num(i))]))))),
          W.ld(3, W.concat(Object.entries(inputs.cargo).filter(([, i]) => num(i) > 0).map(([t, i]) => W.ld(1, W.concat([W.v(1, Number(t)), W.v(2, num(i))])))))])]]));
        form.append(load, spaceNote); card.append(form); checkSpace();
        // move
        const mv = h("div", "loader");
        const dest = h("select"); for (const id of S.order) { if (id === c.at) continue; const o = h("option", "", planetLabel(id)); o.value = id; dest.append(o); }
        const ord = h("select"); for (const [k, v] of Object.entries(ORDERS)) { const o = h("option", "", v); o.value = k; ord.append(o); }
        const eta = h("span", "muted small");
        const upd = () => { eta.textContent = ""; if (dest.value) quoteMove(c.id, Number(dest.value)).then((q) => { if (q) eta.textContent = "trip " + fmtDur(q.seconds); }); };
        dest.onchange = upd;
        const go = h("button", "act", "Go");
        go.onclick = () => run(go, () => simpleOrder(ORDERS[ord.value].toLowerCase() + " carrier #" + c.id + " to " + planetLabel(Number(dest.value)),
          [[203, W.concat([W.v(1, c.id), W.v(2, Number(ord.value)), W.v(3, Number(dest.value)), W.dbl(5, 1.0)])]]));
        if (dest.options.length) { mv.append(ord, dest, eta, go); upd(); card.append(mv); } else card.append(h("div", "muted small", "No other planet to fly to yet."));
      }
      frag.append(card);
    }
  }

  // jumpgate: the first use opens the outer galaxy and gives a start planet (241 with an empty request; the reply carries 242 and the planet list). The server keeps it
  // closed (9241 + a mail) until the home-system tutorial is done; what is left, the planet count and the limit come from /debug/quote?jumpgate=1 (read-only)
  function renderGate(frag) {
    frag.append(h("h3", "", "Jumpgate"));
    const info = h("p", "muted small", "asking the server …"), row = h("div", "loader"), btn = h("button", "act", "Open the jumpgate");
    const start = S.jumpgate && S.jumpgate.planet;
    btn.onclick = start
      ? async () => { S.selected = start; S.shown = ""; render.planets(); render.planet(); await refreshPlanets(); }
      : () => run(btn, async () => { log("open the jumpgate"); await call([[241, new Uint8Array(0)]]); await refreshAccount(); });
    if (start) btn.textContent = "Go to the start planet";
    row.append(btn); frag.append(info, row);
    fetch("/debug/quote?planet=" + S.order[0] + "&jumpgate=1&player=" + me16()).then((r) => (r.ok ? r.json() : null)).then((q) => (q && !q.error ? q : null)).catch(() => null).then((q) => {
      const lim = q ? " Planets outside the home system: " + q.outer + " of " + q.outer_limit + " (the commander level, the Governance skill and planet extenders raise the limit)." : "";
      if (start) info.textContent = "Open: your start planet is " + start + "." + lim + " Carriers fly there from the Fleet section (Relocate); more planets are colonised from the Galaxy map.";
      else if (q && q.locked) {
        info.textContent = "Closed until the home-system tutorial is done. Still to do: " + q.left.map((x) => x.text).join(", ") + ".";
        btn.dataset.why = "tutorial not finished"; btn.disabled = true; btn.title = "tutorial not finished";
      } else if (q) info.textContent = "Ready. Opening the jumpgate gives you a start planet in the outer galaxy" + (q.random ? " (a random free planet)" : "") + "; the other planets of the galaxy open up from there." + lim;
      else info.textContent = "Not opened yet. Opening the jumpgate gives you a start planet in the outer galaxy; the server refuses while the home-system tutorial is not done.";
    });
  }

  // ---- tutorial missions: the 12 home missions that open the jumpgate (gate = true) and the later ones. Status comes from the read-only /debug/quote?tutorial=1
  // (id, done, claimed, gate, reward); GET REWARD is request 282 {1 mission id}. The hints are own words: where to click for each step.
  const TUT = {
    2: ["Build a metal extractor", "Buildings: choose an empty slot, pick Metal extractor, Build."],
    3: ["Upgrade the HQ to level 2", "Buildings: Headquarters, Upgrade to 2."],
    4: ["Upgrade a metal extractor to level 2", "Buildings: the finished Metal extractor, Upgrade to 2."],
    5: ["Build a shipyard", "Buildings: an empty slot, pick Shipyard, Build."],
    8: ["Build ships", "Shipyard section: choose a ship, Build (the shipyard must be finished)."],
    6: ["Build a carrier", "Shipyard section, Carriers: Carrier Mk I, Build (about 24 minutes: Speed up skips the wait)."],
    16: ["Build a scanner", "Buildings: an empty slot, pick Scanner, Build."],
    17: ["Build spy drones", "Scanner section: build spy drones."],
    23: ["Send a mission", "Scanner section: build spy drones, run a Quick scan, Collect it. Fleet section: load a ship onto a carrier. Then press Send on one of the missions."],
    24: ["Get a mission report", "Wait until the carrier is back: the report arrives in the Mail box."],
    19: ["Build barracks", "Buildings: an empty slot, pick Barracks, Build."],
    20: ["Train troops", "Barracks section: train troops."],
    26: ["Build a research lab", "Buildings: an empty slot, pick Laboratory, Build."],
    28: ["Research a technology", "Research section: start any technology (needs the finished laboratory)."],
    37: ["Learn a skill", "Commander card: spend a skill point with Learn."],
    42: ["Open the jumpgate", "Jumpgate card: Open the jumpgate (only after the 12 home missions)."],
    10: ["Colonise a planet", "Galaxy map: choose a free planet, Colonise."],
    29: ["Build a trade centre", "Buildings: an empty slot, pick Trade centre, Build."],
    30: ["Trade resources", "Trade centre section: exchange resources."],
    11: ["Load a carrier with cargo", "Fleet section: load resources onto a carrier."],
    12: ["Deliver cargo", "Fleet section: Deliver to another planet of yours."],
    21: ["Load a carrier with troops", "Fleet section: load troops onto a carrier."],
    51: ["Jump through the gate", "Use the jumpgate once."],
    49: ["Reach commander level 20", "Earn XP from missions, battles and rewards."],
    14: ["Win a battle", "Galaxy map: attack a pirate planet with a carrier."],
    18: ["Spy on a planet", "Galaxy map: send spy drones to another planet."],
  };
  const tutRewardText = (rw, mult) => [rw.credits && fmtNum(rw.credits) + " credits", rw.xp && fmtNum(rw.xp * (mult || 1)) + " XP" + (mult > 1 ? " (double XP item)" : ""),
    ...Object.entries(rw.res || {}).map(([t, n]) => fmtNum(n) + " " + (RES[t] || "res " + t).toLowerCase()), ...Object.entries(rw.ships || {}).map(([t, n]) => n + " × " + (SHIP[t] || "ship " + t))].filter(Boolean).join(", ");
  async function loadTutorial() {
    if (!S.me) return;
    const q = await quoteJson("planet=" + S.order[0] + "&tutorial=1"); if (!q) return;
    const sig = JSON.stringify(q.map((x) => [x.id, x.done, x.claimed]));
    if (sig === S.tutSig) return;
    const before = S.tutSig; S.tutSig = sig; S.tut = q; render.tutorial();
    if (before) { S.shown = ""; render.all(); }   // the jumpgate card lists what is left: draw it again
  }
  async function collectTutorial(id) {
    const t = (S.tut || []).find((x) => x.id === id); log("tutorial: collect the reward of \"" + (TUT[id] || ["mission " + id])[0] + "\"" + (t ? " (" + tutRewardText(t.reward, t.xp_mult) + ")" : ""));
    await call([[282, W.v(1, id)]]); await refreshAccount(); S.tutSig = ""; await loadTutorial();
  }
  function tutRow(x, now) {
    const li = h("li", x.claimed ? "claimed" : x.done ? "ready" : now ? "now" : ""), nm = TUT[x.id] || ["Mission " + x.id, ""];
    li.append(h("span", "mark", x.claimed ? "✓" : x.done ? "!" : "○"));
    const box = h("div"); box.append(h("div", "tname", nm[0]), h("div", "muted small", "reward: " + (tutRewardText(x.reward, x.xp_mult) || "none")));
    if (!x.done && !x.claimed && (now || x.gate)) box.append(h("div", "small", nm[1]));
    li.append(box);
    if (x.done && !x.claimed) { const b = h("button", "act", "Collect reward"); b.onclick = () => run(b, () => collectTutorial(x.id)); li.append(b); } else li.append(h("span"));
    return li;
  }
  // speed-up (request 501 {1 job id}): the price comes from /debug/quote?speedup=JOBID (the same lookup the server charges with); the button sits next to a running job's timer
  function speedBtn(job, host) {
    if (!job || !job.id || job.end <= nowSrv()) return;   // finished jobs only wait for the next refresh
    const b = h("button", "act small", "Speed up"); b.disabled = true; host.append(" ", b);
    const price = () => quoteJson("planet=" + S.order[0] + "&speedup=" + job.id).then((q) => {
      if (!q || !b.isConnected) return;
      if (q.left <= 0) { b.remove(); return; }
      b.textContent = "Speed up: " + fmtNum(q.price) + " credit" + (q.price === 1 ? "" : "s"); b.disabled = q.price > q.credits; b.title = b.disabled ? "needs " + fmtNum(q.price) + " credits" : "finish this job now";
    });
    price(); b.onclick = () => run(b, async () => { log("speed up job " + job.id); await call([[501, W.v(1, job.id)]]); await refreshAccount(); await refreshPlanets(S.order); S.shown = ""; render.all(); });
  }
  const tutOpen = new Set();
  function renderTutorial() {
    const box = $("tutorial"); if (!box) return;
    const q = S.tut || []; if (!q.length) { box.textContent = "The server has no tutorial missions for this game."; $("tutn").textContent = ""; return; }
    const gate = q.filter((x) => x.gate), later = q.filter((x) => !x.gate), left = gate.filter((x) => !x.done && !x.claimed), cl = gate.filter((x) => x.claimed).length;
    const frag = document.createDocumentFragment(), nextId = (left[0] || {}).id;
    $("tutn").textContent = gate.length ? cl + " of " + gate.length + " collected" : "";
    if (gate.length) {
      const bar = h("div", "bar"), fill = h("i"); fill.style.width = (100 * (gate.length - left.length) / gate.length) + "%"; bar.append(fill); frag.append(bar);
      frag.append(h("div", "muted small", "Builds and orders take real time: the Speed up button next to a timer finishes it for credits."));
      frag.append(h("div", "small", left.length ? "Home missions left before the jumpgate opens: " + left.length + ". Next: " + (TUT[nextId] || ["mission " + nextId])[0] + "." : "All 12 home missions are done: the jumpgate can be opened."));
      const ul = h("ul", "tut"); for (const x of gate) ul.append(tutRow(x, x.id === nextId)); frag.append(ul);
    }
    if (later.length) {
      const d = document.createElement("details"); d.open = tutOpen.has("later"); d.ontoggle = () => (d.open ? tutOpen.add("later") : tutOpen.delete("later"));
      d.append(h("summary", "small", "More missions (" + later.filter((x) => x.claimed).length + " of " + later.length + " collected)"));
      const ul = h("ul", "tut"); for (const x of later) ul.append(tutRow(x, false)); d.append(ul); frag.append(d);
    }
    box.className = ""; box.textContent = ""; box.append(frag);
  }

  const render = {
    busy() { $("busy").hidden = !S.busy; },
    tutorial: renderTutorial,
    all() {
      render.header(); render.planets(); render.colonies(); render.commander(); render.items(); render.mail(); if (window.GoFAGalaxy && window.GoFAGalaxy.inited) window.GoFAGalaxy.draw();
      const p = S.planets.get(S.selected);
      const sig = p ? signature(p) : "";
      if (sig !== S.shown) { S.shown = sig; render.planet(); } else render.resources(p);
    },
    commander() {
      const box = $("commander"); if (!box) return;
      const sig = JSON.stringify([S.xp, S.skillPoints, [...S.skills], S.lv && S.lv.level]);
      if (sig === S.skillsShown) return; S.skillsShown = sig;
      const frag = document.createDocumentFragment(), L = S.lv && S.lv.xp === S.xp ? S.lv : null;
      frag.append(h("div", "name", S.alias + (L ? " · level " + L.level : "")));
      if (L) {
        const bar = h("div", "bar"), fill = h("i"); fill.style.width = Math.min(100, 100 * (S.xp - L.xp_level) / Math.max(1, L.xp_next - L.xp_level)) + "%"; bar.append(fill); frag.append(bar);
        frag.append(h("div", "muted small", fmtNum(S.xp) + " / " + fmtNum(L.xp_next) + " XP for level " + (L.level + 1) + " · skill points: " + (S.skillPoints || 0)));
      } else frag.append(h("div", "muted small", fmtNum(S.xp || 0) + " XP · skill points: " + (S.skillPoints || 0)));
      const list = h("div", "skills");
      for (const id of SKILL_ORDER) {
        const cur = S.skills.get(id) || 0, info = SKILLS[id] || ["Skill " + id, "effect not known yet"];
        const row = tipped(h("div", "skill"), "skill", id), nm = h("div"); nm.append(h("div", "name", info[0] + " · " + cur), h("div", "muted small", info[1])); row.append(nm);
        const note = h("div", "muted small cost"); row.append(note);
        const btn = h("button", "act", "Learn " + (cur + 1)); row.append(btn);
        getJson("/debug/quote?planet=" + S.order[0] + "&skill=" + id + "&level=" + (cur + 1) + "&player=" + me16()).then((q) => {
          if (!q) return;
          const why = cur + 1 > q.max_level ? "maximum level" : (S.skillPoints || 0) < q.cost ? "needs " + q.cost + " skill point" + (q.cost > 1 ? "s" : "") : "";
          note.textContent = "level " + (cur + 1) + ": " + q.cost + " point" + (q.cost > 1 ? "s" : "") + (why ? " — " + why : ""); note.classList.toggle("bad", !!why); btn.disabled = !!why; btn.title = why;
        });
        btn.onclick = () => run(btn, async () => { log("learn " + info[0] + " level " + (cur + 1)); await call([[212, W.concat([W.v(1, id), W.v(2, cur + 1)])]]); await refreshAccount(); });
        list.append(row);
      }
      frag.append(list); box.replaceChildren(frag);
    },
    items() {   // the inventory (272): amount owned, what an item does, the price and a Buy button (278); prices from the server (/debug/quote?itemlist=1, sandbox only)
      const box = $("items"); if (!box) return;
      if (!S.itemQAsked && S.order.length) {
        S.itemQAsked = true;
        getJson("/debug/quote?planet=" + S.order[0] + "&itemlist=1&player=" + me16()).then((q) => { S.itemQ = q; S.itemsShown = ""; render.items(); });
      }
      const sig = JSON.stringify([S.inventory ? [...S.inventory] : null, S.credits, !!S.itemQ]);
      if (sig === S.itemsShown) return; S.itemsShown = sig;
      const frag = document.createDocumentFragment(), Q = S.itemQ ? S.itemQ.items : null;
      if (!S.inventory) { frag.append(h("p", "muted small", "asking the server …")); box.replaceChildren(frag); return; }
      frag.append(h("p", "muted small", "Buying adds the item at once and costs credits (" + fmtNum(S.credits || 0) + " in stock)." + (Q ? "" : " Prices are not available on this server.")));
      S.itemQty = S.itemQty || {};
      for (const t of ITEM_ORDER) {
        const q = Q ? Q[t] : null, own = S.inventory.get(t) || 0, row = tipped(h("div", "item"), "item", t, q && q.adds ? { AMOUNT: q.adds } : null);
        const info = h("div", "muted small cost", itemText(t, q) + (q ? " · " + fmtNum(q.price) + " credit" + (q.price === 1 ? "" : "s") + " each" : ""));
        const nm = h("div", "name", ITEM[t] + " · " + fmtNum(own)); row.append(nm);
        if (!q) row.append(info);
        else {
          const inp = h("input"); inp.type = "number"; inp.min = "1"; inp.max = "999"; inp.value = String(S.itemQty[t] || 1);
          const btn = h("button", "act", "Buy");
          const upd = () => {
            const n = Math.max(1, Math.min(999, parseInt(inp.value, 10) || 1)), cost = n * q.price; S.itemQty[t] = n;
            const why = !q.buy ? "not for sale: carrier blueprints are only found on missions" : (S.credits || 0) < cost ? "needs " + fmtNum(cost) + " credits" : "";
            btn.disabled = !!btn.dataset.busy || !!why; btn.title = why; info.classList.toggle("bad", !!why);
            info.textContent = (why ? why + " · " : "") + itemText(t, q) + (q.buy ? " · " + fmtNum(q.price) + " credit" + (q.price === 1 ? "" : "s") + " each" : "");
          };
          inp.oninput = upd; upd();
          btn.onclick = () => run(btn, () => { const n = Math.max(1, Math.min(999, parseInt(inp.value, 10) || 1)); return simpleOrder("buy " + n + " × " + ITEM[t], [[278, W.concat([W.v(1, t), W.v(2, n)])]]); });
          row.append(inp, btn, info);
        }
        frag.append(row);
      }
      box.replaceChildren(frag);
    },
    mail() {
      const ul = $("mail"); if (!ul) return;
      const all = [...S.mail.values()].sort((a, b) => b.time - a.time);
      $("mailn").textContent = all.length ? "(" + all.length + ")" : "";
      const sig = JSON.stringify([all.map((m) => m.id), [...S.openMail], [...S.details.keys()]]);
      if (sig === S.mailShown) return; S.mailShown = sig;
      ul.replaceChildren();
      if (!all.length) ul.append(h("li", "muted small", "No mail yet."));
      for (const m of all.slice(0, 40)) {
        const li = h("li", "mailrow"), head = h("div", "mailhead");
        head.append(h("span", "tag", MAILKIND[m.kind] || "Mail " + m.kind), h("span", "grow", mailTitle(m)), h("span", "muted small", new Date(m.time * 1000).toLocaleTimeString("en-GB")));
        head.onclick = async () => {
          if (S.openMail.has(m.id)) S.openMail.delete(m.id); else { S.openMail.add(m.id); if (!S.details.has(m.id) && m.kind !== 1) { try { await call([[105, W.v(1, m.id)]]); } catch (e) { log(e.message, true); } } }
          S.mailShown = ""; render.mail();
        };
        li.append(head);
        if (S.openMail.has(m.id)) {
          const body = h("div", "mailbody"); mailBody(body, m);
          const del = h("button", "", "Delete");
          del.onclick = () => run(del, async () => { await call([[117, W.v(1, m.id)]]); S.mail.delete(m.id); S.openMail.delete(m.id); S.mailShown = ""; render.mail(); });
          body.append(del); li.append(body);
        }
        ul.append(li);
      }
    },
    resources(p) {   // same layout, new base values from the server: update the counters in place
      if (!p) return;
      for (const r of p.resources) {
        for (const e of document.querySelectorAll('[data-rtype="' + r.type + '"]')) e.dataset[e.dataset.kind] = [r.type, r.amount, r.perDay, r.cap, r.ts].join(",");
      }
    },
    header() {
      $("who").textContent = S.me ? S.alias : "";
      $("lvl").textContent = S.xp == null ? "" : (S.lv && S.lv.xp === S.xp ? "level " + S.lv.level + " · " : "") + fmtNum(S.xp) + " XP";
      $("cred").textContent = S.credits == null ? "" : fmtNum(S.credits) + " credits";
      $("sp").textContent = S.skillPoints ? S.skillPoints + " skill points" : "";
    },
    planets() {
      const ul = $("planets");
      ul.replaceChildren();
      S.order.forEach((id) => {
        const li = h("li"), n = planetNotes(S.planets.get(id));
        const b = h("button", id === S.selected ? "pick on" : "pick");
        b.append(h("div", "", planetName(id)));
        if (n.text) b.append(h("div", "sub" + (n.bad ? " bad" : ""), n.text));
        b.onclick = () => switchPlanet(id);
        li.append(b);
        ul.append(li);
      });
    },
    colonies() {   // the overview of every planet: where it is, what it holds, what is going on; Open switches to its panel
      const root = $("colonies");
      if (!root || root.hidden) return;
      const frag = document.createDocumentFragment(), meta = S.coloniesMeta;
      frag.append(h("p", "colsum muted small", S.order.length + " planets" + (meta ? " · outside the home system: " + meta.outer + " of " + meta.outer_limit + (meta.limit_on ? " allowed (commander level, the Governance skill and planet extenders raise the limit)" : " (limit off)") : "")
        + (meta && meta.raids ? " · pirates raid colonies every " + meta.raid_min / 3600 + " to " + meta.raid_max / 3600 + " hours, at level Headquarters ÷ 2" : "") + " · keys [ and ] switch planets"));
      for (const id of S.order) {
        const p = S.planets.get(id), c = S.colonies && S.colonies.get(id);
        const card = h("div", "colcard" + (id === S.selected ? " on" : ""));
        const head = h("div", "colhead");
        head.append(h("span", "name", planetName(id)), h("span", "muted small", "planet " + id), h("span", "grow"));
        const open = h("button", "act", id === S.selected ? "Open (selected)" : "Open"); open.onclick = () => switchPlanet(id, "planet"); head.append(open);
        const hq = p && p.structures.find((x) => x.type === 1);
        if (id !== S.order[0] && hq) { const g = h("button", "danger", "Give up…"); g.title = "demolish the Headquarters: the planet is free again"; g.onclick = () => run(g, () => demolishBuilding(p, hq)); head.append(g); }
        card.append(head);
        if (c) card.append(h("div", "muted small", planetType(c.type) + " · quality " + c.quality + " · Headquarters level " + c.hq + " · defence buildings level " + c.defence_level + (c.raid_level ? " · pirate raid level " + c.raid_level : "")));
        if (!p || !p.resources.length) { card.append(h("div", "muted small", "loading …")); frag.append(card); continue; }
        const rs = h("div", "res");
        for (const r of p.resources.filter((r) => r.type <= 3)) {
          const box = h("div", "r"), base = [r.type, r.amount, r.perDay, r.cap, r.ts].join(",");
          tipped(box, "res", r.type).append(h("div", "k", RES[r.type] || "res " + r.type));
          const v = h("div", "v"); v.dataset.res = base; box.append(v);
          const bar = h("div", "bar"), fill = h("i"); fill.dataset.bar = base; bar.append(fill); box.append(bar);
          box.append(h("div", "muted small", "+" + fmtNum(r.perDay / 24) + " / h"));
          rs.append(box);
        }
        for (const r of p.resources.filter((r) => r.type > 3 && r.amount)) { const box = h("div", "r"); tipped(box, "res", r.type).append(h("div", "k", RES[r.type] || "res " + r.type), h("div", "v", fmtNum(r.amount))); rs.append(box); }
        card.append(rs);
        const act = h("div", "actrow");
        const line = (text, end) => { const d = h("div", "", text); if (end) { const t = h("span", "timer"); t.dataset.end = end; d.append(t); } act.append(d); };
        for (const b of p.builds) line((b.level === 0 ? "Demolishing " : "Building ") + (STRUCT[b.type] || "type " + b.type) + (b.level ? " → level " + b.level : "") + ": ", b.end);
        for (const j of p.shipJobs) line(j.count + " × " + (SHIP[j.ship] || "ship " + j.ship) + " ready in ", j.end);
        for (const j of p.carrierJobs) line(j.count + " × " + (CARRIER[j.type] || "carrier " + j.type) + " ready in ", j.end);
        for (const j of p.droneJobs) line(j.count + " spy drones ready in ", j.end);
        for (const j of p.troopJobs) line(j.count + " troops ready in ", j.end);
        for (const j of p.scans) line((j.range ? "Deep" : "Quick") + " scan running: ", j.end);
        for (const j of p.digJobs) line("Artifact dig running: ", j.end);
        if (id === S.order[0]) for (const j of p.research) line("Research " + (TECH[j.tech] ? TECH[j.tech][0] : "tech " + j.tech) + " → level " + j.level + ": ", j.end);
        if (!act.children.length) line("Nothing is being built or produced here.");
        if (p.ships.length) line("Ships on the planet: " + p.ships.map((x) => x.count + " × " + (SHIP[x.type] || "type " + x.type)).join(", "));
        const cs = carriersAt(id);
        if (cs.length) line("Carriers here: " + cs.map((x) => "#" + x.id + " (" + carrierName(x.type) + (x.travel ? ", on a mission" : x.move ? ", moving" : "") + ")").join(", "));
        card.append(act);
        frag.append(card);
      }
      root.replaceChildren(frag);
      tick();
    },
    planet() {
      const p = S.planets.get(S.selected);
      const root = $("planet");
      if (!p) { root.replaceChildren(h("p", "muted", "No planet selected.")); return; }
      const frag = document.createDocumentFragment();
      frag.append(h("h2", "", planetName(p.id)));
      { const c = S.colonies && S.colonies.get(p.id); frag.append(h("p", "muted small", "Planet " + p.id + (c ? " · " + planetType(c.type) + " · quality " + c.quality + (c.raid_level ? " · pirate raid level " + c.raid_level : "") : "") + " · keys [ and ] switch planets")); }
      if (p.owner) frag.append(h("p", "muted", "Owner: " + p.owner.name));
      // resources
      const rs = h("div", "res");
      for (const r of p.resources.filter((r) => r.type <= 3)) {
        const box = h("div", "r");
        tipped(box, "res", r.type).append(h("div", "k", RES[r.type] || "res " + r.type));
        const base = [r.type, r.amount, r.perDay, r.cap, r.ts].join(",");
        const v = h("div", "v"); v.dataset.res = base; v.dataset.rtype = r.type; v.dataset.kind = "res"; box.append(v);
        const bar = h("div", "bar"); const fill = h("i"); fill.dataset.bar = base; fill.dataset.rtype = r.type; fill.dataset.kind = "bar"; bar.append(fill); box.append(bar);
        box.append(h("div", "muted small", "+" + fmtNum(r.perDay / 24) + " / h · cap " + fmtNum(r.cap)));
        rs.append(box);
      }
      for (const r of p.resources.filter((r) => r.type > 3)) {
        const box = h("div", "r"); tipped(box, "res", r.type).append(h("div", "k", RES[r.type] || "res " + r.type)); box.append(h("div", "v", fmtNum(r.amount))); rs.append(box);
      }
      frag.append(rs);
      if (p.id === S.order[0]) renderGate(frag);
      // structures
      frag.append(h("h3", "", "Buildings"));
      const grid = h("div", "slots");
      const bySlot = new Map(p.structures.map((s) => [s.slot, s]));
      const building = new Map(p.builds.map((b) => [b.slot, b]));
      for (let slot = 0; slot < SLOTS; slot++) {
        const s = bySlot.get(slot), b = building.get(slot);
        const card = h("div", "slot" + (s || b ? "" : " empty"));
        if (s || b) {
          const type = (s || b).type;
          tipped(card, "struct", type).append(h("div", "name", STRUCT[type] || "Type " + type));
          card.append(h("div", "muted", s && s.level ? "level " + s.level : "not built yet"));
          if (b) {
            const t = h("div", "timer"); t.dataset.end = b.end; t.dataset.start = b.start; card.append(t); speedBtn(b, card);
            card.append(h("div", "muted small", b.level === 0 ? "being demolished" : "→ level " + b.level));
          } else {
            const btn = h("button", "act", "Upgrade to " + (s.level + 1));
            btn.onclick = () => run(btn, () => buildOrUpgrade(p.id, s.type, slot, s.level + 1));
            const info = h("div", "muted small cost");
            card.append(info, btn);
            attachQuote(btn, info, p, s.type, s.level + 1);
            if (!(s.type === 1 && p.id === S.order[0])) {   // the home planet's Headquarters stays; a colony's gives the planet up
              const dem = h("button", "danger", s.type === 1 ? "Give up this planet…" : "Demolish…");
              dem.onclick = () => run(dem, () => demolishBuilding(p, s));
              card.append(dem);
            }
          }
        } else {
          card.append(h("div", "muted", "slot " + slot + " · empty"));
          const sel = h("select"); for (const [t, n] of Object.entries(STRUCT)) if (t !== "1") { const o = h("option", "", n); o.value = t; sel.append(o); }
          sel.value = String(S.pick[slot] || 2); sel.onchange = () => { S.pick[slot] = Number(sel.value); };
          // the game offers a Citadel only on citadel planets (the server does not check): ask the dig quote what kind of planet this is
          getJson("/debug/quote?planet=" + p.id + "&dig=0&player=" + me16()).then((q) => {
            const o = q && !q.item ? [...sel.options].find((x) => x.value === "11") : null;
            if (o) { const was = sel.value === "11"; o.remove(); if (was) { sel.value = "2"; sel.dispatchEvent(new Event("change")); } }
          });
          const btn = h("button", "act", "Build");
          btn.onclick = () => run(btn, () => buildOrUpgrade(p.id, Number(sel.value), slot, 1));
          const info = h("div", "muted small cost");
          sel.addEventListener("change", () => attachQuote(btn, info, p, Number(sel.value), 1));
          card.append(sel, info, btn);
          attachQuote(btn, info, p, Number(sel.value), 1);
        }
        grid.append(card);
      }
      frag.append(grid);
      // shipyard
      frag.append(h("h3", "", "Shipyard"));
      shipRows.length = 0;
      const yards = p.structures.filter((x) => x.type === 2 && x.level > 0);
      if (!yards.length) frag.append(h("p", "muted", "No shipyard on this planet: build one to produce ships."));
      else {
        let yard = yards.find((y) => y.id === S.yardPick[p.id]) || yards[0];
        if (yards.length > 1) {
          const ys = h("select"); for (const y of yards) { const o = h("option", "", "Shipyard in slot " + y.slot + " (level " + y.level + ")"); o.value = y.id; ys.append(o); }
          ys.value = yard.id; ys.onchange = () => { S.yardPick[p.id] = Number(ys.value); S.shown = ""; render.all(); };
          frag.append(ys);
        } else frag.append(h("p", "muted small", "Shipyard level " + yard.level));
        const list = h("div", "ships");
        for (const type of SHIP_ORDER) {
          const row = h("div", "ship");
          tipped(row, "ship", type).append(h("div", "name", SHIP[type] || "type " + type));
          const info = h("div", "muted small cost"); row.append(info);
          const input = h("input"); input.type = "number"; input.min = "1"; input.max = "9999"; input.value = String(S.shipCount);
          input.oninput = () => { S.shipCount = Math.max(1, parseInt(input.value, 10) || 1); evalShips(); };
          row.append(input);
          const btn = h("button", "act", "Build");
          btn.onclick = () => run(btn, () => orderShips(p.id, yard.id, type, Math.max(1, Math.min(9999, parseInt(input.value, 10) || 1))));
          row.append(btn);
          const entry = { planet: p.id, type, input, info, btn, q: null };
          shipRows.push(entry);
          quoteShip(p.id, type, yard.id, yard.level).then((q) => { if (q) { entry.q = q; evalShips(); } });
          list.append(row);
        }
        frag.append(list);
        carrierRows.length = 0;
        frag.append(h("div", "muted small", "Carriers (the ships fly in them; one level-1 carrier of each kind):"));
        const clist = h("div", "ships");
        for (const type of [1, 5, 9]) {
          const row = h("div", "ship");
          tipped(row, "carrier", type).append(h("div", "name", CARRIER[type]));
          const info = h("div", "muted small cost"); row.append(info);
          const input = h("input"); input.type = "number"; input.min = "1"; input.max = "99"; input.value = "1"; input.oninput = () => evalCarriers(); row.append(input);
          const btn = h("button", "act", "Build");
          btn.onclick = () => run(btn, () => simpleOrder("order " + input.value + " × " + CARRIER[type], [[202, W.concat([W.v(1, yard.id), W.ld(2, W.concat([W.v(1, type), W.v(2, 1), W.v(3, Math.max(1, Math.min(99, parseInt(input.value, 10) || 1)))]))])]]));
          row.append(btn);
          const rec = { planet: p.id, input, info, btn, q: null }; carrierRows.push(rec);
          getJson("/debug/quote?planet=" + p.id + "&carrier=" + type + "&level=1&yard=" + yard.id + "&player=" + me16()).then((q) => { if (q) { rec.q = q; evalCarriers(); } });
          clist.append(row);
        }
        frag.append(clist);
        for (const j of p.carrierJobs) { const li = h("p", "muted small", j.count + " × " + (CARRIER[j.type] || "carrier " + j.type) + " ready in "); const t = h("span", "timer"); t.dataset.end = j.end; li.append(t); speedBtn(j, li); frag.append(li); }
      }
      // research (account-wide; the home planet's record carries the tech list and the jobs)
      techRows.length = 0;
      if (p.id === S.order[0]) {
        frag.append(h("h3", "", "Research"));
        const lab = p.structures.find((x) => x.type === 7 && x.level > 0);
        if (!lab) frag.append(h("p", "muted", "No laboratory: build one to research technologies."));
        else {
          const have = new Map(p.techs.map((t) => [t.tech, t.level])), busy = new Map(p.research.map((j) => [j.tech, j]));
          const used = new Set([...have.keys(), ...busy.keys()]);
          frag.append(h("p", "muted small", "Laboratory level " + lab.level + " · " + used.size + " of 3 laboratory slots in use"));
          const list = h("div", "ships");
          for (const id of TECH_ORDER) {
            const level = have.get(id) || 0, job = busy.get(id);
            const row = h("div", "ship");
            tipped(row, "tech", id); const nm = h("div"); nm.append(h("div", "name", TECH[id][0]), h("div", "muted small", TECH[id][1])); row.append(nm);
            const info = h("div", "muted small cost"); row.append(info);
            row.append(h("div", "", level ? "level " + level : "—"));
            const btn = h("button", "act", job ? "Researching" : level ? "Research to " + (level + 1) : "Research");
            row.append(btn);
            if (job) {
              btn.disabled = true;
              info.append("researching level " + job.level + ": "); const t = h("span", "timer"); t.dataset.end = job.end; info.append(t); speedBtn(job, info);
            } else {
              btn.onclick = () => run(btn, () => orderResearch(lab.id, id, level + 1));
              const entry = { planet: p.id, tech: id, btn, info, q: null };
              techRows.push(entry);
              quoteTech(p.id, id, level + 1, lab.id, lab.level).then((q) => { if (q) { entry.q = q; evalTechs(); } });
            }
            list.append(row);
          }
          frag.append(list);
        }
      }
      // scanner, drones, scans, missions
      scanRows.length = 0; droneRow.length = 0;
      const scanner = p.structures.find((x) => x.type === 8 && x.level > 0);
      if (scanner) {
        frag.append(h("h3", "", "Scanner and missions"));
        const drones = (p.resources.find((r) => r.type === 5) || {}).amount || 0;
        frag.append(h("p", "muted small", "Scanner level " + scanner.level + " · spy drones: " + fmtNum(drones) + " · a scan finds 3 missions of its kind (up to the scanner's level)"));
        // drone production
        const drow = tipped(h("div", "ship"), "res", 5);
        drow.append(h("div", "name", "Spy drones"));
        const dinfo = h("div", "muted small cost"); drow.append(dinfo);
        const dinput = h("input"); dinput.type = "number"; dinput.min = "1"; dinput.max = "9999"; dinput.value = String(S.droneCount);
        dinput.oninput = () => { S.droneCount = Math.max(1, parseInt(dinput.value, 10) || 1); evalScanner(); };
        drow.append(dinput);
        const dbtn = h("button", "act", "Build");
        dbtn.onclick = () => run(dbtn, () => simpleOrder("order " + dinput.value + " spy drones", [[211, W.concat([W.v(1, scanner.id), W.v(2, Math.max(1, Math.min(9999, parseInt(dinput.value, 10) || 1)))])]]));
        drow.append(dbtn);
        const drec = { planet: p.id, input: dinput, info: dinfo, btn: dbtn, q: null }; droneRow.push(drec);
        getJson("/debug/quote?planet=" + p.id + "&unit=drone&yard=" + scanner.id + "&player=" + me16()).then((q) => { if (q) { drec.q = q; evalScanner(); } });
        frag.append(drow);
        for (const j of p.droneJobs) { const li = h("p", "muted small", j.count + " spy drones ready in "); const t = h("span", "timer"); t.dataset.end = j.end; li.append(t); speedBtn(j, li); frag.append(li); }
        // scans
        for (const [range, name] of [[0, "Quick scan"], [1, "Deep scan"]]) {
          const row = tipped(h("div", "ship"), "scan", range);
          row.append(h("div", "name", name));
          const info = h("div", "muted small cost"); row.append(info); row.append(h("div"));
          const btn = h("button", "act", "Scan");
          btn.onclick = () => run(btn, () => simpleOrder("start a " + name.toLowerCase(), [[204, W.concat([W.v(1, scanner.id), W.v(2, range)])]]));
          row.append(btn);
          const rec = { planet: p.id, info, btn, q: null }; scanRows.push(rec);
          getJson("/debug/quote?planet=" + p.id + "&scan=" + range + "&player=" + me16()).then((q) => { if (q) { rec.q = q; evalScanner(); } });
          frag.append(row);
        }
        for (const j of p.scans) {
          const row = tipped(h("div", "ship"), "scan", j.range ? 1 : 0);
          row.append(h("div", "name", (j.range ? "Deep" : "Quick") + " scan"));
          const info = h("div", "muted small"); const t = h("span", "timer"); t.dataset.end = j.end; info.append("running: ", t); speedBtn(j, info); row.append(info); row.append(h("div"));
          const btn = h("button", "act", "Collect"); btn.dataset.collectEnd = String(j.end);
          btn.onclick = () => run(btn, () => simpleOrder("collect the scan", [[210, W.v(1, j.id)]]));
          row.append(btn); frag.append(row);
        }
        // missions of this planet
        const mine = S.missions.filter((m) => m.planet === p.id);
        const idle = carriersAt(p.id).filter((c) => !c.travel && !c.moving && c.ships.length);
        frag.append(h("h3", "", "Missions"));
        if (!mine.length) frag.append(h("p", "muted", "No missions yet: build spy drones and run a scan."));
        for (const m of mine) {
          const card = tipped(h("div", "slot mission"), "mission", m.type);
          card.append(h("div", "name", (MISSION[m.type] || "Mission " + m.type) + " · level " + m.level));
          const away = carriersAt(p.id).concat(S.planets.get(S.order[0]) ? S.planets.get(S.order[0]).carriers : []).find((c) => c.travel && c.travel.mission === m.id);
          card.append(h("div", "muted small", m.enemy.length ? "expected enemy: " + m.enemy.map((e) => (SHIP[e.ship] || "ship " + e.ship) + " (threat " + e.threat + ")").join(", ") : "no enemy fleet"));
          const exp = h("div", "muted small"); exp.append("expires in "); const et = h("span", "timer"); et.dataset.end = m.expires; exp.append(et); card.append(exp);
          if (away) { const l = h("div", "muted"); l.append("carrier #" + away.id + " arrives in "); const t = h("span", "timer"); t.dataset.end = away.travel.end; l.append(t); card.append(l); }
          else if (!idle.length) card.append(h("div", "muted small", "no carrier with ships here: load one in the Fleet section"));
          else {
            const sel = h("select"); for (const c of idle) { const o = h("option", "", "#" + c.id + " (" + c.ships.map((x) => x.count + " × " + (SHIP[x.type] || x.type)).join(", ") + ")"); o.value = c.id; sel.append(o); }
            const btn = h("button", "act", "Send");
            btn.onclick = () => run(btn, () => simpleOrder("send carrier #" + sel.value + " on " + (MISSION[m.type] || "a mission"), [[205, sendRequest(Number(sel.value), m.id)]]).then(() => S.sent.add(m.id)));
            card.append(sel, btn);
          }
          frag.append(card);
        }
      }
      // barracks: troop training (same order shape as spy drones: request 209 {1 barracks id, 2 count})
      const barracks = p.structures.find((x) => x.type === 6 && x.level > 0);
      if (barracks) {
        frag.append(h("h3", "", "Barracks"));
        const stock = (p.resources.find((r) => r.type === 4) || {}).amount || 0;
        frag.append(h("p", "muted small", "Barracks level " + barracks.level + " · troops in stock: " + fmtNum(stock) + " · troops take planets (and defend them) in ground battles"));
        const trow = h("div", "ship");
        tipped(trow, "res", 4).append(h("div", "name", "Troops"));
        const tinfo = h("div", "muted small cost"); trow.append(tinfo);
        const tinput = h("input"); tinput.type = "number"; tinput.min = "1"; tinput.max = "9999"; tinput.value = String(S.troopCount);
        tinput.oninput = () => { S.troopCount = Math.max(1, parseInt(tinput.value, 10) || 1); evalScanner(); };
        trow.append(tinput);
        const tbtn = h("button", "act", "Train");
        tbtn.onclick = () => run(tbtn, () => simpleOrder("train " + tinput.value + " troops", [[209, W.concat([W.v(1, barracks.id), W.v(2, Math.max(1, Math.min(9999, parseInt(tinput.value, 10) || 1)))])]]));
        trow.append(tbtn);
        const trec = { planet: p.id, input: tinput, info: tinfo, btn: tbtn, q: null }; droneRow.push(trec);   // evalScanner prices it like the drone row
        getJson("/debug/quote?planet=" + p.id + "&unit=troop&yard=" + barracks.id + "&player=" + me16()).then((q) => { if (q) { trec.q = q; evalScanner(); } });
        frag.append(trow);
        for (const j of p.troopJobs) { const li = h("p", "muted small", j.count + " troops ready in "); const t = h("span", "timer"); t.dataset.end = j.end; li.append(t); speedBtn(j, li); frag.append(li); }
      }
      // trade centre: exchange one resource for another (request 208 {1 trade centre id, 2 from type, 3 amount, 4 to type});
      // the rate comes from the server (/debug/quote?trade=: amount x 100 / percent arrives, capped at the storage)
      const tc = p.structures.filter((x) => x.type === 10 && x.level > 0).sort((a, b) => b.level - a.level)[0];
      if (tc) {
        frag.append(h("h3", "", "Trade centre"));
        const tinfo = h("p", "muted small", "Trade centre level " + tc.level + " · exchange rate from the server …"); frag.append(tinfo);
        const row = h("div", "ship"), mk = (v) => { const s = h("select"); [1, 2, 3].forEach((t) => { const o = h("option", "", RES[t]); o.value = String(t); s.append(o); }); s.value = String(v); return s; };
        const from = mk(S.tradeFrom || 1), to = mk(S.tradeTo || 2), amt = h("input"), out = h("div", "muted small cost"), btn = h("button", "act", "Exchange");
        amt.type = "number"; amt.min = "1"; amt.value = String(S.tradeAmount || 1000);
        let tq = null;
        const have = (t) => Math.floor((p.resources.find((r) => r.type === t) || {}).amount || 0);
        const upd = () => {
          const n = Math.max(0, parseInt(amt.value, 10) || 0), f = Number(from.value), t = Number(to.value), give = Math.min(n, have(f));
          S.tradeAmount = n; S.tradeFrom = f; S.tradeTo = t;
          btn.disabled = !tq || f === t || give <= 0;
          out.textContent = f === t ? "choose two different resources" : !tq ? "" : "gives " + fmtNum(give) + " " + RES[f] + " → about " + fmtNum(Math.floor(give * 100 / tq.percent)) + " " + RES[t]
            + (have(t) + give * 100 / tq.percent > tq.capacity ? " (storage full at " + fmtNum(tq.capacity) + ", the rest is lost)" : "");
        };
        [from, to, amt].forEach((x) => (x.oninput = upd));
        btn.onclick = () => run(btn, () => { const f = Number(from.value), t = Number(to.value), n = Math.min(Math.max(0, parseInt(amt.value, 10) || 0), have(f));
          return simpleOrder("exchange " + n + " " + RES[f] + " for " + RES[t], [[208, W.concat([W.v(1, tc.id), W.v(2, f), W.v(3, n), W.v(4, t)])]]); });
        row.append(h("div", "name", "Exchange"), from, amt, h("span", "muted", "→"), to, out, btn); frag.append(row);
        getJson("/debug/quote?planet=" + p.id + "&trade=" + tc.id + "&player=" + me16()).then((q) => { if (q) { tq = q; tinfo.textContent = "Trade centre level " + q.level + " · rate: " + (q.percent / 100).toFixed(2).replace(/\.?0+$/, "") + " given for 1 received · storage " + fmtNum(q.capacity); upd(); } });
        upd();
      }
      // artifact digging: a citadel on a citadel planet digs one artifact of the planet's colour per job (240 {1 citadel id}; collect = 210 {1 job id});
      // cost, time and the artifact come from the server (/debug/quote?dig=), the running job from the planet record (field 4)
      digRows.length = 0;
      for (const cit of p.structures.filter((x) => x.type === 11 && x.level > 0)) {
        frag.append(h("h3", "", "Artifact digging"));
        const info = h("p", "muted small", "Citadel in slot " + cit.slot + " (level " + cit.level + ") · asking the server …"), row = h("div", "ship"), cost = h("div", "muted small cost");
        const job = p.digJobs.find((j) => j.sid === cit.id), btn = h("button", "act", job ? "Collect" : "Start digging");
        const rec = { planet: p.id, sid: cit.id, job, info, cost, btn, q: null, slot: cit.slot, level: cit.level };
        if (job) { btn.dataset.collectEnd = job.end; btn.onclick = () => run(btn, () => simpleOrder("collect the dig", [[210, W.v(1, job.id)]])); }
        else btn.onclick = () => run(btn, () => simpleOrder("start digging", [[240, W.v(1, cit.id)]]));
        row.append(h("div", "name", job ? "Digging" : "Dig"), cost);
        if (job) { const t = h("span", "timer"); t.dataset.end = job.end; row.append(t); } else row.append(h("span"));
        row.append(btn); frag.append(info, row); digRows.push(rec);
        getJson("/debug/quote?planet=" + p.id + "&dig=" + cit.id + "&player=" + me16()).then((q) => { if (q) { rec.q = q; evalDig(); } });
        evalDig();
      }
      if (p.id !== S.order[0] && S.order.includes(p.id)) { const raid = h("div", "raidcard"); frag.append(raid); renderRaidCard(raid, p); }   // colonies get raided by pirates
      // ships, carriers
      frag.append(h("h3", "", "Ships on the planet"));
      frag.append(p.ships.length ? h("p", "", p.ships.map((s) => s.count + " × " + (SHIP[s.type] || "type " + s.type)).join(", ")) : h("p", "muted", "none"));
      if (p.shipJobs.length) {
        const ul = h("ul", "plain");
        for (const j of p.shipJobs) { const li = h("li", "", j.count + " × " + (SHIP[j.ship] || "type " + j.ship) + " in "); const t = h("span", "timer"); t.dataset.end = j.end; li.append(t); speedBtn(j, li); ul.append(li); }
        frag.append(ul);
      }
      if (p.carriers.length && p.id === S.order[0]) renderFleet(frag, p);
      root.replaceChildren(frag);
      tick();
    },
  };

  async function run(btn, fn) {
    btn.dataset.busy = "1"; btn.disabled = true;
    try { await fn(); } catch (e) { log(e.message, true); } finally { if (btn.isConnected) { delete btn.dataset.busy; btn.disabled = false; evalButtons(); } }
  }

  // ---- combat: the attack screen (opened from the map's planet rows) and the colony raid card -----------------------------------
  // Numbers come from the read-only /debug/quote branches ?attack= (trip, strengths, bombing, conquest, planet room), ?spy= (chances, what the
  // drones can identify) and ?raid= (a colony's raids). The odds use ONLY the ships a spy report identified: the real defence stays hidden.
  // Orders: 327 (spy drones {1 scanner, 2 target planet, 3 drones}), 203 order 1 (attack). Results arrive as spy / battle reports in the mail.
  const pct = (x) => Math.round(x * 100) + " %";
  const shipsText = (m) => Object.entries(m || {}).filter(([, n]) => n).map(([t, n]) => fmtNum(n) + " × " + (SHIP[t] || "type " + t)).join(", ") || "none";
  const srvClock = (t) => new Date((t - S.offset) * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const quoteJson = (qs) => fetch("/debug/quote?" + qs + "&player=" + me16()).then((r) => (r.ok ? r.json() : null)).then((q) => (q && !q.error ? q : null)).catch(() => null);
  async function loadSpyReports() {   // spy report details are only sent when asked for (105)
    const need = [...S.mail.values()].filter((m) => m.kind === 6 && !S.details.has(m.id)).sort((a, b) => b.time - a.time).slice(0, 20);
    if (need.length) await call(need.map((m) => [105, W.v(1, m.id)]));
  }
  function latestSpy(target) {
    const rows = [...S.mail.values()].filter((m) => { const d = S.details.get(m.id); return m.kind === 6 && d && d.variant === 6 && d.planet === target; }).sort((a, b) => b.time - a.time);
    return rows.length ? { time: rows[0].time, d: S.details.get(rows[0].id) } : null;
  }
  function openAttack(box, target, label) {
    box.replaceChildren();
    const card = h("div", "slot fleet"); box.append(card);
    card.append(h("div", "name", "Attack " + (label || "planet") + " · planet " + target));
    const intel = h("div", "small"), spyBox = h("div", "small"), plan = h("div", "small"), out = h("div", "small");
    card.append(h("div", "muted small", "Intel"), intel, spyBox, h("div", "muted small", "Attack"), plan, out);
    let seen = null;
    const troopsOf = (d) => { const r = d.resources.find((x) => x.type === 4); return r ? r.amount : null; };
    const showIntel = () => {
      seen = latestSpy(target); intel.replaceChildren();
      if (!seen) { intel.append(h("div", "muted", "No spy report for this planet yet. Spy drones show the fleet, the troops and the resources as far as the scanner level and the number of drones reach; an attack without intel is blind.")); return; }
      const d = seen.d, gar = troopsOf(d);
      intel.append(h("div", "", "Spy report " + fmtDur(Math.max(0, nowSrv() - seen.time)) + " ago (the garrison and fleet can have changed since)"));
      intel.append(h("div", "", "Identified fleet: " + shipsText(Object.fromEntries(d.ships.map((x) => [x.type, x.count]))) + " · troops: " + (gar === null ? "unknown" : fmtNum(gar))));
      const res = d.resources.filter((r) => r.type !== 4);
      intel.append(h("div", "muted", "Resources: " + (res.length ? res.map((r) => fmtNum(r.amount) + " " + (RES[r.type] || r.type).toLowerCase()).join(", ") : "not found")));
    };
    // --- spy drones
    const scanners = S.order.map((id) => S.planets.get(id)).filter((p) => p && p.structures.some((x) => x.type === 8 && x.level > 0));
    if (!scanners.length) spyBox.append(h("div", "muted", "No scanner yet: build one to send spy drones."));
    else {
      const row = h("div", "orders"), sp = h("select"), n = h("input"), info = h("span", "muted small"), btn = h("button", "act", "Send spy drones");
      const optText = (p) => planetLabel(p.id) + " · scanner level " + p.structures.find((x) => x.type === 8).level + " · " + fmtNum((S.planets.get(p.id).resources.find((r) => r.type === 5) || {}).amount || 0) + " drones";
      for (const p of scanners) { const o = h("option", "", optText(p)); o.value = p.id; sp.append(o); }
      n.type = "number"; n.min = "1"; n.max = "999"; n.value = "3"; n.style.width = "70px";
      const count = () => Math.max(1, Math.min(999, parseInt(n.value, 10) || 1));
      const upd = async () => {
        for (const o of sp.options) o.textContent = optText(S.planets.get(Number(o.value)));
        const q = await quoteJson("planet=" + sp.value + "&spy=" + target + "&drones=" + count());
        if (!q) { info.textContent = ""; return; }
        const short = q.have < q.drones;
        info.textContent = "success " + pct(q.chance) + " · detected " + pct(q.detect) + " · identifies about " + q.limits.ships + " ships" + (short ? " — needs " + q.drones + " drones, " + q.have + " ready" : "");
        info.classList.toggle("bad", short); btn.disabled = !!btn.dataset.busy || short; btn.title = short ? "not enough spy drones (build them in the Scanner section)" : "";
      };
      sp.onchange = upd; n.oninput = upd;
      btn.onclick = () => run(btn, async () => {
        const p = S.planets.get(Number(sp.value)), scanner = p.structures.find((x) => x.type === 8 && x.level > 0);
        await simpleOrder("spy on planet " + target + " with " + count() + " drones", [[327, W.concat([W.v(1, scanner.id), W.v(2, target), W.v(3, count())])]]);
        await loadSpyReports(); showIntel(); upd(); plan.upd && plan.upd();
      });
      row.append(sp, n, btn, info); spyBox.append(row); upd();
    }
    // --- the attack: carrier, odds, order
    const carriers = (S.planets.get(S.order[0]) || { carriers: [] }).carriers.filter((c) => !c.travel && !c.move && c.ships.some((x) => x.count > 0 && x.type !== 8 && x.type !== 9));
    if (!carriers.length) plan.append(h("div", "muted", "No idle carrier with warships. Build ships, load a carrier (Fleet section) or wait until one is back."));
    else {
      const row = h("div", "orders"), sel = h("select"), btn = h("button", "act", "Attack"), info = h("div", "small"); let armed = 0, warn = "";
      for (const c of carriers) { const o = h("option", "", "#" + c.id + " · " + carrierName(c.type) + " · " + c.ships.map((x) => x.count + " × " + (SHIP[x.type] || x.type)).join(", ") + " · at " + planetLabel(c.at)); o.value = c.id; sel.append(o); }
      row.append(sel, btn); plan.append(row, info);
      const upd = plan.upd = async () => {
        const d = seen && seen.d, gar = d ? troopsOf(d) : null;
        const idents = d ? d.ships.map((x) => x.type + ":" + x.count).join(",") : "";
        const q = await quoteJson("planet=" + S.order[0] + "&attack=" + target + "&fleet=" + sel.value + (idents ? "&seen=" + idents : "") + (gar !== null ? "&troops=" + gar : ""));
        info.replaceChildren();
        if (!q) { info.append(h("div", "muted", "(no numbers for this carrier)")); return; }
        const line = (t, cls) => info.append(h("div", cls || "", t));
        line("Trip " + fmtDur(q.seconds) + (q.gathers ? " · the fleet gathers and the battle starts at " + srvClock(q.fight_at) : " · the battle starts on arrival (home system)"));
        line("Aboard: " + shipsText(q.ships) + " · troops " + q.troops_aboard + " · cargo space " + fmtNum(q.capacity) + (q.capacity ? " (loot up to " + fmtNum(Math.floor(q.capacity / 3)) + " of each resource)" : " (no freighters: no loot)"));
        if (q.ratio === null) line("Your strength " + fmtNum(q.mine) + " against an unknown defence: send spy drones for odds.", "muted");
        else {
          line("Your strength " + fmtNum(q.mine) + " vs " + fmtNum(q.theirs) + " (identified ships only) · ratio " + q.ratio + " · chance to win the deciding roll " + pct(q.chance), q.chance >= 0.9 ? "ok" : q.chance > 0 ? "warn" : "bad");
          line(q.rounds ? "The battle runs in rounds a quarter hour apart (at most " + q.rounds_max + "); both sides lose ships each round." : "So lopsided that it is decided in the first round.", "muted");
        }
        if (q.conquer === null) line("Troops needed to conquer: more than the garrison (unknown).", "muted");
        else line("Garrison " + gar + " (" + q.bombed + " bombed before the landing) vs " + q.troops_aboard + " troops aboard → " + (q.conquer ? "the planet would be conquered" : "not enough troops: raid only"), q.conquer ? "ok" : "warn");
        if (q.conquer || q.conquer === null) { if (!q.room) line("Conquest blocked: " + q.limit_text, "bad"); else line("Planets " + q.outer + "/" + q.outer_limit, "muted"); }
        warn = q.chance === 0 ? " (hopeless)" : seen ? "" : " (blind)";
        btn.disabled = !!btn.dataset.busy; armed = 0; btn.textContent = "Attack";
      };
      sel.onchange = upd;
      btn.onclick = () => {
        if (!armed) { armed = 1; btn.textContent = "Confirm attack" + warn; setTimeout(() => { if (btn.isConnected && armed) { armed = 0; btn.textContent = "Attack"; } }, 6000); return; }
        armed = 0; btn.textContent = "Attack";
        run(btn, async () => {
          await simpleOrder("attack planet " + target + " with carrier #" + sel.value, [[203, W.concat([W.v(1, Number(sel.value)), W.v(2, 1), W.v(3, target), W.dbl(5, 1.0)])]]);
          const id = sel.value;
          await refreshPlanets(S.order); openAttack(box, target, label);   // the carrier is moving now: rebuild the screen without it
          box.firstChild.append(h("div", "ok small", "Carrier #" + id + " is on its way. The result arrives as a battle report (Messages › Battles)."));
        });
      };
      upd();
    }
    showIntel(); loadSpyReports().then(() => { showIntel(); plan.upd && plan.upd(); });
  }
  async function renderRaidCard(host, p) {   // a colony's raids: raid level, the party, the defence and the odds (/debug/quote?raid=1); a Void in range (q.void) takes some of the pirates' raids
    const q = await quoteJson("planet=" + p.id + "&raid=1");
    const v = q && q.void;
    host.replaceChildren(h("h3", "", v ? (q.base ? "Pirate and Void raids" : "Void raids") : "Pirate raids"));
    if (!q || q.home) { host.append(h("p", "muted small", "The home system is never raided.")); return; }
    if (!q.enabled) { host.append(h("p", "muted small", "No pirate base or Void is left to raid this colony.")); return; }
    const card = h("div", "slot fleet"), line = (t, cls) => card.append(h("div", "small " + (cls || ""), t));
    const verdict = (x, what) => "Strength " + fmtNum(x.mine) + " vs " + fmtNum(x.theirs) + " → " + (x.chance >= 1 ? "the " + what + " would be repelled" : x.chance <= 0 ? "the " + what + " would succeed" : "chance to repel " + pct(x.chance));
    const tone = x => x.chance >= 1 ? "ok" : x.chance <= 0 ? "bad" : "warn";
    if (v) {   // the Void's own party: a share of the ships on its nearest planet
        const share = q.base ? pct(v.takes_raid) + " of the due raids" : "every due raid";
        line("VOID: " + v.alias + " holds planet " + v.planet + " within " + Math.round(v.range / 30) + " sectors and answers " + share + " with " + pct(v.share) + " of the ships there: " + shipsText(v.party) + ".", "bad");
        line(verdict(v, "Void raid"), tone(v));
        line("A repelled Void raid destroys the party (the Void builds new ships at its gate); a lost one is paid to the Void planet's stock.", "muted");
    }
    if (q.base) {
        line((v ? "Otherwise raids" : "Raids") + " by " + q.base + " come every " + q.min_seconds / 3600 + " to " + q.max_seconds / 3600 + " hours; level " + q.level + " (the colony's Headquarters ÷ 2). Raiders: " + shipsText(q.raiders) + ".");
    } else if (v) {
        line("Raids come every " + q.min_seconds / 3600 + " to " + q.max_seconds / 3600 + " hours (no pirate base is left).");
    }
    line("Defence here: " + shipsText(q.defenders) + (q.carriers_engaged ? " (incl. ships on " + q.carriers_engaged + " carrier" + (q.carriers_engaged > 1 ? "s" : "") + " set to ENGAGE)" : "") + " · planetary defence level " + q.defence_level);
    if (q.base) line((v ? "Pirates: " : "") + verdict(q, "raid"), tone(q));
    line("A lost raid costs " + pct(q.lost.ships) + " of the ships stationed here and " + pct(q.lost.resources) + " of the metal, gas and crystal; carriers set to AVOID COMBAT leave first. Reports: Messages › Battles.", "muted");
    host.append(card);
  }

  // ---- once a second: countdowns and resource counters --------------------------------------------------------------
  let refreshing = false;
  function tick() {
    const now = nowSrv();
    let due = false;
    for (const e of document.querySelectorAll("[data-end]")) {
      const left = Number(e.dataset.end) - now;
      e.textContent = left > 0 ? fmtDur(left) : "done";
      if (left <= 0 && !e.dataset.fired) { e.dataset.fired = "1"; due = true; }
    }
    for (const e of document.querySelectorAll("[data-res]")) {
      const [, amount, perDay, cap, ts] = e.dataset.res.split(",").map(Number);
      const v = Math.max(amount, Math.min(cap, amount + perDay / 86400 * Math.max(0, now - ts)));
      e.textContent = fmtNum(v) + " / " + fmtNum(cap);
      e.classList.toggle("full", cap > 0 && v >= cap - 0.5);   // stores full: production is wasted
    }
    for (const e of document.querySelectorAll("[data-bar]")) {
      const [, amount, perDay, cap, ts] = e.dataset.bar.split(",").map(Number);
      const v = Math.max(amount, Math.min(cap, amount + perDay / 86400 * Math.max(0, now - ts)));
      e.style.width = (cap ? Math.min(100, 100 * v / cap) : 0) + "%";
    }
    evalButtons();
    if (due && S.me && !refreshing) { refreshing = true; setTimeout(async () => { try { await refreshPlanets(); await refreshAccount(); } catch (e) { log(e.message, true); } refreshing = false; }, 1200); }
    $("age").textContent = S.lastUpdate ? "updated " + Math.round((Date.now() - S.lastUpdate) / 1000) + " s ago" : "";
  }

  async function poll() {
    if (!S.me || S.busy) return;
    try { await refreshPlanets(); } catch (e) { log("poll failed: " + e.message, true); }
    loadTutorial();
  }

  // ---- start -------------------------------------------------------------------------------------------------------
  async function boot() {
    let relayOk = true;
    try { S.info = await (await fetch("/relay/info")).json(); } catch (e) { relayOk = false; }
    if (!relayOk) {   // opened as a file, or the relay is not running
      $("mode").textContent = "no relay";
      $("mode").className = "pill warn";
      $("loginbtn").disabled = true;
      $("loginerr").innerHTML = "";
      const how = location.protocol === "file:" ? "This page was opened as a file. " : "The relay is not answering at " + location.origin + ". ";
      $("loginerr").append(how + "Start it with: python3 -I re-tools/webspike/relay.py (from the project folder), then open http://localhost:8765/");
      return;
    }
    const playMode = S.info.mode === "play";
    $("mode").textContent = playMode ? "play mode (your game is saved on this Mac)" : S.info.sandbox ? "sandbox server (throwaway saves)" : "LIVE server " + (S.info.upstream || "?") + " — saves change";
    $("mode").className = S.info.sandbox || playMode ? "pill ok" : "pill warn";
    if ($("loginhint")) $("loginhint").textContent = playMode ? "Plays one commander. A new name starts a new game, the same name continues it (saved on this Mac, backed up every hour). Anyone who can open this page can use any name, so keep it on this Mac." : S.info.sandbox ? "Plays one commander on the game server through the relay. A new name starts a fresh game on the sandbox server." : "Plays one commander on the LIVE game server through the relay: its saves change.";
    $("tools").hidden = !S.info.sandbox;
    $("alias").value = localStorage.getItem("gofa.alias") || "WebPilot";
    $("loginform").onsubmit = async (ev) => {
      ev.preventDefault();
      const alias = $("alias").value.trim();
      if (!alias) return;
      const btn = $("loginbtn"); btn.disabled = true; $("loginerr").textContent = "";
      try {
        await login(alias);
        localStorage.setItem("gofa.alias", alias);
        $("loginpanel").hidden = true; $("game").hidden = false;
        render.all(); loadColonies(); loadTutorial();
        if (location.hash === "#original") setTimeout(() => $("tabPort").click(), 600);   // play mode opens the page like this: straight into the Original look
        setInterval(tick, 1000); setInterval(poll, 5000); setInterval(() => refreshAccount().then(() => refreshPlanets(S.order)).then(() => loadColonies()).catch(() => {}), 20000);
      } catch (e) { $("loginerr").textContent = e.message; } finally { btn.disabled = false; }
    };
    $("tabPlanet").onclick = () => showView("planet"); $("tabColonies").onclick = () => showView("colonies"); $("tabGalaxy").onclick = () => showView("galaxy"); $("tabHelp").onclick = () => showView("help");
    document.addEventListener("keydown", (e) => {   // [ and ] switch to the previous / next planet
      if (!S.me || (e.key !== "[" && e.key !== "]") || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target || {}).tagName) || !$("port").hidden) return;
      const i = S.order.indexOf(S.selected); if (i < 0) return;
      switchPlanet(S.order[(i + (e.key === "]" ? 1 : S.order.length - 1)) % S.order.length]);
    });
    $("tabPort").onclick = () => window.GoFAPort && window.GoFAPort.open();
    for (const b of document.querySelectorAll("[data-debug]")) {
      b.onclick = () => run(b, () => debug(b.dataset.debug.replace("{planet}", S.selected).replace("{home}", S.order[0])));
    }
  }
  window.addEventListener("gofa-help-ready", () => { if (S.me) { S.shown = ""; render.all(); } });   // tooltips appear once the game texts have arrived
  window.addEventListener("DOMContentLoaded", boot);
  window.GoFA = { S, call, login, parsePlanet, api: { S, call, callRaw: call, run, log, simpleOrder, quoteMove, openAttack, planetLabel, fmtNum, fmtDur, CARRIER, SHIP, RES, me16, nowSrv, mailTitle, mailBody, get MISSION() { return MISSION; }, refreshAccount, refreshPlanets, get W() { return W; }, get STRUCT() { return STRUCT; }, curAmount, h, ORDERS, buildOrUpgrade, quote, quoteShip, orderShips, TECH, TECH_ORDER, quoteTech, orderResearch, sendRequest, quoteJson, carriersAt, latestSpy, loadSpyReports, shipsText, pct, srvClock } };   // for debugging in the console
})();
