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

  it('renders skip link, WAI-ARIA tablist, predictive outlook, and daily journey nudges', () => {
    render(<App />);
    expect(screen.getByText('Skip to main content')).toBeInTheDocument();
    expect(screen.getAllByRole('tablist').length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/Predictive Risk Intelligence \(Observed vs\. 1h–24h Modeled Outlook\)/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Calm Daily Protection Journey & Behavioral Nudges/i),
    ).toBeInTheDocument();
  });

  it('navigates across all 4 primary views and toggles ELI10 cleanly', async () => {
    render(<App />);

    const eli10Btn = screen.getByRole('button', { name: /Explain Like I'm 10/i });
    expect(eli10Btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(eli10Btn);
    expect(eli10Btn).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('tab', { name: '8-Agent Pipeline' }));
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

  it('opens Memory & Home Settings, updates safe room size, and opens Emergency 112 dialog', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /Memory & Home Settings/i }));
    const roomInput = screen.getByLabelText(/Safe Room Size \(sq ft\):/i) as HTMLInputElement;
    expect(roomInput.value).toBe('140');
    fireEvent.change(roomInput, { target: { value: '220' } });
    expect(roomInput.value).toBe('220');

    fireEvent.click(screen.getByRole('button', { name: /Emergency 112/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Call National Emergency 112/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
