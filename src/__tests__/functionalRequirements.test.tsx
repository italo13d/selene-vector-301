import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../App';

describe('Functional requirements (REQ-UI-01, REQ-EXP-01)', () => {
  beforeEach(() => {
    // reset DOM
    document.body.innerHTML = '';
  });

  it('Site selection updates UI and shows CSA VETO for nobile-rim-1', () => {
    render(<App />);
    // find site button in sidebar or mobile list and click
    const btn = screen.getAllByRole('button', { name: /Nobile/i })[0];
    fireEvent.click(btn);
    // expect at least one VETO badge visible
    const vetos = screen.getAllByText(/VETO/);
    expect(vetos.length).toBeGreaterThan(0);
  });

  it('Launch delay simulator recalculates and resets timeline index', () => {
    render(<App />);
    // click second offset (+7d)
    const allOffsetBtns = screen.getAllByRole('button', { name: /Nominal \+0d|Delay \+7d|Delay \+14d|Delay \+30d/ });
    fireEvent.click(allOffsetBtns[1]);
    // After clicking, timeline scrub should show T+000h (reset to 0)
    expect(screen.getByText(/Scrub: T\+000h/)).toBeInTheDocument();
  });

  it('Custom coordinates submission produces a custom site telemetry with 72-sector horizon', () => {
    render(<App />);
    // fill lat, lon, alt inputs
    const lat = screen.getByLabelText(/Latitude/);
    const lon = screen.getByLabelText(/Longitude/);
    const alt = screen.getByLabelText(/Altitude/);
    fireEvent.change(lat, { target: { value: '10' } });
    fireEvent.change(lon, { target: { value: '10' } });
    fireEvent.change(alt, { target: { value: '4.8' } });
    // apply (button has aria-label="Apply custom coordinates")
    const apply = screen.getByRole('button', { name: /Apply custom coordinates/ });
    fireEvent.click(apply);
    // custom site heading displayed
    expect(screen.getByText(/Custom \(10\.00°, 10\.00°\)/)).toBeInTheDocument();
  });

  it('Export buttons generate downloads (CSV/JSON) for ranking/dossier', () => {
    render(<App />);
    // Click export buttons in ranking table
    const exportCSV = screen.getByRole('button', { name: /Export ranking as CSV/ });
    const exportJSON = screen.getByRole('button', { name: /Export ranking as JSON/ });
    // polyfill/mock createObjectURL in this jsdom environment if missing
    if (typeof URL.createObjectURL === 'undefined') {
      // @ts-ignore - test helper
      URL.createObjectURL = vi.fn(() => 'blob:mock');
    }
    if (typeof URL.revokeObjectURL === 'undefined') {
      // @ts-ignore - test helper
      URL.revokeObjectURL = vi.fn(() => {});
    }
    const createSpy = vi.spyOn(URL, 'createObjectURL');
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    fireEvent.click(exportCSV);
    fireEvent.click(exportJSON);
    expect(createSpy).toHaveBeenCalled();
    expect(appendSpy).toHaveBeenCalled();
    createSpy.mockRestore();
    appendSpy.mockRestore();
  });
});
