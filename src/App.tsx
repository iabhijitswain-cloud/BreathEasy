import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  PhoneCall,
  Moon,
  Sun,
  Wind,
  Baby,
  MapPin,
  Wallet,
  LogIn,
  LogOut,
} from 'lucide-react';
import { CITY_PRESETS, DEFAULT_MEMBERS } from './lib/deterministicEngines.ts';
import {
  auth,
  loadHouseholdPreferencesFromFirestore,
  saveHouseholdPreferencesToFirestore,
  signInWithGoogle,
  signOutUser,
  testFirestoreConnection,
} from './lib/firebase.ts';
import type {
  AgentId,
  AgentRunResult,
  BudgetTier,
  FamilyMemberProfile,
  HouseholdState,
  SupportedLanguage,
} from './types/breatheasy.ts';
import { ProtectionBriefView } from './components/ProtectionBriefView.tsx';
import { AgentsPipelineView, ORDERED_AGENTS } from './components/AgentsPipelineView.tsx';
import { DigitalTwinView } from './components/DigitalTwinView.tsx';
import { IndoorCommunityView } from './components/IndoorCommunityView.tsx';
import { EmergencyOverlay } from './components/EmergencyOverlay.tsx';

type ActiveTab = 'brief' | 'agents' | 'twin' | 'indoor';

const STORAGE_KEY = 'breatheasy_local_prefs_v1';

