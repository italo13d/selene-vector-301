#!/usr/bin/env python3
"""
Selene Vector 301 — Ephemeris Fetcher
=====================================
Queries NASA JPL Horizons REST API for Sun and Earth ephemeris data
as seen from curated lunar landing sites across multiple mission windows.

Uses ONLY Python standard library modules.
Outputs: src/data/ephemeris.json
"""

import os
import json
import math
import time
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api"
REQUEST_DELAY = 0.4  # seconds between HTTP requests

BASE_DATE = datetime(2026, 11, 20)
MISSION_DURATION_DAYS = 14
OFFSETS = [0, 7, 14, 30]
OFFSET_KEYS = ["+0d", "+7d", "+14d", "+30d"]

BODIES = [
    {"name": "Sun",   "command": "10"},
    {"name": "Earth", "command": "399"},
]

SITES_PATH = os.path.join(os.path.dirname(__file__), "..", "src", "data", "sites.json")
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "src", "data", "ephemeris.json")

# ---------------------------------------------------------------------------
# Analytical fallback (deterministic selenographic model)
# ---------------------------------------------------------------------------

def analytical_sun_position(t: datetime, lat: float, lon: float) -> tuple:
    """
    Deterministic analytical approximation for Sun azimuth/elevation
    as seen from a point on the lunar surface.

    The Moon's synodic period is ~29.53 days. The Sun's ecliptic longitude
    as seen from the Moon advances ~12.19 deg/day.
    """
    # Days since J2000.0
    j2000 = datetime(2000, 1, 1, 12, 0, 0)
    d = (t - j2000).total_seconds() / 86400.0

    # Mean synodic period of the Moon
    P_syn = 29.530589
    # Sun's selenographic sub-solar longitude cycles with synodic period
    sun_sel_lon = (d / P_syn * 360.0) % 360.0
    # Sun's selenographic latitude oscillates with obliquity (~1.54 deg)
    obliquity = 1.5424
    sun_sel_lat = obliquity * math.sin(math.radians(sun_sel_lon * 2.0))

    # Hour angle
    ha = sun_sel_lon - lon
    ha_rad = math.radians(ha)
    lat_rad = math.radians(lat)
    dec_rad = math.radians(sun_sel_lat)

    # Elevation
    sin_el = (math.sin(lat_rad) * math.sin(dec_rad) +
              math.cos(lat_rad) * math.cos(dec_rad) * math.cos(ha_rad))
    sin_el = max(-1.0, min(1.0, sin_el))
    el = math.degrees(math.asin(sin_el))

    # Azimuth
    cos_el = math.cos(math.radians(el))
    if abs(cos_el) < 1e-10:
        az = 0.0
    else:
        cos_az = ((math.sin(dec_rad) - math.sin(lat_rad) * sin_el) /
                  (math.cos(lat_rad) * cos_el))
        cos_az = max(-1.0, min(1.0, cos_az))
        az = math.degrees(math.acos(cos_az))
        if math.sin(ha_rad) > 0:
            az = 360.0 - az

    return round(az, 4), round(el, 4)


def analytical_earth_position(t: datetime, lat: float, lon: float) -> tuple:
    """
    Deterministic analytical approximation for Earth azimuth/elevation
    as seen from a point on the lunar surface.

    Earth's selenographic sub-Earth point librates with the sidereal month
    (~27.3217 days) in longitude (±7.9°) and latitude (±6.7°).
    """
    j2000 = datetime(2000, 1, 1, 12, 0, 0)
    d = (t - j2000).total_seconds() / 86400.0

    P_sid = 27.321661
    # Earth's selenographic longitude libration
    lib_lon_amp = 7.9
    lib_lat_amp = 6.7
    phase = (d / P_sid) * 2.0 * math.pi

    earth_sel_lon = lib_lon_amp * math.sin(phase)
    earth_sel_lat = lib_lat_amp * math.sin(phase + math.pi / 4.0)

    ha = earth_sel_lon - lon
    ha_rad = math.radians(ha)
    lat_rad = math.radians(lat)
    dec_rad = math.radians(earth_sel_lat)

    sin_el = (math.sin(lat_rad) * math.sin(dec_rad) +
              math.cos(lat_rad) * math.cos(dec_rad) * math.cos(ha_rad))
    sin_el = max(-1.0, min(1.0, sin_el))
    el = math.degrees(math.asin(sin_el))

    cos_el = math.cos(math.radians(el))
    if abs(cos_el) < 1e-10:
        az = 0.0
    else:
        cos_az = ((math.sin(dec_rad) - math.sin(lat_rad) * sin_el) /
                  (math.cos(lat_rad) * cos_el))
        cos_az = max(-1.0, min(1.0, cos_az))
        az = math.degrees(math.acos(cos_az))
        if math.sin(ha_rad) > 0:
            az = 360.0 - az

    return round(az, 4), round(el, 4)


