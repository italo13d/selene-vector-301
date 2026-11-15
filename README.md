# Selene Vector 301 - Lunar Landing Site Navigator

Live demo: https://selene-vector-301.vercel.app/

## Overview

Selene Vector 301 is a mission planning prototype for the 2026 NASA Space Apps Challenge. It combines JPL Horizons ephemeris, LRO LOLA terrain horizon masking, and vector-normalized AHP-TOPSIS ranking to evaluate lunar landing sites for power, communications, and rover safety.

## NASA Space Apps Judge-Facing Highlights (6 Capabilities)

1. **360° LOLA Local Horizon Sky-Dome**
   - `PolarHorizonChart` renders a full 72-sector local horizon (5° bins, 0°..355° azimuth) with terrain-aware Sun/Earth visibility checks.
2. **Earth Libration Track (Figure-8 Analemma)**
   - Earth's near-horizon path is drawn and explained so DTE drops are interpreted as geometry/topography effects, not random outages.
3. **T-Minus Sunset / Earthset Countdowns**
   - Real-time `T-MINUS` cards show next Sun/Earth set or rise events for operations pacing (power and comm windows).
4. **Flight Director vs. Explorer Modes**
   - Flight Director mode provides mission-control telemetry depth; Explorer mode translates the same physics into plain-language educational storytelling.
5. **14-Day Nominal Surface Window Rationale**
   - Timeline explicitly labels the 336h window as a nominal CLPS/Artemis pre-lunar-night operations segment (half synodic lunar day).
6. **Idealized Spherical Disclaimer for Custom Coordinates**
   - Custom-coordinate runs display a scientific transparency badge: measured LOLA 72-sector masks are unavailable, so an idealized spherical horizon fallback is used and polar lighting may be overestimated.

## Core Features

- Realistic 3D lunar globe with ephemeris-driven day/night terminator (`APPARENT='AIRLESS'`, no atmospheric refraction).
- 10 curated landing sites (historic + Artemis III candidates), each with local terrain profile, slope, and PSR proximity metadata.
- Per-site 169-point telemetry windows (`T+0h .. T+336h` at 2-hour cadence): Sun/Earth az/el, visibility, solar efficiency, battery SoC.
- CSA rover constraints: hard veto when slope exceeds 15°, and eclipse-duration survival warnings (>24h continuous darkness).
- AHP-TOPSIS ranking with configurable weights, side-by-side comparison, launch delay simulation, and CSV/JSON exports.

## Data & Physics Pipeline

- Ephemeris source: NASA JPL Horizons export with `APPARENT='AIRLESS'`.
- Local horizon masking: 72-sector LRO LOLA profile lookup by azimuth index.
- Spherical fallback for custom coordinates: `h_deg = -degrees(acos(1737.4 / (1737.4 + max(0, alt_km))))`.
- Solar efficiency model: `efficiency = sun_visible ? max(0, sin(radians(sun_el)) * 100) : 0`.
- Ranking engine: vector-normalized AHP-TOPSIS over solar uptime, DTE uptime, slope, and PSR distance.

## Development

Prerequisite: Node 18+

Install:

```bash
npm install
```

Run tests:

```bash
npm test
```

Build production bundle:

```bash
npm run build
```

## Project Structure

- `src/components` - React UI components (globe, charting, ranking table)
- `src/lib` - Orbital physics, countdowns, AHP-TOPSIS, export utilities
- `src/data` - Curated site metadata and precomputed ephemeris assets

## Notes

- The UI ships with a jsdom-friendly SVG fallback for CI environments without WebGL.
- For custom coordinates, telemetry remains physically consistent with the spherical fallback model but is less terrain-faithful than LOLA-surveyed curated sites.

## License

MIT
