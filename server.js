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

  function getBaseUrl(req) {
    if (options.baseUrl) return options.baseUrl.replace(/\/+$/, '');
    const host = req.headers.host || 'localhost:8080';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${host}`;
  }

  function recordDeviceSeen(headers, endpoint) {
    const parsed = TrmnlEngine.parseTrmnlHeaders(headers);
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
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
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
      req.on('data', (chunk) => {
        bodyText += chunk;
        if (bodyText.length > 262144) req.destroy();
      });
      req.on('end', () => {
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
      const isPng = filename.endsWith('.png');
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

    // 7. Static files for Interactive Workbench UI
    const staticRoot = __dirname;
    const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const safePath = path.normalize(path.join(staticRoot, relPath));
    if (!safePath.startsWith(staticRoot)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(safePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Not found', path: pathname }));
        return;
      }
      const ext = path.extname(safePath).toLowerCase();
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