def generate_fallback(site: dict, start: datetime, days: int) -> list:
    """Generate analytical fallback ephemeris points at 2-hour intervals."""
    points = []
    total_steps = days * 12  # 24h / 2h = 12 steps per day
    for i in range(total_steps + 1):
        t = start + timedelta(hours=i * 2)
        sun_az, sun_el = analytical_sun_position(t, site["lat"], site["lon"])
        earth_az, earth_el = analytical_earth_position(t, site["lat"], site["lon"])
        points.append({
            "t": t.strftime("%Y-%b-%d %H:%M"),
            "sun_az": sun_az,
            "sun_el": sun_el,
            "earth_az": earth_az,
            "earth_el": earth_el,
        })
    return points


# ---------------------------------------------------------------------------
# Horizons API query
# ---------------------------------------------------------------------------

def query_horizons(command: str, site: dict, start_date: str, stop_date: str) -> str | None:
    """
    Query NASA JPL Horizons REST API.
    Returns the raw JSON response text, or None on failure.
    """
    params = {
        "format":      "json",
        "COMMAND":     f"'{command}'",
        "OBJ_DATA":    "'NO'",
        "MAKE_EPHEM":  "'YES'",
        "EPHEM_TYPE":  "'OBSERVER'",
        "CENTER":      "'coord@301'",
        "COORD_TYPE":  "'GEODETIC'",
        "SITE_COORD":  f"'{site['lon']},{site['lat']},{site['alt_km']}'",
        "START_TIME":  f"'{start_date}'",
        "STOP_TIME":   f"'{stop_date}'",
        "STEP_SIZE":   "'2 h'",
        "QUANTITIES":  "'4'",
        "APPARENT":    "'AIRLESS'",
    }

    url = HORIZONS_API + "?" + urllib.parse.urlencode(params, safe="'")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SeleneVector301/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8")
    except Exception as e:
        print(f"    [WARN] HTTP request failed: {e}")
        return None


