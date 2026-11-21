# TRMNL-Horizon

**Self-Hosted TRMNL BYOS Server, 800x480 1-Bit E-Paper Dithering Engine & Native `.liquid` Plugin Suite**

[![Live Workbench](https://img.shields.io/badge/Live_Workbench-aariv.me%2Ftrmnl--horizon-d95d24?style=flat-square)](https://aariv.me/trmnl-horizon/)
[![License: MIT](https://img.shields.io/badge/License-MIT-2c8a56?style=flat-square)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-46_Passing-141517?style=flat-square)](test.js)

**TRMNL-Horizon** is a complete self-hosted **BYOS (`Bring Your Own Server`)** backend, **800x480 1-bit & 2-bit e-paper dithering pipeline**, and **native `.liquid` plugin workbench** built for the **TRMNL 7.5" (UC8179 / ESP32-C3)** e-paper display ecosystem.

- **Live Hardware Workbench:** [https://aariv.me/trmnl-horizon/](https://aariv.me/trmnl-horizon/)
- **Repository:** [https://github.com/draarivpatel-ui/trmnl-horizon](https://github.com/draarivpatel-ui/trmnl-horizon)

---

## Key Capabilities

1. **800x480 1-Bit & 2-Bit E-Paper Framebuffer & Dithering Pipeline (`trmnl_engine.js`)**
   - **Atkinson Dithering:** Bill Atkinson's classic Macintosh 6/8 error-diffusion kernel (`1/8` to 6 neighbors: `(x+1,y)`, `(x+2,y)`, `(x-1,y+1)`, `(x,y+1)`, `(x+1,y+1)`, `(x,y+2)`), preserving crisp midtone contrast on reflective e-paper displays without speckle muddiness.
   - **Floyd-Steinberg Error Diffusion:** Full `16/16` error diffusion (`7/16`, `3/16`, `5/16`, `1/16`) across 1-bit (`{0, 255}`) and 2-bit 4-level grayscale (`{0, 85, 170, 255}`).
   - **Bayer 4x4 & 8x8 Ordered Halftones:** Deterministic cross-hatch threshold matrices for flicker-free partial updates.
   - **Exact 48,062-Byte 1-Bit Monochrome BMP Encoder:** Generates standard Windows `BITMAPINFOHEADER` 1-bit monochrome `.bmp` payloads (`14-byte` file header + `40-byte` DIB header + `8-byte` 2-color palette + `48,000` packed pixel bytes) ready for direct rendering by the TRMNL ESP32-C3 firmware.
   - **Zero-Dependency Grayscale PNG Encoder:** Built-in RFC 1950 / RFC 1952 `CRC32` + `Adler32` + stored DEFLATE block encoder that works identically in Node.js and the browser.

2. **Four Built-In 800x480 High-Utility E-Ink Screen Presets**
   - **01 // Corridor Dispatch Board (`corridor`):** Live GTFS rail departures, track assignments, car-load progress bars, headway adherence gauge, and hourly passenger load curve.
   - **02 // Orbital Pass & Solar Ephemeris (`orbital`):** Next ISS / NOAA-19 / Meteor-M2 horizon pass azimuth/elevation polar radar plot, sinusoidal ground-track map with cosine day/night terminator shading, and civil dawn/sunrise/noon/sunset/dusk ephemeris bar.
   - **03 // Hardware Lab Bench Telemetry (`labbench`):** Self-hosted cluster node CPU/memory/temperature utilization, TRMNL `1800 mAh` LiPo discharge curve (`4.20V` to `3.20V`), GitHub CI build matrix, and BYOS verification checklist.
   - **04 // Classical Rhythm & Practice Almanac (`rhythm`):** Daily raga reference card (*Aroha*, *Avaroha*, *Pakad*, *Vadi/Samvadi*), 16-matra *Teentaal* avartan *Vibhag* grid (`X`, `2`, `0`, `3`), and 28-day practice continuity log.

3. **Official TRMNL BYOS Device Protocol Server (`server.js`)**
   - Implements the exact HTTP endpoints and headers expected by physical TRMNL ESP32-C3 firmware (`ID`, `Access-Token`, `Refresh-Rate`, `Battery-Voltage`, `FW-Version`, `RSSI`):
     - `GET /api/setup` -> Device provisioning (`api_key`, `friendly_id`, `image_url`)
     - `GET /api/display` -> Screen poll response (`image_url`, `filename`, `refresh_rate`, `reset_firmware`, `update_firmware`)
     - `POST /api/log` -> Device wakeup & Wi-Fi telemetry ingestion (`logs_array`)
     - `GET /api/bitmap/:filename.bmp` -> Streams the `48,062-byte` 1-bit `.bmp` framebuffer directly to the device
     - `GET /api/liquid` -> Exports ready-to-paste TRMNL `.liquid` templates (`full`, `half_horizontal`, `half_vertical`, `quadrant`)

4. **ESP32-C3 + UC8179 Power & Battery Life Physics Estimator**
   - Models deep-sleep current (`18 uA`), active Wi-Fi + TLS fetch + e-paper LUT refresh burst (`78 mA`), RSSI retransmission penalty (`-45 dBm` to `-88 dBm`), and LiPo state-of-charge curve (`1200 mAh`, `1800 mAh`, `2500 mAh`).

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/draarivpatel-ui/trmnl-horizon.git
cd trmnl-horizon

# Run the 58-test verification suite (Node.js 18+ / 22+, zero npm dependencies required)
node --test

# Start the self-hosted TRMNL BYOS HTTP server & web workbench on port 8080
node server.js
```

Point any physical TRMNL device (during Wi-Fi captive portal setup -> *Custom Server URL*) or `curl` client to `http://<your-lan-ip>:8080`:

```bash
# 1. Provision a TRMNL device via GET /api/setup
curl -s -H "ID: A0:B7:65:FE:12:9C" http://localhost:8080/api/setup | jq .

# 2. Poll next 800x480 e-paper frame via GET /api/display
curl -s \
  -H "ID: A0:B7:65:FE:12:9C" \
  -H "Access-Token: trmnl_byos_a0b765fe129c_horizon" \
  -H "Battery-Voltage: 4.04" \
  -H "RSSI: -58" \
  -H "Refresh-Rate: 300" \
  "http://localhost:8080/api/display?screen=orbital&dither=atkinson" | jq .

# 3. Download a 48,062-byte 1-bit monochrome BMP frame directly
curl -sO http://localhost:8080/api/bitmap/horizon-orbital-atkinson-v1.bmp
```

---

## Deployment Trust Model

This mirrors the official TRMNL BYOS trust model: endpoints are unauthenticated
and `Access-Control-Allow-Origin: *` is sent on every response. `ID` and
`Access-Token` headers are parsed and recorded but never validated, and the
device `api_key` is derived deterministically from the claimed MAC. Run the
server on localhost or a trusted LAN only; do not expose it to untrusted
networks. The static file handler serves only the four workbench files
(`index.html`, `style.css`, `app.js`, `trmnl_engine.js`). Repo internals such
as `.git/`, `server.js` and `test.js` are not reachable over HTTP.

## Repository Structure

```text
trmnl-horizon/
├── index.html                  # Interactive 800x480 E-Paper Hardware Workbench UI
├── style.css                   # Industrial matte e-paper & graphite bezel stylesheet
├── app.js                      # Real-time canvas renderer, LUT flash, BMP/PNG/Liquid exporters
├── trmnl_engine.js             # UMD core: framebuffer, dithering, 1-bit BMP/PNG, BYOS handlers
├── server.js                   # Zero-dependency Node.js TRMNL BYOS HTTP server
├── test.js                     # 58 unit & HTTP integration tests (node:test)
└── plugins/                    # Ready-to-paste TRMNL native .liquid plugin templates
    ├── corridor/               # full.liquid, half_horizontal.liquid, half_vertical.liquid, quadrant.liquid
    ├── orbital/
    ├── labbench/
    └── rhythm/
```

---

## License

Released under the [MIT License](LICENSE).
