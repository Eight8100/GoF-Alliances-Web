/* Worker: holds the owner's own 3D scene file (assets.ae3 from their IPA, kept by art.js in IndexedDB), builds the scene for gofa3d.js with ae3scene.js and
   decodes textures when the renderer asks for them (RGBA buffers, transferred). Nothing leaves the browser. */
importScripts("ae3scene.js");
let S = null;
self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.buf) { S = self.GoFAScene.build(new Uint8Array(m.buf)); const bin = S.bin.buffer; postMessage({ built: true, scene: S.scene, bin }, [bin]); return; }
    if (m.name) { const t = S.rgba(m.name); postMessage({ id: m.id, tex: t }, [t.data.buffer]); }
  } catch (err) { postMessage({ id: m.id, error: String(err && err.message || err) }); }
};
