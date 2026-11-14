# AGENTS.md — Selene Vector 301

> Lunar Landing Site Navigator — 2026 NASA Space Apps Challenge

---

## Stack

| Layer        | Technology                              |
| ------------ | --------------------------------------- |
| Framework    | **React 18+** (functional components)   |
| Build        | **Vite**                                |
| Language     | **TypeScript** (strict mode)            |
| Styling      | **Tailwind CSS**                        |
| Icons        | **Lucide React** (`lucide-react`)       |

---

## Astrodynamics & Physics Rules

### Airless Moon Model

All ephemeris queries use `APPARENT='AIRLESS'` — the Moon has **zero atmospheric refraction**. No atmospheric correction is ever applied.

### Terrain-Aware Horizon Masking

Each site carries a **72-element `horizon_profile_deg` array** (0° to 355° azimuth in 5° steps) representing local crater-rim topography.

**Horizon lookup:**

```ts
const idx = Math.round((((az % 360) + 360) % 360) / 5) % 72;
```

**Sun visibility:**

```ts
const sun_visible = sun_el > horizon_profile_deg[idx];
```

**Earth visibility (Direct-to-Earth link):**

```ts
const earth_visible = earth_el > horizon_profile_deg[idx];
```

### Solar Panel Efficiency

```ts
const efficiency = sun_visible
  ? Math.max(0, Math.sin(radians(sun_el)) * 100)
  : 0; // percent
```

### Spherical Horizon Fallback (Custom Coordinates)

When no measured horizon profile exists, compute the geometric horizon dip:

```ts
const h_deg = -degrees(Math.acos(1737.4 / (1737.4 + Math.max(0, alt_km))));
```

Where `1737.4 km` is the mean lunar radius.

---

## CSA Rover Constraints

The Canadian Space Agency (CSA) rover imposes hard operational limits:

| Constraint               | Threshold         | Action                          |
| ------------------------ | ----------------- | ------------------------------- |
| Maximum terrain slope    | **> 15.0°**       | 🔴 **Critical safety veto**     |
| Continuous solar eclipse | **> 24 hours**    | ⚠️ **Battery-survival warning** |

- A site with `max_slope_deg > 15.0` must be flagged as **unsafe** and vetoed from the final ranking.
- A mission window where the Sun remains below the local horizon for more than 24 consecutive hours triggers a **battery-survival warning**.

---

## AHP-TOPSIS Engine

Multi-criteria decision analysis using **vector-normalized AHP-TOPSIS**:

| Criterion            | Type       | Default Weight | Description                          |
| -------------------- | ---------- | -------------- | ------------------------------------ |
| `solar_uptime_pct`   | **Benefit** | **0.35**       | Percentage of mission with sunlight  |
| `dte_uptime_pct`     | **Benefit** | **0.25**       | Direct-to-Earth comm. availability   |
| `max_slope_deg`      | **Cost**    | **0.25**       | Maximum local terrain slope          |
| `psr_distance_km`    | **Cost**    | **0.15**       | Distance to nearest PSR (water ice)  |

**Normalization:** Vector normalization — each value divided by the L2-norm of its column.

**Ranking:** Closeness coefficient to the ideal solution (`C*`), where higher is better.

---

## Mission Control Dark UI Tokens

### Color Palette

| Token                    | Hex         | Usage                              |
| ------------------------ | ----------- | ---------------------------------- |
| Background               | `#090D16`   | App / page background              |
| Cards                    | `#131B2E`   | Card and panel surfaces            |
| Borders                  | `#1E293B`   | Dividers, outlines, subtle edges   |
| Solar / Power            | `#F59E0B`   | Sun visibility, solar efficiency   |
| Earth / DTE              | `#06B6D4`   | Earth visibility, comm. uptime     |
| Water Ice / PSR          | `#3B82F6`   | PSR proximity, ice indicators      |
| Hazard / Slope > 15°     | `#EF4444`   | Safety vetoes, critical warnings   |
| Primary Text             | `#F8FAFC`   | Body text, labels, headings        |

### Typography

| Role       | Font Family        |
| ---------- | ------------------ |
| Headings   | **Space Grotesk**  |
| Monospace  | **JetBrains Mono** |

---

## Specification & Regression Gate

All implementation changes must reference REQUIREMENTS.md. Every pull request or direct change to source code must satisfy the project regression gate before merging:

- Run `npm test && npm run build` and ensure the command exits with status code 0.
- All requirement IDs in REQUIREMENTS.md must have at least one automated test in `src/lib/__tests__/` or `src/__tests__/` and must be referenced in the test descriptions.
- Changes to astrodynamics code (orbitalPhysics, AHP-TOPSIS) require a short note in the PR describing which REQ-* items are affected and why tests were updated.

This gate is mandatory and enforced by CI. It prevents regressions to physics, safety vetoes, and UI workflows.
