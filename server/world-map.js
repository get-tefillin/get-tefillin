"use strict";
// Anonymous, approximate positions only. Cluster before sending, not in every browser.
exports.view = function (points, b, z) {
  const size = 256 * Math.pow(2, z), cells = new Map();
  points.forEach(function (p) {
    if (p.lat < b[1] || p.lat > b[3]) return;
    if (b[0] <= b[2] ? (p.lng < b[0] || p.lng > b[2]) : (p.lng < b[0] && p.lng > b[2])) return;
    const sin = Math.sin(Math.max(-85, Math.min(85, p.lat)) * Math.PI / 180);
    const x = (p.lng + 180) / 360 * size, y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size;
    const key = Math.floor(x / 64) + ":" + Math.floor(y / 64);
    let c = cells.get(key);
    if (!c) { c = { lat: 0, lng: 0, count: 0 }; cells.set(key, c); }
    c.lat += p.lat; c.lng += p.lng; c.count++;
  });
  return Array.from(cells.values()).map(function (c) { return { lat: +(c.lat / c.count).toFixed(2), lng: +(c.lng / c.count).toFixed(2), count: c.count }; });
};