const DEFAULT_HOUSEHOLD: HouseholdState = {
  city: CITY_PRESETS[0],
  language: 'en',
  eli10: false,
  budgetTier: 'under_2000',
  roomSqft: 140,
  hasPets: true,
  hasToddler: true,
  housingType: 'independent_flat',
  commuteMode: 'auto_rickshaw',
  schoolTime: '07:45 AM',
  members: DEFAULT_MEMBERS,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('brief');
  const [darkMode, setDarkMode] = useState(false);
  const [personalizationEnabled, setPersonalizationEnabled] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  const [household, setHousehold] = useState<HouseholdState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<HouseholdState>;
        if (parsed?.city?.id) {
          return { ...DEFAULT_HOUSEHOLD, ...parsed };
        }
      }
    } catch {
      // Ignore storage errors
    }
    return DEFAULT_HOUSEHOLD;
  });

  const [agentOutputs, setAgentOutputs] = useState<Partial<Record<AgentId, AgentRunResult>>>({});
  const [runningAgent, setRunningAgent] = useState<AgentId | null>(null);
  const [sequentialRunning, setSequentialRunning] = useState(false);

  const [roomImageBase64, setRoomImageBase64] = useState<string | undefined>(undefined);
  const [roomImageMimeType, setRoomImageMimeType] = useState<string | undefined>(undefined);

  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    void testFirestoreConnection();
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser?.emailVerified) {
        void loadHouseholdPreferencesFromFirestore(nextUser.uid)
          .then((stored) => {
            if (!stored) return;
            const foundCity = CITY_PRESETS.find((c) => c.id === stored.cityId);
            setHousehold((prev) => ({
              ...prev,
              city: foundCity || prev.city,
              language: stored.language,
              budgetTier: stored.budgetTier,
              eli10: stored.eli10,
              roomSqft: stored.roomSqft,
            }));
          })
          .catch(() => {});
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!personalizationEnabled) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(household));
    } catch {
      // Ignore quota errors
    }
    if (authReady && user?.emailVerified) {
      void saveHouseholdPreferencesToFirestore(user.uid, household).catch(() => {});
    }
  }, [household, personalizationEnabled, authReady, user]);

  const handleSignIn = async () => {
    setAuthMessage(null);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      setAuthMessage(
        err instanceof Error ? err.message : 'Google Sign-In could not be completed.',
      );
    }
  };

  const handleSignOut = async () => {
    setAuthMessage(null);
    try {
      await signOutUser();
    } catch {
      // Ignore sign-out errors
    }
  };

  const runAgent = async (
    agentId: AgentId,
    priorSnapshot?: Partial<Record<AgentId, AgentRunResult>>,
    overrideImage?: { base64: string; mimeType: string; note?: string },
  ): Promise<AgentRunResult | null> => {
    setRunningAgent(agentId);
    const meta = ORDERED_AGENTS.find((a) => a.id === agentId)!;
    try {
      const res = await fetch('/api/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          household,
          priorOutputs: priorSnapshot ?? agentOutputs,
          roomImageBase64: overrideImage?.base64 ?? roomImageBase64,
          roomImageMimeType: overrideImage?.mimeType ?? roomImageMimeType,
          indoorNote: overrideImage?.note,
        }),
      });
      const data = (await res.json()) as AgentRunResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Agent ${meta.number} failed.`);
      }
      setAgentOutputs((prev) => ({ ...prev, [agentId]: data }));
      return data;
    } catch (err: unknown) {
      const errorResult: AgentRunResult = {
        agentId,
        agentNumber: meta.number,
        agentName: meta.name,
        modelUsed: 'gemini-4-hydrogen',
        groundingType: 'deterministic_plus_gemini',
        status: 'error',
        summary: 'Execution failed',
        content: '',
        confidence: 'low',
        latencyMs: 0,
        timestampIso: new Date().toISOString(),
        groundingLinks: [],
        error: err instanceof Error ? err.message : 'Unable to execute agent.',
      };
      setAgentOutputs((prev) => ({ ...prev, [agentId]: errorResult }));
      return null;
    } finally {
      setRunningAgent(null);
    }
  };

  const handleRunAllSequentially = async () => {
    if (sequentialRunning || runningAgent) return;
    setSequentialRunning(true);
    setAgentOutputs({});
    const accumulated: Partial<Record<AgentId, AgentRunResult>> = {};
    try {
      for (const agent of ORDERED_AGENTS) {
        const result = await runAgent(agent.id, accumulated);
        if (result) {
          accumulated[agent.id] = result;
        }
      }
    } finally {
      setSequentialRunning(false);
    }
  };

  const handleUploadAndRunIndoorAgent = async (
    base64: string,
    mimeType: string,
    note: string,
  ) => {
    setRoomImageBase64(base64);
    setRoomImageMimeType(mimeType);
    await runAgent('indoor_air', agentOutputs, { base64, mimeType, note });
  };

  const handleResetPreferences = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setHousehold(DEFAULT_HOUSEHOLD);
    setAgentOutputs({});
  };

  const handleToggleMemberPrivacy = (id: string) => {
    setHousehold((prev) => ({
      ...prev,
      members: prev.members.map((m) =>
        m.id === id ? { ...m, privacyMasked: !m.privacyMasked } : m,
      ),
    }));
  };

  const handleAddFamilyMember = (label: string, category: FamilyMemberProfile['category']) => {
    const sensitivity: FamilyMemberProfile['sensitivity'] =
      category === 'infant' || category === 'respiratory_sensitive' || category === 'elderly'
        ? 'high_protection'
        : category === 'child' || category === 'pet'
          ? 'elevated'
          : 'standard';
    setHousehold((prev) => ({
      ...prev,
      members: [
        ...prev.members,
        {
          id: `mem_${Date.now()}`,
          label,
          category,
          sensitivity,
          privacyMasked: false,
        },
      ],
    }));
  };

  const tabs: { id: ActiveTab; label: string; mobileLabel: string }[] = [
    { id: 'brief', label: 'Protection Brief', mobileLabel: 'Brief' },
    { id: 'agents', label: '8-Agent Pipeline', mobileLabel: '8 Agents' },
    { id: 'twin', label: '3D Digital Twin', mobileLabel: '3D Twin' },
    { id: 'indoor', label: 'Indoor & Community', mobileLabel: 'Indoor & Pulse' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F2] text-[#1A2423] dark:bg-[#0E1514] dark:text-[#F1F5F4] transition-colors">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-[#0F766E] focus:text-white focus:text-xs focus:font-semibold"
      >
        Skip to main content
      </a>

      {/* Top Bar Contract: Wordmark — 4 Nav Links — Primary CTA */}
      <header className="sticky top-0 z-30 border-b border-[#E2DDD2] dark:border-[#283836] bg-[#FAF7F2]/95 dark:bg-[#0E1514]/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-[#0F766E] text-white flex items-center justify-center">
              <Wind className="w-5 h-5" aria-hidden="true" />
            </div>
            <span className="font-display font-bold text-lg tracking-tight whitespace-nowrap">
              BreathEasy AI
            </span>
          </div>

          <nav
            aria-label="Primary sections"
            role="tablist"
            className="hidden md:flex items-center gap-7 text-sm font-medium"
          >
            {tabs.map((item) => (
              <button
                key={item.id}
                id={`tab-${item.id}`}
                role="tab"
                aria-selected={activeTab === item.id}
                aria-controls={`panel-${item.id}`}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`whitespace-nowrap shrink-0 py-1.5 border-b-2 transition-colors cursor-pointer ${
                  activeTab === item.id
                    ? 'border-[#0F766E] text-[#0F766E] dark:border-[#2DD4BF] dark:text-[#2DD4BF] font-semibold'
                    : 'border-transparent text-[#4B5B59] dark:text-[#A7B8B5] hover:text-[#1A2423] dark:hover:text-[#F1F5F4]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => {
              setEmergencyReason(null);
              setEmergencyOpen(true);
            }}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-[#C2410C] hover:bg-[#9A3412] text-white text-xs sm:text-sm font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <PhoneCall className="w-4 h-4" aria-hidden="true" />
            Emergency 112
          </button>
        </div>

        {/* Mobile Tab Switcher */}
        <div
          role="tablist"
          aria-label="Mobile sections"
          className="md:hidden border-t border-[#E2DDD2] dark:border-[#283836] px-3 py-2 flex items-center gap-1.5 overflow-x-auto"
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={activeTab === item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`min-h-[38px] px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === item.id
                  ? 'bg-[#0F766E] text-white'
                  : 'bg-[#F0ECE3] dark:bg-[#16201F] text-[#4B5B59] dark:text-[#A7B8B5]'
              }`}
            >
              {item.mobileLabel}
            </button>
          ))}
        </div>
      </header>

      {/* Workspace Control Strip */}
      <div className="border-b border-[#E2DDD2] dark:border-[#283836] bg-[#F0ECE3]/75 dark:bg-[#16201F]/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex items-center gap-1.5 font-medium">
              <MapPin className="w-3.5 h-3.5 text-[#0F766E] dark:text-[#2DD4BF]" aria-hidden="true" />
              <select
                aria-label="City Preset"
                value={household.city.id}
                onChange={(e) => {
                  const found = CITY_PRESETS.find((c) => c.id === e.target.value);
                  if (found) setHousehold((prev) => ({ ...prev, city: found }));
                }}
                className="min-h-[36px] px-2.5 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#0E1514] font-medium"
              >
                {CITY_PRESETS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.locality} (PM2.5 {c.baselinePm25})
                  </option>
                ))}
              </select>
            </label>

            <label className="inline-flex items-center gap-1.5 font-medium">
              <Wallet className="w-3.5 h-3.5 text-[#0F766E] dark:text-[#2DD4BF]" aria-hidden="true" />
              <select
                aria-label="Budget Tier"
                value={household.budgetTier}
                onChange={(e) =>
                  setHousehold((prev) => ({ ...prev, budgetTier: e.target.value as BudgetTier }))
                }
                className="min-h-[36px] px-2.5 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#0E1514] font-medium"
              >
                <option value="inr_0">Budget: ₹0 Free Only</option>
                <option value="under_500">Budget: Under ₹500</option>
                <option value="under_2000">Budget: Under ₹2,000</option>
                <option value="under_5000">Budget: Under ₹5,000</option>
                <option value="under_10000">Budget: Under ₹10,000</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Language"
              className="inline-flex rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#0E1514] overflow-hidden"
            >
              {(
                [
                  { id: 'en', label: 'EN' },
                  { id: 'hi', label: 'हिं' },
                  { id: 'bn', label: 'বাং' },
                ] as { id: SupportedLanguage; label: string }[]
              ).map((lang) => (
                <button
                  key={lang.id}
                  type="button"
                  aria-pressed={household.language === lang.id}
                  onClick={() => setHousehold((prev) => ({ ...prev, language: lang.id }))}
                  className={`min-h-[34px] px-2.5 text-xs font-semibold cursor-pointer ${
                    household.language === lang.id
                      ? 'bg-[#0F766E] text-white'
                      : 'text-[#4B5B59] dark:text-[#A7B8B5] hover:bg-[#F0ECE3] dark:hover:bg-[#1E2B29]'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              aria-pressed={household.eli10}
              onClick={() => setHousehold((prev) => ({ ...prev, eli10: !prev.eli10 }))}
              className={`min-h-[36px] px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                household.eli10
                  ? 'border-[#0F766E] bg-[#0F766E]/12 text-[#0F766E] dark:text-[#2DD4BF]'
                  : 'border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#0E1514]'
              }`}
            >
              <Baby className="w-3.5 h-3.5" aria-hidden="true" />
              Explain Like I&apos;m 10
            </button>

            <button
              type="button"
              aria-pressed={darkMode}
              onClick={() => setDarkMode((v) => !v)}
              aria-label="Toggle Light/Dark Mode"
              className="min-h-[36px] px-2.5 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#0E1514] flex items-center gap-1.5 cursor-pointer"
            >
              {darkMode ? (
                <Sun className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Moon className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{darkMode ? 'Light' : 'Dark'}</span>
            </button>

            {user ? (
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="min-h-[36px] px-2.5 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#0E1514] flex items-center gap-1.5 cursor-pointer font-medium"
                title={`Signed in as ${user.email || 'User'}`}
              >
                <LogOut className="w-3.5 h-3.5 text-[#0F766E]" aria-hidden="true" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSignIn()}
                className="min-h-[36px] px-2.5 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#0E1514] flex items-center gap-1.5 cursor-pointer font-medium"
              >
                <LogIn className="w-3.5 h-3.5 text-[#0F766E]" aria-hidden="true" />
                <span className="hidden sm:inline">Sync Account</span>
              </button>
            )}
          </div>
        </div>
        {authMessage && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-2 text-xs text-[#C2410C]">
            {authMessage}
          </div>
        )}
      </div>

      {/* Main Content */}
      <main id="main-content" className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        <div
          id={`panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
        >
          {activeTab === 'brief' && (
            <ProtectionBriefView
              household={household}
              agentOutputs={agentOutputs}
              personalizationEnabled={personalizationEnabled}
              onTogglePersonalization={() => setPersonalizationEnabled((v) => !v)}
              onResetPreferences={handleResetPreferences}
              onEmergencyTrigger={(reason) => {
                setEmergencyReason(reason);
                setEmergencyOpen(true);
              }}
              onNavigateTab={setActiveTab}
            />
          )}

          {activeTab === 'agents' && (
            <AgentsPipelineView
              household={household}
              outputs={agentOutputs}
              runningAgent={runningAgent}
              sequentialRunning={sequentialRunning}
              roomImageBase64={roomImageBase64}
              roomImageMimeType={roomImageMimeType}
              onUploadRoomPhoto={(b64, mime) => {
                setRoomImageBase64(b64);
                setRoomImageMimeType(mime);
              }}
              onRunSingleAgent={async (id) => {
                await runAgent(id);
              }}
              onRunAllSequentially={handleRunAllSequentially}
            />
          )}

          {activeTab === 'twin' && <DigitalTwinView household={household} />}

          {activeTab === 'indoor' && (
            <IndoorCommunityView
              household={household}
              indoorAgentOutput={agentOutputs.indoor_air}
              runningIndoorAgent={runningAgent === 'indoor_air'}
              onUploadAndRunIndoorAgent={handleUploadAndRunIndoorAgent}
              onToggleMemberPrivacy={handleToggleMemberPrivacy}
              onAddFamilyMember={handleAddFamilyMember}
            />
          )}
        </div>
      </main>

      {/* Calm Persistent Non-Medical Disclaimer Footer */}
      <footer className="border-t border-[#E2DDD2] dark:border-[#283836] py-4 px-4 text-center text-xs text-[#4B5B59] dark:text-[#A7B8B5]">
        BreathEasy AI provides environmental exposure estimates and protective guidance only — not
        medical diagnosis or emergency dispatch. Exposure values marked as modeled are estimates,
        not personal sensor measurements.
      </footer>

      <EmergencyOverlay
        open={emergencyOpen}
        reason={emergencyReason}
        household={household}
        onClose={() => setEmergencyOpen(false)}
      />
    </div>
  );
}
