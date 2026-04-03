'use strict';

const https = require('https');
const { CFG, log } = require('../config');

/**
 * POST /authorize.html → extract session cookie from Set-Cookie header.
 * Updates CFG.cookie in-place so all subsequent requests use the new session.
 * @param {string} user
 * @param {string} pass
 * @returns {Promise<string>} the raw cookie value e.g. "session_3000_0=abc123"
 */
function loginNtop(user, pass) {
  return new Promise((resolve, reject) => {
    const body =
      `user=${encodeURIComponent(user)}` +
      `&referer=${encodeURIComponent(CFG.ntopHost + '/')}` +
      `&password=${encodeURIComponent(pass)}`;

    const opts = {
      hostname          : CFG.ntopHost,
      path              : '/authorize.html',
      method            : 'POST',
      rejectUnauthorized: false,
      headers: {
        'Content-Type'  : 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent'    : 'NetFlowGlobe/2.0 (node.js)',
        'Accept'        : 'text/html,*/*',
        'Cookie'        : 'session_3000_0=',
        'Origin'        : 'https://' + CFG.ntopHost,
        'Referer'       : 'https://' + CFG.ntopHost + '/lua/login.lua',
      },
    };

    const req = https.request(opts, res => {
      res.on('data', () => {});   // drain body
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'] || [];
        const sessionCookie = setCookie
          .map(c => c.split(';')[0].trim())
          .find(c => c.startsWith('session_3000_0='));

        if (!sessionCookie) {
          return reject(
            new Error(
              `Login failed — no session cookie returned (HTTP ${res.statusCode}). ` +
              `Check username/password.`
            )
          );
        }

        // Persist updated cookie globally
        CFG.cookie   = `tzoffset=19800; ${sessionCookie}`;
        CFG.ntopUser = user;
        CFG.ntopPass = pass;
        log(`Auth OK — ${sessionCookie.slice(0, 42)}…`);
        resolve(sessionCookie);
      });
    });

    req.on('error', reject);
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error('Login request timed out'));
    });
    req.write(body);
    req.end();
  });
}

module.exports = { loginNtop };
