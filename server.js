'use strict';

/**
 * NetFlow Globe v2 — Entry Point
 *
 * Module layout:
 *   config.js              Shared config + dynamic query params
 *   modules/auth.js        POST login → session cookie
 *   modules/fetcher.js     HTTPS GET from ntop → raw JSON + disk snapshot
 *   modules/extractor.js   Parse flows, extract IPs
 *   modules/geo.js         Batch geo-lookup via ip-api.com, persistent cache
 *   modules/dns.js         Async reverse DNS, persistent cache
 *   modules/websocket.js   Frame encoder, broadcast, WS upgrade handler
 *   modules/httpServer.js  HTTP server + all /api/* routes
 *   public/index.html      Globe UI (served by httpServer)
 */

const fs   = require('fs');
const path = require('path');

const { CFG, QPARAMS, log } = require('./config');
const { loginNtop }          = require('./modules/auth');
const { fetchNtop }          = require('./modules/fetcher');
const { extractFlows }       = require('./modules/extractor');
const { enrichWithGeo }      = require('./modules/geo');
const { queueDns, attachHostnames, dnsCache } = require('./modules/dns');
const { fetchIfStats }       = require('./modules/ifstats');
const { broadcast, clients } = require('./modules/websocket');
const { createServer }       = require('./modules/httpServer');

// Ensure data directory exists (important when mounted as Docker volume)
fs.mkdirSync(CFG.dataDir, { recursive: true });

// ─────────────────────────────────────────────────────────────
//  POLL LOOP
// ─────────────────────────────────────────────────────────────
let autoLoginBusy = false;

async function poll() {
  try {
    // Step 1 — fetch flows + interface stats in parallel
    const [{ json }, ifStats] = await Promise.all([
      fetchNtop(),
      fetchIfStats(),
    ]);

    // Step 2 — extract IPs + flow metadata
    const flowData   = extractFlows(json);

    // Step 3 — geo enrichment
    const enriched   = await enrichWithGeo(flowData);

    // Step 3b — async DNS (fire-and-forget, results trickle in over polls)
    queueDns(enriched.flows);

    // Attach whatever hostnames are already cached this poll
    attachHostnames(enriched.flows);

    // Persist enriched snapshot
    fs.writeFileSync(
      path.join(CFG.dataDir, 'flows_latest.json'),
      JSON.stringify(enriched, null, 2)
    );

    // Step 4 — broadcast flows
    broadcast({ type: 'flows', data: enriched });

    // Step 5 — broadcast interface stats (if fetch succeeded)
    if (ifStats) {
      broadcast({ type: 'ifstats', data: ifStats });
    }

    log(
      `Poll OK — ${enriched.flows.length} flows` +
      ` [${QPARAMS.proto.toUpperCase()} ifid=${QPARAMS.ifid}]` +
      (ifStats ? ` | ${ifStats.ifname} ↑${ifStats.upload_mbps}Mbps ↓${ifStats.download_mbps}Mbps` : '') +
      ` dns=${dnsCache.size} clients=${clients.size}`
    );

  } catch (err) {
    log(`Poll error: ${err.message}`);

    if (err.message === 'SESSION_EXPIRED' && !autoLoginBusy) {
      // Auto re-login with stored credentials
      autoLoginBusy = true;
      log(`Session expired — auto re-login as ${CFG.ntopUser}…`);
      broadcast({ type: 'error', message: 'SESSION_EXPIRED', sessionExpired: true });

      try {
        await loginNtop(CFG.ntopUser, CFG.ntopPass);
        broadcast({ type: 'session_ok' });
        log('Auto re-login succeeded');
      } catch (loginErr) {
        log(`Auto re-login failed: ${loginErr.message}`);
        broadcast({ type: 'error', message: `Auto re-login failed: ${loginErr.message}` });
      } finally {
        autoLoginBusy = false;
      }
    } else if (err.message !== 'SESSION_EXPIRED') {
      broadcast({ type: 'error', message: err.message });
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  STARTUP
// ─────────────────────────────────────────────────────────────
async function start() {
  log('─────────────────────────────────────────');
  log(' NetFlow Globe v2');
  log(` ntop    →  https://${CFG.ntopHost}`);
  log(` UI      →  http://localhost:${CFG.port}`);
  log(` Data    →  ${CFG.dataDir}`);
  log(` Poll    →  every ${CFG.pollMs}ms`);
  log(` Proto   →  ${QPARAMS.proto.toUpperCase()}, ifid=${QPARAMS.ifid}`);
  log('─────────────────────────────────────────');

  // Create and start HTTP + WS server
  const server = createServer();
  server.listen(CFG.port, () => {
    log(`Server listening on :${CFG.port}`);
  });

  // Initial login to get a fresh session cookie
  try {
    log(`Logging in to ntop as "${CFG.ntopUser}"…`);
    await loginNtop(CFG.ntopUser, CFG.ntopPass);
  } catch (e) {
    log(`Initial login failed (${e.message}) — will retry on first poll`);
  }

  // Start polling
  await poll();
  setInterval(poll, CFG.pollMs);
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
