/* Worker: reads the owner's own IPA (a File chosen in the page; it never leaves the browser), finds the high-resolution UI texture container and the UI font,
   turns every raw RGBA image into a PNG blob and posts them back in batches. See ae3lib.js and docs/WEB_APP_CONCEPT.md section 5b. */
importScripts("ae3lib.js", "aua-names.js");
self.onmessage = async (e) => {
  try {
    const file = e.data.file, L = self.GoFAAe3;
    postMessage({ stage: "reading the archive" });
    const f = await L.findArt(file);
    if (!f.ui) throw new Error("No UI texture file inside: this is not the Galaxy on Fire: Alliances 1.16.1 IPA.");
    postMessage({ stage: "unpacking the textures" });
    const d = await L.readEntry(file, f.ui), tex = L.textures(d);
    const font = f.font ? (await L.readEntry(file, f.font)).buffer : null;
    let batch = [];
    for (let i = 0; i < tex.length; i++) {
      const t = tex[i], img = new ImageData(new Uint8ClampedArray(d.buffer, d.byteOffset + t.offset, t.length), t.width, t.height);
      const cv = new OffscreenCanvas(t.width, t.height); cv.getContext("2d").putImageData(img, 0, 0);
      batch.push([t.name, await cv.convertToBlob({ type: "image/png" })]);
      if (batch.length >= 50 || i === tex.length - 1) { postMessage({ batch, done: i + 1, total: tex.length }); batch = []; }
    }
    // the .aua companion (portraits, item cards, flags): JPEG decoded by the browser + LZ4 alpha, or LZ4 RGB(A); named as the relay names them
    if (f.aua) {
      postMessage({ stage: "unpacking the portraits and cards" });
      const ad = await L.readEntry(file, f.aua), recs = L.auaRecords(ad), names = self.GoFAAuaNames || {}, have = new Set(tex.map((t) => t.name));
      batch = [];
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i], w = r.width, h = r.height, name = names[r.key] || "aua_" + r.key;
        try {
          let rgba;
          if (r.type === 0 || r.type === 1) {
            let j = 0; while (j + 1 < r.p1.length && !(r.p1[j] === 0xff && r.p1[j + 1] === 0xd8)) j++;   // the JPEG starts after 128 zero bytes
            const bmp = await createImageBitmap(new Blob([r.p1.subarray(j)], { type: "image/jpeg" })), jw = bmp.width, jh = bmp.height;
            const c0 = new OffscreenCanvas(jw, jh), x0 = c0.getContext("2d"); x0.drawImage(bmp, 0, 0); bmp.close();
            const px = x0.getImageData(0, 0, jw, jh).data, a = r.type === 1 ? L.lz4Block(r.p2, jw * jh) : null;   // the alpha plane has the JPEG's (padded) size
            rgba = new Uint8ClampedArray(w * h * 4);
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s0 = (y * jw + x) * 4, d0 = (y * w + x) * 4; rgba[d0] = px[s0]; rgba[d0 + 1] = px[s0 + 1]; rgba[d0 + 2] = px[s0 + 2]; rgba[d0 + 3] = a ? a[y * jw + x] : 255; }
          } else if (r.type === 2) {
            const rgb = L.lz4Block(r.p1, w * h * 3); rgba = new Uint8ClampedArray(w * h * 4);
            for (let k = 0; k < w * h; k++) { rgba[k * 4] = rgb[k * 3]; rgba[k * 4 + 1] = rgb[k * 3 + 1]; rgba[k * 4 + 2] = rgb[k * 3 + 2]; rgba[k * 4 + 3] = 255; }
          } else if (r.type === 3) rgba = new Uint8ClampedArray(L.lz4Block(r.p1, w * h * 4).buffer);
          else throw new Error("type " + r.type);
          if (!have.has(name)) { const cv = new OffscreenCanvas(w, h); cv.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0); batch.push([name, await cv.convertToBlob({ type: "image/png" })]); }   // the .ae3 image wins on a name clash, as in the relay
        } catch (err) { /* one bad record must not stop the import */ }
        if (batch.length >= 50 || i === recs.length - 1) { postMessage({ batch, done: tex.length + i + 1, total: tex.length + recs.length }); batch = []; }
      }
    }
    let scene3d = null;   // the 3D scene file (175 MB): passed on as it is; art.js keeps it and scene-worker.js reads it
    if (f.scene) { postMessage({ stage: "unpacking the 3D scene" }); scene3d = (await L.readEntry(file, f.scene)).buffer; }
    postMessage({ finished: true, font, scene3d }, [font, scene3d].filter(Boolean));
  } catch (err) { postMessage({ error: String(err && err.message || err) }); }
};
