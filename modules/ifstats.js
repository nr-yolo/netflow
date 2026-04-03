'use strict';

const https = require('https');
const { CFG, QPARAMS, log } = require('../config');

/**
 * Fetches interface summary from:
 *   GET /lua/rest/v2/get/interface/data.lua?ifid=<N>&type=summary
 *
 * Returns a normalised stats object:
 * {
 *   ifid, ifname,
 *   num_devices, num_hosts, num_local_hosts,
 *   num_flows, alerted_flows,
 *   upload_bps, download_bps,          ← raw bps from ntop
 *   upload_mbps, download_mbps,         ← converted for display
 *   throughput_bps,
 *   drops, uptime, localtime,
 *   timestamp
 * }
 */
function fetchIfStats() {
  return new Promise((resolve, reject) => {
    const ifid = QPARAMS.ifid || '0';
    const opts = {
      hostname          : CFG.ntopHost,
      path              : `/lua/rest/v2/get/interface/data.lua?ifid=${encodeURIComponent(ifid)}&type=summary`,
      method            : 'GET',
      rejectUnauthorized: false,
      headers: {
        'Cookie'          : CFG.cookie,
        'Accept'          : 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent'      : 'NetFlowGlobe/2.0 (node.js)',
        'Accept-Encoding' : 'identity',
      },
    };

    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');

        if (res.statusCode === 302 ||
            body.includes('/lua/login.lua') ||
            body.includes('<title>Login</title>')) {
          // Session expired — the flows poll will handle re-login
          return resolve(null);
        }

        try {
          const json = JSON.parse(body);
          if (json.rc !== 0) {
            log(`ifstats: non-zero rc=${json.rc} for ifid=${ifid}`);
            return resolve(null);
          }

          const r   = json.rsp || {};
          const thr = r.throughput || {};

          // ntop returns upload/download in bps — convert to Mbps
          const toBps  = v => (typeof v === 'number' ? v : 0);
          const toMbps = v => (toBps(v) / 1_000_000).toFixed(2);

          const stats = {
            ifid           : r.ifid       || ifid,
            ifname         : r.ifname     || `if${ifid}`,
            num_devices    : r.num_devices        || 0,
            num_hosts      : r.num_hosts          || 0,
            num_local_hosts: r.num_local_hosts    || 0,
            num_flows      : r.num_flows          || 0,
            alerted_flows  : r.alerted_flows      || 0,
            drops          : r.drops              || 0,
            uptime         : r.uptime             || '—',
            localtime      : r.localtime          || '—',
            upload_bps     : toBps(thr.upload),
            download_bps   : toBps(thr.download),
            upload_mbps    : toMbps(thr.upload),
            download_mbps  : toMbps(thr.download),
            throughput_bps : toBps(r.throughput_bps),
            timestamp      : new Date().toISOString(),
          };

          resolve(stats);
        } catch (e) {
          log(`ifstats: JSON parse error — ${e.message}`);
          resolve(null);
        }
      });
    });

    req.on('error', err => {
      log(`ifstats: request error — ${err.message}`);
      resolve(null);   // non-fatal — resolve null so poll continues
    });
    req.setTimeout(8_000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

module.exports = { fetchIfStats };
