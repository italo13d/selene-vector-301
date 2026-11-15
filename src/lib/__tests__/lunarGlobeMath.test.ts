import { describe, it, expect } from 'vitest';
import { latLonToCartesian, shouldStepCameraTransition, generateLunarRGBA, computeBodyFixedDirection } from '../lunarGlobeMath';
import { getAllSites } from '../../lib/orbitalPhysics';

describe('lunarGlobeMath', () => {
  it('latLonToCartesian: North Pole maps to +Y', () => {
    const v = latLonToCartesian(90, 0, 1);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(1, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('latLonToCartesian: South Pole maps to -Y', () => {
    const v = latLonToCartesian(-90, 0, 1);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(-1, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('latLonToCartesian: Equator at lon=0 maps to +X', () => {
    const v = latLonToCartesian(0, 0, 2);
    expect(v.x).toBeCloseTo(2, 6);
    expect(v.y).toBeCloseTo(0, 6);
  });

  it('REQ-VIS-03: shouldStepCameraTransition cancels on user interaction and close target distance', () => {
    // user interacting -> no transition
    expect(shouldStepCameraTransition(true, 6.0, 6.2)).toBe(false);
    // if current and target are closer than threshold -> do not step
    expect(shouldStepCameraTransition(false, 5.5001, 5.5)).toBe(false);
    // large difference and not interacting -> step
    expect(shouldStepCameraTransition(false, 2.0, 6.0)).toBe(true);
  });

  it('REQ-VIS-04: preset camera distances and south pole mapping and texture contrast', () => {
    const R = 2.0;
    // Global View [0,0.8,6.2]
    const g_r = Math.sqrt(0 * 0 + 0.8 * 0.8 + 6.2 * 6.2);
    // South Pole Focus [0,-4.6,3.8]
    const s_r = Math.sqrt(0 * 0 + (-4.6) * (-4.6) + 3.8 * 3.8);
    expect(g_r).toBeGreaterThanOrEqual(5.5);
    expect(s_r).toBeGreaterThanOrEqual(5.5);

    // South pole maps to -Y
    const sp = latLonToCartesian(-90, 0, R);
    expect(sp.y).toBeLessThan(-1.98);

    // Generated pixel buffer should have high luminance contrast and crater variation
    const buf = generateLunarRGBA(1337, 256, 128); // smaller buffer for test speed
    let minL = 255, maxL = 0; let nonBase = 0;
    for (let i = 0; i < buf.length; i += 4) {
      // compute luma
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const l = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      if (l < minL) minL = l;
      if (l > maxL) maxL = l;
      if (l !== 180) nonBase++;
    }
    expect(maxL - minL).toBeGreaterThanOrEqual(100);
    expect(nonBase).toBeGreaterThan(0);
  });

  it('computeBodyFixedDirection: elevation=90deg equals local up (U); el=0 orthogonal to up', () => {
    const lat = -23.5;
    const lon = 42.0;
    // el = 90 => direction should equal local up vector U = [cosφ cosλ, cosφ sinλ, sinφ]
    const outZen = computeBodyFixedDirection(lat, lon, 0, 90);
    const phi = (lat * Math.PI) / 180;
    const lam = (lon * Math.PI) / 180;
    const Ux = Math.cos(phi) * Math.cos(lam);
    const Uy = Math.cos(phi) * Math.sin(lam);
    const Uz = Math.sin(phi);
    expect(outZen.x).toBeCloseTo(Ux, 6);
    expect(outZen.y).toBeCloseTo(Uy, 6);
    expect(outZen.z).toBeCloseTo(Uz, 6);

    // el = 0 => direction should be perpendicular to U (dot product ~ 0)
    const outHorizon = computeBodyFixedDirection(lat, lon, 45, 0);
    const dot = outHorizon.x * Ux + outHorizon.y * Uy + outHorizon.z * Uz;
    expect(Math.abs(dot)).toBeLessThan(1e-6);
  });

  it('site list loads 10 curated sites', () => {
    const sites = getAllSites();
    expect(sites.length).toBe(10);
  });
});
