'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { CFG, log } = require('../config');

// ── In-memory cache (also persisted to disk) ─────────────────────
const geoCache    = new Map();
const CACHE_FILE  = path.join(CFG.dataDir, 'geo_cache.json');

function _loadCache() {
  if (!fs.existsSync(CACHE_FILE)) return;
  try {
    const saved = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    for (const [ip, geo] of Object.entries(saved)) geoCache.set(ip, geo);
    log(`Geo cache: loaded ${geoCache.size} entries`);
  } catch (e) {
    log(`WARN: could not load geo cache — ${e.message}`);
  }
}

function _saveCache() {
  try {
    const obj = Object.fromEntries(geoCache);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) { /* best-effort */ }
}

_loadCache();

// ── Helpers ───────────────────────────────────────────────────────
function isPrivateIP(ip) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|0\.0\.0\.0)/.test(ip);
}

function homeGeo() {
  return {
    lat    : CFG.homeLat,
    lon    : CFG.homeLon,
    country: 'India',
    city   : 'Home (Private)',
  };
}

// ── ip-api.com batch request (max 100 IPs per call, free tier) ───
function _lookupBatch(ips) {
  return new Promise(resolve => {
    const body = JSON.stringify(ips.map(ip => ({ query: ip })));
    const opts = {
      hostname: 'ip-api.com',
      path    : '/batch?fields=query,lat,lon,country,city,status',
      method  : 'POST',
      headers : {
        'Content-Type'  : 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const list = JSON.parse(Buffer.concat(chunks).toString());
          for (const d of list) {
            if (d.status === 'success') {
              geoCache.set(d.query, {
                lat: d.lat, lon: d.lon,
                country: d.country, city: d.city,
              });
            }
          }
          _saveCache();
        } catch (e) { /* ignore parse errors */ }
        resolve();
      });
    });

    req.on('error', () => resolve());
    req.setTimeout(6_000, () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

// ── Public: enrich flow list with geo coords ──────────────────────
async function enrichWithGeo(flowData) {
  // Collect public IPs not yet in cache
  const needed = flowData.extractedIPs.filter(
    ip => !isPrivateIP(ip) && !geoCache.has(ip)
  );

  if (needed.length > 0) {
    log(`Geo lookup: ${needed.length} new IPs`);
    for (let i = 0; i < needed.length; i += 100) {
      await _lookupBatch(needed.slice(i, i + 100));
    }
  }

  // Attach geo to each flow
  for (const f of flowData.flows) {
    f.srcGeo = isPrivateIP(f.srcIp) ? homeGeo() : (geoCache.get(f.srcIp) || null);
    f.dstGeo = isPrivateIP(f.dstIp) ? homeGeo() : (geoCache.get(f.dstIp) || null);
  }

  return flowData;
}

module.exports = { enrichWithGeo, isPrivateIP, geoCache };
