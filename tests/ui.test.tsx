import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.tsx';

vi.mock('../src/components/AirQuality3DScene.tsx', () => ({
  AirQuality3DScene: ({
    pm25,
    onToggleSeal,
    onTogglePurifier,
  }: {
    pm25: number;
    onToggleSeal: () => void;
    onTogglePurifier: () => void;
  }) => (
    <div role="region" aria-label="Interactive 3D Household and Street Airshed Digital Twin">
      <span>Mock 3D Scene PM2.5: {pm25}</span>
      <button type="button" onClick={onToggleSeal}>
        Toggle Seal
      </button>
      <button type="button" onClick={onTogglePurifier}>
        Toggle Purifier
      </button>
    </div>
  ),
}));

vi.mock('../src/lib/firebase.ts', () => ({
  auth: {},
  db: {},
  testFirestoreConnection: vi.fn().mockResolvedValue(false),
  signInWithGoogle: vi.fn(),
  signOutUser: vi.fn(),
  saveHouseholdPreferencesToFirestore: vi.fn().mockResolvedValue(undefined),
  loadHouseholdPreferencesFromFirestore: vi.fn().mockResolvedValue(null),
  deleteHouseholdPreferencesFromFirestore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: null) => void) => {
    cb(null);
    return () => {};
  },
}));

describe('BreathEasy AI UI & Accessibility', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ reports: [] }),
      }),
    );
  });

  it('renders skip link, WAI-ARIA tablist, Smart Alert Intelligence, and Data Sources disclosure', () => {
    render(<App />);
    expect(screen.getByText('Skip to main content')).toBeInTheDocument();
    expect(screen.getAllByRole('tablist').length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/Predictive Risk Intelligence \(Observed vs\. 1h–24h Modeled Outlook\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Smart Alert Intelligence/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Data Sources & Fallbacks/i }));
    expect(screen.getByText(/CPCB \/ State PCB Station Snapshot/i)).toBeInTheDocument();
  });

  it('supports WAI-ARIA keyboard ArrowRight tab navigation across primary views', async () => {
    render(<App />);

    const briefTab = screen.getByRole('tab', { name: 'Protection Brief' });
    fireEvent.keyDown(briefTab, { key: 'ArrowRight' });
    expect(
      await screen.findByRole('heading', { name: /8-Agent Pipeline \(Run & Verify One by One\)/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '3D Digital Twin' }));
    expect(
      await screen.findByRole('region', {
        name: /Interactive 3D Household and Street Airshed Digital Twin/i,
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Indoor & Community' }));
    expect(
      await screen.findByRole('heading', { name: /Safe Room & Budget Builder/i }),
    ).toBeInTheDocument();
  });

  it('supports custom budget input, Memory & Home Settings edit/delete, and Emergency 112 focus handling', async () => {
    render(<App />);

    const budgetSelect = screen.getByLabelText('Budget Tier');
    fireEvent.change(budgetSelect, { target: { value: 'custom' } });
    const customInput = screen.getByLabelText('Custom budget in INR') as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: '3500' } });
    expect(customInput.value).toBe('3500');

    fireEvent.click(screen.getByRole('button', { name: /Memory & Home Settings/i }));
    const roomInput = screen.getByLabelText(/Safe Room Size \(sq ft\):/i) as HTMLInputElement;
    fireEvent.change(roomInput, { target: { value: '220' } });
    expect(roomInput.value).toBe('220');

    fireEvent.click(screen.getByRole('button', { name: /Delete Memory/i }));
    expect(screen.getByText(/Privacy-First Adaptive Memory \(Paused\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Emergency 112/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Call National Emergency 112/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