def parse_horizons_result(raw_json: str) -> list:
    """
    Parse Horizons JSON response, extracting azimuth and elevation
    from lines between $$SOE and $$EOE markers.

    Handles optional solar presence flag in column 3 by extracting
    the last two numeric tokens as (azimuth, elevation).
    """
    data = json.loads(raw_json)
    result_text = data.get("result", "")

    lines = result_text.split("\n")
    in_data = False
    points = []

    for line in lines:
        stripped = line.strip()
        if stripped == "$$SOE":
            in_data = True
            continue
        if stripped == "$$EOE":
            in_data = False
            continue
        if not in_data or not stripped:
            continue

        tokens = stripped.split()
        if len(tokens) < 4:
            continue

        try:
            # Timestamp is always first two tokens: "YYYY-Mon-DD" "HH:MM"
            timestamp = tokens[0] + " " + tokens[1]
            # Azimuth and elevation are the last two numeric tokens
            az = float(tokens[-2])
            el = float(tokens[-1])
            points.append({
                "t": timestamp,
                "sun_az": 0.0,   # placeholder — set by caller
                "sun_el": 0.0,
                "earth_az": 0.0,
                "earth_el": 0.0,
                "az": az,
                "el": el,
            })
        except (ValueError, IndexError):
            continue

    return points


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("  Selene Vector 301 — Ephemeris Fetcher")
    print("=" * 60)

    # Load sites
    sites_abs = os.path.abspath(SITES_PATH)
    print(f"\nLoading sites from: {sites_abs}")
    with open(sites_abs, "r", encoding="utf-8") as f:
        sites = json.load(f)
    print(f"  Found {len(sites)} sites.\n")

    ephemeris = {}

    for site in sites:
        sid = site["id"]
        ephemeris[sid] = {}
        print(f"--- Site: {site['name']} ({sid}) ---")
        print(f"    lat={site['lat']}, lon={site['lon']}, alt_km={site['alt_km']}")

        for offset, key in zip(OFFSETS, OFFSET_KEYS):
            start_dt = BASE_DATE + timedelta(days=offset)
            stop_dt = start_dt + timedelta(days=MISSION_DURATION_DAYS)
            start_str = start_dt.strftime("%Y-%m-%d")
            stop_str = stop_dt.strftime("%Y-%m-%d")

            print(f"\n  Window {key}: {start_str} to {stop_str}")

            sun_points = None
            earth_points = None
            source = "NASA JPL Horizons"
            used_fallback = False

            # --- Fetch Sun ---
            print(f"    Querying Sun (COMMAND='10') ...")
            raw_sun = query_horizons("10", site, start_str, stop_str)
            if raw_sun:
                sun_points = parse_horizons_result(raw_sun)
                if sun_points:
                    print(f"    Sun: {len(sun_points)} data points received.")
                else:
                    print(f"    [WARN] Sun: parsing returned 0 points.")
                    raw_sun = None

            time.sleep(REQUEST_DELAY)

            # --- Fetch Earth ---
            print(f"    Querying Earth (COMMAND='399') ...")
            raw_earth = query_horizons("399", site, start_str, stop_str)
            if raw_earth:
                earth_points = parse_horizons_result(raw_earth)
                if earth_points:
                    print(f"    Earth: {len(earth_points)} data points received.")
                else:
                    print(f"    [WARN] Earth: parsing returned 0 points.")
                    raw_earth = None

            time.sleep(REQUEST_DELAY)

            # --- Merge or fallback ---
            if sun_points and earth_points and len(sun_points) == len(earth_points):
                merged = []
                for sp, ep in zip(sun_points, earth_points):
                    merged.append({
                        "t": sp["t"],
                        "sun_az": sp["az"],
                        "sun_el": sp["el"],
                        "earth_az": ep["az"],
                        "earth_el": ep["el"],
                    })
                print(f"    ✓ Live NASA JPL Horizons data saved for {sid} window {key}.")
            else:
                # Fallback
                if not sun_points and not earth_points:
                    reason = "both Sun and Earth requests failed"
                elif not sun_points:
                    reason = "Sun request failed"
                elif not earth_points:
                    reason = "Earth request failed"
                else:
                    reason = "point count mismatch between Sun and Earth"

                print(f"    [FALLBACK] Using analytical model ({reason}).")
                merged = generate_fallback(site, start_dt, MISSION_DURATION_DAYS)
                source = "Analytical Fallback"
                used_fallback = True

            ephemeris[sid][key] = {
                "start_date": start_str,
                "source": source,
                "points": merged,
            }

            if used_fallback:
                print(f"    ⚠ Analytical Fallback data saved for {sid} window {key}.")
            else:
                print(f"    ✓ Live NASA JPL Horizons data saved for {sid} window {key}.")

    # --- Write output ---
    output_abs = os.path.abspath(OUTPUT_PATH)
    os.makedirs(os.path.dirname(output_abs), exist_ok=True)
    with open(output_abs, "w", encoding="utf-8") as f:
        json.dump(ephemeris, f, indent=2)

    print(f"\n{'=' * 60}")
    print(f"  Ephemeris saved to: {output_abs}")
    total_windows = sum(len(v) for v in ephemeris.values())
    live_count = sum(
        1 for s in ephemeris.values()
        for w in s.values()
        if w["source"] == "NASA JPL Horizons"
    )
    fallback_count = total_windows - live_count
    print(f"  Total windows: {total_windows}  |  Live: {live_count}  |  Fallback: {fallback_count}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
