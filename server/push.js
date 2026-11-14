"use strict";
/* Get Tefillin replica — Web Push (RFC 8291 payload encryption "aes128gcm" + RFC 8292 VAPID),
   implemented on the Node.js standard library only (no npm dependencies).
   VAPID keys are generated once and stored in config.json. */

const crypto = require("crypto");
const https = require("https");
const http = require("http");
const { URL } = require("url");

function b64u(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64u(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

/* ---- VAPID keypair (P-256). Stored as raw point bytes in config. ---- */
function generateVapid() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pubJwk = publicKey.export({ format: "jwk" });
  const privJwk = privateKey.export({ format: "jwk" });
  return {
    pub: b64u(Buffer.concat([Buffer.from([4]), fromB64u(pubJwk.x), fromB64u(pubJwk.y)])),
    x: pubJwk.x, y: pubJwk.y, d: privJwk.d
  };
}
function privateKeyFrom(cfg) {
  return crypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", x: cfg.x, y: cfg.y, d: cfg.d }, format: "jwk" });
}

/* ---- VAPID JWT (ES256) ---- */
function vapidJwt(endpoint, privKeyObj, contact) {
  const u = new URL(endpoint);
  const aud = u.origin;
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64u(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: contact || "mailto:admin@example.com"
  }));
  const unsigned = header + "." + payload;
  const sig = crypto.sign("sha256", Buffer.from(unsigned), { key: privKeyObj, dsaEncoding: "ieee-p1363" });
  return unsigned + "." + b64u(sig);
}

/* ---- payload encryption (aes128gcm) ---- */
function encryptPayload(sub, plaintext) {
  const uaPublic = fromB64u(sub.keys.p256dh); // 65 bytes, uncompressed
  const auth = fromB64u(sub.keys.auth);       // 16 bytes

  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();       // uncompressed 65 bytes
  const secret = ecdh.computeSecret(uaPublic);

  // RFC 8291 §3.3: IKM derivation
  const prkKey = crypto.createHmac("sha256", auth).update(secret).digest();
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), uaPublic, asPublic]);
  const ikm = crypto.createHmac("sha256", prkKey).update(Buffer.concat([keyInfo, Buffer.from([1])])).digest();

  // RFC 8188: salt + content-coding header
  const salt = crypto.randomBytes(16);
  const prk = crypto.createHmac("sha256", salt).update(ikm).digest();
  const cek = crypto.createHmac("sha256", prk).update(Buffer.from("Content-Encoding: aes128gcm\0\x01", "utf8")).digest().slice(0, 16);
  const nonce = crypto.createHmac("sha256", prk).update(Buffer.from("Content-Encoding: nonce\0\x01", "utf8")).digest().slice(0, 12);

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const data = Buffer.concat([Buffer.from(plaintext, "utf8"), Buffer.from([2])]); // 0x02 = last-record delimiter
  const enc = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096, 0);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, enc]);
}

/* ---- send one notification. Returns a promise of {ok, status}. ---- */
function sendOne(vapidCfg, sub, payloadObj, contact) {
  return new Promise((resolve) => {
    try {
      const body = encryptPayload(sub, JSON.stringify(payloadObj));
      const jwt = vapidJwt(sub.endpoint, privateKeyFrom(vapidCfg), contact);
      const u = new URL(sub.endpoint);
      const lib = u.protocol === "http:" ? http : https;
      const req = lib.request({
        method: "POST",
        hostname: u.hostname,
        port: u.port || (u.protocol === "http:" ? 80 : 443),
        path: u.pathname + u.search,
        headers: {
          "content-length": body.length,
          "content-encoding": "aes128gcm",
          "ttl": "2419200",
          "urgency": "high",
          "authorization": "vapid t=" + jwt + ", k=" + vapidCfg.pub
        },
        timeout: 15000
      }, (res) => {
        res.resume();
        res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode }));
      });
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: 0 }); });
      req.on("error", () => resolve({ ok: false, status: 0 }));
      req.write(body);
      req.end();
    } catch (e) {
      resolve({ ok: false, status: 0 });
    }
  });
}

/* Send to every subscription of a shaliach; drop subscriptions the service says are gone (404/410). */
async function sendToShaliach(vapidCfg, shaliach, payloadObj, contact, onGone) {
  const subs = shaliach.push || [];
  let sent = 0;
  for (const sub of subs.slice()) {
    const r = await sendOne(vapidCfg, sub, payloadObj, contact);
    if (r.ok) sent++;
    else if ((r.status === 404 || r.status === 410) && onGone) onGone(sub);
  }
  return sent;
}

module.exports = { generateVapid, sendToShaliach, b64u, fromB64u };
