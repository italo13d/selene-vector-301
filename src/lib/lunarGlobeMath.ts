// src/lib/lunarGlobeMath.ts
// Pure math helpers for lunar globe projections and illumination vectors

export function degreesToRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function latLonToCartesian(latDeg: number, lonDeg: number, radius: number): { x: number; y: number; z: number } {
  // +Y is Lunar North Pole (+90° latitude), -Y is South Pole
  const lat = degreesToRadians(latDeg);
  const lon = degreesToRadians(lonDeg);
  const cosLat = Math.cos(lat);
  const x = radius * cosLat * Math.cos(lon);
  const z = radius * cosLat * Math.sin(lon);
  const y = radius * Math.sin(lat);
  return { x, y, z };
}

export function computeSunDirectionVector(sunAzDeg: number, sunElDeg: number, siteLatDeg: number, siteLonDeg: number): { x: number; y: number; z: number } {
  // Convert local az/el (degrees) into ECEF vector pointing from surface to Sun
  // Assumes az measured clockwise from North (0° = North), elevation above local horizon.
  const az = degreesToRadians(sunAzDeg);
  const el = degreesToRadians(sunElDeg);
  const sinEl = Math.sin(el);
  const cosEl = Math.cos(el);

  // Local ENU components
  const e = cosEl * Math.sin(az); // East
  const n = cosEl * Math.cos(az); // North
  const u = sinEl; // Up

  // Site lat/lon
  const phi = degreesToRadians(siteLatDeg); // latitude
  const lambda = degreesToRadians(siteLonDeg); // longitude

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLam = Math.sin(lambda);
  const cosLam = Math.cos(lambda);

  // ENU to ECEF basis vectors
  // east = [-sinλ, cosλ, 0]
  // north = [-sinφ*cosλ, -sinφ*sinλ, cosφ]
  // up = [cosφ*cosλ, cosφ*sinλ, sinφ]
  const vx = e * -sinLam + n * (-sinPhi * cosLam) + u * (cosPhi * cosLam);
  const vy = e * cosLam + n * (-sinPhi * sinLam) + u * (cosPhi * sinLam);
  const vz = e * 0 + n * cosPhi + u * sinPhi;

  const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
  return { x: vx / len, y: vy / len, z: vz / len };
}

export default { latLonToCartesian, computeSunDirectionVector };
