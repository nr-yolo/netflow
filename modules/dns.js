'use strict';

const dns  = require('dns');
const fs   = require('fs');
const path = require('path');
const { CFG, log } = require('../config');
const { isPrivateIP } = require('./geo');

// ── Cache ─────────────────────────────────────────────────────────
const dnsCache    = new Map();   // ip → hostname | null
const CACHE_FILE  = path.join(CFG.dataDir, 'dns_cache.json');
const pending     = new Set();   // IPs currently being resolved

function _loadCache() {
  if (!fs.existsSync(CACHE_FILE)) return;
  try {
    const saved = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    for (const [ip, host] of Object.entries(saved)) dnsCache.set(ip, host);
    log(`DNS cache: loaded ${dnsCache.size} entries`);
  } catch (e) {
    log(`WARN: could not load DNS cache — ${e.message}`);
  }
}

function _saveCache() {
  try {
    const obj = Object.fromEntries(dnsCache);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) { /* best-effort */ }
}

_loadCache();

// ── Single reverse-DNS lookup (non-blocking, results accumulate) ──
function reverseDns(ip) {
  if (dnsCache.has(ip) || pending.has(ip)) return;
  pending.add(ip);

  dns.reverse(ip, (err, hostnames) => {
    pending.delete(ip);
    if (!err && hostnames?.length) {
      dnsCache.set(ip, hostnames[0].replace(/\.$/, ''));
    } else {
      dnsCache.set(ip, null);   // cache the miss — don't retry every poll
    }
    _saveCache();
  });
}

// Resolve all IPs in a batch — private IPs are included so local device
// hostnames (which reveal the OS) are captured
function queueDns(flows) {
  for (const f of flows) {
    if (f.srcIp) reverseDns(f.srcIp);
    if (f.dstIp) reverseDns(f.dstIp);
  }
}

// ── Hostname resolution priority ──────────────────────────────────
// 1. ntop's own name field (NetBIOS / mDNS — best for local devices)
// 2. Reverse DNS result
// 3. Raw IP as fallback
function _resolveHost(ip, ntopName) {
  const fromNtop = ntopName && ntopName !== ip ? ntopName : null;
  const fromDns  = dnsCache.get(ip) || null;
  return fromNtop || fromDns || ip;
}

function attachHostnames(flows) {
  for (const f of flows) {
    f.srcHost = _resolveHost(f.srcIp, f.srcName);
    f.dstHost = _resolveHost(f.dstIp, f.dstName);
  }
}

module.exports = { queueDns, attachHostnames, dnsCache };
