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

// Compute a body-fixed direction vector from local azimuth/elevation using ENU basis
// latDeg, lonDeg: site geodetic coordinates in degrees
// azDeg: azimuth measured clockwise from North (0 = North)
// elDeg: elevation above local horizon in degrees
// Returns unit vector in body-fixed ECEF-like coordinates (x,y,z)
export function computeBodyFixedDirection(latDeg: number, lonDeg: number, azDeg: number, elDeg: number) {
  const lat = degreesToRadians(latDeg);
  const lon = degreesToRadians(lonDeg);
  const az = degreesToRadians(azDeg);
  const el = degreesToRadians(elDeg);

  // Up unit vector at site (surface normal)
  const sinPhi = Math.sin(lat);
  const cosPhi = Math.cos(lat);
  const sinLam = Math.sin(lon);
  const cosLam = Math.cos(lon);
  const Ux = cosPhi * cosLam;
  const Uy = cosPhi * sinLam;
  const Uz = sinPhi;

  // Global +Y axis
  const Yx = 0;
  const Yy = 1;
  const Yz = 0;

  // N = normalize(Y - (Y·U) U)
  const YdotU = Yx * Ux + Yy * Uy + Yz * Uz;
  let Nx = Yx - YdotU * Ux;
  let Ny = Yy - YdotU * Uy;
  let Nz = Yz - YdotU * Uz;
  const Nlen = Math.sqrt(Nx * Nx + Ny * Ny + Nz * Nz) || 1;
  Nx /= Nlen; Ny /= Nlen; Nz /= Nlen;

  // E = normalize(N × U)
  let Ex = Ny * Uz - Nz * Uy;
  let Ey = Nz * Ux - Nx * Uz;
  let Ez = Nx * Uy - Ny * Ux;
  const Elen = Math.sqrt(Ex * Ex + Ey * Ey + Ez * Ez) || 1;
  Ex /= Elen; Ey /= Elen; Ez /= Elen;

  const cosEl = Math.cos(el);
  const sinEl = Math.sin(el);
  const cosAz = Math.cos(az);
  const sinAz = Math.sin(az);

  // dir = cos(el)*cos(az)*N + cos(el)*sin(az)*E + sin(el)*U
  const dx = cosEl * cosAz * Nx + cosEl * sinAz * Ex + sinEl * Ux;
  const dy = cosEl * cosAz * Ny + cosEl * sinAz * Ey + sinEl * Uy;
  const dz = cosEl * cosAz * Nz + cosEl * sinAz * Ez + sinEl * Uz;
  const dlen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return { x: dx / dlen, y: dy / dlen, z: dz / dlen };
}

// Module-level singleton cache for generated lunar textures
export const lunarTextureCache: { albedo?: HTMLCanvasElement | null; bump?: HTMLCanvasElement | null; threeAlbedo?: any; threeBump?: any } = { albedo: null, bump: null };

