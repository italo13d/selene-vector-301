REQUIREMENTS SPECIFICATION — Selene Vector 301

This document defines the functional, astrodynamic, safety, and UI requirements for Selene Vector 301.
Each requirement carries a unique traceable identifier (REQ-*) so that tests and implementation may be directly mapped to specification items.

REQ-ASTRO-01 — Ephemeris & Topographic Masking
  - Description: The system shall load 169-point ephemeris time series (T+0h .. T+336h inclusive at 2-hour steps) produced by NASA JPL Horizons with APPARENT='AIRLESS'.
  - Horizon masks: Each curated site shall include a 72-element horizon_profile_deg array (0° -> 355° azimuth in 5° steps) derived from LRO LOLA.
  - Visibility rule (must be applied exactly as stated): A celestial body (Sun, Earth) is visible at a telemetry point if and only if
      body_el > horizon_profile_deg[sectorIndex]
    where sectorIndex = Math.round((((az % 360) + 360) % 360) / 5) % 72. Zero atmospheric refraction is applied.
  - Trace: tests must import ephemeris and site horizon masks via module imports and assert the ephemeris length and horizon profile lengths.

REQ-ASTRO-02 — Solar Array Cosine Efficiency
  - Description: Instantaneous solar array efficiency (percent) shall be computed as
      efficiency = sun_visible ? Math.max(0, Math.sin(sun_el * Math.PI / 180) * 100) : 0
  - Trace: unit tests verify outputs at sample sun elevations (0°, 30°, -5°) and when sun_visible toggles.

REQ-ASTRO-03 — Custom Coordinates Analytical Fallback
  - Description: Support telemetry generation for arbitrary lat, lon, alt_km by applying an analytical spherical horizon when no measured horizon exists.
  - Formula: h_deg = -degrees(acos(1737.4 / (1737.4 + Math.max(0, alt_km))))
  - Properties: h_deg == 0° at alt_km == 0; at alt_km == 4.8 approx -4.25°.
  - Trace: tests must use getCustomCoordTelemetry and assert horizon_profile_deg length 72 and values matching the formula ±0.3°.

REQ-ASTRO-04 — Curated Site Physical Invariants
  - Shackleton Crater Rim (site id: shackleton-rim) at offset +0d MUST be a sunlit crater rim peak with
      solar_uptime_pct >= 70% AND dte_uptime_pct >= 45%.
  - Apollo 11 (site id: apollo-11) at offset +0d MUST behave as an equatorial baseline with
      solar_uptime_pct in [40%, 60%] (dataset-tolerant) AND dte_uptime_pct >= 95%.
  - Trace: unit tests must assert these numeric bounds using the canonical ephemeris imports.

REQ-TELEM-01 — Discriminated Countdown States & 336h Window Bound
  - Telemetry countdowns must be discriminated unions to avoid ambiguous labels:
      Sun: { state: 'SUNLIT', t_minus_sunset_hours } | { state: 'ECLIPSED', t_minus_sunrise_hours }
      DTE: { state: 'DTE_ACTIVE', t_minus_earthset_hours } | { state: 'NO_SIGNAL', t_minus_earthrise_hours }
  - Countdown arithmetic: elapsed or remaining hours between indices i and j MUST be (j - i) * 2.
  - Window bound: The ephemeris window is T+0h .. T+336h inclusive (169 points). If no transition occurs prior to or at T+336h, the countdown must be capped and displayed as the window-end (<= 336h) or a clear window-end indicator such as '>336:00'; the system must NEVER report 338:00 (an off-by-one error).
  - Trace: tests must simulate cases where transitions do not occur and assert capped values and discriminated-state usage.

REQ-CSA-01 — CSA Rover Safety Vetoes
  - Slope veto: The system shall set slope_veto: true for any site where max_slope_deg > 15.0 (strict inequality). Example: nobile-rim-1 (16.2) must be vetoed.
  - Battery risk: The system shall set battery_risk: true for any site whose max_continuous_eclipse_hours > 24.
  - Trace: AHP-TOPSIS result entries must include these flags and UI views must surface VETO and BATT badges consistently.

REQ-TOPSIS-01 — AHP-TOPSIS Multicriteria Engine
  - Normalization: Apply vector (L2) normalization independently to each criterion column across candidates.
  - Benefit vs Cost: solar_uptime_pct, dte_uptime_pct are benefits (higher better). max_slope_deg, psr_distance_km are costs (lower better). When building ideal best/worst, invert accordingly.
  - Weights: User-configured weights must be applied multiplicatively to normalized columns; weights are not required to sum to 1 but a UI warning should surface if the sum deviates from 1.
  - Closeness coefficient: Compute C* = d_minus / (d_plus + d_minus). C* must be numerically in [0, 1] (inclusive). Rankings are deterministic and stable for identical inputs.
  - Trace: Unit tests must verify C* bounds, deterministic ranking, and that weight changes change ordering.

REQ-UI-01 — Mission Control Interactive Workflows
  - Site selection: Clicking or selecting a site updates telemetry, the polar horizon chart, the timeline, and active highlights. The selected site must be visually indicated.
  - Launch delay simulator: The +0d/+7d/+14d/+30d controls re-run the telemetry and ranking calculations and reset timeline scrub index to T+0h.
  - Timeline scrubbing: Scrubbing a slot updates CURRENT TELEMETRY timestamp and the displayed efficiency/status. Eclipse segments must use color #1E293B (slate) exactly as in the legend. The scrubbed bar must be highlighted with an outline (ring-2 ring-white z-10) without obscuring its underlying state color.
  - Mode switcher: The Flight Director <-> Explorer switcher must toggle views without losing application state and must expose plain-language insights in Explorer mode.
  - Trace: Integration/UI tests must assert DOM elements, CSS classes, and textual badges reflecting these behaviors.

REQ-EXP-01 — Mission Dossier Export
  - The application shall support exporting ranking CSV, ranking JSON, and per-site timeline CSV. Exports must be non-empty, validly formatted, and include metadata: generation timestamp, launch offset, site metadata, AHP-TOPSIS scores, CSA flags, visibility metrics.
  - Trace: Functional tests must stub the download mechanism and assert generated filenames and content presence.

Traceability matrix
  - All test names and test files must include at least one REQ-* identifier in their description to make mapping between tests and requirements explicit.

Maintenance notes
  - Developers must not read ephemeris.json directly with filesystem reads in tests; ephemeris data must be loaded via imports (the code's modules already import ephemeris.json for canonical access).
  - Any change to AGENTS, physics constants (e.g., lunar radius), or CSA thresholds must update this file and corresponding tests.
