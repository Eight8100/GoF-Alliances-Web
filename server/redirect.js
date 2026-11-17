// Points every lookup of a dead Fishlabs host at the local server by rewriting the
// hostname passed to getaddrinfo (the binary is stripped, so libcurl can't be hooked by name).
// Also logs every host the game looks up.
const TARGET = '__TARGET__';  // filled in by launch.py (netconf.server_host)
const DEAD_HOSTS = /(^|\.)fishlegion\.net$|^dominion-game/;
const keep = [];

const gai = Module.getExportByName('libsystem_info.dylib', 'getaddrinfo');
Interceptor.attach(gai, {
  onEnter(args) {
    if (args[0].isNull()) return;
    const host = args[0].readUtf8String();
    if (/exitgamescloud\.com$|exitgames\.com$/.test(host)) {
      // Photon chat name server -> our photon_chat.py on the USB link (port kept, 5058).
      const s = Memory.allocUtf8String(TARGET);
      keep.push(s); if (keep.length > 64) keep.shift();
      args[0] = s;
      let serv = null;
      try { serv = args[1].isNull() ? null : args[1].readUtf8String(); } catch (e) { }
      send({ lookup: host, redirected: TARGET, serv: serv, photon: 1 });
    } else if (DEAD_HOSTS.test(host)) {
      const s = Memory.allocUtf8String(TARGET);
      keep.push(s);
      if (keep.length > 64) keep.shift();
      args[0] = s;
      // Port mapping without hooking connect(): the server listens on the USB link at __PORT__.
      let serv = null;
      try { serv = args[1].isNull() ? null : args[1].readUtf8String(); } catch (e) { }
      if (serv === null || serv === '80' || serv === 'http') {
        const p = Memory.allocUtf8String(String(__PORT__));
        keep.push(p);
        args[1] = p;
      }
      send({ lookup: host, redirected: TARGET, serv: serv });
    } else {
      send({ lookup: host });
    }
  }
});
send({ ready: gai.toString() });

// Port mapping: rewrite every Fishlabs URL to the USB link + server port before CFNetwork sees it
// (the hostname lookup carries no port, so the getaddrinfo hook alone ends up on port 80).
const URL_RE = /^http:\/\/[a-z0-9.-]*(fishlegion\.net|dominion-game[a-z0-9-]*)(:\d+)?\//;
const urlKeep = [];
Interceptor.attach(ObjC.classes.NSURL['+ URLWithString:'].implementation, {
  onEnter(args) {
    try {
      const s = new ObjC.Object(args[2]).toString();
      if (URL_RE.test(s)) {
        const n = ObjC.classes.NSString.stringWithString_(s.replace(URL_RE, 'http://' + TARGET + ':' + __PORT__ + '/'));
        n.retain(); urlKeep.push(n); if (urlKeep.length > 256) urlKeep.shift().release();
        args[2] = n;
        send({ url: s, now: n.toString() });
      }
    } catch (e) { }
  }
});

// Photon SDK may resolve with gethostbyname instead of getaddrinfo.
try {
  const ghb = Module.getExportByName('libsystem_info.dylib', 'gethostbyname');
  Interceptor.attach(ghb, {
    onEnter(args) {
      if (args[0].isNull()) return;
      const host = args[0].readUtf8String();
      if (/exitgames(cloud)?\.com$/.test(host)) {
        const s = Memory.allocUtf8String(TARGET); keep.push(s); args[0] = s;
        send({ ghbn: host, redirected: TARGET, photon: 1 });
      } else send({ ghbn: host });
    }
  });
} catch (e) { send({ ghbn_err: String(e) }); }
