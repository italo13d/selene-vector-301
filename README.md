Selene Vector 301 — Lunar Landing Site Navigator

Live demo: https://selene-vector-301.vercel.app/

Overview
-
Selene Vector 301 is a mission planning prototype built for the 2026 NASA Space Apps Challenge. It presents a realistic, ephemeris-driven 3D lunar orbiter twin with tools to evaluate curated landing sites using an AHP-TOPSIS multi-criteria engine and mission timeline playback.

Key features
-
- Realistic 3D lunar globe with day/night terminator driven by JPL Horizons ephemeris (APPARENT='AIRLESS').
- 10 curated landing sites (5 historic / baseline + 5 Artemis III south pole candidates). Sites include 72-sector LRO LOLA horizon profiles.
- Per-site 169-point telemetry windows (T+0h .. T+336h at 2-hour cadence) with solar and Earth az/el, visibility masking, solar efficiency, and battery SoC trajectory (85% initial SoC).
- CSA rover safety vetoes (slope > 15°), battery survival warnings (continuous eclipse > 24h), and AHP-TOPSIS ranking with vector normalization and configurable weights.
- Playback controls (1x/5x/20x), launch delay simulator (+0d/+7d/+14d/+30d), side-by-side comparison, and export of ranking/timeline CSV and JSON.

Data pipeline
-
- Ephemeris: JPL Horizons export preprocessed into the app's ephemeris.json with APPARENT='AIRLESS' (no atmospheric refraction), 169 samples (14 days at 2-hour resolution).
- Local horizon masks: 72-sector (0°–355° in 5° steps) derived from LRO LOLA topography. Visibility rule: body_el > horizon_profile_deg[sectorIndex].
- Solar efficiency: efficiency = sun_visible ? Math.max(0, Math.sin(radians(sun_el)) * 100) : 0
- CSA safety: sites with max_slope_deg > 15.0 are flagged as a hard safety veto.
- Ranking: vector-normalized AHP-TOPSIS across solar uptime, DTE uptime (benefit) and max_slope_deg, psr_distance_km (cost). Closeness coefficient C* ∈ [0, 1].

Development
-
Prerequisites: Node 18+ recommended

Install
  npm install

Run unit tests
  npm test

Build production bundle
  npm run build

Project structure
-
- src/components — React UI components (3D globe, charts, ranking table)
- src/lib — Orbital physics, AHP-TOPSIS engine, export helpers, and numerical utilities
- src/data — Curated sites and precomputed ephemeris JSON

Notes
-
- The project intentionally uses APPARENT='AIRLESS' and spherical horizon fallbacks for custom coordinates.
- The UI includes a jsdom-friendly SVG fallback to allow automated tests in CI without WebGL.

License
-
MIT
