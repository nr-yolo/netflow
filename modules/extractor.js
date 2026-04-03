'use strict';

const fs   = require('fs');
const path = require('path');
const { CFG, QPARAMS, log } = require('../config');

/**
 * Extracts normalised flow objects from a raw ntop API response.
 * Saves flows_latest.json to disk (without geo — that's added later).
 *
 * @param {object} data  Parsed ntop JSON
 * @returns {{ timestamp, totalFlows, proto, ifid, extractedIPs, flows }}
 */
function extractFlows(data) {
  const rsp   = data.rsp || [];
  const flows = [];
  const ips   = new Set();

  for (const f of rsp) {
    const srcIp = f.client?.ip;
    const dstIp = f.server?.ip;
    if (!srcIp || !dstIp) continue;

    flows.push({
      srcIp,
      dstIp,
      srcPort  : f.client?.port,
      dstPort  : f.server?.port,
      srcName  : f.client?.name || '',   // ntop hostname (NetBIOS/mDNS)
      dstName  : f.server?.name || '',
      protocol : f.l4_proto?.name || 'TCP',
      app      : f.application?.name || 'Unknown',
      encrypted: f.application?.encrypted || false,
      bytes    : f.bytes?.total     || 0,
      cliBytes : f.bytes?.cli_bytes || 0,
      srvBytes : f.bytes?.srv_bytes || 0,
      bps      : f.throughput?.bps  || 0,
      pps      : f.throughput?.pps  || 0,
      score    : f.score || 0,
      info     : f.info  || '',
      firstSeen: f.first_seen,
      lastSeen : f.last_seen,
      duration : f.duration,
    });

    ips.add(srcIp);
    ips.add(dstIp);
  }

  const out = {
    timestamp    : new Date().toISOString(),
    totalFlows   : data.recordsTotal || flows.length,
    proto        : QPARAMS.proto,
    ifid         : QPARAMS.ifid,
    extractedIPs : [...ips],
    flows,
  };

  // Persist extracted (pre-geo) snapshot
  try {
    fs.writeFileSync(
      path.join(CFG.dataDir, 'flows_latest.json'),
      JSON.stringify(out, null, 2),
      'utf8'
    );
  } catch (e) {
    log(`WARN: could not write flows_latest.json — ${e.message}`);
  }

  log(
    `Extracted ${flows.length} flows` +
    ` [${QPARAMS.proto.toUpperCase()} ifid=${QPARAMS.ifid}],` +
    ` ${ips.size} unique IPs`
  );

  return out;
}

module.exports = { extractFlows };