// Simple deterministic PRNG (mulberry32)
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function latLonToEquirect(lat: number, lon: number, width: number, height: number) {
  // equirectangular projection: lon -180..180 -> x 0..width, lat 90..-90 -> y 0..height
  const x = ((lon + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return { x, y };
}

// Camera transition helper used by UI tests: only step transition when user not interacting and target distance far enough
export function shouldStepCameraTransition(isUserInteracting: boolean, currentDistance: number, targetDistance: number): boolean {
  if (isUserInteracting) return false;
  return Math.abs(currentDistance - targetDistance) >= 0.02;
}

// Pure CPU generator that produces an RGBA pixel buffer for unit testing without DOM canvas
export function generateLunarRGBA(seed = 1337, width = 1024, height = 512) {
  const rand = mulberry32(seed);
  const buf = new Uint8ClampedArray(width * height * 4);
  // fill base mid-gray highlands
  for (let i = 0; i < width * height; i++) {
    const v = 180; // base
    buf[i * 4 + 0] = v;
    buf[i * 4 + 1] = v;
    buf[i * 4 + 2] = v;
    buf[i * 4 + 3] = 255;
  }

  // helper to set pixel
  function setPixel(x: number, y: number, r: number, g: number, b: number, a = 255) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
    buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = a;
  }

  // draw maria ellipses
  const maria = [
    { lat: 8.5, lon: 31.4, rx: 220, ry: 140, col: [51,65,85] }, // Mare Tranquillitatis
    { lat: 18, lon: -57, rx: 360, ry: 200, col: [55,75,89] }, // Oceanus Procellarum
    { lat: 32, lon: -15, rx: 180, ry: 120, col: [51,65,85] }, // Mare Imbrium
    { lat: 25, lon: 18, rx: 150, ry: 90, col: [71,85,105] }, // Mare Serenitatis-ish
  ];
  for (const m of maria) {
    const p = latLonToEquirect(m.lat, m.lon, width, height);
    for (let y = Math.max(0, Math.floor(p.y - m.ry * 1.2)); y < Math.min(height, Math.ceil(p.y + m.ry * 1.2)); y++) {
      for (let x = Math.max(0, Math.floor(p.x - m.rx * 1.2)); x < Math.min(width, Math.ceil(p.x + m.rx * 1.2)); x++) {
        const dx = (x - p.x) / m.rx;
        const dy = (y - p.y) / m.ry;
        if (dx * dx + dy * dy <= 1.0) {
          const idx = (y * width + x) * 4;
          // blend darker maria color
          buf[idx] = Math.floor(m.col[0] * (0.6 + 0.4 * rand()));
          buf[idx + 1] = Math.floor(m.col[1] * (0.6 + 0.4 * rand()));
          buf[idx + 2] = Math.floor(m.col[2] * (0.6 + 0.4 * rand()));
        }
      }
    }
  }

  // Tycho rays
  const tycho = { lat: -43.3, lon: -11.2, r: 60 };
  const tp = latLonToEquirect(tycho.lat, tycho.lon, width, height);
  for (let i = 0; i < 120; i++) {
    const aang = rand() * Math.PI * 2;
    const x0 = tp.x + Math.cos(aang) * tycho.r * rand() * 0.6;
    const y0 = tp.y + Math.sin(aang) * tycho.r * rand() * 0.6;
    const x1 = tp.x + Math.cos(aang) * (tycho.r * (4 + rand() * 30));
    const y1 = tp.y + Math.sin(aang) * (tycho.r * (4 + rand() * 30));
    // line draw (bresenham-lite)
    const steps = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0)));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const x = Math.floor(x0 + (x1 - x0) * t);
      const y = Math.floor(y0 + (y1 - y0) * t);
      const v = 245 - Math.floor(rand() * 40);
      setPixel(x, y, v, v, v, 255);
    }
  }

  // craters concentrated in southern highlands
  for (let i = 0; i < 650; i++) {
    const lon = (rand() * 360) - 180;
    const lat = -90 + Math.pow(rand(), 1.6) * 140;
    const p = latLonToEquirect(lat, lon, width, height);
    const r = 2 + Math.floor(rand() * 22);
    // simple rim: dark outer, bright inner
    for (let yy = Math.max(0, Math.floor(p.y - r - 1)); yy < Math.min(height, Math.ceil(p.y + r + 1)); yy++) {
      for (let xx = Math.max(0, Math.floor(p.x - r - 1)); xx < Math.min(width, Math.ceil(p.x + r + 1)); xx++) {
        const dx = xx - p.x;
        const dy = yy - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= (r + 0.5) * (r + 0.5) && d2 >= (r - 1) * (r - 1)) {
          // rim darker
          const idx = (yy * width + xx) * 4;
          buf[idx] = Math.max(0, buf[idx] - Math.floor(40 * rand()));
          buf[idx + 1] = Math.max(0, buf[idx + 1] - Math.floor(40 * rand()));
          buf[idx + 2] = Math.max(0, buf[idx + 2] - Math.floor(40 * rand()));
        } else if (d2 < (r * 0.6) * (r * 0.6)) {
          // crater floor slightly brighter/darker random
          const idx = (yy * width + xx) * 4;
          const delta = Math.floor((rand() - 0.5) * 40);
          buf[idx] = Math.max(0, Math.min(255, buf[idx] + delta));
          buf[idx + 1] = Math.max(0, Math.min(255, buf[idx + 1] + delta));
          buf[idx + 2] = Math.max(0, Math.min(255, buf[idx + 2] + delta));
        }
      }
    }
  }

  return buf;
}

