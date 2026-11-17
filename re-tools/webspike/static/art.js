/* GoFAArt: the game's own UI art, taken from the owner's IPA in the browser. The file is read here (never uploaded), the images are kept as blob URLs and in
   IndexedDB (this browser only) so the import is done once. Without an import, port.js falls back to the local relay's /art/ui/ (development). */
(function () {
  "use strict";
  const urls = new Map(); let fontBuf = null, source = "none";
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open("gofa-art", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const get = async (k) => { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
  const put = async (k, v) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error || new Error("storage aborted")); }); };   // onabort too: an oversized value aborts without an error event
  const del = async () => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").clear(); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); };
  function install(list, font) { for (const [n, b] of list) urls.set(n, URL.createObjectURL(b)); if (font) fontBuf = font; }
  const G = window.GoFAArt = { url: (n) => urls.get(n) || null, get count() { return urls.size; }, get font() { return fontBuf; }, get source() { return source; }, ready: null };
  G.ready = (async () => { try { const list = await get("ui"), font = await get("font"); if (list && list.length) { install(list, font); source = "imported"; } } catch (e) { /* no storage here: import again next time */ } })();
  // the 3D scene file is kept as a Blob: Chrome refuses single values over ~127 MB (the scene is 175 MB); Blobs are stored as files
  G.fromIpa = (file, onProgress) => new Promise((resolve, reject) => {
    const w = new Worker("art-worker.js"), all = [];
    w.onmessage = (e) => {
      const m = e.data;
      if (m.error) { w.terminate(); reject(new Error(m.error)); }
      else if (m.batch) { all.push(...m.batch); if (onProgress) onProgress(m.done, m.total); }
      else if (m.finished) { w.terminate(); install(all, m.font); source = "imported"; (async () => { let kept = true; try { await put("ui", all); if (m.font) await put("font", m.font); if (m.scene3d) await put("scene3d", new Blob([m.scene3d])); } catch (err) { kept = false; } resolve({ count: urls.size, kept, scene3d: !!m.scene3d }); })(); }
      else if (m.stage && onProgress) onProgress(0, 0, m.stage);
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || "import failed")); };
    w.postMessage({ file });
  });
  /* The 3D scene from the imported IPA (assets_pvrtc/assets.ae3, kept in IndexedDB): scene-worker.js builds what gofa3d.js needs (ae3scene.js) and
     decodes textures on request. -> { scene, bin, rgba(name) } for GoFA3D.create(canvas, { source }), or null (port.js then uses the relay's /art/3d/). */
  let src3d = null;
  G.source3d = () => src3d || (src3d = (async () => {
    let buf = null; try { const b = await get("scene3d"); buf = b ? (b instanceof Blob ? await b.arrayBuffer() : b) : null; } catch (e) { /* no storage */ }
    if (!buf) return null;
    const w = new Worker("scene-worker.js"), wait = new Map(); let seq = 0, first = null;
    const ready = new Promise((res, rej) => { first = { res, rej }; });
    w.onmessage = (e) => { const m = e.data; if (m.built) first.res(m); else if (m.error && m.id == null) first.rej(new Error(m.error)); else if (wait.has(m.id)) { const p = wait.get(m.id); wait.delete(m.id); m.error ? p.rej(new Error(m.error)) : p.res(m.tex); } };
    w.postMessage({ buf }, [buf]);
    const m = await ready;
    return { scene: m.scene, bin: m.bin, rgba: (name) => new Promise((res, rej) => { const id = ++seq; wait.set(id, { res, rej }); w.postMessage({ id, name }); }) };
  })().catch((e) => { console.warn("3D scene from the IPA:", e); return null; }));
  G.forget = async () => { try { await del(); } catch (e) { /* nothing stored */ } for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); fontBuf = null; source = "none"; };
  document.addEventListener("DOMContentLoaded", () => {
    const inp = document.getElementById("artFile"), st = document.getElementById("artState"); if (!inp || !st) return;
    const show = () => { st.textContent = G.source === "imported" ? "imported from your IPA (" + G.count + " images, kept in this browser)" : "not imported (the local relay is used if it has the files)"; };
    G.ready.then(show);
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      try { const r = await G.fromIpa(f, (d, t, s) => { st.textContent = s ? s + " ..." : "converting images " + d + " / " + t; }); st.textContent = "imported " + r.count + " images" + (r.scene3d ? " and the 3D scene" : "") + (r.kept ? " (kept in this browser): reloading" : " (could not keep them, import again next visit)"); if (r.kept) setTimeout(() => location.reload(), 800); }
      catch (e) { st.textContent = "import failed: " + e.message; }
      inp.value = "";
    };
    const fg = document.getElementById("artForget"); if (fg) fg.onclick = async () => { await G.forget(); show(); location.reload(); };
  });
})();
