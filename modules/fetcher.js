'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { CFG, buildNtopPath, log } = require('../config');

/**
 * Performs the ntop GET request, saves a raw snapshot to disk, and
 * returns the parsed JSON.
 *
 * Throws 'SESSION_EXPIRED' if ntop redirects to the login page.
 * @returns {Promise<{json: object, rawFile: string}>}
 */
function fetchNtop() {
  return new Promise((resolve, reject) => {
    const ntopPath = buildNtopPath();

    const opts = {
      hostname          : CFG.ntopHost,
      path              : ntopPath,
      method            : 'GET',
      rejectUnauthorized: false,
      headers: {
        'Cookie'          : CFG.cookie,
        'Accept'          : '*/*',
        'User-Agent'      : 'NetFlowGlobe/2.0 (node.js)',
        'Accept-Encoding' : 'identity',
      },
    };

    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');

        // Detect session expiry — ntop returns a redirect or login HTML
        if (
          res.statusCode === 302 ||
          body.includes('<title>Login</title>') ||
          body.includes('/lua/login.lua')
        ) {
          return reject(new Error('SESSION_EXPIRED'));
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 120)}`));
        }

        // ── Persist raw snapshot ───────────────────────────────
        const ts      = Date.now();
        const rawFile = path.join(CFG.dataDir, `raw_${ts}.json`);
        try {
          fs.writeFileSync(rawFile, body, 'utf8');
          log(`Saved raw → ${path.basename(rawFile)}  (${body.length} B)`);

          // Rotate old snapshots — keep last CFG.rawKeep
          const raws = fs.readdirSync(CFG.dataDir)
            .filter(f => f.startsWith('raw_'))
            .sort();
          while (raws.length > CFG.rawKeep) {
            fs.unlinkSync(path.join(CFG.dataDir, raws.shift()));
          }
        } catch (ioErr) {
          log(`WARN: could not write raw snapshot — ${ioErr.message}`);
        }

        try {
          resolve({ json: JSON.parse(body), rawFile });
        } catch (e) {
          reject(new Error('JSON parse error: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error('ntop request timed out'));
    });
    req.end();
  });
}

module.exports = { fetchNtop };