// Create deterministic procedural lunar albedo + bump canvas elements and cache them.
// Returns HTMLCanvasElement pair. Caller may convert to THREE.CanvasTexture.
export function createOrGetLunarTextureCanvases(seed = 1337, width = 1024, height = 512) {
  if (lunarTextureCache.albedo && lunarTextureCache.bump) {
    return { albedo: lunarTextureCache.albedo, bump: lunarTextureCache.bump };
  }
  const rand = mulberry32(seed);
  // albedo
  const a = document.createElement('canvas');
  a.width = width;
  a.height = height;
  const ctx = a.getContext('2d')!;
  // base regolith
  ctx.fillStyle = '#6b6b6b';
  ctx.fillRect(0, 0, width, height);

  // draw large maria basins (approx positions)
  const maria = [
    { lat: 8.5, lon: 31.4, rx: 220, ry: 140 }, // Mare Tranquillitatis
    { lat: 18, lon: -57, rx: 360, ry: 200 }, // Oceanus Procellarum (broad)
    { lat: 32, lon: -15, rx: 180, ry: 120 }, // Mare Imbrium approximate
  ];
  ctx.fillStyle = '#33383d';
  for (const m of maria) {
    const p = latLonToEquirect(m.lat, m.lon, width, height);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, m.rx * (0.8 + rand() * 0.4), m.ry * (0.8 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tycho bright ejecta rays
  const tycho = { lat: -43.3, lon: -11.2, r: 60 };
  const tp = latLonToEquirect(tycho.lat, tycho.lon, width, height);
  ctx.strokeStyle = 'rgba(250,250,250,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 120; i++) {
    const aang = rand() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(tp.x + Math.cos(aang) * tycho.r * rand() * 0.6, tp.y + Math.sin(aang) * tycho.r * rand() * 0.6);
    ctx.lineTo(tp.x + Math.cos(aang) * (tycho.r * (4 + rand() * 30)), tp.y + Math.sin(aang) * (tycho.r * (4 + rand() * 30)));
    ctx.stroke();
  }

  // multi-octave regolith grain
  for (let pass = 0; pass < 4; pass++) {
    const count = 2500 >> pass;
    for (let i = 0; i < count; i++) {
      const x = rand() * width;
      const y = rand() * height;
      const v = Math.floor(140 + rand() * 115);
      ctx.fillStyle = `rgba(${v},${v},${v},${0.03 + rand() * 0.06})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  // hundreds of layered impact craters concentrated in southern highlands
  for (let i = 0; i < 900; i++) {
    const lon = (rand() * 360) - 180;
    // bias toward southern latitudes
    const lat = -90 + Math.pow(rand(), 1.6) * 140; // more in south
    const p = latLonToEquirect(lat, lon, width, height);
    const r = 2 + Math.floor(rand() * 22);
    ctx.strokeStyle = `rgba(40,40,40,${0.35 + rand() * 0.5})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (rand() > 0.85) {
      ctx.fillStyle = 'rgba(230,230,230,0.03)';
      ctx.beginPath();
      ctx.arc(p.x - r * 0.2, p.y - r * 0.2, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // bump map
  const b = document.createElement('canvas');
  b.width = Math.max(256, Math.floor(width / 1));
  b.height = Math.max(128, Math.floor(height / 1));
  const bctx = b.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, b.width, b.height);
  for (let i = 0; i < 6000; i++) {
    const x = Math.floor(rand() * b.width);
    const y = Math.floor(rand() * b.height);
    const shade = Math.floor(100 + rand() * 120);
    bctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    bctx.fillRect(x, y, 1, 1);
  }

  lunarTextureCache.albedo = a;
  lunarTextureCache.bump = b;
  return { albedo: a, bump: b };
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
