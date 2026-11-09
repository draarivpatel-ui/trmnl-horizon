(function () {
  'use strict';

  const Engine = window.TrmnlEngine;
  if (!Engine) {
    console.error('TrmnlEngine not loaded.');
    return;
  }

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

  // Initial Render
  syncFormInputsForScreen(state.screenId);
  renderWorkbench(false);
})();
