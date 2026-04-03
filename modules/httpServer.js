'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const { CFG, QPARAMS, log } = require('../config');
const { loginNtop }          = require('./auth');
const { broadcast, handleUpgrade } = require('./websocket');

// ── Serve the pre-loaded index.html ──────────────────────────────
// Read once at startup; Docker COPY ensures the file is always present.
let indexHtml = '';
function loadIndexHtml() {
  const p = path.join(CFG.publicDir, 'index.html');
  indexHtml = fs.readFileSync(p, 'utf8');
  log(`Loaded public/index.html (${indexHtml.length} bytes)`);
}

// ── Utility: read the full request body ──────────────────────────
function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

// ── HTTP server ───────────────────────────────────────────────────
function createServer() {
  loadIndexHtml();

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://localhost:${CFG.port}`);

    // ── Frontend ────────────────────────────────────────────────
    if (u.pathname === '/' || u.pathname === '/index.html') {
      res.writeHead(200, {
        'Content-Type' : 'text/html',
        'Cache-Control': 'no-cache',
      });
      res.end(indexHtml);
      return;
    }

    // ── POST /api/renew-session ─────────────────────────────────
    if (u.pathname === '/api/renew-session' && req.method === 'POST') {
      try {
        const { user, pass } = JSON.parse(await readBody(req));
        if (!user || !pass) throw new Error('Missing user or pass');
        const cookie = await loginNtop(user, pass);
        broadcast({ type: 'session_ok' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, cookie }));
      } catch (e) {
        log(`Renew-session error: ${e.message}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    // ── POST /api/set-params ────────────────────────────────────
    if (u.pathname === '/api/set-params' && req.method === 'POST') {
      try {
        const params = JSON.parse(await readBody(req));
        if (params.ifid   != null) QPARAMS.ifid   = String(params.ifid);
        if (params.length != null) QPARAMS.length = String(params.length);
        if (params.proto  != null) QPARAMS.proto  = params.proto === 'udp' ? 'udp' : 'tcp';
        log(`Params updated: ifid=${QPARAMS.ifid} length=${QPARAMS.length} proto=${QPARAMS.proto}`);
        broadcast({ type: 'params', data: { ...QPARAMS } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, params: { ...QPARAMS } }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    // ── GET /api/flows ──────────────────────────────────────────
    if (u.pathname === '/api/flows') {
      const f = path.join(CFG.dataDir, 'flows_latest.json');
      res.writeHead(200, {
        'Content-Type'               : 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control'              : 'no-cache',
      });
      res.end(fs.existsSync(f) ? fs.readFileSync(f) : '{}');
      return;
    }

    // ── GET /api/snapshots ──────────────────────────────────────
    if (u.pathname === '/api/snapshots') {
      const files = fs.readdirSync(CFG.dataDir)
        .filter(f => f.startsWith('raw_'))
        .sort()
        .reverse();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(files));
      return;
    }

    // ── GET /api/status ─────────────────────────────────────────
    if (u.pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        uptime  : process.uptime(),
        params  : { ...QPARAMS },
        ntopHost: CFG.ntopHost,
        cookie  : CFG.cookie ? CFG.cookie.slice(0, 40) + '…' : 'none',
      }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  // WebSocket upgrade
  server.on('upgrade', (req, socket) => {
    if (req.url === '/ws') handleUpgrade(req, socket);
    else socket.destroy();
  });

  return server;
}

module.exports = { createServer };
