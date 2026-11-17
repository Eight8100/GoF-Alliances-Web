/* Help tab and tooltips for the plain interface, in the game's own words.
   The texts are NOT in this file: they come from the relay's /relay/loca (data/loca_en.tsv, the owner's local, git-ignored copy of the
   game's text). This file holds only key names (which text belongs to which building, ship, tech, skill, item, mission) and the layout.
   No game rule is computed here: the texts say what a thing does, the numbers on the page still come from the server. */
(function () {
  "use strict";
  const PREFIXES = ["DESC_", "CAPTION_", "HEADER_INVENTORY_", "ACHIEVEMENT_", "TUTORIAL_"];
  let T = null, failed = "", loading = null;

  // ---- id -> key tables (ids are those of app.js: STRUCT, RES, SHIP, CARRIER, TECH, SKILLS, ITEM, MISSION) -------------------------
  // each entry: [name key, description keys...]; a leading "~" marks the key of an upgrade note
  const STRUCT = {
    1: ["CAPTION_HEADQUARTER", "DESC_INFOSCREEN_STRUCT_HQ", "DESC_INFOSCREEN_STRUCT_HQ_UPGRADE_INFO"],
    2: ["CAPTION_SHIPYARD", "DESC_INFOSCREEN_STRUCT_SHIPYARD", "DESC_INFOSCREEN_STRUCT_SHIPYARD_UPGRADE_INFO"],
    3: ["CAPTION_METAL_EXCTRACTOR", "DESC_INFOSCREEN_STRUCT_METAL", "DESC_INFOSCREEN_STRUCT_EXTRACTOR_UPGRADE_INFO"],
    4: ["CAPTION_GAS_EXCTRACTOR", "DESC_INFOSCREEN_STRUCT_GAS", "DESC_INFOSCREEN_STRUCT_EXTRACTOR_UPGRADE_INFO"],
    5: ["CAPTION_CRYSTAL_EXCTRACTOR", "DESC_INFOSCREEN_STRUCT_CRYSTAL", "DESC_INFOSCREEN_STRUCT_EXTRACTOR_UPGRADE_INFO"],
    6: ["CAPTION_BARRACKS", "DESC_INFOSCREEN_STRUCT_BARRACKS", "DESC_INFOSCREEN_STRUCT_BARRACKS_UPGRADE_INFO"],
    7: ["CAPTION_LABORATORY", "DESC_INFOSCREEN_STRUCT_LAB", "DESC_INFOSCREEN_STRUCT_LAB_UPGRADE_INFO"],
    8: ["CAPTION_SCANNING_ARRAY", "DESC_INFOSCREEN_STRUCT_SCANNER", "DESC_INFOSCREEN_STRUCT_SCANNER_UPGRADE_INFO"],
    9: ["CAPTION_PLANETARY_SHIELD", "DESC_INFOSCREEN_STRUCT_SHIELD", "DESC_INFOSCREEN_STRUCT_SHIELD_UPGRADE_INFO"],
    10: ["CAPTION_TRADE_CENTER", "DESC_INFOSCREEN_STRUCT_TRADE", "DESC_INFOSCREEN_STRUCT_TRADE_UPGRADE_INFO"],
    11: ["CAPTION_CITADEL", "DESC_INFOSCREEN_STRUCT_ARTIFACTS", "DESC_INFOSCREEN_STRUCT_CITADEL_UPGRADE_INFO"] };
  const RES = {
    1: ["CAPTION_RESOURCE_METAL", "DESC_INFOSCREEN_STRUCT_METAL"], 2: ["CAPTION_RESOURCE_GAS", "DESC_INFOSCREEN_STRUCT_GAS"],
    3: ["CAPTION_RESOURCE_CRYSTAL", "DESC_INFOSCREEN_STRUCT_CRYSTAL"], 4: ["CAPTION_RESOURCE_MARINES", "DESC_INFOSCREEN_TYPE_MARINES"],
    5: ["CAPTION_RESOURCE_SPY_PROBES", "DESC_INFOSCREEN_TYPE_SPYDRONES"] };
  const SHIP = {
    1: ["CAPTION_FIGHTER", "DESC_INFOSCREEN_TYPE_FIGHTER"], 2: ["CAPTION_ADV_FIGHTER", "DESC_INFOSCREEN_TYPE_FIGHTER_ADV"],
    3: ["CAPTION_INTERCEPTOR", "DESC_INFOSCREEN_TYPE_INTERCEPTOR"], 4: ["CAPTION_ADV_INTERCEPTOR", "DESC_INFOSCREEN_TYPE_INTERCEPTOR_ADV"],
    5: ["CAPTION_BOMBER", "DESC_INFOSCREEN_TYPE_BOMBER"], 6: ["CAPTION_ADV_BOMBER", "DESC_INFOSCREEN_TYPE_BOMBER_ADV"],
    8: ["CAPTION_FREIGHTER", "DESC_INFOSCREEN_TYPE_FREIGHTER"], 9: ["CAPTION_ADV_FREIGHTER", "DESC_INFOSCREEN_TYPE_FREIGHTER_ADV"] };
  const CARRIER = {
    1: ["CAPTION_COMMANDSHIP_1", "DESC_INFOSCREEN_TYPE_CARRIER_MK1"], 5: ["CAPTION_COMMANDSHIP_2", "DESC_INFOSCREEN_TYPE_CARRIER_MK2"],
    9: ["CAPTION_COMMANDSHIP_3", "DESC_INFOSCREEN_TYPE_CARRIER_MK3"], 13: ["CAPTION_INFOSCREEN_COMMAND_VOID", "DESC_INFOSCREEN_TYPE_CARRIER_VOID"] };
  const TECH = {   // research id -> [name, what a level does (DESC_TECH_*), the info-screen line (DESC_INFOSCREEN_TECH_*)]
    1: ["CAPTION_TECH_METAL_EXTRACTION", "DESC_TECH_METAL_EXTRACTION", "DESC_INFOSCREEN_TECH_EXTRACTION_METAL"],
    2: ["CAPTION_TECH_CRYSTAL_EXTRACTION", "DESC_TECH_CRYSTAL_EXTRACTION", "DESC_INFOSCREEN_TECH_EXTRACTION_CRYSTAL"],
    3: ["CAPTION_TECH_GAS_EXTRACTION", "DESC_TECH_GAS_EXTRACTION", "DESC_INFOSCREEN_TECH_EXTRACTION_GAS"],
    5: ["CAPTION_TECH_SILO", "DESC_TECH_SILO", "DESC_INFOSCREEN_TECH_SILO"],
    11: ["CAPTION_TECH_ADV_FREIGHTER_BLUEPRINT", "DESC_TECH_ADVANCED_FREIGHTER_BLUEPRINT", "DESC_INFOSCREEN_TECH_ADV_FREIGHTER"],
    13: ["CAPTION_TECH_ADV_FIGHTER_BLUEPRINT", "DESC_TECH_ADVANCED_FIGHTER_BLUEPRINT", "DESC_INFOSCREEN_TECH_ADV_FIGHTER"],
    15: ["CAPTION_TECH_ADV_INTERCEPTOR_BLUEPRINT", "DESC_TECH_ADVANCED_INTERCEPTOR_BLUEPRINT", "DESC_INFOSCREEN_TECH_ADV_INTERCEPTOR"],
    17: ["CAPTION_TECH_ADV_BOMBER_BLUEPRINT", "DESC_TECH_ADVANCED_BOMBER_BLUEPRINT", "DESC_INFOSCREEN_TECH_ADV_BOMBER"],
    20: ["CAPTION_TECH_COMMAND_SHIP_2_BLUEPRINT", "DESC_TECH_CARRIER_2_BLUEPRINT", "DESC_INFOSCREEN_TECH_CARRIER_II"],
    22: ["CAPTION_TECH_COMMAND_SHIP_3_BLUEPRINT", "DESC_TECH_CARRIER_3_BLUEPRINT", "DESC_INFOSCREEN_TECH_CARRIER_III"],
    30: ["CAPTION_TECH_SHIP_DEFENCE", "DESC_TECH_SHIP_DEFENCE", "DESC_INFOSCREEN_TECH_SHIP_DEFENSE"],
    31: ["CAPTION_TECH_GROUND_BATTLE", "DESC_TECH_GROUND_BATTLE", "DESC_INFOSCREEN_TECH_GROUND_BATTLE"],
    32: ["CAPTION_TECH_BOMB_DEFENCE", "DESC_TECH_BOMB_DEFENCE", "DESC_INFOSCREEN_TECH_BOMB_DEFENCE"],
    33: ["CAPTION_TECH_PRODUCTION", "DESC_TECH_PRODUCTION", "DESC_INFOSCREEN_TECH_SHIP_PRODUCTION"] };
  const SKILL = {   // skill id -> [name, what the skill does, what the next skillpoint does]
    13: ["CAPTION_UPPER_SKILL_CONSTRUCTION", "DESC_INFOSCREEN_SKILLS_CONSTRUCTION", "DESC_INFOSCREEN_SKILLPOINT_CONSTRUCTION"],
    14: ["CAPTION_UPPER_SKILL_PRODUCTION", "DESC_INFOSCREEN_SKILLS_ENGINEER", "DESC_INFOSCREEN_SKILLPOINT_ENGINEER"],
    16: ["CAPTION_UPPER_SKILL_HARVESTER_METAL", "DESC_INFOSCREEN_SKILLS_METAL", "DESC_INFOSCREEN_SKILLPOINT_RESOURCE_SPECIALIST", "metal"],
    17: ["CAPTION_UPPER_SKILL_HARVESTER_GAS", "DESC_INFOSCREEN_SKILLS_GAS", "DESC_INFOSCREEN_SKILLPOINT_RESOURCE_SPECIALIST", "gas"],
    18: ["CAPTION_UPPER_SKILL_HARVESTER_CRYSTAL", "DESC_INFOSCREEN_SKILLS_CRYSTAL", "DESC_INFOSCREEN_SKILLPOINT_RESOURCE_SPECIALIST", "crystal"],
    23: ["CAPTION_UPPER_SKILL_SILO", "DESC_INFOSCREEN_SKILLS_SILO", "DESC_INFOSCREEN_SKILLPOINT_SILO_SPECIALIST"],
    24: ["CAPTION_UPPER_SKILL_CROSSFIRE", "DESC_INFOSCREEN_SKILLS_CROSSFIRE", "DESC_INFOSCREEN_SKILLPOINT_CROSSFIRE"],
    25: ["CAPTION_UPPER_SKILL_PLANET_MANAGEMENT", "DESC_INFOSCREEN_SKILLS_PLANET_MANAGEMENT", "DESC_INFOSCREEN_SKILLPOINT_PLANET_MANAGEMENT"],
    26: ["CAPTION_UPPER_SKILL_CARRIER_MANAGEMENT", "DESC_INFOSCREEN_SKILLS_CARRIER_MANAGEMENT", "DESC_INFOSCREEN_SKILLPOINT_CARRIER_MANAGEMENT"],
    27: ["CAPTION_UPPER_SKILL_SHIP_MANAGEMENT", "DESC_INFOSCREEN_SKILLS_SHIP_MANAGEMENT", "DESC_INFOSCREEN_SKILLPOINT_SHIP_MANAGEMENT"],
    28: ["CAPTION_UPPER_SKILL_LOGISTIC", "DESC_INFOSCREEN_SKILLS_LOGISTIC", "DESC_INFOSCREEN_SKILLPOINT_LOGISTIC"],
    29: ["CAPTION_UPPER_SKILL_NAVIGATION", "DESC_INFOSCREEN_SKILLS_NAVIGATION", "DESC_INFOSCREEN_SKILLPOINT_NAVIGATION"],
    30: ["CAPTION_UPPER_SKILL_BARGAINING", "DESC_INFOSCREEN_SKILLS_BARGAINING", "DESC_INFOSCREEN_SKILLPOINT_BARGAINING"] };
  const ITEM = {   // inventory item id -> key tail of HEADER_INVENTORY_ITEM_* / DESC_INVENTORY_ITEM_*
    1: "MINISTRY", 2: "OUTPOST", 3: "PILOT_SCHOOL", 18: "FLEET_COMMANDER", 4: "CARRIER_2_BLUEPRINT", 5: "CARRIER_3_BLUEPRINT",
    6: "ADVANCED_FREIGHTER_BLUEPRINT", 7: "ADVANCED_FIGHTER_BLUEPRINT", 8: "ADVANCED_INTERCEPTOR_BLUEPRINT", 9: "ADVANCED_BOMBER_BLUEPRINT",
    10: "ARTIFACT_RED", 11: "ARTIFACT_YELLOW", 12: "ARTIFACT_BLUE", 13: "DOUBLE_XP_BOOSTER",
    14: "DAILY_CREDIT_BOOSTER_SMALL", 15: "DAILY_CREDIT_BOOSTER_MEDIUM", 16: "DAILY_CREDIT_BOOSTER_BIG", 17: "CARRIER_4_CONSTRUCT" };
  const ITEM_ORDER = [10, 11, 12, 17, 1, 2, 3, 18, 6, 7, 8, 9, 4, 5, 13, 14, 15, 16];
  const MISSION = {   // mission type -> key tail of CAPTION_MISSION_* / DESC_SHORT_INFOSCREEN_MISSION_* / DESC_MISSION_*
    1: "QUICK_HARVEST_METAL", 2: "QUICK_HARVEST_GAS", 3: "QUICK_HARVEST_CRYSTAL", 4: "DEEP_HARVEST_METAL", 5: "DEEP_HARVEST_GAS", 6: "DEEP_HARVEST_CRYSTAL",
    7: "DEEP_ANOMALY", 8: "DEEP_NPC_OUTPOST", 9: "DEEP_SHIP_WRECK", 10: "QUICK_PIRATE_FIGHTERS", 11: "QUICK_PIRATE_BOMBERS", 12: "QUICK_PIRATE_INTERCEPTORS",
    13: "QUICK_PIRATE_HIDEOUT", 14: "QUICK_MERCHANT_UNDERATTACK", 15: "QUICK_ANOMALY_COMBAT", 16: "QUICK_ANOMALY", 17: "QUICK_WRECK_LOOTING",
    18: "QUICK_UNKNOWN_SHIPWRECK", 19: "DEEP_RESCUE", 20: "DEEP_NPC_OUTPOST_SMALL", 21: "DEEP_NPC_OUTPOST_BIG", 22: "DEEP_NPC_OUTPOST_ELITE" };
  // the 26 tutorial missions in the order of the mission list: [ACHIEVEMENT_<a> = name, <a>_DESC = text, TUTORIAL_<b> = requirement]
  const TUTORIAL = [["BUILD_METAL_EXTRACTOR", "BUILD_METAL_EXTRACTOR"], ["BUILD_HQ_LVL_2", "UPGRADE_HQ"], ["UPGRADE_METAL_EXTRACTOR", "UPGRADE_METAL_EXTRACTOR"],
    ["BUILD_SHIPYARD", "BUILD_SHIPYARD"], ["PRODUCE_CARRIER", "BUILD_CARRIER"], ["PRODUCE_REGULAR_SHIPS", "BUILD_SHIPS"], ["START_COLONIZE", "COLONIZE"],
    ["SETUP_CARRIER_WITH_RESOURCES", "TRANSFER_RESOURCES"], ["START_DELIVER", "DELIVER"], ["PERFORMED_BATTLE", "BATTLE"],
    ["BUILD_INTELLIGENCE_STRUCTURE", "BUILD_INTELLIGENCE"], ["PRODUCE_SPY_DRONES", "BUILD_SPY_DRONES"], ["SPIED_PLANET", "ESPIONAGE"],
    ["BUILD_BARRACKS", "BUILD_BARRACKS"], ["PRODUCE_MARINES", "BUILD_TROOPS"], ["SETUP_CARRIER_WITH_MARINES", "TRANSFER_TROOPS"],
    ["SCANNED_FOR_MISSION", "SCAN_MISSION"], ["FINISHED_MISSION", "COMPLETE_MISSION"], ["BUILD_LABORATORY", "BUILD_LABORATORY"],
    ["ACTIVATE_TECH", "RESEARCH_TECH"], ["BUILD_TRADE_CENTER", "BUILD_TRADE_CENTER"], ["EXCHANGE_RESOURCES", "EXCHANGE_RESOURCES"],
    ["CLAIMED_SKILL", "INCREASE_SKILL"], ["OPENED_JUMPGATE", "OPEN_JUMPGATE"], ["COMMANDER_LEVEL_10", "COMMANDER_LEVEL_10"],
    ["JUMPED_THROUGH_JUMPGATE", "JUMP_THROUGH_JUMPGATE"]];

  // ---- text helpers ---------------------------------------------------------------------------------------------------------------------
  const L = (k) => (T && T[k]) || "";
  // <PLACEHOLDER>s in the game's texts are filled by the client from its data; without a value a plain stand-in is used (the numbers are the server's)
  const STAND_IN = { LEVEL: "N", AMOUNT: "N", TYPE: "the resource", RESOURCE: "the resource", BLUEPRINT: "the blueprint", BONUS: "a bonus" };
  const fill = (s, subs) => s.replace(/<([A-Z_]+)>/g, (m, n) => (subs && subs[n] !== undefined ? String(subs[n]) : STAND_IN[n] || "…"));
  // " | " in the game's texts marks a line break; a lone "|" between spaces too
  const paras = (s, subs) => fill(s, subs).split(/\s*\|\s*/).map((x) => x.trim()).filter(Boolean);
  const text = (k, subs) => paras(L(k), subs).join("\n");

  // entry for kind/id: { name, paras:[...] } or null when the texts are not loaded or the id is unknown
  function entry(kind, id, subs) {
    if (!T) return null;
    let name = "", ps = [];
    const add = (k, s) => { for (const p of paras(L(k), s || subs)) if (!ps.includes(p)) ps.push(p); };
    if (kind === "struct" && STRUCT[id]) { name = L(STRUCT[id][0]); add(STRUCT[id][1]); const type = { 3: "metal", 4: "gas", 5: "crystal" }[id]; add(STRUCT[id][2], Object.assign({ TYPE: type }, subs)); }
    else if (kind === "res" && RES[id]) { name = L(RES[id][0]); add(RES[id][1]); }
    else if (kind === "ship" && SHIP[id]) { name = L(SHIP[id][0]); add(SHIP[id][1]); }
    else if (kind === "carrier" && CARRIER[id]) { name = L(CARRIER[id][0]); add(CARRIER[id][1]); }
    else if (kind === "tech" && TECH[id]) { name = L(TECH[id][0]); add(TECH[id][1]); add(TECH[id][2]); }
    else if (kind === "skill" && SKILL[id]) { name = L(SKILL[id][0]); add(SKILL[id][1]); add(SKILL[id][2], Object.assign({ RESOURCE: SKILL[id][3] }, subs)); }
    else if (kind === "item" && ITEM[id]) { name = L("HEADER_INVENTORY_ITEM_" + ITEM[id]); add("DESC_INVENTORY_ITEM_" + ITEM[id]); }
    else if (kind === "scan") { name = L(id ? "CAPTION_SCAN_TYPE_DEEP_SCAN" : "CAPTION_SCAN_TYPE_QUICK_SCAN"); add(id ? "DESC_INFOSCREEN_JOB_DEEPSCAN" : "DESC_INFOSCREEN_JOB_QUICKSCAN"); }
    else if (kind === "mission" && MISSION[id]) { name = L("CAPTION_MISSION_" + MISSION[id]); add("DESC_SHORT_INFOSCREEN_MISSION_" + MISSION[id]); add("DESC_MISSION_" + MISSION[id]); }
    else return null;
    return ps.length || name ? { name, paras: ps } : null;
  }
  // tooltip text (title attribute) for a thing on the page; "" when the game's texts are not available
  function tip(kind, id, subs) {
    const e = entry(kind, id, subs);
    return e ? (e.name ? e.name + "\n" : "") + e.paras.join("\n") : "";
  }

  // ---- loading ----------------------------------------------------------------------------------------------------------------------------
  function load() {
    if (loading) return loading;
    loading = fetch("/relay/loca?prefix=" + PREFIXES.join(",")).then(async (r) => {
      if (!r.ok) throw new Error(r.status === 404 ? "the relay has no data/loca_en.tsv (the game's text file)" : "the relay answered " + r.status);
      T = await r.json();
      window.dispatchEvent(new Event("gofa-help-ready"));
    }).catch((e) => { failed = e.message || String(e); });
    return loading;
  }

  // ---- the Help tab -----------------------------------------------------------------------------------------------------------------------
  function topics() {
    const E = (kind, ids) => ids.map((i) => entry(kind, i)).filter(Boolean);
    const raw = (name, keys) => ({ name: L(name), paras: [].concat(...keys.map((k) => paras(L(k)))) });
    return [
      { id: "start", title: "Getting started: the tutorial missions", intro: [],
        entries: TUTORIAL.map(([a, b]) => ({ name: L("ACHIEVEMENT_" + a), paras: paras(L("ACHIEVEMENT_" + a + "_DESC")).concat(L("TUTORIAL_" + b) ? ["Requirement: " + L("TUTORIAL_" + b).replace(/^\s*-\s*/, "")] : []) })) },
      { id: "structures", title: "Structures", intro: [], entries: E("struct", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) },
      { id: "resources", title: "Resources, troops and spy drones", intro: paras(L("DESC_INFOSCREEN_TYPE_TRADE")), entries: E("res", [1, 2, 3, 4, 5]) },
      { id: "ships", title: "Ships and carriers", intro: paras(L("DESC_SHIPYARD")), entries: E("ship", [1, 2, 3, 4, 5, 6, 8, 9]).concat(E("carrier", [1, 5, 9, 13])) },
      { id: "research", title: "Research", intro: paras(L("DESC_INFOSCREEN_TECH")).concat(paras(L("DESC_RESEARCH"))), entries: E("tech", [1, 2, 3, 5, 33, 30, 31, 32, 13, 15, 17, 11, 20, 22]) },
      { id: "skills", title: "Commander skills", intro: [], entries: E("skill", [13, 14, 25, 26, 27, 29, 24, 28, 23, 30, 16, 17, 18]) },
      { id: "scanning", title: "Scanning and missions",
        intro: [], entries: [raw("CAPTION_SCAN_TYPE_QUICK_SCAN", ["DESC_INFOSCREEN_JOB_QUICKSCAN"]), raw("CAPTION_SCAN_TYPE_DEEP_SCAN", ["DESC_INFOSCREEN_JOB_DEEPSCAN"]), raw("CAPTION_RESOURCE_SPY_PROBES", ["DESC_INFOSCREEN_TYPE_SPYDRONES"])]
          .concat(E("mission", Object.keys(MISSION).map(Number))) },
      { id: "items", title: "Items and artifacts", intro: paras(L("DESC_INFOSCREEN_SHOWROOM")), entries: E("item", ITEM_ORDER)
          .concat([raw("HEADER_INVENTORY_ITEM_ARTIFACT_RED", ["DESC_INFOSCREEN_ARTIFACT_RED"]), raw("HEADER_INVENTORY_ITEM_ARTIFACT_BLUE", ["DESC_INFOSCREEN_ARTIFACT_BLUE"]), raw("HEADER_INVENTORY_ITEM_ARTIFACT_YELLOW", ["DESC_INFOSCREEN_ARTIFACT_YELLOW"])]) },
      { id: "species", title: "Species", intro: [], entries: [raw("CAPTION_RACE_TYPE_TERRAN", ["DESC_INFOSCEEN_PROFILE_SPECIES_TERRAN"]), raw("CAPTION_RACE_TYPE_VOSSK", ["DESC_INFOSCREEN_PROFILE_SPECIES_VOSSK"]),
          raw("CAPTION_RACE_TYPE_NIVELIAN", ["DESC_INFOSCREEN_PROFILE_SPECIES_NIVELIAN"]), raw("CAPTION_RACE_TYPE_ROBOTS", ["DESC_INFOSCEEN_PROFILE_SPECIES_ROBOTS"])] },
      { id: "alliances", title: "Alliances and leaderboards", intro: [], entries: [raw("CAPTION_MY_ALLIANCE", ["DESC_INFOSCREEN_ALLIANCE_MY_ALLIANCE"]),
          raw("CAPTION_UPPER_COMMANDER_PROGRESS", ["DESC_INFOSCREEN_LEADERBOARDS_COMMANDER_PROGRESS"]), raw("CAPTION_UPPER_ALLIANCE_SIZE", ["DESC_INFOSCREEN_LEADERBOARDS_ALLIANCE_SIZE"]),
          raw("CAPTION_UPPER_ALLIANCE_LEVEL", ["DESC_INFOSCREEN_LEADERBOARDS_ALLIANCE_LEVEL"]), raw("CAPTION_UPPER_ALLIANCE_WARFARE", ["DESC_INFOSCREEN_LEADERBOARDS_ALLIANCE_WARFARE"])] } ];
  }
  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function render(host) {
    host.textContent = "";
    if (!T) {
      host.append(el("p", failed ? "bad" : "muted", failed ? "The game's help texts are not available: " + failed + "." : "Loading the game's help texts …"));
      if (!failed) load().then(() => render(host)); else host.append(el("p", "muted small", "They are read from data/loca_en.tsv (your own copy of the game's text) by the relay; start the relay from the project folder."));
      return;
    }
    host.append(el("h2", "", "Help"));
    host.append(el("p", "muted small", "The game's own wording (its info screens, tutorial missions and item texts). The buildings, ships, techs, skills, items and missions on the other pages show the same text as a tooltip when you hold the pointer over them. Numbers are not repeated here: the pages show the real ones from the server."));
    const search = el("input"); search.type = "text"; search.placeholder = "Search the help texts …"; search.autocomplete = "off"; search.setAttribute("aria-label", "Search the help texts");
    host.append(search);
    const body = el("div"); host.append(body);
    const data = topics();
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      body.textContent = ""; let shown = 0;
      for (const t of data) {
        const hits = t.entries.filter((e) => !q || (e.name + " " + e.paras.join(" ")).toLowerCase().includes(q));
        const introHit = t.intro.length && (!q || t.intro.join(" ").toLowerCase().includes(q) || t.title.toLowerCase().includes(q));
        if (!hits.length && !introHit) continue;
        shown += hits.length;
        const det = el("details", "card helptopic"); det.style.marginTop = "10px";
        det.open = !!q || t.id === "start" ? true : false;
        const sum = el("summary", "", t.title + " (" + t.entries.length + ")"); sum.style.cursor = "pointer"; sum.style.fontWeight = "600";
        det.append(sum);
        for (const p of t.intro) det.append(el("p", "muted small", p));
        for (const e of hits) {
          const box = el("div"); box.style.padding = "8px 0 2px"; box.style.borderTop = "1px solid var(--line)"; box.style.marginTop = "8px";
          if (e.name) { const n = el("div", "name", e.name); n.style.fontWeight = "600"; box.append(n); }
          for (const p of e.paras) { const pe = el("p", "", p); pe.style.margin = "4px 0"; box.append(pe); }
          det.append(box);
        }
        body.append(det);
      }
      if (!body.children.length) body.append(el("p", "muted", "Nothing found for “" + search.value.trim() + "”."));
    };
    search.oninput = draw; draw();
  }

  window.GoFAHelp = { load, tip, entry, render, get ready() { return !!T; } };
  window.addEventListener("DOMContentLoaded", load);
})();
