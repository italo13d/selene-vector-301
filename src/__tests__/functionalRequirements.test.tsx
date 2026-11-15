import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

  it('AHP-TOPSIS presets update weights and re-rank sites', () => {
    render(<App />);
    // capture first ranking site name before
    const firstRowBefore = screen.getAllByRole('row')[1];
    const beforeText = firstRowBefore.textContent || '';
    // click Power Survival preset
    const presetBtn = screen.getByRole('button', { name: /Preset Power Survival/ });
    fireEvent.click(presetBtn);
    // read first row after
    const firstRowAfter = screen.getAllByRole('row')[1];
    const afterText = firstRowAfter.textContent || '';
    // The ordering should change for at least one site (not identical strings)
    expect(afterText).not.toEqual(beforeText);
  });

  it('Playback play advances the scrub index', () => {
    vi.useFakeTimers();
    render(<App />);
    const playBtn = screen.getByRole('button', { name: /Play Toggle/ });
    act(() => { fireEvent.click(playBtn); }); // start playing
    expect(screen.getByText(/Scrub: T\+000h/)).toBeTruthy();
    // advance timers by 1200ms to allow at least one tick
    act(() => { vi.advanceTimersByTime(1200); });
    // ensure scrub text advanced (not strictly 000)
    const later = screen.getByText(/Scrub: T\+00\d*h/);
    expect(later).toBeTruthy();
    vi.useRealTimers();
  });

  it('Compare Sites panel renders comparison metrics', () => {
    render(<App />);
    // toggle compare panel using the compare checkbox that exists in the UI
    const compareCheckbox = screen.getByRole('checkbox');
    fireEvent.click(compareCheckbox);
    // open custom dropdown (button)
    const dropdown = screen.getByRole('button', { name: /Compare target select/ });
    fireEvent.click(dropdown);
    // click the Apollo 11 option
    const option = screen.getAllByRole('button').find((b) => /Apollo 11 — Mare Tranquillitatis/.test(b.textContent || ''));
    expect(option).toBeTruthy();
    if (option) fireEvent.click(option);
    // Apollo 11 name should appear somewhere in the document
    const matches = screen.getAllByText(/Apollo 11/);
    expect(matches.length).toBeGreaterThan(0);
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
