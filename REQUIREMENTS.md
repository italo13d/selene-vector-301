REQUIREMENTS SPECIFICATION — Selene Vector 301

This document defines the formal solution requirements for Selene Vector 301. Each requirement has a stable identifier to be referenced by unit and integration tests.

SCIENCE & ASTRODYNAMICS (REQ-SCI)

REQ-SCI-01 — Ephemeris Window & AIRLESS Modeling
  - The application shall consume ephemeris time series exported from NASA JPL Horizons with APPARENT='AIRLESS'.
  - Each telemetry window shall cover 14 Earth days at 2-hour cadence: T+0h .. T+336h inclusive (169 points).
  - Ephemeris entries shall include time string, sun_az (deg), sun_el (deg), earth_az (deg), earth_el (deg) and be referenced per site and launch offset.

REQ-SCI-02 — Terrain Horizon Masks
  - Each curated landing site shall include a 72-element horizon_profile_deg array representing measured local horizon elevation by azimuth (0°..355° in 5° steps).
  - Horizon sector lookup MUST use: sectorIndex = Math.round((((az % 360) + 360) % 360) / 5) % 72.
  - A celestial body (Sun, Earth) is visible at a telemetry point iff body_el > horizon_profile_deg[sectorIndex]. No atmospheric refraction is applied (AIRLESS).

REQ-SCI-03 — Spherical Horizon Fallback
  - For custom coordinates or when no measured horizon exists, compute a uniform 72-sector spherical horizon:
      h_deg = -degrees(acos(1737.4 / (1737.4 + Math.max(0, alt_km))))
  - The system shall provide buildHorizonProfileFromAlt(alt_km) that returns an Array(72).fill(h_deg).

REQ-SCI-04 — Solar Efficiency & Battery SoC
  - Instantaneous solar array efficiency (percent) shall be computed as:
      efficiency = sun_visible ? Math.max(0, Math.sin(radians(sun_el)) * 100) : 0
  - Battery SoC trajectory shall be computed deterministically over the 169-point window with an initial SoC of 85.0% at T+0. When sun_visible, battery charges proportional to solar_eff_pct; when eclipsed, battery discharges at ~3.2% per hour (2-hour samples applied accordingly).

REQ-SCI-05 — South Pole Ephemeris Proxy
  - For high-latitude sites (lat < -60) that do not have a dedicated ephemeris entry, the system shall automatically use the Shackleton reference ephemeris (site id: shackleton-rim) for orbital Sun/Earth geometry and apply the site's own measured 72-sector horizon_profile_deg and physical invariants (max_slope_deg, psr_distance_km).

FUNCTIONAL (REQ-FUNC)

REQ-FUNC-01 — Curated Sites
  - The application shall ship 10 curated sites by default (existing baseline sites + 5 Artemis III south pole candidates). Each site must include id, name, category, lat, lon, alt_km, max_slope_deg, psr_distance_km, description, horizon_profile_deg (72 entries).

REQ-FUNC-02 — Launch Delay Simulator
  - Provide controls for launch offsets: +0d, +7d, +14d, +30d. Changing the offset re-computes telemetry, battery trajectories, and re-runs AHP-TOPSIS ranking. The timeline scrub index must reset to T+0h when offset changes.

REQ-FUNC-03 — Timeline Playback & Scrubbing
  - Provide interactive playback controls that advance the 169-point timeline with selectable speeds 1x / 5x / 20x. Playback must wrap at the window end.
  - Scrubbing to any index MUST update CURRENT TELEMETRY, Polar Horizon chart, Sun/Earth rays on the globe, and countdowns.

REQ-FUNC-04 — Export & Comparison
  - Support exporting Ranking CSV, Ranking JSON, and per-site Timeline CSV. Exports must include generation timestamp, launch offset, site metadata, AHP-TOPSIS scores, CSA flags, and visibility metrics.
  - Provide a side-by-side Compare Sites panel showing Solar Uptime, DTE Uptime, Max Continuous Eclipse, Max Slope, CSA Veto flag, PSR distance, and AHP-TOPSIS C* score for the selected pair.

VISUAL & RENDERING (REQ-VIS)

REQ-VIS-01 — Polar Horizon Chart
  - Provide a 360° polar horizon chart rendering the site's 72-sector horizon and the Sun/Earth azimuth/elevation marker for the current telemetry index. The chart must be scrollable and match site.horizon_profile_deg indices exactly.

REQ-VIS-02 — Cached NASA Texture & UV Alignment
  - The project shall include /textures/moon_1024.jpg as a cached equirectangular albedo. When available, the renderer shall use a module-level cached THREE.TextureLoader to load this image and apply it as the material map with colorSpace = THREE.SRGBColorSpace and needsUpdate = true.
  - Fall back to a deterministic procedural 1024x512 CanvasTexture when the external texture is unavailable. Preserve the SVG/equirectangular fallback for non-WebGL test environments.
  - Material parameters: bumpMap present, bumpScale: 0.055, roughness: 0.92, metalness: 0.02.

REQ-VIS-03 — Ephemeris-Driven Day/Night Terminator
  - The 3D globe's lighting must be driven by ephemeris values (sun_az, sun_el, earth_az, earth_el) computed for the active site and timestamp. Implement a pure helper computeBodyFixedDirection(latDeg, lonDeg, azDeg, elDeg) that converts local ENU az/el into a unit body-fixed direction.
  - The Solar DirectionalLight MUST be DirectionalLight('#FFF9ED', 3.2) positioned at sunDir * 12 to produce sharp crater shadows near the terminator. A low AmbientLight('#1E293B', 0.28) and HemisphereLight('#334155', '#0F172A', 0.35) shall illuminate the night side subtly to preserve limb silhouettes and crater silhouettes.

REQ-VIS-04 — Free Orbit Controls & Camera Presets
  - The globe radius R = 2.0. Global View camera MUST be at [0, 0.8, 6.2]; South Pole Focus MUST be at [0, -4.6, 3.8] and lookAt set so the South Pole beacons are prominent.
  - Camera preset transitions MUST animate while a boolean isCameraTransitioning is true and MUST be cancelled immediately on any user drag/zoom action so the camera does not snap back to presets.

USER EXPERIENCE (REQ-UX)

REQ-UX-01 — Modes & Flight Director Controls
  - Provide Flight Director and Explorer modes. Mode switching shall preserve application state (selected site, offset, timeline index) and present plain-language insights in Explorer mode.

REQ-UX-02 — T-Minus Countdown & Badging
  - Present discriminated countdowns for Sun and DTE as described in REQ-SCI-01..04. Display CSA VETO badges when max_slope_deg > 15.0 and a Battery Critical badge when modeled SoC falls below 20%.

REQ-UX-03 — Responsive Sidebar & Search
  - The Landing Site list shall include a compact search input and a scrollable area (max-height 290px) so that all 10 curated sites are easily discoverable on typical desktop sidebars.

Traceability & Tests
  - All automated tests must reference the corresponding REQ-* identifiers in their descriptions.
  - Developers must not read src/data/ephemeris.json directly with ad-hoc filesystem reads in tests; ephemeris data shall be accessed through the application's orbitalPhysics module.
