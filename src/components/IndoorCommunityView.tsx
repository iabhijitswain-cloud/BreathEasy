import React, { useEffect, useState } from 'react';
import {
  Camera,
  Home,
  Users,
  Radio,
  Plus,
  EyeOff,
  Eye,
  ShieldAlert,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { getCleanRoomPlans, runIndoorBoxSimulation } from '../lib/deterministicEngines.ts';
import type {
  AgentRunResult,
  CommunityReport,
  FamilyMemberProfile,
  HouseholdState,
  PulseCategory,
} from '../types/breatheasy.ts';

interface Props {
  household: HouseholdState;
  indoorAgentOutput?: AgentRunResult;
  runningIndoorAgent: boolean;
  onUploadAndRunIndoorAgent: (base64: string, mimeType: string, note: string) => Promise<void>;
  onToggleMemberPrivacy: (id: string) => void;
  onAddFamilyMember: (label: string, category: FamilyMemberProfile['category']) => void;
}

const PULSE_CATEGORIES: { id: PulseCategory; label: string }[] = [
  { id: 'smoke', label: 'Visible Smoke' },
  { id: 'garbage_burning', label: 'Garbage / Leaf Burning' },
  { id: 'construction_dust', label: 'Construction Dust' },
  { id: 'traffic_congestion', label: 'Heavy Traffic / Idling' },
  { id: 'industrial_emissions', label: 'Industrial Plume' },
  { id: 'unusual_odor', label: 'Unusual Chemical Odor' },
  { id: 'visibility_problems', label: 'Dense Haze / Low Visibility' },
  { id: 'local_pollution_event', label: 'Other Local Pollution Event' },
];

export const IndoorCommunityView: React.FC<Props> = ({
  household,
  indoorAgentOutput,
  runningIndoorAgent,
  onUploadAndRunIndoorAgent,
  onToggleMemberPrivacy,
  onAddFamilyMember,
}) => {
  // Indoor Box Simulator State
  const [sealGaps, setSealGaps] = useState(true);
  const [stopIncense, setStopIncense] = useState(true);
  const [coverCooking, setCoverCooking] = useState(true);
  const [diyBoxFan, setDiyBoxFan] = useState(false);
  const [hepaPurifier, setHepaPurifier] = useState(false);
  const [indoorBox, setIndoorBox] = useState(() =>
    runIndoorBoxSimulation({
      outdoorPm25: household.city.baselinePm25,
      roomSqft: household.roomSqft,
      sealGaps: true,
      stopIncense: true,
      coverCooking: true,
      diyBoxFan: false,
      hepaPurifier: false,
    }),
  );
  const [roomNote, setRoomNote] = useState('');

  // Community Pulse 2.0 State
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [pulseCategory, setPulseCategory] = useState<PulseCategory>('garbage_burning');
  const [pulseSeverity, setPulseSeverity] = useState<'mild' | 'moderate' | 'severe'>('moderate');
  const [pulseNote, setPulseNote] = useState('');
  const [submittingPulse, setSubmittingPulse] = useState(false);
  const [pulseFeedback, setPulseFeedback] = useState<string | null>(null);

  // Family Add State
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberCat, setNewMemberCat] = useState<FamilyMemberProfile['category']>('child');

  useEffect(() => {
    const payload = {
      outdoorPm25: household.city.baselinePm25,
      roomSqft: household.roomSqft,
      sealGaps,
      stopIncense,
      coverCooking,
      diyBoxFan,
      hepaPurifier,
    };
    fetch('/api/indoor/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.simulatedRange) setIndoorBox(d);
      })
      .catch(() => setIndoorBox(runIndoorBoxSimulation(payload)));
  }, [
    household.city.baselinePm25,
    household.roomSqft,
    sealGaps,
    stopIncense,
    coverCooking,
    diyBoxFan,
    hepaPurifier,
  ]);

  useEffect(() => {
    fetch(`/api/community/reports?cityId=${encodeURIComponent(household.city.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.reports)) setReports(d.reports);
      })
      .catch(() => {});
  }, [household.city.id]);

  const handleRoomImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const m = result.match(/^data:(.+);base64,(.+)$/);
      if (m) {
        onUploadAndRunIndoorAgent(m[2], m[1], roomNote);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitPulse = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingPulse(true);
    setPulseFeedback(null);
    try {
      const res = await fetch('/api/community/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cityId: household.city.id,
          category: pulseCategory,
          severity: pulseSeverity,
          note: pulseNote,
        }),
      });
      const data = await res.json();
      if (res.ok && data.report) {
        setPulseNote('');
        setPulseFeedback(
          data.clustered
            ? 'Corroborated existing 45-min neighborhood cluster — confidence increased.'
            : 'Logged as an unconfirmed single report (requires 3 corroborations to raise alert confidence).',
        );
        const listRes = await fetch(
          `/api/community/reports?cityId=${encodeURIComponent(household.city.id)}`,
        );
        const listData = await listRes.json();
        if (Array.isArray(listData?.reports)) setReports(listData.reports);
      }
    } finally {
      setSubmittingPulse(false);
    }
  };

  const budgetPlans = getCleanRoomPlans(
    household.budgetTier,
    household.roomSqft,
    household.hasPets,
    household.hasToddler,
  );

  return (
    <div className="space-y-6">
      {/* Indoor Air Guardian & Room Vision Audit */}
      <section className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-[#0F766E] dark:text-[#2DD4BF]">
              Indoor Guardian · Modeled Box Estimate &amp; Multimodal Vision
            </div>
            <h2 className="font-display text-xl font-bold mt-0.5 flex items-center gap-2">
              <Home className="w-5 h-5 text-[#0F766E] dark:text-[#2DD4BF]" />
              &quot;What if I do these 3 things?&quot; — Safe Room &amp; Budget Builder
            </h2>
          </div>

          <div className="rounded-xl bg-[#FAF7F2] dark:bg-[#0E1514] border border-[#E2DDD2] dark:border-[#283836] px-4 py-2.5 text-right">
            <div className="text-xs text-[#4B5B59] dark:text-[#A7B8B5]">
              Modeled Indoor Range ({household.roomSqft} sq ft)
            </div>
            <div className="font-mono-tabular text-lg font-bold text-[#0F766E] dark:text-[#2DD4BF]">
              {indoorBox.simulatedRange[0]}–{indoorBox.simulatedRange[1]} µg/m³
            </div>
            <div className="text-[11px] text-[#4B5B59] dark:text-[#A7B8B5] font-mono-tabular">
              Est. {indoorBox.dropPctRange[0]}%–{indoorBox.dropPctRange[1]}% below unsealed baseline
            </div>
          </div>
        </div>

        {/* 5 Action Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {[
            { label: 'Seal window & door gaps (₹0–₹250)', val: sealGaps, set: setSealGaps },
            { label: 'Stop indoor incense / dhoop (₹0)', val: stopIncense, set: setStopIncense },
            { label: 'Cover pots + kitchen vent (₹0)', val: coverCooking, set: setCoverCooking },
            { label: 'Fan + H13 filter (~₹1,400)', val: diyBoxFan, set: setDiyBoxFan },
            { label: 'True HEPA H13 unit (₹8,999)', val: hepaPurifier, set: setHepaPurifier },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => item.set(!item.val)}
              className={`min-h-[52px] p-3 rounded-xl border text-left text-xs font-medium transition-colors cursor-pointer ${
                item.val
                  ? 'border-[#0F766E] bg-[#0F766E]/10 text-[#0F766E] dark:text-[#2DD4BF]'
                  : 'border-[#E2DDD2] dark:border-[#283836] bg-[#FAF7F2] dark:bg-[#0E1514]'
              }`}
            >
              {item.val ? '✓ ' : '+ '}
              {item.label}
            </button>
          ))}
        </div>

        {/* Multimodal Room Photo Inspection -> Agent 5 */}
        <div className="rounded-xl bg-[#FAF7F2] dark:bg-[#0E1514] border border-[#E2DDD2] dark:border-[#283836] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">
                Upload Bedroom / Kitchen / Window Photo for Agent 5 Visual Audit
              </div>
              <p className="text-xs text-[#4B5B59] dark:text-[#A7B8B5]">
                Gemini inspects window gaps, purifier placement, or smoke sources and combines them with
                ₹0-first steps.
              </p>
            </div>
            <label className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0F766E] hover:bg-[#0D625B] text-white text-xs font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap">
              {runningIndoorAgent ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Inspecting Room...
                </>
              ) : (
                <>
                  <Camera className="w-4 h-4" /> Upload Room Photo &amp; Run Agent 5
                </>
              )}
              <input type="file" accept="image/*" onChange={handleRoomImage} className="hidden" />
            </label>
          </div>
          <input
            type="text"
            value={roomNote}
            onChange={(e) => setRoomNote(e.target.value)}
            placeholder="Optional room context (e.g., faces main road, gas stove with no chimney)"
            className="w-full min-h-[42px] px-3.5 rounded-xl border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#16201F] text-xs"
          />
          {indoorAgentOutput?.status === 'completed' && (
            <div className="pt-3 border-t border-[#E2DDD2] dark:border-[#283836] text-xs sm:text-sm whitespace-pre-line leading-relaxed">
              {indoorAgentOutput.content}
            </div>
          )}
        </div>

        {/* Budget Optimizer Tiers + Plant Safety Advisor */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {budgetPlans.plans.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-[#E2DDD2] dark:border-[#283836] p-4 space-y-2.5 bg-[#FAF7F2]/60 dark:bg-[#0E1514]/60"
            >
              <div className="flex items-center justify-between">
                <span className="font-display font-bold text-sm">{p.label}</span>
                <span className="font-mono-tabular text-xs font-semibold text-[#0F766E] dark:text-[#2DD4BF]">
                  ₹{p.costInr.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="text-xs font-medium text-[#4B5B59] dark:text-[#A7B8B5]">
                {p.estimatedDrop} · Maint ~₹{p.annualMaintInr}/yr
              </div>
              <ul className="text-xs space-y-1 list-disc pl-4">
                {p.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <div className="pt-2 border-t border-[#E2DDD2] dark:border-[#283836] text-[11px] text-[#C2410C] dark:text-[#FB923C]">
                <strong>Do Not Buy:</strong> {p.doNotBuy.join(' ')}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-[#F0ECE3] dark:bg-[#1E2B29] p-4 text-xs space-y-1.5">
          <div className="font-semibold">Pet-Safe &amp; Toddler-Safe Plant Advisor</div>
          <p className="text-[#4B5B59] dark:text-[#A7B8B5]">{budgetPlans.plantDisclaimer}</p>
          <div className="flex flex-wrap gap-4 pt-1">
            {budgetPlans.safePlants.map((pl) => (
              <span key={pl.name} className="text-[#0F766E] dark:text-[#2DD4BF] font-medium">
                ✓ {pl.name}: {pl.note}
              </span>
            ))}
          </div>
          {budgetPlans.excludedPlants.length > 0 && (
            <div className="text-[#B45309] dark:text-[#FBBF24]">
              Filtered out for household safety: {budgetPlans.excludedPlants.join(' ')}
            </div>
          )}
        </div>
      </section>

      {/* Community Pulse 2.0 + Family Protection Network */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Community Pulse 2.0 */}
        <section className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 shadow-sm space-y-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-[#0F766E] dark:text-[#2DD4BF]">
              Community Pulse 2.0 · Privacy-Fuzzed H3 Zones
            </div>
            <h2 className="font-display text-lg font-bold flex items-center gap-2 mt-0.5">
              <Radio className="w-4 h-4 text-[#0F766E] dark:text-[#2DD4BF]" />
              Neighborhood Pollution Observations
            </h2>
          </div>

          <form onSubmit={handleSubmitPulse} className="space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <select
                value={pulseCategory}
                onChange={(e) => setPulseCategory(e.target.value as PulseCategory)}
                className="min-h-[44px] px-3 rounded-xl border border-[#E2DDD2] dark:border-[#283836] bg-[#FAF7F2] dark:bg-[#0E1514] text-xs font-medium"
              >
                {PULSE_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                value={pulseSeverity}
                onChange={(e) => setPulseSeverity(e.target.value as any)}
                className="min-h-[44px] px-3 rounded-xl border border-[#E2DDD2] dark:border-[#283836] bg-[#FAF7F2] dark:bg-[#0E1514] text-xs font-medium"
              >
                <option value="mild">Mild</option>
                <option value="moderate">Moderate</option>
                <option value="severe">Severe</option>
              </select>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={pulseNote}
                onChange={(e) => setPulseNote(e.target.value)}
                placeholder="Brief location cue (no personal names or phone numbers)"
                className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-[#E2DDD2] dark:border-[#283836] bg-[#FAF7F2] dark:bg-[#0E1514] text-xs"
              />
              <button
                type="submit"
                disabled={submittingPulse}
                className="min-h-[44px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#0D625B] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                {submittingPulse ? 'Logging...' : 'Submit Report'}
              </button>
            </div>
          </form>

          {pulseFeedback && (
            <div className="rounded-xl bg-[#0F766E]/10 text-[#0F766E] dark:text-[#2DD4BF] p-3 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" /> {pulseFeedback}
            </div>
          )}

          <div className="space-y-2.5 max-h-[290px] overflow-y-auto pr-1">
            {reports.map((rep) => (
              <div
                key={rep.id}
                className="rounded-xl bg-[#FAF7F2] dark:bg-[#0E1514] border border-[#E2DDD2] dark:border-[#283836] p-3 text-xs space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold capitalize">
                    {rep.category.replace(/_/g, ' ')} · {rep.severity}
                  </span>
                  <span className="font-mono-tabular text-[#4B5B59] dark:text-[#A7B8B5]">
                    {rep.h3Zone} · {Math.round(rep.confidence * 100)}% conf ({rep.corroborations} reports)
                  </span>
                </div>
                <p className="text-[#4B5B59] dark:text-[#A7B8B5]">{rep.note}</p>
                <div className="text-[11px] font-medium text-[#0F766E] dark:text-[#2DD4BF]">
                  {rep.status === 'community_corroborated'
                    ? 'Community Corroborated (45m cluster)'
                    : 'Unconfirmed Single Report — treated cautiously'}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Family Protection Network */}
        <section className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 shadow-sm space-y-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-[#0F766E] dark:text-[#2DD4BF]">
              Family Protection Network · Consent-Based Privacy
            </div>
            <h2 className="font-display text-lg font-bold flex items-center gap-2 mt-0.5">
              <Users className="w-4 h-4 text-[#0F766E] dark:text-[#2DD4BF]" />
              Household Vulnerability Profiles
            </h2>
          </div>

          <div className="space-y-2.5">
            {household.members.map((m) => (
              <div
                key={m.id}
                className="rounded-xl bg-[#FAF7F2] dark:bg-[#0E1514] border border-[#E2DDD2] dark:border-[#283836] p-3 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-sm font-semibold">{m.label}</div>
                  <div className="text-xs text-[#4B5B59] dark:text-[#A7B8B5] capitalize">
                    {m.category.replace(/_/g, ' ')} · {m.sensitivity.replace(/_/g, ' ')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleMemberPrivacy(m.id)}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#16201F] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                >
                  {m.privacyMasked ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5 text-[#D97706]" /> Masked in Shares
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5 text-[#0F766E]" /> Visible to Caregivers
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-[#E2DDD2] dark:border-[#283836] flex flex-wrap gap-2">
            <input
              type="text"
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              placeholder="Add member (e.g., Dadi 74y)"
              className="flex-1 min-h-[42px] px-3 rounded-xl border border-[#E2DDD2] dark:border-[#283836] bg-[#FAF7F2] dark:bg-[#0E1514] text-xs"
            />
            <select
              value={newMemberCat}
              onChange={(e) => setNewMemberCat(e.target.value as any)}
              className="min-h-[42px] px-3 rounded-xl border border-[#E2DDD2] dark:border-[#283836] bg-[#FAF7F2] dark:bg-[#0E1514] text-xs"
            >
              <option value="infant">Infant</option>
              <option value="child">Child</option>
              <option value="elderly">Elderly</option>
              <option value="respiratory_sensitive">Respiratory Sensitive</option>
              <option value="adult">Adult</option>
              <option value="pet">Pet</option>
            </select>
            <button
              type="button"
              onClick={() => {
                if (!newMemberName.trim()) return;
                onAddFamilyMember(newMemberName.trim(), newMemberCat);
                setNewMemberName('');
              }}
              className="min-h-[42px] px-4 rounded-xl bg-[#0F766E] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>

          <div className="rounded-xl bg-[#F0ECE3] dark:bg-[#1E2B29] p-3 text-xs text-[#4B5B59] dark:text-[#A7B8B5] flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 text-[#0F766E] mt-0.5" />
            <span>
              Caregiver shares never expose masked health flags or live location automatically without
              explicit action.
            </span>
          </div>
        </section>
      </div>
    </div>
  );
};
