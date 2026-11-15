import { describe, it, expect } from 'vitest';
import { latLonToCartesian } from '../lunarGlobeMath';

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
});
