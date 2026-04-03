'use strict';

const path = require('path');

// ─────────────────────────────────────────────────────────────
//  STATIC CONFIG  (edit these or override via environment vars)
// ─────────────────────────────────────────────────────────────
const CFG = {
  ntopHost : process.env.NTOP_HOST     || 'ntop.nrhomelab.com',
  ntopUser : process.env.NTOP_USER     || 'admin',
  ntopPass : process.env.NTOP_PASS     || 'allinonemonitoringfornr',
  cookie   : process.env.NTOP_COOKIE   || '',   // auto-populated after login
  pollMs   : parseInt(process.env.POLL_MS)  || 3000,
  port     : parseInt(process.env.PORT)     || 3000,
  dataDir  : process.env.DATA_DIR      || path.join(__dirname, 'data'),
  publicDir: path.join(__dirname, 'public'),
  rawKeep  : 20,
  homeLat  : parseFloat(process.env.HOME_LAT) || 10.8505,
  homeLon  : parseFloat(process.env.HOME_LON) || 76.2711,
};

// ─────────────────────────────────────────────────────────────
//  DYNAMIC QUERY PARAMS  (mutated at runtime via /api/set-params)
// ─────────────────────────────────────────────────────────────
const QPARAMS = {
  ifid  : process.env.DEFAULT_IFID   || '0',
  length: process.env.DEFAULT_LENGTH || '50',
  proto : process.env.DEFAULT_PROTO  || 'tcp',   // 'tcp' | 'udp'
};

// Builds the ntop GET path from current QPARAMS
function buildNtopPath() {
  const isTcp = QPARAMS.proto !== 'udp';
  return (
    '/lua/rest/v2/get/flow/active_list.lua'
    + '?start=0'
    + '&length='   + encodeURIComponent(QPARAMS.length || '50')
    + '&map_search='
    + '&visible_columns=actions%2Clast_seen%2Cfirst_seen%2Cprotocol%2Cscore%2Cflow%2Cthroughput%2Cbytes%2Cinfo'
    + '&sort=first_seen&order=asc'
    + '&ifid='     + encodeURIComponent(QPARAMS.ifid || '0')
    + '&flowhosts_type='
    + '&l4proto='  + (isTcp ? '6' : '17')
    + '&application=&alert_type='
    + '&tcp_flow_state=' + (isTcp ? 'established' : '')
    + '&traffic_type=&host_pool_id=&network='
  );
}

const log = (...args) =>
  console.log(`[${new Date().toISOString()}]`, ...args);

module.exports = { CFG, QPARAMS, buildNtopPath, log };
