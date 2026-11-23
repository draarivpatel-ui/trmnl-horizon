(function () {
  'use strict';

  const Engine = window.TrmnlEngine;
  if (!Engine) {
    console.error('TrmnlEngine not loaded.');
    return;
  }

  const Lab = window.TrmnlEpaperLab || null;
  const labCtx = Lab ? Lab.createLab(Engine) : null;

  const state = {
    screenId: 'corridor',
    ditherMode: 'atkinson',
    liquidView: 'full',
    protoEndpoint: 'display',
    refreshIntervalSec: 300,
    batteryVoltage: 4.04,
    rssi: -58,
    capacityMah: 1800,
    pollCount: 1,
    customGrayBuffer: null,
    lastRendered: null,
    scatterScope: 'screen',
    lastBrief: null,
    overrides: {
      corridor: {
        stationName: 'PENN CORRIDOR // NORTH CONCOURSE',
        activeAlerts: 'SIG-LOCK CLEAR // TRACK 4 HIGH-DENSITY BOARDING',
        headwayAdherencePct: 94
      },
      orbital: {
        stationCallsign: 'GS-40N // HORIZON TRACKING ARRAY',
        targetSat: 'ISS (ZARYA) // NORAD 25544',
        maxElevationDeg: 74
      },
      labbench: {
        clusterName: 'TRMNL-BYOS // RACK-03 TELEMETRY',
        hostIp: '10.24.0.18:8080',
        firmwareTarget: 'ESP32-C3 FW 1.6.8'
      },
      rhythm: {
        title: 'CLASSICAL RIYAZ & TAAL ALMANAC',
        ragaName: 'RAGA YAMAN (KALYAN THAAT)',
        bpm: 144
      }
    }
  };

  // DOM References
  const canvas = document.getElementById('epaperCanvas');
  const ctx = canvas.getContext('2d');
  const lutFlashOverlay = document.getElementById('lutFlashOverlay');
  const wakeLed = document.getElementById('wakeLed');
  const bezelStatusText = document.getElementById('bezelStatusText');

  const metricResolution = document.getElementById('metricResolution');
  const metricBmpSize = document.getElementById('metricBmpSize');
  const metricInkRatio = document.getElementById('metricInkRatio');
  const metricBatteryDays = document.getElementById('metricBatteryDays');

  const statWhitePx = document.getElementById('statWhitePx');
  const statBlackPx = document.getElementById('statBlackPx');
  const statRenderMs = document.getElementById('statRenderMs');

  const activeScreenBadge = document.getElementById('activeScreenBadge');
  const inputHeadline = document.getElementById('inputHeadline');
  const inputAdvisory = document.getElementById('inputAdvisory');
  const inputMetricValue = document.getElementById('inputMetricValue');

  const protocolInspectorBox = document.getElementById('protocolInspectorBox');
  const liquidCodeOutput = document.getElementById('liquidCodeOutput');

  const sliderRefresh = document.getElementById('sliderRefresh');
  const sliderVoltage = document.getElementById('sliderVoltage');
  const sliderRssi = document.getElementById('sliderRssi');
  const selectBatteryCap = document.getElementById('selectBatteryCap');

  const valRefreshSec = document.getElementById('valRefreshSec');
  const valBatteryV = document.getElementById('valBatteryV');
  const valRssi = document.getElementById('valRssi');
  const valCapacity = document.getElementById('valCapacity');
  const socBadge = document.getElementById('socBadge');

  const powerWakesDay = document.getElementById('powerWakesDay');
  const powerBurstSec = document.getElementById('powerBurstSec');
  const powerMahDay = document.getElementById('powerMahDay');
  const powerDaysLeft = document.getElementById('powerDaysLeft');

  // Authentic matte e-paper substrate RGB tint (#F4F1E6) and carbon pigment ink (#161719)
  function paintBufferToCanvas(quantizedPixels) {
    const imgData = ctx.createImageData(Engine.DISPLAY_WIDTH, Engine.DISPLAY_HEIGHT);
    const data = imgData.data;
    let blackCount = 0;
    let whiteCount = 0;

    for (let i = 0; i < quantizedPixels.length; i++) {
      const v = quantizedPixels[i];
      if (v < 128) blackCount++;
      else whiteCount++;

      // Map 0..255 between deep carbon ink (22, 23, 25) and warm e-paper cream (244, 241, 230)
      const t = v / 255;
      const offset = i * 4;
      data[offset] = Math.round(22 + (244 - 22) * t);
      data[offset + 1] = Math.round(23 + (241 - 23) * t);
      data[offset + 2] = Math.round(25 + (230 - 25) * t);
      data[offset + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
    return { blackCount, whiteCount };
  }

  function triggerLutFlash() {
    lutFlashOverlay.classList.remove('flashing');
    void lutFlashOverlay.offsetWidth;
    lutFlashOverlay.classList.add('flashing');
  }

  function syncFormInputsForScreen(screenId) {
    activeScreenBadge.textContent = screenId;
    if (screenId === 'corridor') {
      inputHeadline.value = state.overrides.corridor.stationName;
      inputAdvisory.value = state.overrides.corridor.activeAlerts;
      inputMetricValue.value = state.overrides.corridor.headwayAdherencePct;
    } else if (screenId === 'orbital') {
      inputHeadline.value = state.overrides.orbital.stationCallsign;
      inputAdvisory.value = state.overrides.orbital.targetSat;
      inputMetricValue.value = state.overrides.orbital.maxElevationDeg;
    } else if (screenId === 'labbench') {
      inputHeadline.value = state.overrides.labbench.clusterName;
      inputAdvisory.value = state.overrides.labbench.firmwareTarget;
      inputMetricValue.value = 98;
    } else if (screenId === 'rhythm') {
      inputHeadline.value = state.overrides.rhythm.title;
      inputAdvisory.value = state.overrides.rhythm.ragaName;
      inputMetricValue.value = state.overrides.rhythm.bpm;
    }
  }

  function applyFormOverridesToState() {
    const h = inputHeadline.value.trim();
    const a = inputAdvisory.value.trim();
    const m = Number(inputMetricValue.value) || 90;

    if (state.screenId === 'corridor') {
      state.overrides.corridor.stationName = h || 'PENN CORRIDOR';
      state.overrides.corridor.activeAlerts = a || 'ALL TRACKS NORMAL';
      state.overrides.corridor.headwayAdherencePct = Math.max(1, Math.min(100, m));
    } else if (state.screenId === 'orbital') {
      state.overrides.orbital.stationCallsign = h || 'GS-40N ARRAY';
      state.overrides.orbital.targetSat = a || 'ISS (ZARYA)';
      state.overrides.orbital.maxElevationDeg = Math.max(5, Math.min(90, m));
    } else if (state.screenId === 'labbench') {
      state.overrides.labbench.clusterName = h || 'TRMNL-BYOS RACK';
      state.overrides.labbench.firmwareTarget = a || 'ESP32-C3 FW 1.6.8';
    } else if (state.screenId === 'rhythm') {
      state.overrides.rhythm.title = h || 'CLASSICAL RIYAZ ALMANAC';
      state.overrides.rhythm.ragaName = a || 'RAGA YAMAN';
      state.overrides.rhythm.bpm = Math.max(40, Math.min(240, m));
    }
  }

  function updateBatteryPhysicsUI() {
    const est = Engine.estimateBatteryLife({
      capacityMah: state.capacityMah,
      refreshIntervalSec: state.refreshIntervalSec,
      rssi: state.rssi,
      batteryVoltage: state.batteryVoltage
    });

    const mins = Math.round(state.refreshIntervalSec / 60);
    valRefreshSec.textContent = `${state.refreshIntervalSec} s (${mins} min)`;
    valBatteryV.textContent = `${state.batteryVoltage.toFixed(2)} V`;
    valRssi.textContent = `${state.rssi} dBm`;
    valCapacity.textContent = `${state.capacityMah} mAh`;
    socBadge.textContent = `${est.socPercent}% SoC`;

    powerWakesDay.textContent = est.wakesPerDay.toFixed(1);
    powerBurstSec.textContent = `${est.activeDurationSec.toFixed(2)} s`;
    powerMahDay.textContent = `${est.mahPerDay.toFixed(2)} mAh`;
    powerDaysLeft.textContent = `${est.estimatedDaysRemaining} Days`;
    metricBatteryDays.textContent = `${est.estimatedDaysRemaining} Days (${est.socPercent}%)`;
  }

  function updateProtocolInspectorUI() {
    const simHeaders = {
      'ID': 'A0:B7:65:FE:12:9C',
      'Access-Token': 'trmnl_byos_a0b765fe129c_horizon',
      'Refresh-Rate': String(state.refreshIntervalSec),
      'Battery-Voltage': state.batteryVoltage.toFixed(2),
      'FW-Version': '1.6.8',
      'RSSI': String(state.rssi)
    };

    const baseUrl = window.location.origin && window.location.origin !== 'null'
      ? window.location.origin
      : 'https://aariv.me/trmnl-horizon';

    let responseObj;
    let methodLine;
    if (state.protoEndpoint === 'setup') {
      methodLine = 'GET /api/setup HTTP/1.1';
      responseObj = Engine.handleApiSetup(simHeaders, { baseUrl });
    } else if (state.protoEndpoint === 'log') {
      methodLine = 'POST /api/log HTTP/1.1';
      responseObj = Engine.handleApiLog(simHeaders, {
        log: {
          logs_array: [
            {
              creation_timestamp: Math.floor(Date.now() / 1000),
              battery_voltage: state.batteryVoltage,
              wifi_signal: state.rssi,
              wifi_status: 'connected',
              refresh_rate: state.refreshIntervalSec,
              sleep_duration: state.refreshIntervalSec
            }
          ]
        }
      });
    } else {
      methodLine = 'GET /api/display HTTP/1.1';
      responseObj = Engine.handleApiDisplay(simHeaders, {
        baseUrl,
        screenId: state.screenId,
        ditherMode: state.ditherMode,
        refreshRate: state.refreshIntervalSec,
        epochTag: `p${state.pollCount}`
      });
    }

    const headerLines = Object.entries(simHeaders)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    protocolInspectorBox.textContent =
      `// Request from ESP32-C3 Firmware\n${methodLine}\n${headerLines}\n\n// Server Response (200 OK)\n` +
      JSON.stringify(responseObj, null, 2);
  }

  function updateLiquidExporterUI() {
    const custom = state.overrides[state.screenId] || {};
    const markup = Engine.generateLiquidTemplate(state.screenId, state.liquidView, custom);
    liquidCodeOutput.value = markup;
  }

  function renderWorkbench(withFlash = false) {
    const t0 = performance.now();
    let ditheredPixels;

    if (state.customGrayBuffer) {
      ditheredPixels = Engine.applyDithering(
        state.customGrayBuffer,
        Engine.DISPLAY_WIDTH,
        Engine.DISPLAY_HEIGHT,
        state.ditherMode
      );
      state.lastRendered = {
        screenId: 'custom',
        ditherMode: state.ditherMode,
        width: Engine.DISPLAY_WIDTH,
        height: Engine.DISPLAY_HEIGHT,
        grayPixels: state.customGrayBuffer,
        ditheredPixels
      };
    } else {
      const customData = state.overrides[state.screenId] || {};
      const rendered = Engine.renderScreen(state.screenId, {
        ditherMode: state.ditherMode,
        data: customData,
        batteryVoltage: state.batteryVoltage,
        rssi: state.rssi,
        refreshRate: state.refreshIntervalSec
      });
      state.lastRendered = rendered;
      ditheredPixels = rendered.ditheredPixels;
    }

    const elapsedMs = performance.now() - t0;
    const { blackCount, whiteCount } = paintBufferToCanvas(ditheredPixels);

    if (withFlash) {
      triggerLutFlash();
    }

    const totalPx = Engine.DISPLAY_WIDTH * Engine.DISPLAY_HEIGHT;
    const inkPct = ((blackCount / totalPx) * 100).toFixed(1);

    statWhitePx.textContent = whiteCount.toLocaleString();
    statBlackPx.textContent = blackCount.toLocaleString();
    statRenderMs.textContent = `${elapsedMs.toFixed(1)} ms`;

    const is2Bit = state.ditherMode === 'gray2bit';
    metricResolution.textContent = `800 x 480 (${is2Bit ? '2-Bit 4G' : '1-Bit Mono'})`;
    metricBmpSize.textContent = '48,062 Bytes';
    metricInkRatio.textContent = `${inkPct}% Black`;

    updateBatteryPhysicsUI();
    updateProtocolInspectorUI();
    updateLiquidExporterUI();
    if (labCtx) {
      renderBatteryChart();
      scheduleLabRefresh();
      updateHash();
    }
  }

  function downloadBlob(bytes, filename, mimeType) {
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ============================================================================
  // E-PAPER DITHER QUALITY & ESP32-C3 BATTERY FRONTIER LAB
  // ============================================================================

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const matrixTbody = document.getElementById('matrixTbody');
  const batteryChart = document.getElementById('batteryChart');
  const fidelityChart = document.getElementById('fidelityChart');
  const labDigestBadge = document.getElementById('labDigestBadge');
  const briefStatus = document.getElementById('briefStatus');
  const briefStatusBar = briefStatus ? briefStatus.parentElement : null;
  const selfTestOut = document.getElementById('selfTestOut');
  const selfTestBadge = document.getElementById('selfTestBadge');
  const batteryChartBadge = document.getElementById('batteryChartBadge');
  const scatterBadge = document.getElementById('scatterBadge');

  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      el.setAttribute(k, v);
    }
    if (parent) parent.appendChild(el);
    return el;
  }

  function labDitherIndex(mode) {
    return Lab ? Lab.DITHER_IDS.indexOf(mode) : -1;
  }

  function activeMatrixIndex() {
    const di = labDitherIndex(state.ditherMode);
    const si = Lab ? Lab.SCREENS.indexOf(state.screenId) : -1;
    return (si >= 0 && di >= 0) ? si * Lab.DITHER_IDS.length + di : -1;
  }

  function labMatrixOptions() {
    return {
      overridesByScreen: state.overrides,
      batteryVoltage: state.batteryVoltage,
      rssi: state.rssi,
      refreshRate: state.refreshIntervalSec
    };
  }

  function labSnapshot() {
    return {
      screenId: state.screenId,
      ditherId: state.ditherMode,
      refreshIntervalSec: state.refreshIntervalSec,
      batteryVoltage: state.batteryVoltage,
      rssi: state.rssi,
      capacityMah: state.capacityMah,
      overridesByScreen: state.overrides
    };
  }

  function getLabMatrix() {
    if (!labCtx) return null;
    return labCtx.comparatorMatrix(labMatrixOptions());
  }

  function renderMatrixTable() {
    if (!labCtx || !matrixTbody) return;
    const matrix = getLabMatrix();
    const activeIdx = activeMatrixIndex();
    matrixTbody.textContent = '';
    for (const row of matrix.rows) {
      const tr = document.createElement('tr');
      tr.dataset.index = String(row.index);
      if (row.index === activeIdx) tr.classList.add('active');
      const cells = [
        String(row.index + 1),
        row.screenId,
        row.ditherId,
        row.inkPct.toFixed(2),
        row.runs.toLocaleString(),
        row.rleBytes.toLocaleString(),
        row.byteEntropy.toFixed(2),
        row.psnrDb.toFixed(2),
        row.ssim.toFixed(3),
        row.bmpIs48062 && row.bmpHeaderOk && row.deterministic ? '48062 OK' : 'FAIL'
      ];
      cells.forEach((text, i) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (i === cells.length - 1) td.className = 'bmp-ok';
        tr.appendChild(td);
      });
      tr.addEventListener('click', () => selectMatrixRow(row.index));
      matrixTbody.appendChild(tr);
    }
  }

  function selectMatrixRow(index) {
    const matrix = getLabMatrix();
    if (!matrix) return;
    const row = matrix.rows.find((r) => r.index === index);
    if (!row) return;
    state.screenId = row.screenId;
    state.ditherMode = row.ditherId;
    state.customGrayBuffer = null;
    syncScreenTabs();
    syncDitherButtons();
    syncFormInputsForScreen(state.screenId);
    renderWorkbench(true);
  }

  function syncScreenTabs() {
    document.querySelectorAll('.screen-tab').forEach((b) => {
      const on = b.dataset.screen === state.screenId;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function syncDitherButtons() {
    document.querySelectorAll('.dither-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.dither === state.ditherMode);
    });
  }

  const CAPACITY_SERIES = [
    { cap: 1200, color: '#8c887e' },
    { cap: 1800, color: '#1c1d1f' },
    { cap: 2500, color: '#2c8a56' }
  ];

  function renderBatteryChart() {
    if (!labCtx || !batteryChart) return;
    const W = 640;
    const H = 300;
    const pad = { l: 56, r: 14, t: 16, b: 34 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const xMin = 60;
    const xMax = 3600;

    const curves = CAPACITY_SERIES.map((s) => ({
      cap: s.cap,
      color: s.color,
      curve: labCtx.batteryCurve({
        capacityMah: s.cap,
        rssi: state.rssi,
        batteryVoltage: state.batteryVoltage
      })
    }));
    let yMax = 0;
    for (const c of curves) {
      for (const p of c.curve.points) {
        if (p.daysRemaining > yMax) yMax = p.daysRemaining;
      }
    }
    yMax = Math.max(10, Math.ceil(yMax / 10) * 10 + 10);

    const xFor = (sec) => pad.l + ((sec - xMin) / (xMax - xMin)) * plotW;
    const yFor = (days) => pad.t + plotH - (days / yMax) * plotH;

    batteryChart.textContent = '';

    // Axes + grid
    svgEl('line', { x1: pad.l, y1: pad.t, x2: pad.l, y2: pad.t + plotH, class: 'chart-axis' }, batteryChart);
    svgEl('line', { x1: pad.l, y1: pad.t + plotH, x2: pad.l + plotW, y2: pad.t + plotH, class: 'chart-axis' }, batteryChart);
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
      const days = Math.round((yMax / yTicks) * i);
      const y = yFor(days);
      if (i > 0) {
        svgEl('line', { x1: pad.l, y1: y, x2: pad.l + plotW, y2: y, class: 'chart-grid-line' }, batteryChart);
      }
      const lbl = svgEl('text', { x: pad.l - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-axis-label' }, batteryChart);
      lbl.textContent = `${days}d`;
    }
    for (let sec = 60; sec <= 3600; sec += 590) {
      const x = xFor(Math.min(sec, 3600));
      const lbl = svgEl('text', { x, y: pad.t + plotH + 22, 'text-anchor': 'middle', class: 'chart-axis-label' }, batteryChart);
      lbl.textContent = `${sec}s`;
    }

    // Series lines (dim for inactive capacities, strong for the active pack)
    for (const c of curves) {
      const isActive = c.cap === state.capacityMah;
      const path = c.curve.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(p.intervalSec).toFixed(1)},${yFor(p.daysRemaining).toFixed(1)}`)
        .join(' ');
      svgEl('path', {
        d: path,
        class: 'chart-series-line',
        stroke: c.color,
        'stroke-width': isActive ? 3 : 1.5,
        opacity: isActive ? 1 : 0.45,
        'stroke-dasharray': isActive ? 'none' : '5 4'
      }, batteryChart);
      const capLbl = svgEl('text', {
        x: pad.l + plotW - 6,
        y: yFor(c.curve.points[c.curve.points.length - 1].daysRemaining) - 6,
        'text-anchor': 'end',
        class: 'chart-axis-label'
      }, batteryChart);
      capLbl.textContent = `${c.cap} mAh`;
    }

    // Clickable + keyboard-focusable nodes on the active pack series.
    // Hit-target radius adapts to the nearest sibling so every node's center
    // always resolves to its own transparent hit circle (no overlap steal).
    const active = curves.find((c) => c.cap === state.capacityMah) || curves[1];
    const activeCenters = active.curve.points.map((p) => [xFor(p.intervalSec), yFor(p.daysRemaining)]);
    active.curve.points.forEach((p, pi) => {
      let nearest = Infinity;
      activeCenters.forEach(([ox, oy], oi) => {
        if (oi !== pi) nearest = Math.min(nearest, Math.hypot(ox - activeCenters[pi][0], oy - activeCenters[pi][1]));
      });
      const hitR = Math.max(2, Math.min(13, nearest / 2 - 0.5));
      const g = svgEl('g', {
        class: 'chart-node',
        tabindex: '0',
        role: 'button',
        'aria-label': `Set refresh interval ${p.intervalSec} seconds, ${p.daysRemaining} days remaining`
      }, batteryChart);
      if (Math.abs(p.intervalSec - state.refreshIntervalSec) <= 30) {
        g.classList.add('selected');
      }
      svgEl('circle', { cx: xFor(p.intervalSec), cy: yFor(p.daysRemaining), r: hitR, class: 'hit-target' }, g);
      svgEl('circle', {
        cx: xFor(p.intervalSec), cy: yFor(p.daysRemaining), r: 4.5,
        class: 'node-dot', fill: active.color
      }, g);
      const activate = () => {
        sliderRefresh.value = String(p.intervalSec);
        sliderRefresh.dispatchEvent(new Event('input', { bubbles: true }));
      };
      g.addEventListener('click', activate);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });
    });

    if (batteryChartBadge) {
      batteryChartBadge.textContent = `${state.capacityMah} mAh // ${state.rssi} dBm`;
    }
    document.querySelectorAll('#batteryChipRow .chip-btn').forEach((b) => {
      if (b.dataset.rssi !== undefined) {
        b.classList.toggle('active', Number(b.dataset.rssi) === state.rssi);
      }
      if (b.dataset.cap !== undefined) {
        b.classList.toggle('active', Number(b.dataset.cap) === state.capacityMah);
      }
    });
  }

  const SCATTER_COLORS = {
    atkinson: '#1c1d1f',
    'floyd-steinberg': '#d95d24',
    bayer4: '#2c8a56',
    bayer8: '#8c6fbf'
  };
  const SCATTER_SCREEN_MARKS = ['#1c1d1f', '#d95d24', '#2c8a56', '#8c6fbf'];

  function renderFidelityChart() {
    if (!labCtx || !fidelityChart) return;
    const matrix = getLabMatrix();
    const W = 640;
    const H = 300;
    const pad = { l: 52, r: 14, t: 16, b: 36 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;

    let points;
    if (state.scatterScope === 'all') {
      points = matrix.rows.map((r) => ({
        key: `${r.screenId}|${r.ditherId}`,
        screenId: r.screenId,
        ditherId: r.ditherId,
        label: `${r.screenId.slice(0, 3)}:${Lab.DITHERS[Lab.DITHER_IDS.indexOf(r.ditherId)].short}`,
        inkPct: r.inkPct,
        ssim: r.ssim
      }));
    } else {
      points = matrix.rows
        .filter((r) => r.screenId === state.screenId)
        .map((r) => ({
          key: `${r.screenId}|${r.ditherId}`,
          screenId: r.screenId,
          ditherId: r.ditherId,
          label: Lab.DITHERS[Lab.DITHER_IDS.indexOf(r.ditherId)].short,
          inkPct: r.inkPct,
          ssim: r.ssim
        }));
    }

    let xLo = Math.min(...points.map((p) => p.inkPct));
    let xHi = Math.max(...points.map((p) => p.inkPct));
    let yLo = Math.min(...points.map((p) => p.ssim));
    let yHi = Math.max(...points.map((p) => p.ssim));
    const xPad = Math.max(0.5, (xHi - xLo) * 0.12);
    const yPad = Math.max(0.01, (yHi - yLo) * 0.15);
    xLo = Math.max(0, xLo - xPad); xHi = xHi + xPad;
    yLo = Math.max(-1, yLo - yPad); yHi = Math.min(1, yHi + yPad);

    const xFor = (ink) => pad.l + ((ink - xLo) / (xHi - xLo)) * plotW;
    const yFor = (ssim) => pad.t + plotH - ((ssim - yLo) / (yHi - yLo)) * plotH;

    fidelityChart.textContent = '';
    svgEl('line', { x1: pad.l, y1: pad.t, x2: pad.l, y2: pad.t + plotH, class: 'chart-axis' }, fidelityChart);
    svgEl('line', { x1: pad.l, y1: pad.t + plotH, x2: pad.l + plotW, y2: pad.t + plotH, class: 'chart-axis' }, fidelityChart);
    for (let i = 0; i <= 4; i++) {
      const ink = xLo + ((xHi - xLo) / 4) * i;
      const x = xFor(ink);
      const lbl = svgEl('text', { x, y: pad.t + plotH + 22, 'text-anchor': 'middle', class: 'chart-axis-label' }, fidelityChart);
      lbl.textContent = `${ink.toFixed(0)}%`;
      const sv = yLo + ((yHi - yLo) / 4) * i;
      const y = yFor(sv);
      if (i > 0) {
        svgEl('line', { x1: pad.l, y1: y, x2: pad.l + plotW, y2: y, class: 'chart-grid-line' }, fidelityChart);
      }
      const yl = svgEl('text', { x: pad.l - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-axis-label' }, fidelityChart);
      yl.textContent = sv.toFixed(2);
    }
    const xTitle = svgEl('text', { x: pad.l + plotW - 4, y: pad.t + plotH + 22, 'text-anchor': 'end', class: 'chart-axis-label' }, fidelityChart);
    xTitle.textContent = 'ink %';
    const yTitle = svgEl('text', { x: 10, y: pad.t + 10, 'text-anchor': 'start', class: 'chart-axis-label' }, fidelityChart);
    yTitle.textContent = 'ssim';

    // Collision-free label placement: nudge labels down until clear.
    const placed = [];
    const markerCenters = points.map((p) => [xFor(p.inkPct), yFor(p.ssim)]);
    points.forEach((p, pi) => {
      const x = markerCenters[pi][0];
      const y = markerCenters[pi][1];
      // Adaptive hit radius: never wider than half the gap to the nearest
      // sibling marker, so overlapped clusters keep unique hit centers.
      let nearest = Infinity;
      markerCenters.forEach(([ox, oy], oi) => {
        if (oi !== pi) nearest = Math.min(nearest, Math.hypot(ox - x, oy - y));
      });
      const hitR = Math.max(2, Math.min(14, nearest / 2 - 0.5));
      const selected = p.screenId === state.screenId && p.ditherId === state.ditherMode;
      const g = svgEl('g', { class: 'chart-node', tabindex: '0', role: 'button', 'aria-label': `Switch to ${p.ditherId} on ${p.screenId}` }, fidelityChart);
      svgEl('circle', { cx: x, cy: y, r: hitR, class: 'hit-target' }, g);
      const dot = svgEl('circle', {
        cx: x, cy: y, r: 6,
        class: selected ? 'chart-scatter-dot selected' : 'chart-scatter-dot',
        fill: state.scatterScope === 'all'
          ? SCATTER_SCREEN_MARKS[Lab.SCREENS.indexOf(p.screenId)]
          : SCATTER_COLORS[p.ditherId] || '#1c1d1f'
      }, g);
      const activate = () => {
        state.screenId = p.screenId;
        state.ditherMode = p.ditherId;
        state.customGrayBuffer = null;
        syncScreenTabs();
        syncDitherButtons();
        syncFormInputsForScreen(state.screenId);
        renderWorkbench(false);
      };
      g.addEventListener('click', activate);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });
      let ly = y - 10;
      let lx = x + 9;
      for (let tries = 0; tries < 8; tries++) {
        const box = { x1: lx, y1: ly - 10, x2: lx + p.label.length * 6.6 + 4, y2: ly + 2 };
        const clash = placed.some((b) => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2));
        if (!clash) {
          placed.push(box);
          break;
        }
        ly += 13;
        if (tries === 3) lx = x - p.label.length * 6.6 - 10;
      }
      const lbl = svgEl('text', { x: lx, y: ly, class: 'chart-marker-label' }, fidelityChart);
      lbl.textContent = p.label;
      dot.setAttribute('data-key', p.key);
    });

    if (scatterBadge) {
      scatterBadge.textContent = state.scatterScope === 'all' ? 'all 16' : state.screenId;
    }
  }

  function updateDigestBadge() {
    if (!labCtx) return;
    const brief = labCtx.buildAuditBrief(labSnapshot());
    state.lastBrief = brief;
    if (labDigestBadge) {
      labDigestBadge.textContent = `SHA-256 ${brief.auditDigest.slice(0, 16)}`;
      labDigestBadge.title = brief.auditDigest;
    }
    if (briefStatusBar) {
      briefStatusBar.classList.remove('ok', 'bad');
      briefStatus.textContent = `Canonical digest ${brief.auditDigest.slice(0, 24)}... across badge, JSON, CSV and Markdown`;
    }
  }

  function runLabSelfTests() {
    if (!labCtx || !selfTestOut) return;
    selfTestOut.textContent = 'Running deterministic checks...';
    const suite = labCtx.runLabSelfTests();
    const lines = suite.results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(28)} ${r.detail}`);
    selfTestOut.textContent = `${suite.passed}/${suite.total} in-page checks passed\n` + lines.join('\n');
    if (selfTestBadge) {
      selfTestBadge.textContent = `${suite.passed}/${suite.total} PASS`;
    }
  }

  function updateHash() {
    if (!labCtx) return;
    const hash = labCtx.encodeLabHash({
      v: 1,
      s: state.screenId,
      d: labDitherIndex(state.ditherMode) >= 0 ? state.ditherMode : 'atkinson',
      r: state.refreshIntervalSec,
      b: Math.round(state.batteryVoltage * 100),
      q: Math.round(state.rssi),
      c: state.capacityMah,
      m: activeMatrixIndex()
    });
    if (hash && window.location.hash !== hash) {
      history.replaceState(null, '', hash);
    }
  }

  function restoreFromHash() {
    if (!labCtx) return;
    const decoded = labCtx.decodeLabHash(window.location.hash || '');
    if (!decoded.ok || !decoded.state) return;
    const st = decoded.state;
    state.screenId = st.s;
    state.ditherMode = st.d;
    state.refreshIntervalSec = st.r;
    state.batteryVoltage = st.b / 100;
    state.rssi = st.q;
    state.capacityMah = st.c;
    sliderRefresh.value = String(st.r);
    sliderVoltage.value = String(st.b / 100);
    sliderRssi.value = String(st.q);
    selectBatteryCap.value = String(st.c);
    syncScreenTabs();
    syncDitherButtons();
  }

  let labRefreshTimer = 0;
  function scheduleLabRefresh() {
    if (!labCtx) return;
    clearTimeout(labRefreshTimer);
    labRefreshTimer = setTimeout(() => {
      renderMatrixTable();
      renderFidelityChart();
      updateDigestBadge();
    }, 280);
  }

  function initLab() {
    if (!labCtx) return;
    document.querySelectorAll('#batteryChipRow .chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.rssi !== undefined) {
          sliderRssi.value = btn.dataset.rssi;
          sliderRssi.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (btn.dataset.cap !== undefined) {
          selectBatteryCap.value = btn.dataset.cap;
          selectBatteryCap.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
    document.querySelectorAll('#scatterChipRow .chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.scatterScope = btn.dataset.scope === 'all' ? 'all' : 'screen';
        document.querySelectorAll('#scatterChipRow .chip-btn').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        renderFidelityChart();
      });
    });
    document.getElementById('btnRunSelfTests').addEventListener('click', runLabSelfTests);
    document.getElementById('btnVerifyDigest').addEventListener('click', () => {
      if (!state.lastBrief) updateDigestBadge();
      const verdict = labCtx.verifyAuditBrief(state.lastBrief);
      briefStatusBar.classList.remove('ok', 'bad');
      briefStatusBar.classList.add(verdict.ok ? 'ok' : 'bad');
      briefStatus.textContent = verdict.ok
        ? `VERIFIED ${verdict.expectedDigest.slice(0, 24)}... matches canonical payload`
        : `FAILED ${verdict.reason}: payload no longer matches the stamped digest`;
    });
    document.getElementById('btnTamperDemo').addEventListener('click', () => {
      if (!state.lastBrief) updateDigestBadge();
      const tampered = labCtx.tamperAuditBrief(state.lastBrief);
      const verdict = labCtx.verifyAuditBrief(tampered);
      briefStatusBar.classList.remove('ok', 'bad');
      briefStatusBar.classList.add(verdict.ok ? 'ok' : 'bad');
      briefStatus.textContent = verdict.ok
        ? 'Tamper demo failed: mutated brief still verified (unexpected)'
        : `TAMPER DETECTED: 1-unit mutation -> ${verdict.reason} (${String(verdict.expectedDigest).slice(0, 16)} != ${String(verdict.actualDigest).slice(0, 16)})`;
    });
    const exportBrief = (formatFn, ext, mime) => {
      const brief = labCtx.buildAuditBrief(labSnapshot());
      state.lastBrief = brief;
      const bytes = new TextEncoder().encode(formatFn(brief));
      downloadBlob(bytes, `trmnl-horizon-proof-${state.screenId}-${state.ditherMode}.${ext}`, mime);
    };
    document.getElementById('btnBriefJson').addEventListener('click', () => {
      exportBrief(labCtx.exportJsonBrief, 'json', 'application/json');
    });
    document.getElementById('btnBriefCsv').addEventListener('click', () => {
      exportBrief(labCtx.exportCsvBrief, 'csv', 'text/csv;charset=utf-8');
    });
    document.getElementById('btnBriefMd').addEventListener('click', () => {
      exportBrief(labCtx.exportMarkdownBrief, 'md', 'text/markdown;charset=utf-8');
    });
    renderMatrixTable();
    renderBatteryChart();
    renderFidelityChart();
    updateDigestBadge();
    runLabSelfTests();
  }

  // Event Listeners: Screen Tabs
  document.querySelectorAll('.screen-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.screen-tab').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      state.screenId = btn.dataset.screen;
      state.customGrayBuffer = null;
      syncFormInputsForScreen(state.screenId);
      renderWorkbench(true);
    });
  });

  // Event Listeners: Dithering Mode Buttons
  document.querySelectorAll('.dither-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dither-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.ditherMode = btn.dataset.dither;
      renderWorkbench(false);
    });
  });

  // Event Listeners: Live Form Inputs
  [inputHeadline, inputAdvisory, inputMetricValue].forEach((inp) => {
    inp.addEventListener('input', () => {
      state.customGrayBuffer = null;
      applyFormOverridesToState();
      renderWorkbench(false);
    });
  });

  // Event Listeners: Battery & Power Sliders
  sliderRefresh.addEventListener('input', () => {
    state.refreshIntervalSec = Number(sliderRefresh.value);
    renderWorkbench(false);
  });
  sliderVoltage.addEventListener('input', () => {
    state.batteryVoltage = Number(sliderVoltage.value);
    renderWorkbench(false);
  });
  sliderRssi.addEventListener('input', () => {
    state.rssi = Number(sliderRssi.value);
    renderWorkbench(false);
  });
  selectBatteryCap.addEventListener('change', () => {
    state.capacityMah = Number(selectBatteryCap.value);
    renderWorkbench(false);
  });

  // Event Listeners: Protocol Tabs
  document.querySelectorAll('.proto-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.proto-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.protoEndpoint = btn.dataset.endpoint;
      updateProtocolInspectorUI();
    });
  });

  // Event Listeners: Liquid View Size & Export
  document.getElementById('selectLiquidView').addEventListener('change', (e) => {
    state.liquidView = e.target.value;
    updateLiquidExporterUI();
  });

  document.getElementById('btnCopyLiquid').addEventListener('click', (e) => {
    navigator.clipboard?.writeText(liquidCodeOutput.value);
    const original = e.target.textContent;
    e.target.textContent = 'Copied to Clipboard!';
    setTimeout(() => { e.target.textContent = original; }, 1400);
  });

  document.getElementById('btnDownloadLiquid').addEventListener('click', () => {
    const bytes = new TextEncoder().encode(liquidCodeOutput.value);
    downloadBlob(bytes, `${state.screenId}_${state.liquidView}.liquid`, 'text/plain;charset=utf-8');
  });

  // Event Listeners: LUT Flash, Wake Poll, BMP & PNG Downloads
  document.getElementById('btnLutFlash').addEventListener('click', () => {
    triggerLutFlash();
  });

  document.getElementById('btnWakePoll').addEventListener('click', () => {
    state.pollCount++;
    wakeLed.classList.add('polling');
    bezelStatusText.textContent = 'WIFI TX // GET /api/display (78 mA)';
    renderWorkbench(true);
    setTimeout(() => {
      wakeLed.classList.remove('polling');
      bezelStatusText.textContent = 'DEEP SLEEP (18 uA)';
    }, 900);
  });

  document.getElementById('btnDownloadBmp').addEventListener('click', () => {
    if (!state.lastRendered) return;
    const bmpBytes = Engine.encode1BitBMP(
      state.lastRendered.ditheredPixels,
      Engine.DISPLAY_WIDTH,
      Engine.DISPLAY_HEIGHT
    );
    downloadBlob(bmpBytes, `trmnl-horizon-${state.screenId}-${state.ditherMode}.bmp`, 'image/bmp');
  });

  document.getElementById('btnDownloadPng').addEventListener('click', () => {
    if (!state.lastRendered) return;
    const pngBytes = Engine.encodeGrayscalePNG(
      state.lastRendered.ditheredPixels,
      Engine.DISPLAY_WIDTH,
      Engine.DISPLAY_HEIGHT
    );
    downloadBlob(pngBytes, `trmnl-horizon-${state.screenId}-${state.ditherMode}.png`, 'image/png');
  });

  // Custom Image Upload -> Resize to 800x480 Grayscale -> Dither
  document.getElementById('customImageInput').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => {
        bezelStatusText.textContent = 'IMAGE DECODE FAILED // SCREEN UNCHANGED';
        e.target.value = '';
      };
      img.onload = () => {
        const off = document.createElement('canvas');
        off.width = Engine.DISPLAY_WIDTH;
        off.height = Engine.DISPLAY_HEIGHT;
        const offCtx = off.getContext('2d');
        offCtx.fillStyle = '#ffffff';
        offCtx.fillRect(0, 0, off.width, off.height);
        offCtx.drawImage(img, 0, 0, off.width, off.height);
        const rgba = offCtx.getImageData(0, 0, off.width, off.height).data;
        const gray = new Uint8Array(off.width * off.height);
        for (let i = 0; i < gray.length; i++) {
          const r = rgba[i * 4];
          const g = rgba[i * 4 + 1];
          const b = rgba[i * 4 + 2];
          // ITU-R BT.601 luma
          gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        }
        state.customGrayBuffer = gray;
        activeScreenBadge.textContent = 'custom-image';
        renderWorkbench(true);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  // Initial Render: restore a #thlab= bookmark first so a reloaded link
  // rebuilds the exact same workbench + lab state.
  restoreFromHash();
  syncFormInputsForScreen(state.screenId);
  renderWorkbench(false);
  initLab();
})();
