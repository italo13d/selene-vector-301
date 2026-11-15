import '@testing-library/jest-dom';
import { vi } from 'vitest';

function createMock2DContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return {
    canvas,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    beginPath: () => {},
    fillRect: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    ellipse: () => {},
    arc: () => {},
  } as unknown as CanvasRenderingContext2D;
}

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function mockCanvasGetContext(this: HTMLCanvasElement, contextId: string) {
  if (contextId === 'webgl' || contextId === 'experimental-webgl' || contextId === 'webgl2') {
    return null;
  }

  if (contextId === '2d') {
    const cached = (this as any).__selene_mock_2d_context as CanvasRenderingContext2D | undefined;
    if (cached) return cached;

    const mock = createMock2DContext(this);
    (this as any).__selene_mock_2d_context = mock;
    return mock;
  }

  return null;
});
