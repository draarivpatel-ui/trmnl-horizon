#!/usr/bin/env node
'use strict';

/**
 * TRMNL-Horizon Self-Hosted BYOS (Bring Your Own Server) HTTP Server
 * Implements the official TRMNL ESP32-C3 device firmware endpoints:
 *   - GET  /api/setup
 *   - GET  /api/display
 *   - POST /api/log
 *   - GET  /api/bitmap/:filename
 *   - GET  /api/status
 *   - GET  /api/liquid
 * Also serves the interactive E-Paper Hardware Workbench at GET /
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const TrmnlEngine = require('./trmnl_engine.js');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bmp': 'image/bmp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const SCREEN_ROTATION = ['corridor', 'orbital', 'labbench', 'rhythm'];

function createByosServer(options = {}) {
  const state = {
    activeScreen: options.defaultScreen || 'corridor',
    ditherMode: options.ditherMode || 'atkinson',
    refreshRate: options.refreshRate || 300,
    autoRotate: Boolean(options.autoRotate),
    rotationIndex: 0,
    devices: new Map(),
    logs: []
  };

  // Host is attacker-controlled: only a syntactically valid hostname or [IPv6]
  // literal (with optional port) may seed a URL base, or `new URL` throws and
  // kills the request handler.
  function safeHostHeader(req) {
    const host = String(req.headers.host || '');
    return /^(\[[0-9a-fA-F:]+\]|[\w.-]+)(:\d{1,5})?$/.test(host) ? host : 'localhost';
  }

  function getBaseUrl(req) {
    if (options.baseUrl) return options.baseUrl.replace(/\/+$/, '');
    const host = safeHostHeader(req) || 'localhost:8080';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${host}`;
  }

  function recordDeviceSeen(headers, endpoint) {
    const parsed = TrmnlEngine.parseTrmnlHeaders(headers);
    if (!state.devices.has(parsed.mac) && state.devices.size >= 256) {
      // Unbounded registry is a memory-growth vector on hostile networks: evict oldest.
      state.devices.delete(state.devices.keys().next().value);
    }
    const prev = state.devices.get(parsed.mac) || { polls: 0 };
    const updated = {
      mac: parsed.mac,
      friendlyId: TrmnlEngine.deriveFriendlyId(parsed.mac),
      batteryVoltage: parsed.batteryVoltage,
      socPercent: TrmnlEngine.voltageToSocPercent(parsed.batteryVoltage),
      rssi: parsed.rssi,
      fwVersion: parsed.fwVersion,
      refreshRate: parsed.refreshRate,
      lastEndpoint: endpoint,
      lastSeenAt: new Date().toISOString(),
      polls: prev.polls + 1
    };
    state.devices.set(parsed.mac, updated);
    return updated;
  }

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', `http://${safeHostHeader(req)}`);
    const pathname = reqUrl.pathname;

    // CORS headers for local hardware testing
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ID, Access-Token, Refresh-Rate, Battery-Voltage, FW-Version, RSSI, Special-Function');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. Official TRMNL Firmware Provisioning Endpoint: GET /api/setup
    if (req.method === 'GET' && pathname === '/api/setup') {
      recordDeviceSeen(req.headers, '/api/setup');
      const payload = TrmnlEngine.handleApiSetup(req.headers, {
        baseUrl: getBaseUrl(req)
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
      return;
    }

    // 2. Official TRMNL Firmware Screen Poll Endpoint: GET /api/display
    if (req.method === 'GET' && pathname === '/api/display') {
      const dev = recordDeviceSeen(req.headers, '/api/display');
      const queryScreen = reqUrl.searchParams.get('screen');
      const queryDither = reqUrl.searchParams.get('dither');

      let chosenScreen = queryScreen || state.activeScreen;
      if (!queryScreen && state.autoRotate) {
        chosenScreen = SCREEN_ROTATION[state.rotationIndex % SCREEN_ROTATION.length];
        state.rotationIndex++;
      }

      const payload = TrmnlEngine.handleApiDisplay(req.headers, {
        baseUrl: getBaseUrl(req),
        screenId: chosenScreen,
        ditherMode: queryDither || state.ditherMode,
        refreshRate: state.refreshRate,
        epochTag: `p${dev.polls}`
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
      return;
    }

    // 3. Official TRMNL Firmware Telemetry Log Endpoint: POST /api/log
    if (req.method === 'POST' && pathname === '/api/log') {
      recordDeviceSeen(req.headers, '/api/log');
      let bodyText = '';
      let bodyBytes = 0;
      let tooLarge = false;
      req.on('data', (chunk) => {
        if (tooLarge) return;
        bodyBytes += chunk.length; // byte length, not UTF-16 chars
        if (bodyBytes > 262144) {
          tooLarge = true;
          res.writeHead(413, {
            'Content-Type': 'application/json; charset=utf-8',
            'Connection': 'close'
          });
          res.end(JSON.stringify({ error: 'Payload too large', limit: 262144 }));
          return;
        }
        bodyText += chunk;
      });
      req.on('end', () => {
        if (tooLarge) return;
        let parsedBody = {};
        try {
          parsedBody = bodyText ? JSON.parse(bodyText) : {};
        } catch (_err) {
          parsedBody = { raw: bodyText };
        }
        const result = TrmnlEngine.handleApiLog(req.headers, parsedBody, state.logs);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
      });
      return;
    }

    // 4. 1-Bit Packed BMP / Grayscale PNG Image Endpoint: GET /api/bitmap/:filename
    if (req.method === 'GET' && pathname.startsWith('/api/bitmap/')) {
      const filename = path.basename(pathname);
      const isPng = /\.png$/i.test(filename);
      let screenId = reqUrl.searchParams.get('screen') || state.activeScreen;
      let ditherMode = reqUrl.searchParams.get('dither') || state.ditherMode;

      // Parse horizon-<screen>-<dither>-<epoch>.bmp pattern if present
      const match = filename.match(/^horizon-(corridor|orbital|labbench|rhythm)-([a-z0-9-]+)-[a-z0-9]+\.(bmp|png)$/i);
      if (match) {
        screenId = match[1].toLowerCase();
        ditherMode = match[2].toLowerCase();
      }

      const rendered = TrmnlEngine.renderScreen(screenId, {
        ditherMode,
        refreshRate: state.refreshRate
      });

      if (isPng) {
        const pngBytes = TrmnlEngine.encodeGrayscalePNG(rendered.ditheredPixels, rendered.width, rendered.height);
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': pngBytes.byteLength,
          'Cache-Control': 'no-store'
        });
        res.end(Buffer.from(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength));
      } else {
        const bmpBytes = TrmnlEngine.encode1BitBMP(rendered.ditheredPixels, rendered.width, rendered.height);
        res.writeHead(200, {
          'Content-Type': 'image/bmp',
          'Content-Length': bmpBytes.byteLength,
          'Cache-Control': 'no-store'
        });
        res.end(Buffer.from(bmpBytes.buffer, bmpBytes.byteOffset, bmpBytes.byteLength));
      }
      return;
    }

    // 5. Server Telemetry & Device Registry: GET /api/status
    if (req.method === 'GET' && pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'ok',
        server: 'TRMNL-Horizon BYOS v1.0.0',
        activeScreen: state.activeScreen,
        ditherMode: state.ditherMode,
        refreshRate: state.refreshRate,
        devices: Array.from(state.devices.values()),
        recentLogs: state.logs.slice(0, 20)
      }));
      return;
    }

    // 6. Liquid Template Export Endpoint: GET /api/liquid
    if (req.method === 'GET' && pathname === '/api/liquid') {
      const screenId = reqUrl.searchParams.get('screen') || state.activeScreen;
      const viewSize = reqUrl.searchParams.get('view') || 'full';
      const liquid = TrmnlEngine.generateLiquidTemplate(screenId, viewSize);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(liquid);
      return;
    }

    // 7. Static files for Interactive Workbench UI: explicit allowlist only.
    // Serving the repo root raw exposed .git/ (VCS internals, remotes), source
    // and any file dropped in later; only the four workbench files are public.
    const STATIC_FILES = {
      '/': 'index.html',
      '/index.html': 'index.html',
      '/style.css': 'style.css',
      '/app.js': 'app.js',
      '/trmnl_engine.js': 'trmnl_engine.js'
    };
    const staticName = STATIC_FILES[pathname];
    if (!staticName) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Not found', path: pathname }));
      return;
    }

    fs.readFile(path.join(__dirname, staticName), (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Not found', path: pathname }));
        return;
      }
      const ext = path.extname(staticName).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(content);
    });
  });

  return { server, state };
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || '8080', 10);
  const { server } = createByosServer();
  server.listen(port, () => {
    console.log(`TRMNL-Horizon BYOS Server listening on http://localhost:${port}`);
    console.log(`  GET  http://localhost:${port}/api/setup`);
    console.log(`  GET  http://localhost:${port}/api/display`);
    console.log(`  POST http://localhost:${port}/api/log`);
    console.log(`  GET  http://localhost:${port}/api/bitmap/horizon-corridor-atkinson-v1.bmp`);
  });
}

module.exports = { createByosServer };
