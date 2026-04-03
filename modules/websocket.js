'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { CFG, QPARAMS, log } = require('../config');

// ── Client registry ───────────────────────────────────────────────
const clients = new Set();

// ── Frame encoder ─────────────────────────────────────────────────
// Encodes a UTF-8 string as a WebSocket text frame (opcode 0x01).
function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len     = payload.length;

  let header;
  if (len <= 125) {
    header = Buffer.from([0x81, len]);
  } else if (len <= 65_535) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

// ── Broadcast ─────────────────────────────────────────────────────
function broadcast(obj) {
  const frame = encodeFrame(JSON.stringify(obj));
  for (const sock of clients) {
    try {
      sock.write(frame);
    } catch (_) {
      clients.delete(sock);
    }
  }
}

// ── Upgrade handler ───────────────────────────────────────────────
function handleUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  // Handshake
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  clients.add(socket);
  log(`WS client connected (total: ${clients.size})`);

  socket.on('close', () => { clients.delete(socket); });
  socket.on('error', () => { clients.delete(socket); socket.destroy(); });

  // Send latest cached data + current params immediately on connect
  const latestFile = path.join(CFG.dataDir, 'flows_latest.json');
  if (fs.existsSync(latestFile)) {
    try {
      const latest = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
      socket.write(encodeFrame(JSON.stringify({ type: 'flows', data: latest })));
    } catch (_) {}
  }
  socket.write(encodeFrame(JSON.stringify({ type: 'params', data: QPARAMS })));
}

module.exports = { broadcast, handleUpgrade, clients };
