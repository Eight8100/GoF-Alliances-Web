/* Dev jump link (a test helper, no game logic): open the page as http://localhost:8765/?x=1#screen=NAME[:ARG]&overlay=1[&name=Pilot]
   and it logs in, switches to the Original look and opens the screen, optionally with the reference overlay (the R key). Screens:
   planet | messages | commander:0..3 (profile, skills, items, achievements) | settings | accounts | tutorial[:list] | leaderboards[:0..3] | squad | options | chat | planets | fleets | structures | galaxy[:mode,x,y,k]
   Change the query (?x=2) between runs: a hash-only change does not reload the page. Extra steps after the screen opens: &click=TITLE clicks the first image / div with that title. */
(function () {
  "use strict";
  const h = new URLSearchParams(location.hash.slice(1)), screen = h.get("screen");
  if (!screen) return;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, ms) { const t = Date.now(); while (Date.now() - t < (ms || 20000)) { const v = fn(); if (v) return v; await wait(150); } return null; }
  window.addEventListener("load", async () => {
    try {
      if (!(await until(() => window.GoFA && typeof document.getElementById("loginform").onsubmit === "function"))) return console.warn("devjump: the login form is not ready (relay not answering?)");   // app.js binds the handler after /relay/info
      const alias = document.getElementById("alias"); if (alias && h.get("name")) alias.value = h.get("name");
      const btn = document.getElementById("loginbtn"); if (btn) btn.click();
      if (!(await until(() => window.GoFA && window.GoFA.S.me && window.GoFA.S.lv && window.GoFA.S.planets.size))) return console.warn("devjump: login did not finish");
      document.getElementById("tabPort").click();
      const P = await until(() => window.GoFAPort && document.getElementById("pPortrait") && window.GoFAPort);
      if (!P) return console.warn("devjump: the Original look did not open");
      await wait(1500);
      const [name, arg] = screen.split(":");
      const open = { planet: () => 0, messages: () => P.openMessages(), commander: () => P.openCommander(Number(arg) || 0), settings: () => P.openSettings(), accounts: () => P.openAccounts && P.openAccounts(),
        tutorial: () => P.openTutorial(arg === "list" ? "list" : undefined), leaderboards: () => P.openLeaderboards(Number(arg) || 0), squad: () => P.openSquad(), options: () => P.openOptions(), chat: () => P.openChat(), planets: () => P.openPlanetList(), fleets: () => P.openFleets(), structures: () => P.openStructureList(),
        galaxy: () => P.openGalaxy(arg) }[name];
      if (!open) return console.warn("devjump: unknown screen " + name);
      open(); await wait(1800);
      const click = h.get("click"); if (click) { const el = [...document.querySelectorAll("#port img, #port div")].find((e) => e.title === click); if (el) { el.click(); await wait(1500); } else console.warn("devjump: nothing titled " + click); }
      if (h.get("overlay")) window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
      document.title = "devjump ready: " + screen;
    } catch (e) { console.warn("devjump: " + e.message); }
  });
})();
